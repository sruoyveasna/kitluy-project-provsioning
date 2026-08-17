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
