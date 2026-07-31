/**
 * Store Hub trust and persistence for signed revocation snapshots.
 *
 * Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001 (owner-locked);
 * KLD-2026-07-28-002 §6.1 / §6.7; Hub migration 0027; WS-11-T003 Step 4 §6/§7.
 *
 * ===========================================================================
 * WHAT THIS CLOSES
 * ===========================================================================
 * The cloud produces scope-isolated, Ed25519-signed snapshots. Until now nothing
 * on the Hub could hold one, so a Hub that lost connectivity enforced NOTHING —
 * offline containment existed as a shape in the code and not as behaviour.
 *
 * ===========================================================================
 * VERIFY, THEN PROMOTE. NEVER PROMOTE THEN VERIFY.
 * ===========================================================================
 * An arriving snapshot is written `staged`, checked, and only then promoted to
 * `active` in the SAME transaction that demotes its predecessor. A partial unique
 * index permits at most one `active` row per scope, so the swap is atomic and
 * last-known-good is structural rather than a backup someone has to remember to
 * take. Every rejection path returns before any promotion, so a refused update
 * cannot disturb what the Hub already enforces.
 *
 * Nothing is ever deleted. A rejected snapshot is retained as `rejected` and a
 * replaced one as `superseded`, because "what did this Hub believe, and when" is a
 * question an incident asks months later.
 *
 * PostgreSQL does not verify Ed25519. Verification is TypeScript
 * (`verifySnapshotSignature`); the database stores what was verified and enforces
 * the state machine around it.
 */
import { createHash, randomUUID } from "node:crypto";

import {
  canonicalSnapshotBytes,
  SNAPSHOT_SCHEMA_VERSION,
  verifySnapshotSignature,
  type SignedRevocationSnapshot,
  type TrustedSnapshotKey,
} from "@kitluy/device-identity";

import { withHubTransaction, type HubClient, type HubPool } from "./db.js";

/** The scope this Hub is provisioned for. Compared against every snapshot. */
export interface HubScopeIdentity {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: string;
  readonly hubDeviceId: string;
}

export type SnapshotRejectionReason =
  | "SIGNATURE_ALGORITHM_UNSUPPORTED"
  | "SIGNATURE_MALFORMED"
  | "SIGNATURE_INVALID"
  | "SIGNING_KEY_UNKNOWN"
  | "SIGNING_KEY_REVOKED"
  /** No signature envelope at all, rather than a bad one. */
  | "SIGNATURE_MISSING"
  /**
   * A field or identifier carries a canonical separator, so these bytes are
   * reachable from more than one body and a signature over them binds neither.
   * Refused BEFORE any cryptography.
   */
  | "SNAPSHOT_SEPARATOR_INJECTION"
  | "SCOPE_TENANT_MISMATCH"
  | "SCOPE_STORE_MISMATCH"
  | "SCOPE_LOCATION_MISMATCH"
  | "SCOPE_ENVIRONMENT_MISMATCH"
  | "SCOPE_HUB_MISMATCH"
  | "SCHEMA_VERSION_UNSUPPORTED"
  | "PAYLOAD_MALFORMED"
  | "SEQUENCE_NOT_NEWER"
  | "WATERMARK_ROLLBACK";

export type ApplySnapshotOutcome =
  | { readonly applied: true; readonly snapshotId: string; readonly sequence: number }
  | {
      readonly applied: false;
      readonly reason: SnapshotRejectionReason;
      /** TRUE whenever a previously applied snapshot is still enforced. */
      readonly lastKnownGoodPreserved: boolean;
    };

export interface HeldRevocationState {
  readonly hasSnapshot: boolean;
  readonly sequence: number | null;
  readonly snapshotVersion: number | null;
  readonly generatedAt: Date | null;
  readonly revocationWatermark: string | null;
  readonly entryCount: number;
}

/** Reads the trusted PUBLIC keys. The Hub never holds a private signing key. */
export async function loadTrustedKeys(pool: HubPool): Promise<TrustedSnapshotKey[]> {
  return withHubTransaction(pool, async (client) => {
    const { rows } = await client.query<{
      key_id: string;
      key_version: number;
      public_key_pem: string;
      state: string;
    }>(
      `select key_id, key_version, public_key_pem, state
         from edge_config.revocation_trust_key
        order by key_id, key_version`,
    );
    return rows.map((row) => ({
      keyId: row.key_id,
      keyVersion: Number(row.key_version),
      publicKeyPem: row.public_key_pem,
      state: row.state as TrustedSnapshotKey["state"],
    }));
  });
}

export interface ProvisionTrustKeyInput {
  readonly keyId: string;
  readonly keyVersion: number;
  readonly publicKeyPem: string;
  readonly state: "current" | "next" | "revoked";
  readonly activatedAt: Date;
}

/**
 * Provisions a trusted public key.
 *
 * `current` and `next` together are what make rotation bounded: the next key is
 * installed before it is used, so the cloud can switch signing keys without a
 * visit to the shop, and a Hub that is briefly behind still verifies both.
 */
export async function provisionTrustKey(
  pool: HubPool,
  input: ProvisionTrustKeyInput,
): Promise<void> {
  await withHubTransaction(pool, async (client) => {
    await client.query(
      `insert into edge_config.revocation_trust_key
         (key_id, key_version, algorithm, public_key_pem, state, activated_at, revoked_at)
       values ($1, $2, 'ed25519', $3, $4, $5, case when $4 = 'revoked' then now() else null end)
       on conflict (key_id, key_version) do update
         set state = excluded.state,
             public_key_pem = excluded.public_key_pem,
             revoked_at = case when excluded.state = 'revoked' then now() else null end`,
      [input.keyId, input.keyVersion, input.publicKeyPem, input.state, input.activatedAt],
    );
  });
}

function scopeRejection(
  snapshot: SignedRevocationSnapshot,
  hub: HubScopeIdentity,
): SnapshotRejectionReason | null {
  if (snapshot.scope.tenantId !== hub.tenantId) return "SCOPE_TENANT_MISMATCH";
  if (snapshot.scope.digitalStoreId !== hub.digitalStoreId) return "SCOPE_STORE_MISMATCH";
  if (snapshot.scope.storeLocationId !== hub.storeLocationId) return "SCOPE_LOCATION_MISMATCH";
  if (snapshot.scope.environment !== hub.environment) return "SCOPE_ENVIRONMENT_MISMATCH";
  // Bound to THIS Hub, not merely to its Store. Two Hubs in one Location must not
  // be able to consume each other's snapshots.
  if (snapshot.hubDeviceRecordId !== hub.hubDeviceId) return "SCOPE_HUB_MISMATCH";
  return null;
}

function payloadRejection(snapshot: SignedRevocationSnapshot): SnapshotRejectionReason | null {
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) return "SCHEMA_VERSION_UNSUPPORTED";
  if (!Array.isArray(snapshot.revokedCertificateSerials)) return "PAYLOAD_MALFORMED";
  if (!Array.isArray(snapshot.revokedDeviceRecordIds)) return "PAYLOAD_MALFORMED";
  if (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0) return "PAYLOAD_MALFORMED";
  if (!Number.isInteger(snapshot.snapshotVersion) || snapshot.snapshotVersion < 1) {
    return "PAYLOAD_MALFORMED";
  }
  for (const value of [...snapshot.revokedCertificateSerials, ...snapshot.revokedDeviceRecordIds]) {
    if (typeof value !== "string" || value.trim() === "") return "PAYLOAD_MALFORMED";
  }
  if (Number.isNaN(Date.parse(snapshot.generatedAt))) return "PAYLOAD_MALFORMED";
  if (Number.isNaN(Date.parse(snapshot.effectiveAt))) return "PAYLOAD_MALFORMED";
  return null;
}

/**
 * Verifies and applies a snapshot, or refuses it without touching what is held.
 *
 * Ordering is the security property. Signature and scope are checked BEFORE the
 * row is written, sequence and watermark are checked against the currently active
 * row INSIDE the transaction that would promote, and promotion happens last.
 */
export async function applySignedSnapshot(
  pool: HubPool,
  hub: HubScopeIdentity,
  snapshot: SignedRevocationSnapshot,
  trustedKeys: readonly TrustedSnapshotKey[],
): Promise<ApplySnapshotOutcome> {
  const held = await readHeldState(pool, hub);
  const preserved = held.hasSnapshot;

  const structural = payloadRejection(snapshot);
  if (structural !== null) {
    return { applied: false, reason: structural, lastKnownGoodPreserved: preserved };
  }

  // SCOPE BEFORE SIGNATURE, deliberately. A snapshot for another Store is refused
  // without spending a verification, and — more importantly — a foreign snapshot
  // never reaches the code that would write it down.
  const scopeFailure = scopeRejection(snapshot, hub);
  if (scopeFailure !== null) {
    return { applied: false, reason: scopeFailure, lastKnownGoodPreserved: preserved };
  }

  const verdict = verifySnapshotSignature(snapshot, snapshot.signature, trustedKeys);
  if (!verdict.verified) {
    return { applied: false, reason: verdict.failure, lastKnownGoodPreserved: preserved };
  }

  const canonical = canonicalSnapshotBytes(snapshot);
  const digest = createHash("sha256").update(canonical).digest("hex");

  return withHubTransaction(pool, async (client) => {
    // Re-read the active row INSIDE the transaction and lock it. Two deliveries
    // racing must not both decide they are newer.
    const current = await client.query<{
      id: string;
      sequence_no: string;
      revocation_watermark: string;
    }>(
      `select id::text, sequence_no::text, revocation_watermark
         from edge_config.revocation_snapshot
        where state = 'active'
          and tenant_id = $1::uuid and digital_store_id = $2::uuid
          and store_location_id = $3::uuid and environment = $4
        for update`,
      [hub.tenantId, hub.digitalStoreId, hub.storeLocationId, hub.environment],
    );
    const active = current.rows[0];

    if (active !== undefined) {
      if (snapshot.sequence <= Number(active.sequence_no)) {
        // Replaying an older list is the simplest way to undo a revocation.
        return {
          applied: false as const,
          reason: "SEQUENCE_NOT_NEWER" as const,
          lastKnownGoodPreserved: true,
        };
      }
      if (snapshot.revocationWatermark < active.revocation_watermark) {
        // A newer sequence carrying an OLDER watermark means the producer read
        // stale state. Refused rather than merged: the Hub cannot tell which
        // entries the regression dropped.
        return {
          applied: false as const,
          reason: "WATERMARK_ROLLBACK" as const,
          lastKnownGoodPreserved: true,
        };
      }
    }

    const id = randomUUID();
    await client.query(
      `insert into edge_config.revocation_snapshot
         (id, tenant_id, digital_store_id, store_location_id, environment, hub_device_id,
          schema_version, snapshot_version, sequence_no, revocation_watermark,
          generated_at, effective_at, canonical_sha256,
          signing_key_id, signing_key_version, signature_b64, state)
       values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid,
               $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'staged')`,
      [
        id,
        hub.tenantId,
        hub.digitalStoreId,
        hub.storeLocationId,
        hub.environment,
        hub.hubDeviceId,
        snapshot.schemaVersion,
        snapshot.snapshotVersion,
        snapshot.sequence,
        snapshot.revocationWatermark,
        snapshot.generatedAt,
        snapshot.effectiveAt,
        digest,
        snapshot.signature.keyId,
        snapshot.signature.keyVersion,
        snapshot.signature.signature,
      ],
    );

    for (const [kind, values] of [
      ["certificate_serial", snapshot.revokedCertificateSerials],
      ["device_record", snapshot.revokedDeviceRecordIds],
    ] as const) {
      for (const identifier of values) {
        await client.query(
          `insert into edge_config.revocation_snapshot_entry (snapshot_id, entry_kind, identifier)
           values ($1::uuid, $2, $3) on conflict do nothing`,
          [id, kind, identifier],
        );
      }
    }

    // PROMOTE. Demote first so the partial unique index is never violated; both
    // statements are in this transaction, so a failure leaves the old row active.
    if (active !== undefined) {
      await client.query(
        `update edge_config.revocation_snapshot
            set state = 'superseded', superseded_at = now()
          where id = $1::uuid`,
        [active.id],
      );
    }
    await client.query(
      `update edge_config.revocation_snapshot
          set state = 'active', applied_at = now()
        where id = $1::uuid`,
      [id],
    );

    return { applied: true as const, snapshotId: id, sequence: snapshot.sequence };
  });
}

/** What this Hub currently holds. Used to report stale state honestly. */
export async function readHeldState(
  pool: HubPool,
  hub: HubScopeIdentity,
): Promise<HeldRevocationState> {
  return withHubTransaction(pool, async (client) => readHeldStateOn(client, hub));
}

async function readHeldStateOn(
  client: HubClient,
  hub: HubScopeIdentity,
): Promise<HeldRevocationState> {
  const { rows } = await client.query<{
    has_snapshot: boolean;
    sequence_no: string | null;
    snapshot_version: string | null;
    generated_at: Date | null;
    revocation_watermark: string | null;
    entry_count: string | null;
  }>(`select * from edge_config.revocation_state_v1($1::uuid, $2::uuid, $3::uuid, $4)`, [
    hub.tenantId,
    hub.digitalStoreId,
    hub.storeLocationId,
    hub.environment,
  ]);
  const row = rows[0];
  if (row === undefined) {
    // NO ROWS means the Hub has never been told anything. Distinct from "nothing
    // is revoked", and the caller must be able to tell them apart.
    return {
      hasSnapshot: false,
      sequence: null,
      snapshotVersion: null,
      generatedAt: null,
      revocationWatermark: null,
      entryCount: 0,
    };
  }
  return {
    hasSnapshot: true,
    sequence: Number(row.sequence_no),
    snapshotVersion: Number(row.snapshot_version),
    generatedAt: row.generated_at,
    revocationWatermark: row.revocation_watermark,
    entryCount: Number(row.entry_count ?? 0),
  };
}

/**
 * The OFFLINE revocation answer, from the persisted snapshot.
 *
 * This is what the credential verification path consults when the Hub cannot
 * reach the cloud. It reads only this Hub's own active snapshot.
 */
/**
 * The offline revocation answer, INSIDE a caller's transaction.
 *
 * ===========================================================================
 * WHY THE LIVE GATE NEEDS THIS FORM
 * ===========================================================================
 * `authorizeHubCommand` already runs inside one transaction and holds a client,
 * not a pool. Opening a SECOND connection from inside it to ask whether a
 * credential is revoked would read a different snapshot of the database than
 * every other check the gate makes, so a snapshot committed mid-authorization
 * could be seen by one check and not another.
 *
 * Sharing the caller's client makes the revocation answer consistent with the
 * assignment, terminal and session reads the gate performs around it.
 */
/**
 * Is this DEVICE RECORD revoked by the snapshot this Hub holds?
 *
 * `revokedDeviceRecordIds` was signed, delivered and persisted with NO reader --
 * a signed field with no enforcement effect, which is worse than not carrying it,
 * because the signature implies the contents matter. Group 0029 adds the reader
 * and this is its caller.
 *
 * Shares the caller's client for the same reason as the certificate reader: the
 * gate must not answer from a different snapshot of the database than the one its
 * other checks saw.
 */
export async function isDeviceRevokedOfflineWithin(
  client: HubClient,
  hub: HubScopeIdentity,
  deviceRecordId: string,
): Promise<boolean> {
  const { rows } = await client.query<{ revoked: boolean }>(
    `select edge_config.is_device_revoked_offline_v1(
       $1::uuid, $2::uuid, $3::uuid, $4, $5::uuid) as revoked`,
    [hub.tenantId, hub.digitalStoreId, hub.storeLocationId, hub.environment, deviceRecordId],
  );
  return rows[0]?.revoked === true;
}

export async function isCertificateRevokedOfflineWithin(
  client: HubClient,
  hub: HubScopeIdentity,
  serialNumber: string,
): Promise<boolean> {
  const { rows } = await client.query<{ revoked: boolean }>(
    `select edge_config.is_certificate_revoked_offline_v1(
       $1::uuid, $2::uuid, $3::uuid, $4, $5) as revoked`,
    [hub.tenantId, hub.digitalStoreId, hub.storeLocationId, hub.environment, serialNumber],
  );
  return rows[0]?.revoked === true;
}

export async function isCertificateRevokedOffline(
  pool: HubPool,
  hub: HubScopeIdentity,
  serialNumber: string,
): Promise<boolean> {
  return withHubTransaction(pool, async (client) => {
    const { rows } = await client.query<{ revoked: boolean }>(
      `select edge_config.is_certificate_revoked_offline_v1(
         $1::uuid, $2::uuid, $3::uuid, $4, $5) as revoked`,
      [hub.tenantId, hub.digitalStoreId, hub.storeLocationId, hub.environment, serialNumber],
    );
    return rows[0]?.revoked === true;
  });
}

export type OfflineDecision =
  | { readonly decision: "DENY"; readonly reason: "REVOKED_IN_SNAPSHOT" }
  | { readonly decision: "ALLOW"; readonly stale: boolean; readonly heldSequence: number }
  | { readonly decision: "REFUSE"; readonly reason: "NO_SNAPSHOT_HELD" };

/**
 * The decision an offline verifier acts on.
 *
 * Three outcomes rather than a boolean, because "not in the list" and "we have no
 * list" must not collapse into the same answer. A Hub that has never received a
 * snapshot REFUSES rather than allowing — it cannot honestly say a credential is
 * unrevoked when it has never been told anything.
 *
 * `stale` is reported, never hidden. §6.7 forbids presenting an old snapshot as
 * current cloud truth; it does NOT forbid enforcing what it says, and §6.1
 * requires exactly that.
 */
export async function decideOffline(
  pool: HubPool,
  hub: HubScopeIdentity,
  serialNumber: string,
  options: { readonly now: Date; readonly maxAgeHours: number },
): Promise<OfflineDecision> {
  const held = await readHeldState(pool, hub);
  if (!held.hasSnapshot) return { decision: "REFUSE", reason: "NO_SNAPSHOT_HELD" };

  if (await isCertificateRevokedOffline(pool, hub, serialNumber)) {
    return { decision: "DENY", reason: "REVOKED_IN_SNAPSHOT" };
  }

  const ageHours =
    held.generatedAt === null
      ? Number.POSITIVE_INFINITY
      : (options.now.getTime() - held.generatedAt.getTime()) / 3_600_000;
  return {
    decision: "ALLOW",
    stale: ageHours > options.maxAgeHours,
    heldSequence: held.sequence ?? -1,
  };
}
