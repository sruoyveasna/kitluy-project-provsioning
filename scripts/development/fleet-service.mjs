/**
 * `pnpm dev:fleet` — run the device registry service so a real Pi can enroll.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * Starting the service for a hardware test previously meant remembering eight
 * environment variables in the right combination. Every one of them fails
 * SILENTLY from the device's point of view: a wrong DSN, an unregistered
 * station, a missing hardware profile or an absent signing key all produce a Pi
 * that sits at "FLEET_ENROLLMENT_REFUSED" with no way to tell which of the
 * eight was wrong from the shop floor.
 *
 * So this checks every precondition FIRST and refuses with a specific message,
 * then starts the service. A failure here is diagnosable in seconds; the same
 * failure discovered through a Pi is a evening of guessing.
 *
 * ===========================================================================
 * LOCAL DEVELOPMENT ONLY
 * ===========================================================================
 * It refuses any non-local database. `db-exec.mjs` already owns that rule for
 * migrations (KL-INF-P1-037); this restates it for the runtime, because a
 * development open-enrollment service pointed at a hosted project is precisely
 * the thing KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001 §5 forbids.
 *
 * Usage:
 *   pnpm dev:fleet                  # bind LAN, print the URL a Pi should use
 *   pnpm dev:fleet --port 8787
 *   pnpm dev:fleet --ensure-fixtures  # create the dev station/profile if absent
 *   pnpm dev:fleet --clear-station-quarantine  # after duplicate-evidence testing
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The local PG17 stack the enrollment work is proven against. */
const DEFAULT_DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

/**
 * Outside the repository, per CLAUDE.md: credentials never live in the tree.
 * Persisted rather than regenerated so a restarted service still issues time
 * tokens that verify against what it issued before.
 */
const KEY_DIR = resolve(REPO, "..", "..", "local-config", "het-kitluy-project");
const KEY_PATH = resolve(KEY_DIR, "dev-enrollment-time.key");

const STATION_KEY = "STATION-WORKSHOP-1";
const TERMINAL_PROFILE = "KL-PI5-TERMINAL-DEV";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const has = (name) => args.includes(`--${name}`);

const port = flag("port", "8787");
const dsn = process.env.KITLUY_DEV_FLEET_DSN ?? DEFAULT_DSN;

const die = (message) => {
  process.stderr.write(`\nREFUSED: ${message}\n\n`);
  process.exit(2);
};
const ok = (message) => process.stdout.write(`  ✓ ${message}\n`);

// --- Local only -------------------------------------------------------------
if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(dsn)) {
  die(
    "this runs development open enrollment and will only dial a LOCAL database.\n" +
      "  Refusing to point an open-enrollment service at a hosted project\n" +
      "  (KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001 §5).",
  );
}

/** The address a Pi on the same network must call. Never a Docker bridge. */
function lanAddress() {
  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (/^(lo|docker|br-|veth|virbr|tailscale)/.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push({ name, address: address.address });
      }
    }
  }
  return candidates[0];
}

/**
 * The local stack's container, found BY THE PORT IN THE DSN rather than by a
 * hardcoded name. `db-exec.mjs` hardcodes `supabase_db_kitluy-local`, which is
 * why it cannot see the `kitluy-repo17` stack this work is proven against; the
 * port is the thing that is actually true about the connection.
 */
function containerForDsn(connectionString) {
  const port = /:(\d+)\//.exec(connectionString)?.[1];
  if (port === undefined) return null;
  let listing;
  try {
    listing = execFileSync("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"], {
      encoding: "utf8",
    });
  } catch {
    return null;
  }
  for (const line of listing.split("\n")) {
    const [name, ports] = line.split("\t");
    if (name !== undefined && ports !== undefined && ports.includes(`:${port}->`)) return name;
  }
  return null;
}

const container = containerForDsn(dsn);
if (container === null) {
  die(
    `no running database container publishes the port in ${dsn}\n` +
      "  Start the local Supabase stack first.",
  );
}

/** One value back, or null. Errors are the caller's to interpret. */
function query(sql) {
  const result = spawnSync(
    "docker",
    ["exec", container, "psql", "-U", "postgres", "-d", "postgres", "-tAc", sql],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function execute(sql) {
  const result = spawnSync(
    "docker",
    [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  return result.status === 0;
}

process.stdout.write("\nPreflight\n");
ok(`database container ${container}`);

// 1. The enrollment doors exist at all.
if (
  query(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'kitluy_devices'
              and p.proname = 'issue_manufacturing_enrollment_ticket_v1'`) !== "1"
) {
  die("migration 0190 is not applied to this database — enrollment cannot work.");
}
ok("migration 0190 present");

// 2. The station. An UNREGISTERED station does not refuse — it quarantines the
//    device after the fact, which is far harder to diagnose from a shop floor.
const stationStatus = query(
  `select status from kitluy_devices.enrollment_stations where station_key = '${STATION_KEY}'`,
);
if (stationStatus === null || stationStatus === "") {
  if (!has("ensure-fixtures")) {
    die(
      `enrollment station ${STATION_KEY} is not registered.\n` +
        "  A device enrolled from an unregistered station is QUARANTINED.\n" +
        "  Re-run with --ensure-fixtures to create it (development only).",
    );
  }
  const created = execute(
    `insert into kitluy_devices.enrollment_stations
       (station_key, display_name, environment, operator_org_ref, status)
     values ('${STATION_KEY}', 'KitLuy development workshop', 'development', 'HET-MFG', 'active')`,
  );
  if (!created) die(`could not create station ${STATION_KEY}`);
  ok(`created development station ${STATION_KEY}`);
} else if (stationStatus !== "active") {
  // A station quarantines itself after repeated duplicate-evidence submissions.
  // That is a REAL control and clearing it is deliberately not part of
  // --ensure-fixtures: it takes its own flag so nobody clears a containment
  // decision by accident while trying to create a missing fixture.
  //
  // It fires readily in development because simulating several devices on one
  // machine means one MAC address submitted many times — which is exactly what
  // a cloned device looks like, so the control is not wrong to fire.
  if (!has("clear-station-quarantine")) {
    const detail = query(
      `select coalesce(quarantine_reason, '') from kitluy_devices.enrollment_stations
        where station_key = '${STATION_KEY}'`,
    );
    die(
      `station ${STATION_KEY} is ${stationStatus}, not active.\n` +
        `  reason: ${detail}\n\n` +
        "  No device can enroll through a quarantined station.\n" +
        "  If this was caused by your own repeated development testing, clear it:\n" +
        "      pnpm dev:fleet --clear-station-quarantine\n" +
        "  Do NOT do this to a station that quarantined for a reason you cannot explain.",
    );
  }
  const cleared = execute(
    `update kitluy_devices.enrollment_stations
        set status = 'active', duplicate_submission_count = 0,
            quarantined_at = null, quarantine_reason = null
      where station_key = '${STATION_KEY}' and environment = 'development'`,
  );
  if (!cleared) die(`could not clear the quarantine on ${STATION_KEY}`);
  process.stdout.write(
    `  ! CLEARED the quarantine on development station ${STATION_KEY}\n` +
      "    (development fixture only — a pilot or production station is untouched by this)\n",
  );
} else {
  ok(`station ${STATION_KEY} active`);
}

// 3. The hardware profile the open-enrollment path issues against.
const profileSignals = query(
  `select array_to_string(required_signal_types, ', ')
     from kitluy_devices.hardware_profiles
    where profile_key = '${TERMINAL_PROFILE}' and is_active`,
);
if (profileSignals === null || profileSignals === "") {
  if (!has("ensure-fixtures")) {
    die(
      `hardware profile ${TERMINAL_PROFILE} does not exist.\n` +
        "  Re-run with --ensure-fixtures to create it (development only).",
    );
  }
  const created = execute(
    `insert into kitluy_devices.hardware_profiles
       (profile_key, display_name, device_class, manufacturer, model_identifier,
        hardware_revision, required_signal_types, secure_element_expectation,
        certification_status, profile_version, is_active)
     values ('${TERMINAL_PROFILE}', 'Raspberry Pi 5 terminal (development)', 'terminal',
             'Raspberry Pi', 'Pi 5', '1.0', '{mac_address}', 'development_software',
             'CERTIFIED', 1, true)`,
  );
  if (!created) die(`could not create profile ${TERMINAL_PROFILE}`);
  ok(`created development profile ${TERMINAL_PROFILE}`);
} else {
  ok(`profile ${TERMINAL_PROFILE} requires: ${profileSignals}`);
}

// 4. The time-signing key. Without it a device gets through the challenge and
//    fails at redemption with DEPENDENCY_UNAVAILABLE — a confusing place to
//    discover a missing key, so it is resolved here instead.
if (!existsSync(KEY_PATH)) {
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  const key = generateKeyPairSync("ed25519").privateKey.export({
    type: "pkcs8",
    format: "pem",
  });
  writeFileSync(KEY_PATH, key, { mode: 0o600 });
  ok("generated a development enrollment-time signing key (outside the repository)");
} else {
  ok("enrollment-time signing key present");
}

const lan = lanAddress();
if (lan === undefined) {
  die("no non-loopback IPv4 address found — a Pi would have nothing to dial.");
}

process.stdout.write(
  [
    "",
    "Ready. Flash a card built with this address:",
    "",
    `    http://${lan.address}:${port}      (interface ${lan.name})`,
    "",
    "Open enrollment is ON: a card with no ticket enrolls, and copies of that",
    "card enroll too. Development only.",
    "",
    "",
  ].join("\n"),
);

// --- Run --------------------------------------------------------------------
const child = spawn(
  process.execPath,
  [resolve(REPO, "services/kitluy-device-registry-service/dist/main.js")],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      KITLUY_ENV: "local",
      PORT: port,
      DEVICE_REGISTRY_DATABASE_URL: dsn,
      // Read BY NAME at the moment of signing; the value is never a parameter.
      KITLUY_DEV_ENROLLMENT_TIME_KEY: readFileSync(KEY_PATH, "utf8"),
      DEVICE_ENROLLMENT_TIME_SIGNING_KEY_ENV: "KITLUY_DEV_ENROLLMENT_TIME_KEY",
      DEVICE_ENROLLMENT_TIME_SIGNING_KEY_ID: "dev-enrollment-time",
      DEVICE_ENROLLMENT_TIME_SIGNING_KEY_VERSION: "1",
      KITLUY_DEV_OPEN_ENROLLMENT: "true",
      KITLUY_DEV_ENROLLMENT_STATION: STATION_KEY,
      KITLUY_DEV_ENROLLMENT_PROFILE_TERMINAL: TERMINAL_PROFILE,
    },
  },
);

process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
