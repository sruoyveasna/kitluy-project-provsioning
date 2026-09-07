/**
 * The development-only listener gate.
 *
 * WHY THIS FILE IS SECURITY-SENSITIVE
 * ---------------------------------------------------------------------------
 * `bin/hub-agent.ts` withheld the terminal listener for every Hub because
 * composing one needs a pairing signer, and signer custody is BLK-005. The
 * listener now exists for DEVELOPMENT boards only, and the single thing keeping
 * that true is `composeDevelopmentListener`'s environment gate.
 *
 * If that gate ever stops holding, a pilot or production Hub would serve
 * terminals with a signer nobody approved. Every refusal below is asserted by
 * name for that reason, and the environment check is asserted as an ALLOWLIST OF
 * ONE rather than a denylist someone could add a value past.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";

import {
  edgeDiscoveryRecordBytes,
  verifyEdgeDiscoveryRecord,
  EDGE_DISCOVERY_KIND,
  EDGE_LAN_PORT,
} from "@kitluy/device-identity";

import { composeDevelopmentListener } from "../src/hub/edge/development-listener.js";
import { evaluateStoragePosture } from "../src/hub-runtime.js";

const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const DEVICE = "636b6082-a58e-4c0d-b7bc-79aa84e57329";

const { privateKey } = generateKeyPairSync("ed25519");
const IDENTITY_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** The shapes the firstboot agent actually writes, abbreviated to what is read. */
const CREDENTIAL = JSON.stringify({
  phase: "ADOPTED",
  deviceRecordId: DEVICE,
  environment: "development",
  certificateSerial: "DEV-F05936A833810D35",
  publicKeyAlgorithm: "rsa-2048",
});
const PAIRING = JSON.stringify({
  phase: "PAIRED",
  tenantId: TENANT,
  digitalStoreId: STORE,
  storeLocationId: LOCATION,
  deviceRecordId: DEVICE,
});

function fakeFiles(overrides: Record<string, string | Error> = {}) {
  const files: Record<string, string | Error> = {
    "/op/operational-credential.json": CREDENTIAL,
    "/pairing-state.json": PAIRING,
    "/identity.key.pem": IDENTITY_KEY_PEM,
    ...overrides,
  };
  return (path: string): string => {
    const value = files[path];
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    if (value instanceof Error) throw value;
    return value;
  };
}

function compose(environment: string, overrides: Record<string, string | Error> = {}) {
  return composeDevelopmentListener({
    environment,
    tlsCertificateFingerprint: "ab".repeat(32),
    bindHost: "172.16.13.206",
    identityKeyPath: "/identity.key.pem",
    operationalDir: "/op",
    pairingStatePath: "/pairing-state.json",
    hostname: "pi5-test",
    readFile: fakeFiles(overrides),
  });
}

describe("the terminal listener is a development-only path", () => {
  // THE LOAD-BEARING ASSERTION. Everything else in this file is secondary to it.
  it.each(["pilot", "production", "staging", "local", "disaster_recovery", "unknown", ""])(
    "refuses to compose in %s",
    (environment) => {
      const result = compose(environment);
      expect(result.kind).toBe("refused");
      if (result.kind !== "refused") return;
      expect(result.code).toBe("KLUY-HUB-EDGE-PENDING");
      expect(result.detail).toContain("BLK-005");
    },
  );

  it("composes in development", () => {
    const result = compose("development");
    expect(result.kind).toBe("composed");
  });

  it("names development explicitly rather than excluding known production values", () => {
    // A value nobody has defined must refuse. A denylist would let it through.
    const result = compose("developement"); // deliberate typo
    expect(result.kind).toBe("refused");
  });
});

describe("nothing is invented when the Hub is not ready", () => {
  it("refuses when the operational credential is not ADOPTED", () => {
    const result = compose("development", {
      "/op/operational-credential.json": JSON.stringify({ phase: "VERIFIED" }),
    });
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.code).toBe("KLUY-HUB-EDGE-NO-CREDENTIAL");
  });

  it("refuses when there is no credential at all", () => {
    const result = compose("development", {
      "/op/operational-credential.json": new Error("ENOENT"),
    });
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.code).toBe("KLUY-HUB-EDGE-NO-CREDENTIAL");
  });

  it("refuses when the Hub is not paired to a Store scope", () => {
    const result = compose("development", {
      "/pairing-state.json": JSON.stringify({ phase: "UNPAIRED" }),
    });
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.code).toBe("KLUY-HUB-EDGE-UNPAIRED");
    // The operator needs to know WHICH bindings are absent.
    expect(result.detail).toContain("tenantId");
    expect(result.detail).toContain("storeLocationId");
  });

  it("refuses when the device identity key cannot be loaded", () => {
    const result = compose("development", { "/identity.key.pem": new Error("EACCES") });
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.code).toBe("KLUY-HUB-EDGE-NO-IDENTITY-KEY");
  });

  it("names the key FILE in a refusal and never its contents", () => {
    const result = compose("development", { "/identity.key.pem": new Error("EACCES") });
    if (result.kind !== "refused") throw new Error("expected a refusal");
    expect(result.detail).toContain("/identity.key.pem");
    expect(result.detail).not.toContain("PRIVATE KEY");
    expect(result.detail).not.toContain(IDENTITY_KEY_PEM);
  });
});

describe("the composed signer is the one a terminal can verify", () => {
  it("signs with ed25519, not the RSA operational key", () => {
    const result = compose("development");
    if (result.kind !== "composed") throw new Error("expected a composition");

    const payload = Buffer.from("kitluy.test.payload");
    const signature = result.signer.sign(payload);

    // `verify(null, …)` is the ed25519 form — the same call
    // `verifyDetachedSignature` makes. An RSA key cannot satisfy it, which is
    // exactly why the device identity key signs and the TLS key does not.
    expect(cryptoVerify(null, payload, result.signer.publicKeyPem, signature)).toBe(true);
    expect(result.signer.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });

  it("carries the certificate serial from the adopted credential", () => {
    const result = compose("development");
    if (result.kind !== "composed") throw new Error("expected a composition");
    expect(result.signer.certificateSerial).toBe("DEV-F05936A833810D35");
  });

  it("produces a discovery record a terminal accepts", () => {
    const result = compose("development");
    if (result.kind !== "composed") throw new Error("expected a composition");

    const issuedAt = new Date("2026-09-01T10:00:00.000Z");
    const record = {
      protocolVersion: EDGE_DISCOVERY_KIND,
      recordId: "3f1a5b2c-0000-4000-8000-000000000001",
      hubDeviceId: result.identity.hubDeviceId,
      hubCertificateFingerprint: result.identity.hubTlsCertificateFingerprint,
      tenantId: TENANT,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
      environment: "development" as const,
      hostname: "pi5-test",
      port: EDGE_LAN_PORT,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 90_000),
    };
    const signature = result.signer.sign(edgeDiscoveryRecordBytes(record));

    const verdict = verifyEdgeDiscoveryRecord(
      record,
      signature,
      result.signer.publicKeyPem,
      {
        tenantId: TENANT,
        digitalStoreId: STORE,
        storeLocationId: LOCATION,
        environment: "development",
      },
      new Date(issuedAt.getTime() + 1_000),
    );
    expect(verdict.verified).toBe(true);
  });

  it("binds the Store scope from pairing state, not from anywhere else", () => {
    const result = compose("development");
    if (result.kind !== "composed") throw new Error("expected a composition");
    expect(result.identity.tenantId).toBe(TENANT);
    expect(result.identity.digitalStoreId).toBe(STORE);
    expect(result.identity.storeLocationId).toBe(LOCATION);
    expect(result.identity.hubDeviceId).toBe(DEVICE);
    // 7443. A terminal REJECTS a record advertising any other port.
    expect(result.identity.port).toBe(7443);
  });
});

describe("a volume that is not bound to this board cannot serve a Store", () => {
  it.each(["pilot", "production", "staging", "unknown"])(
    "refuses DEVELOPMENT-UNBOUND storage in %s",
    (environment) => {
      const verdict = evaluateStoragePosture("DEVELOPMENT-UNBOUND", environment);
      expect(verdict.ok).toBe(false);
      expect(verdict.code).toBe("KLUY-HUB-STORAGE-UNBOUND");
    },
  );

  it("allows DEVELOPMENT-UNBOUND storage in development", () => {
    expect(evaluateStoragePosture("DEVELOPMENT-UNBOUND", "development").ok).toBe(true);
  });

  it("allows OTP-BOUND storage everywhere, production included", () => {
    expect(evaluateStoragePosture("OTP-BOUND", "production").ok).toBe(true);
    expect(evaluateStoragePosture("OTP-BOUND", "development").ok).toBe(true);
  });

  it("does not refuse when no posture was recorded", () => {
    // A developer workstation has no posture file, and this rule is not about
    // that case — the database and schema checks already govern it.
    expect(evaluateStoragePosture(undefined, "production").ok).toBe(true);
  });
});
