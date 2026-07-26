#!/usr/bin/env node
/**
 * Lightweight secret scan over tracked files. CI additionally runs gitleaks;
 * this scanner is the local, dependency-free backstop.
 */
import { execSync } from "node:child_process";
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
