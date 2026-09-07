#!/usr/bin/env node
/**
 * Install the development trust anchors into the database.
 *
 *   node scripts/pki/pin-dev-trust-anchors.mjs                       # local
 *   node scripts/pki/pin-dev-trust-anchors.mjs --hosted-development  # hosted dev
 *
 * Authority: independent credential-path review 2026-08-26, finding C-1;
 * owner remediation Phase 1; owner instruction 2026-08-26 (hosted-development
 * trust-anchor bootstrap); KLD-2026-07-28-002 (BLK-005) — development only.
 *
 * ===========================================================================
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 * ===========================================================================
 * `scripts/verification/assert-no-dev-pki.mjs` refuses to let development CA
 * subjects or fingerprints appear anywhere in the repository or in a device
 * image, and it is right to. A migration that hardcoded the pin would put the
 * development root's fingerprint into version control and break that guard for
 * a good reason.
 *
 * So the anchors are installed out of band, from `$KITLUY_DEV_PKI_DIR`, by an
 * operator. `register_development_trust_anchor_v1` is granted to NO service
 * identity — only the schema owner can reach it — because pinning a trust root
 * is an administrative act.
 *
 * Re-running this is safe: an identical certificate returns ALREADY_PINNED. A
 * DIFFERENT certificate for a role is REFUSED, not updated. Re-pointing a trust
 * anchor is the single most valuable write in this schema and it does not
 * happen by accident.
 *
 * ===========================================================================
 * HOSTED DEVELOPMENT IS OPT-IN, AND NARROW
 * ===========================================================================
 * Default behaviour is unchanged: local only, and a hosted DSN in
 * KITLUY_DEV_DB_URL is REFUSED rather than accepted. Hosted requires all of:
 *
 *   1. the explicit `--hosted-development` flag
 *   2. KITLUY_HOSTED_DEV_DB_URL (never KITLUY_DEV_DB_URL)
 *   3. the allowlist in scripts/database/hosted-dev-target.mjs — project
 *      gjgbnkhuwlwhngbtrgts and environment `development`, nothing else
 *   4. the approved digests supplied out of band, which this script verifies
 *      against the certificate bytes it actually read
 *
 * WHY HOSTED `postgres` CAN REACH THE GOVERNED DOOR, proven from the catalog
 * rather than assumed from a role name:
 *
 *   register_development_trust_anchor_v1  owner=postgres  prosecdef=t
 *     proacl = postgres=X/postgres        -> only the owner may EXECUTE
 *   pki_pinned_trust_anchors              owner=postgres
 *     relrowsecurity=t  relforcerowsecurity=t
 *     relacl = postgres=arwdDxtm/postgres, kitluy_credential_issuer=r/postgres
 *     policies: ONE, SELECT only, for kitluy_credential_issuer
 *
 * SECURITY DEFINER runs the body as `postgres`, which holds INSERT in the ACL.
 * FORCE RLS would normally apply to the owner too and there is no INSERT
 * policy — so the write survives only because `postgres` carries
 * `rolbypassrls = t`. That attribute, not superuser status, is what makes this
 * work: `postgres` is `rolsuper = f` on BOTH the local container and the hosted
 * project, and the local pin demonstrably succeeds. The migration's comment
 * saying "superuser only" describes the intent, not the mechanism.
 *
 * Nothing here grants anything. service_role, anon and authenticated hold no
 * EXECUTE on the door and no privilege on the table, and this script does not
 * change that — it only calls a door that already exists.
 */
import pg from "pg";

import {
  ANCHORS,
  TrustAnchorRefusal,
  loadAnchorMaterial,
  redact,
  requireExpectedDigests,
  resolveTarget,
} from "./trust-anchor-bootstrap.mjs";

const argv = process.argv.slice(2);
const env = process.env;
const DIR = env.KITLUY_DEV_PKI_DIR?.trim() ?? "";

/** Every line out of this process goes through here. */
function say(text) {
  console.log(redact(text, [env.KITLUY_HOSTED_DEV_DB_URL, env.KITLUY_DEV_DB_URL]));
}
function die(text, code = 1) {
  console.error(redact(text, [env.KITLUY_HOSTED_DEV_DB_URL, env.KITLUY_DEV_DB_URL]));
  process.exit(code);
}

if (DIR === "") die("KITLUY_DEV_PKI_DIR is not set; nothing to pin.");

let target;
try {
  target = resolveTarget({ argv, env });
  requireExpectedDigests({ mode: target.mode, env });
} catch (error) {
  if (error instanceof TrustAnchorRefusal) die(`REFUSED: ${error.message}\n  code: ${error.code}`);
  throw error;
}

// The target is named, never the connection string.
say(
  target.mode === "hosted-development"
    ? `[trust-anchors] target ${target.name} (${target.projectRef}) · env=${target.environment} · HOSTED`
    : `[trust-anchors] target LOCAL development database · env=${target.environment}`,
);

// Read and verify ALL material BEFORE opening a connection. A run that is going
// to refuse on a fingerprint should never have dialled the database at all.
const material = [];
try {
  for (const anchor of ANCHORS) {
    const loaded = loadAnchorMaterial({
      dir: DIR,
      anchor,
      expectedSha256: env[anchor.expectedEnv],
    });
    material.push({ anchor, ...loaded });
  }
} catch (error) {
  if (error instanceof TrustAnchorRefusal) die(`REFUSED: ${error.message}\n  code: ${error.code}`);
  die(`REFUSED: could not read the trust material.\n  ${String(error?.message ?? error)}`);
}

// D-20: the VALIDATED connection, never a raw string that could carry
// `?host=`/`?port=` overrides pg would re-read after validation.
const client = new pg.Client({ ...target.connectionConfig });
try {
  await client.connect();
} catch (error) {
  // `pg` connection failures can carry host and user detail. Redacted, and the
  // DSN is stripped by shape as well as by value.
  die(
    `REFUSED: could not connect to the ${target.mode} target.\n  ${String(error?.message ?? error)}`,
  );
}

let failed = false;
try {
  for (const { anchor, pem, sha256 } of material) {
    const { rows } = await client.query(
      `select kitluy_devices.register_development_trust_anchor_v1(
                'development', $1::text, $2::text, $3::text) as result`,
      [anchor.role, pem, `pin-dev-trust-anchors/${env.USER ?? "operator"}`],
    );
    const result = rows[0].result;

    // The door computes the digest from the bytes it was given and cannot be
    // told one. If what it returns is not what we computed, the two disagree
    // about what was just pinned, and that is a stop.
    if (String(result.certificate_sha256) !== sha256) {
      failed = true;
      say(
        `${anchor.role.padEnd(28)} MISMATCH        the database computed a different digest than this script did`,
      );
      break;
    }

    // The digest is printed only as a short prefix: enough for an operator to
    // confirm two machines agree, not enough to become a committed pin.
    say(
      `${anchor.role.padEnd(28)} ${String(result.outcome).padEnd(15)} sha256:${sha256.slice(0, 12)}…`,
    );
  }
} catch (error) {
  failed = true;
  die(`REFUSED: the governed door refused.\n  ${String(error?.message ?? error)}`);
} finally {
  await client.end();
}

if (failed) process.exit(1);
say(`[trust-anchors] OK — ${ANCHORS.length} anchor(s) verified against the approved digests.`);
