#!/usr/bin/env node
/**
 * READ-ONLY verification of the hosted-development supautils posture.
 *
 *   KITLUY_HOSTED_DEV_DB_URL=… node scripts/database/verify-hosted-supautils.mjs
 *
 * Authority: owner instruction 2026-08-26 (section F); second Store Hub
 * credential-path review 2026-08-27, findings R2-2 / D-15.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 * On `public.ecr.aws/supabase/postgres:17.6.1.106`, a permission-denied
 * function call in schema `kitluy_devices` made as `service_role` SIGSEGVs the
 * backend and restarts the whole cluster. `supautils.hint_roles` decides the
 * TEXT OF AN ERROR MESSAGE and nothing else, and emptying it removes the crash.
 *
 * Hosted development was measured on 2026-08-26 with:
 *
 *     supautils.hint_roles = 'anon, authenticated, service_role'
 *     session_preload_libraries = 'supautils'
 *     version() = PostgreSQL 17.6 … gcc (GCC) 15.2.0     (identical to local)
 *     postgres: rolsuper=f, rolbypassrls=t                (identical to local)
 *
 * That is the unremediated shape. This script is what proves the platform
 * change landed, and it is DELIBERATELY read-only: it changes nothing, so it
 * can be run against hosted at any time, including before the change.
 *
 * ===========================================================================
 * WHAT IT REFUSES TO DO
 * ===========================================================================
 * It does NOT run the denied-function runtime probe. That probe
 * (`privilege-denial.security.test.ts`, 25 denied calls as `service_role`) is
 * the thing that crashes an unremediated cluster, and running it to find out
 * whether the cluster crashes is not a test, it is the outage.
 *
 * Authorization posture is therefore checked from the CATALOG, with
 * `has_function_privilege`, which resolves inheritance and makes no call. That
 * is the same technique groups 0198–0207 use in their own apply-time
 * assertions, and for the same reason.
 *
 * When this script reports HINT_ROLES_EMPTY, and only then, the runtime probe
 * becomes safe to run.
 *
 * It also refuses any target that is not the authorised hosted development
 * project, through `assertHostedDevTarget` in `hosted-dev-target.mjs`, before it
 * opens a socket. Being read-only against the DATABASE says nothing about what
 * it hands to the HOST; see the guard block below.
 */
import pg from "pg";

import { HostedTargetRefusal, assertHostedDevTarget } from "./hosted-dev-target.mjs";

const DSN = process.env.KITLUY_HOSTED_DEV_DB_URL?.trim() ?? "";

/**
 * The hosted `supautils.reserved_roles` value captured on 2026-08-26, before
 * any platform change. Compared byte-for-byte: the remediation must empty
 * `hint_roles` and leave this untouched, because THIS is the setting that
 * actually protects `service_role` from being modified. A platform change that
 * quietly trimmed it would be a privilege change wearing a bug fix's clothes.
 *
 * Not a secret and not credential material — it is a list of role names.
 */
const CAPTURED_RESERVED_ROLES =
  "supabase_admin, supabase_auth_admin, supabase_storage_admin, supabase_read_only_user, " +
  "supabase_realtime_admin, supabase_replication_admin, supabase_etl_admin, dashboard_user, " +
  "pgbouncer, service_role*, authenticator*, authenticated*, anon*, supabase_privileged_role";

/** Doors that must remain unreachable by the three public roles. */
const PUBLIC_ROLES = ["service_role", "anon", "authenticated"];
const GOVERNED_DOORS = [
  "kitluy_devices.register_development_trust_anchor_v1(text,text,text,text)",
  "kitluy_devices.record_operational_certificate_v1(uuid,text,text,text,text)",
];

const redact = (t) => String(t ?? "").replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "«REDACTED-DSN»");

let pass = 0;
let fail = 0;
const ok = (n, d) => {
  console.log(`  PASS  ${n}${d ? `\n        ${d}` : ""}`);
  pass += 1;
};
const bad = (n, d) => {
  console.log(`  FAIL  ${n}${d ? `\n        ${d}` : ""}`);
  fail += 1;
};
const info = (n, d) => console.log(`  INFO  ${n}${d ? `\n        ${d}` : ""}`);

if (DSN === "") {
  console.error("KITLUY_HOSTED_DEV_DB_URL is not set; refusing to guess a database.");
  process.exit(2);
}

// --- Guard the target BEFORE dialling anything -------------------------------
// Read-only is not the same as safe. This script hands the hosted credential to
// whatever host the DSN names, and PostgreSQL cleartext auth surrenders the
// password to any listener that answers the startup packet. An attacker-supplied
// KITLUY_HOSTED_DEV_DB_URL carrying only the approved project reference in its
// username was demonstrated to exfiltrate it (H-1 re-confirmation, 2026-08-27):
// the guard was correct, this consumer simply never called it.
//
// `assertHostedDevTarget` performs no I/O, so a refusal means nothing was
// dialled. Same governed path as `db-deploy-hosted-dev.mjs`.
//
// Exit 2, not 1: exit 1 from this script asserts HOSTED_SUPAUTILS_SAFE = FALSE,
// which is a measurement. A refused target measured nothing.
let target;
try {
  target = assertHostedDevTarget({
    dbUrl: DSN,
    environment: process.env.KITLUY_ENV ?? "development",
    declaredProjectRef: process.env.KITLUY_HOSTED_DEV_PROJECT_REF,
  });
} catch (error) {
  if (error instanceof HostedTargetRefusal) {
    console.error(`${redact(error.message)}\n  code: ${error.code}`);
    process.exit(2);
  }
  throw error;
}

console.log(
  `[supautils] target ${target.name} (${target.projectRef}) \u00b7 env=${target.environment}`,
);

// D-20: the VALIDATED target, never the original string. A `?host=`/`?port=`
// override in DSN would otherwise be re-read by pg and win over the authority
// section this guard just checked.
const client = new pg.Client({ ...target.connectionConfig });
try {
  await client.connect();
} catch (error) {
  console.error(redact(`could not connect: ${error?.message ?? error}`));
  process.exit(2);
}

console.log("\nHosted-development supautils posture — READ ONLY, no probe\n");

try {
  const { rows: settings } = await client.query(
    `select name, coalesce(setting,'') as setting, source, context, pending_restart
       from pg_settings
      where name in ('supautils.hint_roles','supautils.reserved_roles',
                     'session_preload_libraries','shared_preload_libraries')
      order by name`,
  );
  const get = (n) => settings.find((r) => r.name === n);

  // --- 1. hint_roles MUST be empty ------------------------------------------
  const hint = get("supautils.hint_roles");
  if (!hint) bad("supautils.hint_roles is readable", "the setting is not present");
  else if (hint.setting.trim() === "")
    ok(
      "HINT_ROLES_EMPTY — supautils.hint_roles is ''",
      `source=${hint.source} context=${hint.context}`,
    );
  else
    bad(
      "HINT_ROLES_EMPTY — supautils.hint_roles is ''",
      `still '${hint.setting}' (source=${hint.source}, context=${hint.context}). ` +
        "The platform change has NOT landed. Do NOT run the denied-function probe.",
    );

  // --- 2. reserved_roles must be byte-for-byte unchanged --------------------
  const reserved = get("supautils.reserved_roles");
  if (!reserved) bad("supautils.reserved_roles is readable", "the setting is not present");
  else if (reserved.setting === CAPTURED_RESERVED_ROLES)
    ok("reserved_roles is byte-for-byte unchanged from the 2026-08-26 capture");
  else
    bad(
      "reserved_roles is byte-for-byte unchanged from the 2026-08-26 capture",
      `CHANGED.\n        captured: ${CAPTURED_RESERVED_ROLES}\n        current : ${reserved.setting}`,
    );

  // --- 3. pending_restart -----------------------------------------------------
  const pending = settings.filter((r) => r.pending_restart === true).map((r) => r.name);
  if (pending.length === 0) ok("pending_restart = false for every setting read");
  else
    bad(
      "pending_restart = false for every setting read",
      `pending: ${pending.join(", ")} — the value read is not yet the value in force`,
    );

  // --- 4. context / loading, for the record ---------------------------------
  info("session_preload_libraries", get("session_preload_libraries")?.setting ?? "(unset)");
  const { rows: ver } = await client.query(`select version() as v`);
  info("server", ver[0].v);
  const { rows: who } = await client.query(
    `select current_user as u, rolsuper, rolbypassrls
       from pg_roles where rolname = current_user`,
  );
  info(
    "connected identity",
    `${who[0].u} rolsuper=${who[0].rolsuper} rolbypassrls=${who[0].rolbypassrls}`,
  );

  // --- 5. CATALOG authorization posture — no call is made -------------------
  for (const door of GOVERNED_DOORS) {
    const { rows: exists } = await client.query(
      `select to_regprocedure($1) is not null as present`,
      [door],
    );
    if (!exists[0].present) {
      info(`${door.split("(")[0]}`, "not present yet (its migration is not deployed)");
      continue;
    }
    for (const role of PUBLIC_ROLES) {
      const { rows } = await client.query(
        `select has_function_privilege($1, $2, 'execute') as can_execute`,
        [role, door],
      );
      if (rows[0].can_execute === false)
        ok(`${role} cannot EXECUTE ${door.split("(")[0]} (catalog, inheritance-resolved)`);
      else
        bad(
          `${role} cannot EXECUTE ${door.split("(")[0]}`,
          "it CAN — separation of duty is not real",
        );
    }
  }

  // --- 6. the anchor table, if it exists ------------------------------------
  const { rows: tbl } = await client.query(
    `select c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
            coalesce(array_to_string(c.relacl, ' '), '') as acl
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'kitluy_devices' and c.relname = 'pki_pinned_trust_anchors'`,
  );
  if (tbl.length === 0)
    info("pki_pinned_trust_anchors", "not present yet (group 0203 not deployed)");
  else {
    if (tbl[0].rls && tbl[0].force_rls) ok("pki_pinned_trust_anchors keeps RLS and FORCE RLS");
    else
      bad(
        "pki_pinned_trust_anchors keeps RLS and FORCE RLS",
        `rls=${tbl[0].rls} force=${tbl[0].force_rls}`,
      );
    const leaked = PUBLIC_ROLES.filter((r) => tbl[0].acl.includes(`${r}=`));
    if (leaked.length === 0)
      ok("pki_pinned_trust_anchors grants nothing to service_role/anon/authenticated");
    else
      bad(
        "pki_pinned_trust_anchors grants nothing to the public roles",
        `found: ${leaked.join(", ")}`,
      );
  }
} catch (error) {
  bad("verification completed", redact(error?.message ?? String(error)));
} finally {
  await client.end();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  console.log(
    "  HOSTED_SUPAUTILS_SAFE = FALSE — the denied-function runtime probe stays FORBIDDEN.\n",
  );
  process.exit(1);
}
console.log(
  "  HOSTED_SUPAUTILS_SAFE = TRUE — hint_roles is empty and reserved_roles is unchanged.\n" +
    "  The denied-function runtime probe (privilege-denial.security.test.ts) is now safe to run.\n",
);
