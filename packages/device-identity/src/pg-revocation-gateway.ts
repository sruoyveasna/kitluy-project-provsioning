/**
 * Production Postgres adapter for {@link RevocationGateway}.
 *
 * Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001; migration groups
 * 0145–0147 (RC-019); WS-11-T003 Step 4 Phase C.
 *
 * Wraps ONLY `kitluy_devices.revoke_device_credential_bound_v1` — the ONE
 * normal revocation a runtime identity may execute since group 0147. Never aims
 * at `revoke_device_credential_v1` or the tautological
 * `revoke_device_credential_governed_v1` (EXECUTE revoked from every runtime
 * identity). The caller must already be the authorized executor
 * (`kitluy_issuance_service`); this adapter does not SET ROLE.
 *
 * Scope selectors on {@link GovernedRevocationCall} (`providerKeyReference`,
 * etc.) are ignored here on purpose: the bound path derives the affected set
 * from STORED ROWS (group 0146), never from caller parameters.
 */
import type { PoolClient, QueryResult } from "pg";

import type {
  GovernedRevocationCall,
  RevocationGateway,
  RevocationOutcome,
  RevocationOutcomeCode,
} from "./credential-revocation.js";

export type RevocationSqlExecutor = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

const KNOWN: ReadonlySet<string> = new Set([
  "REVOKED",
  "ALREADY_REVOKED",
  "REVOCATION_REFUSED",
  "MANUAL_REVIEW_REQUIRED",
]);

function asOutcome(raw: unknown): RevocationOutcome {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      outcome: "MANUAL_REVIEW_REQUIRED",
      refusalCode: "REVOCATION_UNKNOWN_OUTCOME",
      detail: "the governed revocation returned a non-object jsonb payload",
    };
  }
  const row = raw as Record<string, unknown>;
  const outcome = String(row.outcome ?? "");
  if (!KNOWN.has(outcome)) {
    return {
      outcome: "MANUAL_REVIEW_REQUIRED",
      refusalCode: "REVOCATION_UNKNOWN_OUTCOME",
      detail: `the governed revocation returned an unrecognised outcome (${outcome})`,
    };
  }
  return {
    outcome: outcome as RevocationOutcomeCode,
    refusalCode:
      typeof row.refusal_code === "string"
        ? row.refusal_code
        : typeof row.refusalCode === "string"
          ? row.refusalCode
          : undefined,
    detail: typeof row.detail === "string" ? row.detail : undefined,
    revocationId:
      typeof row.revocation_id === "string"
        ? row.revocation_id
        : typeof row.revocationId === "string"
          ? row.revocationId
          : undefined,
    credentialId:
      typeof row.credential_id === "string"
        ? row.credential_id
        : typeof row.credentialId === "string"
          ? row.credentialId
          : undefined,
    credentialGeneration:
      typeof row.credential_generation === "number"
        ? row.credential_generation
        : typeof row.credentialGeneration === "number"
          ? row.credentialGeneration
          : undefined,
    publicKeyFingerprint:
      typeof row.public_key_fingerprint === "string"
        ? row.public_key_fingerprint
        : typeof row.publicKeyFingerprint === "string"
          ? row.publicKeyFingerprint
          : undefined,
    reasonCode:
      typeof row.reason_code === "string"
        ? (row.reason_code as RevocationOutcome["reasonCode"])
        : typeof row.reasonCode === "string"
          ? (row.reasonCode as RevocationOutcome["reasonCode"])
          : undefined,
    recoveryDisposition:
      typeof row.recovery_disposition === "string"
        ? (row.recovery_disposition as RevocationOutcome["recoveryDisposition"])
        : typeof row.recoveryDisposition === "string"
          ? (row.recoveryDisposition as RevocationOutcome["recoveryDisposition"])
          : undefined,
    recoveryCaseId:
      typeof row.recovery_case_id === "string"
        ? row.recovery_case_id
        : typeof row.recoveryCaseId === "string"
          ? row.recoveryCaseId
          : undefined,
    effectiveAt:
      typeof row.effective_at === "string"
        ? row.effective_at
        : typeof row.effectiveAt === "string"
          ? row.effectiveAt
          : undefined,
  };
}

/**
 * Builds a {@link RevocationGateway} over a live Postgres client or pool.
 *
 * The session identity must already hold EXECUTE on
 * `revoke_device_credential_bound_v1` (production: `kitluy_issuance_service`).
 */
export function createPgRevocationGateway(client: RevocationSqlExecutor): RevocationGateway {
  return {
    async revokeDeviceCredential(call: GovernedRevocationCall): Promise<RevocationOutcome> {
      const result = await client.query<{ result: unknown }>(
        `select kitluy_devices.revoke_device_credential_bound_v1(
           $1::text,
           $2::uuid,
           $3::text,
           $4::text,
           $5::integer,
           $6::kitluy_devices.credential_revocation_reason,
           $7::text,
           $8::kitluy_devices.credential_recovery_disposition,
           $9::text,
           $10::text,
           $11::uuid,
           $12::text,
           $13::text,
           $14::uuid
         ) as result`,
        [
          call.revocationRequestId,
          call.deviceRecordId,
          call.environment,
          call.purpose,
          call.credentialGeneration,
          call.reasonCode,
          call.reason,
          call.recoveryDisposition,
          call.requestedBy,
          call.source,
          call.approvalRequestId,
          call.approvedBy,
          call.incidentReference,
          call.incidentScopeId ?? null,
        ],
      );
      return asOutcome(result.rows[0]?.result);
    },
  };
}

/** Convenience when the caller already holds a `pg.PoolClient`. */
export function createPgRevocationGatewayFromPoolClient(client: PoolClient): RevocationGateway {
  return createPgRevocationGateway(client);
}
