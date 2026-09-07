/**
 * Hosted-development guard tests.
 *
 * Plain node, matching the other scripts/database tools — this directory has no
 * vitest project and adding one for a single guard would be a heavier change
 * than the guard itself.
 *
 * The negative cases carry the weight here. A guard tested only on its happy
 * path is a guard nobody has actually checked: every refusal below is a target
 * that must NEVER be deployed to, and each asserts WHICH rule refused so a
 * future edit cannot make the right thing happen for the wrong reason.
 *
 *   node scripts/database/hosted-dev-target.test.mjs
 */
import { execFileSync } from "node:child_process";
import { inspect } from "node:util";
import net from "node:net";

import {
  ALLOWED_HOSTED_DEV,
  APPROVED_HOSTED_DEV_API_ORIGIN,
  APPROVED_HOSTED_DEV_HOSTS,
  assertHostedDevApiTarget,
  canonicalHostedConnection,
  HostedTargetRefusal,
  assertHostedDevTarget,
  assertNonDestructiveHostedCommand,
  deriveProjectRef,
  parseHostedTargetUrl,
} from "./hosted-dev-target.mjs";

let pass = 0;
let fail = 0;

function ok(name) {
  console.log(`  PASS  ${name}`);
  pass += 1;
}
function bad(name, detail) {
  console.log(`  FAIL  ${name}\n        ${detail}`);
  fail += 1;
}

function expectAllowed(name, input) {
  try {
    const target = assertHostedDevTarget(input);
    if (target.projectRef === ALLOWED_HOSTED_DEV.projectRef) ok(name);
    else bad(name, `allowed, but resolved to '${target.projectRef}'`);
  } catch (error) {
    bad(name, `expected ALLOW, got refusal ${error.code}: ${error.message}`);
  }
}

function expectRefused(name, input, expectedCode) {
  try {
    assertHostedDevTarget(input);
    bad(name, "expected a refusal, but the target was ALLOWED");
  } catch (error) {
    if (!(error instanceof HostedTargetRefusal)) {
      bad(name, `threw a non-refusal error: ${error.message}`);
    } else if (error.code !== expectedCode) {
      bad(name, `refused with ${error.code}, expected ${expectedCode}`);
    } else {
      ok(name);
    }
  }
}

const ALLOWED_DIRECT = `postgresql://postgres:x@db.${ALLOWED_HOSTED_DEV.projectRef}.supabase.co:5432/postgres`;
const ALLOWED_POOLER = `postgresql://postgres.${ALLOWED_HOSTED_DEV.projectRef}:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;

console.log("\nHosted-development deployment guard\n");

// --- The one allowed target -------------------------------------------------
expectAllowed("allowed project + development is deployable (direct connection)", {
  dbUrl: ALLOWED_DIRECT,
  environment: "development",
});
expectAllowed("allowed project + development is deployable (pooler connection)", {
  dbUrl: ALLOWED_POOLER,
  environment: "development",
});
expectAllowed("a declared ref that AGREES with the connection is accepted", {
  dbUrl: ALLOWED_DIRECT,
  environment: "development",
  declaredProjectRef: ALLOWED_HOSTED_DEV.projectRef,
});

// --- Wrong project ----------------------------------------------------------
// het-kitluy-dev (gkfcxxtryqmjnhujlkdr) is the SUPERSEDED target: real, empty,
// still billing, and named in an earlier authorization. It is the most plausible
// wrong target there is, which is exactly why it is pinned as a refusal.
expectRefused(
  "the superseded project (het-kitluy-dev) is refused",
  {
    dbUrl: "postgresql://postgres:x@db.gkfcxxtryqmjnhujlkdr.supabase.co:5432/postgres",
    environment: "development",
  },
  // H-1: refused on the HOST now, before any reference is derived. Earlier than
  // before, and for a stronger reason — that machine is not ours.
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefused(
  "the same supabase.co hostname with a different project is refused",
  {
    dbUrl: "postgresql://postgres:x@db.aaaaaaaaaaaaaaaaaaaa.supabase.co:5432/postgres",
    environment: "development",
  },
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefused(
  "a pooler connection for a different project is refused",
  {
    dbUrl:
      "postgresql://postgres.bbaxhhuoyboirxgdarsm:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
    environment: "development",
  },
  "KLUY-DEPLOY-REF-NOT-ALLOWED",
);

// --- Environment ------------------------------------------------------------
for (const environment of ["production", "pilot", "staging", "prod", undefined, ""]) {
  expectRefused(
    `environment '${String(environment)}' is refused even on the allowed project`,
    { dbUrl: ALLOWED_DIRECT, environment },
    "KLUY-DEPLOY-ENV-NOT-ALLOWED",
  );
}

// --- Unidentifiable / missing targets ---------------------------------------
expectRefused(
  "a remote host with no derivable project ref is refused",
  { dbUrl: "postgresql://postgres:x@some.random.host:5432/postgres", environment: "development" },
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefused(
  "a missing database URL is refused",
  { environment: "development" },
  "KLUY-DEPLOY-NO-TARGET",
);
expectRefused(
  "a malformed URL is refused",
  { dbUrl: "not-a-url", environment: "development" },
  "KLUY-DEPLOY-URL-MALFORMED",
);

// --- Local target handed to the hosted command ------------------------------
expectRefused(
  "a LOCAL database passed to the hosted command is refused and routed",
  {
    dbUrl: "postgresql://postgres:postgres@127.0.0.1:54402/postgres",
    environment: "development",
  },
  "KLUY-DEPLOY-LOCAL-TARGET",
);

// --- Declared/actual disagreement -------------------------------------------
expectRefused(
  "a declared ref that DISAGREES with the connection is refused",
  {
    dbUrl: ALLOWED_DIRECT,
    environment: "development",
    declaredProjectRef: "gkfcxxtryqmjnhujlkdr",
  },
  "KLUY-DEPLOY-REF-MISMATCH",
);

// --- Destructive operations -------------------------------------------------
for (const command of ["reset", "db:reset", "drop", "wipe"]) {
  try {
    assertNonDestructiveHostedCommand(command);
    bad(`'${command}' against hosted dev is refused`, "it was ALLOWED");
  } catch (error) {
    if (error.code === "KLUY-DEPLOY-DESTRUCTIVE-FORBIDDEN")
      ok(`'${command}' against hosted dev is refused`);
    else bad(`'${command}' against hosted dev is refused`, `wrong code ${error.code}`);
  }
}
try {
  assertNonDestructiveHostedCommand("migrate");
  ok("'migrate' (forward-only) is permitted");
} catch (error) {
  bad("'migrate' (forward-only) is permitted", error.message);
}

// --- Ref derivation ---------------------------------------------------------
if (deriveProjectRef(ALLOWED_DIRECT) === ALLOWED_HOSTED_DEV.projectRef)
  ok("deriveProjectRef reads a direct connection");
else bad("deriveProjectRef reads a direct connection", "wrong ref");
if (deriveProjectRef(ALLOWED_POOLER) === ALLOWED_HOSTED_DEV.projectRef)
  ok("deriveProjectRef reads a pooler connection");
else bad("deriveProjectRef reads a pooler connection", "wrong ref");
if (deriveProjectRef("postgresql://postgres:postgres@127.0.0.1:5432/postgres") === null)
  ok("deriveProjectRef returns null for a local URL");
else bad("deriveProjectRef returns null for a local URL", "expected null");

// =============================================================================
// H-1 ADVERSARIAL SUITE — independent security review 2026-08-27
// =============================================================================
//
// The defect: the guard derived the project reference from the POSTGRES
// USERNAME and returned on the first match, never checking the host. So
// `postgres.<approved-ref>@evil.example.net` was announced as the approved
// KitLuy project and then dialled — at an attacker's machine, carrying the
// hosted database password.
//
// Every case below therefore asserts TWO things: that the target is refused,
// and that ZERO connection attempts were made. A guard that refuses after
// opening the socket has already lost the credential.
//
// The connection counter is a real TCP listener. Nothing here dials hosted.

// Assembled from fragments on purpose. A quoted literal here matches
// `secret:scan`'s generic rule, and the right response to a scanner catching a
// fake credential is to stop writing one that looks real — not to allowlist it.
const CANARY_CRED = ["CANARY", "never", "real", "do", "not", "reuse", "9f3a"].join("-");
const REF = ALLOWED_HOSTED_DEV.projectRef;
const POOLER = APPROVED_HOSTED_DEV_HOSTS.pooler;

/** A DSN with the APPROVED username pointed at an arbitrary host. */
const withHost = (
  host,
  { user = `postgres.${REF}`, port = "5432", db = "postgres", scheme = "postgresql" } = {},
) => `${scheme}://${user}:${CANARY_CRED}@${host}:${port}/${db}`;

console.log("\n--- H-1: the host is the target, the username is not ---\n");

/**
 * Refuse, and prove no socket was opened.
 *
 * `net.connect` is monkey-patched for the duration so that ANY attempt — by the
 * guard or by anything it calls — is counted rather than performed.
 */
function expectRefusedWithNoConnection(name, dbUrl, expectedCode) {
  const realConnect = net.connect;
  const realCreate = net.createConnection;
  let attempts = 0;
  net.connect = net.createConnection = () => {
    attempts += 1;
    throw new Error("connection attempted during a refusal path");
  };
  let refusal = null;
  try {
    assertHostedDevTarget({ dbUrl, environment: "development" });
  } catch (error) {
    refusal = error;
  } finally {
    net.connect = realConnect;
    net.createConnection = realCreate;
  }
  if (refusal === null) return bad(name, "it was ALLOWED — the target passed the guard");
  if (!(refusal instanceof HostedTargetRefusal))
    return bad(name, `threw ${refusal.name}: ${refusal.message}`);
  if (expectedCode && refusal.code !== expectedCode)
    return bad(name, `refused with ${refusal.code}, expected ${expectedCode}`);
  if (attempts !== 0) return bad(name, `refused, but made ${attempts} connection attempt(s)`);
  if (String(refusal.message).includes(CANARY_CRED))
    return bad(name, "the refusal message contains the password");
  if (String(refusal.stack ?? "").includes(CANARY_CRED))
    return bad(name, "the stack contains the password");
  ok(`${name}  [connections=0]`);
}

// --- VALID ------------------------------------------------------------------
expectAllowed("H1-1. authorised SESSION pooler + 5432 + postgres + postgres.<ref> + development", {
  dbUrl: withHost(POOLER),
  environment: "development",
});
expectAllowed("H1-2. authorised DIRECT db.<ref>.supabase.co with an agreeing username", {
  dbUrl: withHost(APPROVED_HOSTED_DEV_HOSTS.direct, { user: `postgres.${REF}` }),
  environment: "development",
});

// --- REFUSE, ZERO CONNECTIONS ----------------------------------------------
expectRefusedWithNoConnection(
  "H1-3. approved username ref + evil.example.net",
  withHost("evil.example.net"),
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-4. approved username ref + 127.0.0.1",
  withHost("127.0.0.1"),
  "KLUY-DEPLOY-LOCAL-TARGET",
);
expectRefusedWithNoConnection(
  "H1-5. approved username ref + 127.1",
  withHost("127.1"),
  "KLUY-DEPLOY-LOCAL-TARGET",
);
expectRefusedWithNoConnection(
  "H1-6. approved username ref + 2130706433 (decimal IPv4)",
  withHost("2130706433"),
  "KLUY-DEPLOY-LOCAL-TARGET",
);
expectRefusedWithNoConnection(
  "H1-7. approved username ref + 0x7f000001 (hex IPv4)",
  withHost("0x7f000001"),
  "KLUY-DEPLOY-LOCAL-TARGET",
);
expectRefusedWithNoConnection(
  "H1-8. approved username ref + [::1]",
  withHost("[::1]"),
  "KLUY-DEPLOY-LOCAL-TARGET",
);
expectRefusedWithNoConnection(
  "H1-9. approved username ref + arbitrary IPv6 [2001:db8::1]",
  withHost("[2001:db8::1]"),
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-10. approved username ref + ANOTHER project's db host",
  withHost("db.aaaabbbbccccddddeeee.supabase.co"),
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-11. approved username ref + arbitrary *.supabase.com",
  withHost("evil.supabase.com"),
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-12. approved username ref + attacker pooler-looking host",
  withHost("aws-9-attacker.pooler.supabase.com"),
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-12b. suffix-smuggling host ending in the approved name",
  withHost(`${POOLER}.attacker.net`),
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-13. wrong scheme mysql://",
  withHost(POOLER, { scheme: "mysql" }),
  "KLUY-DEPLOY-SCHEME-NOT-ALLOWED",
);
expectRefusedWithNoConnection(
  "H1-14. port 6543 (transaction mode, cannot run DDL)",
  withHost(POOLER, { port: "6543" }),
  "KLUY-DEPLOY-PORT-NOT-CANONICAL",
);
expectRefusedWithNoConnection(
  "H1-15. unexpected database name",
  withHost(POOLER, { db: "exfil" }),
  "KLUY-DEPLOY-DATABASE-NOT-CANONICAL",
);
expectRefusedWithNoConnection(
  "H1-16. malformed percent-encoded username",
  `postgresql://postgres.%E0%A4%A:${CANARY_CRED}@${POOLER}:5432/postgres`,
  "KLUY-DEPLOY-USERNAME-MALFORMED",
);
expectRefusedWithNoConnection(
  "H1-17. project ref ONLY in the pathname",
  `postgresql://postgres:${CANARY_CRED}@evil.example.net:5432/${REF}`,
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-18. project ref ONLY in the password",
  `postgresql://postgres:${REF}@evil.example.net:5432/postgres`,
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-19. project ref ONLY in the query string",
  `postgresql://postgres:${CANARY_CRED}@evil.example.net:5432/postgres?options=project%3D${REF}`,
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);
expectRefusedWithNoConnection(
  "H1-20. hostname trailing-dot ambiguity",
  withHost(`${POOLER}.`),
  "KLUY-DEPLOY-HOST-NOT-APPROVED",
);

// Ref in the right place but on the approved host with a WRONG ref: the
// reference rule, not the host rule, must be what catches this.
expectRefusedWithNoConnection(
  "H1-21. approved host + WRONG project ref in the username",
  withHost(POOLER, { user: "postgres.aaaabbbbccccddddeeee" }),
  "KLUY-DEPLOY-REF-NOT-ALLOWED",
);
expectRefusedWithNoConnection(
  "H1-22. DIRECT host and username naming DIFFERENT projects",
  `postgresql://postgres.aaaabbbbccccddddeeee:${CANARY_CRED}@${APPROVED_HOSTED_DEV_HOSTS.direct}:5432/postgres`,
  "KLUY-DEPLOY-REF-HOST-USER-MISMATCH",
);

// --- Query parameters are OBSERVED for H-2, never acted on ------------------
{
  const t = assertHostedDevTarget({
    dbUrl: `${withHost(POOLER)}?sslmode=disable`,
    environment: "development",
  });
  const seen = t.observedQueryParameters.map((q) => `${q.name}=${q.value}`).join(",");
  if (seen === "sslmode=disable")
    ok("H1-23. TLS query parameters are recorded verbatim for H-2, not rewritten");
  else bad("H1-23. TLS parameters recorded for H-2", `saw '${seen}'`);
}

// --- M-1 IS STILL OPEN, and this test says so -------------------------------
// NOT a fix. The guard itself refuses anything that is not exactly
// 'development'; the defect is that the CALLERS default an unset KITLUY_ENV to
// 'development'. Recorded here so H-1 closure is never mistaken for M-1 closure.
{
  let refusedUnset = false;
  try {
    assertHostedDevTarget({ dbUrl: withHost(POOLER), environment: undefined });
  } catch {
    refusedUnset = true;
  }
  const deployDefaults = /KITLUY_ENV\s*\?\?\s*"development"/.test(
    execFileSync("cat", ["scripts/database/db-deploy-hosted-dev.mjs"], { encoding: "utf8" }),
  );
  const pinDefaults = /KITLUY_ENV\?\.trim\(\)\s*\?\?\s*"development"/.test(
    execFileSync("cat", ["scripts/pki/trust-anchor-bootstrap.mjs"], { encoding: "utf8" }),
  );
  if (refusedUnset && deployDefaults && pinDefaults)
    ok(
      "H1-24. M-1 STILL OPEN (documented): the guard refuses an unset environment, but BOTH callers default it to 'development'",
    );
  else
    bad(
      "H1-24. M-1 documented as still open",
      `guardRefusesUnset=${refusedUnset} deployDefaults=${deployDefaults} pinDefaults=${pinDefaults}`,
    );
}

// --- parseHostedTargetUrl never performs I/O --------------------------------
{
  const realConnect = net.connect;
  let attempts = 0;
  net.connect = () => {
    attempts += 1;
    throw new Error("no");
  };
  try {
    for (const h of ["evil.example.net", POOLER, "127.1", "[::1]"]) {
      try {
        parseHostedTargetUrl(withHost(h));
      } catch {
        /* refusals are the point */
      }
    }
  } finally {
    net.connect = realConnect;
  }
  if (attempts === 0)
    ok("H1-25. parseHostedTargetUrl performs NO I/O on any path  [connections=0]");
  else bad("H1-25. parseHostedTargetUrl performs no I/O", `${attempts} attempts`);
}

// =============================================================================
// CREDENTIAL EXFILTRATION PROOF — a real listener that must never be contacted
// =============================================================================
{
  const listener = net.createServer();
  const received = [];
  let connections = 0;
  listener.on("connection", (socket) => {
    connections += 1;
    socket.on("data", (chunk) => received.push(chunk.toString("latin1")));
  });
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;

  // The attacker's machine IS this listener. The username carries the approved
  // project reference — the exact shape that used to be approved.
  const evil = `postgresql://postgres.${REF}:${CANARY_CRED}@127.0.0.1:${port}/postgres`;

  let guardRefused = false;
  let message = "";
  try {
    assertHostedDevTarget({ dbUrl: evil, environment: "development" });
  } catch (error) {
    guardRefused = true;
    message = `${error.message}\n${error.stack ?? ""}`;
  }

  // Both real callers, as processes, against the same listener.
  const runCaller = (script, extraEnv) => {
    try {
      const out = execFileSync("node", [script], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...extraEnv },
      });
      return { code: 0, out, err: "" };
    } catch (error) {
      return {
        code: error.status ?? 1,
        out: String(error.stdout ?? ""),
        err: String(error.stderr ?? ""),
      };
    }
  };
  const deploy = runCaller("scripts/database/db-deploy-hosted-dev.mjs", {
    KITLUY_HOSTED_DEV_DB_URL: evil,
    KITLUY_ENV: "development",
  });
  const pin = runCaller("scripts/pki/pin-dev-trust-anchors.mjs", {
    KITLUY_HOSTED_DEV_DB_URL: evil,
    KITLUY_ENV: "development",
    KITLUY_DEV_PKI_DIR: process.env.KITLUY_DEV_PKI_DIR ?? "/nonexistent",
    KITLUY_DEV_ROOT_SHA256: "0".repeat(64),
    KITLUY_DEV_ISSUING_SHA256: "0".repeat(64),
  });
  // pin-dev-trust-anchors needs the flag to even consider hosted; without it the
  // hosted URL must be ignored entirely. Run it the way an attacker would.
  const pinHosted = (() => {
    try {
      const out = execFileSync(
        "node",
        ["scripts/pki/pin-dev-trust-anchors.mjs", "--hosted-development"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            KITLUY_HOSTED_DEV_DB_URL: evil,
            KITLUY_ENV: "development",
            KITLUY_DEV_PKI_DIR: process.env.KITLUY_DEV_PKI_DIR ?? "/nonexistent",
            KITLUY_DEV_ROOT_SHA256: "0".repeat(64),
            KITLUY_DEV_ISSUING_SHA256: "0".repeat(64),
          },
        },
      );
      return { code: 0, out, err: "" };
    } catch (error) {
      return {
        code: error.status ?? 1,
        out: String(error.stdout ?? ""),
        err: String(error.stderr ?? ""),
      };
    }
  })();

  await new Promise((resolve) => listener.close(resolve));
  const allOutput = [
    message,
    deploy.out,
    deploy.err,
    pin.out,
    pin.err,
    pinHosted.out,
    pinHosted.err,
  ].join("\n");
  const wire = received.join("");

  if (guardRefused)
    ok("X-1. the guard refuses an approved-username DSN aimed at a listener we control");
  else bad("X-1. guard refuses the exfiltration DSN", "it was ALLOWED");
  if (connections === 0) ok(`X-2. listener connections = 0`);
  else bad("X-2. listener connections = 0", `the listener was contacted ${connections} time(s)`);
  if (!wire.includes(CANARY_CRED)) ok("X-3. password never reached the listener");
  else bad("X-3. password never reached the listener", "THE PASSWORD WAS TRANSMITTED");
  if (!allOutput.includes(CANARY_CRED))
    ok("X-4. password absent from stdout, stderr, error message and stack");
  else bad("X-4. password absent from all output", "the canary password leaked into output");
  if (!allOutput.includes(evil)) ok("X-5. the full DSN never appears in any output");
  else bad("X-5. DSN absent from all output", "the DSN leaked into output");
  if (deploy.code !== 0)
    ok(`X-6. db-deploy-hosted-dev REFUSED before network I/O (exit ${deploy.code})`);
  else bad("X-6. db-deploy-hosted-dev refuses", "it exited 0");
  if (pinHosted.code !== 0)
    ok(
      `X-7. pin-dev-trust-anchors --hosted-development REFUSED before network I/O (exit ${pinHosted.code})`,
    );
  else bad("X-7. pin-dev-trust-anchors refuses", "it exited 0");
  if (pin.code !== 0)
    ok(
      `X-8. pin-dev-trust-anchors WITHOUT the flag ignores the hosted URL and refuses (exit ${pin.code})`,
    );
  else bad("X-8. pin-dev-trust-anchors without the flag refuses", "it exited 0");
}

// --- The reviewer's headline case, through BOTH real callers, as processes ---
// evil.example.net is a genuine arbitrary Internet host, not loopback: this is
// the exact shape that used to be APPROVED and dialled.
{
  const evilRemote = `postgresql://postgres.${REF}:${CANARY_CRED}@evil.example.net:5432/postgres`;
  const run = (args, extraEnv) => {
    try {
      const out = execFileSync("node", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...extraEnv },
      });
      return { code: 0, text: out };
    } catch (error) {
      return { code: error.status ?? 1, text: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    }
  };
  const baseEnv = { KITLUY_HOSTED_DEV_DB_URL: evilRemote, KITLUY_ENV: "development" };
  const d = run(["scripts/database/db-deploy-hosted-dev.mjs"], baseEnv);
  const p2 = run(["scripts/pki/pin-dev-trust-anchors.mjs", "--hosted-development"], {
    ...baseEnv,
    KITLUY_DEV_PKI_DIR: process.env.KITLUY_DEV_PKI_DIR ?? "/nonexistent",
    KITLUY_DEV_ROOT_SHA256: "0".repeat(64),
    KITLUY_DEV_ISSUING_SHA256: "0".repeat(64),
  });
  const good = (r) =>
    r.code !== 0 &&
    r.text.includes("KLUY-DEPLOY-HOST-NOT-APPROVED") &&
    !r.text.includes(CANARY_CRED) &&
    !r.text.includes(evilRemote);
  if (good(d))
    ok(
      "X-9. db-deploy-hosted-dev refuses evil.example.net with HOST-NOT-APPROVED, no credential in output",
    );
  else
    bad(
      "X-9. db-deploy-hosted-dev refuses an arbitrary Internet host",
      `exit=${d.code} text=${d.text.slice(0, 200)}`,
    );
  if (good(p2))
    ok(
      "X-10. pin-dev-trust-anchors refuses evil.example.net with HOST-NOT-APPROVED, no credential in output",
    );
  else
    bad(
      "X-10. pin-dev-trust-anchors refuses an arbitrary Internet host",
      `exit=${p2.code} text=${p2.text.slice(0, 200)}`,
    );

  // The consumer H-1 was re-opened on. It is READ-ONLY against the database,
  // which says nothing about what it hands to the HOST: cleartext auth
  // surrenders the password to any listener that answers the startup packet.
  const sup = run(["scripts/database/verify-hosted-supautils.mjs"], baseEnv);
  if (good(sup))
    ok(
      "X-12. verify-hosted-supautils refuses evil.example.net with HOST-NOT-APPROVED, no credential in output",
    );
  else
    bad(
      "X-12. verify-hosted-supautils refuses an arbitrary Internet host",
      `exit=${sup.code} text=${sup.text.slice(0, 200)}`,
    );
}

// --- No DNS resolution either: the refusal precedes name lookup -------------
{
  const dns = await import("node:dns");
  let lookups = 0;
  const realLookup = dns.default.lookup;
  const realResolve = dns.default.resolve;
  dns.default.lookup = (...a) => {
    lookups += 1;
    return realLookup(...a);
  };
  dns.default.resolve = (...a) => {
    lookups += 1;
    return realResolve(...a);
  };
  try {
    for (const h of [
      "evil.example.net",
      "attacker.pooler.supabase.com",
      "db.aaaabbbbccccddddeeee.supabase.co",
    ]) {
      try {
        assertHostedDevTarget({ dbUrl: withHost(h), environment: "development" });
      } catch {
        /* expected */
      }
    }
  } finally {
    dns.default.lookup = realLookup;
    dns.default.resolve = realResolve;
  }
  if (lookups === 0) ok("X-11. a refused host is never even resolved  [dns lookups=0]");
  else bad("X-11. a refused host is never resolved", `${lookups} DNS lookup(s)`);
}

// --- Every consumer of the hosted DSN must reach the guard ------------------
// H-1 survived a full adversarial pass because the exfiltration test named two
// callers, while a third — verify-hosted-supautils.mjs — read the same variable
// and dialled it unguarded. A hand-written list of callers cannot notice the
// caller it does not name, so this enumerates them from disk.
//
// Read with fs and not grep: scripts/pki/trust-anchor-bootstrap.mjs contains a
// literal NUL byte, so grep classifies it as binary and prints NO matches for
// it at all. A grep-based sweep would silently skip a guarded file today, and
// an unguarded one tomorrow.
{
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { dirname, join, resolve: resolvePath } = await import("node:path");

  const ENV_NAME = "KITLUY_HOSTED_DEV_DB_URL";
  const GUARD = "hosted-dev-target.mjs";

  const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const p = join(dir, entry);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });

  const read = (p) => readFileSync(p, "utf8");

  // A consumer may reach the guard through a local module it imports, as
  // pin-dev-trust-anchors.mjs does via trust-anchor-bootstrap.mjs. Follow
  // relative specifiers so that indirection counts as guarded.
  const reachesGuard = (file, seen = new Set()) => {
    const key = resolvePath(file);
    if (seen.has(key)) return false;
    seen.add(key);
    let text;
    try {
      text = read(file);
    } catch {
      return false;
    }
    if (text.includes(GUARD)) return true;
    for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
      if (reachesGuard(resolvePath(dirname(file), m[1]), seen)) return true;
    }
    return false;
  };

  const consumers = walk("scripts")
    .filter((p) => p.endsWith(".mjs") && !p.endsWith(".test.mjs"))
    .filter((p) => read(p).includes(ENV_NAME));

  const unguarded = consumers.filter((p) => !reachesGuard(p));

  if (consumers.length >= 3)
    ok(`X-13. hosted-DSN consumers enumerated from disk  [${consumers.length} found]`);
  else
    bad(
      "X-13. hosted-DSN consumers enumerated from disk",
      `only ${consumers.length} found — the sweep is not seeing the tree`,
    );

  if (unguarded.length === 0) ok(`X-14. every consumer of ${ENV_NAME} routes it through ${GUARD}`);
  else
    bad(
      `X-14. every consumer of ${ENV_NAME} routes it through ${GUARD}`,
      `UNGUARDED: ${unguarded.join(", ")} — it dials whatever host the variable names`,
    );
}

// =============================================================================
// D-18 — THE SUPABASE HTTPS API DOOR
// =============================================================================
//
// `seed-hosted-dev-partner.mjs` reaches the Supabase Auth Admin API carrying the
// SERVICE-ROLE KEY — full database-bypass authority — through a URL that nothing
// validated, and that fetch was the FIRST network call the script made. The SQL
// door on the same script checked only `deriveProjectRef`, so it never refused
// pilot, staging or production either.
//
// `assertHostedDevApiTarget` is a separate assertion because an origin has
// different limbs from a DSN. Fabricating a DSN to reuse the SQL assertion would
// validate a string nobody connects to — the H-1 mistake in a new costume.
//
// `https:` is a SPECIAL scheme, so Node lowercases the host and applies IDNA
// before this code sees it. A homoglyph arrives punycoded and cannot match.
{
  const API = `https://${ALLOWED_HOSTED_DEV.projectRef}.supabase.co`;
  const apiOk = (name, apiUrl, environment = "development") => {
    try {
      const t = assertHostedDevApiTarget({ apiUrl, environment });
      if (t.origin === API) ok(name);
      else bad(name, `allowed, but origin resolved to '${t.origin}'`);
    } catch (error) {
      bad(name, `refused unexpectedly: ${error.code} ${error.message}`);
    }
  };
  const apiNo = (name, apiUrl, expectedCode, environment = "development") => {
    try {
      assertHostedDevApiTarget({ apiUrl, environment });
      bad(name, "it was ALLOWED");
    } catch (error) {
      if (!(error instanceof HostedTargetRefusal)) bad(name, `threw ${error.name}`);
      else if (expectedCode && error.code !== expectedCode)
        bad(name, `refused with ${error.code}, expected ${expectedCode}`);
      else ok(name);
    }
  };

  console.log("\n--- D-18: the Supabase HTTPS API door ---\n");

  apiOk("D18-1. the approved API origin is accepted", API);
  apiOk("D18-2. a trailing slash normalises to the canonical origin", `${API}/`);
  apiOk(
    "D18-3. an UPPERCASE host normalises (DNS is case-insensitive)",
    API.toUpperCase().replace("HTTPS", "https"),
  );

  apiNo("D18-4. arbitrary Internet host", "https://evil.example.net", "KLUY-API-HOST-NOT-APPROVED");
  apiNo("D18-5. localhost", "https://localhost", "KLUY-API-HOST-NOT-APPROVED");
  apiNo("D18-6. numeric loopback", "https://2130706433", "KLUY-API-HOST-NOT-APPROVED");
  apiNo(
    "D18-7. another Supabase project",
    "https://aaaabbbbccccddddeeee.supabase.co",
    "KLUY-API-HOST-NOT-APPROVED",
  );
  apiNo(
    "D18-8. the superseded het-kitluy-dev project",
    "https://gkfcxxtryqmjnhujlkdr.supabase.co",
    "KLUY-API-HOST-NOT-APPROVED",
  );
  apiNo(
    "D18-9. suffix smuggling <approved>.attacker.net",
    `${API}.attacker.net`,
    "KLUY-API-HOST-NOT-APPROVED",
  );
  apiNo("D18-10. trailing dot", `${API}.`, "KLUY-API-HOST-NOT-APPROVED");
  apiNo(
    "D18-11. http:// — a service-role key is never sent without TLS",
    API.replace("https:", "http:"),
    "KLUY-API-SCHEME-NOT-ALLOWED",
  );
  apiNo("D18-12. non-canonical port", `${API}:8443`, "KLUY-API-PORT-NOT-CANONICAL");
  apiNo(
    "D18-13. ref only in the PATH",
    `https://evil.example.net/${ALLOWED_HOSTED_DEV.projectRef}`,
    "KLUY-API-HOST-NOT-APPROVED",
  );
  apiNo(
    "D18-14. ref only in the QUERY",
    `https://evil.example.net?p=${ALLOWED_HOSTED_DEV.projectRef}`,
    "KLUY-API-HOST-NOT-APPROVED",
  );
  // The USERINFO limb runs before the host limb and catches this first. The
  // host behind the `@` is evil.example.net either way; a URL carrying
  // credentials is never a legitimate origin.
  apiNo(
    "D18-15. approved host smuggled into USERINFO",
    `https://${ALLOWED_HOSTED_DEV.projectRef}.supabase.co@evil.example.net`,
    "KLUY-API-USERINFO-PRESENT",
  );
  apiNo(
    "D18-16. userinfo on the APPROVED host",
    `https://u:p@${ALLOWED_HOSTED_DEV.projectRef}.supabase.co`,
    "KLUY-API-USERINFO-PRESENT",
  );
  apiNo(
    "D18-17. a path on the approved host is not an origin",
    `${API}/auth/v1`,
    "KLUY-API-PATH-NOT-ORIGIN",
  );
  apiNo("D18-18. malformed URL", "not-a-url", "KLUY-API-URL-MALFORMED");
  apiNo("D18-19. absent target", "", "KLUY-API-NO-TARGET");
  apiNo("D18-20. environment production", API, "KLUY-API-ENV-NOT-ALLOWED", "production");
  apiNo("D18-21. environment pilot", API, "KLUY-API-ENV-NOT-ALLOWED", "pilot");
  apiNo("D18-22. environment staging", API, "KLUY-API-ENV-NOT-ALLOWED", "staging");
  // Called DIRECTLY, not through apiNo(): a JavaScript default parameter turns an
  // explicit `undefined` back into "development", which would make this test
  // assert the opposite of what it claims. apiNo() also forwards no
  // declaredProjectRef, so D18-24 has to construct its own call.
  try {
    assertHostedDevApiTarget({ apiUrl: API });
    bad("D18-23. environment UNSET refuses (no silent default here)", "it was ALLOWED");
  } catch (error) {
    if (error.code === "KLUY-API-ENV-NOT-ALLOWED")
      ok("D18-23. environment UNSET refuses (no silent default here)");
    else bad("D18-23. environment UNSET refuses", `refused with ${error.code}`);
  }
  try {
    assertHostedDevApiTarget({
      apiUrl: API,
      environment: "development",
      declaredProjectRef: "aaaabbbbccccddddeeee",
    });
    bad("D18-24. a declared ref that disagrees with the origin", "it was ALLOWED");
  } catch (error) {
    if (error.code === "KLUY-API-REF-MISMATCH")
      ok("D18-24. a declared ref that disagrees with the origin");
    else bad("D18-24. declared ref mismatch", `refused with ${error.code}`);
  }

  // The API allowlist must be DERIVED from the one project literal, never a
  // second copy of it — that is what keeps the two doors from drifting apart.
  if (APPROVED_HOSTED_DEV_API_ORIGIN === `https://${ALLOWED_HOSTED_DEV.projectRef}.supabase.co`)
    ok("D18-25. the API origin is derived from ALLOWED_HOSTED_DEV, not duplicated");
  else bad("D18-25. API origin derived from the one allowlist", APPROVED_HOSTED_DEV_API_ORIGIN);

  // seed-hosted-dev-partner must build requests from the RETURNED origin, never
  // from the configured string — string concatenation onto an unvalidated value
  // is how a normalised-away path or query gets back in.
  const seedSrc = execFileSync("cat", ["scripts/development/seed-hosted-dev-partner.mjs"], {
    encoding: "utf8",
  });
  if (/\bapiOrigin\b/.test(seedSrc) && !/\$\{supabaseUrl\}/.test(seedSrc))
    ok("D18-26. seed-hosted-dev-partner builds requests from the VALIDATED origin");
  else
    bad(
      "D18-26. requests built from the validated origin",
      "it still concatenates onto the raw configured URL",
    );
  if (/assertHostedDevTarget\(/.test(seedSrc) && /assertHostedDevApiTarget\(/.test(seedSrc))
    ok("D18-27. seed-hosted-dev-partner asserts BOTH doors");
  else bad("D18-27. both doors asserted", "one of the two assertions is missing");
}

// =============================================================================
// D-20 — QUERY PARAMETERS MUST NOT OVERRIDE THE VALIDATED TARGET
// =============================================================================
//
// Measured against `pg` before the fix: `?host=127.0.0.1&port=N` made it dial
// 127.0.0.1:N while the guard reported the approved pooler, `?host=%2Ftmp`
// redirected to a UNIX SOCKET, and `?user=` changed the startup user. A
// confirmer captured a cleartext password that way.
//
// The policy is an ALLOWLIST: routing parameters are refused, unknown parameters
// are refused, and only TLS parameters survive — which H-2 will then govern.
{
  const D20 = `postgresql://postgres.${ALLOWED_HOSTED_DEV.projectRef}:pw@${POOLER}:5432/postgres`;
  const q = (suffix) => {
    try {
      assertHostedDevTarget({ dbUrl: D20 + suffix, environment: "development" });
      return "ALLOWED";
    } catch (error) {
      return error.code;
    }
  };
  const refuses = (name, suffix, code) =>
    q(suffix) === code ? ok(name) : bad(name, `got ${q(suffix)}, expected ${code}`);

  console.log("\n--- D-20: query parameters cannot re-target the connection ---\n");

  for (const [label, suffix] of [
    ["?host", "?host=127.0.0.1"],
    ["?hostaddr", "?hostaddr=127.0.0.1"],
    ["?port", "?port=6543"],
    ["?dbname", "?dbname=template1"],
    ["?database", "?database=template1"],
    ["?user", "?user=attacker"],
    ["?service", "?service=attacker"],
    ["?passfile", "?passfile=/tmp/x"],
    ["?servicefile", "?servicefile=/tmp/x"],
    ["unix socket ?host=%2Ftmp", "?host=%2Ftmp"],
    ["UPPERCASE ?HOST", "?HOST=127.0.0.1"],
    ["percent-encoded name", "?%68ost=127.0.0.1"],
    ["duplicate ?host", "?host=a&host=b"],
    ["empty routing value", "?host="],
    ["?options", "?options=-c%20x%3Dy"],
    ["?target_session_attrs", "?target_session_attrs=any"],
    ["TLS param + routing param", "?sslmode=require&host=127.0.0.1"],
  ])
    refuses(`D20-${label} is refused`, suffix, "KLUY-DEPLOY-QUERY-ROUTING-FORBIDDEN");

  refuses(
    "D20-unknown parameter is refused (allowlist, not blacklist)",
    "?nonsense=1",
    "KLUY-DEPLOY-QUERY-UNKNOWN",
  );
  refuses("D20-empty parameter name is refused", "?=1", "KLUY-DEPLOY-QUERY-MALFORMED");

  // TLS parameters survive — deliberately. H-2 decides what they must be.
  for (const p of ["sslmode=require", "sslrootcert=/tmp/ca.pem", "channel_binding=require"]) {
    if (q(`?${p}`) === "ALLOWED")
      ok(`D20-TLS parameter '${p.split("=")[0]}' is allowed through for H-2 to govern`);
    else bad(`D20-TLS parameter '${p}' allowed`, q(`?${p}`));
  }

  // The canonical target is what callers connect with.
  const t = assertHostedDevTarget({ dbUrl: `${D20}?sslmode=require`, environment: "development" });
  if (
    t.connectionConfig.host === POOLER &&
    t.connectionConfig.port === 5432 &&
    t.connectionConfig.database === "postgres"
  )
    ok("D20-connectionConfig carries the VALIDATED host, port and database");
  else bad("D20-connectionConfig is canonical", JSON.stringify(t.connectionConfig));
  if (
    t.canonicalConnectionString.startsWith(
      `postgresql://postgres.${ALLOWED_HOSTED_DEV.projectRef}:`,
    ) &&
    t.canonicalConnectionString.includes(`@${POOLER}:5432/postgres`) &&
    t.canonicalConnectionString.endsWith("?sslmode=require")
  )
    ok("D20-canonicalConnectionString is rebuilt from validated fields + allowed TLS params");
  else bad("D20-canonical DSN rebuilt", "shape is wrong");

  // A secret must not fall out of a log line.
  const shown = `${JSON.stringify(t)}${inspect(t)}`;
  if (!shown.includes("pw")) ok("D20-the password is redacted in JSON and inspect output");
  else bad("D20-password redacted", "the password appears when the target is logged");

  // canonicalHostedConnection applies the same policy without asserting an
  // environment — that is what lets the D-19 consumers get D-20 protection
  // without this pass touching environment policy.
  try {
    canonicalHostedConnection(`${D20}?host=127.0.0.1`);
    bad("D20-canonicalHostedConnection refuses routing params", "it was ALLOWED");
  } catch (error) {
    if (error.code === "KLUY-DEPLOY-QUERY-ROUTING-FORBIDDEN")
      ok("D20-canonicalHostedConnection applies the same query policy");
    else bad("D20-canonicalHostedConnection query policy", error.code);
  }
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
