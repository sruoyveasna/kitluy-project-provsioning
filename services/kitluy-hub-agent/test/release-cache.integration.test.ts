/**
 * WS-11-T006-P03 — Hub release verification and artifact cache against the
 * LIVE Hub database (group 0038). Downloads run through an offset-addressed
 * fetcher, so interruption/resume is real; no cloud endpoint exists anywhere
 * in the path (WAN loss changes nothing once the assignment arrived).
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign as nodeSign } from "node:crypto";
import type pg from "pg";

import {
  canonicalReleaseManifestBytes,
  type ReleaseAcceptanceContext,
  type ReleaseSignatureEnvelope,
  type SignedReleaseManifestBody,
} from "@kitluy/device-identity";

import { hubReachable, pool as makePool, ensureRuntimeRoleMembership } from "./hub-fixtures.js";
import { withHubTransaction, HUB_RUNTIME_ROLE } from "../src/hub/db.js";
import {
  applyReleaseAssignment,
  downloadReleaseArtifact,
  provisionReleaseTrustKey,
  type ArtifactFetcher,
  type HubScope,
} from "../src/hub/release-cache.js";

const live = await hubReachable();
if (!live) console.warn("SKIPPED: release cache — local Hub database unreachable");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const ARTIFACT = Buffer.from("kitluy-release-artifact-" + "z".repeat(200_000));
const DIGEST = createHash("sha256").update(ARTIFACT).digest("hex");

const SCOPE: HubScope = {
  tenantId: "e0000000-0000-4000-8000-000000000001",
  digitalStoreId: "e0000000-0000-4000-8000-000000000002",
  locationId: "e0000000-0000-4000-8000-000000000003",
};

const CONTEXT: ReleaseAcceptanceContext = {
  productKey: "kitluy-hub-agent",
  architecture: "arm64",
  hardwareProfile: "pi5-hub",
  environment: "development",
  eligibleChannels: ["internal"],
  schemaVersion: 38,
  configurationVersion: 3,
};

function manifest(overrides: Partial<SignedReleaseManifestBody> = {}): SignedReleaseManifestBody {
  return {
    manifestVersion: 1,
    releaseId: randomUUID(),
    productKey: "kitluy-hub-agent",
    version: `2.0.${Math.floor(Math.random() * 100000)}`,
    buildId: "b-100",
    architecture: "arm64",
    hardwareProfile: "pi5-hub",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: DIGEST,
    artifactSizeBytes: ARTIFACT.length,
    minSchemaVersion: 30,
    maxSchemaVersion: 45,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: "",
    ...overrides,
  };
}

function sign(body: SignedReleaseManifestBody, keyVersion = 1): ReleaseSignatureEnvelope {
  return {
    keyId: "dev-release-signer",
    keyVersion,
    algorithm: "ed25519",
    signature: nodeSign(null, canonicalReleaseManifestBytes(body), privateKey).toString("base64"),
  };
}

function fetcherFor(bytes: Buffer, failAfter = Number.POSITIVE_INFINITY): ArtifactFetcher {
  let calls = 0;
  return {
    async fetch(_releaseId, offset, maxBytes) {
      calls += 1;
      if (calls > failAfter) return null; // simulated interruption
      return bytes.subarray(offset, offset + maxBytes);
    },
  };
}

describe.skipIf(!live)("hub release trust and artifact cache (WS-11-T006-P03)", () => {
  let p: pg.Pool;

  beforeAll(async () => {
    p = makePool();
    await ensureRuntimeRoleMembership(p);
    await provisionReleaseTrustKey(p, {
      keyId: "dev-release-signer",
      keyVersion: 1,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      state: "current",
    });
    await provisionReleaseTrustKey(p, {
      keyId: "dev-release-signer",
      keyVersion: 9,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      state: "revoked",
    });
  }, 300_000);

  afterAll(async () => {
    await p.end();
  });

  it("verifies, downloads with resume, and caches a valid signed release; duplicates are one effect", async () => {
    const body = manifest();
    const outcome = await applyReleaseAssignment(
      p,
      SCOPE,
      { manifest: body, envelope: sign(body) },
      CONTEXT,
    );
    expect(outcome.result).toBe("VERIFIED");

    const dup = await applyReleaseAssignment(
      p,
      SCOPE,
      { manifest: body, envelope: sign(body) },
      CONTEXT,
    );
    expect(dup.result).toBe("DUPLICATE_IGNORED");

    // Interrupted download: two chunks land, the third call is a network
    // failure (null), then a FRESH call resumes from the durable offset.
    const collected = new Map<string, Uint8Array[]>();
    const flaky = fetcherFor(ARTIFACT, 2);
    let r = await downloadReleaseArtifact(p, body.releaseId, flaky, collected);
    expect(r.result).toBe("IN_PROGRESS");
    r = await downloadReleaseArtifact(p, body.releaseId, flaky, collected);
    expect(r.result).toBe("IN_PROGRESS");
    r = await downloadReleaseArtifact(p, body.releaseId, flaky, collected); // interruption
    expect(r.result).toBe("IN_PROGRESS");
    const steady = fetcherFor(ARTIFACT);
    for (let i = 0; i < 64 && r.result !== "CACHED"; i += 1) {
      r = await downloadReleaseArtifact(p, body.releaseId, steady, collected);
    }
    expect(r.result).toBe("CACHED");

    // Restart-shape: durable state alone answers; a fresh call sees cached.
    const again = await downloadReleaseArtifact(p, body.releaseId, steady, new Map());
    expect(again.result).toBe("CACHED");
  });

  it("rejects tampered manifests, wrong scope/hardware, revoked keys — durably", async () => {
    const body = manifest();
    const envelope = sign(body);
    const tampered = { ...body, version: body.version + "-evil" };
    const rej = await applyReleaseAssignment(p, SCOPE, { manifest: tampered, envelope }, CONTEXT);
    expect(rej).toMatchObject({ result: "REJECTED", refusalCode: "SIGNATURE_INVALID" });

    const wrongArch = manifest({ architecture: "x64" });
    const rej2 = await applyReleaseAssignment(
      p,
      SCOPE,
      { manifest: wrongArch, envelope: sign(wrongArch) },
      CONTEXT,
    );
    expect(rej2).toMatchObject({ result: "REJECTED", refusalCode: "RELEASE_WRONG_ARCHITECTURE" });

    const revokedKey = manifest();
    const rej3 = await applyReleaseAssignment(
      p,
      SCOPE,
      { manifest: revokedKey, envelope: sign(revokedKey, 9) },
      CONTEXT,
    );
    expect(rej3).toMatchObject({ result: "REJECTED", refusalCode: "SIGNING_KEY_REVOKED" });

    // The rejection is durable and FINAL (0038 trigger).
    const rows = await withHubTransaction(
      p,
      async (c) =>
        (
          await c.query<{ state: string; refusal_code: string }>(
            `select state, refusal_code from edge_config.release_cache where id = $1`,
            [tampered.releaseId],
          )
        ).rows,
      HUB_RUNTIME_ROLE,
    );
    expect(rows[0]).toEqual({ state: "rejected", refusal_code: "SIGNATURE_INVALID" });
  });

  it("refuses a wrong-digest artifact at download completion", async () => {
    const body = manifest({ artifactDigestSha256: "f".repeat(64) });
    const outcome = await applyReleaseAssignment(
      p,
      SCOPE,
      { manifest: body, envelope: sign(body) },
      CONTEXT,
    );
    expect(outcome.result).toBe("VERIFIED");
    const collected = new Map<string, Uint8Array[]>();
    let r = await downloadReleaseArtifact(p, body.releaseId, fetcherFor(ARTIFACT), collected);
    for (let i = 0; i < 64 && r.result === "IN_PROGRESS"; i += 1) {
      r = await downloadReleaseArtifact(p, body.releaseId, fetcherFor(ARTIFACT), collected);
    }
    expect(r.result).toBe("DIGEST_MISMATCH"); // metadata never trusted
  });
});
