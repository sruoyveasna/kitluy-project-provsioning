#!/usr/bin/env node
/**
 * Structural validation of every governed API's OpenAPI file. Deeper schema
 * validation runs in each service's contract tests (vitest).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { parse } = require("yaml");

const apis = [
  "services/kitluy-management-api/openapi.yaml",
  "services/kitluy-commerce-store-api/openapi.yaml",
  "services/kitluy-edge-operations-api/openapi.yaml",
  "services/kitluy-connector-api/openapi.yaml",
];
let errors = 0;
for (const file of apis) {
  try {
    const doc = parse(readFileSync(file, "utf8"));
    if (doc.openapi !== "3.1.0") throw new Error("openapi version must be 3.1.0");
    if (!doc.info?.title || !doc.info?.version) throw new Error("info.title/version required");
    if (!doc["x-kitluy-governance"]) throw new Error("x-kitluy-governance block required");
    if (!doc.paths?.["/health/live"]) throw new Error("/health/live path required");
    console.log(`OK: ${file} (${doc.info.title})`);
  } catch (e) {
    console.error(`OPENAPI ERROR in ${file}: ${e.message}`);
    errors += 1;
  }
}
process.exit(errors > 0 ? 1 : 0);
