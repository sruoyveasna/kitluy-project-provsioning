/**
 * `edge_files` repository adapters (schema contract §6.7).
 *
 * METADATA ONLY: this module records what a cached asset IS, never its bytes.
 * `local_relative_path` is CHECKed to be relative and traversal-free, so a
 * cached asset can never escape the Hub asset root.
 *
 * Offline contract §13: chunk identity is `(asset_id, chunk_number,
 * chunk_sha256)` — a re-sent MATCHING chunk succeeds, a re-sent chunk number
 * with a DIFFERENT hash is rejected.
 */
import type { HubClient } from "../db.js";
import { HubCommandError } from "../errors.js";

export interface AssetRow {
  id: string;
  asset_class: string;
  owner_type: string;
  owner_id: string;
  mime_type: string;
  size_bytes: bigint;
  sha256: string;
  local_relative_path: string;
  state: string;
  cloud_object_key: string | null;
}

export interface InsertAssetInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly assetClass: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly mimeType: string;
  readonly sizeBytes: bigint;
  readonly sha256: string;
  readonly localRelativePath: string;
  readonly encryptionKeyGeneration: number;
  readonly retentionClass: string;
}

/**
 * Record local asset metadata. The initial state is `local_only`: the asset
 * EXISTS on the Hub and no cloud claim is made about it (WS-10 owns transfer).
 */
export async function insertAsset(client: HubClient, input: InsertAssetInput): Promise<void> {
  await client.query(
    `insert into edge_files.asset
       (id, tenant_id, digital_store_id, location_id, asset_class, owner_type, owner_id,
        mime_type, size_bytes, sha256, local_relative_path, encryption_key_generation,
        retention_class, state, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             'local_only'::edge_files.transfer_state, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.assetClass,
      input.ownerType,
      input.ownerId,
      input.mimeType,
      input.sizeBytes.toString(),
      input.sha256,
      input.localRelativePath,
      input.encryptionKeyGeneration,
      input.retentionClass,
    ],
  );
}

export async function findAsset(client: HubClient, assetId: string): Promise<AssetRow | undefined> {
  const result = await client.query<AssetRow>(
    `select id, asset_class, owner_type, owner_id, mime_type, size_bytes, sha256,
            local_relative_path, state, cloud_object_key
       from edge_files.asset where id = $1`,
    [assetId],
  );
  return result.rows[0];
}

export interface AssetChunkRow {
  asset_id: string;
  chunk_number: number;
  offset_bytes: bigint;
  size_bytes: number;
  sha256: string;
  received: boolean;
  uploaded: boolean;
}

/**
 * Record a received chunk. A re-sent chunk with the SAME hash is a success; a
 * different hash for the same chunk number is a rejection (offline §13) — the
 * mismatch is refused here, never silently overwritten.
 */
export async function recordAssetChunk(
  client: HubClient,
  input: {
    readonly assetId: string;
    readonly chunkNumber: number;
    readonly offsetBytes: bigint;
    readonly sizeBytes: number;
    readonly sha256: string;
  },
): Promise<{ readonly duplicate: boolean }> {
  const existing = await client.query<AssetChunkRow>(
    `select asset_id, chunk_number, offset_bytes, size_bytes, sha256, received, uploaded
       from edge_files.asset_chunk where asset_id = $1 and chunk_number = $2 for update`,
    [input.assetId, input.chunkNumber],
  );
  const prior = existing.rows[0];
  if (prior) {
    if (prior.sha256 !== input.sha256) {
      throw new HubCommandError(
        "EDGE_INVALID_TRANSITION",
        `chunk ${input.chunkNumber} of asset ${input.assetId} was already received with a different hash (offline contract §13).`,
        { assetId: input.assetId, chunkNumber: input.chunkNumber },
      );
    }
    return { duplicate: true };
  }
  await client.query(
    `insert into edge_files.asset_chunk
       (asset_id, chunk_number, offset_bytes, size_bytes, sha256, received, uploaded,
        updated_at)
     values ($1, $2, $3, $4, $5, true, false, now())`,
    [input.assetId, input.chunkNumber, input.offsetBytes.toString(), input.sizeBytes, input.sha256],
  );
  return { duplicate: false };
}

/**
 * Queue an upload job. `state = 'queued'` is a LOCAL statement about local
 * intent; nothing here claims the object reached the cloud (WS-10 owns that).
 */
export async function enqueueFileTransferJob(
  client: HubClient,
  input: {
    readonly id: string;
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly locationId: string;
    readonly assetId: string;
  },
): Promise<void> {
  await client.query(
    `insert into edge_files.file_transfer_job
       (id, tenant_id, digital_store_id, location_id, asset_id, direction, state,
        next_chunk_number, attempt_count, next_attempt_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'upload', 'queued'::edge_files.transfer_state, 0, 0,
             now(), now(), now())`,
    [input.id, input.tenantId, input.digitalStoreId, input.locationId, input.assetId],
  );
}
