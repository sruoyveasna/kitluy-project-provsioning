/**
 * Terminal-provisioning composition — WS-11-T004-P02C.
 *
 * Authority: pairing protocol §7 (the cloud-side provisioning flow); the
 * P02B3C composition-readiness audit; migration group 0172 (the
 * `kitluy_provisioning_service` identity and its EXACTLY-five capabilities);
 * the OPTION B ruling of group 0127 (Ed25519 verification lives in
 * `@kitluy/device-identity`, the database records the attestation).
 *
 * ===========================================================================
 * WHAT THIS LAYER IS — AND IS NOT
 * ===========================================================================
 * This is the TRUSTED INTERNAL composition service: three typed operations
 * that orchestrate the governed doors in the required order, each inside one
 * `withServiceRole` transaction as the NOLOGIN composition identity. It is
 * NOT an HTTP surface: pre-credential terminal TRANSPORT authority is
 * undefined in this repository (Boundary B classification B3 — the same
 * recorded posture as the revocation routes' refusing authenticator under
 * BLK-006), so no route ships here and none of these methods trusts a caller
 * identity. The provisioning code and the terminal-key proof ARE the request
 * authority, revalidated by the authoritative doors on every call.
 *
 * Every authoritative decision stays in the database or the crypto
 * authority. This layer never counts attempts, never fabricates lifecycle
 * events, never chooses credential serials for a caller (serials are
 * generated HERE, server-side, never terminal-selected) and never converts a
 * refusal into a false success. Outcomes map to a closed, stable result
 * vocabulary; PostgreSQL SQLSTATEs, function names and row identities never
 * leak through it.
 *
 * OBSERVABILITY: the optional logger receives ONLY safe fields (operation,
 * correlation id, result family, environment). Raw codes, nonces, digests,
 * signatures and key material are never logged — the redaction is
 * structural: those values are simply never passed to the logger.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";

import {
  publicKeyFingerprint,
  provisioningChallengeBytes,
  provisioningChallengeHash,
  verifyProvisioningPop,
  type ProvisioningPopChallenge,
  type ProvisioningPopExpectation,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";

import { withServiceRole, REGISTRY_ROLES, type ClientSource } from "./database.js";

/** The closed result vocabulary this layer may return. Nothing else escapes. */
export type ProvisioningResultCode =
  | "CHALLENGE_ISSUED"
  | "CODE_INVALID"
  | "CODE_LOCKED"
  | "CODE_EXPIRED"
  | "CODE_REVOKED"
  | "CODE_REDEEMED"
  | "CODE_ALREADY_PROVEN"
  | "PROOF_VERIFIED"
  | "PROOF_ALREADY_VERIFIED"
  | "PROOF_INVALID"
  | "PROOF_BINDING_MISMATCH"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_NOT_FOUND"
  | "HUB_INACTIVE"
  | "ASSIGNMENT_INACTIVE"
  | "ENROLLMENT_INELIGIBLE"
  | "CREDENTIAL_CONFLICT"
  | "REDEEMED"
  | "REDEMPTION_REPLAYED"
  | "IDEMPOTENCY_CONFLICT"
  | "PKI_UNAVAILABLE"
  | "REQUEST_INVALID"
  | "INTERNAL_ERROR";

export interface SafeLogger {
  info(fields: Readonly<Record<string, string | number | boolean>>): void;
}

const NO_LOG: SafeLogger = { info: () => undefined };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CROCKFORD = /^[0-9A-Za-z]{8}$/;
/** Bounded so the derived server-side serial stays inside its own contract. */
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{1,96}$/;
/** Detached Ed25519 signatures are 64 bytes; base64 of that is 88 chars. */
const MAX_SIGNATURE_BASE64 = 128;

/**
 * Maps a governed door refusal to the closed vocabulary. The mapping is by
 * REFUSAL CODE family — never by SQLSTATE, never by message text — and an
 * unknown refusal maps to INTERNAL_ERROR rather than being passed through.
 */
function mapRefusal(refusalCode: string): ProvisioningResultCode {
  if (refusalCode.includes("ALREADY-REDEEMED") || refusalCode.includes("CODE-ALREADY-REDEEMED")) {
    return "CODE_REDEEMED";
  }
  if (refusalCode.includes("ALREADY-REVOKED")) return "CODE_REVOKED";
  if (refusalCode.includes("ALREADY-LOCKED") || refusalCode.endsWith("-LOCKED"))
    return "CODE_LOCKED";
  if (refusalCode.includes("CHALLENGE-EXPIRED") || refusalCode.includes("PROOF-EXPIRED")) {
    return "CHALLENGE_EXPIRED";
  }
  if (refusalCode.includes("EXPIRED")) return "CODE_EXPIRED";
  if (refusalCode === "FAILED_PRESENTATION" || refusalCode.includes("NO-OUTSTANDING")) {
    return "CODE_INVALID";
  }
  if (refusalCode.includes("CHALLENGE-NOT-FOUND") || refusalCode.includes("PROOF-NOT-FOUND")) {
    return "CHALLENGE_NOT_FOUND";
  }
  if (refusalCode.includes("ALREADY-PROVEN")) return "CODE_ALREADY_PROVEN";
  if (refusalCode.includes("ALREADY-CONSUMED")) return "PROOF_BINDING_MISMATCH";
  if (refusalCode.includes("HUB-INACTIVE")) return "HUB_INACTIVE";
  if (refusalCode.includes("ASSIGNMENT")) return "ASSIGNMENT_INACTIVE";
  if (refusalCode.includes("ENROLLMENT")) return "ENROLLMENT_INELIGIBLE";
  if (refusalCode.includes("CREDENTIAL-CONFLICT")) return "CREDENTIAL_CONFLICT";
  if (refusalCode.includes("CREDENTIAL-REFUSED") || refusalCode.includes("NO-TRUSTED-TIME")) {
    return "PKI_UNAVAILABLE";
  }
  if (refusalCode.includes("CONFLICTING-REPLAY")) return "IDEMPOTENCY_CONFLICT";
  if (
    refusalCode.includes("SIGNATURE-REJECTED") ||
    refusalCode.includes("KEY-MISMATCH") ||
    refusalCode.includes("NOT-VERIFIED")
  ) {
    return "PROOF_INVALID";
  }
  if (
    refusalCode.includes("WRONG-") ||
    refusalCode.includes("SCOPE") ||
    refusalCode.includes("MISMATCH")
  ) {
    return "PROOF_BINDING_MISMATCH";
  }
  if (
    refusalCode.includes("MALFORMED") ||
    refusalCode.includes("CONTRACT") ||
    refusalCode.includes("NO-")
  ) {
    return "REQUEST_INVALID";
  }
  return "INTERNAL_ERROR";
}

export interface ChallengeMaterial {
  readonly challengeId: string;
  readonly challengeVersion: string;
  readonly purpose: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly terminalAssignmentId: string;
  readonly terminalProfileKey: string;
  readonly correlationId: string;
}

export interface CompositionResult<T = undefined> {
  readonly result: ProvisioningResultCode;
  readonly correlationId: string;
  readonly data?: T;
}

export interface CredentialMaterial {
  readonly certificateId: string;
  readonly certificateSerial: string;
  readonly certificateFingerprint: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly storeHubDeviceId: string;
  readonly terminalProfileKey: string;
  readonly environment: string;
  readonly credentialAction: string;
  readonly redeemedAt: string;
}

interface DoorRow {
  result: Record<string, unknown>;
}

async function callDoor(
  client: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<DoorRow>(`select ${sql} as result`, params);
  return rows[0]?.result ?? {};
}

/**
 * The terminal-provisioning composition service. One instance per process,
 * holding the pool; every operation is one governed transaction under the
 * NOLOGIN composition identity.
 */
export class TerminalProvisioningComposition {
  constructor(
    private readonly source: ClientSource,
    private readonly logger: SafeLogger = NO_LOG,
  ) {}

  /**
   * Step 1 + 2: present the provisioning code through the governed evaluator
   * and — only on the canonical MATCH_READY — issue (or politely refuse) the
   * PoP challenge. Wrong presentations use the evaluator's own attempt and
   * lockout accounting; this layer never counts anything.
   */
  async presentCodeAndIssueChallenge(input: {
    readonly terminalAssignmentId: string;
    readonly presentedCode: string;
    readonly terminalReference: string;
  }): Promise<CompositionResult<ChallengeMaterial>> {
    const correlationId = randomUUID();
    if (
      !UUID.test(input.terminalAssignmentId) ||
      !CROCKFORD.test(input.presentedCode) ||
      input.terminalReference.length === 0 ||
      input.terminalReference.length > 128
    ) {
      return { result: "REQUEST_INVALID", correlationId };
    }
    try {
      const outcome = await withServiceRole(
        this.source,
        REGISTRY_ROLES.provisioning,
        async (client) => {
          const evaluated = await callDoor(
            client,
            `kitluy_devices.evaluate_terminal_provisioning_code_v1($1::uuid, $2, $3::uuid, 'TERMINAL', $4::text)`,
            [
              input.terminalAssignmentId,
              input.presentedCode,
              correlationId,
              input.terminalReference,
            ],
          );
          if (evaluated.outcome !== "MATCH_READY") {
            return {
              result: mapRefusal(String(evaluated.refusal_code ?? evaluated.outcome ?? "")),
            } as const;
          }
          const issued = await callDoor(
            client,
            `kitluy_devices.issue_terminal_provisioning_pop_challenge_v1($1::uuid)`,
            [input.terminalAssignmentId],
          );
          if (issued.outcome !== "POP_CHALLENGE_ISSUED") {
            return { result: mapRefusal(String(issued.refusal_code ?? "")) } as const;
          }
          const material: ChallengeMaterial = {
            challengeId: String(issued.challenge_id),
            challengeVersion: String(issued.challenge_version),
            purpose: String(issued.purpose),
            nonce: String(issued.nonce),
            issuedAt: String(issued.created_at),
            expiresAt: String(issued.expires_at),
            terminalAssignmentId: String(issued.terminal_assignment_id),
            terminalProfileKey: String(issued.terminal_profile_key),
            correlationId: String(issued.correlation_id),
          };
          return { result: "CHALLENGE_ISSUED", material } as const;
        },
      );
      this.logger.info({
        operation: "presentCodeAndIssueChallenge",
        correlationId,
        result: outcome.result,
      });
      return {
        result: outcome.result as ProvisioningResultCode,
        correlationId,
        data: "material" in outcome ? outcome.material : undefined,
      };
    } catch {
      this.logger.info({
        operation: "presentCodeAndIssueChallenge",
        correlationId,
        result: "INTERNAL_ERROR",
      });
      return { result: "INTERNAL_ERROR", correlationId };
    }
  }

  /**
   * Steps 3–5: fetch AUTHORITATIVE challenge context through the narrow 0172
   * reader, reconstruct the canonical bytes, verify the terminal's signature
   * with the existing crypto authority, and — only on a genuine pass —
   * record the attestation. A failed verification never touches the
   * successful-attestation path.
   */
  async verifyProofAndRecord(input: {
    readonly challengeId: string;
    readonly signatureBase64: string;
    readonly terminalPublicKeyPem: string;
  }): Promise<CompositionResult<{ readonly verifiedAt: string; readonly expiresAt: string }>> {
    const correlationId = randomUUID();
    if (
      !UUID.test(input.challengeId) ||
      input.signatureBase64.length === 0 ||
      input.signatureBase64.length > MAX_SIGNATURE_BASE64 ||
      !/^[A-Za-z0-9+/=]+$/.test(input.signatureBase64) ||
      !input.terminalPublicKeyPem.includes("BEGIN PUBLIC KEY")
    ) {
      return { result: "REQUEST_INVALID", correlationId };
    }
    try {
      const outcome = await withServiceRole(
        this.source,
        REGISTRY_ROLES.provisioning,
        async (client) => {
          const ctx = await callDoor(
            client,
            `kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1($1::uuid)`,
            [input.challengeId],
          );
          if (ctx.outcome !== "CONTEXT") {
            return { result: mapRefusal(String(ctx.refusal_code ?? "")) } as const;
          }
          if (ctx.state === "verified") return { result: "PROOF_ALREADY_VERIFIED" } as const;
          if (ctx.state !== "issued") return { result: "PROOF_BINDING_MISMATCH" } as const;

          // The canonical bytes come from the AUTHORITATIVE row — never from a
          // caller-supplied payload.
          const challenge: ProvisioningPopChallenge = {
            challengeId: String(ctx.challenge_id),
            purpose: String(ctx.purpose),
            tenantId: String(ctx.tenant_id),
            digitalStoreId: String(ctx.digital_store_id),
            storeLocationId: String(ctx.store_location_id),
            environment: String(ctx.environment) as ProvisioningPopChallenge["environment"],
            storeHubDeviceId: String(ctx.store_hub_device_id),
            terminalDeviceId: String(ctx.terminal_device_id),
            terminalAssignmentId: String(ctx.terminal_assignment_id),
            terminalProfileKey: String(ctx.terminal_profile_key),
            provisioningCodeId: String(ctx.provisioning_code_id),
            terminalKeyFingerprint: String(ctx.terminal_key_fingerprint),
            nonce: String(ctx.nonce),
            issuedAt: new Date(String(ctx.created_at)),
            expiresAt: new Date(String(ctx.expires_at)),
          };
          const expectation: ProvisioningPopExpectation = {
            challengeId: challenge.challengeId,
            purpose: challenge.purpose,
            tenantId: challenge.tenantId,
            digitalStoreId: challenge.digitalStoreId,
            storeLocationId: challenge.storeLocationId,
            environment: challenge.environment,
            storeHubDeviceId: challenge.storeHubDeviceId,
            terminalDeviceId: challenge.terminalDeviceId,
            terminalAssignmentId: challenge.terminalAssignmentId,
            terminalProfileKey: challenge.terminalProfileKey,
            provisioningCodeId: challenge.provisioningCodeId,
            enrolledKeyFingerprint: challenge.terminalKeyFingerprint,
            enrollmentState: String(ctx.enrollment_state),
          };
          const trusted: TrustedTimeEvaluation = {
            status: "trusted",
            trustedTime: new Date(String(ctx.authoritative_now)),
          } as TrustedTimeEvaluation;
          const verdict = verifyProvisioningPop(
            challenge,
            Uint8Array.from(Buffer.from(input.signatureBase64, "base64")),
            input.terminalPublicKeyPem,
            expectation,
            trusted,
            publicKeyFingerprint,
          );
          if (!verdict.verified) {
            // NEVER the successful-attestation path. The specific crypto
            // refusal stays internal; the caller learns the safe family only.
            return { result: "PROOF_INVALID" } as const;
          }
          const recorded = await callDoor(
            client,
            `kitluy_devices.record_terminal_provisioning_pop_verification_v1($1::uuid, true, $2, $3)`,
            [
              challenge.challengeId,
              verdict.challengeHash ?? provisioningChallengeHash(challenge),
              publicKeyFingerprint(input.terminalPublicKeyPem),
            ],
          );
          if (recorded.outcome === "POP_VERIFIED") {
            return {
              result: "PROOF_VERIFIED",
              data: {
                verifiedAt: String(recorded.verified_at),
                expiresAt: String(recorded.expires_at),
              },
            } as const;
          }
          if (recorded.outcome === "POP_ALREADY_VERIFIED") {
            return { result: "PROOF_ALREADY_VERIFIED" } as const;
          }
          return { result: mapRefusal(String(recorded.refusal_code ?? "")) } as const;
        },
      );
      this.logger.info({
        operation: "verifyProofAndRecord",
        correlationId,
        result: outcome.result,
      });
      return {
        result: outcome.result as ProvisioningResultCode,
        correlationId,
        data: "data" in outcome ? outcome.data : undefined,
      };
    } catch {
      this.logger.info({
        operation: "verifyProofAndRecord",
        correlationId,
        result: "INTERNAL_ERROR",
      });
      return { result: "INTERNAL_ERROR", correlationId };
    }
  }

  /**
   * Steps 6–7: atomic redemption. The terminal presents the raw code AGAIN
   * (an earlier MATCH_READY is never trusted); the certificate serial is
   * generated HERE, server-side — never terminal-selected. Identical retries
   * carry the caller's idempotency key straight to the door, which owns
   * replay reconciliation.
   */
  async redeemProvisioning(input: {
    readonly terminalAssignmentId: string;
    readonly presentedCode: string;
    readonly challengeId: string;
    readonly idempotencyKey: string;
  }): Promise<CompositionResult<CredentialMaterial>> {
    const correlationId = randomUUID();
    if (
      !UUID.test(input.terminalAssignmentId) ||
      !CROCKFORD.test(input.presentedCode) ||
      !UUID.test(input.challengeId) ||
      !IDEMPOTENCY_KEY.test(input.idempotencyKey)
    ) {
      return { result: "REQUEST_INVALID", correlationId };
    }
    // SERVER-CONTROLLED serial: derived from the idempotency key so an
    // identical retry after an ambiguous outcome re-presents the SAME
    // immutable request (a fresh random serial would turn a replay into a
    // conflict at the credential authority's uniqueness rule).
    const serial = `TERM-DEV-${input.idempotencyKey}`;
    try {
      const outcome = await withServiceRole(
        this.source,
        REGISTRY_ROLES.provisioning,
        async (client) => {
          const redeemed = await callDoor(
            client,
            `kitluy_devices.redeem_terminal_provisioning_code_v1($1::uuid, $2, $3::uuid, $4, $5)`,
            [
              input.terminalAssignmentId,
              input.presentedCode,
              input.challengeId,
              input.idempotencyKey,
              serial,
            ],
          );
          if (redeemed.outcome === "REDEEMED" || redeemed.outcome === "ALREADY_REDEEMED") {
            const data: CredentialMaterial = {
              certificateId: String(redeemed.certificate_id),
              certificateSerial: String(redeemed.certificate_serial ?? ""),
              certificateFingerprint: String(redeemed.certificate_fingerprint ?? ""),
              issuedAt: String(redeemed.certificate_issued_at ?? ""),
              expiresAt: String(redeemed.certificate_expires_at ?? ""),
              terminalDeviceId: String(redeemed.terminal_device_id ?? ""),
              terminalAssignmentId: String(redeemed.terminal_assignment_id),
              storeHubDeviceId: String(redeemed.store_hub_device_id ?? ""),
              terminalProfileKey: String(redeemed.terminal_profile_key ?? ""),
              environment: String(redeemed.environment ?? ""),
              credentialAction: String(redeemed.credential_action ?? "REPLAYED"),
              redeemedAt: String(redeemed.redeemed_at),
            };
            return {
              result: redeemed.outcome === "REDEEMED" ? "REDEEMED" : "REDEMPTION_REPLAYED",
              data,
            } as const;
          }
          return { result: mapRefusal(String(redeemed.refusal_code ?? "")) } as const;
        },
      );
      this.logger.info({ operation: "redeemProvisioning", correlationId, result: outcome.result });
      return {
        result: outcome.result as ProvisioningResultCode,
        correlationId,
        data: "data" in outcome ? outcome.data : undefined,
      };
    } catch {
      this.logger.info({
        operation: "redeemProvisioning",
        correlationId,
        result: "INTERNAL_ERROR",
      });
      return { result: "INTERNAL_ERROR", correlationId };
    }
  }
}

/** Exported for tests: the canonical bytes helper this layer signs nothing with. */
export { provisioningChallengeBytes };
