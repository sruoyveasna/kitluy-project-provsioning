/**
 * `pnpm dev:seed:hosted-partner` — a Partner staff identity for the hosted
 * DEVELOPMENT project, scoped to the one demo Store.
 *
 * ===========================================================================
 * WHY A SEPARATE USER FROM THE ADMIN
 * ===========================================================================
 * The hosted project had exactly one auth user, holding `HET_PLATFORM_ADMIN`
 * scoped to `platform`. That identity deliberately does NOT satisfy the partner
 * check: `current_digital_store_ids()` only returns stores for assignments whose
 * `scope_type = 'digital_store'`, so an admin sees none and the pairing route
 * refuses — which is correct, and is the boundary worth keeping testable.
 *
 * Granting the admin a second role would have been faster and would have made
 * every future test of that boundary meaningless: a call that succeeded could no
 * longer be attributed to the grant that allowed it. So this creates a distinct
 * Partner identity, which is also what a real shop looks like.
 *
 * ===========================================================================
 * WHAT IT GRANTS, AND HOW NARROWLY
 * ===========================================================================
 * `DIGITAL_STORE_STAFF`, scoped to ONE Digital Store by id. The permission it
 * carries — `fleet.hub_pairing_code.issue` — is classed CRITICAL, so the scope is
 * a single store rather than a tenant: a tenant-scoped assignment would let this
 * identity open pairing sessions for every shop the tenant ever gains.
 *
 * ===========================================================================
 * THE PASSWORD
 * ===========================================================================
 * Generated here, written ONLY to the credentials file outside the repository
 * (CLAUDE.md: credentials never live in the tree), and never printed. Re-running
 * does not rotate it — an existing user is left alone, so a password already in
 * use keeps working.
 *
 * Development only. It refuses any project that is not the allowlisted one.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  ALLOWED_HOSTED_DEV,
  HostedTargetRefusal,
  assertHostedDevApiTarget,
  assertHostedDevTarget,
} from "../database/hosted-dev-target.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_DIR = resolve(REPO, "..", "..", "local-config", "het-kitluy-project");
const CONFIG_FILE = resolve(CONFIG_DIR, "supabase.env.local");

const die = (message) => {
  process.stderr.write(`\nREFUSED: ${message}\n\n`);
  process.exit(2);
};

if (!existsSync(CONFIG_FILE)) die(`no credentials file at ${CONFIG_FILE}`);
const config = readFileSync(CONFIG_FILE, "utf8");
const read = (name) => new RegExp(`^${name}=(.*)$`, "m").exec(config)?.[1]?.trim() ?? "";

const projectRef = read("KITLUY_SUPABASE_PROJECT_REF");
const supabaseUrl = read("KITLUY_SUPABASE_URL");
const serviceRoleKey = read("KITLUY_SUPABASE_SERVICE_ROLE_KEY");
const dbPassword = read("KITLUY_SUPABASE_DB_PASSWORD");
if (projectRef === "" || supabaseUrl === "" || serviceRoleKey === "" || dbPassword === "") {
  die("the credentials file is missing one of PROJECT_REF, URL, SERVICE_ROLE_KEY or DB_PASSWORD");
}

// =============================================================================
// TARGET VALIDATION — BOTH DOORS, BEFORE ANY NETWORK I/O (finding D-18)
// =============================================================================
// This script writes to TWO destinations, and they used to be guarded very
// differently:
//
//   1. a PostgreSQL DSN, checked only with `deriveProjectRef` — which proved
//      the project reference but never the ENVIRONMENT, so nothing here refused
//      pilot, staging or production;
//   2. the Supabase Auth Admin API over HTTPS, which was NOT CHECKED AT ALL and
//      is the FIRST network call the script makes. It carries the SERVICE-ROLE
//      KEY in both `apikey` and `Authorization`, so a wrong `KITLUY_SUPABASE_URL`
//      handed full database-bypass authority to whatever host it named.
//
// Both are now asserted through the ONE central guard before anything is dialled.
// The environment is READ, never defaulted: an absent KITLUY_ENV refuses here
// rather than resolving to the single value that is allowed to proceed.
const environment = process.env.KITLUY_ENV?.trim() ?? "";
if (environment === "") {
  die(
    "KITLUY_ENV is not set. This script writes to a hosted project and will not\n" +
      "  assume an environment. Run it as:  KITLUY_ENV=development pnpm dev:seed:hosted-partner",
  );
}

const dsn = `postgresql://postgres.${projectRef}:${encodeURIComponent(dbPassword)}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;

let apiTarget;
let sqlTarget;
try {
  // The SQL door. Full canonical contract: scheme, exact host, session-mode
  // port, database, username and project reference.
  sqlTarget = assertHostedDevTarget({ dbUrl: dsn, environment, declaredProjectRef: projectRef });
  // The API door. Validated as an ORIGIN, because that is what it is — and the
  // returned origin is what the requests below are built from, so nothing the
  // parser normalised away can be smuggled back in by string concatenation.
  apiTarget = assertHostedDevApiTarget({
    apiUrl: supabaseUrl,
    environment,
    declaredProjectRef: projectRef,
  });
} catch (error) {
  // `die()` writes its own "REFUSED:" prefix and the guard's message carries
  // one too; stripped so an operator does not read "REFUSED: REFUSED:".
  if (error instanceof HostedTargetRefusal)
    die(`${String(error.message).replace(/^REFUSED:\s*/, "")}\n  code: ${error.code}`);
  throw error;
}

/** The VALIDATED origin. `supabaseUrl` is never used to build a request again. */
const apiOrigin = apiTarget.origin;

// Canonical fixture identities, matching `seed-hosted-dev-scope.mjs`.
const STORE = "00000000-0000-4000-8000-000000000015";
const DIGITAL_STORE_STAFF = "00000000-0000-4000-8000-000000000037";
const PARTNER_EMAIL = read("KITLUY_DEV_PARTNER_EMAIL") || "partner.dev@kitluy.local";

/** Supabase Auth Admin API — the supported way to create a user with a usable password. */
async function findOrCreateUser() {
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  const listed = await fetch(`${apiOrigin}/auth/v1/admin/users?page=1&per_page=200`, { headers });
  if (!listed.ok) die(`could not list auth users (${listed.status})`);
  const { users } = await listed.json();
  const existing = users?.find((u) => u.email === PARTNER_EMAIL);
  if (existing !== undefined) {
    return { id: existing.id, created: false, password: null };
  }

  // 24 bytes of CSPRNG, base64url. This is a login credential for a development
  // control surface, so it is not a memorable string.
  const password = randomBytes(24).toString("base64url");
  const created = await fetch(`${apiOrigin}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: PARTNER_EMAIL, password, email_confirm: true }),
  });
  if (!created.ok) {
    die(`could not create ${PARTNER_EMAIL} (${created.status}): ${await created.text()}`);
  }
  const user = await created.json();
  return { id: user.id, created: true, password };
}

const user = await findOrCreateUser();

// D-20: the VALIDATED components, never the original string.
const client = new pg.Client({ ...sqlTarget.connectionConfig, connectionTimeoutMillis: 15000 });
await client.connect();
try {
  await client.query("begin");

  // The Store must exist first, or the scope would point at nothing.
  const { rows: storeRows } = await client.query(
    `select store_code from kitluy_core.digital_stores where id = $1::uuid`,
    [STORE],
  );
  if (storeRows.length === 0) {
    die("the demo Store does not exist — run `pnpm dev:seed:hosted-scope` first");
  }

  // Idempotent: one ACTIVE assignment of this template to this user.
  const { rows: assignmentRows } = await client.query(
    `select id from kitluy_auth.role_assignments
      where subject_type = 'user' and subject_id = $1::uuid
        and role_template_id = $2::uuid and status = 'ACTIVE'`,
    [user.id, DIGITAL_STORE_STAFF],
  );

  let assignmentId = assignmentRows[0]?.id;
  if (assignmentId === undefined) {
    const { rows } = await client.query(
      `insert into kitluy_auth.role_assignments
         (subject_type, subject_id, role_template_id, status, valid_from, granted_by)
       values ('user', $1::uuid, $2::uuid, 'ACTIVE', now(), $1::uuid)
       returning id`,
      [user.id, DIGITAL_STORE_STAFF],
    );
    assignmentId = rows[0].id;
  }

  // Scoped to ONE store by id. `current_digital_store_ids()` returns exactly the
  // stores named by `digital_store` scopes when any exist, so this is what makes
  // the identity a Partner for this shop and nothing else.
  await client.query(
    `insert into kitluy_auth.assignment_scopes
       (role_assignment_id, scope_type, scope_id, environment, include_descendants)
     select $1::uuid, 'digital_store', $2::uuid, 'all', false
      where not exists (
        select 1 from kitluy_auth.assignment_scopes
         where role_assignment_id = $1::uuid
           and scope_type = 'digital_store' and scope_id = $2::uuid)`,
    [assignmentId, STORE],
  );

  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  die(
    `could not grant the partner role.\n  ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  await client.end().catch(() => undefined);
}

if (user.created) {
  appendFileSync(
    CONFIG_FILE,
    `\n# Partner staff identity for ${ALLOWED_HOSTED_DEV.name}, created ${new Date().toISOString().slice(0, 10)}\n` +
      `KITLUY_DEV_PARTNER_EMAIL=${PARTNER_EMAIL}\n` +
      `KITLUY_DEV_PARTNER_PASSWORD=${user.password}\n`,
    { mode: 0o600 },
  );
}

process.stdout.write(
  `\n  ✓ Partner identity ready on ${ALLOWED_HOSTED_DEV.name}\n` +
    `      email : ${PARTNER_EMAIL}\n` +
    `      role  : DIGITAL_STORE_STAFF, scoped to DEMO-LAUNDRY-001 only\n` +
    (user.created
      ? `      password written to local-config/het-kitluy-project/supabase.env.local (not printed here)\n`
      : `      user already existed — password unchanged\n`) +
    "\n",
);
