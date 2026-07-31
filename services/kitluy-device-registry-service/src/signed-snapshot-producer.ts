/**
 * The authoritative producer of SIGNED, STRICTLY SCOPED Store Hub revocation
 * snapshots.
 *
 * Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001 (owner-locked);
 * migration group 0156; WS-11-T003 Step 4 final offline completion §3.
 *
 * ===========================================================================
 * ONE HUB, ONE SCOPE, DERIVED — NEVER SUPPLIED
 * ===========================================================================
 * The caller names a Store Hub. It does NOT name a Tenant, a Digital Store or a
 * Location, and there is no parameter through which it could: the scope comes
 * from the Hub's ACTIVE assignment via `hub_revocation_scope_v1`, and an
 * unprovisioned Hub yields no scope and therefore no snapshot.
 *
 * This is the difference between the previous builder and this one. That builder
 * took a scope as an argument and read an ENVIRONMENT-WIDE revocation set, so a
 * snapshot labelled for one Store carried every tenant's revoked serials — a
 * cross-tenant disclosure a reviewer found and the owner has since ruled against.
 * Here the scope is derived and the read is filtered inside the database (group
 * 0156), so a producer bug can return the wrong Store's data only by asking for a
 * different Store, and never everything.
 *
 * ===========================================================================
 * NO UNSIGNED SNAPSHOT LEAVES THIS MODULE
 * ===========================================================================
 * Signing is not a step that can be skipped or degraded. `produceSignedSnapshot`
 * either returns a snapshot carrying a detached Ed25519 signature, or it throws.
 * There is no `signatureValid: false` path and no unsigned fallback, because an
 * unsigned snapshot a Hub accepted would be one an attacker could also mint.
 *
 * **PostgreSQL does not verify Ed25519.** The database scopes and supplies the
 * facts; signing and verification are TypeScript, and KLRISK-DEVICE-003 stays
 * open.
 */
import {
  canonicalSnapshotBytes,
  canonicalSnapshotDigest,
  SNAPSHOT_SCHEMA_VERSION,
  type SignedRevocationSnapshot,
  type SignedSnapshotBody,
  type SnapshotRelationalScope,
  type SnapshotSigner,
  type SnapshotSigningKeyReference,
} from "@kitluy/device-identity";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";
import { throwRedacted } from "./revocation-failures.js";

export class UnprovisionedHubError extends Error {
  constructor(hubDeviceRecordId: string) {
    // The id is safe to name — the caller supplied it. No tenancy is disclosed,
    // precisely because none could be resolved.
    super(`the Store Hub ${hubDeviceRecordId} has no active assignment, so it has no scope`);
    this.name = "UnprovisionedHubError";
  }
}

export interface ProduceSnapshotRequest {
  /** The ONLY scope input. Everything relational is derived from it. */
  readonly hubDeviceRecordId: string;
  readonly environment: string;
  /** Content generation. The publication side owns the ledger. */
  readonly snapshotVersion: number;
  /** Delivery ordering, monotonic per Hub. A Hub refuses one that goes backwards. */
  readonly sequence: number;
  readonly generatedAt: Date;
  readonly effectiveAt: Date;
  readonly keyReference: SnapshotSigningKeyReference;
}

export interface SnapshotProducer {
  produceSignedSnapshot(request: ProduceSnapshotRequest): Promise<SignedRevocationSnapshot>;
}

interface ResolvedScope extends SnapshotRelationalScope {
  readonly hubDeviceRecordId: string;
}

function readScope(raw: unknown, environment: string): ResolvedScope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const text = (key: string): string | null => {
    const value = row[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };
  const tenantId = text("tenant_id");
  const digitalStoreId = text("digital_store_id");
  const storeLocationId = text("store_location_id");
  const hubDeviceRecordId = text("hub_device_record_id");
  // ALL FOUR or nothing. A partially resolved scope is not a narrower scope, it
  // is an unknown one, and building from it would mean guessing.
  if (
    tenantId === null ||
    digitalStoreId === null ||
    storeLocationId === null ||
    hubDeviceRecordId === null
  ) {
    return null;
  }
  return { tenantId, digitalStoreId, storeLocationId, environment, hubDeviceRecordId };
}

export function createSnapshotProducer(
  source: ClientSource,
  signer: SnapshotSigner,
): SnapshotProducer {
  return {
    async produceSignedSnapshot(
      request: ProduceSnapshotRequest,
    ): Promise<SignedRevocationSnapshot> {
      const body = await (async (): Promise<SignedSnapshotBody> => {
        try {
          return await withServiceRole(source, REGISTRY_ROLES.issuance, async (client) => {
            const scopeResult = await client.query<{ result: unknown }>(
              `select kitluy_devices.hub_revocation_scope_v1($1::uuid) as result`,
              [request.hubDeviceRecordId],
            );
            const scope = readScope(scopeResult.rows[0]?.result, request.environment);
            if (scope === null) throw new UnprovisionedHubError(request.hubDeviceRecordId);

            // Every read below is filtered by the DATABASE to this scope. The
            // producer cannot widen them: a wrong argument returns a different
            // Store's set, never the union of all of them, and a null argument
            // returns the empty set (group 0156 proves both).
            const [serials, devices, watermark] = await Promise.all([
              client.query<{ serial: string }>(
                `select s as serial from kitluy_devices.revoked_serials_for_scope_v1(
                   $1::uuid, $2::uuid, $3::uuid, $4::text) as s`,
                [scope.tenantId, scope.digitalStoreId, scope.storeLocationId, scope.environment],
              ),
              client.query<{ id: string }>(
                `select d::text as id from kitluy_devices.revoked_devices_for_scope_v1(
                   $1::uuid, $2::uuid, $3::uuid, $4::text) as d`,
                [scope.tenantId, scope.digitalStoreId, scope.storeLocationId, scope.environment],
              ),
              client.query<{ watermark: string }>(
                `select kitluy_devices.revocation_watermark_for_scope_v1(
                   $1::uuid, $2::uuid, $3::uuid, $4::text) as watermark`,
                [scope.tenantId, scope.digitalStoreId, scope.storeLocationId, scope.environment],
              ),
            ]);

            return {
              schemaVersion: SNAPSHOT_SCHEMA_VERSION,
              scope: {
                tenantId: scope.tenantId,
                digitalStoreId: scope.digitalStoreId,
                storeLocationId: scope.storeLocationId,
                environment: scope.environment,
              },
              hubDeviceRecordId: scope.hubDeviceRecordId,
              snapshotVersion: request.snapshotVersion,
              sequence: request.sequence,
              revocationWatermark: watermark.rows[0]?.watermark ?? "1970-01-01T00:00:00.000Z",
              generatedAt: request.generatedAt.toISOString(),
              effectiveAt: request.effectiveAt.toISOString(),
              revokedCertificateSerials: serials.rows.map((row) => row.serial).sort(),
              revokedDeviceRecordIds: devices.rows.map((row) => row.id).sort(),
            };
          });
        } catch (error) {
          // An unprovisioned Hub is a REQUEST fact and is reported as itself; a
          // database fault is redacted like every other.
          if (error instanceof UnprovisionedHubError) throw error;
          throwRedacted(error, "produce_signed_revocation_snapshot");
        }
      })();

      // SIGN, or fail. Deliberately outside the database transaction: holding a
      // connection open across a signing call would couple key custody to pool
      // pressure, and the bytes are already fixed by this point.
      const signature = await signer.signCanonicalSnapshot(
        canonicalSnapshotBytes(body),
        request.keyReference,
      );
      return { ...body, signature };
    },
  };
}

/** Exposed so a publisher can log WHAT it signed without logging the payload. */
export { canonicalSnapshotDigest };
