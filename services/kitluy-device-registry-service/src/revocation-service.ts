/**
 * PRODUCTION composition root for governed device-credential revocation.
 *
 * Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001;
 * KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001; migration groups 0145-0155;
 * WS-11-T003 Step 4 final remediation §2.
 *
 * ===========================================================================
 * WHAT WAS WRONG BEFORE THIS FILE (RV-GW-001)
 * ===========================================================================
 * `createPgRevocationGateway` and `loadRevocations` were complete, tested
 * against the real database, and CALLED BY NOTHING. Phase E recorded the honest
 * answer to "is the gateway production-wired?" as "no — library-available-but-
 * uncalled", and refused to promote on it.
 *
 * The gap was not a missing function. It was that every cloud service in this
 * repository is a health-check kernel with no database access, so there was
 * nowhere for a governed call to originate. This module is that origin: the ONE
 * place in production code that turns an operator intent into a governed
 * database call, and the only place that knows which identity each door needs.
 *
 * ===========================================================================
 * FOUR DOORS, FOUR IDENTITIES
 * ===========================================================================
 * Verified against the live catalogue (see `database.ts`):
 *
 *   normal revocation   -> revoke_device_credential_bound_v1              (issuance)
 *   emergency           -> revoke_device_credential_emergency_governed_v1 (human)
 *   post-approval       -> record_governed_emergency_post_approval_v1     (human)
 *   lapse               -> lapse_governed_emergency_post_approval_v1      (worker)
 *
 * The two HUMAN doors run under `withHumanSession`, so `auth.uid()` resolves to
 * the actual person and the database evaluates THEIR permission and THEIR
 * re-authentication. Passing a user id as a parameter would have been simpler and
 * would have re-created the RC-021 bypass: a service that can name any actor is a
 * service that can act as any actor.
 *
 * ===========================================================================
 * WHAT THIS MODULE REFUSES TO DO
 * ===========================================================================
 *   * It names no legacy door. `revoke_device_credential_v1` and
 *     `revoke_device_credential_emergency_v1` appear nowhere in this file except
 *     in this sentence, and since group 0151 no identity this service can hold
 *     could execute them anyway.
 *   * It invents no scope. The affected credential set is derived from stored
 *     rows inside the database (group 0146); this module passes selectors, never
 *     an answer.
 *   * It sets no deadline. `post_approval_due_at` comes from policy.
 *   * It never reports an unconfirmed write as success. See
 *     `revocation-failures.ts`.
 */
import type { PoolClient } from "pg";
import {
  createPgRevocationGateway,
  type GovernedRevocationCall,
  type RevocationGateway,
  type RevocationOutcome,
} from "@kitluy/device-identity";

import {
  REGISTRY_ROLES,
  withHumanSession,
  withServiceRole,
  type ClientSource,
  type VerifiedHumanSession,
} from "./database.js";
import { throwRedacted } from "./revocation-failures.js";

// ---------------------------------------------------------------------------
// Request and result shapes
// ---------------------------------------------------------------------------

/** The five emergency reasons decision §2.2 approves. */
export type EmergencyReasonCode =
  "KEY_COMPROMISE" | "DEVICE_LOST" | "DEVICE_STOLEN" | "PROVIDER_COMPROMISE" | "SECURITY_INCIDENT";

export const EMERGENCY_REASON_CODES: readonly EmergencyReasonCode[] = [
  "KEY_COMPROMISE",
  "DEVICE_LOST",
  "DEVICE_STOLEN",
  "PROVIDER_COMPROMISE",
  "SECURITY_INCIDENT",
];

export interface EmergencyRevocationRequest {
  readonly credentialId: string;
  readonly reasonCode: EmergencyReasonCode;
  readonly explanation: string;
  readonly incidentReference: string;
  /**
   * A re-authentication evidence row the HUMAN recorded for
   * `fleet.device_credential.emergency_revoke`. Its 300-second window is
   * enforced against DATABASE time inside the RPC; this service neither reads
   * nor extends it.
   */
  readonly reauthEvidenceId: string;
  readonly idempotencyKey: string;
  /** Optional recorded incident scope. Null means "this credential only". */
  readonly incidentScopeId?: string | null;
}

export type EmergencyOutcomeCode =
  "REVOKED_IMMEDIATELY" | "ALREADY_AUTHORIZED" | "EMERGENCY_REFUSED";

export interface EmergencyRevocationResult {
  readonly outcome: EmergencyOutcomeCode;
  readonly authorizationId: string | null;
  readonly revokedCredentialCount: number | null;
  readonly postApprovalDueAt: string | null;
  readonly refusalCode: string | null;
}

export type PostApprovalDecision = "APPROVE" | "REFUSE";

export interface PostApprovalRequest {
  /** IMMUTABLE. The authorization the emergency created. */
  readonly authorizationId: string;
  readonly decision: PostApprovalDecision;
  /** Separate evidence, recorded for the POST-APPROVE action class. */
  readonly reauthEvidenceId: string;
  readonly note?: string | null;
}

export type PostApprovalOutcomeCode =
  "POST_APPROVED" | "MANUAL_SECURITY_REVIEW" | "ALREADY_DECIDED" | "POST_APPROVAL_REFUSED";

export interface PostApprovalResult {
  readonly outcome: PostApprovalOutcomeCode;
  readonly authorizationId: string | null;
  readonly verdictId: string | null;
  readonly postApprovalDecision: string | null;
  readonly refusalCode: string | null;
}

export interface LapseResult {
  readonly outcome: "LAPSED" | "NOT_DUE" | "ALREADY_DECIDED" | "LAPSE_REFUSED";
  readonly authorizationId: string | null;
  readonly verdictId: string | null;
  readonly refusalCode: string | null;
}

/** Read-only status, for reconciliation and operator display. */
export interface EmergencyAuthorizationStatus {
  readonly authorizationId: string;
  readonly environment: string;
  readonly reasonCode: string;
  readonly incidentReference: string | null;
  readonly scopeDigest: string;
  readonly revokedCredentialCount: number;
  readonly postApprovalDueAt: Date;
  readonly postApprovalDecision: string;
  readonly decidedAt: Date | null;
}

// ---------------------------------------------------------------------------
// The service contract
// ---------------------------------------------------------------------------

export interface DeviceRevocationService {
  /** Governed normal revocation. Four eyes, scope-bound, `kitluy_issuance_service`. */
  revokeNormal(call: GovernedRevocationCall): Promise<RevocationOutcome>;

  /** Immediate emergency revocation under the HUMAN's own authenticated session. */
  revokeEmergency(
    session: VerifiedHumanSession,
    request: EmergencyRevocationRequest,
  ): Promise<EmergencyRevocationResult>;

  /** Second-person post-approval under a DISTINCT human's authenticated session. */
  postApproveEmergency(
    session: VerifiedHumanSession,
    request: PostApprovalRequest,
  ): Promise<PostApprovalResult>;

  /**
   * Lapses ONE overdue authorization as the worker identity.
   *
   * Takes only the immutable authorization id — no actor, reason, incident,
   * scope or deadline. Everything else is read from the stored row.
   */
  lapseEmergencyPostApproval(authorizationId: string): Promise<LapseResult>;

  /** Status/reconciliation read. */
  readEmergencyStatus(authorizationId: string): Promise<EmergencyAuthorizationStatus | null>;
}

// ---------------------------------------------------------------------------
// jsonb readers. Total, and never trust a shape.
// ---------------------------------------------------------------------------

function record(raw: unknown): Readonly<Record<string, unknown>> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

function str(row: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function num(row: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // `cardinality()` arrives as a JS number through jsonb, but a bigint parser is
  // installed process-wide, so tolerate both rather than silently return null.
  if (typeof value === "bigint") return Number(value);
  return null;
}

// ---------------------------------------------------------------------------
// The real implementation
// ---------------------------------------------------------------------------

const OPERATIONS = {
  normal: "revoke_device_credential_bound_v1",
  emergency: "revoke_device_credential_emergency_governed_v1",
  postApproval: "record_governed_emergency_post_approval_v1",
  lapse: "lapse_governed_emergency_post_approval_v1",
  status: "read_governed_emergency_status",
} as const;

/**
 * Builds the ONE real service over a live client source.
 *
 * Takes a `ClientSource` rather than a gateway, because three of the four doors
 * need a DIFFERENT session identity than the normal gateway holds — a
 * pre-built gateway cannot express that, which is why the library adapter alone
 * was never sufficient to wire production.
 */
export function createDeviceRevocationService(source: ClientSource): DeviceRevocationService {
  return {
    async revokeNormal(call: GovernedRevocationCall): Promise<RevocationOutcome> {
      try {
        return await withServiceRole(source, REGISTRY_ROLES.issuance, async (client) => {
          // The library adapter, used exactly as shipped, inside a transaction
          // that already holds the governed identity. This is the production
          // caller RV-GW-001 said did not exist.
          const gateway: RevocationGateway = createPgRevocationGateway(client);
          return gateway.revokeDeviceCredential(call);
        });
      } catch (error) {
        throwRedacted(error, OPERATIONS.normal);
      }
    },

    async revokeEmergency(
      session: VerifiedHumanSession,
      request: EmergencyRevocationRequest,
    ): Promise<EmergencyRevocationResult> {
      try {
        return await withHumanSession(source, session, async (client) => {
          const { rows } = await client.query<{ result: unknown }>(
            `select kitluy_devices.revoke_device_credential_emergency_governed_v1(
               $1::uuid,
               $2::kitluy_devices.credential_revocation_reason,
               $3::text,
               $4::text,
               $5::uuid,
               $6::text,
               $7::uuid
             ) as result`,
            [
              request.credentialId,
              request.reasonCode,
              request.explanation,
              request.incidentReference,
              request.reauthEvidenceId,
              request.idempotencyKey,
              request.incidentScopeId ?? null,
            ],
          );
          const row = record(rows[0]?.result);
          const outcome = str(row, "outcome");
          return {
            outcome:
              outcome === "REVOKED_IMMEDIATELY" || outcome === "ALREADY_AUTHORIZED"
                ? outcome
                : "EMERGENCY_REFUSED",
            authorizationId: str(row, "authorization_id"),
            revokedCredentialCount: num(row, "revoked_credential_count"),
            postApprovalDueAt: str(row, "post_approval_due_at"),
            refusalCode: str(row, "refusal_code"),
          };
        });
      } catch (error) {
        throwRedacted(error, OPERATIONS.emergency);
      }
    },

    async postApproveEmergency(
      session: VerifiedHumanSession,
      request: PostApprovalRequest,
    ): Promise<PostApprovalResult> {
      try {
        return await withHumanSession(source, session, async (client) => {
          const { rows } = await client.query<{ result: unknown }>(
            `select kitluy_devices.record_governed_emergency_post_approval_v1(
               $1::uuid, $2::text, $3::uuid, $4::text
             ) as result`,
            [
              request.authorizationId,
              request.decision,
              request.reauthEvidenceId,
              request.note ?? null,
            ],
          );
          const row = record(rows[0]?.result);
          const outcome = str(row, "outcome");
          return {
            outcome:
              outcome === "POST_APPROVED" ||
              outcome === "MANUAL_SECURITY_REVIEW" ||
              outcome === "ALREADY_DECIDED"
                ? outcome
                : "POST_APPROVAL_REFUSED",
            authorizationId: str(row, "authorization_id"),
            verdictId: str(row, "verdict_id"),
            postApprovalDecision: str(row, "post_approval_decision"),
            refusalCode: str(row, "refusal_code"),
          };
        });
      } catch (error) {
        throwRedacted(error, OPERATIONS.postApproval);
      }
    },

    async lapseEmergencyPostApproval(authorizationId: string): Promise<LapseResult> {
      try {
        return await withServiceRole(source, REGISTRY_ROLES.worker, async (client) => {
          const { rows } = await client.query<{ result: unknown }>(
            `select kitluy_devices.lapse_governed_emergency_post_approval_v1(
               $1::uuid, $2::text
             ) as result`,
            [authorizationId, "LAPSE_WORKER"],
          );
          const row = record(rows[0]?.result);
          const outcome = str(row, "outcome");
          return {
            outcome:
              outcome === "LAPSED" || outcome === "NOT_DUE" || outcome === "ALREADY_DECIDED"
                ? outcome
                : "LAPSE_REFUSED",
            authorizationId: str(row, "authorization_id"),
            verdictId: str(row, "verdict_id"),
            refusalCode: str(row, "refusal_code"),
          };
        });
      } catch (error) {
        throwRedacted(error, OPERATIONS.lapse);
      }
    },

    async readEmergencyStatus(
      authorizationId: string,
    ): Promise<EmergencyAuthorizationStatus | null> {
      try {
        // Read as the WORKER, which is the least-privileged identity that needs
        // reconciliation status. Deliberately not the human session: a
        // reconciliation sweep has no human behind it, and borrowing one would
        // fabricate an actor in the audit trail.
        return await withServiceRole(source, REGISTRY_ROLES.worker, async (client) =>
          readStatus(client, authorizationId),
        );
      } catch (error) {
        throwRedacted(error, OPERATIONS.status);
      }
    },
  };
}

/**
 * Reads status through the group 0155 definer bridge.
 *
 * NOT a direct table SELECT, and that is a privilege decision rather than a
 * stylistic one: `kitluy_worker_service` holds USAGE on `kitluy_devices` and
 * SELECT on nothing in it (verified by the group 0155 census). A join across the
 * authorization and verdict tables from here would fail `42501`, and the fix that
 * suggests itself — grant the worker SELECT — would hand it every explanation and
 * tenancy column in the table to satisfy a status read.
 */
async function readStatus(
  client: PoolClient,
  authorizationId: string,
): Promise<EmergencyAuthorizationStatus | null> {
  const { rows } = await client.query<{ result: unknown }>(
    `select kitluy_devices.governed_emergency_status_v1($1::uuid) as result`,
    [authorizationId],
  );
  const raw = rows[0]?.result;
  // The bridge returns SQL NULL for an authorization that does not exist, which
  // a caller must be able to tell apart from one that exists and is PENDING.
  if (raw === null || raw === undefined) return null;
  const row = record(raw);
  const id = str(row, "authorization_id");
  if (id === null) return null;
  const dueAt = str(row, "post_approval_due_at");
  const decidedAt = str(row, "decided_at");
  return {
    authorizationId: id,
    environment: str(row, "environment") ?? "",
    reasonCode: str(row, "reason_code") ?? "",
    incidentReference: str(row, "incident_reference"),
    scopeDigest: str(row, "scope_digest") ?? "",
    revokedCredentialCount: num(row, "revoked_credential_count") ?? 0,
    postApprovalDueAt: dueAt === null ? new Date(0) : new Date(dueAt),
    postApprovalDecision: str(row, "post_approval_decision") ?? "PENDING",
    decidedAt: decidedAt === null ? null : new Date(decidedAt),
  };
}
