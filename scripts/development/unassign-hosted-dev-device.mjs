/**
 * `pnpm dev:device:unassign` — release a hosted-DEVELOPMENT device's live Store
 * assignment so the board can pair again.
 *
 * ===========================================================================
 * THE SITUATION THIS EXISTS FOR
 * ===========================================================================
 * A Store Hub that has already paired is re-flashed. It boots, shows the pairing
 * prompt, the installer types a fresh code from the Partner Portal — and it is
 * refused. Another code is issued. Refused again. Nothing on the device is
 * broken and nothing about the code is wrong.
 *
 * The board is resolved from HARDWARE evidence (MAC, board serial, SoC serial)
 * and deliberately NOT from storage, so a new SD card is a new INSTALLATION of
 * the SAME DEVICE — see `services/kitluy-device-firstboot-agent/src/installation.ts`.
 * The assignment created by its first pairing is therefore still live, and
 * `create_device_claim_v1` (group 0121) refuses:
 *
 *   KLUY-DEVICE-ALREADY-CLAIMED     same Tenant/Store/Location
 *   KLUY-DEVICE-OWNERSHIP-TRANSFER  a different one — 0121 refuses a transfer
 *                                   disguised as a new claim
 *
 * Both are correct. 0121's own hint states the remedy: "Use
 * revoke_device_assignment_v1 with a named operator. A device never changes
 * owner as a side effect of a new claim." Until this script existed there was no
 * way to follow that hint — the function is granted to `kitluy_fleet_governor`
 * and is called nowhere outside tests and the 0179 replacement doors, so a
 * re-flashed Hub needed someone with a psql prompt.
 *
 * ===========================================================================
 * WHAT IT IS NOT
 * ===========================================================================
 * NOT a replacement path. Swapping the BOARD is a governed, four-eyes operation
 * with its own doors in group 0179 (`request_hub_replacement_v1` and the cutover
 * sequence). This script is for the same board keeping the same identity, and it
 * makes no decision the database does not already make: it calls the one 0121
 * door and reports what that door did.
 *
 * NOT a way to move a Hub between Stores behind the Portal's back. Revocation is
 * recorded as a claim event with the operator reference given here, the device
 * returns to `enrolled` with generation 0, and the next assignment takes a NEW
 * generation number. History is added to, never rewritten.
 *
 * NOT usable outside hosted development. `assertHostedDevTarget` refuses any
 * project but the one allowlisted development project, and refuses any
 * environment but `development`, before a socket is opened.
 *
 * ===========================================================================
 * READ-ONLY UNLESS YOU SAY OTHERWISE
 * ===========================================================================
 * With no `--confirm` it connects, reports what it WOULD revoke, and exits
 * without writing. Revocation is not reversible — the assignment row is closed
 * and the generation number is spent — so the default is to look.
 *
 * Usage:
 *   pnpm dev:device:unassign --asset-tag KL-6CBB3BC0D49B
 *   pnpm dev:device:unassign --asset-tag KL-6CBB3BC0D49B \
 *     --reason SD_CARD_REFLASH --operator OP-VEASNA --confirm
 *
 *   --device-id <uuid>   instead of --asset-tag, when you have the record id
 *
 * Target:
 *   KITLUY_HOSTED_DEV_DB_URL=…   explicit; otherwise the identifiers in
 *                                ../../local-config/het-kitluy-project/supabase.env.local
 *   KITLUY_ENV=development       required by the guard
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  ALLOWED_HOSTED_DEV,
  HostedTargetRefusal,
  assertHostedDevTarget,
} from "../database/hosted-dev-target.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_DIR = resolve(REPO, "..", "..", "local-config", "het-kitluy-project");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Warehouse asset tags are operator-typed; keep the shape tight but not clever. */
const ASSET_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/;
/** Recorded verbatim in a claim event, so it may not carry newlines or padding. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,62}$/;

const die = (message) => {
  process.stderr.write(`\nREFUSED: ${message}\n\n`);
  process.exit(2);
};

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--confirm") {
      out.confirm = true;
      continue;
    }
    const named = /^--([a-z-]+)$/.exec(arg);
    if (named === null) die(`unrecognised argument '${arg}'.`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) die(`--${named[1]} needs a value.`);
    out[named[1]] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const assetTag = args["asset-tag"];
const deviceId = args["device-id"];
if ((assetTag === undefined) === (deviceId === undefined))
  die("name the device with exactly one of --asset-tag or --device-id.");
if (assetTag !== undefined && !ASSET_TAG.test(assetTag))
  die(`'${assetTag}' is not a plausible asset tag.`);
if (deviceId !== undefined && !UUID.test(deviceId)) die(`'${deviceId}' is not a UUID.`);

// Both are recorded on the claim event. A revocation nobody can attribute is
// worse than no revocation, so neither is defaulted.
const reason = args.reason;
const operator = args.operator;
if (args.confirm) {
  if (reason === undefined || !TOKEN.test(reason))
    die("--reason is required with --confirm (e.g. SD_CARD_REFLASH).");
  if (operator === undefined || !TOKEN.test(operator))
    die("--operator is required with --confirm (e.g. OP-VEASNA). It is recorded.");
}

// ---------------------------------------------------------------------------
// Target — validated before anything is dialled
// ---------------------------------------------------------------------------
function hostedDsn() {
  const envFile = resolve(CONFIG_DIR, "supabase.env.local");
  if (!existsSync(envFile)) return null;
  const text = readFileSync(envFile, "utf8");
  const read = (name) => new RegExp(`^${name}=(.*)$`, "m").exec(text)?.[1]?.trim() ?? "";
  const ref = read("KITLUY_SUPABASE_PROJECT_REF");
  const password = read("KITLUY_SUPABASE_DB_PASSWORD");
  if (ref === "" || password === "") return null;
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
}

const dsn = process.env.KITLUY_HOSTED_DEV_DB_URL ?? hostedDsn();
if (dsn === null) die("no hosted development credentials were found.");

// The FULL assertion, not `deriveProjectRef`: this writes, so the ENVIRONMENT
// must be refused too, not only the project (finding D-19). D-20: connect to
// the rebuilt `connectionConfig`, never to the original string.
let target;
try {
  target = assertHostedDevTarget({
    dbUrl: dsn,
    environment: process.env.KITLUY_ENV ?? "development",
  });
} catch (error) {
  if (error instanceof HostedTargetRefusal)
    die(`${String(error.message).replace(/^REFUSED:\s*/, "")}\n  code: ${error.code}`);
  throw error;
}

process.stdout.write(
  `\n  Target ......... ${ALLOWED_HOSTED_DEV.name} (${target.projectRef})\n` +
    `  Host ........... ${target.host}:${target.port}\n` +
    `  Mode ........... ${args.confirm ? "REVOKE" : "report only (no --confirm)"}\n\n`,
);

const client = new pg.Client({ ...target.connectionConfig, connectionTimeoutMillis: 15000 });
await client.connect();

let exitCode = 0;
try {
  // -------------------------------------------------------------------------
  // What is actually there
  // -------------------------------------------------------------------------
  const { rows: devices } = await client.query(
    `select d.id, d.asset_tag, d.device_class, d.lifecycle_state, d.assignment_generation
       from kitluy_devices.devices d
      where ($1::uuid is null or d.id = $1::uuid)
        and ($2::text is null or d.asset_tag = $2::text)`,
    [deviceId ?? null, assetTag ?? null],
  );

  if (devices.length === 0)
    die(`no device matches ${assetTag ?? deviceId} in ${target.projectRef}.`);
  // asset_tag is unique, so this can only be a programming error here.
  if (devices.length > 1) die(`${devices.length} devices matched; refusing to guess.`);

  const device = devices[0];
  const { rows: assignments } = await client.query(
    `select a.id, a.state, a.assignment_generation, a.tenant_id,
            a.digital_store_id, a.store_location_id, a.created_at,
            s.store_code, l.location_code
       from kitluy_devices.device_assignments a
       left join kitluy_core.digital_stores s on s.id = a.digital_store_id
       left join kitluy_core.store_locations l on l.id = a.store_location_id
      where a.device_id = $1::uuid
        and a.state in ('pending_trust', 'active')`,
    [device.id],
  );

  process.stdout.write(
    `  Device ......... ${device.asset_tag}\n` +
      `  Record id ...... ${device.id}\n` +
      `  Class .......... ${device.device_class}\n` +
      `  Lifecycle ...... ${device.lifecycle_state}\n` +
      `  Generation ..... ${device.assignment_generation}\n\n`,
  );

  if (assignments.length === 0) {
    // Not a failure. This is the state the operator is trying to reach, and a
    // second run after a successful revoke lands here.
    process.stdout.write(
      "  No live assignment. This device is already free to pair.\n" +
        "  If pairing still fails, the cause is NOT an existing assignment.\n\n",
    );
    process.exit(0);
  }

  for (const a of assignments) {
    process.stdout.write(
      `  LIVE ASSIGNMENT\n` +
        `    id ........... ${a.id}\n` +
        `    state ........ ${a.state}\n` +
        `    generation ... ${a.assignment_generation}\n` +
        `    store ........ ${a.store_code ?? a.digital_store_id}\n` +
        `    location ..... ${a.location_code ?? a.store_location_id}\n` +
        `    created ...... ${a.created_at instanceof Date ? a.created_at.toISOString() : String(a.created_at)}\n\n`,
    );
  }

  // -------------------------------------------------------------------------
  // Can this session actually perform the revocation?
  // -------------------------------------------------------------------------
  // Reported in BOTH modes, because discovering it only at `--confirm` time is
  // how an operator ends up staring at "permission denied to set role" with a
  // live assignment still in front of them.
  //
  // `revoke_device_assignment_v1` is NOT a SECURITY DEFINER: it runs as its
  // caller and writes `device_assignments`, `device_terminal_assignments`,
  // `device_claims`, `device_assignment_projections` and `devices`. Group 0179
  // grants all of that to `kitluy_fleet_governor` and the migrations grant that
  // role to whoever APPLIED them (`grant kitluy_fleet_governor to current_user`).
  //
  // Two independent things can be true of that membership, and PostgreSQL 16
  // separated them:
  //
  //   SET     — may this session `set role` to it?
  //   INHERIT — does this session already hold its privileges without doing so?
  //
  // A membership installed by the platform's own admin role can carry
  // `set_option = false` (the shape recorded as D-12), which refuses `set role`
  // while INHERIT still supplies every privilege the function needs. Borrowing
  // is therefore an OPTIMISATION, not the mechanism — so this reports both and
  // the revoke path below uses whichever is available.
  const { rows: grants } = await client.query(
    `select m.set_option, m.inherit_option
       from pg_auth_members m
       join pg_roles g on g.oid = m.roleid
      where g.rolname = 'kitluy_fleet_governor'
        and pg_has_role(current_user, m.member, 'usage')`,
  );
  const canSet = grants.some((g) => g.set_option === true);
  const canInherit = grants.some((g) => g.inherit_option === true);
  const { rows: who } = await client.query(
    `select current_user as who,
            has_function_privilege(
              'kitluy_devices.revoke_device_assignment_v1(uuid, text, text)',
              'execute') as may_execute`,
  );
  const mayExecute = who[0]?.may_execute === true;

  process.stdout.write(
    `  AUTHORITY\n` +
      `    connected as . ${who[0]?.who}\n` +
      `    governor ..... ${grants.length === 0 ? "NOT a member" : `member (SET ${canSet ? "yes" : "NO"}, INHERIT ${canInherit ? "yes" : "NO"})`}\n` +
      `    may execute .. ${mayExecute ? "yes" : "NO"}\n\n`,
  );

  if (!mayExecute && !canSet) {
    // Nothing this script can do from here, and saying so is more useful than
    // failing halfway through a transaction.
    process.stdout.write(
      "  This session cannot revoke the assignment: it can neither `set role` to\n" +
        "  kitluy_fleet_governor nor execute the door through inherited privileges.\n" +
        "  A role administrator must repair the membership, e.g.\n\n" +
        "    grant kitluy_fleet_governor to postgres with inherit true, set true;\n\n" +
        "  Nothing was changed.\n\n",
    );
    process.exit(3);
  }

  if (!args.confirm) {
    process.stdout.write(
      "  Nothing was changed. To revoke the assignment above and let this board\n" +
        "  pair again, re-run with a recorded reason and operator:\n\n" +
        `    pnpm dev:device:unassign --asset-tag ${device.asset_tag} \\\n` +
        "      --reason SD_CARD_REFLASH --operator OP-<you> --confirm\n\n",
    );
    process.exit(0);
  }

  // -------------------------------------------------------------------------
  // Revoke
  // -------------------------------------------------------------------------
  await client.query("begin");
  // Borrow the role when the membership permits it. `set local` keeps the
  // borrow inside this transaction — a session-level `set role` would outlive
  // the work — and an explicit borrow is preferred over inherited privilege
  // because it makes the authority the statement runs under unambiguous.
  //
  // When SET is refused, the call proceeds WITHOUT the borrow rather than
  // failing, because the preflight already proved the door is executable by
  // this session — whether through INHERIT or, as on the hosted development
  // project, because `postgres` OWNS the objects the door writes. Insisting on
  // `set role` would refuse a revocation the session is fully entitled to make.
  //
  // Nothing is weakened by the fallback. `revoke_device_assignment_v1` performs
  // its own checks (device exists, a live assignment exists, generation reset,
  // projection withdrawn, claim event recorded) and they are the same checks
  // under either authority.
  if (canSet) {
    await client.query("set local role kitluy_fleet_governor");
  } else {
    process.stdout.write(
      "  NOTE: `set role` is refused for this membership, so the door runs under\n" +
        `  this session's own privileges (${who[0]?.who}). Its checks are identical.\n\n`,
    );
  }
  const { rows: revoked } = await client.query(
    "select kitluy_devices.revoke_device_assignment_v1($1::uuid, $2, $3) as closed",
    [device.id, reason, operator],
  );
  await client.query("commit");

  const { rows: after } = await client.query(
    `select lifecycle_state, assignment_generation
       from kitluy_devices.devices where id = $1::uuid`,
    [device.id],
  );

  process.stdout.write(
    `  REVOKED. ${revoked[0]?.closed ?? 0} assignment(s) closed.\n` +
      `  Lifecycle ...... ${after[0]?.lifecycle_state}\n` +
      `  Generation ..... ${after[0]?.assignment_generation}  (0 = free to pair)\n\n` +
      "  Next: issue a NEW pairing code in the Partner Portal and type it on the\n" +
      "  Hub console. The old code, if any, died with the assignment.\n\n",
  );
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nFAILED: ${message}\n\n`);
  exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

process.exit(exitCode);
