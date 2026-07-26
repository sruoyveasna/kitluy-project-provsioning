import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const doc = parse(readFileSync(join(here, "..", "openapi.yaml"), "utf8")) as Record<string, any>;

describe("governed API contract skeleton", () => {
  it("is OpenAPI 3.1 with title and version", () => {
    expect(doc["openapi"]).toBe("3.1.0");
    expect(doc["info"]?.title).toBeTruthy();
    expect(doc["info"]?.version).toBeTruthy();
  });

  it("declares every mandated governance dimension", () => {
    const gov = doc["x-kitluy-governance"];
    for (const key of [
      "authentication",
      "scope-resolution",
      "idempotency",
      "pagination",
      "filtering",
      "rate-limit-policy",
      "error-catalogue",
      "versioning",
      "deprecation-policy",
      "audit",
      "retry-behavior",
      "freshness",
      "generated-clients",
    ]) {
      expect(gov?.[key], `missing governance dimension: ${key}`).toBeTruthy();
    }
  });

  it("exposes health and version paths", () => {
    expect(doc["paths"]?.["/health/live"]).toBeDefined();
    expect(doc["paths"]?.["/health/ready"]).toBeDefined();
    expect(doc["paths"]?.["/version"]).toBeDefined();
  });

  it("defines the canonical error envelope schema", () => {
    const schema = doc["components"]?.schemas?.ErrorEnvelope;
    expect(schema?.properties?.error?.required).toEqual(["code", "message"]);
  });

  it("does not leak provider names in routes", () => {
    const raw = JSON.stringify(doc["paths"]);
    for (const provider of ["supabase", "digitalocean", "spaces", "valkey"]) {
      expect(raw.toLowerCase()).not.toContain(provider);
    }
  });
});
