/**
 * STRUCTURAL: every script that can write to a hosted project must go through
 * the central target guard.
 *
 *   node scripts/database/hosted-write-consumers.test.mjs
 *
 * Authority: independent security review 2026-08-27, findings H-1 and D-18.
 *
 * ===========================================================================
 * WHY THIS TEST EXISTS
 * ===========================================================================
 * H-1 was fixed in `hosted-dev-target.mjs` and both named callers were proven
 * clean — and the fix was still incomplete, because a THIRD script
 * (`verify-hosted-supautils.mjs`) read the same connection string and dialled it
 * with no guard at all. A confirmer captured a cleartext password from it. D-18
 * was then the same story again with `seed-hosted-dev-partner.mjs`, which reached
 * the Supabase Auth Admin API — carrying the SERVICE-ROLE KEY — through a URL
 * nothing validated.
 *
 * Twice the guard was correct and the COVERAGE was not. A hand-maintained list
 * of callers would have been wrong both times, because the whole failure mode is
 * that somebody adds a consumer and nobody updates the list.
 *
 * So this test DISCOVERS consumers from disk. Any script that both
 *   (a) names a hosted credential or a hosted host, and
 *   (b) constructs a network client,
 * must call one of the central assertions. Adding a new hosted-writing script
 * without a guard fails this test by construction.
 *
 * It reads source text and performs NO I/O and no network access of any kind.
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import net from "node:net";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const SCAN_ROOTS = ["scripts"];

/** Naming a hosted credential or a hosted host makes a file hosted-capable. */
const HOSTED_MARKERS = [
  /KITLUY_HOSTED_DEV_DB_URL/,
  /KITLUY_SUPABASE_SERVICE_ROLE_KEY/,
  /KITLUY_SUPABASE_DB_PASSWORD/,
  /KITLUY_SUPABASE_URL/,
  /pooler\.supabase\.com/,
  /\.supabase\.co\b/,
];

/** Constructing any of these means it can reach the network. */
const CLIENT_MARKERS = [
  /new\s+pg\.Client/,
  /new\s+pg\.Pool/,
  /\bfetch\s*\(/,
  /https?\.request\s*\(/,
  /createClient\s*\(/,
];

/** The central assertions. One of these must be CALLED, not merely imported. */
const GUARD_CALLS = [/\bassertHostedDevTarget\s*\(/, /\bassertHostedDevApiTarget\s*\(/];

/**
 * A WEAKER but still central form: the project reference is checked against the
 * one allowlist via `deriveProjectRef`, which since H-1 validates scheme, exact
 * host, port, database and username. What it does NOT check is the ENVIRONMENT,
 * so a caller relying on it cannot refuse pilot, staging or production.
 *
 * Graded separately rather than lumped with "unguarded", because the difference
 * matters: an unguarded consumer can send credentials to an arbitrary machine,
 * a partial one cannot. Partial consumers are REPORTED as a finding and do not
 * fail this test, so that a genuinely unguarded consumer cannot hide among them.
 */
const PARTIAL_GUARD_CALLS = [/\bderiveProjectRef\s*\(/];

/**
 * Exempt by EXACT relative path, each with a stated reason. A path is exempt
 * only because of what it is, never because it happens to be inconvenient.
 */
const EXEMPT = new Map([
  ["scripts/database/hosted-dev-target.mjs", "the guard itself"],
  ["scripts/database/hosted-dev-target.test.mjs", "tests the guard; asserts refusals"],
  ["scripts/database/hosted-write-consumers.test.mjs", "this test"],
  [
    "scripts/database/db-exec.mjs",
    "LOCAL-ONLY by assertLocalTarget(); KL-INF-P1-037 keeps it off hosted entirely",
  ],
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".mjs") || entry.endsWith(".js")) out.push(full);
  }
  return out;
}

let pass = 0;
let fail = 0;
const ok = (n) => {
  console.log(`  PASS  ${n}`);
  pass += 1;
};
const bad = (n, d) => {
  console.log(`  FAIL  ${n}\n        ${d}`);
  fail += 1;
};

console.log("\nHosted-write consumers — structural coverage\n");

const files = SCAN_ROOTS.flatMap((r) => walk(join(REPO, r)));
const discovered = [];
for (const file of files) {
  const rel = relative(REPO, file).split("\\").join("/");
  const text = readFileSync(file, "utf8");
  // Comments describe the problem at length in these files; strip them so a
  // prose mention of `fetch(` or a credential name cannot be mistaken for code.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const hosted = HOSTED_MARKERS.some((re) => re.test(code));
  const client = CLIENT_MARKERS.some((re) => re.test(code));
  // A consumer may delegate its target check to a local module it imports
  // (pin-dev-trust-anchors.mjs does exactly that through
  // trust-anchor-bootstrap.mjs). Follow relative imports ONE level so the check
  // measures whether the assertion is reached, not where it is typed.
  //
  // The guard MODULE ITSELF is never followed: its source necessarily contains
  // `assertHostedDevTarget(` because that is where the function is declared, so
  // concatenating it would mark every importer as guarded and turn this test
  // into a machine for producing false negatives. Only INTERMEDIATE modules
  // count — a delegator has to actually call the assertion in its own body.
  let reachable = code;
  for (const m of code.matchAll(/from\s+"(\.[^"]+\.mjs)"/g)) {
    if (/hosted-dev-target\.mjs$/.test(m[1])) continue;
    try {
      reachable += "\n" + readFileSync(join(file, "..", m[1]), "utf8");
    } catch {
      /* an unresolvable import is not this test's business */
    }
  }
  if (hosted && client) discovered.push({ rel, code, reachable });
}

console.log(`  discovered ${discovered.length} hosted-capable consumer(s):`);
for (const d of discovered) console.log(`    - ${d.rel}${EXEMPT.has(d.rel) ? "  (exempt)" : ""}`);
console.log("");

if (discovered.length === 0) {
  bad(
    "discovery found at least one consumer",
    "the scanner matched nothing — it is broken, not the repo",
  );
}

const unguarded = [];
const partial = [];
for (const { rel, reachable } of discovered) {
  if (EXEMPT.has(rel)) {
    ok(`${rel} — exempt: ${EXEMPT.get(rel)}`);
    continue;
  }
  if (GUARD_CALLS.some((re) => re.test(reachable))) {
    ok(`${rel} reaches a central target assertion`);
  } else if (PARTIAL_GUARD_CALLS.some((re) => re.test(reachable))) {
    partial.push(rel);
    ok(`${rel} reaches PARTIAL central validation (deriveProjectRef; no environment assertion)`);
  } else {
    unguarded.push(rel);
    bad(
      `${rel} reaches a central target assertion`,
      "NO call to assertHostedDevTarget, assertHostedDevApiTarget or deriveProjectRef",
    );
  }
}

console.log(
  `\n  unguarded consumers: ${unguarded.length}${unguarded.length ? ` -> ${unguarded.join(", ")}` : ""}`,
);
if (partial.length > 0) {
  console.log(
    `  PARTIAL consumers (FINDING, out of scope for D-18): ${partial.length} -> ${partial.join(", ")}\n` +
      "    They validate the project against the central allowlist but assert NO environment,\n" +
      "    so neither can refuse pilot/staging/production. Scope this separately.",
  );
}

// =============================================================================
// D-20 BEHAVIOURAL: a validated target must be the target actually dialled.
// =============================================================================
//
// The structural checks above prove a consumer CALLS a guard. They cannot prove
// it then CONNECTS to what the guard approved — and that gap is exactly D-20:
// `pg` and libpq re-read `?host=`/`?port=` out of the connection string and let
// them win over the authority section. A confirmer captured a cleartext password
// through a DSN whose authority named the approved pooler.
//
// So each consumer is RUN, against a DSN whose authority is the approved pooler
// and whose query redirects to a listener we control. Nothing may reach it.
//
// WHAT THIS CHECK DOES AND DOES NOT PROVE. It exercises the WHOLE CHAIN, and the
// first link — the query-parameter refusal in `parseHostedTargetUrl` — is what
// stops these runs. Mutation-tested: reintroducing raw-DSN reuse in
// `verify-hosted-supautils.mjs` did NOT make this check fail, because validation
// already refuses the redirecting DSN before the client is built. The SECOND
// layer (never reconnecting from the original string) is therefore covered by
// the structural check below, which did catch that mutation. Both are kept: this
// one proves the outcome, that one proves the defence in depth.
{
  const CANARY = ["CANARY", "consumer", "probe", "d20"].join("-");
  const REF = "gjgbnkhuwlwhngbtrgts";
  const POOLER = "aws-0-ap-southeast-1.pooler.supabase.com";

  let connections = 0;
  const server = net.createServer((s) => {
    connections += 1;
    s.on("error", () => {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const evil = `postgresql://postgres.${REF}:${CANARY}@${POOLER}:5432/postgres?host=127.0.0.1&port=${port}`;

  const CONSUMERS = [
    [
      "verify-hosted-supautils",
      "scripts/database/verify-hosted-supautils.mjs",
      [],
      { KITLUY_HOSTED_DEV_DB_URL: evil },
    ],
    [
      "db-deploy-hosted-dev",
      "scripts/database/db-deploy-hosted-dev.mjs",
      ["--dry-run"],
      { KITLUY_HOSTED_DEV_DB_URL: evil, KITLUY_ENV: "development" },
    ],
    [
      "pin-dev-trust-anchors",
      "scripts/pki/pin-dev-trust-anchors.mjs",
      ["--hosted-development"],
      {
        KITLUY_HOSTED_DEV_DB_URL: evil,
        KITLUY_ENV: "development",
        KITLUY_DEV_PKI_DIR: process.env.KITLUY_DEV_PKI_DIR ?? "/nonexistent",
        KITLUY_DEV_ROOT_SHA256: "0".repeat(64),
        KITLUY_DEV_ISSUING_SHA256: "0".repeat(64),
      },
    ],
    [
      "seed-hosted-dev-scope",
      "scripts/development/seed-hosted-dev-scope.mjs",
      [],
      { KITLUY_HOSTED_DEV_DB_URL: evil },
    ],
    ["fleet-service", "scripts/development/fleet-service.mjs", [], { KITLUY_DEV_FLEET_DSN: evil }],
  ];

  for (const [label, script, args, env] of CONSUMERS) {
    const before = connections;
    const out = await new Promise((resolve) => {
      const child = spawn("node", [script, ...args], {
        cwd: REPO,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      child.on("close", () => {
        clearTimeout(timer);
        resolve(text);
      });
    });
    const dialed = connections - before;
    if (dialed === 0 && !out.includes(CANARY))
      ok(`D20-behaviour: ${label} never dials a query-redirected target  [connections=0]`);
    else
      bad(
        `D20-behaviour: ${label} never dials a query-redirected target`,
        dialed > 0
          ? `it connected ${dialed} time(s) to the listener`
          : "the canary leaked into output",
      );
  }
  await new Promise((r) => server.close(r));
}

// =============================================================================
// D-20 STRUCTURAL: no consumer may hand a raw DSN to a client after validating.
// =============================================================================
{
  const RAW_REUSE = [
    // `connectionString:` fed from anything that is not a canonical target.
    /new\s+pg\.(?:Client|Pool)\s*\(\s*\{[^}]*connectionString\s*:\s*(?!.*canonical)(?!.*connectionConfig)/s,
    // The hosted env var handed straight to a client or to a subprocess flag.
    /--db-url['"\s,\]]*\s*,?\s*dbUrl\b/,
  ];
  for (const { rel, code } of discovered) {
    if (EXEMPT.has(rel)) continue;
    const isLocalOnlyClient = /targetIsLocal\s*\?/.test(code); // fleet-service keeps a local branch
    const offending = RAW_REUSE.filter((re) => re.test(code));
    if (offending.length === 0 || isLocalOnlyClient)
      ok(`D20-structural: ${rel} does not reuse a raw DSN after validation`);
    else
      bad(
        `D20-structural: ${rel} does not reuse a raw DSN after validation`,
        "it constructs a client from a connection string that is not a canonical target",
      );
  }
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
