/**
 * `pnpm dev:seed:hosted-scope` — the ONE Tenant/Store/Location a Store Hub can
 * pair into, on the hosted DEVELOPMENT project.
 *
 * ===========================================================================
 * WHY THIS IS NOT `pnpm db:seed`
 * ===========================================================================
 * `supabase/seed/dev-fixtures.sql` is the canonical development seed and it is
 * LOCAL-ONLY by construction: its own guard refuses to run unless the caller
 * asserts `kitluy.environment = 'local'`, and `db-exec.mjs` is the only thing
 * that asserts it. Running the full seed against a hosted project would mean
 * making that assertion falsely, which is exactly the kind of lie the guard
 * exists to prevent.
 *
 * So this does not run that seed. It inserts the SMALLEST set of rows that makes
 * pairing possible — one Tenant, one Digital Store, one Location — reusing the
 * canonical fixture IDs and values verbatim so the hosted project and a local
 * stack describe the same demo shop rather than two that quietly differ.
 *
 * ===========================================================================
 * WHY IT IS NEEDED AT ALL
 * ===========================================================================
 * `open_hub_pairing_session_v1` names a Digital Store and a Location. The hosted
 * development project had enrollment fixtures (station, hardware profiles) but
 * ZERO Stores, so a Hub could enroll and then had nothing to pair into — the
 * Partner Portal would show an empty shop list and the door would refuse with
 * `KLUY-HUBSESSION-SCOPE-UNKNOWN`.
 *
 * Every statement is `on conflict do nothing`, so re-running changes nothing.
 * It refuses any target that is not the allowlisted development project.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { ALLOWED_HOSTED_DEV, deriveProjectRef } from "../database/hosted-dev-target.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CONFIG_DIR = resolve(REPO, "..", "..", "local-config", "het-kitluy-project");

const die = (message) => {
  process.stderr.write(`\nREFUSED: ${message}\n\n`);
  process.exit(2);
};

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

const ref = deriveProjectRef(dsn);
if (ref !== ALLOWED_HOSTED_DEV.projectRef) {
  die(
    `this seeds development fixtures and will only write to ${ALLOWED_HOSTED_DEV.projectRef}.\n` +
      `  resolved project: ${ref ?? "(could not be derived)"}`,
  );
}

// Canonical fixture identities, copied from `supabase/seed/dev-fixtures.sql`.
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";

const client = new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 15000 });
await client.connect();

try {
  await client.query("begin");

  await client.query(
    `insert into kitluy_core.tenants (id, tenant_code, legal_name, display_name, status, default_locale)
     values ($1, 'DEMO-KH-001', 'ក្រុមហ៊ុន បោកគក់គំរូ ខេអិល', 'KitLuy Demo Laundry Partner', 'ACTIVE', 'km-KH')
     on conflict (id) do nothing`,
    [TENANT],
  );

  await client.query(
    `insert into kitluy_core.digital_stores
       (id, tenant_id, store_code, name, primary_vertical_code, status,
        default_locale, default_currency_code, timezone)
     values ($1, $2, 'DEMO-LAUNDRY-001', 'KitLuy Demo Laundry', 'LAUNDRY', 'ACTIVE_HYBRID',
             'km-KH', 'KHR', 'Asia/Phnom_Penh')
     on conflict (id) do nothing`,
    [STORE, TENANT],
  );

  await client.query(
    `insert into kitluy_core.store_locations
       (id, tenant_id, digital_store_id, location_code, name, address_line1, city,
        country_code, operating_status, hub_required)
     values ($1, $2, $3, 'DEMO-PP-01', 'Demo Phnom Penh Branch 1',
             'No. 1, Fictional Street 100', 'Phnom Penh', 'KH', 'ACTIVE', true)
     on conflict (id) do nothing`,
    [LOCATION, TENANT, STORE],
  );

  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  die(
    `could not seed the scope fixtures.\n  ${error instanceof Error ? error.message : String(error)}`,
  );
}

const { rows } = await client.query(
  `select ds.store_code || ' — ' || ds.name as store,
          sl.location_code || ' — ' || sl.name as location
     from kitluy_core.digital_stores ds
     join kitluy_core.store_locations sl on sl.digital_store_id = ds.id
    where ds.id = $1`,
  [STORE],
);
await client.end();

process.stdout.write(
  `\n  ✓ ${ALLOWED_HOSTED_DEV.name} can now be paired into:\n` +
    rows.map((r) => `      ${r.store}  ·  ${r.location}\n`).join("") +
    "\n",
);
