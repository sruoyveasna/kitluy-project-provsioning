/**
 * OFFLINE REVOCATION ENFORCEMENT on the Store Hub.
 *
 * WS-11-T003 Step 4 §6/§7; KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001.
 *
 * Runs against the real `kitluy_hub_local` database with NO cloud connection of
 * any kind — that is the point. A snapshot is signed with an ephemeral key,
 * delivered, verified, persisted, and then consulted exactly as a Hub would
 * consult it while the internet is down.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalSnapshotBytes,
  signCanonicalBytesWithPem,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_SIGNATURE_ALGORITHM,
  type SignedRevocationSnapshot,
  type TrustedSnapshotKey,
} from "@kitluy/device-identity";

import { createHubPool, isHubDatabaseReachable, type HubPool } from "../src/hub/db.js";
import {
  applySignedSnapshot,
  decideOffline,
  isCertificateRevokedOffline,
  loadTrustedKeys,
  provisionTrustKey,
  readHeldState,
  type HubScopeIdentity,
} from "../src/hub/revocation-trust.js";

const reachable = await isHubDatabaseReachable();
if (!reachable) {
  console.warn("SKIPPED: hub offline revocation suite — kitluy_hub_local unreachable");
}

const KEY_ID = `offline-suite-${randomUUID().slice(0, 8)}`;
const REVOKED_SERIAL = "DEV-OFFLINE-REVOKED-0001";
const LIVE_SERIAL = "DEV-OFFLINE-LIVE-0002";

/** EPHEMERAL, per run. No key material is committed anywhere. */
const pair = generateKeyPairSync("ed25519");
const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

function hubScope(): HubScopeIdentity {
  const suffix = randomUUID();
  return {
    tenantId: suffix,
    digitalStoreId: randomUUID(),
    storeLocationId: randomUUID(),
    environment: "development",
    hubDeviceId: randomUUID(),
  };
}

function sign(body: Omit<SignedRevocationSnapshot, "signature">, keyVersion = 1) {
  return {
    ...body,
    signature: {
      keyId: KEY_ID,
      keyVersion,
      algorithm: SNAPSHOT_SIGNATURE_ALGORITHM,
      signature: signCanonicalBytesWithPem(canonicalSnapshotBytes(body), privateKeyPem),
    },
  } satisfies SignedRevocationSnapshot;
}

function snapshotFor(
  hub: HubScopeIdentity,
  options: {
    readonly sequence: number;
    readonly serials?: readonly string[];
    readonly watermark?: string;
    readonly generatedAt?: string;
    readonly schemaVersion?: number;
    readonly snapshotVersion?: number;
  },
): SignedRevocationSnapshot {
  return sign({
    schemaVersion: options.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION,
    scope: {
      tenantId: hub.tenantId,
      digitalStoreId: hub.digitalStoreId,
      storeLocationId: hub.storeLocationId,
      environment: hub.environment,
    },
    hubDeviceRecordId: hub.hubDeviceId,
    snapshotVersion: options.snapshotVersion ?? options.sequence,
    sequence: options.sequence,
    revocationWatermark: options.watermark ?? "2026-07-31T00:00:00.000Z",
    generatedAt: options.generatedAt ?? "2026-07-31T00:00:00.000Z",
    effectiveAt: options.generatedAt ?? "2026-07-31T00:00:00.000Z",
    revokedCertificateSerials: [...(options.serials ?? [REVOKED_SERIAL])],
    revokedDeviceRecordIds: [],
  });
}

describe.skipIf(!reachable)("a Store Hub enforces revocation while offline", () => {
  let pool: HubPool;
  let trusted: TrustedSnapshotKey[] = [];
  let hub: HubScopeIdentity;

  beforeAll(async () => {
    pool = createHubPool();
    await provisionTrustKey(pool, {
      keyId: KEY_ID,
      keyVersion: 1,
      publicKeyPem,
      state: "current",
      activatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    trusted = await loadTrustedKeys(pool);
  }, 120_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
  });

  beforeEach(() => {
    // A FRESH scope per test. Each behaves as its own Hub, so nothing one test
    // applies can be mistaken for another test's last-known-good.
    hub = hubScope();
  });

  it("holds NOTHING before a snapshot arrives, and says so", async () => {
    const held = await readHeldState(pool, hub);
    expect(held.hasSnapshot).toBe(false);
    // REFUSE, not ALLOW. A Hub that has never been told anything cannot honestly
    // say a credential is unrevoked.
    const decision = await decideOffline(pool, hub, LIVE_SERIAL, {
      now: new Date(),
      maxAgeHours: 720,
    });
    expect(decision).toEqual({ decision: "REFUSE", reason: "NO_SNAPSHOT_HELD" });
  });

  it("DENIES a revoked credential with no network in play", async () => {
    const applied = await applySignedSnapshot(
      pool,
      hub,
      snapshotFor(hub, { sequence: 1 }),
      trusted,
    );
    expect(applied.applied).toBe(true);

    expect(await isCertificateRevokedOffline(pool, hub, REVOKED_SERIAL)).toBe(true);
    const decision = await decideOffline(pool, hub, REVOKED_SERIAL, {
      now: new Date("2026-07-31T01:00:00.000Z"),
      maxAgeHours: 720,
    });
    expect(decision).toEqual({ decision: "DENY", reason: "REVOKED_IN_SNAPSHOT" });
  });

  it("ALLOWS a credential that is not in the list, and reports staleness honestly", async () => {
    await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 1 }), trusted);

    const fresh = await decideOffline(pool, hub, LIVE_SERIAL, {
      now: new Date("2026-07-31T01:00:00.000Z"),
      maxAgeHours: 720,
    });
    expect(fresh).toMatchObject({ decision: "ALLOW", stale: false });

    // §6.7: an old snapshot is not current cloud truth. §6.1: what it says is
    // still enforced. Both, at once.
    const old = await decideOffline(pool, hub, LIVE_SERIAL, {
      now: new Date("2026-09-30T00:00:00.000Z"),
      maxAgeHours: 24,
    });
    expect(old).toMatchObject({ decision: "ALLOW", stale: true });
    expect(await isCertificateRevokedOffline(pool, hub, REVOKED_SERIAL)).toBe(true);
  });

  it("REFUSES an unsigned or badly signed snapshot and keeps the last-known-good", async () => {
    await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 1 }), trusted);

    const forged = snapshotFor(hub, { sequence: 2, serials: [] });
    const tampered: SignedRevocationSnapshot = {
      ...forged,
      // Drop the revoked serial AFTER signing: the classic un-revoke attempt.
      signature: { ...forged.signature, signature: Buffer.alloc(64).toString("base64") },
    };
    const outcome = await applySignedSnapshot(pool, hub, tampered, trusted);
    expect(outcome).toMatchObject({
      applied: false,
      reason: "SIGNATURE_INVALID",
      lastKnownGoodPreserved: true,
    });
    // AND THE REVOCATION STILL STANDS.
    expect(await isCertificateRevokedOffline(pool, hub, REVOKED_SERIAL)).toBe(true);
  });

  it("REFUSES an unknown key and a REVOKED key", async () => {
    const other = generateKeyPairSync("ed25519");
    const otherTrusted: TrustedSnapshotKey[] = [
      {
        keyId: KEY_ID,
        keyVersion: 1,
        publicKeyPem: other.publicKey.export({ type: "spki", format: "pem" }).toString(),
        state: "current",
      },
    ];
    expect(
      await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 1 }), otherTrusted),
    ).toMatchObject({ applied: false, reason: "SIGNATURE_INVALID" });

    expect(
      await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 1 }), []),
    ).toMatchObject({ applied: false, reason: "SIGNING_KEY_UNKNOWN" });

    expect(
      await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 1 }), [
        { keyId: KEY_ID, keyVersion: 1, publicKeyPem, state: "revoked" },
      ]),
    ).toMatchObject({ applied: false, reason: "SIGNING_KEY_REVOKED" });
  });

  it("REFUSES every cross-scope snapshot", async () => {
    const cases: ReadonlyArray<readonly [string, HubScopeIdentity]> = [
      ["SCOPE_TENANT_MISMATCH", { ...hub, tenantId: randomUUID() }],
      ["SCOPE_STORE_MISMATCH", { ...hub, digitalStoreId: randomUUID() }],
      ["SCOPE_LOCATION_MISMATCH", { ...hub, storeLocationId: randomUUID() }],
      ["SCOPE_ENVIRONMENT_MISMATCH", { ...hub, environment: "production" }],
      ["SCOPE_HUB_MISMATCH", { ...hub, hubDeviceId: randomUUID() }],
    ];
    for (const [reason, foreignScope] of cases) {
      // Signed correctly FOR THE OTHER SCOPE — a real snapshot, just not ours.
      const foreign = snapshotFor(foreignScope, { sequence: 1 });
      const outcome = await applySignedSnapshot(pool, hub, foreign, trusted);
      expect(outcome, reason).toMatchObject({ applied: false, reason });
    }
    // Nothing was written by any of them.
    expect((await readHeldState(pool, hub)).hasSnapshot).toBe(false);
  });

  it("REFUSES an unsupported schema version and a malformed payload", async () => {
    expect(
      await applySignedSnapshot(
        pool,
        hub,
        snapshotFor(hub, { sequence: 1, schemaVersion: 99 }),
        trusted,
      ),
    ).toMatchObject({ applied: false, reason: "SCHEMA_VERSION_UNSUPPORTED" });

    const malformed = snapshotFor(hub, { sequence: 1 });
    expect(
      await applySignedSnapshot(
        pool,
        hub,
        { ...malformed, revokedCertificateSerials: ["  "] },
        trusted,
      ),
    ).toMatchObject({ applied: false, reason: "PAYLOAD_MALFORMED" });
  });

  it("REFUSES a sequence rollback — replaying yesterday's list cannot un-revoke", async () => {
    await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 5 }), trusted);

    // A perfectly signed, correctly scoped snapshot that simply omits the
    // revocation and carries an older sequence.
    const replay = snapshotFor(hub, { sequence: 4, serials: [] });
    expect(await applySignedSnapshot(pool, hub, replay, trusted)).toMatchObject({
      applied: false,
      reason: "SEQUENCE_NOT_NEWER",
      lastKnownGoodPreserved: true,
    });
    const same = snapshotFor(hub, { sequence: 5, serials: [] });
    expect(await applySignedSnapshot(pool, hub, same, trusted)).toMatchObject({
      applied: false,
      reason: "SEQUENCE_NOT_NEWER",
    });
    expect(await isCertificateRevokedOffline(pool, hub, REVOKED_SERIAL)).toBe(true);
  });

  it("REFUSES a watermark rollback even when the sequence advances", async () => {
    await applySignedSnapshot(
      pool,
      hub,
      snapshotFor(hub, { sequence: 1, watermark: "2026-07-31T00:00:00.000Z" }),
      trusted,
    );
    const regressed = snapshotFor(hub, {
      sequence: 2,
      serials: [],
      watermark: "2026-07-01T00:00:00.000Z",
    });
    expect(await applySignedSnapshot(pool, hub, regressed, trusted)).toMatchObject({
      applied: false,
      reason: "WATERMARK_ROLLBACK",
      lastKnownGoodPreserved: true,
    });
    expect(await isCertificateRevokedOffline(pool, hub, REVOKED_SERIAL)).toBe(true);
  });

  it("APPLIES a genuinely newer snapshot and supersedes the old one atomically", async () => {
    await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 1 }), trusted);
    const newer = snapshotFor(hub, {
      sequence: 2,
      serials: [REVOKED_SERIAL, "DEV-OFFLINE-REVOKED-0003"],
      watermark: "2026-08-01T00:00:00.000Z",
    });
    expect(await applySignedSnapshot(pool, hub, newer, trusted)).toMatchObject({ applied: true });

    const held = await readHeldState(pool, hub);
    expect(held.sequence).toBe(2);
    expect(held.entryCount).toBe(2);
    expect(await isCertificateRevokedOffline(pool, hub, "DEV-OFFLINE-REVOKED-0003")).toBe(true);
    // The original revocation is still enforced — a newer snapshot GROWS the set.
    expect(await isCertificateRevokedOffline(pool, hub, REVOKED_SERIAL)).toBe(true);

    // Exactly one active row per scope, which is what makes the swap atomic.
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_config.revocation_snapshot
        where state = 'active' and tenant_id = $1::uuid`,
      [hub.tenantId],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("SURVIVES a restart: a brand-new pool still denies the revoked credential", async () => {
    await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 1 }), trusted);

    // A restart is modelled as what it actually is — the process goes away and a
    // new one connects to the same durable database. No in-memory state carries
    // over, and nothing is re-fetched from a cloud that is not there.
    const rebooted = createHubPool();
    try {
      const keysAfterReboot = await loadTrustedKeys(rebooted);
      expect(keysAfterReboot.some((k) => k.keyId === KEY_ID)).toBe(true);

      expect(await isCertificateRevokedOffline(rebooted, hub, REVOKED_SERIAL)).toBe(true);
      const decision = await decideOffline(rebooted, hub, REVOKED_SERIAL, {
        now: new Date("2026-07-31T02:00:00.000Z"),
        maxAgeHours: 720,
      });
      expect(decision).toEqual({ decision: "DENY", reason: "REVOKED_IN_SNAPSHOT" });
    } finally {
      await rebooted.end().catch(() => undefined);
    }
  });

  it("RECONNECTION cannot resurrect a revoked credential", async () => {
    await applySignedSnapshot(pool, hub, snapshotFor(hub, { sequence: 1 }), trusted);

    // The Hub comes back online and the cloud sends a newer, correctly signed
    // snapshot that no longer lists the serial. The sequence advances and the
    // watermark advances, so nothing structural refuses it — this is the
    // legitimate "cloud says it is no longer revoked" case.
    const reconnect = snapshotFor(hub, {
      sequence: 2,
      serials: [],
      watermark: "2026-08-01T00:00:00.000Z",
    });
    const outcome = await applySignedSnapshot(pool, hub, reconnect, trusted);
    expect(outcome.applied).toBe(true);

    // AND THE CREDENTIAL IS STILL DENIED. Revocation is irreversible (decision
    // §2.4 RULING 3), so the Hub's enforced set only ever grows: the superseded
    // snapshot's entries remain in force.
    expect(await isCertificateRevokedOffline(pool, hub, REVOKED_SERIAL)).toBe(true);
    expect(
      await decideOffline(pool, hub, REVOKED_SERIAL, {
        now: new Date("2026-08-01T01:00:00.000Z"),
        maxAgeHours: 720,
      }),
    ).toEqual({ decision: "DENY", reason: "REVOKED_IN_SNAPSHOT" });
  });
});
