/**
 * WS-11-T006-P03 — signed release manifest v1: canonical bytes, fail-closed
 * verification, and the independent device-side acceptance gate.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";

import {
  canonicalReleaseManifestBytes,
  canonicalReleaseManifestDigest,
  findReleaseAcceptanceRefusal,
  ReleaseSeparatorInjectionError,
  verifyReleaseManifestSignature,
  type ReleaseAcceptanceContext,
  type ReleaseSignatureEnvelope,
  type SignedReleaseManifestBody,
  type TrustedReleaseKey,
} from "../src/release-manifest.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function body(overrides: Partial<SignedReleaseManifestBody> = {}): SignedReleaseManifestBody {
  return {
    manifestVersion: 1,
    releaseId: "8b0d8f1e-0000-4000-8000-000000000001",
    productKey: "kitluy-hub-agent",
    version: "1.2.0",
    buildId: "build-77",
    architecture: "arm64",
    hardwareProfile: "pi5-hub",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: "a".repeat(64),
    artifactSizeBytes: 4096,
    minSchemaVersion: 30,
    maxSchemaVersion: 40,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: "",
    ...overrides,
  };
}

function sign(manifest: SignedReleaseManifestBody): ReleaseSignatureEnvelope {
  return {
    keyId: "dev-release-key",
    keyVersion: 1,
    algorithm: "ed25519",
    signature: nodeSign(null, canonicalReleaseManifestBytes(manifest), privateKey).toString(
      "base64",
    ),
  };
}

const TRUSTED: readonly TrustedReleaseKey[] = [
  { keyId: "dev-release-key", keyVersion: 1, publicKeyPem: publicPem, state: "current" },
];

describe("signed release manifest v1 (WS-11-T006-P03)", () => {
  it("verifies a correctly signed manifest and binds every covered field", () => {
    const manifest = body();
    const envelope = sign(manifest);
    expect(verifyReleaseManifestSignature(manifest, envelope, TRUSTED)).toEqual({
      verified: true,
      keyId: "dev-release-key",
      keyVersion: 1,
    });
    // Any covered field change invalidates the signature — a channel label is
    // never sufficient authority (owner decision §5).
    for (const tampered of [
      body({ channel: "stable" }),
      body({ artifactDigestSha256: "b".repeat(64) }),
      body({ artifactSizeBytes: 4097 }),
      body({ version: "1.2.1" }),
      body({ rollbackReleaseId: "8b0d8f1e-0000-4000-8000-00000000dead" }),
    ]) {
      expect(verifyReleaseManifestSignature(tampered, envelope, TRUSTED)).toEqual({
        verified: false,
        failure: "SIGNATURE_INVALID",
      });
    }
  });

  it("fails closed on missing/malformed/unknown/revoked signatures and versions", () => {
    const manifest = body();
    const envelope = sign(manifest);
    expect(verifyReleaseManifestSignature(manifest, undefined, TRUSTED)).toEqual({
      verified: false,
      failure: "SIGNATURE_MISSING",
    });
    expect(
      verifyReleaseManifestSignature(manifest, { ...envelope, algorithm: "rsa" as never }, TRUSTED),
    ).toEqual({ verified: false, failure: "SIGNATURE_ALGORITHM_UNSUPPORTED" });
    expect(
      verifyReleaseManifestSignature(manifest, { ...envelope, signature: "!!" }, TRUSTED),
    ).toEqual({ verified: false, failure: "SIGNATURE_MALFORMED" });
    expect(
      verifyReleaseManifestSignature(manifest, { ...envelope, keyId: "ghost" }, TRUSTED),
    ).toEqual({ verified: false, failure: "SIGNING_KEY_UNKNOWN" });
    expect(
      verifyReleaseManifestSignature(manifest, { ...envelope, keyVersion: 2 }, TRUSTED),
    ).toEqual({ verified: false, failure: "SIGNING_KEY_UNKNOWN" });
    expect(
      verifyReleaseManifestSignature(manifest, envelope, [{ ...TRUSTED[0]!, state: "revoked" }]),
    ).toEqual({ verified: false, failure: "SIGNING_KEY_REVOKED" });
    expect(verifyReleaseManifestSignature(body({ manifestVersion: 2 }), envelope, TRUSTED)).toEqual(
      { verified: false, failure: "MANIFEST_VERSION_UNSUPPORTED" },
    );
  });

  it("refuses separator injection before any cryptography", () => {
    const hostile = body({ productKey: "kitluyhub" });
    expect(() => canonicalReleaseManifestBytes(hostile)).toThrow(ReleaseSeparatorInjectionError);
    expect(verifyReleaseManifestSignature(hostile, sign(body()), TRUSTED)).toEqual({
      verified: false,
      failure: "MANIFEST_SEPARATOR_INJECTION",
    });
  });

  it("is deterministic and distinguishes adjacent-field ambiguity", () => {
    expect(canonicalReleaseManifestDigest(body())).toBe(canonicalReleaseManifestDigest(body()));
    expect(canonicalReleaseManifestDigest(body({ version: "1.2", buildId: "0build-77" }))).not.toBe(
      canonicalReleaseManifestDigest(body()),
    );
  });

  it("applies the independent device acceptance gate (owner decision §5 list)", () => {
    const context: ReleaseAcceptanceContext = {
      productKey: "kitluy-hub-agent",
      architecture: "arm64",
      hardwareProfile: "pi5-hub",
      environment: "development",
      eligibleChannels: ["internal"],
      schemaVersion: 38,
      configurationVersion: 5,
      expectedArtifactSizeBytes: 4096,
    };
    expect(findReleaseAcceptanceRefusal(body(), context)).toBeNull();
    expect(findReleaseAcceptanceRefusal(body({ architecture: "x64" }), context)).toBe(
      "RELEASE_WRONG_ARCHITECTURE",
    );
    expect(findReleaseAcceptanceRefusal(body({ hardwareProfile: "pi4" }), context)).toBe(
      "RELEASE_WRONG_HARDWARE_PROFILE",
    );
    expect(findReleaseAcceptanceRefusal(body({ environment: "pilot" }), context)).toBe(
      "RELEASE_WRONG_ENVIRONMENT",
    );
    expect(findReleaseAcceptanceRefusal(body({ channel: "stable" }), context)).toBe(
      "RELEASE_CHANNEL_INELIGIBLE",
    );
    expect(
      findReleaseAcceptanceRefusal(body({ minSchemaVersion: 39, maxSchemaVersion: 40 }), {
        ...context,
        schemaVersion: 38,
      }),
    ).toBe("RELEASE_SCHEMA_INCOMPATIBLE");
    expect(findReleaseAcceptanceRefusal(body({ configPrerequisiteVersion: 9 }), context)).toBe(
      "RELEASE_CONFIGURATION_PREREQUISITE_MISSING",
    );
    expect(findReleaseAcceptanceRefusal(body({ artifactSizeBytes: 1 }), context)).toBe(
      "RELEASE_ARTIFACT_SIZE_MISMATCH",
    );
  });
});
