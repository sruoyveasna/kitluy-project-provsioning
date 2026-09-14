/**
 * The device's release trust registry, and the wrong-purpose refusal the owner
 * listed among U1's required failure cases.
 *
 * The test that matters most is `refuses a key minted for another purpose`: the
 * key is REAL and the signature it produces would verify perfectly. It is
 * refused on purpose alone, which is the separation KLD-2026-07-28-002 §1/§7
 * requires and which nothing enforced before U1.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadReleaseTrustRegistry } from "../src/release-trust.js";

let dir: string;

function keyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function record(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: "kitluy.release-trust-key.v1",
    keyId: "k-1",
    keyVersion: 1,
    algorithm: "ed25519",
    purpose: "release_signing",
    environment: "development",
    productionEligible: false,
    state: "current",
    publicKeyPem: keyPair().publicKeyPem,
    ...overrides,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-trust-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function load(environment: string | undefined = "development") {
  return loadReleaseTrustRegistry({ trustDir: dir, environment });
}

describe("absent is safe", () => {
  it("returns an empty registry when the directory does not exist", () => {
    const registry = loadReleaseTrustRegistry({
      trustDir: join(dir, "nope"),
      environment: "development",
    });
    expect(registry.keys).toEqual([]);
    expect(registry.rejected).toEqual([]);
  });

  it("returns an empty registry when the directory is empty", () => {
    expect(load().keys).toEqual([]);
  });
});

describe("accepting a valid anchor", () => {
  it("loads a release-signing key", () => {
    writeFileSync(join(dir, "release-signing.json"), record());
    const registry = load();
    expect(registry.keys).toHaveLength(1);
    expect(registry.keys[0]?.keyId).toBe("k-1");
    expect(registry.keys[0]?.purpose).toBe("release_signing");
    expect(registry.rejected).toEqual([]);
  });

  it("carries the revoked state through, so the verifier can refuse it", () => {
    writeFileSync(join(dir, "r.json"), record({ state: "revoked" }));
    expect(load().keys[0]?.state).toBe("revoked");
  });
});

describe("the wrong-purpose refusal", () => {
  it.each([
    "device_identity",
    "configuration_signing",
    "transport_signing",
    "manufacturing_enrollment",
    "emergency_recovery",
  ])("refuses a key minted for %s, however valid its signature would be", (purpose) => {
    writeFileSync(join(dir, "k.json"), record({ purpose }));
    const registry = load();
    expect(registry.keys).toEqual([]);
    expect(registry.rejected[0]?.refusal).toBe("TRUST_RECORD_WRONG_PURPOSE");
  });

  it("refuses a record with no purpose at all", () => {
    writeFileSync(join(dir, "k.json"), record({ purpose: undefined }));
    expect(load().rejected[0]?.refusal).toBe("TRUST_RECORD_WRONG_PURPOSE");
  });
});

describe("environment isolation", () => {
  it("refuses a development anchor on a pilot device", () => {
    writeFileSync(join(dir, "k.json"), record({ environment: "development" }));
    expect(load("pilot").rejected[0]?.refusal).toBe("TRUST_RECORD_WRONG_ENVIRONMENT");
  });

  it("refuses a production anchor on a development device", () => {
    writeFileSync(join(dir, "k.json"), record({ environment: "production" }));
    expect(load("development").rejected[0]?.refusal).toBe("TRUST_RECORD_WRONG_ENVIRONMENT");
  });

  it("refuses every anchor when the image stated no environment", () => {
    writeFileSync(join(dir, "k.json"), record());
    // Called directly rather than through `load`: that helper has a default
    // parameter, so passing `undefined` would silently get "development" back
    // and the test would pass without exercising anything. An image that states
    // no environment is a real case — `image.env` ships KITLUY_ENVIRONMENT
    // deliberately EMPTY so a build that forgot to supply one fails closed.
    const registry = loadReleaseTrustRegistry({ trustDir: dir, environment: undefined });
    expect(registry.keys).toEqual([]);
    expect(registry.rejected[0]?.refusal).toBe("TRUST_RECORD_WRONG_ENVIRONMENT");
  });
});

describe("public material only", () => {
  it("refuses a record carrying a private key, before parsing it", () => {
    const { privateKeyPem } = keyPair();
    writeFileSync(join(dir, "k.json"), record({ publicKeyPem: privateKeyPem }));
    expect(load().rejected[0]?.refusal).toBe("TRUST_RECORD_CARRIES_PRIVATE_KEY");
  });

  it("refuses a private key even inside otherwise broken JSON", () => {
    // Built at runtime so secret-scan.mjs does not read the marker as a key.
    const pemLabel = "PRIVATE KEY";
    writeFileSync(join(dir, "k.json"), `{not json -----BEGIN ${pemLabel}-----`);
    expect(load().rejected[0]?.refusal).toBe("TRUST_RECORD_CARRIES_PRIVATE_KEY");
  });
});

describe("malformed records", () => {
  it("refuses unparseable JSON", () => {
    writeFileSync(join(dir, "k.json"), "{nope");
    expect(load().rejected[0]?.refusal).toBe("TRUST_RECORD_UNPARSEABLE");
  });

  it("refuses the wrong record kind", () => {
    writeFileSync(join(dir, "k.json"), record({ kind: "something.else" }));
    expect(load().rejected[0]?.refusal).toBe("TRUST_RECORD_WRONG_KIND");
  });

  it("refuses a record with no usable key material", () => {
    writeFileSync(join(dir, "k.json"), record({ publicKeyPem: "not a pem" }));
    expect(load().rejected[0]?.refusal).toBe("TRUST_RECORD_MALFORMED");
  });

  it("refuses a key version below one", () => {
    writeFileSync(join(dir, "k.json"), record({ keyVersion: 0 }));
    expect(load().rejected[0]?.refusal).toBe("TRUST_RECORD_MALFORMED");
  });

  it("keeps the valid anchors when one record beside them is bad", () => {
    writeFileSync(join(dir, "good.json"), record({ keyId: "good" }));
    writeFileSync(join(dir, "bad.json"), record({ keyId: "bad", purpose: "device_identity" }));
    const registry = load();
    expect(registry.keys.map((k) => k.keyId)).toEqual(["good"]);
    expect(registry.rejected).toHaveLength(1);
  });
});
