/**
 * `pnpm dev:fleet:watch` — a live view of the fleet, for a hardware test.
 *
 * ===========================================================================
 * WHY THIS EXISTS RATHER THAN THE ADMIN PORTAL
 * ===========================================================================
 * The Admin PWA and the Management API are the real surface and they work —
 * they were proven against the hosted project. Pointing them at a LOCAL stack
 * additionally needs an admin auth user linked to an `admin_user_profiles` row,
 * and the local seed does not provide one: its profile references a user id
 * that has no `auth.users` record. Creating auth users to watch a device boot
 * is a decision about the owner's development data, not a diagnostic step.
 *
 * So this reads exactly what the Management API reads —
 * `kitluy_devices.device_fleet_status`, the same view behind
 * `GET /management/v1/devices` — and renders it. It is a WATCH WINDOW, not a
 * second admin surface: read-only, local-only, no authorization decisions, and
 * nothing here may ever become the way the fleet is administered.
 *
 * Usage:
 *   pnpm dev:fleet:watch              # refresh every 3s
 *   pnpm dev:fleet:watch --once
 *   pnpm dev:fleet:watch --limit 20
 */
import { execFileSync, spawnSync } from "node:child_process";

const DEFAULT_DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const dsn = process.env.KITLUY_DEV_FLEET_DSN ?? DEFAULT_DSN;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const once = args.includes("--once");
const limit = Number(flag("limit", "12"));

if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(dsn)) {
  process.stderr.write("\nREFUSED: this is a local development view only.\n\n");
  process.exit(2);
}

/** Found by the port in the DSN, not by a hardcoded container name. */
function container() {
  const port = /:(\d+)\//.exec(dsn)?.[1];
  if (port === undefined) return null;
  try {
    const listing = execFileSync("docker", ["ps", "--format", "{{.Names}}\t{{.Ports}}"], {
      encoding: "utf8",
    });
    for (const line of listing.split("\n")) {
      const [name, ports] = line.split("\t");
      if (name !== undefined && ports !== undefined && ports.includes(`:${port}->`)) return name;
    }
  } catch {
    return null;
  }
  return null;
}

const db = container();
if (db === null) {
  process.stderr.write(`\nREFUSED: no database container publishes the port in ${dsn}\n\n`);
  process.exit(2);
}

function query(sql) {
  const r = spawnSync(
    "docker",
    ["exec", db, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c", sql],
    { encoding: "utf8" },
  );
  if (r.status !== 0) return [];
  return r.stdout
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => l.split("|"));
}

const GREEN = "[32m";
const YELLOW = "[33m";
const DIM = "[2m";
const BOLD = "[1m";
const RESET = "[0m";

/**
 * `fleet_status` is a COMPOSITE status, not a liveness badge — it carries
 * values like QUARANTINED, AWAITING_CLAIM and BLOCKED_PRODUCTION_INELIGIBLE.
 * It is rendered verbatim rather than translated, because inventing a friendly
 * word for a governed status is how a surface starts lying about the fleet.
 *
 * There is deliberately no ONLINE column: liveness needs a heartbeat within 90
 * seconds (OD-EDGE-LIVENESS-001) and the device heartbeat is not built, so a
 * column claiming it would be empty for every device for ever.
 */
function statusColour(status) {
  if (status === "QUARANTINED") return YELLOW;
  if (status?.startsWith("BLOCKED")) return DIM;
  return "";
}

/** Long WS-11 fixture tags would otherwise wreck the columns. */
function fit(value, width) {
  const v = value ?? "-";
  return v.length > width ? `${v.slice(0, width - 1)}…` : v.padEnd(width);
}

function render() {
  const rows = query(`
    select f.asset_tag, f.device_class, f.lifecycle_state,
           coalesce(f.assignment_state::text,'unassigned'),
           coalesce(f.fleet_status::text,'-'),
           to_char(d.created_at,'MM-DD HH24:MI')
      from kitluy_devices.device_fleet_status f
      join kitluy_devices.devices d on d.id = f.device_record_id
     order by d.created_at desc
     limit ${Number.isInteger(limit) && limit > 0 ? limit : 12}`);

  const total = query("select count(*) from kitluy_devices.device_fleet_status")[0]?.[0] ?? "?";

  const out = [];
  out.push("");
  out.push(`  ${BOLD}KitLuy fleet${RESET}   ${DIM}${db}   ${total} devices${RESET}`);
  out.push("");
  out.push(
    `  ${DIM}${"ENROLLED".padEnd(13)}${"ASSET TAG".padEnd(20)}${"CLASS".padEnd(11)}${"LIFECYCLE".padEnd(15)}${"ASSIGNED".padEnd(12)}STATUS${RESET}`,
  );
  for (const [tag, cls, life, assigned, status, created] of rows) {
    const lifeColour = life === "enrolled" ? GREEN : life === "quarantined" ? YELLOW : "";
    out.push(
      `  ${DIM}${fit(created, 13)}${RESET}${fit(tag, 20)}${fit(cls, 11)}` +
        `${lifeColour}${fit(life, 15)}${RESET}${fit(assigned, 12)}` +
        `${statusColour(status)}${status ?? "-"}${RESET}`,
    );
  }
  out.push("");
  out.push(`  ${DIM}read-only view of kitluy_devices.device_fleet_status${RESET}`);
  out.push("");
  return out.join("\n");
}

if (once) {
  process.stdout.write(`${render()}\n`);
} else {
  process.stdout.write("[?25l");
  const draw = () => process.stdout.write(`[2J[H${render()}`);
  draw();
  const timer = setInterval(draw, 3000);
  const stop = () => {
    clearInterval(timer);
    process.stdout.write("[?25h\n");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
