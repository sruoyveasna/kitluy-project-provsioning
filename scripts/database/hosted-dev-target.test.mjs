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
import {
  ALLOWED_HOSTED_DEV,
  HostedTargetRefusal,
  assertHostedDevTarget,
  assertNonDestructiveHostedCommand,
  deriveProjectRef,
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
const ALLOWED_POOLER = `postgresql://postgres.${ALLOWED_HOSTED_DEV.projectRef}:x@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;

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
  "KLUY-DEPLOY-REF-NOT-ALLOWED",
);
expectRefused(
  "the same supabase.co hostname with a different project is refused",
  {
    dbUrl: "postgresql://postgres:x@db.aaaaaaaaaaaaaaaaaaaa.supabase.co:5432/postgres",
    environment: "development",
  },
  "KLUY-DEPLOY-REF-NOT-ALLOWED",
);
expectRefused(
  "a pooler connection for a different project is refused",
  {
    dbUrl:
      "postgresql://postgres.bbaxhhuoyboirxgdarsm:x@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
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
  "KLUY-DEPLOY-REF-UNRESOLVABLE",
);
expectRefused(
  "a missing database URL is refused",
  { environment: "development" },
  "KLUY-DEPLOY-NO-TARGET",
);
expectRefused(
  "a malformed URL is refused",
  { dbUrl: "not-a-url", environment: "development" },
  "KLUY-DEPLOY-REF-UNRESOLVABLE",
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

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
