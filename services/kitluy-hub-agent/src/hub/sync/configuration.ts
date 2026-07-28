/**
 * WS-10-T007 / WS-10-T008 — signed permission-grant and configuration snapshot
 * publication, then Hub verification, atomic activation and rollback.
 *
 * Authority: schema contract §6.2 ("immutable signed snapshots; one active
 * snapshot per Location"), §12 acceptance test 7 (all-or-nothing activation),
 * and owner decision KLD-2026-07-28-001 Group 5 (KLREQ-025).
 *
 * THE ORDER IS THE POINT. A snapshot arrives `downloaded`, becomes `verified`
 * only when its signature checks AND its content hashes to the manifest it
 * declares, and only a `verified` snapshot can be activated. Activating a
 * snapshot whose content differs from what was signed is activating unsigned
 * configuration, so the mismatch REFUSES rather than warning.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../hub-database.js";
import type { HubClient } from "../db.js";
import type { BatchSignatureVerifier } from "./signing.js";
import { SyncDeliveryError } from "./errors.js";

export interface SnapshotSection {
  readonly sectionCode: string;
  readonly sectionVersion: bigint;
  readonly content: Record<string, unknown>;
  readonly required: boolean;
}

export interface PublishedSnapshot {
  readonly snapshotId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly snapshotVersion: bigint;
  readonly schemaVersion: number;
  readonly notBefore: Date;
  readonly expiresAt: Date | null;
  readonly minimumHubVersion: string;
  readonly maximumHubVersion: string | null;
  readonly sections: readonly SnapshotSection[];
  readonly signatureAlgorithm: string;
  readonly signature: Buffer;
  readonly signingKeyId: string;
}

/**
 * The manifest a snapshot's signature covers: its identity, its validity window
 * and the digest of every section.
 *
 * Section CONTENT is hashed rather than embedded, so a snapshot's signature can
 * be checked without loading the whole configuration, while altering any
 * section still invalidates it.
 */
export function snapshotManifest(snapshot: PublishedSnapshot): string {
  return canonicalJson({
    snapshot_id: snapshot.snapshotId,
    tenant_id: snapshot.tenantId,
    digital_store_id: snapshot.digitalStoreId,
    location_id: snapshot.locationId,
    snapshot_version: snapshot.snapshotVersion.toString(),
    schema_version: snapshot.schemaVersion,
    not_before: snapshot.notBefore.toISOString(),
    expires_at: snapshot.expiresAt?.toISOString() ?? null,
    minimum_hub_version: snapshot.minimumHubVersion,
    maximum_hub_version: snapshot.maximumHubVersion,
    sections: [...snapshot.sections]
      .map((s) => ({
        section_code: s.sectionCode,
        section_version: s.sectionVersion.toString(),
        required: s.required,
        content_sha256: sectionDigest(s),
      }))
      // Sorted so two publishers that emit sections in different orders
      // produce the same manifest for the same configuration.
      .sort((a, b) => (a.section_code < b.section_code ? -1 : 1)),
  });
}

export function sectionDigest(section: SnapshotSection): string {
  return createHash("sha256").update(canonicalJson(section.content), "utf8").digest("hex");
}

export function snapshotManifestSha256(snapshot: PublishedSnapshot): string {
  return createHash("sha256").update(snapshotManifest(snapshot), "utf8").digest("hex");
}

/** Store a published snapshot as `downloaded`. Nothing is trusted yet. */
export async function recordDownloadedSnapshot(
  client: HubClient,
  snapshot: PublishedSnapshot,
): Promise<void> {
  await client.query(
    `insert into edge_config.configuration_snapshot
       (id, tenant_id, digital_store_id, location_id, snapshot_version, schema_version,
        created_at, not_before, expires_at, minimum_hub_version, maximum_hub_version,
        manifest_sha256, signature_algorithm, signature, signing_key_id, state, downloaded_at)
     values ($1, $2, $3, $4, $5::bigint, $6, now(), $7, $8, $9, $10, $11, $12, $13, $14,
             'downloaded', now())`,
    [
      snapshot.snapshotId,
      snapshot.tenantId,
      snapshot.digitalStoreId,
      snapshot.locationId,
      snapshot.snapshotVersion.toString(),
      snapshot.schemaVersion,
      snapshot.notBefore,
      snapshot.expiresAt,
      snapshot.minimumHubVersion,
      snapshot.maximumHubVersion,
      snapshotManifestSha256(snapshot),
      snapshot.signatureAlgorithm,
      snapshot.signature,
      snapshot.signingKeyId,
    ],
  );
  for (const section of snapshot.sections) {
    await client.query(
      `insert into edge_config.configuration_section
         (id, snapshot_id, section_code, section_version, content_sha256, content_json,
          required, validation_state)
       values (gen_random_uuid(), $1, $2, $3::bigint, $4, $5::jsonb, $6, 'pending')`,
      [
        snapshot.snapshotId,
        section.sectionCode,
        section.sectionVersion.toString(),
        sectionDigest(section),
        JSON.stringify(section.content),
        section.required,
      ],
    );
  }
}

export interface SnapshotVerdict {
  readonly verified: boolean;
  readonly reason?: string;
}

/**
 * Verify a downloaded snapshot: the signature over the manifest, then the
 * manifest against the stored declaration. Both must hold — a valid signature
 * over a manifest that does not match the stored snapshot would authenticate a
 * DIFFERENT configuration than the one about to be activated.
 *
 * RETURNS A VERDICT INSTEAD OF THROWING on a failed signature, and that is
 * deliberate. Throwing rolled the caller's transaction back, which took the
 * `rejected` state with it: the snapshot stayed `downloaded` and the refusal
 * left no trace. A rejection is evidence and has to survive.
 *
 * Fail-closed does not depend on the caller reading the verdict:
 * `edge_config.activate_snapshot` refuses anything that is not `verified`, so
 * an ignored `false` still cannot activate.
 */
export async function verifySnapshot(
  client: HubClient,
  snapshot: PublishedSnapshot,
  verifier: BatchSignatureVerifier,
): Promise<SnapshotVerdict> {
  const manifest = snapshotManifest(snapshot);
  const signatureValid = verifier.verify(manifest, {
    algorithm: snapshot.signatureAlgorithm,
    keyId: snapshot.signingKeyId,
    signature: snapshot.signature.toString("base64"),
  });
  if (!signatureValid) {
    await client.query(
      `update edge_config.configuration_snapshot set state = 'rejected' where id = $1`,
      [snapshot.snapshotId],
    );
    return {
      verified: false,
      reason: `Snapshot ${snapshot.snapshotId} did not verify against signing key ${snapshot.signingKeyId}.`,
    };
  }

  // A manifest mismatch DOES throw: it means the stored snapshot and the one
  // presented disagree, which is a local integrity problem rather than a
  // verdict about the publisher.
  try {
    await client.query(`select edge_config.mark_snapshot_verified($1::uuid, $2::char(64))`, [
      snapshot.snapshotId,
      snapshotManifestSha256(snapshot),
    ]);
  } catch (error) {
    throw new SyncDeliveryError("EDGE_SNAPSHOT_MANIFEST_MISMATCH", (error as Error).message, {
      snapshotId: snapshot.snapshotId,
    });
  }
  return { verified: true };
}

/** Verify or throw — for callers that treat an unverifiable snapshot as fatal. */
export async function verifySnapshotOrThrow(
  client: HubClient,
  snapshot: PublishedSnapshot,
  verifier: BatchSignatureVerifier,
): Promise<void> {
  const verdict = await verifySnapshot(client, snapshot, verifier);
  if (!verdict.verified) {
    throw new SyncDeliveryError("EDGE_SNAPSHOT_SIGNATURE_INVALID", verdict.reason!, {
      snapshotId: snapshot.snapshotId,
    });
  }
}

export interface ActivationResult {
  readonly activationId: string;
  readonly snapshotId: string;
  readonly previousSnapshotId: string | null;
}

/** Atomically activate a verified snapshot (§12 acceptance test 7). */
export async function activateSnapshot(
  client: HubClient,
  input: {
    readonly activationId: string;
    readonly snapshotId: string;
    readonly actorType: string;
    readonly actorId?: string | null;
    readonly healthCheck?: Record<string, unknown>;
  },
): Promise<ActivationResult> {
  const result = await client.query<{ activate_snapshot: string | null }>(
    `select edge_config.activate_snapshot($1::uuid, $2::uuid, $3::text, $4::uuid, $5::jsonb)`,
    [
      input.activationId,
      input.snapshotId,
      input.actorType,
      input.actorId ?? null,
      JSON.stringify(input.healthCheck ?? {}),
    ],
  );
  return {
    activationId: input.activationId,
    snapshotId: input.snapshotId,
    previousSnapshotId: result.rows[0]?.activate_snapshot ?? null,
  };
}

/** Roll back to the snapshot the activation record NAMES. Never a guess. */
export async function rollbackSnapshot(
  client: HubClient,
  input: {
    readonly activationId: string;
    readonly fromActivationId: string;
    readonly reason: string;
    readonly actorType: string;
    readonly actorId?: string | null;
  },
): Promise<string> {
  const result = await client.query<{ rollback_snapshot: string }>(
    `select edge_config.rollback_snapshot($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid)`,
    [
      input.activationId,
      input.fromActivationId,
      input.reason,
      input.actorType,
      input.actorId ?? null,
    ],
  );
  return result.rows[0]!.rollback_snapshot;
}

/** The single active snapshot for a Location (§6.2). */
export async function activeSnapshot(
  client: HubClient,
  locationId: string,
): Promise<{ snapshotId: string; snapshotVersion: bigint } | undefined> {
  const result = await client.query<{ snapshot_id: string; snapshot_version: bigint }>(
    `select snapshot_id, snapshot_version from edge_config.active_configuration
      where location_id = $1`,
    [locationId],
  );
  const row = result.rows[0];
  return row ? { snapshotId: row.snapshot_id, snapshotVersion: row.snapshot_version } : undefined;
}
