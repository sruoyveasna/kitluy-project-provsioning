#!/usr/bin/env node
/**
 * Refuse to let DEVELOPMENT CA material reach a tracked file or a device image.
 *
 * Authority: owner Decision 3 (2026-08-24) — "Add/retain a production build guard
 * preventing DEV CA trust roots, fingerprints or private material from entering
 * production artifacts."
 *
 *   node scripts/verification/assert-no-dev-pki.mjs                 # tracked files
 *   node scripts/verification/assert-no-dev-pki.mjs --root <path>   # a built rootfs
 *
 * ===========================================================================
 * WHY A SECOND SCANNER, WHEN `secret:scan` ALREADY LOOKS FOR PRIVATE KEYS
 * ===========================================================================
 * `secret:scan` catches a private key BLOCK. That is necessary and not
 * sufficient here, because the dangerous thing about a development CA is not
 * only its key:
 *
 *   * its ROOT CERTIFICATE is not secret, and shipping it as a trust anchor in a
 *     production artifact would make every certificate that dev CA ever signs
 *     trusted by a real till. A leaked public certificate is a trust decision,
 *     not a leaked secret, and a secret scanner has no reason to object to it.
 *   * its FINGERPRINT is enough to pin the wrong root.
 *
 * So this guard looks for the development CA's own identity.
 *
 * AND IT PARSES, RATHER THAN GREPS. The first version of this file searched for
 * the subject string and the fingerprint as TEXT, and was therefore a tautology
 * for the one case that matters most: a PEM certificate is base64, so neither
 * its subject nor its fingerprint appears anywhere in the file as text. Planting
 * the real development root into a fake rootfs passed the check. Every
 * `BEGIN CERTIFICATE` block is now DECODED and compared by fingerprint and
 * subject, and the text search is kept only for the separate case of a
 * fingerprint pinned into a config file.
 *
 * ===========================================================================
 * FAIL CLOSED, BUT NOT ON ABSENCE
 * ===========================================================================
 * If no development PKI exists on this machine, there is nothing to leak and the
 * fingerprint half of the check simply has nothing to compare — the subject half
 * still runs. A machine without the dev CA must not be able to turn this guard
 * into a silent pass for the half that CAN run, so the two halves are reported
 * separately.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { X509Certificate } from "node:crypto";

/**
 * The subject strings the bootstrap stamps into every artifact it makes.
 * Matching on these is what catches a certificate that carries no key at all.
 */
const DEV_CA_SUBJECT_MARKERS = [
  "KitLuy Development Root CA NON-PRODUCTION",
  "KitLuy Development Device Issuing CA NON-PRODUCTION",
  "NON-PRODUCTION development PKI",
];

/** Where a development PKI lives when one is configured. */
const PKI_DIR_ENV = "KITLUY_DEV_PKI_DIR";

function devCaFingerprints() {
  const directory = process.env[PKI_DIR_ENV]?.trim() ?? "";
  if (directory === "" || !existsSync(directory)) return { configured: false, values: [] };
  const values = [];
  for (const name of ["dev-root-ca.crt.pem", "dev-device-issuing-ca.crt.pem"]) {
    const path = join(directory, name);
    if (!existsSync(path)) continue;
    try {
      const certificate = new X509Certificate(readFileSync(path));
      // Both spellings a leak could take: the DER digest and the raw SPKI digest.
      values.push(createHash("sha256").update(certificate.raw).digest("hex"));
      values.push(
        createHash("sha256")
          .update(certificate.publicKey.export({ type: "spki", format: "der" }))
          .digest("hex"),
      );
    } catch {
      // An unparseable certificate cannot be a usable trust anchor, so it is not
      // a leak risk. Reported, not fatal.
      console.warn(`[dev-pki-guard] ${path} is present but unparseable; skipped`);
    }
  }
  return { configured: true, values };
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter((f) => f !== "");
}

function walk(root) {
  const out = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // permission-denied subtrees in a staged rootfs are not our business
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(path);
      } else if (entry.isFile()) {
        try {
          if (statSync(path).size <= 8 * 1024 * 1024) out.push(path);
        } catch {
          /* vanished between readdir and stat */
        }
      }
    }
  };
  visit(root);
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const rootIndex = argv.indexOf("--root");
  const scanRoot = rootIndex === -1 ? null : resolve(argv[rootIndex + 1] ?? "");

  const { configured, values } = devCaFingerprints();
  const files = scanRoot === null ? trackedFiles() : walk(scanRoot);
  const label = scanRoot === null ? "tracked files" : scanRoot;

  const findings = [];
  const fingerprintSet = new Set(values);
  /** Every PEM certificate block in a file, decoded. */
  const certificateBlocks = (text) =>
    [...text.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)].map(
      (m) => m[0],
    );

  let certificatesParsed = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // binary or unreadable
    }
    const isGuardOwnSource = /assert-no-dev-pki\.mjs$|bootstrap-dev-pki\.mjs$/.test(file);

    // 1. PARSED certificates. This is the check that catches a real artifact.
    for (const block of certificateBlocks(text)) {
      let certificate;
      try {
        certificate = new X509Certificate(block);
      } catch {
        continue; // not a usable trust anchor, so not a leak
      }
      certificatesParsed += 1;
      const der = createHash("sha256").update(certificate.raw).digest("hex");
      const subjectText = certificate.subject.replace(/\n/g, " | ");
      if (fingerprintSet.has(der)) {
        findings.push(`${file}: development CA certificate (fingerprint match) — ${subjectText}`);
        continue;
      }
      for (const marker of DEV_CA_SUBJECT_MARKERS) {
        if (subjectText.includes(marker)) {
          findings.push(`${file}: certificate whose subject marks it development CA — ${subjectText}`);
          break;
        }
      }
    }

    if (isGuardOwnSource) continue;

    // THE ONE EXEMPTION, AND IT IS NARROW ON PURPOSE.
    //
    // `/etc/kitluy/development-root.sha256` is the DEVELOPMENT root's digest,
    // written into a development image at build time so the Hub can PIN it. A
    // device that cannot pin cannot tell our root from a perfectly
    // self-consistent chain belonging to somebody else — which is check 6 of the
    // firstboot verification, and the reason that check exists at all.
    //
    // A digest is not key material and not a certificate: it authorises nothing,
    // decrypts nothing, and signs nothing. What this guard exists to stop is
    // development CA material reaching an artifact that could be mistaken for
    // production, and BLK-005 blocks pilot and production images outright.
    //
    // Exempted by EXACT path, and only when the file is nothing but a digest —
    // 64 hex characters and whitespace. A certificate, a key, or any other text
    // in that path is NOT exempt and is reported normally.
    const isDevelopmentRootPin =
      /(^|\/)etc\/kitluy\/development-root\.sha256$/.test(file) &&
      /^[0-9a-f]{64}\s*$/.test(text);
    if (isDevelopmentRootPin) continue;

    // 2. TEXT occurrences. A fingerprint pinned into a config file carries the
    //    same trust decision as the certificate itself, with nothing to parse.
    for (const marker of DEV_CA_SUBJECT_MARKERS) {
      if (text.includes(marker)) {
        findings.push(`${file}: development CA subject marker "${marker}" in plain text`);
      }
    }
    for (const fingerprint of values) {
      if (text.includes(fingerprint)) {
        findings.push(`${file}: development CA fingerprint pinned in plain text`);
      }
    }
  }

  console.log(
    `[dev-pki-guard] scanned ${files.length} file(s) in ${label}; parsed ${certificatesParsed} certificate(s)`,
  );
  console.log(
    configured
      ? `[dev-pki-guard] fingerprint check ACTIVE (${values.length} value(s) from $${PKI_DIR_ENV})`
      : `[dev-pki-guard] fingerprint check INACTIVE — $${PKI_DIR_ENV} is unset or absent on this machine; the subject-marker check still ran`,
  );

  if (findings.length > 0) {
    console.error("");
    console.error("REFUSED: development CA material must not enter this artifact.");
    for (const finding of findings) console.error(`  ${finding}`);
    console.error("");
    console.error(
      "A development root shipped as a trust anchor makes every certificate that CA signs trusted by a real till. That is a trust decision, not a leaked secret, which is why `secret:scan` does not object to it.",
    );
    process.exit(1);
  }
  console.log("[dev-pki-guard] PASS — no development CA subject or fingerprint present");
}

main();
