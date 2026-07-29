/**
 * Interrupted-renewal reconciliation — WS-11-T003 Step 4, Prompt 3A.
 *
 * Authority: KLD-2026-07-28-002 §4, §5, §12.6; the owner renewal instruction of
 * 2026-07-29; migration groups 0127, 0130 (TASK A and TASK D), 0132, 0133.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * A renewal spans two systems that DO NOT SHARE A TRANSACTION: PostgreSQL and
 * the external key provider. Every boundary between them is a place a process
 * can die with one side committed and the other not — a key generated but not
 * registered, a signature produced but not recorded, a credential finalized but
 * the key not activated, an activation performed but never confirmed.
 *
 * This module recovers those states. It does NOT retry blindly: it asks both
 * systems what they believe, classifies the pair, and chooses exactly ONE safe
 * next action.
 *
 * ===========================================================================
 * THE AUTHORITY MODEL, AND WHY IT IS SPLIT
 * ===========================================================================
 * PostgreSQL is authoritative for: the reservation, the mode, device and
 * assignment bindings, both generations, credential id and serial, canonical
 * TBS and digest, issuance-attempt state, credential persistence, head state,
 * renewal lifecycle, database key lifecycle, activation confirmation, audit.
 *
 * The PROVIDER is authoritative for: private-key custody, whether a key
 * EXISTS, its reference, its operational state, signing availability, and the
 * result of activation or destruction.
 *
 * Neither is consulted about the other's facts. PostgreSQL cannot observe
 * whether a private half is loaded (group 0130 TASK D); the provider has no
 * opinion on which generation the head is at. A reconciler that trusted one
 * system for the other's facts would "repair" states that were never broken.
 *
 * ===========================================================================
 * EXACTLY-ONCE BUSINESS EFFECT, NOT EXACTLY-ONCE SIGNING
 * ===========================================================================
 * This module does not claim exactly-once cryptographic signing — nothing can,
 * across a process boundary with a signer that may have completed before its
 * caller died. What it guarantees is exactly-once BUSINESS EFFECT: one
 * credential, one serial, one head advance, one provider key, one activation.
 * A signature that already exists is REUSED rather than re-requested; a second,
 * DIFFERENT signature for the same frozen TBS is never silently accepted.
 *
 * KLRISK-DEVICE-003 remains open and is untouched by any of this.
 */

import type { TrustEnvironment } from "./environments.js";
import { isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";
import type { RenewalMode } from "./same-key-renewal-preflight.js";

// ---------------------------------------------------------------------------
// Classifications
// ---------------------------------------------------------------------------

/**
 * What the reconciler decided, in the caller's vocabulary.
 *
 * Deliberately NOT collapsed into "pending" and "failed". The whole value of a
 * reconciliation is that "a key needs generating" and "the database says active
 * while the provider has nothing" are different situations with different
 * responses, and one of them must never be automated.
 */
export type ReconciliationClassification =
  | "NO_ACTION_COMPLETED"
  | "RESERVATION_PENDING"
  | "KEY_GENERATION_REQUIRED"
  | "KEY_METADATA_REGISTRATION_REQUIRED"
  | "POP_REQUIRED"
  | "ISSUANCE_PREPARATION_REQUIRED"
  | "SIGNATURE_REQUIRED"
  | "SIGNATURE_RECORDING_REQUIRED"
  | "FINALIZATION_REQUIRED"
  | "PROVIDER_ACTIVATION_REQUIRED"
  | "ACTIVATION_CONFIRMATION_REQUIRED"
  | "RESPONSE_REPLAY"
  | "ABANDONMENT_REQUIRED"
  | "MANUAL_REVIEW_REQUIRED"
  | "INCONSISTENT_STATE";

/** Classifications no automation may act on. Both need a human. */
const HUMAN_ONLY: ReadonlySet<ReconciliationClassification> = new Set([
  "MANUAL_REVIEW_REQUIRED",
  "INCONSISTENT_STATE",
]);

export function requiresHumanReview(classification: ReconciliationClassification): boolean {
  return HUMAN_ONLY.has(classification);
}

// ---------------------------------------------------------------------------
// Observed state
// ---------------------------------------------------------------------------

/** What PostgreSQL reports. Every field is owned by the database. */
export interface ObservedDatabaseState {
  readonly renewalAttemptId: string;
  readonly renewalMode: RenewalMode;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly reservationStatus: string;
  readonly currentCredentialId: string;
  readonly currentCredentialGeneration: number;
  readonly nextCredentialGeneration: number;
  readonly assignmentGeneration: number;
  readonly credentialHeadVersion: number;
  /** The head as it stands NOW. Compared against the frozen version. */
  readonly headVersion: number | null;
  readonly headGeneration: number | null;
  /** `device_generation_keys` for this attempt. Null under reuse_current_key. */
  readonly replacementKey: {
    readonly state: string;
    readonly keyGeneration: number | null;
    readonly publicKeyFingerprint: string;
    readonly providerKeyReference: string;
  } | null;
  /** `device_credential_signing_attempts` for the renewal's request id. */
  readonly issuanceAttempt: {
    readonly state: string;
    readonly credentialId: string;
    readonly serialNumber: string;
    readonly certificateGeneration: number;
    readonly canonicalTbsHash: string;
    readonly issuerKeyId: string;
    readonly signatureSha256: string | null;
    readonly hasSignature: boolean;
  } | null;
  /** Whether the credential for the NEXT generation is persisted. */
  readonly credentialPersisted: boolean;
  readonly persistedCredentialId: string | null;
  readonly deviceAssignmentGeneration: number;
}

/** What the PROVIDER reports. Never inferred from the database. */
export interface ObservedProviderState {
  /** Null when the provider holds no key for this attempt. */
  readonly replacementKey: {
    readonly providerKeyReference: string;
    readonly publicKeyFingerprint: string;
    readonly keyGeneration: number;
    readonly state: string;
  } | null;
  /** The incumbent key, which must survive the overlap. */
  readonly incumbentAvailable: boolean;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface ReconciliationReader {
  loadDatabaseState(renewalAttemptId: string): Promise<ObservedDatabaseState | null>;
}

export interface ReconciliationProviderProbe {
  observe(state: ObservedDatabaseState): Promise<ObservedProviderState>;
}

/** The single governed write this module performs directly: its own audit. */
export interface ReconciliationAuditGateway {
  record(input: {
    readonly renewalAttemptId: string;
    readonly observedDatabaseState: string;
    readonly observedProviderState: string;
    readonly classification: ReconciliationClassification;
    readonly actionAttempted: string;
    readonly actionResult: string;
    readonly replayOutcome: string;
    readonly failureCode: string | null;
    readonly actorRef: string;
  }): Promise<{ readonly reconciliationId: string }>;
}

/**
 * Executes the ONE action a classification selected.
 *
 * Every method is expected to be idempotent, because every one of them is
 * something a previous run may already have done. The reconciler does not
 * implement them: they are the SAME governed operations the forward path uses,
 * and a second implementation would be a second way to be wrong.
 */
export interface ReconciliationExecutor {
  generateReplacementKey(state: ObservedDatabaseState): Promise<string>;
  registerReplacementKey(state: ObservedDatabaseState): Promise<string>;
  proveReplacementPossession(state: ObservedDatabaseState): Promise<string>;
  prepareIssuance(state: ObservedDatabaseState): Promise<string>;
  signAndRecord(state: ObservedDatabaseState): Promise<string>;
  finalizeIssuance(state: ObservedDatabaseState): Promise<string>;
  activateProviderKey(state: ObservedDatabaseState): Promise<string>;
  confirmActivation(state: ObservedDatabaseState): Promise<string>;
  abandonReplacementKey(state: ObservedDatabaseState, reason: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Input and outcome
// ---------------------------------------------------------------------------

export interface ReconciliationInput {
  readonly renewalAttemptId: string;
  /** The scope the caller BELIEVES this attempt belongs to. Checked, not trusted. */
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
  readonly actorRef: string;
  readonly trustedTime: TrustedTimeEvaluation;
  /**
   * When false, the reconciler classifies and records but executes NOTHING.
   * A dry run is how an operator sees what would happen before it does.
   */
  readonly execute?: boolean;
}

export interface ReconciliationDecision {
  readonly renewalAttemptId: string;
  readonly renewalMode: RenewalMode;
  readonly classification: ReconciliationClassification;
  /** The single action this classification selects. */
  readonly action: string;
  /** WHY automatic recovery is safe here — or why it is not. */
  readonly reason: string;
  readonly automatic: boolean;
}

export interface ReconciliationOutcome {
  readonly outcome: "RECONCILED" | "REPLAYED" | "NO_ACTION" | "REFUSED";
  readonly decision?: ReconciliationDecision;
  readonly databaseState?: ObservedDatabaseState;
  readonly providerState?: ObservedProviderState;
  readonly actionResult?: string;
  /** What remains after this run, if anything. Null when nothing is left. */
  readonly remainingAction?: ReconciliationClassification | null;
  readonly reconciliationId?: string;
  readonly refusalCode?: ReconciliationRefusalCode;
  readonly detail?: string;
}

export type ReconciliationRefusalCode =
  | "RECONCILE_NO_RESERVATION"
  | "RECONCILE_NO_TRUSTED_TIME"
  | "RECONCILE_WRONG_DEVICE"
  | "RECONCILE_WRONG_SCOPE"
  | "RECONCILE_STALE_HEAD"
  | "RECONCILE_STALE_ASSIGNMENT"
  | "RECONCILE_PROVIDER_DIVERGED"
  | "RECONCILE_ACTION_FAILED"
  | "RECONCILE_MANUAL_REVIEW";

// ---------------------------------------------------------------------------
// The decision table
// ---------------------------------------------------------------------------

/**
 * ONE table, exhaustive by construction, rather than conditionals scattered
 * through the executor.
 *
 * Each row is (database condition, provider condition) -> classification,
 * action, reason. `matches` is evaluated in order and the FIRST match wins, so
 * the rows are ordered most-specific first — the divergence rows come before
 * the progress rows precisely so a divergence is never mistaken for progress.
 *
 * Anything that matches no row FAILS CLOSED as `INCONSISTENT_STATE`.
 */
export interface ReconciliationRule {
  readonly id: string;
  readonly appliesTo: RenewalMode | "both";
  readonly databaseCondition: string;
  readonly providerCondition: string;
  readonly classification: ReconciliationClassification;
  readonly action: string;
  readonly reason: string;
  readonly matches: (db: ObservedDatabaseState, provider: ObservedProviderState) => boolean;
}

const TERMINAL_RESERVATION = new Set(["refused", "abandoned"]);

const providerKeyState = (p: ObservedProviderState): string => p.replacementKey?.state ?? "missing";

export const RECONCILIATION_RULES: readonly ReconciliationRule[] = [
  {
    id: "R01",
    appliesTo: "rotate_key",
    databaseCondition: "key active",
    providerCondition: "missing or not active",
    classification: "INCONSISTENT_STATE",
    action: "none",
    reason:
      "the database records an ACTIVE replacement key that the provider does not have active. This is provider loss, a restore from an older snapshot, or a compromise — never something to repair by generating another key, because doing so would silently replace an identity the database already vouches for.",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" &&
      db.replacementKey?.state === "active" &&
      providerKeyState(p) !== "active",
  },
  {
    id: "R02",
    appliesTo: "rotate_key",
    databaseCondition: "key registered",
    providerCondition: "reference or fingerprint differs",
    classification: "MANUAL_REVIEW_REQUIRED",
    action: "none",
    reason:
      "the provider holds a key for this attempt that is not the one the database registered. One of the two is describing a key nobody else has, and choosing either would bind a credential to an identity the other system cannot corroborate.",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" &&
      db.replacementKey !== null &&
      p.replacementKey !== null &&
      (db.replacementKey.publicKeyFingerprint !== p.replacementKey.publicKeyFingerprint ||
        db.replacementKey.providerKeyReference !== p.replacementKey.providerKeyReference ||
        (db.replacementKey.keyGeneration ?? p.replacementKey.keyGeneration) !==
          p.replacementKey.keyGeneration),
  },
  {
    id: "R42",
    appliesTo: "rotate_key",
    databaseCondition: "credential not persisted",
    providerCondition: "active",
    classification: "INCONSISTENT_STATE",
    action: "none",
    reason:
      "the provider activated a key for a credential that does not exist. Confirming would record an activation for nothing, and finalizing afterwards would bless a key that was made operational before anything authorized it.",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" &&
      !db.credentialPersisted &&
      providerKeyState(p) === "active",
  },
  {
    id: "R03",
    appliesTo: "both",
    databaseCondition: "reservation refused or abandoned",
    providerCondition: "key not destroyed",
    classification: "ABANDONMENT_REQUIRED",
    action: "abandon the replacement key",
    reason:
      "the reservation is terminal, so the key it owed can never receive a credential. Abandoning it is what stops a loser key being presented later; destruction is a separate, deferred step.",
    matches: (db, p) =>
      TERMINAL_RESERVATION.has(db.reservationStatus) &&
      p.replacementKey !== null &&
      p.replacementKey.state !== "destroyed" &&
      p.replacementKey.state !== "abandoned",
  },
  {
    id: "R04",
    appliesTo: "both",
    databaseCondition: "reservation refused or abandoned",
    providerCondition: "no key, or already abandoned",
    classification: "NO_ACTION_COMPLETED",
    action: "none",
    reason:
      "a terminal reservation with nothing outstanding on the provider side. There is no renewal left to finish and no key left to contain.",
    matches: (db, p) =>
      TERMINAL_RESERVATION.has(db.reservationStatus) &&
      (p.replacementKey === null ||
        p.replacementKey.state === "abandoned" ||
        p.replacementKey.state === "destroyed"),
  },
  {
    id: "R05",
    appliesTo: "rotate_key",
    databaseCondition: "abandoned key",
    providerCondition: "any non-destroyed",
    classification: "ABANDONMENT_REQUIRED",
    action: "abandon the replacement key",
    reason:
      "the database already abandoned this key; the provider has not been told. An abandoned key that can still sign is exactly the loser-key risk group 0128 contained.",
    matches: (db, p) =>
      db.replacementKey?.state === "abandoned" &&
      p.replacementKey !== null &&
      p.replacementKey.state !== "abandoned" &&
      p.replacementKey.state !== "destroyed",
  },
  {
    id: "R10",
    appliesTo: "reuse_current_key",
    databaseCondition: "completed",
    providerCondition: "incumbent available",
    classification: "RESPONSE_REPLAY",
    action: "replay the recorded result",
    reason:
      "the renewal finished; only the response was lost. Replaying the recorded result is the whole answer — re-running eligibility here would judge the NEW credential and wrongly report NOT_IN_RENEWAL_WINDOW.",
    matches: (db) => db.renewalMode === "reuse_current_key" && db.reservationStatus === "completed",
  },
  {
    id: "R11",
    appliesTo: "rotate_key",
    databaseCondition: "completed, key active",
    providerCondition: "active",
    classification: "RESPONSE_REPLAY",
    action: "replay the recorded result",
    reason: "both systems agree the rotation completed. Only the acknowledgment was lost.",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" &&
      db.reservationStatus === "completed" &&
      db.replacementKey?.state === "active" &&
      providerKeyState(p) === "active",
  },
  {
    id: "R52",
    appliesTo: "reuse_current_key",
    databaseCondition: "any",
    providerCondition: "incumbent missing",
    classification: "MANUAL_REVIEW_REQUIRED",
    action: "none",
    reason:
      "a same-key renewal needs the key it is reusing, and the provider does not have it. Nothing here can conjure the private half back.",
    matches: (db, p) => db.renewalMode === "reuse_current_key" && !p.incumbentAvailable,
  },
  {
    id: "R50",
    appliesTo: "reuse_current_key",
    databaseCondition: "credential persisted, reservation not completed",
    providerCondition: "incumbent available",
    classification: "RESPONSE_REPLAY",
    action: "replay the recorded result",
    reason:
      "the credential exists and migration 0132 completes a same-key reservation atomically with it, so there is nothing left to do but report what happened.",
    matches: (db) =>
      db.renewalMode === "reuse_current_key" &&
      db.credentialPersisted &&
      db.reservationStatus !== "completed",
  },
  {
    id: "R51",
    appliesTo: "reuse_current_key",
    databaseCondition: "reserved, nothing prepared",
    providerCondition: "incumbent available",
    classification: "RESERVATION_PENDING",
    action: "prepare the next credential",
    reason:
      "the reservation committed and the response was lost before preparation. The ORIGINAL attempt is resumed rather than a new renewal started.",
    matches: (db, p) =>
      db.renewalMode === "reuse_current_key" &&
      db.issuanceAttempt === null &&
      !db.credentialPersisted &&
      p.incumbentAvailable,
  },
  {
    id: "R20",
    appliesTo: "rotate_key",
    databaseCondition: "reserved, no key row",
    providerCondition: "missing",
    classification: "KEY_GENERATION_REQUIRED",
    action: "generate the replacement key idempotently",
    reason:
      "the reservation exists and no key does, on either side. Generation is idempotent on the renewal attempt, so a retry cannot produce a second key.",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" && db.replacementKey === null && p.replacementKey === null,
  },
  {
    id: "R21",
    appliesTo: "rotate_key",
    databaseCondition: "no key row",
    providerCondition: "key exists",
    classification: "KEY_METADATA_REGISTRATION_REQUIRED",
    action: "register the existing provider key",
    reason:
      "the provider generated a key and the response was lost before registration. The key is REUSED, never regenerated: the provider is authoritative for its existence.",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" && db.replacementKey === null && p.replacementKey !== null,
  },
  {
    id: "R22",
    appliesTo: "rotate_key",
    databaseCondition: "key generated, no issuance attempt",
    providerCondition: "generated",
    classification: "POP_REQUIRED",
    action: "prove possession with the replacement key and prepare the next credential",
    reason:
      "the key is registered and no issuance has been prepared. Possession is proved AGAIN rather than assumed — and prove-and-prepare is ONE durable step here, because proof of possession has no marker of its own: prepare_device_credential_issuance_v1 is what records the PoP result. Splitting them would leave a classification whose completion nothing could observe, and recovery would loop on it forever.",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" &&
      db.replacementKey?.state === "generated" &&
      db.issuanceAttempt === null &&
      providerKeyState(p) === "generated",
  },
  {
    id: "R40",
    appliesTo: "rotate_key",
    databaseCondition: "pending activation",
    providerCondition: "not yet active",
    classification: "PROVIDER_ACTIVATION_REQUIRED",
    action: "activate the replacement key in the provider",
    reason:
      "the credential is finalized and the provider has not been asked. Only the provider can answer whether the private half is loaded (group 0130 TASK D).",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" &&
      db.replacementKey?.state === "credential_issued_pending_activation" &&
      providerKeyState(p) !== "active",
  },
  {
    id: "R41",
    appliesTo: "rotate_key",
    databaseCondition: "pending activation",
    providerCondition: "already active",
    classification: "ACTIVATION_CONFIRMATION_REQUIRED",
    action: "confirm the activation in the database",
    reason:
      "activation SUCCEEDED and the acknowledgment was lost. The database is told what the provider already did; nothing is generated and no other key is activated.",
    matches: (db, p) =>
      db.renewalMode === "rotate_key" &&
      db.replacementKey?.state === "credential_issued_pending_activation" &&
      providerKeyState(p) === "active",
  },
  {
    id: "R30",
    appliesTo: "both",
    databaseCondition: "no issuance attempt",
    providerCondition: "ready",
    classification: "ISSUANCE_PREPARATION_REQUIRED",
    action: "prepare the next credential",
    reason:
      "nothing has been reserved with the issuance functions yet. Preparation allocates the credential id, serial, window and canonical TBS — all in the database, none here.",
    matches: (db) =>
      db.issuanceAttempt === null &&
      !db.credentialPersisted &&
      (db.renewalMode === "reuse_current_key" || db.replacementKey?.state === "generated"),
  },
  {
    id: "R31",
    appliesTo: "both",
    databaseCondition: "attempt reserved, no signature",
    providerCondition: "ready",
    classification: "SIGNATURE_REQUIRED",
    action: "sign the frozen canonical TBS and record it",
    reason:
      "the TBS is reserved and unsigned. The bytes are the database's and are signed unchanged; nothing regenerates them with different identifiers.",
    matches: (db) => db.issuanceAttempt?.state === "reserved" && !db.issuanceAttempt.hasSignature,
  },
  {
    id: "R32",
    appliesTo: "both",
    databaseCondition: "attempt reserved, signature present",
    providerCondition: "ready",
    classification: "SIGNATURE_RECORDING_REQUIRED",
    action: "record the existing signature",
    reason:
      "a signature exists against a reservation still marked unsigned. It is RECORDED, not replaced — asking the CA again would produce a second signature for one request.",
    matches: (db) => db.issuanceAttempt?.state === "reserved" && db.issuanceAttempt.hasSignature,
  },
  {
    id: "R33",
    appliesTo: "both",
    databaseCondition: "signed, credential not persisted",
    providerCondition: "ready",
    classification: "FINALIZATION_REQUIRED",
    action: "finalize the credential",
    reason:
      "the signature is durable and finalization did not commit. This is the recoverable case: finalization replays with the ORIGINAL signature.",
    matches: (db) => db.issuanceAttempt?.state === "signed" && !db.credentialPersisted,
  },
];

/**
 * Chooses the ONE rule that applies. Fails closed.
 *
 * An unknown combination is `INCONSISTENT_STATE` rather than a default action,
 * because the states this module exists for are exactly the ones nobody
 * predicted — and guessing at those is how a recovery tool corrupts things a
 * human could have fixed.
 */
export function classifyReconciliation(
  db: ObservedDatabaseState,
  provider: ObservedProviderState,
): ReconciliationDecision {
  const rule = RECONCILIATION_RULES.find(
    (r) => (r.appliesTo === "both" || r.appliesTo === db.renewalMode) && r.matches(db, provider),
  );

  if (rule === undefined) {
    return {
      renewalAttemptId: db.renewalAttemptId,
      renewalMode: db.renewalMode,
      classification: "INCONSISTENT_STATE",
      action: "none",
      reason: `no reconciliation rule matches database state "${describeDatabase(db)}" with provider state "${describeProvider(provider)}". Failing closed: an unrecognised combination is precisely the case automation must not guess at.`,
      automatic: false,
    };
  }

  return {
    renewalAttemptId: db.renewalAttemptId,
    renewalMode: db.renewalMode,
    classification: rule.classification,
    action: rule.action,
    reason: `${rule.id}: ${rule.reason}`,
    automatic: !requiresHumanReview(rule.classification),
  };
}

/** Lifecycle NAMES only. Never key material — migration 0133 refuses that. */
export function describeDatabase(db: ObservedDatabaseState): string {
  return [
    `reservation=${db.reservationStatus}`,
    `mode=${db.renewalMode}`,
    `key=${db.replacementKey?.state ?? "none"}`,
    `issuance=${db.issuanceAttempt?.state ?? "none"}`,
    `signature=${db.issuanceAttempt?.hasSignature === true ? "present" : "absent"}`,
    `credential=${db.credentialPersisted ? "persisted" : "absent"}`,
    `head=${db.headGeneration ?? "none"}@v${db.headVersion ?? "none"}`,
  ].join(" ");
}

export function describeProvider(provider: ObservedProviderState): string {
  return [
    `key=${providerKeyState(provider)}`,
    `incumbent=${provider.incumbentAvailable ? "available" : "missing"}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Reconciles ONE renewal attempt and performs at most ONE action.
 *
 * Deliberately single-step. A reconciler that drove a renewal all the way to
 * completion in one pass would be re-implementing the forward path, and its
 * failure modes would be a second thing to reason about. One step per call, an
 * audit row per call, and the caller decides whether to call again.
 */
export async function reconcileDeviceCredentialRenewal(
  input: ReconciliationInput,
  reader: ReconciliationReader,
  probe: ReconciliationProviderProbe,
  executor: ReconciliationExecutor,
  audit: ReconciliationAuditGateway,
): Promise<ReconciliationOutcome> {
  const refuse = (
    refusalCode: ReconciliationRefusalCode,
    detail: string,
    extra: Partial<ReconciliationOutcome> = {},
  ): ReconciliationOutcome => ({ outcome: "REFUSED", refusalCode, detail, ...extra });

  // Trusted time first, as everywhere else in this package.
  if (isRestricted(input.trustedTime.status) || input.trustedTime.trustedTime === null) {
    return refuse(
      "RECONCILE_NO_TRUSTED_TIME",
      `no trusted time is established (status ${input.trustedTime.status})`,
    );
  }

  const db = await reader.loadDatabaseState(input.renewalAttemptId);
  if (db === null) {
    return refuse(
      "RECONCILE_NO_RESERVATION",
      `no renewal reservation ${input.renewalAttemptId} exists`,
    );
  }

  // The caller's belief about scope is CHECKED. A reconciler pointed at the
  // wrong device would otherwise repair one device's renewal using another's.
  if (db.deviceRecordId !== input.deviceRecordId) {
    return refuse("RECONCILE_WRONG_DEVICE", "the reservation belongs to another device", {
      databaseState: db,
    });
  }
  if (db.environment !== input.environment || db.purpose !== input.purpose) {
    return refuse(
      "RECONCILE_WRONG_SCOPE",
      "the reservation is for another environment or purpose",
      {
        databaseState: db,
      },
    );
  }

  const provider = await probe.observe(db);
  const decision = classifyReconciliation(db, provider);

  // A stale head or assignment is only a problem for work still to be DONE. If
  // the credential already exists, the frozen values already did their job and
  // reporting a conflict would obscure a completed renewal.
  const stillToIssue = !db.credentialPersisted && decision.classification !== "RESPONSE_REPLAY";
  if (stillToIssue && db.headVersion !== null && db.headVersion !== db.credentialHeadVersion) {
    return await recordAndReturn(
      refuse(
        "RECONCILE_STALE_HEAD",
        `the head moved from version ${db.credentialHeadVersion} to ${db.headVersion}; this attempt can no longer issue`,
        { databaseState: db, providerState: provider },
      ),
      { ...decision, classification: "MANUAL_REVIEW_REQUIRED", automatic: false },
    );
  }
  if (stillToIssue && db.deviceAssignmentGeneration !== db.assignmentGeneration) {
    return await recordAndReturn(
      refuse(
        "RECONCILE_STALE_ASSIGNMENT",
        `the device was reassigned (${db.assignmentGeneration} -> ${db.deviceAssignmentGeneration}); this attempt can no longer issue`,
        { databaseState: db, providerState: provider },
      ),
      { ...decision, classification: "MANUAL_REVIEW_REQUIRED", automatic: false },
    );
  }

  // Human-only classifications are RECORDED and returned, never executed.
  if (!decision.automatic) {
    return await recordAndReturn(
      {
        outcome: "REFUSED",
        refusalCode: "RECONCILE_MANUAL_REVIEW",
        detail: decision.reason,
        decision,
        databaseState: db,
        providerState: provider,
        remainingAction: decision.classification,
      },
      decision,
    );
  }

  if (
    decision.classification === "NO_ACTION_COMPLETED" ||
    decision.classification === "RESPONSE_REPLAY"
  ) {
    return await recordAndReturn(
      {
        outcome: decision.classification === "RESPONSE_REPLAY" ? "REPLAYED" : "NO_ACTION",
        decision,
        databaseState: db,
        providerState: provider,
        actionResult: "nothing to do",
        remainingAction: null,
      },
      decision,
      "replayed",
    );
  }

  if (input.execute === false) {
    return await recordAndReturn(
      {
        outcome: "NO_ACTION",
        decision,
        databaseState: db,
        providerState: provider,
        actionResult: "dry run — not executed",
        remainingAction: decision.classification,
      },
      decision,
      "dry-run",
    );
  }

  // -- EXECUTE EXACTLY ONE ACTION ------------------------------------------
  let actionResult: string;
  try {
    actionResult = await executeOne(decision.classification, db, executor);
  } catch (error) {
    return await recordAndReturn(
      refuse("RECONCILE_ACTION_FAILED", errorText(error), {
        decision,
        databaseState: db,
        providerState: provider,
        remainingAction: decision.classification,
      }),
      decision,
      "not-replayed",
      errorText(error),
    );
  }

  // Reload BOTH systems: the point of a reconciliation is what is true after.
  const afterDb = (await reader.loadDatabaseState(input.renewalAttemptId)) ?? db;
  const afterProvider = await probe.observe(afterDb);
  const afterDecision = classifyReconciliation(afterDb, afterProvider);
  const remaining =
    afterDecision.classification === "NO_ACTION_COMPLETED" ||
    afterDecision.classification === "RESPONSE_REPLAY"
      ? null
      : afterDecision.classification;

  return await recordAndReturn(
    {
      outcome: "RECONCILED",
      decision,
      databaseState: afterDb,
      providerState: afterProvider,
      actionResult,
      remainingAction: remaining,
    },
    decision,
    "executed",
  );

  async function recordAndReturn(
    outcome: ReconciliationOutcome,
    recorded: ReconciliationDecision,
    replay = "not-replayed",
    failure?: string,
  ): Promise<ReconciliationOutcome> {
    try {
      const { reconciliationId } = await audit.record({
        renewalAttemptId: db!.renewalAttemptId,
        observedDatabaseState: describeDatabase(db!),
        observedProviderState: describeProvider(provider),
        classification: recorded.classification,
        actionAttempted: recorded.action,
        actionResult: outcome.actionResult ?? outcome.refusalCode ?? "none",
        replayOutcome: replay,
        failureCode: failure ?? outcome.refusalCode ?? null,
        actorRef: input.actorRef,
      });
      return { ...outcome, reconciliationId };
    } catch (error) {
      // The audit is durable evidence, not decoration. If it cannot be written
      // the reconciliation is reported as REFUSED rather than silently
      // succeeding with no record of what it did.
      return {
        ...outcome,
        outcome: "REFUSED",
        refusalCode: "RECONCILE_ACTION_FAILED",
        detail: `the reconciliation could not be recorded: ${errorText(error)}`,
      };
    }
  }
}

/** One classification, one call. No fallthrough, no second action. */
async function executeOne(
  classification: ReconciliationClassification,
  db: ObservedDatabaseState,
  executor: ReconciliationExecutor,
): Promise<string> {
  switch (classification) {
    case "KEY_GENERATION_REQUIRED":
      return executor.generateReplacementKey(db);
    case "KEY_METADATA_REGISTRATION_REQUIRED":
      return executor.registerReplacementKey(db);
    case "POP_REQUIRED":
      return executor.proveReplacementPossession(db);
    case "RESERVATION_PENDING":
    case "ISSUANCE_PREPARATION_REQUIRED":
      return executor.prepareIssuance(db);
    case "SIGNATURE_REQUIRED":
    case "SIGNATURE_RECORDING_REQUIRED":
      return executor.signAndRecord(db);
    case "FINALIZATION_REQUIRED":
      return executor.finalizeIssuance(db);
    case "PROVIDER_ACTIVATION_REQUIRED":
      return executor.activateProviderKey(db);
    case "ACTIVATION_CONFIRMATION_REQUIRED":
      return executor.confirmActivation(db);
    case "ABANDONMENT_REQUIRED":
      return executor.abandonReplacementKey(db, "the reservation is terminal");
    default:
      // Unreachable: human-only and no-op classifications never arrive here.
      throw new Error(`no executable action for classification ${classification}`);
  }
}
