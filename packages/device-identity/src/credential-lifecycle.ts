/**
 * Credential overlap expiry and superseded-key lifecycle — WS-11-T003 Step 4,
 * Prompt 3B.
 *
 * Authority: KLD-2026-07-28-002 §5; the owner renewal instruction of
 * 2026-07-29; migration groups 0125, 0127, 0130, 0132, 0133, 0134.
 *
 * ===========================================================================
 * THREE LIFECYCLES, KEPT APART
 * ===========================================================================
 *   credential validity          — does this credential verify right now
 *   credential-head status       — which generation is CURRENT, and what
 *                                  previous generation still overlaps it
 *   provider private-key state   — does the private half exist and may it be
 *                                  used, superseded or destroyed
 *
 * They are related and they are NOT the same. A credential expiring does not
 * prove its key can be destroyed: the same key may still back the current
 * credential (every same-key renewal), an unfinished issuance, a renewal in
 * flight, a pending reconciliation, or a retention requirement nobody has
 * ruled on yet. Coupling expiry straight to destruction is the mistake this
 * module is built to avoid.
 *
 * ===========================================================================
 * THE BOUNDARY IS HALF-OPEN, AND SAID ONCE PER LAYER
 * ===========================================================================
 *     overlap usable   while  trusted_now <  overlap_ends_at
 *     overlap expired  when   trusted_now >= overlap_ends_at
 *
 * Stated identically here, in `certificate-validity.ts` and in
 * `retire_overlapped_credential_v1`, so no millisecond gap can open between
 * the layer that verifies and the layer that retires.
 *
 * ===========================================================================
 * DESTRUCTION IS SPECIFIED AND BLOCKED
 * ===========================================================================
 * No owner decision governs private-key retention. Migration 0134 therefore
 * ships `key_destruction_policy` with destruction DISABLED and both retention
 * periods NULL, naming `[REQUIRED: device_key_destruction_owner_decision]`.
 *
 * This module evaluates ELIGIBILITY and records it. It does not destroy
 * anything, and it does not choose a retention period — inventing one would be
 * exactly the failure the empty policy table exists to prevent.
 */

import type { TrustEnvironment } from "./environments.js";
import { isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";
import type { CredentialOverlap } from "./certificate-validity.js";

// ---------------------------------------------------------------------------
// Classifications
// ---------------------------------------------------------------------------

export type LifecycleClassification =
  | "NO_ACTION_CURRENT"
  | "OVERLAP_ACTIVE"
  | "OVERLAP_EXPIRED"
  | "PREVIOUS_CREDENTIAL_RETIRED"
  | "KEY_STILL_REFERENCED"
  | "KEY_DESTRUCTION_NOT_AUTHORIZED"
  | "KEY_DESTRUCTION_PENDING"
  | "KEY_DESTROYED"
  | "MANUAL_REVIEW_REQUIRED"
  | "INCONSISTENT_STATE";

const HUMAN_ONLY: ReadonlySet<LifecycleClassification> = new Set([
  "MANUAL_REVIEW_REQUIRED",
  "INCONSISTENT_STATE",
]);

export function lifecycleRequiresHumanReview(c: LifecycleClassification): boolean {
  return HUMAN_ONLY.has(c);
}

// ---------------------------------------------------------------------------
// Observed state
// ---------------------------------------------------------------------------

export interface LifecycleCredential {
  readonly credentialId: string;
  readonly certificateGeneration: number;
  readonly publicKeyFingerprint: string;
  readonly state: string;
  readonly notAfter: Date;
}

export interface LifecycleProviderKey {
  readonly providerKeyReference: string;
  readonly publicKeyFingerprint: string;
  readonly generation: number;
  readonly keyGeneration: number | null;
  readonly state: string;
}

/** Whether an owner has ruled on destruction. Absent by default. */
export interface KeyDestructionPolicy {
  readonly destructionEnabled: boolean;
  readonly minimumRetentionDays: number | null;
  readonly recoveryRetentionDays: number | null;
  readonly requiresOperatorApproval: boolean;
  readonly approvedByDecisionRef: string | null;
  readonly requiredOwnerDecision: string | null;
}

/** Everything that can keep a key alive. Any one of them blocks destruction. */
export interface KeyRetentionBlockers {
  /** Credentials other than the retired one that still attest to this key. */
  readonly referencingCredentialIds: readonly string[];
  readonly unfinishedIssuanceCount: number;
  readonly openRenewalCount: number;
  readonly activationPendingCount: number;
  readonly openReconciliationCount: number;
  /** A divergence a human has not dispositioned. */
  readonly manualReviewOutstanding: boolean;
}

export interface ObservedLifecycleState {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly headGeneration: number;
  readonly headPreviousGeneration: number | null;
  readonly overlapEndsAt: Date | null;
  readonly currentCredential: LifecycleCredential | null;
  readonly previousCredential: LifecycleCredential | null;
  readonly currentKey: LifecycleProviderKey | null;
  readonly previousKey: LifecycleProviderKey | null;
  readonly destructionPolicy: KeyDestructionPolicy;
  readonly retention: KeyRetentionBlockers;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface LifecycleReader {
  loadLifecycleState(scope: {
    readonly deviceRecordId: string;
    readonly environment: string;
    readonly purpose: string;
  }): Promise<ObservedLifecycleState | null>;
}

export interface LifecycleGateway {
  /** `retire_overlapped_credential_v1`. Idempotent; never touches the head. */
  retireOverlappedCredential(input: {
    readonly deviceRecordId: string;
    readonly environment: string;
    readonly purpose: string;
    readonly trustedTime: Date;
    readonly trustedTimeStatus: string;
    readonly actorRef: string;
  }): Promise<{ readonly outcome: string; readonly previousCredentialId?: string }>;

  recordLifecycleEvent(input: LifecycleAuditRecord): Promise<{
    readonly lifecycleExecutionId: string;
  }>;
}

export interface LifecycleAuditRecord {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly trustedTime: Date;
  readonly trustedTimeSource: string;
  readonly trustedTimeStatus: string;
  readonly currentCredentialId: string | null;
  readonly currentCredentialGeneration: number | null;
  readonly previousCredentialId: string | null;
  readonly previousCredentialGeneration: number | null;
  readonly overlapEndsAt: Date | null;
  readonly classification: LifecycleClassification;
  readonly credentialTransition: string;
  readonly providerKeyTransition: string;
  readonly destructionPolicyReference: string | null;
  readonly providerResult: string | null;
  readonly databaseConfirmationResult: string | null;
  readonly reason: string;
  readonly replayOutcome: string;
  readonly actorRef: string;
}

// ---------------------------------------------------------------------------
// Input and outcome
// ---------------------------------------------------------------------------

export interface LifecycleInput {
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
  readonly trustedTime: TrustedTimeEvaluation;
  readonly actorRef: string;
  /** Stable per lifecycle intent. Advancement is idempotent regardless. */
  readonly idempotencyKey: string;
}

export type LifecycleRefusalCode =
  | "LIFECYCLE_NO_TRUSTED_TIME"
  | "LIFECYCLE_NO_HEAD"
  | "LIFECYCLE_WRONG_SCOPE"
  | "LIFECYCLE_MANUAL_REVIEW"
  | "LIFECYCLE_ACTION_FAILED";

export interface LifecycleOutcome {
  readonly outcome: "ADVANCED" | "NO_ACTION" | "REPLAYED" | "REFUSED";
  readonly classification?: LifecycleClassification;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly currentCredentialId?: string | null;
  readonly currentCredentialGeneration?: number | null;
  readonly previousCredentialId?: string | null;
  readonly previousCredentialGeneration?: number | null;
  readonly trustedTimeUsed?: Date;
  readonly overlapEndsAt?: Date | null;
  readonly credentialAction?: string;
  readonly providerKeyAction?: string;
  readonly reason?: string;
  readonly replayOutcome?: string;
  readonly lifecycleExecutionId?: string;
  /** Present when destruction was evaluated. Never a permission by itself. */
  readonly destructionEligibility?: KeyDestructionEligibility;
  readonly refusalCode?: LifecycleRefusalCode;
  readonly detail?: string;
}

/**
 * Whether the previous key COULD be destroyed, and whether anyone is allowed to.
 *
 * The two are separate on purpose. "Nothing references this key any more" is a
 * fact about the fleet; "a key may be destroyed after N days" is an owner
 * decision that does not exist. Eligibility without authorization is not
 * permission, and the shape says so.
 */
export interface KeyDestructionEligibility {
  readonly providerKeyReference: string | null;
  readonly eligible: boolean;
  readonly authorized: boolean;
  readonly blockers: readonly string[];
  readonly policyReference: string | null;
  readonly requiredOwnerDecision: string | null;
}

// ---------------------------------------------------------------------------
// Overlap
// ---------------------------------------------------------------------------

/**
 * HALF-OPEN. Usable while `trustedNow < overlapEndsAt`; spent at and after it.
 *
 * The one place this comparison is written in TypeScript. Everything else calls
 * it, so the boundary cannot drift between the verifier and the lifecycle.
 */
export function overlapIsActive(overlapEndsAt: Date | null, trustedNow: Date): boolean {
  if (overlapEndsAt === null) return false;
  return trustedNow.getTime() < overlapEndsAt.getTime();
}

/**
 * Builds the verifier's overlap grant from AUTHORITATIVE state.
 *
 * Returns null unless there really is a previous generation, it is exactly one
 * behind the head, it is still `issued`, and the window is still open. A
 * caller cannot assemble this itself without the rows — which is the point.
 */
export function permittedOverlapFrom(
  state: ObservedLifecycleState,
  trustedNow: Date,
): CredentialOverlap | null {
  const previous = state.previousCredential;
  if (previous === null || state.headPreviousGeneration === null) return null;
  if (!overlapIsActive(state.overlapEndsAt, trustedNow)) return null;
  // EXACTLY the immediately previous generation. A gap is not an overlap.
  if (previous.certificateGeneration !== state.headGeneration - 1) return null;
  if (previous.certificateGeneration !== state.headPreviousGeneration) return null;
  return {
    previousGeneration: previous.certificateGeneration,
    previousKeyFingerprint: previous.publicKeyFingerprint,
    overlapEndsAt: state.overlapEndsAt as Date,
    previousCredentialState: previous.state,
  };
}

// ---------------------------------------------------------------------------
// Destruction eligibility
// ---------------------------------------------------------------------------

/**
 * Evaluates whether the PREVIOUS key could be destroyed — and separately,
 * whether anyone is authorized to.
 *
 * The first blocker checked is the one that matters most: a key the CURRENT
 * credential attests to is never destruction-eligible, whatever else is true.
 * Under `reuse_current_key` the previous and current credentials share a key,
 * so without this a routine same-key renewal would nominate the device's only
 * working key for destruction.
 */
export function evaluateKeyDestruction(state: ObservedLifecycleState): KeyDestructionEligibility {
  const blockers: string[] = [];
  const previousKey = state.previousKey;
  const policy = state.destructionPolicy;

  if (previousKey === null) {
    blockers.push("no previous provider key is recorded");
  }

  // THE INVARIANT. A key backing the current credential is never eligible.
  if (
    previousKey !== null &&
    state.currentCredential !== null &&
    state.currentCredential.publicKeyFingerprint === previousKey.publicKeyFingerprint
  ) {
    blockers.push("the key still backs the CURRENT credential (same-key renewal)");
  }
  if (
    previousKey !== null &&
    state.currentKey !== null &&
    state.currentKey.publicKeyFingerprint === previousKey.publicKeyFingerprint
  ) {
    blockers.push("the key is the device's current provider key");
  }

  if (previousKey !== null && previousKey.state === "active") {
    blockers.push(`the provider key is still ${previousKey.state}`);
  }
  if (previousKey !== null && previousKey.state === "destroyed") {
    blockers.push("the provider key is already destroyed");
  }

  const stillReferencing = state.retention.referencingCredentialIds.filter(
    (id) => id !== state.previousCredential?.credentialId,
  );
  if (stillReferencing.length > 0) {
    blockers.push(`${stillReferencing.length} other credential(s) still attest to this key`);
  }
  if (state.retention.unfinishedIssuanceCount > 0) {
    blockers.push(`${state.retention.unfinishedIssuanceCount} unfinished issuance attempt(s)`);
  }
  if (state.retention.openRenewalCount > 0) {
    blockers.push(`${state.retention.openRenewalCount} open renewal reservation(s)`);
  }
  if (state.retention.activationPendingCount > 0) {
    blockers.push(`${state.retention.activationPendingCount} key(s) awaiting provider activation`);
  }
  if (state.retention.openReconciliationCount > 0) {
    blockers.push(`${state.retention.openReconciliationCount} unresolved reconciliation(s)`);
  }
  if (state.retention.manualReviewOutstanding) {
    blockers.push("an unresolved provider/database divergence is under manual review");
  }

  // The previous credential must actually be retired first.
  if (state.previousCredential !== null && state.previousCredential.state === "issued") {
    blockers.push("the previous credential has not been retired yet");
  }

  const eligible = blockers.length === 0;

  // AUTHORIZATION is a separate question, and today the answer is always no.
  const authorized =
    policy.destructionEnabled &&
    policy.approvedByDecisionRef !== null &&
    policy.minimumRetentionDays !== null &&
    policy.recoveryRetentionDays !== null;

  return {
    providerKeyReference: previousKey?.providerKeyReference ?? null,
    eligible,
    authorized,
    blockers,
    policyReference: policy.approvedByDecisionRef,
    requiredOwnerDecision: policy.requiredOwnerDecision,
  };
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Advances one device's credential lifecycle by at most one step.
 *
 * The caller supplies no verdict of any kind — not whether the overlap expired,
 * not a state transition, not a destruction decision. Every one of those is
 * derived from authoritative state and trusted time.
 */
export async function advanceDeviceCredentialLifecycle(
  input: LifecycleInput,
  reader: LifecycleReader,
  gateway: LifecycleGateway,
): Promise<LifecycleOutcome> {
  const base = {
    deviceRecordId: input.deviceRecordId,
    environment: input.environment,
    purpose: input.purpose,
  };

  // 1. TRUSTED TIME, before anything reads a row.
  if (isRestricted(input.trustedTime.status) || input.trustedTime.trustedTime === null) {
    return {
      ...base,
      outcome: "REFUSED",
      refusalCode: "LIFECYCLE_NO_TRUSTED_TIME",
      detail: `no trusted time is established (status ${input.trustedTime.status})`,
    };
  }
  const trustedNow = input.trustedTime.trustedTime;

  const state = await reader.loadLifecycleState(base);
  if (state === null) {
    return {
      ...base,
      outcome: "REFUSED",
      refusalCode: "LIFECYCLE_NO_HEAD",
      detail: "no credential head exists for this device, environment and purpose",
    };
  }
  if (
    state.deviceRecordId !== input.deviceRecordId ||
    state.environment !== input.environment ||
    state.purpose !== input.purpose
  ) {
    return {
      ...base,
      outcome: "REFUSED",
      refusalCode: "LIFECYCLE_WRONG_SCOPE",
      detail: "the loaded lifecycle state is for another device, environment or purpose",
    };
  }

  const decision = classifyLifecycle(state, trustedNow);
  const eligibility =
    decision.classification === "OVERLAP_EXPIRED" ||
    decision.classification === "PREVIOUS_CREDENTIAL_RETIRED" ||
    decision.classification === "KEY_STILL_REFERENCED" ||
    decision.classification === "KEY_DESTRUCTION_NOT_AUTHORIZED"
      ? evaluateKeyDestruction(state)
      : undefined;

  const record = async (
    outcome: LifecycleOutcome,
    classification: LifecycleClassification,
    credentialTransition: string,
    providerKeyTransition: string,
    replayOutcome: string,
    providerResult: string | null = null,
    databaseConfirmationResult: string | null = null,
  ): Promise<LifecycleOutcome> => {
    try {
      const { lifecycleExecutionId } = await gateway.recordLifecycleEvent({
        ...base,
        trustedTime: trustedNow,
        trustedTimeSource: input.trustedTime.source,
        trustedTimeStatus: input.trustedTime.status,
        currentCredentialId: state.currentCredential?.credentialId ?? null,
        currentCredentialGeneration: state.currentCredential?.certificateGeneration ?? null,
        previousCredentialId: state.previousCredential?.credentialId ?? null,
        previousCredentialGeneration: state.previousCredential?.certificateGeneration ?? null,
        overlapEndsAt: state.overlapEndsAt,
        classification,
        credentialTransition,
        providerKeyTransition,
        destructionPolicyReference:
          eligibility?.policyReference ?? eligibility?.requiredOwnerDecision ?? null,
        providerResult,
        databaseConfirmationResult,
        reason: decision.reason,
        replayOutcome,
        actorRef: input.actorRef,
      });
      return { ...outcome, lifecycleExecutionId };
    } catch (error) {
      // The audit is the evidence. A lifecycle advancement nobody can explain
      // afterwards is not a success.
      return {
        ...outcome,
        outcome: "REFUSED",
        refusalCode: "LIFECYCLE_ACTION_FAILED",
        detail: `the lifecycle advancement could not be recorded: ${errorText(error)}`,
      };
    }
  };

  const common = {
    ...base,
    classification: decision.classification,
    currentCredentialId: state.currentCredential?.credentialId ?? null,
    currentCredentialGeneration: state.currentCredential?.certificateGeneration ?? null,
    previousCredentialId: state.previousCredential?.credentialId ?? null,
    previousCredentialGeneration: state.previousCredential?.certificateGeneration ?? null,
    trustedTimeUsed: trustedNow,
    overlapEndsAt: state.overlapEndsAt,
    reason: decision.reason,
    destructionEligibility: eligibility,
  };

  if (!decision.automatic) {
    return record(
      {
        ...common,
        outcome: "REFUSED",
        refusalCode: "LIFECYCLE_MANUAL_REVIEW",
        detail: decision.reason,
        credentialAction: "none",
        providerKeyAction: "none",
        replayOutcome: "not-replayed",
      },
      decision.classification,
      "none",
      "none",
      "not-replayed",
    );
  }

  // -- NOTHING TO DO -------------------------------------------------------
  if (
    decision.classification === "NO_ACTION_CURRENT" ||
    decision.classification === "OVERLAP_ACTIVE"
  ) {
    return record(
      {
        ...common,
        outcome: "NO_ACTION",
        credentialAction: "none",
        providerKeyAction:
          decision.classification === "OVERLAP_ACTIVE"
            ? "none — the previous key must survive the overlap"
            : "none",
        replayOutcome: "no-action",
      },
      decision.classification,
      "none",
      "none",
      "no-action",
    );
  }

  // -- ALREADY RETIRED: report destruction eligibility ----------------------
  if (
    decision.classification === "KEY_STILL_REFERENCED" ||
    decision.classification === "KEY_DESTRUCTION_NOT_AUTHORIZED"
  ) {
    return record(
      {
        ...common,
        outcome: "REPLAYED",
        credentialAction: "none — the previous credential is already retired",
        providerKeyAction:
          decision.classification === "KEY_STILL_REFERENCED"
            ? "retained — still referenced"
            : "retained — destruction is not authorized",
        replayOutcome: "replayed",
      },
      decision.classification,
      "none",
      "retained",
      "replayed",
    );
  }

  // -- RETIRE THE PREVIOUS CREDENTIAL --------------------------------------
  let retirement: { outcome: string; previousCredentialId?: string };
  try {
    retirement = await gateway.retireOverlappedCredential({
      ...base,
      trustedTime: trustedNow,
      trustedTimeStatus: input.trustedTime.status,
      actorRef: input.actorRef,
    });
  } catch (error) {
    return record(
      {
        ...common,
        outcome: "REFUSED",
        refusalCode: "LIFECYCLE_ACTION_FAILED",
        detail: errorText(error),
        credentialAction: "retire previous credential",
        providerKeyAction: "none",
        replayOutcome: "not-replayed",
      },
      decision.classification,
      "retire previous credential",
      "none",
      "not-replayed",
      null,
      errorText(error),
    );
  }

  const replayed = retirement.outcome === "ALREADY_RETIRED";
  return record(
    {
      ...common,
      classification: "PREVIOUS_CREDENTIAL_RETIRED",
      outcome: replayed ? "REPLAYED" : "ADVANCED",
      credentialAction: `previous credential ${replayed ? "was already" : "is now"} superseded`,
      // NOTHING is destroyed here, whatever the eligibility says. Eligibility
      // is a fact; destruction needs an owner decision that does not exist.
      providerKeyAction: "retained — destruction requires an owner decision",
      replayOutcome: replayed ? "replayed" : "executed",
    },
    "PREVIOUS_CREDENTIAL_RETIRED",
    `previous credential ${replayed ? "already" : "now"} superseded`,
    "retained",
    replayed ? "replayed" : "executed",
    null,
    retirement.outcome,
  );
}

interface LifecycleDecision {
  readonly classification: LifecycleClassification;
  readonly reason: string;
  readonly automatic: boolean;
}

/**
 * The lifecycle decision table. Ordered most-specific first, failing closed.
 *
 * Divergence is checked before progress, for the same reason the reconciler
 * does it: a state nobody predicted must not be mistaken for a step forward.
 */
export function classifyLifecycle(
  state: ObservedLifecycleState,
  trustedNow: Date,
): LifecycleDecision {
  const human = (reason: string, classification: LifecycleClassification): LifecycleDecision => ({
    classification,
    reason,
    automatic: false,
  });

  // -- Divergence ----------------------------------------------------------
  if (state.currentCredential === null) {
    return human(
      `the head names generation ${state.headGeneration} and no credential exists there; the lifecycle cannot advance against a head that points at nothing`,
      "INCONSISTENT_STATE",
    );
  }
  if (state.currentCredential.certificateGeneration !== state.headGeneration) {
    return human(
      `the current credential is generation ${state.currentCredential.certificateGeneration} and the head says ${state.headGeneration}`,
      "INCONSISTENT_STATE",
    );
  }
  if (state.currentCredential.state !== "issued") {
    return human(
      `the CURRENT credential is ${state.currentCredential.state}; retiring a previous generation while the current one is not issued would leave the device with nothing`,
      "MANUAL_REVIEW_REQUIRED",
    );
  }
  if (state.headPreviousGeneration !== null && state.previousCredential === null) {
    return human(
      `the head names previous generation ${state.headPreviousGeneration} and no credential exists there`,
      "INCONSISTENT_STATE",
    );
  }
  if (
    state.previousCredential !== null &&
    state.previousCredential.certificateGeneration >= state.headGeneration
  ) {
    return human("the previous generation is not behind the head", "INCONSISTENT_STATE");
  }
  if (state.retention.manualReviewOutstanding) {
    return human(
      "an unresolved provider/database divergence is under manual review; the lifecycle does not advance past a state a human has not dispositioned",
      "MANUAL_REVIEW_REQUIRED",
    );
  }

  // -- No overlap at all ---------------------------------------------------
  if (state.headPreviousGeneration === null || state.previousCredential === null) {
    return {
      classification: "NO_ACTION_CURRENT",
      reason:
        "the head records no previous generation, so there is no overlap to expire and nothing to retire",
      automatic: true,
    };
  }

  // -- Overlap still running ------------------------------------------------
  if (overlapIsActive(state.overlapEndsAt, trustedNow)) {
    return {
      classification: "OVERLAP_ACTIVE",
      reason: `the §5 overlap runs until ${state.overlapEndsAt?.toISOString()}; both generations are legitimately usable and the previous key must survive it`,
      automatic: true,
    };
  }

  // -- Overlap over --------------------------------------------------------
  if (state.previousCredential.state === "issued") {
    return {
      classification: "OVERLAP_EXPIRED",
      reason: `trusted time is at or past ${state.overlapEndsAt?.toISOString()}; the previous credential must be retired so it can no longer authenticate`,
      automatic: true,
    };
  }

  // Already retired — the remaining question is only about the key.
  const eligibility = evaluateKeyDestruction(state);
  if (!eligibility.eligible) {
    return {
      classification: "KEY_STILL_REFERENCED",
      reason: `the previous credential is ${state.previousCredential.state} and the key is retained: ${eligibility.blockers.join("; ")}`,
      automatic: true,
    };
  }
  return {
    classification: "KEY_DESTRUCTION_NOT_AUTHORIZED",
    reason: `nothing references the previous key any more, but destruction is not authorized: ${eligibility.requiredOwnerDecision ?? "no owner decision governs private-key retention"}. Eligibility is a fact about the fleet; permission is an owner decision, and the two are not the same.`,
    automatic: true,
  };
}
