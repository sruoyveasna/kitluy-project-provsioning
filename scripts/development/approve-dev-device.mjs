/**
 * `pnpm dev:device:approve` — the HET approval step, for development hardware.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * A self-registered board lands in `manufactured` (pending approval) and STOPS.
 * That is the designed resting state, not a fault — plan §3.3 — and a Store Hub
 * cannot pair out of it, because `evaluate_hub_pairing_session_v1` (0194) admits
 * only an `enrolled` `store_hub`. So a device waits for a human at HET.
 *
 * On the hosted project that human uses the Admin PWA. Against a LOCAL stack
 * they cannot: as `fleet-watch.mjs` records, the Admin PWA and Management API
 * additionally need an admin auth user linked to an `admin_user_profiles` row,
 * and the local seed's profile references a user id with no `auth.users`
 * record. So local hardware testing had an approval step with no surface at
 * all, and a board that registered simply sat there.
 *
 * ===========================================================================
 * IT IS THE SAME DOOR, NOT A SHORTCUT PAST IT
 * ===========================================================================
 * This calls `approve_device_enrollment_v1` (0197) and nothing else. Every rule
 * that door enforces still applies and is not restated here:
 *
 *   - a reason and a verification-evidence reference are MANDATORY, because an
 *     approval records WHAT was verified, not merely who clicked;
 *   - only a `manufactured` device may be approved — quarantined, retired,
 *     replaced and restricted devices are never resurrected by an approval;
 *   - an open trust incident refuses the approval outright;
 *   - pilot and production demand a second, distinct approver. This tool
 *     REFUSES those environments before it connects, so the four-eyes rule can
 *     never be reached through a development convenience.
 *
 * Usage:
 *   pnpm dev:device:approve --local --asset-tag KL-XXXXXXXXXXXX \
 *     --operator OP-VEASNA --reason "bench hardware test" --evidence "photo:2026-08-31/hub-01"
 *
 *   --device-id <uuid>   instead of --asset-tag
 *   (omit --local to act on the hosted development project)
 *
 * With no `--confirm` it reports what it WOULD approve and writes nothing.
 */
import pg from "pg";

import { HostedTargetRefusal, resolveDevTarget } from "./dev-target.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,62}$/;
/** Free text, but it lands in an audit row — no control characters. */
const PROSE = /^[^\p{Cc}]{3,200}$/u;

const die = (message) => {
  process.stderr.write(`\nREFUSED: ${message}\n\n`);
  process.exit(2);
};

function parseArgs(argv) {
  const out = { local: false, confirm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--local" || arg === "--confirm") {
      out[arg.slice(2)] = true;
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

// The environment is the door's four-eyes switch. This tool exists for the
// single-approver DEVELOPMENT path only, and refuses the others here rather
// than letting a caller discover the rule from a database exception.
const environment = process.env.KITLUY_ENV ?? "development";
if (environment !== "development")
  die(
    `environment '${environment}' is not approvable by this tool.\n` +
      "  Pilot and production approvals require a second distinct approver and go\n" +
      "  through the Admin surface, never through a development script.",
  );

const operator = args.operator;
const reason = args.reason;
const evidence = args.evidence;
if (args.confirm) {
  if (operator === undefined || !TOKEN.test(operator))
    die("--operator is required with --confirm (e.g. OP-VEASNA). It names the approver.");
  if (reason === undefined || !PROSE.test(reason))
    die('--reason is required with --confirm (e.g. --reason "bench hardware test").');
  if (evidence === undefined || !PROSE.test(evidence))
    die(
      "--evidence is required with --confirm: approval records WHAT was verified.\n" +
        '  e.g. --evidence "photo:2026-08-31/hub-01 serial matches purchase record"',
    );
}

let target;
try {
  target = resolveDevTarget({ local: args.local, environment });
} catch (error) {
  if (error instanceof HostedTargetRefusal)
    die(`${String(error.message).replace(/^REFUSED:\s*/, "")}\n  code: ${error.code}`);
  die(String(error instanceof Error ? error.message : error).replace(/^REFUSED:\s*/, ""));
}

process.stdout.write(
  `\n  Target ......... ${target.label}\n` +
    `  Mode ........... ${args.confirm ? "APPROVE" : "report only (no --confirm)"}\n\n`,
);

const client = new pg.Client({ ...target.connectionConfig, connectionTimeoutMillis: 15000 });
await client.connect();

let exitCode = 0;
try {
  const { rows: devices } = await client.query(
    `select id, asset_tag, device_class::text as cls, lifecycle_state::text as ls
       from kitluy_devices.devices
      where ($1::uuid is null or id = $1::uuid)
        and ($2::text is null or asset_tag = $2::text)`,
    [deviceId ?? null, assetTag ?? null],
  );
  if (devices.length === 0) die(`no device matches ${assetTag ?? deviceId} on this target.`);
  if (devices.length > 1) die(`${devices.length} devices matched; refusing to guess.`);
  const device = devices[0];

  process.stdout.write(
    `  Device ......... ${device.asset_tag}\n` +
      `  Record id ...... ${device.id}\n` +
      `  Class .......... ${device.cls}\n` +
      `  Lifecycle ...... ${device.ls}\n\n`,
  );

  if (device.ls === "enrolled") {
    process.stdout.write("  Already enrolled. Nothing to approve — this device can pair.\n\n");
    process.exit(0);
  }
  if (device.ls !== "manufactured") {
    // Say which door owns the state rather than letting 0197 raise. A retired
    // device in particular is terminal: no approval resurrects it, and telling
    // an operator to "try approving" would waste their evening.
    process.stdout.write(
      `  This device is '${device.ls}', and only a pending ('manufactured') device may be\n` +
        "  approved. Approval never reverses containment or retirement — those have\n" +
        "  their own governed exits, and a retired record has none: the board needs a\n" +
        "  NEW device record, which it gets by registering again (hardware-evidence\n" +
        "  resolution skips retired and replaced devices).\n\n" +
        "  Nothing was changed.\n\n",
    );
    process.exit(3);
  }

  if (!args.confirm) {
    process.stdout.write(
      "  Pending approval. To admit this board to the trusted fleet, re-run with a\n" +
        "  named approver, a reason and what you actually verified:\n\n" +
        `    pnpm dev:device:approve${args.local ? " --local" : ""} --asset-tag ${device.asset_tag} \\\n` +
        '      --operator OP-<you> --reason "bench hardware test" \\\n' +
        '      --evidence "photo:<date>/<board> serial matches purchase record" --confirm\n\n',
    );
    process.exit(0);
  }

  const { rows: verdict } = await client.query(
    `select kitluy_devices.approve_device_enrollment_v1(
              $1::uuid, $2, $3, $4, $5, null) as verdict`,
    [device.id, `operator/${operator}`, reason, environment, evidence],
  );

  const { rows: after } = await client.query(
    "select lifecycle_state::text as ls from kitluy_devices.devices where id = $1::uuid",
    [device.id],
  );

  process.stdout.write(
    `  APPROVED.\n` +
      `  Lifecycle ...... ${after[0]?.ls}\n` +
      `  Verdict ........ ${JSON.stringify(verdict[0]?.verdict)}\n\n` +
      "  Next: issue a pairing code and type it on the Hub console.\n\n",
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nFAILED: ${message}\n\n`);
  exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}

process.exit(exitCode);
