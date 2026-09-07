/**
 * Hosted-capable trust-anchor bootstrap tests.
 *
 * Plain node, matching scripts/database/hosted-dev-target.test.mjs — this
 * directory has no vitest project and adding one for a single guard would be a
 * heavier change than the guard.
 *
 *   node scripts/pki/trust-anchor-bootstrap.test.mjs
 *
 * NOTHING HERE TOUCHES A DATABASE. Not local, and emphatically not hosted: the
 * point is to exercise every refusal before anyone is allowed to dial a shared
 * project. Certificates are read through an injected reader, so the real PKI
 * directory is not required either — and file 14 asserts that a private key is
 * refused BEFORE its bytes are ever requested, which is only observable because
 * the reader is injected.
 *
 * The negative cases carry the weight. Each asserts WHICH rule refused, so a
 * future edit cannot make the right thing happen for the wrong reason.
 */
import { execFileSync } from "node:child_process";

import {
  ANCHORS,
  HOSTED_FLAG,
  TrustAnchorRefusal,
  certificateSha256,
  loadAnchorMaterial,
  redact,
  requireExpectedDigests,
  resolveTarget,
} from "./trust-anchor-bootstrap.mjs";

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

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const HOSTED =
  "postgresql://postgres.gjgbnkhuwlwhngbtrgts:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";
const WRONG_PROJECT =
  "postgresql://postgres.aaaabbbbccccddddeeee:pw@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres";

function expectRefusal(name, fn, expectedCode) {
  try {
    fn();
    bad(name, "it was ALLOWED — expected a refusal");
  } catch (error) {
    if (!(error instanceof TrustAnchorRefusal))
      return bad(name, `threw ${error?.name}: ${error?.message}`);
    if (expectedCode && error.code !== expectedCode)
      return bad(name, `refused with '${error.code}', expected '${expectedCode}'`);
    ok(name);
  }
}
function expectOk(name, fn, check = () => true) {
  try {
    const value = fn();
    if (check(value)) ok(name);
    else bad(name, `allowed, but the result was wrong: ${JSON.stringify(value)}`);
  } catch (error) {
    bad(name, `refused unexpectedly: ${error?.code ?? error?.name} ${error?.message}`);
  }
}

// --- Synthetic certificates. Real DER, generated here, so no development CA
//     material is needed and none can leak into this file. -------------------
function selfSignedPem(cn) {
  return execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      "/dev/null",
      "-nodes",
      "-subj",
      `/CN=${cn}`,
      "-days",
      "1",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
}
const ROOT_PEM = selfSignedPem("test-root");
const ISSUING_PEM = selfSignedPem("test-issuing");
const ROOT_SHA = certificateSha256(ROOT_PEM);
const ISSUING_SHA = certificateSha256(ISSUING_PEM);
const OTHER_SHA = certificateSha256(selfSignedPem("stranger"));

const readerFor = (map) => {
  const opened = [];
  const read = (path) => {
    opened.push(path);
    const hit = Object.entries(map).find(([k]) => String(path).endsWith(k));
    if (!hit) throw new Error(`no fixture for ${path}`);
    return hit[1];
  };
  read.opened = opened;
  return read;
};
const HONEST = () =>
  readerFor({ "dev-root-ca.crt.pem": ROOT_PEM, "dev-device-issuing-ca.crt.pem": ISSUING_PEM });
const rootAnchor = ANCHORS[0];
const issuingAnchor = ANCHORS[1];

console.log("\nKitLuy hosted-capable trust-anchor bootstrap tests\n");

// --- 1 ----------------------------------------------------------------------
expectOk(
  "1. local mode still works (default behaviour unchanged)",
  () => resolveTarget({ argv: [], env: { KITLUY_DEV_DB_URL: LOCAL } }),
  // D-20: `dbUrl` is deliberately gone from the contract. The resolved target
  // now carries a CONNECTION, so an original string cannot regain control
  // after validation.
  (t) =>
    t.mode === "local" &&
    t.connectionConfig.connectionString === LOCAL &&
    t.environment === "development" &&
    t.dbUrl === undefined,
);

// --- 2 ----------------------------------------------------------------------
expectRefusal(
  "2. hosted target without the explicit hosted flag is REFUSED",
  () => resolveTarget({ argv: [], env: { KITLUY_DEV_DB_URL: HOSTED } }),
  "TRUST-ANCHOR-NON-LOCAL",
);

// --- 3 ----------------------------------------------------------------------
expectOk(
  "3. exact project + development + explicit flag reaches the connection stage",
  () =>
    resolveTarget({
      argv: [HOSTED_FLAG],
      env: { KITLUY_HOSTED_DEV_DB_URL: HOSTED, KITLUY_ENV: "development" },
    }),
  (t) =>
    t.mode === "hosted-development" &&
    t.projectRef === "gjgbnkhuwlwhngbtrgts" &&
    t.environment === "development" &&
    // D-20: a hosted target hands back VALIDATED components, and no raw string.
    t.dbUrl === undefined &&
    t.connectionConfig.host === "aws-0-ap-southeast-1.pooler.supabase.com" &&
    t.connectionConfig.port === 5432 &&
    t.connectionConfig.database === "postgres",
);

// --- 4 ----------------------------------------------------------------------
expectRefusal("4. a DIFFERENT hosted project is REFUSED", () =>
  resolveTarget({
    argv: [HOSTED_FLAG],
    env: { KITLUY_HOSTED_DEV_DB_URL: WRONG_PROJECT, KITLUY_ENV: "development" },
  }),
);

// --- 5, 6, 7 ----------------------------------------------------------------
for (const environment of ["pilot", "staging", "production"]) {
  expectRefusal(
    `${{ pilot: 5, staging: 6, production: 7 }[environment]}. environment '${environment}' is REFUSED even on the allowed project`,
    () =>
      resolveTarget({
        argv: [HOSTED_FLAG],
        env: { KITLUY_HOSTED_DEV_DB_URL: HOSTED, KITLUY_ENV: environment },
      }),
  );
}

// --- 8 ----------------------------------------------------------------------
expectRefusal(
  "8. a root fingerprint MISMATCH is REFUSED",
  () =>
    loadAnchorMaterial({
      dir: "/pki",
      anchor: rootAnchor,
      expectedSha256: OTHER_SHA,
      readFile: HONEST(),
    }),
  "TRUST-ANCHOR-FINGERPRINT-MISMATCH",
);

// --- 9 ----------------------------------------------------------------------
expectRefusal(
  "9. an issuing fingerprint MISMATCH is REFUSED",
  () =>
    loadAnchorMaterial({
      dir: "/pki",
      anchor: issuingAnchor,
      expectedSha256: OTHER_SHA,
      readFile: HONEST(),
    }),
  "TRUST-ANCHOR-FINGERPRINT-MISMATCH",
);

// --- 10, 11 -----------------------------------------------------------------
// A conflicting pin is refused by the DOOR (group 0203 raises
// KLUY-TRUST-ANCHOR-CONFLICT), and refused HERE before the door is reached,
// because a certificate that does not match the approved digest never gets
// sent. Both halves are asserted: the SQL text proves the server-side rule
// exists, the fingerprint check proves the client never gets that far.
{
  const sql = execFileSync(
    "grep",
    [
      "-c",
      "KLUY-TRUST-ANCHOR-CONFLICT",
      "supabase/migrations/20260826090000_0203_certificate_key_binding.sql",
    ],
    { encoding: "utf8" },
  ).trim();
  if (Number(sql) >= 1)
    ok(
      "10. a CONFLICTING existing root is refused server-side (0203 raises KLUY-TRUST-ANCHOR-CONFLICT)",
    );
  else bad("10. conflicting root refused", "0203 does not raise KLUY-TRUST-ANCHOR-CONFLICT");
}
expectRefusal(
  "11. a conflicting issuing anchor never reaches the door (client fails closed first)",
  () =>
    loadAnchorMaterial({
      dir: "/pki",
      anchor: issuingAnchor,
      expectedSha256: ROOT_SHA, // the root's digest, offered for the issuing role
      readFile: HONEST(),
    }),
  "TRUST-ANCHOR-FINGERPRINT-MISMATCH",
);

// --- 12, 13 -----------------------------------------------------------------
expectOk(
  "12. an IDENTICAL root digest is accepted (idempotent replay)",
  () =>
    loadAnchorMaterial({
      dir: "/pki",
      anchor: rootAnchor,
      expectedSha256: ROOT_SHA,
      readFile: HONEST(),
    }),
  (m) => m.sha256 === ROOT_SHA,
);
expectOk(
  "13. an IDENTICAL issuing digest is accepted (idempotent replay)",
  () =>
    loadAnchorMaterial({
      dir: "/pki",
      anchor: issuingAnchor,
      expectedSha256: ISSUING_SHA,
      readFile: HONEST(),
    }),
  (m) => m.sha256 === ISSUING_SHA,
);
{
  // The IDEMPOTENT outcome itself is the door's, and 0203 must return it rather
  // than updating. Asserted against the migration text for the same reason as 10.
  const src = execFileSync(
    "cat",
    ["supabase/migrations/20260826090000_0203_certificate_key_binding.sql"],
    {
      encoding: "utf8",
    },
  );
  if (/ALREADY_PINNED/.test(src) && /is already pinned to a DIFFERENT certificate/.test(src))
    ok("13b. 0203 replays ALREADY_PINNED for an identical certificate and refuses a different one");
  else bad("13b. 0203 idempotency", "the door does not distinguish identical from conflicting");
}

// --- 14 ---------------------------------------------------------------------
{
  const reader = readerFor({ "dev-root-ca.key.pem": "irrelevant" });
  const keyAnchor = { role: "development_root", file: "dev-root-ca.key.pem", expectedEnv: "X" };
  try {
    loadAnchorMaterial({ dir: "/pki", anchor: keyAnchor, readFile: reader });
    bad("14. private-key files are never opened", "it was allowed");
  } catch (error) {
    if (error.code !== "TRUST-ANCHOR-UNAPPROVED-FILE")
      bad("14. private-key files are never opened", `refused with '${error.code}'`);
    else if (reader.opened.length !== 0)
      bad(
        "14. private-key files are never opened",
        `the file WAS opened: ${reader.opened.join(",")}`,
      );
    else ok("14. private-key files are never opened (refused before the read, 0 opens)");
  }
}
{
  // Belt and braces: an approved BASENAME whose content is a private key is
  // still refused. A guard that trusts a filename is not a guard.
  const reader = readerFor({
    "dev-root-ca.crt.pem": "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
  });
  expectRefusal(
    "14b. an approved filename holding a PRIVATE KEY block is still refused",
    () => loadAnchorMaterial({ dir: "/pki", anchor: rootAnchor, readFile: reader }),
    "TRUST-ANCHOR-PRIVATE-KEY",
  );
}

// --- 15 ---------------------------------------------------------------------
{
  const leaky = `connect failed for ${HOSTED} while dialling`;
  const cleaned = redact(leaky, [HOSTED]);
  const byShapeOnly = redact(`error: ${HOSTED}`, []); // even with no secret list
  if (
    !cleaned.includes(HOSTED) &&
    !cleaned.includes("pooler.supabase.com") &&
    !byShapeOnly.includes(HOSTED)
  )
    ok("15. the DSN never survives output/errors (redacted by value AND by shape)");
  else bad("15. DSN never appears", `got: ${cleaned} / ${byShapeOnly}`);
}
{
  // The refusal text produced by the hosted path must not carry the DSN either.
  try {
    resolveTarget({
      argv: [HOSTED_FLAG],
      env: { KITLUY_HOSTED_DEV_DB_URL: WRONG_PROJECT, KITLUY_ENV: "development" },
    });
    bad("15b. a hosted refusal message carries no DSN", "it was allowed");
  } catch (error) {
    if (String(error.message).includes(WRONG_PROJECT))
      bad("15b. a hosted refusal message carries no DSN", "the refusal text contains the DSN");
    else ok("15b. a hosted refusal message carries no DSN");
  }
}

// --- 16, 17, 18 -------------------------------------------------------------
// The bootstrap issues exactly one statement: a call to the governed door. It
// contains no GRANT, no ALTER, no policy change and no direct table write, so
// no role can gain privilege through it. Asserted against the script's own
// source, because "it does not grant anything" is a property of the text.
{
  const src = execFileSync("cat", ["scripts/pki/pin-dev-trust-anchors.mjs"], { encoding: "utf8" });
  const body = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const forbidden = [
    /\bgrant\s+/i,
    /\balter\s+(table|role|function|default)/i,
    /\bcreate\s+policy/i,
    /\bdisable\s+row\s+level/i,
    /\binsert\s+into\b/i,
  ];
  const hits = forbidden.filter((r) => r.test(body));
  for (const [n, role] of [
    [16, "service_role"],
    [17, "anon"],
    [18, "authenticated"],
  ]) {
    if (hits.length === 0 && !new RegExp(`grant[\\s\\S]{0,80}${role}`, "i").test(body))
      ok(`${n}. ${role} gains no privilege (the bootstrap issues no GRANT/ALTER/POLICY/INSERT)`);
    else bad(`${n}. ${role} gains no privilege`, `found: ${hits.map(String).join(", ")}`);
  }
}
{
  // And 0203 itself revokes all three from both the door and the table.
  const src = execFileSync(
    "cat",
    ["supabase/migrations/20260826090000_0203_certificate_key_binding.sql"],
    {
      encoding: "utf8",
    },
  );
  const need = [
    "revoke all on kitluy_devices.pki_pinned_trust_anchors from service_role",
    "revoke all on kitluy_devices.pki_pinned_trust_anchors from anon",
    "revoke all on kitluy_devices.pki_pinned_trust_anchors from authenticated",
    "register_development_trust_anchor_v1(text, text, text, text) from service_role",
    "register_development_trust_anchor_v1(text, text, text, text) from anon",
    "register_development_trust_anchor_v1(text, text, text, text) from authenticated",
  ];
  const missing = need.filter((n) => !src.includes(n));
  if (missing.length === 0)
    ok("18b. 0203 revokes the table AND the door from service_role, anon and authenticated");
  else bad("18b. 0203 revokes all three", `missing: ${missing.join(" | ")}`);
}

// --- extra: the hosted mode refuses to run without the approved digests -----
expectRefusal(
  "19. hosted mode without the approved digests out of band is REFUSED",
  () => requireExpectedDigests({ mode: "hosted-development", env: {} }),
  "TRUST-ANCHOR-NO-EXPECTED-DIGEST",
);
expectOk("20. local mode does not require the digests (documented step unchanged)", () => {
  requireExpectedDigests({ mode: "local", env: {} });
  return true;
});
expectRefusal(
  "21. --hosted-development without KITLUY_HOSTED_DEV_DB_URL is REFUSED",
  () => resolveTarget({ argv: [HOSTED_FLAG], env: {} }),
  "TRUST-ANCHOR-NO-HOSTED-URL",
);
expectRefusal(
  "22. --hosted-development pointed at a LOCAL database is REFUSED",
  () => resolveTarget({ argv: [HOSTED_FLAG], env: { KITLUY_HOSTED_DEV_DB_URL: LOCAL } }),
  "TRUST-ANCHOR-LOCAL-IN-HOSTED-MODE",
);
expectRefusal(
  "23. an expected digest that is not 64 hex characters is REFUSED",
  () =>
    loadAnchorMaterial({
      dir: "/pki",
      anchor: rootAnchor,
      expectedSha256: "not-a-digest",
      readFile: HONEST(),
    }),
  "TRUST-ANCHOR-EXPECTED-MALFORMED",
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
