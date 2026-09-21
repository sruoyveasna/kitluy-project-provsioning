/**
 * `pnpm dev:pairing:code` — open a Store Hub pairing session and print the
 * code, the way the Partner Portal would. Local stack or hosted development.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * A Store Hub cannot pair without a code, and until now nothing in this
 * repository could issue one against hosted development. The only issuance
 * surface is `services/kitluy-management-api/src/hub-pairing-issuance.ts` —
 * the Partner Portal's route — and that service has no dev runner. So every
 * hardware session either hand-wrote SQL or went without, and a Hub sat at a
 * prompt with nothing valid to type into it.
 *
 * ===========================================================================
 * IT ISSUES A SESSION, NOT A CLAIM — AND NAMES NO DEVICE
 * ===========================================================================
 * That absence is the model, not an omission
 * (KLD-2026-08-13-HUB-PAIRING-SESSION-001). `open_hub_pairing_session_v1` takes
 * a STORE SCOPE and a code digest; the device-bound claim is created later, by
 * the pairing composition, for whichever Hub presents the code. A Portal that
 * had to name the Hub in advance would need the operator to read a device id
 * off the screen before pairing could begin.
 *
 * Opening a session REVOKES any session still open for the same Store. Two live
 * codes for one shop is a support call in which nobody can say which is
 * correct, so the door makes it impossible rather than warning about it.
 *
 * ===========================================================================
 * THE CODE IS PRINTED ONCE AND STORED NOWHERE
 * ===========================================================================
 * Only its SHA-256 reaches the database — `hub_pairing_sessions` holds a digest,
 * never the code. This script writes the code to stdout for the operator to
 * type and keeps it out of every other channel: it is not logged, not written
 * to a file, and not echoed back in an error. Eight characters of Crockford
 * Base32 is a searchable space, and a code that lands in a log is a code an
 * attacker can read later.
 *
 * ===========================================================================
 * DEVELOPMENT ONLY, AND ON THE SAME DATABASE AS THE FLEET SERVICE
 * ===========================================================================
 * The target comes from `dev-target.mjs`, which reads `KITLUY_DEV_FLEET_DSN`
 * with exactly the precedence `fleet-service.mjs` uses. That is deliberate: a
 * code issued into one database and a Hub talking to another is defect D-22,
 * and it cost a full diagnostic session. The resolved target is PRINTED next to
 * the code so the two can be compared at a glance.
 *
 * A hosted target still goes through the full `assertHostedDevTarget` — project
 * AND environment — before a socket is opened. Pilot and production issue codes
 * through the Portal, behind `authorizePartnerRequest`, never through this.
 *
 * Usage:
 *   pnpm dev:pairing:code --local --operator OP-VEASNA
 *   pnpm dev:pairing:code --operator OP-VEASNA            # hosted development
 *   pnpm dev:pairing:code --local --operator OP-VEASNA \
 *     --store DEMO-LAUNDRY-001 --location DEMO-PP-01 --ttl 900
 *
 * Target:
 *   KITLUY_DEV_FLEET_DSN=…       explicit, wins over everything (same as dev:fleet)
 *   --local                      the loopback stack
 *   KITLUY_ENV=development       required for a hosted target
 */
import { createHash, randomInt } from "node:crypto";

import pg from "pg";

import { HostedTargetRefusal, resolveDevTarget } from "./dev-target.mjs";

/** Recorded verbatim on the session row, so no newlines and no padding. */
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,62}$/;
const CODE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/;

const die = (message) => {
  process.stderr.write(`\nREFUSED: ${message}\n\n`);
  process.exit(2);
};

function parseArgs(argv) {
  const out = { local: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--local") {
      out.local = true;
      continue;
    }
    const named = /^--([a-z-]+)$/.exec(argv[i]);
    if (named === null) die(`unrecognised argument '${argv[i]}'.`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) die(`--${named[1]} needs a value.`);
    out[named[1]] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const operator = args.operator;
if (operator === undefined || !TOKEN.test(operator))
  die("--operator is required (e.g. OP-VEASNA). It is recorded on the session.");

const storeCode = args.store ?? "DEMO-LAUNDRY-001";
const locationCode = args.location ?? "DEMO-PP-01";
if (!CODE_REF.test(storeCode)) die(`'${storeCode}' is not a plausible store code.`);
if (!CODE_REF.test(locationCode)) die(`'${locationCode}' is not a plausible location code.`);

// The door's own ceiling is fifteen minutes (`hub_pairing_sessions_ttl_chk`).
// Checked here too so an operator gets a sentence rather than a constraint name.
const ttlSeconds = Number.parseInt(args.ttl ?? "900", 10);
if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 900)
  die("--ttl must be between 60 and 900 seconds; the door refuses anything longer.");

// ---------------------------------------------------------------------------
// Target — resolved and validated before anything is dialled
// ---------------------------------------------------------------------------
let target;
try {
  target = resolveDevTarget({ local: args.local });
} catch (error) {
  if (error instanceof HostedTargetRefusal)
    die(`${String(error.message).replace(/^REFUSED:\s*/, "")}\n  code: ${error.code}`);
  die(String(error instanceof Error ? error.message : error).replace(/^REFUSED:\s*/, ""));
}

const client = new pg.Client({ ...target.connectionConfig, connectionTimeoutMillis: 15000 });
await client.connect();

let exitCode = 0;
try {
  // -------------------------------------------------------------------------
  // Resolve the scope the Portal would have chosen
  // -------------------------------------------------------------------------
  const { rows: scope } = await client.query(
    `select s.tenant_id, s.id as digital_store_id, l.id as store_location_id
       from kitluy_core.digital_stores s
       join kitluy_core.store_locations l
         on l.digital_store_id = s.id and l.tenant_id = s.tenant_id
      where s.store_code = $1 and l.location_code = $2`,
    [storeCode, locationCode],
  );
  if (scope.length === 0)
    die(
      `no Location '${locationCode}' inside Store '${storeCode}' on ${target.label}.\n` +
        "  Seed the scope first (hosted: pnpm dev:seed:hosted-scope; local: pnpm db:seed)",
    );
  if (scope.length > 1) die("that Store/Location pair is ambiguous; refusing to guess.");
  const { tenant_id, digital_store_id, store_location_id } = scope[0];

  // -------------------------------------------------------------------------
  // The code
  // -------------------------------------------------------------------------
  // The alphabet comes from the DATABASE, not from a copy in this file. It is
  // the same source `looksLikeCode` on the Hub console mirrors, and a second
  // hand-maintained copy is how a console ends up rejecting codes the door
  // happily issued.
  const { rows: alpha } = await client.query(
    "select kitluy_devices.hub_claim_code_alphabet_v1() as alphabet",
  );
  const alphabet = alpha[0]?.alphabet;
  if (typeof alphabet !== "string" || alphabet.length === 0)
    die("the database did not return a pairing-code alphabet.");

  // `randomInt` is a CSPRNG and is unbiased over its range — the same reason
  // `hub-pairing-issuance.ts` uses it rather than `Math.random()` or a modulo
  // of raw bytes.
  const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const digest = createHash("sha256").update(code).digest("hex");

  // -------------------------------------------------------------------------
  // Open the session
  // -------------------------------------------------------------------------
  // `open_hub_pairing_session_v1` is granted to `kitluy_hub_issuance_service`
  // (0194) and is not a definer, so it runs as its caller. Borrow that identity
  // when the membership permits; otherwise proceed, because on the hosted
  // development project `postgres` owns the objects and already holds what the
  // door needs. (The membership there carries SET false — see handoff D-12.)
  //
  // The capability is read with `pg_has_role`, not with `pg_auth_members`
  // columns: `set_option` and `inherit_option` exist only on PostgreSQL 16 and
  // later, and the hardware stack `kitluy-fresh` runs 15.8, where the query
  // failed outright (`column m.set_option does not exist`) before a code could
  // be issued. `MEMBER` is exactly "may SET ROLE to it" on every supported
  // version, and the row is absent when the role does not exist, which leaves
  // the hosted behaviour below unchanged.
  const { rows: grants } = await client.query(
    `select pg_has_role(current_user, r.oid, 'member') as can_set
       from pg_roles r
      where r.rolname = 'kitluy_hub_issuance_service'`,
  );
  await client.query("begin");
  if (grants.some((g) => g.can_set === true)) {
    await client.query("set local role kitluy_hub_issuance_service");
  }
  const { rows: opened } = await client.query(
    `select kitluy_devices.open_hub_pairing_session_v1(
              $1::uuid, $2::uuid, $3::uuid, $4, $5::integer, $6) as id`,
    [tenant_id, digital_store_id, store_location_id, digest, ttlSeconds, `operator/${operator}`],
  );
  await client.query("commit");

  const minutes = Math.round(ttlSeconds / 60);
  process.stdout.write(
    `\n  Target ......... ${target.label}\n` +
      `  Store .......... ${storeCode} / ${locationCode}\n` +
      `  Session ........ ${opened[0]?.id}\n` +
      `  Valid for ...... ${minutes} minute${minutes === 1 ? "" : "s"}\n` +
      `  Attempts ....... 5, then the code locks\n\n` +
      `      PAIRING CODE:   ${code}\n\n` +
      "  Type it on the Store Hub console. It is shown ONCE — only its digest is\n" +
      "  stored, so it cannot be recovered. Re-run this to issue a new one, which\n" +
      "  revokes any code still open for this Store.\n\n",
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
