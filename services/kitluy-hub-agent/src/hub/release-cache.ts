/**
 * Hub release verification and artifact cache (WS-11-T006-P03).
 *
 * Authority: KLD-2026-08-06-WS11-T006-001 §5; release policy §9; hub group
 * 0038 (durable cache state); @kitluy/device-identity release-manifest (the
 * closed verifier — the SAME one terminals run independently).
 *
 * Discipline: verification precedes ANY download byte; the digest and size
 * are re-proven over the DOWNLOADED bytes (object-storage metadata is never
 * authority); downloads resume from the durable offset; duplicate
 * assignments are one business effect; nothing here needs the WAN once the
 * assignment and artifact arrive — a cached release stays cached through
 * restart, proven from relational state.
 */
import { createHash } from "node:crypto";

import {
  findReleaseAcceptanceRefusal,
  verifyReleaseManifestSignature,
  type ReleaseAcceptanceContext,
  type ReleaseSignatureEnvelope,
  type SignedReleaseManifestBody,
  type TrustedReleaseKey,
} from "@kitluy/device-identity";

import { withHubTransaction, HUB_RUNTIME_ROLE, type HubClient, type HubPool } from "./db.js";

export interface HubScope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
}

export interface ReleaseAssignmentDelivery {
  readonly manifest: SignedReleaseManifestBody;
  readonly envelope: ReleaseSignatureEnvelope;
}

export type ReleaseCacheOutcome =
  | { readonly result: "VERIFIED"; readonly releaseId: string }
  | { readonly result: "DUPLICATE_IGNORED"; readonly releaseId: string; readonly state: string }
  | { readonly result: "REJECTED"; readonly releaseId: string; readonly refusalCode: string };

/** Chunked artifact source; offset-addressed so interruptions resume. */
export interface ArtifactFetcher {
  fetch(releaseId: string, offset: number, maxBytes: number): Promise<Uint8Array | null>;
}

export async function loadTrustedReleaseKeys(client: HubClient): Promise<TrustedReleaseKey[]> {
  const { rows } = await client.query<{
    key_id: string;
    key_version: number;
    public_key_pem: string;
    state: "current" | "next" | "revoked";
  }>(`select key_id, key_version, public_key_pem, state from edge_config.release_trust_key`);
  return rows.map((row) => ({
    keyId: row.key_id,
    keyVersion: row.key_version,
    publicKeyPem: row.public_key_pem,
    state: row.state,
  }));
}

export async function provisionReleaseTrustKey(
  pool: HubPool,
  key: {
    keyId: string;
    keyVersion: number;
    publicKeyPem: string;
    state: "current" | "next" | "revoked";
  },
): Promise<void> {
  await withHubTransaction(
    pool,
    async (client) => {
      await client.query(
        `insert into edge_config.release_trust_key
           (key_id, key_version, algorithm, public_key_pem, state, activated_at,
            revoked_at)
         values ($1, $2, 'ed25519', $3, $4, now(),
                 case when $4 = 'revoked' then now() end)
         on conflict (key_id, key_version) do update
           set state = excluded.state, public_key_pem = excluded.public_key_pem,
               revoked_at = excluded.revoked_at`,
        [key.keyId, key.keyVersion, key.publicKeyPem, key.state],
      );
    },
    HUB_RUNTIME_ROLE,
  );
}

/**
 * Stage + verify an authenticated release assignment. Signature first, then
 * the independent acceptance gate; a refusal is durable (`rejected` +
 * refusal code, final by trigger), and a duplicate delivery of a known
 * release is one business effect.
 */
export async function applyReleaseAssignment(
  pool: HubPool,
  scope: HubScope,
  delivery: ReleaseAssignmentDelivery,
  context: ReleaseAcceptanceContext,
): Promise<ReleaseCacheOutcome> {
  const { manifest, envelope } = delivery;
  return withHubTransaction(
    pool,
    async (client) => {
      const existing = await client.query<{ state: string }>(
        `select state from edge_config.release_cache where id = $1`,
        [manifest.releaseId],
      );
      if (existing.rows[0] !== undefined) {
        return {
          result: "DUPLICATE_IGNORED",
          releaseId: manifest.releaseId,
          state: existing.rows[0].state,
        } as const;
      }

      const trusted = await loadTrustedReleaseKeys(client);
      const verification = verifyReleaseManifestSignature(manifest, envelope, trusted);
      const acceptance = verification.verified
        ? findReleaseAcceptanceRefusal(manifest, context)
        : null;
      const refusal = !verification.verified
        ? (verification as { failure: string }).failure
        : acceptance;

      if (refusal !== null && refusal !== undefined) {
        // The signer FK requires a REGISTERED key even for the rejection
        // record; an unknown-key delivery is recorded against no row at all
        // (nothing durable can bind to an unregistered signer).
        const signerKnown = trusted.some(
          (key) => key.keyId === envelope.keyId && key.keyVersion === envelope.keyVersion,
        );
        if (signerKnown) {
          await client.query(
            `insert into edge_config.release_cache
               (id, tenant_id, digital_store_id, location_id, product_key,
                version, build_id, architecture, hardware_profile, environment,
                channel, artifact_digest_sha256, artifact_size_bytes,
                manifest_version, signing_key_id, signing_key_version,
                signature_b64, min_schema_version, max_schema_version,
                config_prerequisite_version, rollback_release_id, state,
                refusal_code)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                     $17,$18,$19,$20,$21,'rejected',$22)`,
            [
              manifest.releaseId,
              scope.tenantId,
              scope.digitalStoreId,
              scope.locationId,
              manifest.productKey,
              manifest.version,
              manifest.buildId,
              manifest.architecture,
              manifest.hardwareProfile,
              manifest.environment,
              manifest.channel,
              manifest.artifactDigestSha256,
              manifest.artifactSizeBytes,
              manifest.manifestVersion,
              envelope.keyId,
              envelope.keyVersion,
              envelope.signature,
              manifest.minSchemaVersion,
              manifest.maxSchemaVersion,
              manifest.configPrerequisiteVersion,
              manifest.rollbackReleaseId === "" ? null : manifest.rollbackReleaseId,
              refusal,
            ],
          );
        }
        return {
          result: "REJECTED",
          releaseId: manifest.releaseId,
          refusalCode: refusal,
        } as const;
      }

      await client.query(
        `insert into edge_config.release_cache
           (id, tenant_id, digital_store_id, location_id, product_key, version,
            build_id, architecture, hardware_profile, environment, channel,
            artifact_digest_sha256, artifact_size_bytes, manifest_version,
            signing_key_id, signing_key_version, signature_b64,
            min_schema_version, max_schema_version, config_prerequisite_version,
            rollback_release_id, state, verified_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18,$19,$20,$21,'verified', now())`,
        [
          manifest.releaseId,
          scope.tenantId,
          scope.digitalStoreId,
          scope.locationId,
          manifest.productKey,
          manifest.version,
          manifest.buildId,
          manifest.architecture,
          manifest.hardwareProfile,
          manifest.environment,
          manifest.channel,
          manifest.artifactDigestSha256,
          manifest.artifactSizeBytes,
          manifest.manifestVersion,
          envelope.keyId,
          envelope.keyVersion,
          envelope.signature,
          manifest.minSchemaVersion,
          manifest.maxSchemaVersion,
          manifest.configPrerequisiteVersion,
          manifest.rollbackReleaseId === "" ? null : manifest.rollbackReleaseId,
        ],
      );
      return { result: "VERIFIED", releaseId: manifest.releaseId } as const;
    },
    HUB_RUNTIME_ROLE,
  );
}

export type DownloadOutcome =
  | { readonly result: "CACHED"; readonly bytes: number }
  | { readonly result: "IN_PROGRESS"; readonly bytes: number }
  | { readonly result: "DIGEST_MISMATCH" }
  | { readonly result: "NOT_DOWNLOADABLE"; readonly state: string };

/**
 * Resumable, digest-proving download. Every call advances from the DURABLE
 * offset; the digest and size are proven over the assembled bytes before
 * `cached` — never from transport or object-storage metadata. Restart-safe:
 * a new process resumes from `bytes_downloaded`.
 */
export async function downloadReleaseArtifact(
  pool: HubPool,
  releaseId: string,
  fetcher: ArtifactFetcher,
  collected: Map<string, Uint8Array[]>,
  chunkBytes = 65536,
): Promise<DownloadOutcome> {
  return withHubTransaction(
    pool,
    async (client) => {
      const { rows } = await client.query<{
        state: string;
        bytes_downloaded: string | number | bigint;
        artifact_size_bytes: string | number | bigint;
        artifact_digest_sha256: string;
      }>(
        `select state, bytes_downloaded, artifact_size_bytes, artifact_digest_sha256
           from edge_config.release_cache where id = $1 for update`,
        [releaseId],
      );
      const row = rows[0];
      if (row === undefined) return { result: "NOT_DOWNLOADABLE", state: "absent" } as const;
      if (row.state === "cached") {
        return { result: "CACHED", bytes: Number(row.artifact_size_bytes) } as const;
      }
      if (row.state !== "verified" && row.state !== "downloading") {
        return { result: "NOT_DOWNLOADABLE", state: row.state } as const;
      }

      let offset = Number(row.bytes_downloaded);
      const total = Number(row.artifact_size_bytes);
      const parts = collected.get(releaseId) ?? [];
      const chunk = await fetcher.fetch(releaseId, offset, Math.min(chunkBytes, total - offset));
      if (chunk === null || chunk.length === 0) {
        return { result: "IN_PROGRESS", bytes: offset } as const;
      }
      parts.push(chunk);
      collected.set(releaseId, parts);
      offset += chunk.length;

      if (offset < total) {
        await client.query(
          `update edge_config.release_cache
              set state = 'downloading', bytes_downloaded = $2, updated_at = now()
            where id = $1`,
          [releaseId, offset],
        );
        return { result: "IN_PROGRESS", bytes: offset } as const;
      }

      const assembled = Buffer.concat(parts.map((part) => Buffer.from(part)));
      const digest = createHash("sha256").update(assembled).digest("hex");
      if (assembled.length !== total || digest !== row.artifact_digest_sha256) {
        return { result: "DIGEST_MISMATCH" } as const;
      }
      await client.query(
        `update edge_config.release_cache
            set state = 'cached', bytes_downloaded = $2, cached_at = now(),
                artifact_local_path = $3, updated_at = now()
          where id = $1`,
        [releaseId, total, `hub/.artifacts/${releaseId}`],
      );
      return { result: "CACHED", bytes: total } as const;
    },
    HUB_RUNTIME_ROLE,
  );
}
