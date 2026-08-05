/**
 * Hub-terminal pairing composition — WS-11-T004-P03B.
 *
 * The Store Hub side of the pairing handshake (pairing protocol §8-§9),
 * composed over the group-0031 governed doors. Ownership classification A:
 * the HUB is the local operational authority for pairing sessions, nonce
 * consumption and receipts; cloud acknowledgement is never part of this
 * commit path. The cloud's authority arrives as the projections the doors
 * consult (`terminal_device`, `terminal_profile_assignment`,
 * `device_credential`, `hub_assignment`) — this layer authors none of them.
 *
 * Discipline (mirrors the cloud TerminalProvisioningComposition):
 *   - every operation is one `withHubTransaction` as `kitluy_hub_runtime`;
 *   - Ed25519 verification happens in `@kitluy/device-identity` (OPTION B);
 *     the doors record attestations and re-derive every relational fact;
 *   - canonical bytes are reconstructed from the AUTHORITATIVE session row,
 *     never from a caller-supplied payload;
 *   - the Hub-local clock IS the authority (Hub schema contract 0001 §1):
 *     `now()` is read inside the same transaction and used for expiry
 *     judgement and the receipt timestamp — `now()` is transaction-stable,
 *     so the signed receipt and the stored row carry the same instant;
 *   - refusals map by KLUY-EDGE-PAIRING-* sentinel family to a closed PAIR_*
 *     vocabulary (protocol §18); no SQLSTATE, role name or SQL text escapes;
 *   - the logger receives exactly {operation, correlationId, result} —
 *     nonces, signatures and certificates are never passed to it.
 *
 * NOT here, by design: no LAN listener (the §3 port-7443 mTLS transport is a
 * separate transport package), no receipt delivery to the terminal, no
 * persistence/restart/offline recovery (P03C), no cloud replication of the
 * receipt (later WS-10 sync work).
 */
import { randomUUID, randomBytes } from "node:crypto";

import {
  publicKeyFingerprint,
  verifyTerminalPairingProof,
  hubPairingProofBytes,
  pairingTranscriptHash,
  pairingReceiptBytes,
  PAIRING_PROTOCOL_VERSION,
  type PairingTranscript,
  type PairingExpectation,
  type PairingReceipt,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { withHubTransaction, HUB_RUNTIME_ROLE, type HubPool, type HubClient } from "./db.js";
import { appendAuditEvent, recordSecurityEvent } from "./repositories/audit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const PROFILE = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;
const MAX_SIGNATURE_BASE64 = 128;

/** Closed result vocabulary — protocol §18 families plus operation outcomes. */
export type PairingResultCode =
  | "PAIRING_PREPARED"
  | "TERMINAL_PROOF_RECORDED"
  | "PAIRED"
  | "ALREADY_PAIRED"
  | "RECEIPT_FOUND"
  | "RECEIPT_NOT_FOUND"
  | "PAIR_VERSION_INCOMPATIBLE"
  | "PAIR_ASSIGNMENT_MISMATCH"
  | "PAIR_CERT_INVALID"
  | "PAIR_HUB_NOT_ACTIVE"
  | "PAIR_DEVICE_NOT_ELIGIBLE"
  | "PAIR_PROFILE_FORBIDDEN"
  | "PAIR_CHALLENGE_FAILED"
  | "PAIR_CHALLENGE_EXPIRED"
  | "PAIR_NONCE_REJECTED"
  | "PAIR_SESSION_OUTSTANDING"
  | "PAIR_SESSION_UNKNOWN"
  | "PAIR_SESSION_CONSUMED"
  | "PAIR_PROOF_REQUIRED"
  | "PAIR_TRANSCRIPT_CONFLICT"
  | "REQUEST_INVALID"
  | "INTERNAL_ERROR";

/** Maps a governed door's sentinel family — never a SQLSTATE — to a result. */
function mapSentinel(message: string): PairingResultCode {
  const families: ReadonlyArray<readonly [string, PairingResultCode]> = [
    ["KLUY-EDGE-PAIRING-VERSION-INCOMPATIBLE", "PAIR_VERSION_INCOMPATIBLE"],
    ["KLUY-EDGE-PAIRING-ASSIGNMENT-MISMATCH", "PAIR_ASSIGNMENT_MISMATCH"],
    ["KLUY-EDGE-PAIRING-CERT-INVALID", "PAIR_CERT_INVALID"],
    ["KLUY-EDGE-PAIRING-HUB-NOT-ACTIVE", "PAIR_HUB_NOT_ACTIVE"],
    ["KLUY-EDGE-PAIRING-DEVICE-NOT-ELIGIBLE", "PAIR_DEVICE_NOT_ELIGIBLE"],
    ["KLUY-EDGE-PAIRING-PROFILE-FORBIDDEN", "PAIR_PROFILE_FORBIDDEN"],
    ["KLUY-EDGE-PAIRING-PROOF-INVALID", "PAIR_CHALLENGE_FAILED"],
    ["KLUY-EDGE-PAIRING-PROOF-REQUIRED", "PAIR_PROOF_REQUIRED"],
    ["KLUY-EDGE-PAIRING-EXPIRED", "PAIR_CHALLENGE_EXPIRED"],
    ["KLUY-EDGE-PAIRING-EXPIRY", "PAIR_CHALLENGE_EXPIRED"],
    ["KLUY-EDGE-PAIRING-NONCE", "PAIR_NONCE_REJECTED"],
    ["KLUY-EDGE-PAIRING-SESSION-OUTSTANDING", "PAIR_SESSION_OUTSTANDING"],
    ["KLUY-EDGE-PAIRING-SESSION-UNKNOWN", "PAIR_SESSION_UNKNOWN"],
    ["KLUY-EDGE-PAIRING-CONSUMED", "PAIR_SESSION_CONSUMED"],
    ["KLUY-EDGE-PAIRING-TRANSCRIPT-CONFLICT", "PAIR_TRANSCRIPT_CONFLICT"],
    ["KLUY-EDGE-PAIRING-REQUEST", "REQUEST_INVALID"],
  ];
  for (const [sentinel, code] of families) {
    if (message.includes(sentinel)) return code;
  }
  return "INTERNAL_ERROR";
}

export interface SafeLogger {
  info(fields: Readonly<Record<string, string | number | boolean>>): void;
}
const NO_LOG: SafeLogger = { info: () => undefined };

/**
 * The Hub's signing identity for the Hub proof and the receipt. Production
 * keys are non-exportable; development and tests inject an ephemeral
 * sanctioned key. This interface never exposes private material.
 */
export interface PairingSigner {
  readonly certificateSerial: string;
  readonly publicKeyPem: string;
  sign(payload: Uint8Array): Uint8Array;
}

export interface PairingResult<T = undefined> {
  readonly result: PairingResultCode;
  readonly correlationId: string;
  readonly data?: T;
}

/** What the terminal needs to compute and sign its proof (§8.2). */
export interface PairingChallengeMaterial {
  readonly pairingSessionId: string;
  readonly protocolVersion: string;
  readonly purpose: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: string;
  readonly hubDeviceId: string;
  readonly hubAssignmentGeneration: number;
  readonly hubCertificateSerial: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly terminalCertificateSerial: string;
  readonly terminalCertificateFingerprint: string;
  readonly terminalNonce: string;
  readonly hubNonce: string;
  /** Authoritative Hub-local timestamps, exact text from the row. */
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface PairedState {
  readonly pairingSessionId: string;
  readonly receiptId: string;
  readonly transcriptHash: string;
  readonly receipt: PairingReceipt;
  readonly receiptSignatureBase64: string;
  readonly hubProofSignatureBase64: string;
  readonly pairedAt: string;
}

export interface ReceiptState {
  readonly receiptId: string;
  readonly pairingSessionId: string;
  readonly transcriptHash: string;
  readonly receipt: PairingReceipt;
  readonly receiptSignatureBase64: string;
  readonly pairedAt: string;
}

interface SessionRow {
  readonly id: string;
  readonly protocol_version: string;
  readonly purpose: string;
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
  readonly environment: string;
  readonly hub_device_id: string;
  readonly hub_assignment_generation: number;
  readonly hub_certificate_serial: string;
  readonly hub_certificate_fingerprint: string;
  readonly terminal_device_id: string;
  readonly terminal_assignment_generation: number;
  readonly terminal_profile_code: string;
  readonly terminal_certificate_serial: string;
  readonly terminal_certificate_fingerprint: string;
  readonly terminal_nonce: string;
  readonly hub_nonce: string;
  readonly state: string;
  readonly transcript_hash: string | null;
  readonly created_text: string;
  readonly expires_text: string;
  readonly now_text: string;
}

const SESSION_COLUMNS = `
  s.id, s.protocol_version, s.purpose, s.tenant_id, s.digital_store_id,
  s.location_id, s.environment, s.hub_device_id, s.hub_assignment_generation,
  s.hub_certificate_serial, s.hub_certificate_fingerprint, s.terminal_device_id,
  s.terminal_assignment_generation, s.terminal_profile_code,
  s.terminal_certificate_serial, s.terminal_certificate_fingerprint,
  s.terminal_nonce, s.hub_nonce, s.state, s.transcript_hash,
  s.created_at::text as created_text, s.expires_at::text as expires_text,
  now()::text as now_text`;

async function readSession(client: HubClient, sessionId: string): Promise<SessionRow | null> {
  const result = await client.query<SessionRow>(
    `select ${SESSION_COLUMNS} from edge_identity.pairing_session s where s.id = $1`,
    [sessionId],
  );
  return result.rows[0] ?? null;
}

/** The transcript is built from the AUTHORITATIVE row — nothing caller-supplied. */
function transcriptFromRow(row: SessionRow): PairingTranscript {
  return {
    pairingSessionId: row.id,
    protocolVersion: row.protocol_version,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.location_id,
    environment: row.environment as TrustEnvironment,
    hubDeviceId: row.hub_device_id,
    hubAssignmentGeneration: Number(row.hub_assignment_generation),
    hubCertificateSerial: row.hub_certificate_serial,
    hubCertificateFingerprint: row.hub_certificate_fingerprint,
    terminalDeviceId: row.terminal_device_id,
    terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
    terminalProfileKey: row.terminal_profile_code,
    terminalCertificateSerial: row.terminal_certificate_serial,
    terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
    terminalNonce: row.terminal_nonce,
    hubNonce: row.hub_nonce,
    issuedAt: new Date(row.created_text),
    expiresAt: new Date(row.expires_text),
  };
}

function expectationFromRow(row: SessionRow, signerKeyFingerprint: string): PairingExpectation {
  return {
    pairingSessionId: row.id,
    protocolVersion: row.protocol_version,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.location_id,
    environment: row.environment as TrustEnvironment,
    hubDeviceId: row.hub_device_id,
    hubAssignmentGeneration: Number(row.hub_assignment_generation),
    hubCertificateSerial: row.hub_certificate_serial,
    hubCertificateFingerprint: row.hub_certificate_fingerprint,
    terminalDeviceId: row.terminal_device_id,
    terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
    terminalProfileKey: row.terminal_profile_code,
    terminalCertificateSerial: row.terminal_certificate_serial,
    terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
    signerKeyFingerprint,
    terminalNonce: row.terminal_nonce,
    hubNonce: row.hub_nonce,
  };
}

function challengeFromRow(row: SessionRow): PairingChallengeMaterial {
  return {
    pairingSessionId: row.id,
    protocolVersion: row.protocol_version,
    purpose: row.purpose,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.location_id,
    environment: row.environment,
    hubDeviceId: row.hub_device_id,
    hubAssignmentGeneration: Number(row.hub_assignment_generation),
    hubCertificateSerial: row.hub_certificate_serial,
    hubCertificateFingerprint: row.hub_certificate_fingerprint,
    terminalDeviceId: row.terminal_device_id,
    terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
    terminalProfileKey: row.terminal_profile_code,
    terminalCertificateSerial: row.terminal_certificate_serial,
    terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
    terminalNonce: row.terminal_nonce,
    hubNonce: row.hub_nonce,
    issuedAt: row.created_text,
    expiresAt: row.expires_text,
  };
}

interface ReceiptRow {
  readonly id: string;
  readonly receipt_version: string;
  readonly pairing_session_id: string;
  readonly transcript_hash: string;
  readonly hub_device_id: string;
  readonly hub_certificate_fingerprint: string;
  readonly terminal_device_id: string;
  readonly terminal_certificate_fingerprint: string;
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
  readonly environment: string;
  readonly terminal_assignment_generation: number;
  readonly terminal_profile_code: string;
  readonly valid_until: string | null;
  readonly signature_b64: string;
  readonly correlation_id: string;
  readonly paired_text: string;
  readonly valid_text: string | null;
}

const RECEIPT_COLUMNS = `
  r.id, r.receipt_version, r.pairing_session_id, r.transcript_hash,
  r.hub_device_id, r.hub_certificate_fingerprint, r.terminal_device_id,
  r.terminal_certificate_fingerprint, r.tenant_id, r.digital_store_id,
  r.location_id, r.environment, r.terminal_assignment_generation,
  r.terminal_profile_code, r.signature_b64, r.correlation_id,
  r.paired_at::text as paired_text, r.valid_until::text as valid_text`;

function receiptFromRow(row: ReceiptRow): PairingReceipt {
  return {
    receiptId: row.id,
    receiptVersion: row.receipt_version,
    pairingSessionId: row.pairing_session_id,
    transcriptHash: row.transcript_hash,
    hubDeviceId: row.hub_device_id,
    hubCertificateFingerprint: row.hub_certificate_fingerprint,
    terminalDeviceId: row.terminal_device_id,
    terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
    tenantId: row.tenant_id,
    digitalStoreId: row.digital_store_id,
    storeLocationId: row.location_id,
    environment: row.environment as TrustEnvironment,
    terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
    terminalProfileKey: row.terminal_profile_code,
    pairedAt: new Date(row.paired_text),
    validUntil: row.valid_text === null ? null : new Date(row.valid_text),
    correlationId: row.correlation_id,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The Store Hub's internal pairing service. Internal-only by design: no LAN
 * transport is claimed here — the approved §3 transport (mTLS on 7443) is a
 * separate package, and this class is what that transport will call.
 */
export class TerminalPairingComposition {
  constructor(
    private readonly pool: HubPool,
    private readonly signer: PairingSigner,
    private readonly logger: SafeLogger = NO_LOG,
  ) {}

  /**
   * §8.1-§8.2: accepts a terminal hello and opens the governed handshake.
   * The Hub nonce comes from the sanctioned random authority (node:crypto —
   * the Hub database has no pgcrypto); every identity, scope, generation and
   * credential binding is derived by the door from authoritative rows. The
   * expiry is caller-bounded because the protocol defines no lifetime; the
   * door caps it at both credentials' expiry and the production default
   * remains [REQUIRED: pairing_challenge_lifetime].
   */
  async preparePairing(input: {
    readonly terminalDeviceId: string;
    readonly requestedProfileCode: string;
    readonly terminalNonce: string;
    readonly protocolVersion: string;
    readonly environment: string;
    readonly expiresAt: Date;
  }): Promise<PairingResult<PairingChallengeMaterial>> {
    const correlationId = randomUUID();
    if (
      !UUID.test(input.terminalDeviceId) ||
      !PROFILE.test(input.requestedProfileCode) ||
      !HEX64.test(input.terminalNonce)
    ) {
      this.logger.info({ operation: "preparePairing", correlationId, result: "REQUEST_INVALID" });
      return { result: "REQUEST_INVALID", correlationId };
    }
    const sessionId = randomUUID();
    const hubNonce = randomBytes(32).toString("hex");
    try {
      const row = await withHubTransaction(
        this.pool,
        async (client) => {
          const created = await client.query<{ id: string }>(
            `select (edge_identity.begin_terminal_pairing_v1(
               $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::timestamptz, $9::uuid)).id as id`,
            [
              sessionId,
              input.terminalDeviceId,
              input.requestedProfileCode,
              input.terminalNonce,
              hubNonce,
              input.protocolVersion,
              input.environment,
              input.expiresAt.toISOString(),
              correlationId,
            ],
          );
          return readSession(client, String(created.rows[0]?.id));
        },
        HUB_RUNTIME_ROLE,
      );
      if (row === null) {
        this.logger.info({ operation: "preparePairing", correlationId, result: "INTERNAL_ERROR" });
        return { result: "INTERNAL_ERROR", correlationId };
      }
      this.logger.info({ operation: "preparePairing", correlationId, result: "PAIRING_PREPARED" });
      return { result: "PAIRING_PREPARED", correlationId, data: challengeFromRow(row) };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      this.logger.info({ operation: "preparePairing", correlationId, result });
      return { result, correlationId };
    }
  }

  /**
   * §8.3 first half: verifies the terminal's proof against the AUTHORITATIVE
   * session row under Hub-local time, then records the attestation through
   * the governed door. A failed proof consumes nothing, and the refusal is
   * recorded as security evidence in its own transaction — a blocked attempt
   * is EVIDENCE, never a silent drop.
   */
  async verifyTerminalProofAndRecord(input: {
    readonly pairingSessionId: string;
    readonly signatureBase64: string;
    readonly terminalPublicKeyPem: string;
  }): Promise<PairingResult<{ readonly transcriptHash: string }>> {
    const correlationId = randomUUID();
    if (
      !UUID.test(input.pairingSessionId) ||
      input.signatureBase64.length === 0 ||
      input.signatureBase64.length > MAX_SIGNATURE_BASE64 ||
      !/^[A-Za-z0-9+/=]+$/.test(input.signatureBase64) ||
      !input.terminalPublicKeyPem.includes("BEGIN PUBLIC KEY")
    ) {
      this.logger.info({
        operation: "verifyTerminalProofAndRecord",
        correlationId,
        result: "REQUEST_INVALID",
      });
      return { result: "REQUEST_INVALID", correlationId };
    }
    try {
      const outcome = await withHubTransaction(
        this.pool,
        async (client) => {
          const row = await readSession(client, input.pairingSessionId);
          if (row === null) return { result: "PAIR_SESSION_UNKNOWN" } as const;
          if (row.state === "terminal_proof_verified") {
            return {
              result: "TERMINAL_PROOF_RECORDED",
              transcriptHash: pairingTranscriptHash(transcriptFromRow(row)),
            } as const;
          }
          if (row.state !== "challenge_issued") {
            return { result: "PAIR_SESSION_CONSUMED" } as const;
          }
          const transcript = transcriptFromRow(row);
          const verdict = verifyTerminalPairingProof(
            transcript,
            Buffer.from(input.signatureBase64, "base64"),
            input.terminalPublicKeyPem,
            expectationFromRow(row, row.terminal_certificate_fingerprint),
            new Date(row.now_text),
            publicKeyFingerprint,
          );
          if (!verdict.verified) {
            return {
              result:
                verdict.refusalCode === "PAIR_CHALLENGE_EXPIRED"
                  ? ("PAIR_CHALLENGE_EXPIRED" as const)
                  : ("PAIR_CHALLENGE_FAILED" as const),
              row,
            } as const;
          }
          await client.query(
            `select edge_identity.record_terminal_pairing_proof_v1($1::uuid, true, $2::uuid)`,
            [input.pairingSessionId, correlationId],
          );
          return {
            result: "TERMINAL_PROOF_RECORDED",
            transcriptHash: verdict.transcriptHash ?? "",
          } as const;
        },
        HUB_RUNTIME_ROLE,
      );

      if (
        outcome.result === "PAIR_CHALLENGE_FAILED" ||
        outcome.result === "PAIR_CHALLENGE_EXPIRED"
      ) {
        // Separate transaction: the refusal above rolled nothing forward.
        const row = "row" in outcome ? outcome.row : null;
        await withHubTransaction(
          this.pool,
          (client) =>
            recordSecurityEvent(client, {
              id: randomUUID(),
              tenantId: row?.tenant_id ?? null,
              digitalStoreId: row?.digital_store_id ?? null,
              locationId: row?.location_id ?? null,
              eventCode: "EDGE_PAIRING_PROOF_REJECTED",
              severity: "medium",
              deviceId: row?.terminal_device_id ?? null,
              certificateSerial: row?.terminal_certificate_serial ?? null,
              details: { correlationId, refusal: outcome.result },
            }),
          HUB_RUNTIME_ROLE,
        ).catch(() => undefined);
      }
      const data =
        outcome.result === "TERMINAL_PROOF_RECORDED"
          ? { transcriptHash: outcome.transcriptHash }
          : undefined;
      this.logger.info({
        operation: "verifyTerminalProofAndRecord",
        correlationId,
        result: outcome.result,
      });
      return { result: outcome.result, correlationId, data };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      this.logger.info({ operation: "verifyTerminalProofAndRecord", correlationId, result });
      return { result, correlationId };
    }
  }

  /**
   * §8.3 second half and §9: produces the Hub proof, issues the ONE
   * Hub-signed receipt through the completion door, and appends the
   * `device.paired` audit fact — all in one transaction, under one
   * transaction-stable `now()`, so the signed receipt and the stored row
   * carry the identical instant. A replay returns the ORIGINAL receipt.
   */
  async produceHubProofAndComplete(input: {
    readonly pairingSessionId: string;
  }): Promise<PairingResult<PairedState>> {
    const correlationId = randomUUID();
    if (!UUID.test(input.pairingSessionId)) {
      this.logger.info({
        operation: "produceHubProofAndComplete",
        correlationId,
        result: "REQUEST_INVALID",
      });
      return { result: "REQUEST_INVALID", correlationId };
    }
    try {
      const outcome = await withHubTransaction(
        this.pool,
        async (client) => {
          const row = await readSession(client, input.pairingSessionId);
          if (row === null) return { result: "PAIR_SESSION_UNKNOWN" } as const;

          if (row.state === "paired") {
            const existing = await client.query<ReceiptRow>(
              `select ${RECEIPT_COLUMNS} from edge_identity.pairing_receipt r
                where r.pairing_session_id = $1`,
              [row.id],
            );
            const receiptRow = existing.rows[0];
            if (receiptRow === undefined) return { result: "INTERNAL_ERROR" } as const;
            const transcript = transcriptFromRow(row);
            return {
              result: "ALREADY_PAIRED",
              state: {
                pairingSessionId: row.id,
                receiptId: receiptRow.id,
                transcriptHash: receiptRow.transcript_hash,
                receipt: receiptFromRow(receiptRow),
                receiptSignatureBase64: receiptRow.signature_b64,
                hubProofSignatureBase64: Buffer.from(
                  this.signer.sign(hubPairingProofBytes(transcript)),
                ).toString("base64"),
                pairedAt: receiptRow.paired_text,
              },
            } as const;
          }
          if (row.state !== "terminal_proof_verified") {
            return { result: "PAIR_PROOF_REQUIRED" } as const;
          }

          const transcript = transcriptFromRow(row);
          const transcriptHash = pairingTranscriptHash(transcript);
          const hubProofSignature = this.signer.sign(hubPairingProofBytes(transcript));

          // now() is transaction-stable: the receipt this signature binds and
          // the row the door writes carry the same authoritative instant.
          const receiptId = randomUUID();
          const receipt: PairingReceipt = {
            receiptId,
            receiptVersion: PAIRING_PROTOCOL_VERSION,
            pairingSessionId: row.id,
            transcriptHash,
            hubDeviceId: row.hub_device_id,
            hubCertificateFingerprint: row.hub_certificate_fingerprint,
            terminalDeviceId: row.terminal_device_id,
            terminalCertificateFingerprint: row.terminal_certificate_fingerprint,
            tenantId: row.tenant_id,
            digitalStoreId: row.digital_store_id,
            storeLocationId: row.location_id,
            environment: row.environment as TrustEnvironment,
            terminalAssignmentGeneration: Number(row.terminal_assignment_generation),
            terminalProfileKey: row.terminal_profile_code,
            pairedAt: new Date(row.now_text),
            validUntil: null,
            correlationId,
          };
          const receiptSignature = this.signer.sign(pairingReceiptBytes(receipt));

          const completed = await client.query<{ id: string }>(
            `select (edge_identity.complete_terminal_pairing_v1(
               $1::uuid, $2, $3::uuid, $4, $5, null, $6::uuid)).id as id`,
            [
              row.id,
              transcriptHash,
              receiptId,
              Buffer.from(receiptSignature).toString("base64"),
              this.signer.certificateSerial,
              correlationId,
            ],
          );
          const storedId = String(completed.rows[0]?.id);

          const seq = await client.query<{ next: string }>(
            `select nextval('edge_sync.hub_sequence_seq')::text as next`,
          );
          await appendAuditEvent(client, {
            id: randomUUID(),
            tenantId: row.tenant_id,
            digitalStoreId: row.digital_store_id,
            locationId: row.location_id,
            eventCode: "device.paired",
            actorType: "device",
            actorId: null,
            requesterId: null,
            approverId: null,
            terminalDeviceId: row.terminal_device_id,
            hubDeviceId: row.hub_device_id,
            profileCode: row.terminal_profile_code,
            resourceType: "pairing_session",
            resourceId: row.id,
            reasonCode: null,
            correlationId,
            payloadSha256: transcriptHash,
            details: { receiptId: storedId, protocolVersion: row.protocol_version },
            localSequence: BigInt(seq.rows[0]?.next ?? "0"),
          });

          return {
            result: "PAIRED",
            state: {
              pairingSessionId: row.id,
              receiptId: storedId,
              transcriptHash,
              receipt,
              receiptSignatureBase64: Buffer.from(receiptSignature).toString("base64"),
              hubProofSignatureBase64: Buffer.from(hubProofSignature).toString("base64"),
              pairedAt: receipt.pairedAt.toISOString(),
            },
          } as const;
        },
        HUB_RUNTIME_ROLE,
      );
      const data = "state" in outcome ? outcome.state : undefined;
      this.logger.info({
        operation: "produceHubProofAndComplete",
        correlationId,
        result: outcome.result,
      });
      return { result: outcome.result, correlationId, data };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      this.logger.info({ operation: "produceHubProofAndComplete", correlationId, result });
      return { result, correlationId };
    }
  }

  /** Replay/reconciliation: the stored receipt answers, byte-for-byte. */
  async reconcilePairingReceipt(input: {
    readonly pairingSessionId: string;
  }): Promise<PairingResult<ReceiptState>> {
    const correlationId = randomUUID();
    if (!UUID.test(input.pairingSessionId)) {
      return { result: "REQUEST_INVALID", correlationId };
    }
    try {
      const receiptRow = await withHubTransaction(
        this.pool,
        async (client) => {
          const result = await client.query<ReceiptRow>(
            `select ${RECEIPT_COLUMNS} from edge_identity.pairing_receipt r
              where r.pairing_session_id = $1`,
            [input.pairingSessionId],
          );
          return result.rows[0] ?? null;
        },
        HUB_RUNTIME_ROLE,
      );
      if (receiptRow === null) {
        this.logger.info({
          operation: "reconcilePairingReceipt",
          correlationId,
          result: "RECEIPT_NOT_FOUND",
        });
        return { result: "RECEIPT_NOT_FOUND", correlationId };
      }
      this.logger.info({
        operation: "reconcilePairingReceipt",
        correlationId,
        result: "RECEIPT_FOUND",
      });
      return {
        result: "RECEIPT_FOUND",
        correlationId,
        data: {
          receiptId: receiptRow.id,
          pairingSessionId: receiptRow.pairing_session_id,
          transcriptHash: receiptRow.transcript_hash,
          receipt: receiptFromRow(receiptRow),
          receiptSignatureBase64: receiptRow.signature_b64,
          pairedAt: receiptRow.paired_text,
        },
      };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      this.logger.info({ operation: "reconcilePairingReceipt", correlationId, result });
      return { result, correlationId };
    }
  }
}
