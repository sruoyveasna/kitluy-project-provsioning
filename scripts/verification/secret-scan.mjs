#!/usr/bin/env node
/**
 * Lightweight secret scan over tracked files. CI additionally runs gitleaks;
 * this scanner is the local, dependency-free backstop.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const patterns = [
  {
    name: "Supabase service-role JWT",
    re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
  },
  { name: "Private key block", re: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: "DigitalOcean token", re: /\bdop_v1_[a-f0-9]{64}\b/ },
  { name: "AWS-style access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: "Generic assigned secret",
    re: /(api[_-]?key|secret|password|service[_-]?role[_-]?key)\s*[:=]\s*["'][A-Za-z0-9+/_-]{20,}["']/i,
  },
  { name: "Telegram bot token", re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
];
const allowlist = [
  /\.env\.example$/,
  /secret-scan\.mjs$/,
  /docs\/source\/imported\//,
  /pnpm-lock\.yaml$/,
];

// WS-11-T007 Stage 0 (KLD-2026-08-06-WS11-T007-001): Hub migration 0038 is an
// IMMUTABLE applied migration (commit 9310168) whose on-apply guard
// intentionally probes the release_trust_key public-only CHECK with a
// private-key MARKER to prove the refusal. The exception is pinned to the
// exact path, the exact pattern name, AND the exact committed bytes (sha256
// over LF-normalized content; git blob 9e80c81f). Any edit to the file —
// including a real secret — changes the checksum and re-enables the finding.
// Nothing else is exempt: not the directory, not other patterns, not new
// files.
const pinnedRejectionFixtures = [
  {
    file: "hub/migrations/0038_release_trust_and_cache.sql",
    pattern: "Private key block",
    sha256: "3d571e17e226ded82ab8aaf1e55ad54efac3a959c9de1d45b4d23554b8a2ab78",
  },
  // The SAME FILE, packaged into the Store Hub image.
  // `package-bootstrap-runtime.sh` copies `hub/migrations/` into the overlay so
  // the device carries the exact bytes the Hub agent's drift check expects, and
  // this repository commits packaged output (the firstboot JS closure is
  // committed the same way).
  //
  // Pinned to the SAME checksum as the original, which is the assertion worth
  // making: if the copy ever diverges from its source — the failure mode the
  // packager exists to prevent — this stops matching and the finding returns.
  // A real secret introduced into either copy does the same.
  {
    file: "infra/kitluy-store-hub-image/rpi-image-gen/layer/kitluy-hub-base.rootfs-overlay/usr/lib/kitluy/hub-migrations/0038_release_trust_and_cache.sql",
    pattern: "Private key block",
    sha256: "3d571e17e226ded82ab8aaf1e55ad54efac3a959c9de1d45b4d23554b8a2ab78",
  },
  // REFUSAL FIXTURES: files that must contain a PEM *header* because the
  // behaviour under test is the REFUSAL of malformed key material. Every block
  // pinned below is a stub — "AAAA", "not base64 at all", "broken", "leaked",
  // and a 16-character truncated DER prefix. None is a key; each exists so a
  // test can prove the code rejects it, and `operational-key.test.ts` also
  // asserts that a thrown error does not echo the bytes back.
  //
  // Pinned the same way as migration 0038: exact path, exact pattern name and
  // exact committed bytes. Editing any of these files — including pasting a
  // real key into one — changes the checksum and re-enables the finding.
  {
    file: "scripts/pki/trust-anchor-bootstrap.test.mjs",
    pattern: "Private key block",
    sha256: "72c4183bb062a366ea8e428d5771b2e13c92f2e1760fc5401ae990f5cc67b489",
  },
  {
    file: "services/kitluy-device-firstboot-agent/test/operational-key.test.ts",
    pattern: "Private key block",
    sha256: "35ef3716449a256a49c829153570b2fb7b6a654fed947bb7c56c30525b4d85dc",
  },
  {
    file: "services/kitluy-device-firstboot-agent/test/operational-tls-client.test.ts",
    pattern: "Private key block",
    sha256: "505d50fb96102fca6d112ae19284725f02c02a180b58f699a753c0611debc8f6",
  },
];
const sha256Lf = (content) =>
  createHash("sha256").update(content.replace(/\r\n/g, "\n"), "utf8").digest("hex");

const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
let findings = 0;
for (const file of files) {
  if (allowlist.some((re) => re.test(file))) continue;
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const { name, re } of patterns) {
    if (re.test(content)) {
      const pinned = pinnedRejectionFixtures.some(
        (p) => p.file === file && p.pattern === name && p.sha256 === sha256Lf(content),
      );
      if (pinned) continue;
      console.error(`SECRET-SCAN FINDING: ${name} in ${file}`);
      findings += 1;
    }
  }
}
if (findings > 0) {
  console.error(`Secret scan failed with ${findings} finding(s).`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} tracked files).`);
