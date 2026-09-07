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
 * WHICH DATABASE IT WILL TALK TO — DEVELOPMENT ONLY, EITHER PLACE
 * ===========================================================================
 * Two targets are permitted and NOTHING else: a loopback database, or the ONE
 * allowlisted hosted DEVELOPMENT project (`ALLOWED_HOSTED_DEV`). Any other
 * hosted project is refused before a connection is opened.
 *
 * An earlier version of this file refused every hosted database outright, citing
 * KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001 §5. Re-reading that decision, it does
 * not say that. The owner's recorded words are:
 *
 *   "flash one SD card, copy that card as many times as I like, put each copy in
 *    a Raspberry Pi, and have every Pi come online IN THE CLOUD by itself."
 *
 * and its five LOCKED guards are about the ENVIRONMENT (`development` only),
 * explicit opt-in, being announced in the startup log, the image staying
 * secret-free, and pilot/production being untouched. None of them is about where
 * the database is hosted. §4 states the accepted risk precisely: "anything that
 * can REACH the development enrollment endpoint can create a device record" —
 * that is a property of the ENDPOINT, which is still bound to this workstation's
 * LAN, not of the database behind it.
 *
 * So the old refusal was stricter than the decision it cited, and strictness in
 * the wrong place has a cost: it forced development onto a local stack the owner
 * did not want to use, while the dev cloud project sat idle and the two drifted
 * apart. Every locked guard is still enforced, below and in the service.
 *
 * Usage:
 *   pnpm dev:fleet                  # bind LAN, print the URL a Pi should use
 *   pnpm dev:fleet --port 8787
 *   pnpm dev:fleet --ensure-fixtures  # create the dev station/profiles if absent
 *   pnpm dev:fleet --clear-station-quarantine  # after duplicate-evidence testing
 *
 * Target selection:
 *   KITLUY_DEV_FLEET_DSN=…          # explicit, wins over everything
 *   pnpm dev:fleet --local          # the loopback stack instead of the cloud
 */
import { spawn } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  ALLOWED_HOSTED_DEV,
  isLocalUrl,
  canonicalHostedConnection,
  deriveProjectRef,
} from "../database/hosted-dev-target.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The local PG17 stack, used only when explicitly asked for with `--local`. */
const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

/**
 * Outside the repository, per CLAUDE.md: credentials never live in the tree.
 * Persisted rather than regenerated so a restarted service still issues time
 * tokens that verify against what it issued before.
 */
const KEY_DIR = resolve(REPO, "..", "..", "local-config", "het-kitluy-project");
const KEY_PATH = resolve(KEY_DIR, "dev-enrollment-time.key");

/**
 * Fixture names, per target.
 *
 * The hosted development project already carries its own station and profiles
 * (`CLOUD-STATION-01`, `CLOUD-TERM-PI5`, `CLOUD-HUB-PI5`) and they are ACTIVE.
 * Using them rather than creating a second set means the fleet a device joins is
 * the one already there, instead of two parallel sets of fixtures that slowly
 * disagree about what a Pi 5 is.
 */
const FIXTURES = {
  local: {
    station: "STATION-WORKSHOP-1",
    terminalProfile: "KL-PI5-TERMINAL-DEV",
    storeHubProfile: "KL-PI5-STORE-HUB-DEV",
  },
  hosted: {
    station: "CLOUD-STATION-01",
    terminalProfile: "CLOUD-TERM-PI5",
    storeHubProfile: "CLOUD-HUB-PI5",
  },
};

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const has = (name) => args.includes(`--${name}`);

const port = flag("port", "8787");

const die = (message) => {
  process.stderr.write(`\nREFUSED: ${message}\n\n`);
  process.exit(2);
};
const ok = (message) => process.stdout.write(`  ✓ ${message}\n`);

/**
 * Build the hosted DSN from the credentials kept OUTSIDE the repository.
 *
 * Session mode (5432), not transaction mode (6543): the preflight below issues
 * DDL when `--ensure-fixtures` is used, and transaction mode cannot run it.
 * `db.<ref>.supabase.co` is deliberately not used — it is IPv6-only and this
 * workstation has no IPv6 route (recorded in CLAUDE.md).
 */
function hostedDsn() {
  const envFile = resolve(KEY_DIR, "supabase.env.local");
  if (!existsSync(envFile)) return null;
  const text = readFileSync(envFile, "utf8");
  const read = (name) => {
    const match = new RegExp(`^${name}=(.*)$`, "m").exec(text);
    return match?.[1]?.trim() ?? "";
  };
  const ref = read("KITLUY_SUPABASE_PROJECT_REF");
  const password = read("KITLUY_SUPABASE_DB_PASSWORD");
  if (ref === "" || password === "") return null;
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
}

// --- Target -------------------------------------------------------------------
// The hosted DEVELOPMENT project is the default: it is the fleet the owner
// actually wants devices to appear in, and a local stack that only this script
// writes to is a fleet nobody looks at.
const dsn =
  process.env.KITLUY_DEV_FLEET_DSN ?? (has("local") ? LOCAL_DSN : (hostedDsn() ?? LOCAL_DSN));

const targetIsLocal = isLocalUrl(dsn);
const fixtures = targetIsLocal ? FIXTURES.local : FIXTURES.hosted;

// --- Development only, and ONE hosted project ---------------------------------
// The guard the owner decision actually states. A loopback database is fine; a
// hosted one is fine ONLY if it is the allowlisted development project. Pilot,
// production, or any other project is refused before a connection is opened.
if (!targetIsLocal) {
  const ref = deriveProjectRef(dsn);
  if (ref !== ALLOWED_HOSTED_DEV.projectRef) {
    die(
      `this runs development OPEN ENROLLMENT and will not dial that database.\n` +
        `  resolved project: ${ref ?? "(could not be derived)"}\n` +
        `  the only hosted project it may use is ${ALLOWED_HOSTED_DEV.projectRef}` +
        ` (${ALLOWED_HOSTED_DEV.name}, ${ALLOWED_HOSTED_DEV.environment}).\n` +
        "  Pilot and production require a prepared card and are not reachable from here\n" +
        "  (KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001 §5.1, §5.5).",
    );
  }
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
 * One connection, used for every preflight check and then closed.
 *
 * This used to shell out to `docker exec … psql`, which silently made a LOCAL
 * CONTAINER a hard requirement — the reason the script could not talk to the
 * hosted development project even though nothing about the decision forbade it.
 * A client library works against both, and needs no psql on the host (there is
 * none).
 */
// D-20: for a HOSTED target, connect to the VALIDATED components rather than
// to the original string — `?host=`/`?port=` in a DSN is re-read by pg and
// overrides the authority section. The local branch keeps its plain string:
// a local stack is not a hosted target. Environment gating here is D-19 and
// is deliberately unchanged.
const dbOptions = targetIsLocal
  ? { connectionString: dsn }
  : { ...canonicalHostedConnection(dsn).connectionConfig };
const db = new pg.Client({ ...dbOptions, connectionTimeoutMillis: 15000 });
try {
  await db.connect();
} catch (error) {
  die(
    `could not connect to the ${targetIsLocal ? "local" : "hosted development"} database.\n` +
      `  ${error instanceof Error ? error.message : String(error)}` +
      (targetIsLocal ? "\n  Start the local Supabase stack first." : ""),
  );
}

/** One value back, or null when the row is absent. Parameterised, never spliced. */
async function query(sql, params = []) {
  const { rows } = await db.query(sql, params);
  const row = rows[0];
  return row === undefined ? null : String(Object.values(row)[0] ?? "");
}

async function execute(sql, params = []) {
  try {
    await db.query(sql, params);
    return true;
  } catch {
    return false;
  }
}

process.stdout.write("\nPreflight\n");
ok(
  targetIsLocal
    ? `target: LOCAL stack (${dsn.replace(/:[^:@]*@/, ":****@")})`
    : `target: HOSTED DEV ${ALLOWED_HOSTED_DEV.name} (${ALLOWED_HOSTED_DEV.projectRef})`,
);

// 1. The enrollment doors exist at all.
if (
  (await query(`select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'kitluy_devices'
                   and p.proname = 'issue_manufacturing_enrollment_ticket_v1'`)) !== "1"
) {
  die("migration 0190 is not applied to this database — enrollment cannot work.");
}
ok("migration 0190 present");

// 2. The station. An UNREGISTERED station does not refuse — it quarantines the
//    device after the fact, which is far harder to diagnose from a shop floor.
const stationStatus = await query(
  `select status from kitluy_devices.enrollment_stations where station_key = $1`,
  [fixtures.station],
);
if (stationStatus === null || stationStatus === "") {
  if (!has("ensure-fixtures")) {
    die(
      `enrollment station ${fixtures.station} is not registered.\n` +
        "  A device enrolled from an unregistered station is QUARANTINED.\n" +
        "  Re-run with --ensure-fixtures to create it (development only).",
    );
  }
  const created = await execute(
    `insert into kitluy_devices.enrollment_stations
       (station_key, display_name, environment, operator_org_ref, status)
     values ($1, 'KitLuy development workshop', 'development', 'HET-MFG', 'active')`,
    [fixtures.station],
  );
  if (!created) die(`could not create station ${fixtures.station}`);
  ok(`created development station ${fixtures.station}`);
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
    const detail = await query(
      `select coalesce(quarantine_reason, '') from kitluy_devices.enrollment_stations
        where station_key = $1`,
      [fixtures.station],
    );
    die(
      `station ${fixtures.station} is ${stationStatus}, not active.\n` +
        `  reason: ${detail}\n\n` +
        "  No device can enroll through a quarantined station.\n" +
        "  If this was caused by your own repeated development testing, clear it:\n" +
        "      pnpm dev:fleet --clear-station-quarantine\n" +
        "  Do NOT do this to a station that quarantined for a reason you cannot explain.",
    );
  }
  const cleared = await execute(
    `update kitluy_devices.enrollment_stations
        set status = 'active', duplicate_submission_count = 0,
            quarantined_at = null, quarantine_reason = null
      where station_key = $1 and environment = 'development'`,
    [fixtures.station],
  );
  if (!cleared) die(`could not clear the quarantine on ${fixtures.station}`);
  process.stdout.write(
    `  ! CLEARED the quarantine on development station ${fixtures.station}\n` +
      "    (development fixture only — a pilot or production station is untouched by this)\n",
  );
} else {
  ok(`station ${fixtures.station} active`);
}

/**
 * 3. The hardware profiles, one per device class.
 *
 * BOTH are required, and the Store Hub one is why this loop exists. Open
 * enrollment resolves a profile BY DEVICE CLASS, and a class with no configured
 * profile is answered `TICKET_REFUSED` — so with only a terminal profile set, a
 * Store Hub could never enroll at all. That was invisible until a Hub was
 * actually booted, because every terminal test passed.
 */
const profileIds = {};
for (const [deviceClass, profileKey, displayName] of [
  ["terminal", fixtures.terminalProfile, "Raspberry Pi 5 terminal (development)"],
  ["store_hub", fixtures.storeHubProfile, "Raspberry Pi 5 Store Hub (development)"],
]) {
  const signals = await query(
    `select array_to_string(required_signal_types, ', ')
       from kitluy_devices.hardware_profiles
      where profile_key = $1 and is_active and device_class = $2`,
    [profileKey, deviceClass],
  );
  if (signals === null || signals === "") {
    if (!has("ensure-fixtures")) {
      die(
        `no active ${deviceClass} hardware profile ${profileKey}.\n` +
          `  A ${deviceClass} device would be refused with TICKET_REFUSED.\n` +
          "  Re-run with --ensure-fixtures to create it (development only).",
      );
    }
    const created = await execute(
      `insert into kitluy_devices.hardware_profiles
         (profile_key, display_name, device_class, manufacturer, model_identifier,
          hardware_revision, required_signal_types, secure_element_expectation,
          certification_status, profile_version, is_active)
       values ($1, $2, $3, 'Raspberry Pi', 'Pi 5', '1.0', '{mac_address}',
               'development_software', 'CERTIFIED', 1, true)`,
      [profileKey, displayName, deviceClass],
    );
    if (!created) die(`could not create ${deviceClass} profile ${profileKey}`);
    ok(`created development ${deviceClass} profile ${profileKey}`);
  } else {
    ok(`${deviceClass} profile ${profileKey} requires: ${signals}`);
  }
  profileIds[deviceClass] = profileKey;
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

// The preflight connection has done its job. The SERVICE opens its own pool;
// leaving this one open would hold a pooler slot for the life of the process.
await db.end().catch(() => undefined);

process.stdout.write(
  [
    "",
    `Ready — devices will appear in ${targetIsLocal ? "the LOCAL stack" : ALLOWED_HOSTED_DEV.name}.`,
    "",
    "Flash a card built with this address:",
    "",
    `    http://${lan.address}:${port}      (interface ${lan.name})`,
    "",
    "That address is THIS workstation. The device calls it; this service writes",
    `to ${targetIsLocal ? "the local database" : "the dev cloud project"}. The device never talks to a database itself.`,
    "",
    // ANNOUNCED EITHER WAY. KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001 §5.3 requires
    // an open deployment to say so; a CLOSED one must be just as visible, or an
    // operator debugging a refused card cannot tell which mode they are in.
    ...(args.includes("--no-open-enrollment")
      ? [
          "Open enrollment is OFF: a card with no ticket is REFUSED. Devices must",
          "register with the cloud and be approved before they can enroll.",
        ]
      : [
          "Open enrollment is ON: a card with no ticket enrolls, and copies of that",
          "card enroll too. Development only.",
        ]),
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
      // The TRUST environment, which is what the open-enrollment guard checks —
      // not a statement about where the database lives. `local` maps to the
      // `development` trust environment; a hosted DEV project is still
      // development, and pilot/production remain refused at startup.
      KITLUY_ENV: "local",
      PORT: port,
      DEVICE_REGISTRY_DATABASE_URL: dsn,
      // Read BY NAME at the moment of signing; the value is never a parameter.
      KITLUY_DEV_ENROLLMENT_TIME_KEY: readFileSync(KEY_PATH, "utf8"),
      DEVICE_ENROLLMENT_TIME_SIGNING_KEY_ENV: "KITLUY_DEV_ENROLLMENT_TIME_KEY",
      DEVICE_ENROLLMENT_TIME_SIGNING_KEY_ID: "dev-enrollment-time",
      DEVICE_ENROLLMENT_TIME_SIGNING_KEY_VERSION: "1",
      // OPEN ENROLLMENT, NOW OPT-OUT.
      //
      // Open enrollment mints a NEW device identity for any card that presents
      // no ticket. That is what makes a cloned SD card "just work" — and it is
      // also how ONE board booted from TWO cards ends up with two identities,
      // which the clone-detection control then quarantines. It also lets the
      // enrollment agent win the race against cloud registration, so the
      // register -> HET approval path never gets exercised.
      //
      // `--no-open-enrollment` turns it off, leaving registration as the only
      // admission path. Default is unchanged.
      ...(args.includes("--no-open-enrollment")
        ? {}
        : { KITLUY_DEV_OPEN_ENROLLMENT: "true" }),
      KITLUY_DEV_ENROLLMENT_STATION: fixtures.station,
      KITLUY_DEV_ENROLLMENT_PROFILE_TERMINAL: profileIds.terminal,
      // Without this a Store Hub is refused with TICKET_REFUSED — the class has
      // no profile to issue against.
      KITLUY_DEV_ENROLLMENT_PROFILE_STORE_HUB: profileIds.store_hub,
    },
  },
);

process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
