/**
 * DRIFT GUARD: the device's mirror of the release-manifest verifier against the
 * canonical implementation in @kitluy/device-identity.
 *
 * This is the test that makes "mirror" mean something. The agent cannot import
 * the canonical package at runtime — the device closure ships node built-ins
 * only — so the contract is duplicated, and duplication without a guard is drift
 * waiting to happen. Every other cross-contract surface in this service has the
 * same shape of test (registration bytes, the operational CSR, the Hub claim).
 *
 * What is compared is the CANONICAL BYTES, not the verdict alone: two
 * implementations can agree on "valid" while disagreeing on what they signed,
 * and the bytes are the thing an Ed25519 signature actually covers.
 */
import { generateKeyPairSync, sign as edSign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalReleaseManifestBytes as canonicalBytes,
  canonicalReleaseManifestDigest as canonicalDigest,
  findReleaseAcceptanceRefusal as canonicalAcceptance,
  verifyReleaseManifestSignature as canonicalVerify,
  RELEASE_CHANNELS,
  type SignedReleaseManifestBody as CanonicalBody,
  type TrustedReleaseKey as CanonicalKey,
} from "@kitluy/device-identity";

import {
  canonicalReleaseAssignmentBytes as mirrorAssignmentBytes,
  canonicalReleaseManifestBytes as mirrorBytes,
  canonicalReleaseManifestDigest as mirrorDigest,
  findReleaseAcceptanceRefusal as mirrorAcceptance,
  verifyReleaseManifestSignature as mirrorVerify,
  type ReleaseAcceptanceContext,
  type SignedReleaseManifestBody as MirrorBody,
  type TrustedReleaseKey as MirrorKey,
} from "../src/release-verify.js";

function body(overrides: Partial<MirrorBody> = {}): MirrorBody {
  return {
    manifestVersion: 1,
    releaseId: "018f-2c31-7a4e",
    productKey: "device-shell",
    version: "0.4.12",
    buildId: "git-4f9eb00-dirty",
    architecture: "arm64",
    hardwareProfile: "KL-PI5-TERMINAL-DEV",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: "b".repeat(64),
    artifactSizeBytes: 287_744,
    minSchemaVersion: 1,
    maxSchemaVersion: 4,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: "",
    ...overrides,
  };
}

/**
 * A spread of shapes, including the awkward ones: an empty rollback target,
 * non-ASCII text, zero and very large numbers, and every channel.
 */
const CASES: readonly MirrorBody[] = [
  body(),
  body({ rollbackReleaseId: "018f-0000-0001" }),
  body({ version: "0.0.1-rc.1+build.7" }),
  body({ configPrerequisiteVersion: 9_007_199_254_740_991 }),
  body({ artifactSizeBytes: 0 }),
  body({ minSchemaVersion: 0, maxSchemaVersion: 0 }),
  body({ productKey: "device-shell.ក្រុម" }),
  ...RELEASE_CHANNELS.map((channel) => body({ channel })),
];

describe("canonical bytes do not drift", () => {
  it.each(CASES.map((entry, index) => [index, entry] as const))(
    "case %i produces identical bytes",
    (_index, manifest) => {
      expect(Buffer.from(mirrorBytes(manifest))).toEqual(
        Buffer.from(canonicalBytes(manifest as CanonicalBody)),
      );
    },
  );

  it("produces identical digests", () => {
    for (const manifest of CASES) {
      expect(mirrorDigest(manifest)).toBe(canonicalDigest(manifest as CanonicalBody));
    }
  });

  it("agrees on separator injection", () => {
    // A record separator inside a field would let the signer and the verifier
    // split the same bytes differently. Both sides must refuse to build them.
    const injected = body({ version: `1.0${String.fromCharCode(0x1e)}0` });
    expect(() => mirrorBytes(injected)).toThrow();
    expect(() => canonicalBytes(injected as CanonicalBody)).toThrow();
  });
});

describe("verification does not drift", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const manifest = body();
  const signature = Buffer.from(edSign(null, mirrorBytes(manifest), privateKey)).toString("base64");
  const envelope = { keyId: "k1", keyVersion: 1, algorithm: "ed25519" as const, signature };

  const mirrorKey: MirrorKey = {
    keyId: "k1",
    keyVersion: 1,
    publicKeyPem,
    state: "current",
    purpose: "release_signing",
  };
  // The canonical type has no `purpose` — that field is the U1 addition, and it
  // is checked in the trust LOADER, never here. Everything else must match.
  const canonicalKey: CanonicalKey = { keyId: "k1", keyVersion: 1, publicKeyPem, state: "current" };

  it("both accept a good signature", () => {
    expect(mirrorVerify(manifest, envelope, [mirrorKey])).toEqual(
      canonicalVerify(manifest as CanonicalBody, envelope, [canonicalKey]),
    );
  });

  it.each([
    ["unknown key id", { ...envelope, keyId: "other" }],
    ["wrong key version", { ...envelope, keyVersion: 2 }],
    ["wrong algorithm", { ...envelope, algorithm: "rsa" as never }],
    ["a signature of the wrong length", { ...envelope, signature: "AAAA" }],
    ["a tampered signature", { ...envelope, signature: Buffer.alloc(64).toString("base64") }],
  ])("both refuse %s identically", (_name, bad) => {
    expect(mirrorVerify(manifest, bad, [mirrorKey])).toEqual(
      canonicalVerify(manifest as CanonicalBody, bad, [canonicalKey]),
    );
  });

  it("both refuse a revoked key even with a valid signature", () => {
    expect(mirrorVerify(manifest, envelope, [{ ...mirrorKey, state: "revoked" }])).toEqual(
      canonicalVerify(manifest as CanonicalBody, envelope, [{ ...canonicalKey, state: "revoked" }]),
    );
  });

  it("both refuse a missing envelope", () => {
    expect(mirrorVerify(manifest, null, [mirrorKey])).toEqual(
      canonicalVerify(manifest as CanonicalBody, null, [canonicalKey]),
    );
  });

  it("both refuse an unsupported manifest version", () => {
    const v2 = body({ manifestVersion: 2 });
    expect(mirrorVerify(v2, envelope, [mirrorKey])).toEqual(
      canonicalVerify(v2 as CanonicalBody, envelope, [canonicalKey]),
    );
  });
});

describe("the acceptance gate does not drift", () => {
  const context: ReleaseAcceptanceContext = {
    productKey: "device-shell",
    architecture: "arm64",
    hardwareProfile: "KL-PI5-TERMINAL-DEV",
    environment: "development",
    eligibleChannels: ["internal"],
    schemaVersion: 2,
    configurationVersion: 0,
  };

  it.each([
    ["a match", body(), context],
    ["wrong product", body({ productKey: "pos" }), context],
    ["wrong architecture", body({ architecture: "amd64" }), context],
    ["wrong hardware profile", body({ hardwareProfile: "OTHER" }), context],
    ["wrong environment", body({ environment: "pilot" }), context],
    ["an ineligible channel", body({ channel: "stable" }), context],
    ["schema below range", body({ minSchemaVersion: 9, maxSchemaVersion: 9 }), context],
    ["schema above range", body({ minSchemaVersion: 0, maxSchemaVersion: 1 }), context],
    ["a configuration prerequisite", body({ configPrerequisiteVersion: 5 }), context],
    ["a size mismatch", body(), { ...context, expectedArtifactSizeBytes: 1 }],
  ])("agrees on %s", (_name, manifest, ctx) => {
    expect(mirrorAcceptance(manifest, ctx)).toBe(
      canonicalAcceptance(manifest as CanonicalBody, ctx),
    );
  });
});

/**
 * The assignment bytes have no counterpart in @kitluy/device-identity — group
 * 0222 added them on the device side and in the publisher, so the drift pair is
 * MIRROR vs PUBLISHER rather than mirror vs canonical package. That pairing is
 * checked by `pnpm release:pack:check`, which imports both.
 *
 * What is checked here is the property that makes one key safe for two message
 * types, because it is a property of these bytes alone.
 */
describe("assignment bytes are domain-separated from manifest bytes", () => {
  it("never produce the same bytes as a manifest, whatever the inputs", () => {
    const binding = {
      assignmentId: "018f-aaaa",
      deviceId: "018f-bbbb",
      releaseId: "018f-cccc",
      assignmentSequence: 7,
      environment: "development",
    };
    const assignmentBytes = Buffer.from(mirrorAssignmentBytes(binding));
    const manifestBytes = Buffer.from(mirrorBytes(body({ releaseId: "018f-cccc" })));
    expect(assignmentBytes.equals(manifestBytes)).toBe(false);
    // The tag is the first field, so they cannot even share a prefix.
    expect(assignmentBytes.subarray(0, 28).toString()).toContain("kitluy.release-assignment.v1");
    expect(manifestBytes.subarray(0, 28).toString()).toContain("kitluy.release-manifest.v1");
  });

  it("change when any bound field changes", () => {
    const base = {
      assignmentId: "a",
      deviceId: "d",
      releaseId: "r",
      assignmentSequence: 1,
      environment: "development",
    };
    const original = Buffer.from(mirrorAssignmentBytes(base));
    for (const mutation of [
      { ...base, assignmentId: "a2" },
      { ...base, deviceId: "d2" },
      { ...base, releaseId: "r2" },
      { ...base, assignmentSequence: 2 },
      { ...base, environment: "pilot" },
    ]) {
      expect(Buffer.from(mirrorAssignmentBytes(mutation)).equals(original)).toBe(false);
    }
  });

  it("refuse a separator injected into a bound field", () => {
    expect(() =>
      mirrorAssignmentBytes({
        assignmentId: `a${String.fromCharCode(0x1e)}b`,
        deviceId: "d",
        releaseId: "r",
        assignmentSequence: 1,
        environment: "development",
      }),
    ).toThrow();
  });
});
