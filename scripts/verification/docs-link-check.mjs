#!/usr/bin/env node
/**
 * Validates relative markdown links in authored docs (docs/, root *.md,
 * 00_AI_HANDOFF/). Imported source documents are excluded — they reference
 * files from their original environments.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const files = execSync("git ls-files '*.md'", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.startsWith("docs/source/imported/"))
  .filter((f) => !f.includes("node_modules"));

const linkRe = /\[[^\]]*\]\(([^)]+)\)/g;
let errors = 0;
for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(linkRe)) {
    const target = match[1].split("#")[0].trim();
    if (
      target === "" ||
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:")
    )
      continue;
    const resolved = resolve(dirname(file), target);
    if (!existsSync(resolved)) {
      console.error(`BROKEN LINK in ${file}: ${target}`);
      errors += 1;
    }
  }
}
if (errors > 0) {
  console.error(`Docs link check failed with ${errors} broken link(s).`);
  process.exit(1);
}
console.log(`Docs link check passed (${files.length} markdown files).`);
