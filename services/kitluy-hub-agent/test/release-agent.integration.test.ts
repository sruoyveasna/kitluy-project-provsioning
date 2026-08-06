/**
 * WS-11-T006-P04 — A/B installation, health verification and rollback
 * against the LIVE Hub database (group 0039).
 *
 * Adapters are production-SHAPED in-memory fakes (recorded adapter gap: no
 * Raspberry Pi boot-slot / Electron updater exists on this host); every
 * durable behavior — matrix walk, restart resume, one automatic rollback,
 * outbox/transaction preservation — runs against real relational state.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, randomUUID, sign as nodeSign } from "node:crypto";
import type pg from "pg";

import {
  canonicalReleaseManifestBytes,
  verifyReleaseManifestSignature,
  type ReleaseAcceptanceContext,
  type SignedReleaseManifestBody,
} from "@kitluy/device-identity";

import {
  hubReachable,
  pool as makePool,
  ensureRuntimeRoleMembership,
  provisionTerminal,
} from "./hub-fixtures.js";
import { withHubTransaction, HUB_RUNTIME_ROLE } from "../src/hub/db.js";
import {
  applyReleaseAssignment,
  downloadReleaseArtifact,
  provisionReleaseTrustKey,
  type ArtifactFetcher,
} from "../src/hub/release-cache.js";
import {
  beginInstallation,
  cancelInstallation,
  createHubHealthProbe,
  resumeAfterRestart,
  type GateTimings,
  type HealthProbe,
  type Slot,
  type SlotAdapter,
} from "../src/hub/release-agent.js";

const live = await hubReachable();
if (!live) console.warn("SKIPPED: release agent — local Hub database unreachable");

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const ARTIFACT = Buffer.from("release-bytes-" + "q".repeat(50_000));
const DIGEST = createHash("sha256").update(ARTIFACT).digest("hex");
const SCOPE = {
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
  schemaVersion: 40,
  configurationVersion: 3,
};
const FAST: GateTimings = { probeIntervalMs: 1, windowMs: 400, requiredConsecutive: 3 };
const instantSleep = async (): Promise<void> => {};

class FakeDevice implements SlotAdapter {
  booted: Slot = "a";
  staged = new Map<Slot, string>();
  restarts: Slot[] = [];
  disk = 10_000_000;
  failCandidateBoot = false;
  async bootedSlot(): Promise<Slot> {
    return this.booted;
  }
  async stage(slot: Slot, releaseId: string): Promise<void> {
    this.staged.set(slot, releaseId);
  }
  async verifyStaged(slot: Slot, releaseId: string): Promise<boolean> {
    return this.staged.get(slot) === releaseId;
  }
  async restartInto(slot: Slot): Promise<void> {
    this.restarts.push(slot);
    this.booted = this.failCandidateBoot && this.restarts.length === 1 ? this.booted : slot;
  }
  async availableDiskBytes(): Promise<number> {
    return this.disk;
  }
}

function fixedProbe(results: boolean[]): HealthProbe {
  let index = 0;
  return {
    async probe() {
      const healthy = results[Math.min(index, results.length - 1)] ?? false;
      index += 1;
      return { healthy, failures: healthy ? [] : ["lan_api"] };
    },
  };
}

function manifest(overrides: Partial<SignedReleaseManifestBody> = {}): SignedReleaseManifestBody {
  return {
    manifestVersion: 1,
    releaseId: randomUUID(),
    productKey: "kitluy-hub-agent",
    version: `4.0.${Math.floor(Math.random() * 100000)}`,
    buildId: "b-400",
    architecture: "arm64",
    hardwareProfile: "pi5-hub",
    environment: "development",
    channel: "internal",
    artifactDigestSha256: DIGEST,
    artifactSizeBytes: ARTIFACT.length,
    minSchemaVersion: 30,
    maxSchemaVersion: 50,
    configPrerequisiteVersion: 0,
    rollbackReleaseId: "",
    ...overrides,
  };
}

const fetcher: ArtifactFetcher = {
  async fetch(_id, offset, maxBytes) {
    return ARTIFACT.subarray(offset, offset + maxBytes);
  },
};

async function cacheRelease(p: pg.Pool, body: SignedReleaseManifestBody): Promise<string> {
  const envelope = {
    keyId: "p04-signer",
    keyVersion: 1,
    algorithm: "ed25519" as const,
    signature: nodeSign(null, canonicalReleaseManifestBytes(body), privateKey).toString("base64"),
  };
  const outcome = await applyReleaseAssignment(p, SCOPE, { manifest: body, envelope }, CONTEXT);
  if (outcome.result !== "VERIFIED")
    throw new Error(`fixture cache failed: ${JSON.stringify(outcome)}`);
  const collected = new Map<string, Uint8Array[]>();
  let r = await downloadReleaseArtifact(p, body.releaseId, fetcher, collected);
  for (let i = 0; i < 64 && r.result !== "CACHED"; i += 1) {
    r = await downloadReleaseArtifact(p, body.releaseId, fetcher, collected);
  }
  if (r.result !== "CACHED") throw new Error("fixture download failed");
  return body.releaseId;
}

async function count(p: pg.Pool, sql: string): Promise<number> {
  return withHubTransaction(
    p,
    async (c) => Number((await c.query<{ n: string }>(sql)).rows[0]?.n ?? "0"),
    HUB_RUNTIME_ROLE,
  );
}

const BACKUP = { backupId: randomUUID(), verified: true };
const NO_REVOKED = new Set<string>();

describe.skipIf(!live)("A/B installation, health gate and rollback (WS-11-T006-P04)", () => {
  let p: pg.Pool;

  beforeAll(async () => {
    p = makePool();
    await ensureRuntimeRoleMembership(p);
    await provisionReleaseTrustKey(p, {
      keyId: "p04-signer",
      keyVersion: 1,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      state: "current",
    });
  }, 300_000);

  afterAll(async () => {
    await p.end();
  });

  it("installs a Hub release end to end: stage inactive slot, restart, offline health gate, promote", async () => {
    const releaseId = await cacheRelease(p, manifest());
    const device = new FakeDevice();
    const outboxBefore = await count(p, "select count(*)::text as n from edge_sync.outbox");
    const bookingsBefore = await count(p, "select count(*)::text as n from edge_laundry.booking");

    const begun = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: "3.9.0",
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(begun.result).toBe("PENDING_RESTART");
    expect(device.staged.get("b")).toBe(releaseId); // inactive slot only
    expect(device.restarts).toEqual(["b"]);

    // "Process restart": resume purely from durable state, REAL offline probe.
    const resumed = await resumeAfterRestart(
      p,
      device,
      createHubHealthProbe(p),
      FAST,
      instantSleep,
    );
    expect(resumed.result).toBe("PROMOTED");

    const row = await withHubTransaction(
      p,
      async (c) =>
        (
          await c.query<{
            state: string;
            current_version: string;
            rollback_version: string;
            active_slot: string;
          }>(
            `select state, current_version, rollback_version, active_slot
               from edge_config.release_installation where release_cache_id = $1`,
            [releaseId],
          )
        ).rows[0],
      HUB_RUNTIME_ROLE,
    );
    expect(row?.state).toBe("current");
    expect(row?.rollback_version).toBe("3.9.0"); // tracked separately (§16)
    expect(row?.active_slot).toBe("b");

    // Queued Store transactions and outbox rows survived untouched.
    expect(await count(p, "select count(*)::text as n from edge_sync.outbox")).toBe(outboxBefore);
    expect(await count(p, "select count(*)::text as n from edge_laundry.booking")).toBe(
      bookingsBefore,
    );
  });

  it("rolls back automatically on health failure, exactly once, and blocks automatic retry", async () => {
    const releaseId = await cacheRelease(p, manifest());
    const device = new FakeDevice();
    const outboxBefore = await count(p, "select count(*)::text as n from edge_sync.outbox");

    const begun = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: "4.0.0",
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(begun.result).toBe("PENDING_RESTART");

    const resumed = await resumeAfterRestart(
      p,
      device,
      fixedProbe([true, false]),
      FAST,
      instantSleep,
    );
    expect(resumed.result).toBe("ROLLED_BACK");
    expect(device.restarts).toEqual(["b", "a"]); // candidate, then the rollback boot

    const row = await withHubTransaction(
      p,
      async (c) =>
        (
          await c.query<{ state: string; rollback_attempted: boolean }>(
            `select state, rollback_attempted from edge_config.release_installation
              where release_cache_id = $1`,
            [releaseId],
          )
        ).rows[0],
      HUB_RUNTIME_ROLE,
    );
    expect(row).toEqual({ state: "failed_rolled_back", rollback_attempted: true });

    // Automatic retry of the SAME release is blocked (§6); the outbox and
    // database were never touched (application rollback is NOT recovery).
    const retry = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: "4.0.0",
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(retry).toEqual({
      result: "REFUSED",
      refusalCode: "INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK",
    });
    expect(await count(p, "select count(*)::text as n from edge_sync.outbox")).toBe(outboxBefore);
  });

  it("refuses the §13 prechecks exactly: uncached, revoked, disk, backup, quarantine, in-progress", async () => {
    const device = new FakeDevice();
    const uncached = await beginInstallation(
      p,
      {
        releaseId: randomUUID(),
        deviceKind: "store_hub",
        currentVersion: null,
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(uncached).toEqual({ result: "REFUSED", refusalCode: "RELEASE_NOT_CACHED_AND_VERIFIED" });

    const releaseId = await cacheRelease(p, manifest());
    const revoked = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: null,
        backup: BACKUP,
        revokedReleaseIds: new Set([releaseId]),
        operatorRef: "OP-1",
      },
      device,
    );
    expect(revoked).toEqual({ result: "REFUSED", refusalCode: "RELEASE_REVOKED" });

    device.disk = 10;
    const noDisk = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: null,
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(noDisk).toEqual({ result: "REFUSED", refusalCode: "INSUFFICIENT_DISK" });
    device.disk = 10_000_000;

    const noBackup = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: null,
        backup: { backupId: randomUUID(), verified: false },
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(noBackup).toEqual({ result: "REFUSED", refusalCode: "PRE_RELEASE_BACKUP_NOT_VERIFIED" });

    // Restore quarantine forbids installation (§13).
    await withHubTransaction(
      p,
      async (c) => {
        await c.query(
          `select edge_identity.set_hub_replacement_mode_v1('restored_quarantine', null, 'p04 probe', 'OP-1', $1)`,
          [randomUUID()],
        );
      },
      HUB_RUNTIME_ROLE,
    );
    const quarantined = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: null,
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(quarantined).toEqual({
      result: "REFUSED",
      refusalCode: "INSTALL_BLOCKED_BY_REPLACEMENT_STATE",
    });
    await withHubTransaction(
      p,
      async (c) => {
        await c.query(
          `select edge_identity.set_hub_replacement_mode_v1('normal', null, 'p04 probe done', 'OP-1', $1)`,
          [randomUUID()],
        );
      },
      HUB_RUNTIME_ROLE,
    );

    // In-progress duplicate is idempotent; authorized cancel releases it.
    const begun = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: null,
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(begun.result).toBe("PENDING_RESTART");
    const dup = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "store_hub",
        currentVersion: null,
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(dup.result).toBe("ALREADY_IN_PROGRESS");
    // Drive the pending install to a terminal state so later tests are clean.
    await resumeAfterRestart(p, device, createHubHealthProbe(p), FAST, instantSleep);
  });

  it("installs a terminal release with INDEPENDENT terminal verification; the Hub cannot force an invalid one; containment blocks updates", async () => {
    const terminal = await provisionTerminal(
      p,
      `p04-${randomUUID().slice(0, 6)}`,
      "T2",
      randomUUID(),
    );
    const body = manifest({ productKey: "kitluy-terminal" });
    // Terminal-side INDEPENDENT verification with the terminal's OWN keys:
    // a Hub-tampered manifest fails the terminal's verifier outright.
    const envelope = {
      keyId: "p04-signer",
      keyVersion: 1,
      algorithm: "ed25519" as const,
      signature: nodeSign(null, canonicalReleaseManifestBytes(body), privateKey).toString("base64"),
    };
    const terminalKeys = [
      {
        keyId: "p04-signer",
        keyVersion: 1,
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        state: "current" as const,
      },
    ];
    expect(verifyReleaseManifestSignature(body, envelope, terminalKeys).verified).toBe(true);
    const forced = { ...body, version: body.version + "-forced" };
    expect(verifyReleaseManifestSignature(forced, envelope, terminalKeys)).toEqual({
      verified: false,
      failure: "SIGNATURE_INVALID",
    });

    const releaseId = await cacheRelease(p, manifest({ productKey: "kitluy-hub-agent" }));

    // Containment forbids the update (§13) until explicitly cleared.
    await withHubTransaction(
      p,
      async (c) => {
        await c.query(`set local role kitluy_sync_worker`);
        await c.query(
          `insert into edge_identity.containment_directive
             (id, device_uuid, tenant_id, digital_store_id, location_id,
              directive, directive_sequence, reason, source_ref, received_via, received_at)
           values ($1, $2, $3, $4, $5, 'operations_restricted', 1, 'p04 probe',
                   'cloud-x', 'cloud_inbox', now())`,
          [
            randomUUID(),
            terminal.terminalDeviceId,
            SCOPE.tenantId,
            SCOPE.digitalStoreId,
            SCOPE.locationId,
          ],
        );
      },
      HUB_RUNTIME_ROLE,
    );
    const device = new FakeDevice();
    const blocked = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "terminal",
        terminalDeviceId: terminal.terminalDeviceId,
        currentVersion: null,
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(blocked).toEqual({ result: "REFUSED", refusalCode: "INSTALL_BLOCKED_BY_CONTAINMENT" });

    await withHubTransaction(
      p,
      async (c) => {
        await c.query(`set local role kitluy_sync_worker`);
        await c.query(
          `insert into edge_identity.containment_directive
             (id, device_uuid, tenant_id, digital_store_id, location_id,
              directive, directive_sequence, reason, source_ref, received_via, received_at)
           values ($1, $2, $3, $4, $5, 'cleared', 2, 'p04 probe cleared',
                   'cloud-y', 'cloud_inbox', now())`,
          [
            randomUUID(),
            terminal.terminalDeviceId,
            SCOPE.tenantId,
            SCOPE.digitalStoreId,
            SCOPE.locationId,
          ],
        );
      },
      HUB_RUNTIME_ROLE,
    );
    const begun = await beginInstallation(
      p,
      {
        releaseId,
        deviceKind: "terminal",
        terminalDeviceId: terminal.terminalDeviceId,
        currentVersion: "1.0.0",
        backup: BACKUP,
        revokedReleaseIds: NO_REVOKED,
        operatorRef: "OP-1",
      },
      device,
    );
    expect(begun.result).toBe("PENDING_RESTART");
    const resumed = await resumeAfterRestart(
      p,
      device,
      fixedProbe([true, true, true]),
      FAST,
      instantSleep,
    );
    expect(resumed.result).toBe("PROMOTED");
  });

  it("supports authorized cancel before restart, never after", async () => {
    const releaseId = await cacheRelease(p, manifest());
    const installationId = randomUUID();
    await withHubTransaction(
      p,
      async (c) => {
        await c.query(
          `insert into edge_config.release_installation
             (id, release_cache_id, device_kind, tenant_id, digital_store_id,
              location_id, candidate_version)
           values ($1, $2, 'store_hub', $3, $4, $5, '9.9.9')`,
          [installationId, releaseId, SCOPE.tenantId, SCOPE.digitalStoreId, SCOPE.locationId],
        );
      },
      HUB_RUNTIME_ROLE,
    );
    expect(await cancelInstallation(p, installationId, "OP-2", "operator pause")).toEqual({
      result: "CANCELLED",
    });
    expect(await cancelInstallation(p, installationId, "OP-2", "again")).toEqual({
      result: "NOT_CANCELLABLE",
    });
  });
});
