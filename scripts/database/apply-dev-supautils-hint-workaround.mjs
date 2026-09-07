#!/usr/bin/env node
/**
 * DEVELOPMENT PLATFORM REMEDIATION — not a KitLuy authorization change.
 *
 * Authority: SECOND independent Store Hub credential-path review, 2026-08-27,
 * finding R2-2; owner remediation instruction 2026-08-27, option B.
 *
 * ===========================================================================
 * THE PLATFORM BUG
 * ===========================================================================
 * On `public.ecr.aws/supabase/postgres:17.6.1.106`, a permission-denied
 * function call in schema `kitluy_devices` made as `service_role` SIGSEGVs the
 * backend and restarts the whole cluster. The reviewer measured 33 of them.
 * Reproduced here before any change: one denied call terminated the connection
 * and left the database "not accepting connections" for several seconds.
 *
 * That is not a KitLuy authorization defect — the denial is correct and must
 * stay — but it destroys test reliability, because every concurrent suite then
 * fails with "the database system is in recovery mode", and those failures look
 * like product bugs.
 *
 * ===========================================================================
 * WHY THIS PARTICULAR CHANGE, AND WHY IT IS SAFE
 * ===========================================================================
 * The crash is in supautils' permission-hint path. `supautils.hint_roles` is
 * described by the extension itself as:
 *
 *     "Comma-separated list of roles that receive enhanced permission hints"
 *
 * It decides the TEXT OF AN ERROR MESSAGE. It grants nothing, denies nothing,
 * and is not consulted by any access check. Emptying it removes a hint sentence
 * from local development errors, and nothing else.
 *
 * It is emptied rather than trimmed: removing `service_role` alone still left
 * two SIGSEGVs per full registry run, following denials raised under `anon` and
 * `authenticated`. The bug is in the hint path, not in one role.
 *
 * What protects `service_role` from being modified is a DIFFERENT setting,
 * `supautils.reserved_roles`, which still lists `service_role*`. This script
 * does not touch it, and asserts afterwards that it is unchanged.
 *
 * Option A — upgrading supautils — was preferred by the instruction and is NOT
 * taken here: it means replacing the container image, which re-initialises or
 * at minimum restarts the development database that currently holds every piece
 * of remediation evidence, and it is an infrastructure change this session is
 * not authorised to make. It remains the correct long-term fix and is recorded
 * as such.
 *
 * ===========================================================================
 * SCOPE
 * ===========================================================================
 * LOCAL DEVELOPMENT ONLY. `supautils.hint_roles` is `sighup`, so this needs a
 * config reload rather than a restart, and nothing is lost.
 *
 * It does NOT survive `supabase stop` + recreate, because the file lives inside
 * the container and is written by the CLI. Re-run it after recreating the
 * container. Hosted development needs the same change applied by whoever
 * administers that project; this script deliberately refuses to touch anything
 * but a local container.
 *
 * Pilot and production assumptions are unchanged.
 */
import { execFileSync } from "node:child_process";

const CONTAINER = process.env.KITLUY_DEV_DB_CONTAINER ?? "supabase_db_kitluy-repo17";
const CONF = "/etc/postgresql-custom/supautils.conf";

function inContainer(script) {
  return execFileSync("docker", ["exec", CONTAINER, "bash", "-lc", script], {
    encoding: "utf8",
  }).trim();
}

let before;
try {
  before = inContainer(`grep '^supautils.hint_roles' ${CONF}`);
} catch {
  // The thrown value is deliberately not shown: it is a docker/grep exit, and
  // the actionable sentence is the one below, not the shell's.
  console.error(
    `Cannot read ${CONF} in container "${CONTAINER}".\n` +
      "Is the local development database running? Override the name with " +
      "$KITLUY_DEV_DB_CONTAINER.",
  );
  process.exit(1);
}

// Emptied entirely, not merely trimmed of `service_role`.
//
// The first version of this script removed `service_role` alone, because that is
// the role finding R2-2 named. Measured afterwards: the full registry suite
// still produced two SIGSEGVs per run, and the crashes followed permission
// denials raised under `anon` and `authenticated` — which were still listed.
//
// The bug is in the hint path itself and is not specific to one role, so the
// list is emptied. It costs a sentence of error-message help in local
// development and nothing else.
if (/^supautils\.hint_roles\s*=\s*''\s*$/.test(before.trim())) {
  console.log(`[supautils-workaround] already applied: ${before.trim()}`);
  process.exit(0);
}

// Keep a copy of the original, so the change is reversible by hand.
inContainer(`cp -n ${CONF} ${CONF}.kitluy-backup || true`);
inContainer(`sed -i "s/^supautils.hint_roles = .*/supautils.hint_roles = ''/" ${CONF}`);

const after = inContainer(`grep '^supautils.hint_roles' ${CONF}`);
if (/'[^']+'/.test(after)) {
  console.error(`[supautils-workaround] FAILED — the setting still lists roles: ${after}`);
  process.exit(1);
}

// `sighup`: a reload is enough, and nothing in flight is disturbed.
inContainer(`psql -U postgres -tAc 'select pg_reload_conf()' >/dev/null`);
const live = inContainer(`psql -U postgres -tAc 'show supautils.hint_roles'`);
const reserved = inContainer(`psql -U postgres -tAc 'show supautils.reserved_roles'`);

if (live.trim() !== "") {
  console.error("[supautils-workaround] FAILED — reload did not take effect");
  process.exit(1);
}
// The setting that actually protects service_role must be untouched.
if (!reserved.includes("service_role")) {
  console.error(
    "[supautils-workaround] REFUSING TO CONTINUE — supautils.reserved_roles no longer " +
      "protects service_role. That is a real security property and this script must not " +
      "have changed it. Restore " +
      CONF +
      ".kitluy-backup and investigate.",
  );
  process.exit(1);
}

console.log(`[supautils-workaround] before: ${before.trim()}`);
console.log(`[supautils-workaround] after : supautils.hint_roles = '${live}'`);
console.log("[supautils-workaround] reserved_roles still protects service_role: yes");
console.log("[supautils-workaround] DEVELOPMENT platform remediation applied (R2-2).");
