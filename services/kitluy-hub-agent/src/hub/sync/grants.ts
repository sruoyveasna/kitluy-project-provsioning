/**
 * WS-10-T007 — the signed permission-grant projection (KLREQ-025,
 * KLD-2026-07-28-001 Group 5).
 *
 * The ruling, in the terms that constrain this file:
 *   - a SIGNED, VERSIONED local projection of CLOUD-MANAGED grants;
 *   - the Hub never authors, broadens or infers a grant;
 *   - DENY OVERRIDES ALLOW;
 *   - missing / unknown / expired FAILS CLOSED;
 *   - **no arbitrary offline grace period may be invented in code** — any
 *     offline-validity duration must come from an approved signed policy value.
 *
 * RECORDED, NOT GUESSED. The approved definition enumerates 21 required fields.
 * That enumeration is not reproduced verbatim in the decision register, so the
 * projection carries the fields the ruling's SEMANTICS require and the
 * remainder are left to a later additive migration rather than invented to
 * reach a count. {@link GRANT_PROJECTION_FIELD_CONTRACT} states that openly.
 */
import type { HubClient } from "../db.js";
import { SyncDeliveryError } from "./errors.js";

export const GRANT_PROJECTION_FIELD_CONTRACT =
  "[REQUIRED: the verbatim 21-field enumeration from the approved KLREQ-025 definition " +
  "(KLD-2026-07-28-001 Group 5). edge_config.permission_grant_projection implements the fields " +
  "the ruling's semantics require; the remainder are NOT invented to reach the count, because " +
  "guessing an authorization field list would manufacture a contract.]";

/**
 * `unknown` is a REFUSAL, kept distinct from `deny` only so the reason for a
 * refusal is legible: "nobody granted this" and "somebody forbade this" are
 * different facts, and both stop the caller.
 */
export type GrantDecision = "allow" | "deny" | "unknown";

export function isPermitted(decision: GrantDecision): boolean {
  return decision === "allow";
}

export interface PublishedGrant {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly sourceSnapshotId: string;
  readonly projectionVersion: bigint;
  readonly actorId: string;
  readonly permissionKey: string;
  readonly effect: "allow" | "deny";
  readonly resourceType: string;
  readonly scopeType: string;
  readonly scopeId: string | null;
  readonly environment: string;
  readonly requiresReauthentication: boolean;
  readonly requiresApproval: boolean;
  readonly requiresReason: boolean;
  readonly grantedAt: Date;
  readonly notBefore: Date;
  readonly expiresAt: Date | null;
  /**
   * From an APPROVED SIGNED POLICY value only. `null` means no offline validity
   * was granted, and the Hub does not supply one.
   */
  readonly offlineValiditySeconds: number | null;
  readonly offlinePolicyReference: string | null;
  readonly signature: Buffer;
  readonly signatureAlgorithm: string;
  readonly signingKeyId: string;
}

/**
 * Project a signed cloud grant locally.
 *
 * Refuses an offline validity that names no policy. That pairing is exactly the
 * invented grace period the ruling forbids: a duration with no approved source
 * is a number somebody chose, and the database refuses it too
 * (`permission_grant_projection_offline_ck`).
 */
export async function projectGrant(client: HubClient, grant: PublishedGrant): Promise<void> {
  if ((grant.offlineValiditySeconds === null) !== (grant.offlinePolicyReference === null)) {
    throw new SyncDeliveryError(
      "EDGE_SNAPSHOT_MANIFEST_MISMATCH",
      "An offline validity duration must name the approved signed policy that granted it; " +
        "a duration without one is an invented grace period (KLREQ-025).",
      { permissionKey: grant.permissionKey, actorId: grant.actorId },
    );
  }
  await client.query(
    `insert into edge_config.permission_grant_projection
       (id, tenant_id, digital_store_id, location_id, source_snapshot_id, projection_version,
        actor_id, permission_key, effect, resource_type, scope_type, scope_id, environment,
        requires_reauthentication, requires_approval, requires_reason, granted_at, not_before,
        expires_at, offline_validity_seconds, offline_policy_reference, signature,
        signature_algorithm, signing_key_id, received_at)
     values ($1, $2, $3, $4, $5, $6::bigint, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             $17, $18, $19, $20, $21, $22, $23, $24, now())`,
    [
      grant.id,
      grant.tenantId,
      grant.digitalStoreId,
      grant.locationId,
      grant.sourceSnapshotId,
      grant.projectionVersion.toString(),
      grant.actorId,
      grant.permissionKey,
      grant.effect,
      grant.resourceType,
      grant.scopeType,
      grant.scopeId,
      grant.environment,
      grant.requiresReauthentication,
      grant.requiresApproval,
      grant.requiresReason,
      grant.grantedAt,
      grant.notBefore,
      grant.expiresAt,
      grant.offlineValiditySeconds,
      grant.offlinePolicyReference,
      grant.signature,
      grant.signatureAlgorithm,
      grant.signingKeyId,
    ],
  );
}

export interface GrantQuery {
  readonly locationId: string;
  readonly actorId: string;
  readonly permissionKey: string;
  readonly scopeType: string;
  readonly scopeId: string | null;
  /** WHETHER THE HUB IS ONLINE, observed — never assumed to be true. */
  readonly online: boolean;
  readonly asOf?: Date;
}

/**
 * Resolve one grant.
 *
 * The decision lives in SQL (`edge_config.resolve_permission_grant`) so it is
 * evaluated inside the same transaction and cannot be reimplemented, in a
 * subtly different order, by a second caller. Deny wins there; missing, unknown
 * and expired all return `unknown`.
 */
export async function resolveGrant(client: HubClient, query: GrantQuery): Promise<GrantDecision> {
  const result = await client.query<{ resolve_permission_grant: GrantDecision }>(
    `select edge_config.resolve_permission_grant($1::uuid, $2::uuid, $3::text, $4::text,
                                                 $5::uuid, $6::boolean, $7::timestamptz)`,
    [
      query.locationId,
      query.actorId,
      query.permissionKey,
      query.scopeType,
      query.scopeId,
      query.online,
      query.asOf ?? new Date(),
    ],
  );
  return result.rows[0]?.resolve_permission_grant ?? "unknown";
}
