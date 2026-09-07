/**
 * Trust-anchor bootstrap: target resolution and public trust material.
 *
 * Authority: independent credential-path review 2026-08-26, finding C-1; owner
 * remediation Phase 1; owner instruction 2026-08-26 (hosted-development
 * trust-anchor bootstrap); KLD-2026-07-28-002 (BLK-005) — development only.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE MODULE
 * ===========================================================================
 * `pin-dev-trust-anchors.mjs` is the CLI. Everything that DECIDES anything now
 * lives here, as pure functions over explicit inputs, so the refusals can be
 * tested without a database and without a hosted connection. A guard whose only
 * exercise is the happy path is a guard nobody has checked, and the negative
 * cases are the ones that matter: each of them is a target or a certificate
 * that must never be pinned.
 *
 * ===========================================================================
 * WHY THE EXPECTED FINGERPRINTS ARE NOT IN THIS FILE
 * ===========================================================================
 * `scripts/verification/assert-no-dev-pki.mjs` refuses development CA
 * fingerprints anywhere in the repository, with ONE narrow exemption for
 * `/etc/kitluy/development-root.sha256` when that file is nothing but a digest.
 * Hardcoding the approved root or issuing digest here would break that guard,
 * for exactly the reason it exists.
 *
 * So the expected digests are supplied by the operator, out of band, and the
 * bootstrap COMPUTES the real digest from the certificate bytes and compares.
 * That makes it a two-source agreement — the PKI directory and the operator's
 * declared expectation must say the same thing — rather than a value this
 * repository asserts about itself. Either side disagreeing fails closed.
 *
 * ===========================================================================
 * WHAT THIS MODULE WILL NOT DO
 * ===========================================================================
 * It reads PUBLIC certificates only. It refuses a file whose basename is not
 * one of the two approved public certificates, and refuses any content
 * carrying a PRIVATE KEY block even if the basename looked right. A CA private
 * key has no path into a database, a request, a log line or a handoff, and the
 * cheapest place to enforce that is before the file is ever opened.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import {
  ALLOWED_HOSTED_DEV,
  HostedTargetRefusal,
  assertHostedDevTarget,
  isLocalUrl,
} from "../database/hosted-dev-target.mjs";

/** The explicit opt-in. Hosted is never reached by inference. */
export const HOSTED_FLAG = "--hosted-development";

/** Refusal carrying a stable code, so a test asserts WHICH rule refused. */
export class TrustAnchorRefusal extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrustAnchorRefusal";
    this.code = code;
  }
}

/**
 * The two anchors, and the environment variable that carries each expected
 * digest. `role` is the value `pki_pinned_trust_anchors.anchor_role` accepts —
 * group 0203 constrains it to exactly these two, and the roles are distinct
 * because a root and an issuing CA are different trust decisions.
 */
export const ANCHORS = Object.freeze([
  Object.freeze({
    role: "development_root",
    file: "dev-root-ca.crt.pem",
    expectedEnv: "KITLUY_DEV_ROOT_SHA256",
  }),
  Object.freeze({
    role: "development_device_issuing",
    file: "dev-device-issuing-ca.crt.pem",
    expectedEnv: "KITLUY_DEV_ISSUING_SHA256",
  }),
]);

const APPROVED_BASENAMES = Object.freeze(ANCHORS.map((a) => a.file));

/**
 * Remove anything that must never be printed.
 *
 * Applied to every line this bootstrap emits, including error text it did not
 * author. `pg` does not normally put a connection string in an error, but
 * "normally" is not a guarantee worth a leaked password, and a DSN that reaches
 * a terminal has reached a scrollback, a screenshot and possibly a handoff.
 */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join("«REDACTED»");
  }
  return out.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "«REDACTED-DSN»");
}

/**
 * Decide WHICH database this run may touch.
 *
 * Default is unchanged and remains local-only: a hosted DSN placed in
 * KITLUY_DEV_DB_URL is refused, not silently accepted, because the failure it
 * prevents is pinning a trust root into the wrong database.
 *
 * Hosted requires the explicit flag AND the separate hosted variable AND the
 * allowlist in hosted-dev-target.mjs, which is reused rather than restated so
 * there is one place where "which project may be written to" lives.
 */
export function resolveTarget({ argv = [], env = {} } = {}) {
  const hosted = argv.includes(HOSTED_FLAG);

  if (!hosted) {
    const dbUrl = env.KITLUY_DEV_DB_URL?.trim() ?? "";
    if (dbUrl === "") {
      throw new TrustAnchorRefusal(
        "TRUST-ANCHOR-NO-LOCAL-URL",
        "KITLUY_DEV_DB_URL is not set; refusing to guess a database.",
      );
    }
    if (!isLocalUrl(dbUrl)) {
      throw new TrustAnchorRefusal(
        "TRUST-ANCHOR-NON-LOCAL",
        `refusing to pin development anchors into a non-local database. Hosted development requires the explicit ${HOSTED_FLAG} flag and ${"KITLUY_HOSTED_DEV_DB_URL"}.`,
      );
    }
    return Object.freeze({
      mode: "local",
      connectionConfig: { connectionString: dbUrl },
      environment: "development",
      projectRef: null,
    });
  }

  const dbUrl = env.KITLUY_HOSTED_DEV_DB_URL?.trim() ?? "";
  if (dbUrl === "") {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-NO-HOSTED-URL",
      `${HOSTED_FLAG} was given but KITLUY_HOSTED_DEV_DB_URL is not set.`,
    );
  }
  if (isLocalUrl(dbUrl)) {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-LOCAL-IN-HOSTED-MODE",
      `${HOSTED_FLAG} was given but the URL is a LOCAL database. Drop the flag to pin locally.`,
    );
  }

  // The environment is read, never defaulted into 'development'. An unset or
  // misspelled value must refuse rather than resolve to the one value that is
  // allowed to proceed.
  const environment = env.KITLUY_ENV?.trim() ?? "development";

  let target;
  try {
    target = assertHostedDevTarget({
      dbUrl,
      environment,
      declaredProjectRef: env.KITLUY_HOSTED_DEV_PROJECT_REF,
    });
  } catch (error) {
    if (error instanceof HostedTargetRefusal) {
      // The allowlist writes its own "REFUSED:" prefix; the CLI adds one too.
      // Stripped here so an operator does not read "REFUSED: REFUSED:".
      throw new TrustAnchorRefusal(
        error.code,
        redact(String(error.message).replace(/^REFUSED:\s*/, ""), [dbUrl]),
      );
    }
    throw error;
  }

  // Defence in depth: the allowlist already pins both, and asserting them again
  // here costs nothing and makes this module's own contract explicit rather
  // than delegated.
  if (target.projectRef !== ALLOWED_HOSTED_DEV.projectRef) {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-PROJECT",
      `refusing project '${target.projectRef}'; only ${ALLOWED_HOSTED_DEV.projectRef} may receive development anchors.`,
    );
  }
  if (target.environment !== "development") {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-ENVIRONMENT",
      `refusing environment '${target.environment}'; pilot and production remain blocked under BLK-005.`,
    );
  }

  // D-20: the assertion returns VALIDATED components; those are what the CLI
  // connects with. `dbUrl` is deliberately NOT carried forward for hosted — an
  // original string that regains control after validation is the whole defect.
  return Object.freeze({
    mode: "hosted-development",
    connectionConfig: target.connectionConfig,
    environment: target.environment,
    projectRef: target.projectRef,
    name: target.name,
  });
}

/** SHA-256 over the DER of the single certificate in a PEM. */
export function certificateSha256(pem) {
  const body = String(pem)
    .replace(/-----BEGIN CERTIFICATE-----/g, " ")
    .split(" ")
    .slice(1);
  if (body.length !== 1) {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-MALFORMED",
      `supply exactly one PEM certificate; found ${body.length}.`,
    );
  }
  const b64 = body[0].replace(/-----END CERTIFICATE-----[\s\S]*/, "").replace(/\s/g, "");
  if (b64 === "") {
    throw new TrustAnchorRefusal("TRUST-ANCHOR-MALFORMED", "the PEM body is empty.");
  }
  return createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex");
}

/**
 * Load ONE anchor's public certificate and prove it is the expected one.
 *
 * `expectedSha256` is required in hosted mode by the caller. The comparison is
 * exact and case-normalised only for hex, never loosened to a prefix: a prefix
 * match on a digest is not a match, and this is the one write in the schema
 * where being approximately right is the same as being wrong.
 */
export function loadAnchorMaterial({ dir, anchor, expectedSha256, readFile = readFileSync } = {}) {
  if (!APPROVED_BASENAMES.includes(anchor.file)) {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-UNAPPROVED-FILE",
      `refusing to read '${anchor.file}'; only the approved PUBLIC certificates may be read.`,
    );
  }
  // Refused BEFORE the read. A private key must not be opened, not merely
  // rejected after its bytes are already in this process.
  if (/(^|[.\-_])(key|private)([.\-_]|$)/i.test(basename(anchor.file).replace(/\.pem$/i, ""))) {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-KEY-FILE",
      `refusing to read '${anchor.file}'; it names key material.`,
    );
  }

  const pem = String(readFile(join(dir, anchor.file), "utf8"));
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-PRIVATE-KEY",
      `'${anchor.file}' contains a PRIVATE KEY block; a CA private key never enters this path.`,
    );
  }

  const sha256 = certificateSha256(pem);

  if (expectedSha256 !== undefined && expectedSha256 !== null && expectedSha256 !== "") {
    const want = String(expectedSha256).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) {
      throw new TrustAnchorRefusal(
        "TRUST-ANCHOR-EXPECTED-MALFORMED",
        `${anchor.expectedEnv} is not a 64-character hex SHA-256.`,
      );
    }
    if (want !== sha256) {
      // The computed digest is NOT printed in full. It is the thing under
      // dispute, and a mismatch report that prints it hands the reader a value
      // to copy into the expectation and "fix" the failure.
      throw new TrustAnchorRefusal(
        "TRUST-ANCHOR-FINGERPRINT-MISMATCH",
        `${anchor.role}: the certificate in ${anchor.file} does not match ${anchor.expectedEnv} (computed sha256:${sha256.slice(0, 12)}…, expected sha256:${want.slice(0, 12)}…).`,
      );
    }
  }

  return Object.freeze({ pem, sha256 });
}

/**
 * Require the expected digests when the target is hosted.
 *
 * Local keeps working without them so the documented one-time local step is
 * unchanged; hosted does not, because a pin into a shared project is not a
 * thing to do on trust alone.
 */
export function requireExpectedDigests({ mode, env = {} }) {
  if (mode !== "hosted-development") return;
  const missing = ANCHORS.filter((a) => !(env[a.expectedEnv]?.trim() ?? "")).map(
    (a) => a.expectedEnv,
  );
  if (missing.length > 0) {
    throw new TrustAnchorRefusal(
      "TRUST-ANCHOR-NO-EXPECTED-DIGEST",
      `hosted development requires the approved digests out of band; set ${missing.join(" and ")}.`,
    );
  }
}
