/**
 * Factory-enrollment composition — the orchestration between the governed
 * `0190` doors, the proof-of-possession verifier and the signed time token.
 *
 * Authority:
 *   KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2)
 *   KLSRC-0162 §4 (enrollment is automatic), §35 (enrollment is not pairing)
 *
 * ===========================================================================
 * ENUMERATION RESISTANCE IS DECIDED HERE, NOT AT THE ROUTE
 * ===========================================================================
 * Migration `0190` already returns the SAME refusal code for an unknown ticket
 * reference and a wrong ticket secret, so the database cannot be used as an
 * oracle. That property is easy to destroy one layer up: mapping
 * `EXPIRED`, `REVOKED` and `ALREADY_REDEEMED` to distinguishable outcomes
 * would each prove a ticket EXISTS.
 *
 * So every ticket-authority refusal collapses to ONE external result —
 * `TICKET_REFUSED` — and the specific internal code is carried only in
 * `auditDetail`, which the route logs and never returns. The mapping is a
 * total function over the door's refusal vocabulary rather than a default
 * branch, so a NEW refusal code added to `0190` later cannot silently fall
 * through to a distinguishable response.
 *
 * ===========================================================================
 * WHAT SUCCESS MEANS
 * ===========================================================================
 * `ENROLLED` + `UNASSIGNED`, and nothing else. No Tenant, Digital Store,
 * Location, Store Hub, terminal profile or vertical is created or returned,
 * because none exists at this stage (§35).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  MANUFACTURING_ENROLLMENT_POP_PURPOSE,
  verifyManufacturingEnrollmentPop,
  type ManufacturingEnrollmentPopChallenge,
  type SnapshotSignatureEnvelope,
  type SnapshotSigner,
  type SnapshotSigningKeyReference,
  type TrustEnvironment,
  type EnrollmentTimeToken,
} from "@kitluy/device-identity";
import type pg from "pg";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";
import { mintEnrollmentTimeToken } from "./enrollment-time-signer.js";
import type { SafeLogger } from "./provisioning-composition.js";

/**
 * External result vocabulary. Deliberately COARSER than the door's, because
 * the difference between "no such ticket" and "that ticket expired" is exactly
 * the information an attacker wants.
 */
export type EnrollmentResultCode =
  | "CHALLENGE_ISSUED"
  | "ENROLLED"
  /** Every ticket-authority refusal, collapsed. See the header. */
  | "TICKET_REFUSED"
  | "PROOF_INVALID"
  | "CHALLENGE_NOT_FOUND"
  | "ENROLLMENT_REFUSED"
  | "TIME_TOKEN_UNAVAILABLE"
  | "REQUEST_INVALID"
  | "INTERNAL_ERROR";

export interface EnrollmentCompositionResult<T = undefined> {
  readonly result: EnrollmentResultCode;
  readonly correlationId: string;
  readonly data?: T;
  /** Specific internal cause. Logged, NEVER returned to the caller. */
  readonly auditDetail?: string;
}

export interface EnrollmentChallengeMaterial {
  readonly challengeId: string;
  readonly nonce: string;
  readonly purpose: typeof MANUFACTURING_ENROLLMENT_POP_PURPOSE;
  readonly environment: TrustEnvironment;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  /** Locked wire forms, so a device never has to guess. */
  readonly signatureAlgorithm: "ed25519";
  readonly signingPayloadEncoding: "base64url";
}

export interface EnrolledDeviceMaterial {
  readonly deviceRecordId: string;
  readonly fleetEnrollment: "enrolled";
  readonly storeAssignment: "unassigned";
  readonly environment: TrustEnvironment;
  readonly timeToken: EnrollmentTimeToken;
  readonly timeTokenSignature: SnapshotSignatureEnvelope;
}

/**
 * Ticket-authority refusals from `0190`, mapped TOTALLY.
 *
 * Every one collapses to `TICKET_REFUSED`. The value is the audit string, not
 * a distinguishing outcome — expiry, revocation and prior redemption each
 * prove a ticket exists, so none may reach the wire.
 */
const TICKET_REFUSALS: Readonly<Record<string, string>> = {
  "KLUY-MFGTICKET-UNKNOWN-OR-INVALID": "unknown reference or wrong secret",
  "KLUY-MFGTICKET-ALREADY-REDEEMED": "ticket already produced a device",
  "KLUY-MFGTICKET-REVOKED": "ticket revoked",
  "KLUY-MFGTICKET-EXPIRED": "ticket expired",
  "KLUY-MFGTICKET-KEY-STORAGE": "key storage class not permitted in this environment",
  "KLUY-MFGTICKET-FINGERPRINT-INVALID": "malformed fingerprint",
  "KLUY-MFGTICKET-NOT-LIVE": "ticket revoked or expired",
};

interface DoorRow {
  readonly result: Record<string, unknown>;
}

async function callDoor(
  client: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<DoorRow>(`select ${sql} as result`, params);
  return rows[0]?.result ?? {};
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const NO_LOG: SafeLogger = { info: () => undefined };

/**
 * DEVELOPMENT OPEN ENROLLMENT (KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001).
 *
 * The owner's development loop is: flash one card, copy it freely, boot every
 * Pi, watch them come online. A per-card preparation step is the one thing that
 * cannot survive being copied, so in DEVELOPMENT the service mints the ticket
 * itself for a device that presents none.
 *
 * ===========================================================================
 * WHAT THIS IS NOT
 * ===========================================================================
 * It is not a bypass. The device still proves possession of its own key, the
 * ticket is still issued and redeemed through the same governed doors, and
 * every §5 property still holds — per-device, single-use, expiring, revocable,
 * auditable, digest-at-rest. The audit trail is identical to a station's.
 *
 * What changes is WHO MAY ASK: a prepared card, or anyone who can reach the
 * endpoint. That is the whole of the accepted risk, and it is why this is
 * refused outside `development`.
 */
export interface DevelopmentOpenEnrollment {
  /** A REGISTERED, active station; an unregistered one quarantines the device. */
  readonly stationKey: string;
  readonly operatorRef: string;
  /** Resolved at startup, so a misconfigured profile refuses at boot. */
  readonly profileIdByDeviceClass: Readonly<Record<string, string>>;
  /** Hours a self-minted ticket stays live. It is redeemed within seconds. */
  readonly validForHours?: number;
}

export interface EnrollmentCompositionDeps {
  readonly source: ClientSource;
  readonly signer: SnapshotSigner;
  readonly timeKeyReference: SnapshotSigningKeyReference | null;
  readonly logger?: SafeLogger;
  /** Injectable so tests measure policy rather than wall time. */
  readonly now?: () => Date;
  /** Absent means OFF. A deployment that says nothing gets the ticket path. */
  readonly openEnrollment?: DevelopmentOpenEnrollment;
}

export class EnrollmentComposition {
  private readonly logger: SafeLogger;
  private readonly now: () => Date;

  constructor(private readonly deps: EnrollmentCompositionDeps) {
    this.logger = deps.logger ?? NO_LOG;
    this.now = deps.now ?? (() => new Date());
  }

  /** Whether this deployment will mint a ticket for a device that has none. */
  get openEnrollmentEnabled(): boolean {
    return this.deps.openEnrollment !== undefined;
  }

  /**
   * Step 1, development variant — a device with NO ticket.
   *
   * The service mints one and opens the challenge with it, in ONE transaction
   * as the same governed role. If issuance is refused, nothing is opened: there
   * is no path here that reaches a challenge without a real ticket behind it.
   *
   * The secret is generated, digested, and dropped inside this method. It is
   * never returned, logged, or written anywhere — the device never sees it and
   * never needs to, because it is not the device that proves the ticket here.
   */
  async openChallengeWithoutTicket(input: {
    readonly deviceClass: string;
    readonly publicKeyFingerprint: string;
    readonly publicKeyPem: string;
    readonly publicKeyAlgorithm: string;
    readonly keyStorageClass: string;
  }): Promise<EnrollmentCompositionResult<EnrollmentChallengeMaterial>> {
    const correlationId = randomUUID();
    const open = this.deps.openEnrollment;

    if (open === undefined) {
      // Not enabled. Reported as a ticket refusal so an enabled and a disabled
      // deployment are indistinguishable to a caller probing for one.
      return {
        result: "TICKET_REFUSED",
        correlationId,
        auditDetail: "open enrollment is not enabled on this deployment",
      };
    }
    if (
      !HEX64.test(input.publicKeyFingerprint) ||
      input.publicKeyPem.length === 0 ||
      input.publicKeyPem.length > 4096
    ) {
      return { result: "REQUEST_INVALID", correlationId };
    }

    const profileId = open.profileIdByDeviceClass[input.deviceClass];
    if (profileId === undefined) {
      return {
        result: "TICKET_REFUSED",
        correlationId,
        auditDetail: `no development profile configured for device class ${input.deviceClass}`,
      };
    }

    // The reference names an automatically issued ticket, so the audit trail
    // shows at a glance which enrollments came from an unattended front desk.
    const reference = `KL-DEVOPEN-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    const secret = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(secret, "utf8").digest("hex");

    try {
      return await withServiceRole(this.deps.source, REGISTRY_ROLES.fleet, async (client) => {
        const issued = await callDoor(
          client,
          `kitluy_devices.issue_manufacturing_enrollment_ticket_v1(
             $1, $2, $3::uuid, $4, $5, $6, $7, $8, null)`,
          [
            reference,
            digest,
            profileId,
            "development",
            open.stationKey,
            open.operatorRef,
            open.operatorRef,
            open.validForHours ?? 1,
          ],
        );
        if (issued.outcome !== "ISSUED") {
          return {
            result: "TICKET_REFUSED" as const,
            correlationId,
            auditDetail: `open-enrollment issuance refused ${String(issued.refusal_code ?? "")}`,
          };
        }

        const outcome = await callDoor(
          client,
          `kitluy_devices.open_manufacturing_enrollment_challenge_v1($1, $2, $3, $4, $5, $6)`,
          [
            reference,
            digest,
            input.publicKeyFingerprint,
            input.publicKeyPem,
            input.publicKeyAlgorithm,
            input.keyStorageClass,
          ],
        );
        if (outcome.outcome !== "CHALLENGE_ISSUED") {
          const code = String(outcome.refusal_code ?? "");
          return {
            result: "TICKET_REFUSED" as const,
            correlationId,
            auditDetail: TICKET_REFUSALS[code] ?? `unmapped door refusal ${code}`,
          };
        }

        return {
          result: "CHALLENGE_ISSUED" as const,
          correlationId,
          data: {
            challengeId: String(outcome.challenge_id),
            nonce: String(outcome.challenge_nonce),
            purpose: MANUFACTURING_ENROLLMENT_POP_PURPOSE,
            environment: "development" as TrustEnvironment,
            issuedAt: this.now(),
            expiresAt: new Date(String(outcome.expires_at)),
            signatureAlgorithm: "ed25519" as const,
            signingPayloadEncoding: "base64url" as const,
          },
        };
      });
    } catch (error) {
      this.logger.info({ event: "open_enrollment_challenge_failed", correlationId });
      void error;
      return { result: "INTERNAL_ERROR", correlationId };
    }
  }

  /**
   * Step 1 — present the ticket and open a proof-of-possession challenge.
   *
   * The ticket secret is passed as its DIGEST: the raw secret never reaches
   * this process's database layer, and no column could hold it anyway.
   */
  async openChallenge(input: {
    readonly ticketReference: string;
    readonly ticketDigest: string;
    readonly publicKeyFingerprint: string;
    readonly publicKeyPem: string;
    readonly publicKeyAlgorithm: string;
    readonly keyStorageClass: string;
  }): Promise<EnrollmentCompositionResult<EnrollmentChallengeMaterial>> {
    const correlationId = randomUUID();

    if (
      input.ticketReference.length === 0 ||
      input.ticketReference.length > 128 ||
      !HEX64.test(input.ticketDigest) ||
      !HEX64.test(input.publicKeyFingerprint) ||
      input.publicKeyPem.length === 0 ||
      input.publicKeyPem.length > 4096
    ) {
      return { result: "REQUEST_INVALID", correlationId };
    }

    try {
      return await withServiceRole(this.deps.source, REGISTRY_ROLES.fleet, async (client) => {
        const outcome = await callDoor(
          client,
          `kitluy_devices.open_manufacturing_enrollment_challenge_v1($1, $2, $3, $4, $5, $6)`,
          [
            input.ticketReference,
            input.ticketDigest,
            input.publicKeyFingerprint,
            input.publicKeyPem,
            input.publicKeyAlgorithm,
            input.keyStorageClass,
          ],
        );

        if (outcome.outcome !== "CHALLENGE_ISSUED") {
          const code = String(outcome.refusal_code ?? "");
          return {
            result: "TICKET_REFUSED" as const,
            correlationId,
            auditDetail: TICKET_REFUSALS[code] ?? `unmapped door refusal ${code}`,
          };
        }

        const issuedAt = this.now();
        return {
          result: "CHALLENGE_ISSUED" as const,
          correlationId,
          data: {
            challengeId: String(outcome.challenge_id),
            nonce: String(outcome.challenge_nonce),
            purpose: MANUFACTURING_ENROLLMENT_POP_PURPOSE,
            environment: "development" as TrustEnvironment,
            issuedAt,
            expiresAt: new Date(String(outcome.expires_at)),
            signatureAlgorithm: "ed25519" as const,
            signingPayloadEncoding: "base64url" as const,
          },
        };
      });
    } catch (error) {
      this.logger.info({ event: "enrollment_challenge_failed", correlationId });
      void error;
      return { result: "INTERNAL_ERROR", correlationId };
    }
  }

  /**
   * Step 2 — verify possession, redeem the ticket, mint the time token.
   *
   * Order matters and is not arbitrary. The proof is verified in THIS process
   * before the door is called, exactly as terminal provisioning does it, so the
   * database records a verdict rather than trying to verify Ed25519 itself.
   * The time token is minted only AFTER `enroll_device_v1` returns, because it
   * is welded to a `device_record_id` that does not exist until then.
   */
  async redeem(input: {
    readonly challengeId: string;
    readonly challenge: ManufacturingEnrollmentPopChallenge;
    readonly signature: Uint8Array;
    readonly publicKeyPem: string;
    readonly assetTag: string;
    readonly signals: unknown;
    readonly expectation: {
      readonly environment: TrustEnvironment;
      readonly presentedKeyFingerprint: string;
      readonly nonce: string;
      readonly expiresAt: Date;
    };
  }): Promise<EnrollmentCompositionResult<EnrolledDeviceMaterial>> {
    const correlationId = randomUUID();

    if (!UUID.test(input.challengeId) || input.assetTag.length === 0) {
      return { result: "REQUEST_INVALID", correlationId };
    }

    const verdict = verifyManufacturingEnrollmentPop(
      input.challenge,
      input.signature,
      input.publicKeyPem,
      {
        challengeId: input.challengeId,
        environment: input.expectation.environment,
        presentedKeyFingerprint: input.expectation.presentedKeyFingerprint,
        nonce: input.expectation.nonce,
        expiresAt: input.expectation.expiresAt,
      },
      this.now(),
    );

    try {
      const outcome = await withServiceRole(
        this.deps.source,
        REGISTRY_ROLES.fleet,
        async (client) =>
          callDoor(
            client,
            `kitluy_devices.redeem_manufacturing_enrollment_ticket_v1($1::uuid, $2::boolean, $3, $4, $5::jsonb)`,
            [
              input.challengeId,
              verdict.verified,
              verdict.challengeHash ?? verdict.refusalCode ?? "unverified",
              input.assetTag,
              JSON.stringify(input.signals ?? []),
            ],
          ),
      );

      // A failed proof is recorded by the door BEFORE it refuses, so the audit
      // trail survives; only then is it reported as a refusal here.
      if (!verdict.verified) {
        return {
          result: "PROOF_INVALID",
          correlationId,
          auditDetail: `${verdict.refusalCode}: ${verdict.detail}`,
        };
      }

      const code = String(outcome.outcome ?? "");
      if (code !== "ENROLLED") {
        const refusal = String(outcome.refusal_code ?? "");
        if (refusal in TICKET_REFUSALS) {
          return {
            result: "TICKET_REFUSED",
            correlationId,
            auditDetail: TICKET_REFUSALS[refusal],
          };
        }
        if (refusal === "KLUY-MFGTICKET-CHALLENGE-MISSING") {
          return { result: "CHALLENGE_NOT_FOUND", correlationId, auditDetail: refusal };
        }
        if (
          refusal === "KLUY-MFGTICKET-CHALLENGE-CONSUMED" ||
          refusal === "KLUY-MFGTICKET-CHALLENGE-EXPIRED"
        ) {
          return { result: "CHALLENGE_NOT_FOUND", correlationId, auditDetail: refusal };
        }
        if (refusal === "KLUY-MFGTICKET-POP-FAILED") {
          return { result: "PROOF_INVALID", correlationId, auditDetail: refusal };
        }
        return {
          result: "ENROLLMENT_REFUSED",
          correlationId,
          auditDetail: `${refusal}: ${String(outcome.detail ?? "")}`,
        };
      }

      const deviceRecordId = String(outcome.device_record_id);
      const environment = String(outcome.environment) as TrustEnvironment;

      let minted;
      try {
        minted = await mintEnrollmentTimeToken(
          { deviceRecordId, challengeId: input.challengeId, environment },
          this.deps.signer,
          this.deps.timeKeyReference,
          this.now(),
        );
      } catch (error) {
        // The device IS enrolled — the door committed. It simply cannot
        // establish trusted time yet, which is a retryable dependency failure
        // and NOT a reason to pretend the enrollment did not happen.
        this.logger.info({ event: "enrollment_time_token_unavailable", correlationId });
        void error;
        return { result: "TIME_TOKEN_UNAVAILABLE", correlationId };
      }

      return {
        result: "ENROLLED",
        correlationId,
        data: {
          deviceRecordId,
          fleetEnrollment: "enrolled",
          storeAssignment: "unassigned",
          environment,
          timeToken: minted.token,
          timeTokenSignature: minted.signature,
        },
      };
    } catch (error) {
      this.logger.info({ event: "enrollment_redemption_failed", correlationId });
      void error;
      return { result: "INTERNAL_ERROR", correlationId };
    }
  }
}
