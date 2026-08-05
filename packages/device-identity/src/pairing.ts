/**
 * Hub-terminal pairing protocol — WS-11-T004-P03B.
 *
 * Authority: `kitluy-device-discovery-and-pairing-protocol-v1.0.0.md` §8
 * (handshake), §9 (Hub-signed receipt), §15 (rogue-device protections), §18
 * (PAIR_* error codes); the OPTION B ruling of migration group 0127 (Ed25519
 * verification lives in this package; databases record attestations).
 *
 * ===========================================================================
 * WHAT PAIRING PROVES — AND WHAT IT DOES NOT
 * ===========================================================================
 * Pairing establishes MUTUAL cryptographic trust on the Store LAN between one
 * activated terminal and its exact assigned Store Hub: each side proves
 * possession of its current operational private key over the SAME transcript,
 * and the Hub then signs one immutable receipt over that transcript. Nothing
 * here proves the receipt was durably installed on the terminal, survived a
 * restart, or that either side can reach the other tomorrow — that is P03C.
 *
 * THREE domains, one transcript:
 *
 *   kitluy.pairing-terminal-proof.v1 — the terminal's signature. Proves the
 *       terminal holds its enrolled operational key AND agrees to every
 *       binding of THIS session.
 *   kitluy.pairing-hub-proof.v1      — the Hub's signature over the SAME
 *       fields under a DIFFERENT separator. A terminal proof replayed as a
 *       Hub proof (reflection) verifies against different bytes and fails.
 *   kitluy.pairing-receipt.v1        — the Hub-signed receipt (§8.3: "Hub
 *       returns a pairing receipt signed by the Hub key"), binding the
 *       transcript hash so the receipt can never drift from the handshake
 *       it concludes.
 *
 * Every transcript field kills one substitution: session id (verbatim
 * replay), protocol version (§18 PAIR_VERSION_INCOMPATIBLE), scope tuple
 * (Store substitution), environment, Hub device + assignment generation +
 * credential (Hub substitution, §13 replacement), terminal device +
 * assignment generation + profile + credential (terminal substitution,
 * installer-selected roles), both directional nonces (replay), issued/expiry
 * window (stale sessions).
 *
 * TIME AUTHORITY: the Hub-local database's commit time is authoritative for
 * pairing (Hub schema contract 0001 §1 "Local commit time is authoritative";
 * the Hub database deliberately has no separate trusted-time table). The
 * verifier therefore takes an explicit `Date` supplied from the Hub's clock
 * (`now()` read inside the same transaction), never a terminal clock.
 *
 * No raw provisioning code, private key, or database credential appears in
 * any canonical payload. Nonces appear ONLY in the transcript — they are
 * signed material, not log material.
 */

import { createHash } from "node:crypto";

import type { TrustEnvironment } from "./environments.js";
import { verifyDetachedSignature } from "./dev-crypto.js";

/** Protocol version — pairing protocol §8.1 `protocol_version`. */
export const PAIRING_PROTOCOL_VERSION = "1.0" as const;

/** The one purpose a pairing transcript may serve. */
export const PAIRING_PURPOSE = "hub_terminal_pairing" as const;

/** Domain separator for the terminal's directional proof. */
export const PAIRING_TERMINAL_PROOF_KIND = "kitluy.pairing-terminal-proof.v1" as const;

/** Domain separator for the Hub's directional proof. */
export const PAIRING_HUB_PROOF_KIND = "kitluy.pairing-hub-proof.v1" as const;

/** Domain separator for the Hub-signed receipt (§9). */
export const PAIRING_RECEIPT_KIND = "kitluy.pairing-receipt.v1" as const;

/** Domain separator for the transcript hash both proofs and the receipt cite. */
export const PAIRING_TRANSCRIPT_KIND = "kitluy.pairing-transcript.v1" as const;

/**
 * The complete pairing-session transcript. Both directional proofs sign
 * these EXACT fields; the receipt binds their hash. Values come from
 * AUTHORITATIVE Hub records — never from a caller-supplied payload.
 */
export interface PairingTranscript {
  readonly pairingSessionId: string;
  readonly protocolVersion: string;
  readonly purpose: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly hubDeviceId: string;
  readonly hubAssignmentGeneration: number;
  readonly hubCertificateSerial: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentGeneration: number;
  /** Structural `<vertical>.t<n>.<role>` key — cloud-authored, never installer-chosen. */
  readonly terminalProfileKey: string;
  readonly terminalCertificateSerial: string;
  readonly terminalCertificateFingerprint: string;
  /** Nonce the TERMINAL contributed in its hello (§8.1). */
  readonly terminalNonce: string;
  /** Nonce the HUB generated for its challenge (§8.2). */
  readonly hubNonce: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/** Fixed field order — a re-serialized transcript cannot verify differently. */
function transcriptFields(t: PairingTranscript): readonly string[] {
  return [
    t.pairingSessionId,
    t.protocolVersion,
    t.purpose,
    t.tenantId,
    t.digitalStoreId,
    t.storeLocationId,
    t.environment,
    t.hubDeviceId,
    String(t.hubAssignmentGeneration),
    t.hubCertificateSerial,
    t.hubCertificateFingerprint,
    t.terminalDeviceId,
    String(t.terminalAssignmentGeneration),
    t.terminalProfileKey,
    t.terminalCertificateSerial,
    t.terminalCertificateFingerprint,
    t.terminalNonce,
    t.hubNonce,
    t.issuedAt.toISOString(),
    t.expiresAt.toISOString(),
  ];
}

/** The canonical transcript bytes (hash input for both proofs' citation). */
export function pairingTranscriptBytes(t: PairingTranscript): Uint8Array {
  return Buffer.from([PAIRING_TRANSCRIPT_KIND, ...transcriptFields(t)].join("\n"), "utf8");
}

/** sha256 hex of the canonical transcript — what the receipt binds. */
export function pairingTranscriptHash(t: PairingTranscript): string {
  return createHash("sha256")
    .update(Buffer.from(pairingTranscriptBytes(t)))
    .digest("hex");
}

/** The exact bytes the TERMINAL signs. */
export function terminalPairingProofBytes(t: PairingTranscript): Uint8Array {
  return Buffer.from([PAIRING_TERMINAL_PROOF_KIND, ...transcriptFields(t)].join("\n"), "utf8");
}

/**
 * The exact bytes the HUB signs. Same fields, different separator — a
 * reflected terminal proof can never satisfy a Hub-proof verification.
 */
export function hubPairingProofBytes(t: PairingTranscript): Uint8Array {
  return Buffer.from([PAIRING_HUB_PROOF_KIND, ...transcriptFields(t)].join("\n"), "utf8");
}

/**
 * The immutable pairing receipt (§9). Hub-signed over a transcript that
 * already contains both verified proofs' subject matter. `validUntil` is
 * null when authority defines no receipt lifetime (§9 `valid_until: null`).
 *
 * The receipt proves the handshake at `pairedAt`. It does NOT prove future
 * Hub reachability, configuration download, first sync, terminal health, or
 * persistence across restart.
 */
export interface PairingReceipt {
  readonly receiptId: string;
  readonly receiptVersion: string;
  readonly pairingSessionId: string;
  readonly transcriptHash: string;
  readonly hubDeviceId: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalDeviceId: string;
  readonly terminalCertificateFingerprint: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly pairedAt: Date;
  readonly validUntil: Date | null;
  readonly correlationId: string;
}

/** The exact bytes the Hub signs for the receipt. */
export function pairingReceiptBytes(r: PairingReceipt): Uint8Array {
  return Buffer.from(
    [
      PAIRING_RECEIPT_KIND,
      r.receiptId,
      r.receiptVersion,
      r.pairingSessionId,
      r.transcriptHash,
      r.hubDeviceId,
      r.hubCertificateFingerprint,
      r.terminalDeviceId,
      r.terminalCertificateFingerprint,
      r.tenantId,
      r.digitalStoreId,
      r.storeLocationId,
      r.environment,
      String(r.terminalAssignmentGeneration),
      r.terminalProfileKey,
      r.pairedAt.toISOString(),
      r.validUntil === null ? "-" : r.validUntil.toISOString(),
      r.correlationId,
    ].join("\n"),
    "utf8",
  );
}

export function pairingReceiptHash(r: PairingReceipt): string {
  return createHash("sha256")
    .update(Buffer.from(pairingReceiptBytes(r)))
    .digest("hex");
}

/**
 * Refusal vocabulary. Protocol §18 names are reused EXACTLY where §18
 * defines them; the additions below follow §18's naming and each exists
 * because §18 has no code for that refusal:
 *
 *   PAIR_CHALLENGE_EXPIRED / PAIR_CHALLENGE_NOT_YET_VALID — §18 has only
 *       PAIR_CODE_EXPIRED, which names the provisioning code, not the
 *       pairing challenge window.
 *   PAIR_SESSION_MISMATCH — a proof presented against a different session's
 *       authoritative bindings (transplant), detected before any crypto.
 *   PAIR_NONCE_MISMATCH — a directional nonce that is not the one this
 *       session bound.
 *   PAIR_RECEIPT_INVALID / PAIR_RECEIPT_EXPIRED — §18 predates the receipt
 *       verification contract.
 */
export type PairingRefusalCode =
  | "PAIR_VERSION_INCOMPATIBLE"
  | "PAIR_ASSIGNMENT_MISMATCH"
  | "PAIR_CERT_INVALID"
  | "PAIR_HUB_NOT_ACTIVE"
  | "PAIR_DEVICE_NOT_ELIGIBLE"
  | "PAIR_PROFILE_FORBIDDEN"
  | "PAIR_CHALLENGE_FAILED"
  | "PAIR_CHALLENGE_EXPIRED"
  | "PAIR_CHALLENGE_NOT_YET_VALID"
  | "PAIR_SESSION_MISMATCH"
  | "PAIR_NONCE_MISMATCH"
  | "PAIR_RECEIPT_INVALID"
  | "PAIR_RECEIPT_EXPIRED";

export interface PairingVerdict {
  readonly verified: boolean;
  readonly refusalCode?: PairingRefusalCode;
  readonly detail?: string;
  readonly transcriptHash?: string;
}

/**
 * What the AUTHORITATIVE records say this pairing must be about. On the Hub
 * this is read from the pairing-session row and its relational neighbours;
 * on the terminal it is the signed assignment + receipt material the
 * terminal already trusts.
 */
export interface PairingExpectation {
  readonly pairingSessionId: string;
  readonly protocolVersion: string;
  readonly purpose: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly hubDeviceId: string;
  readonly hubAssignmentGeneration: number;
  readonly hubCertificateSerial: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly terminalCertificateSerial: string;
  readonly terminalCertificateFingerprint: string;
  /** Fingerprint of the key this side expects the SIGNER to hold. */
  readonly signerKeyFingerprint: string;
  readonly terminalNonce: string;
  readonly hubNonce: string;
}

type VerifySignature = (pem: string, payload: Uint8Array, sig: Uint8Array) => boolean;

/** Bindings first, signature last — shared by both directions. */
function checkBindings(
  t: PairingTranscript,
  e: PairingExpectation,
  now: Date,
): PairingVerdict | null {
  const refuse = (refusalCode: PairingRefusalCode, detail: string): PairingVerdict => ({
    verified: false,
    refusalCode,
    detail,
  });

  if (
    t.protocolVersion !== PAIRING_PROTOCOL_VERSION ||
    e.protocolVersion !== PAIRING_PROTOCOL_VERSION
  ) {
    return refuse(
      "PAIR_VERSION_INCOMPATIBLE",
      `protocol ${t.protocolVersion} is not ${PAIRING_PROTOCOL_VERSION}`,
    );
  }
  if (t.purpose !== PAIRING_PURPOSE || e.purpose !== PAIRING_PURPOSE) {
    return refuse("PAIR_SESSION_MISMATCH", `the transcript purpose is ${t.purpose}`);
  }
  if (t.pairingSessionId !== e.pairingSessionId) {
    return refuse("PAIR_SESSION_MISMATCH", "the proof belongs to another pairing session");
  }
  if (
    t.tenantId !== e.tenantId ||
    t.digitalStoreId !== e.digitalStoreId ||
    t.storeLocationId !== e.storeLocationId
  ) {
    return refuse(
      "PAIR_ASSIGNMENT_MISMATCH",
      "the proof belongs to another Tenant, Store or Location",
    );
  }
  if (t.environment !== e.environment) {
    return refuse("PAIR_ASSIGNMENT_MISMATCH", `the proof is for environment ${t.environment}`);
  }
  if (
    t.hubDeviceId !== e.hubDeviceId ||
    t.hubAssignmentGeneration !== e.hubAssignmentGeneration ||
    t.hubCertificateSerial !== e.hubCertificateSerial ||
    t.hubCertificateFingerprint !== e.hubCertificateFingerprint
  ) {
    return refuse("PAIR_ASSIGNMENT_MISMATCH", "the proof names a different Store Hub identity");
  }
  if (
    t.terminalDeviceId !== e.terminalDeviceId ||
    t.terminalAssignmentGeneration !== e.terminalAssignmentGeneration ||
    t.terminalCertificateSerial !== e.terminalCertificateSerial ||
    t.terminalCertificateFingerprint !== e.terminalCertificateFingerprint
  ) {
    return refuse("PAIR_ASSIGNMENT_MISMATCH", "the proof names a different terminal identity");
  }
  if (t.terminalProfileKey !== e.terminalProfileKey) {
    return refuse(
      "PAIR_PROFILE_FORBIDDEN",
      "the proof names a profile the assignment does not grant",
    );
  }
  if (t.terminalNonce !== e.terminalNonce || t.hubNonce !== e.hubNonce) {
    return refuse("PAIR_NONCE_MISMATCH", "a directional nonce is not the one this session bound");
  }
  if (now.getTime() < t.issuedAt.getTime()) {
    return refuse("PAIR_CHALLENGE_NOT_YET_VALID", "the session is dated in the future");
  }
  if (now.getTime() >= t.expiresAt.getTime()) {
    return refuse("PAIR_CHALLENGE_EXPIRED", "the pairing session expired");
  }
  return null;
}

/**
 * HUB-side verification of the terminal's proof.
 *
 * `hubTime` is the Hub-local authoritative clock (schema contract 0001 §1) —
 * read `now()` inside the same transaction that loaded the expectation.
 * A `verified: true` verdict is ATTESTATION INPUT for the governed
 * `record_terminal_pairing_proof_v1` door, which re-locks and re-validates
 * every relational prerequisite before recording anything.
 */
export function verifyTerminalPairingProof(
  transcript: PairingTranscript,
  signature: Uint8Array,
  terminalPublicKeyPem: string,
  expectation: PairingExpectation,
  hubTime: Date,
  computeFingerprint: (pem: string) => string,
  verifySignature: VerifySignature = verifyDetachedSignature,
): PairingVerdict {
  const bound = checkBindings(transcript, expectation, hubTime);
  if (bound !== null) return bound;

  const actual = computeFingerprint(terminalPublicKeyPem);
  if (
    actual !== expectation.signerKeyFingerprint ||
    transcript.terminalCertificateFingerprint !== expectation.signerKeyFingerprint
  ) {
    return {
      verified: false,
      refusalCode: "PAIR_CERT_INVALID",
      detail: "the presented key is not the terminal's credentialed key",
    };
  }
  if (!verifySignature(terminalPublicKeyPem, terminalPairingProofBytes(transcript), signature)) {
    return {
      verified: false,
      refusalCode: "PAIR_CHALLENGE_FAILED",
      detail: "the terminal proof does not verify under the credentialed key",
    };
  }
  return { verified: true, transcriptHash: pairingTranscriptHash(transcript) };
}

/**
 * TERMINAL-side verification of the Hub's proof. The expectation comes from
 * what the terminal already trusts: its signed assignment names the exact
 * Hub UUID, certificate fingerprint, scope and generation (§5: every
 * candidate endpoint must still pass these checks — an IP or mDNS name never
 * creates trust).
 */
export function verifyHubPairingProof(
  transcript: PairingTranscript,
  signature: Uint8Array,
  hubPublicKeyPem: string,
  expectation: PairingExpectation,
  terminalTime: Date,
  computeFingerprint: (pem: string) => string,
  verifySignature: VerifySignature = verifyDetachedSignature,
): PairingVerdict {
  const bound = checkBindings(transcript, expectation, terminalTime);
  if (bound !== null) return bound;

  const actual = computeFingerprint(hubPublicKeyPem);
  if (
    actual !== expectation.signerKeyFingerprint ||
    transcript.hubCertificateFingerprint !== expectation.signerKeyFingerprint
  ) {
    return {
      verified: false,
      refusalCode: "PAIR_HUB_NOT_ACTIVE",
      detail: "the presented key is not the assigned Hub's credentialed key",
    };
  }
  if (!verifySignature(hubPublicKeyPem, hubPairingProofBytes(transcript), signature)) {
    return {
      verified: false,
      refusalCode: "PAIR_CHALLENGE_FAILED",
      detail: "the Hub proof does not verify under the assigned Hub's key",
    };
  }
  return { verified: true, transcriptHash: pairingTranscriptHash(transcript) };
}

/** What the verifying side requires a receipt to say. */
export interface ReceiptExpectation {
  readonly pairingSessionId: string;
  readonly transcriptHash: string;
  readonly hubDeviceId: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalDeviceId: string;
  readonly terminalCertificateFingerprint: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
}

/**
 * Verifies a Hub-signed pairing receipt as HISTORICAL EVIDENCE of the
 * handshake. A valid receipt never by itself authorizes a different terminal
 * session, Hub, assignment generation, credential generation or environment
 * — reconnection (§11) re-validates certificates and assignment separately.
 */
export function verifyPairingReceipt(
  receipt: PairingReceipt,
  signature: Uint8Array,
  hubPublicKeyPem: string,
  expectation: ReceiptExpectation,
  atTime: Date,
  computeFingerprint: (pem: string) => string,
  verifySignature: VerifySignature = verifyDetachedSignature,
): PairingVerdict {
  const refuse = (refusalCode: PairingRefusalCode, detail: string): PairingVerdict => ({
    verified: false,
    refusalCode,
    detail,
  });

  if (receipt.receiptVersion !== PAIRING_PROTOCOL_VERSION) {
    return refuse("PAIR_VERSION_INCOMPATIBLE", `receipt version ${receipt.receiptVersion}`);
  }
  if (
    receipt.pairingSessionId !== expectation.pairingSessionId ||
    receipt.transcriptHash !== expectation.transcriptHash
  ) {
    return refuse("PAIR_RECEIPT_INVALID", "the receipt cites a different pairing transcript");
  }
  if (
    receipt.tenantId !== expectation.tenantId ||
    receipt.digitalStoreId !== expectation.digitalStoreId ||
    receipt.storeLocationId !== expectation.storeLocationId ||
    receipt.environment !== expectation.environment
  ) {
    return refuse("PAIR_RECEIPT_INVALID", "the receipt belongs to another scope");
  }
  if (
    receipt.hubDeviceId !== expectation.hubDeviceId ||
    receipt.hubCertificateFingerprint !== expectation.hubCertificateFingerprint
  ) {
    return refuse("PAIR_RECEIPT_INVALID", "the receipt names a different Store Hub");
  }
  if (
    receipt.terminalDeviceId !== expectation.terminalDeviceId ||
    receipt.terminalCertificateFingerprint !== expectation.terminalCertificateFingerprint ||
    receipt.terminalAssignmentGeneration !== expectation.terminalAssignmentGeneration ||
    receipt.terminalProfileKey !== expectation.terminalProfileKey
  ) {
    return refuse("PAIR_RECEIPT_INVALID", "the receipt names a different terminal or assignment");
  }
  if (receipt.validUntil !== null && atTime.getTime() >= receipt.validUntil.getTime()) {
    return refuse("PAIR_RECEIPT_EXPIRED", "the receipt validity window ended");
  }
  const actual = computeFingerprint(hubPublicKeyPem);
  if (actual !== receipt.hubCertificateFingerprint) {
    return refuse("PAIR_RECEIPT_INVALID", "the verifying key is not the signing Hub's key");
  }
  if (!verifySignature(hubPublicKeyPem, pairingReceiptBytes(receipt), signature)) {
    return refuse("PAIR_RECEIPT_INVALID", "the receipt signature does not verify");
  }
  return { verified: true, transcriptHash: receipt.transcriptHash };
}
