/**
 * Governed provider-key destruction — WS-11-T003 Step 4, the TypeScript side of
 * migration group 0137.
 *
 * Authority: KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 (KLREQ-031, owner-
 * approved 2026-07-29 as written); migration group 0137.
 *
 * ===========================================================================
 * THE ORDERING IS THE WHOLE CONTROL
 * ===========================================================================
 * The database may mark a key destroyed ONLY after the provider has produced
 * evidence that it destroyed one. Every other ordering permits the same
 * failure: a row that says a private key is gone while the private key is
 * still loaded somewhere, which is worse than no record at all because it
 * stops anyone looking.
 *
 * So this module never confirms on:
 *
 *   provider returned NOT FOUND        absence is not erasure
 *   the call timed out                 nobody knows what happened
 *   the connection failed              nobody knows what happened
 *   the process crashed                nobody knows what happened
 *   the key is missing from a cache    a cache is not the provider
 *   the retry budget expired           running out of patience is not evidence
 *
 * Each of those leaves the database NON-DESTROYED and routes the request to
 * reconciliation or manual review. `confirm_key_destruction_v1` accepts only
 * `DESTROYED` and `ALREADY_DESTROYED`, and this module never synthesises
 * either one.
 *
 * ===========================================================================
 * THIS MODULE DECIDES NOTHING THE DATABASE DECIDES
 * ===========================================================================
 * Retention windows, holds, four-eyes, approval expiry, attempt counting and
 * the terminal state are group 0137's work and are not re-implemented here. A
 * second policy engine in front of the real one is how the two drift, and the
 * weaker of two policy engines is the one that decides.
 *
 * What happens here is narrower:
 *
 *   - refuse requests that are wrong on their face BEFORE a governed call is
 *     made and before an approval could be consumed;
 *   - carry out the ONE step the database cannot do — calling the provider —
 *     in the correct order, and re-check every binding before it does;
 *   - report the governed outcome faithfully, including the outcomes that are
 *     not successes.
 */

import type {
  ProviderDestructionReceipt,
  ProviderDestructionRequest,
} from "./replacement-key-provider.js";
import {
  ProviderDestructionAmbiguousError,
  ReplacementKeyError,
} from "./replacement-key-provider.js";

// ---------------------------------------------------------------------------
// The governed vocabulary, mirrored exactly
// ---------------------------------------------------------------------------

/**
 * `kitluy_devices.key_hold_type`, mirrored EXACTLY — same spelling, same case,
 * same four members, in the migration's order.
 *
 * The first version of this type said `"INCIDENT" | "LEGAL" | "AUDIT"`. Every
 * one of those was wrong in a way that only shows up against a real database:
 * the enum labels are lower case, `AUDIT` is actually `audit_preservation`, and
 * `regulatory` was missing altogether — so a regulatory hold, which KLREQ-031
 * says suspends eligibility, execution, approval use and retry, could not even
 * be NAMED from TypeScript. A value from that union would have been rejected by
 * the enum cast, which is fail-closed and therefore survivable, but a hold type
 * nobody can express is a hold nobody can place.
 *
 * NOT YET GUARDED BY A TEST. A live conformance check against `pg_enum` is the
 * right guard and does not exist: nothing here fails if the enum changes again.
 * The values below were read from `pg_enum` on the development database on
 * 2026-07-29 and are correct as of migration group 0137; treat them as a
 * transcription until that check is written.
 */
export type KeyHoldType = "incident" | "legal" | "regulatory" | "audit_preservation";

export const KEY_HOLD_TYPES: readonly KeyHoldType[] = [
  "incident",
  "legal",
  "regulatory",
  "audit_preservation",
] as const;

/**
 * Outcomes this module can report.
 *
 * `RECONCILIATION_REQUIRED` is NOT a database outcome — group 0137 has no such
 * word. It is this module's answer to the one situation only the caller of the
 * provider can observe: the provider was asked, and did not say. It is kept
 * distinct from `MANUAL_REVIEW_REQUIRED` because the remedies differ — an
 * ambiguous outcome is re-askable, a refused one is not.
 */
export type KeyDestructionOutcomeCode =
  | "DESTROYED"
  | "ALREADY_DESTROYED"
  | "ALREADY_CONFIRMED"
  | "DESTRUCTION_REFUSED"
  | "RECONCILIATION_REQUIRED"
  | "MANUAL_REVIEW_REQUIRED";

/** The refusal codes THIS module decides, before any governed call is made. */
export type KeyDestructionRefusalCode =
  | "DESTRUCTION_NO_REQUEST_KEY"
  | "DESTRUCTION_NO_REQUESTER"
  | "DESTRUCTION_NO_APPROVER"
  | "DESTRUCTION_NO_REASON"
  | "DESTRUCTION_NO_KEY_REFERENCE"
  | "DESTRUCTION_SELF_APPROVED"
  | "DESTRUCTION_NOT_REAUTHENTICATED"
  | "DESTRUCTION_PROVIDER_BINDING_CHANGED"
  | "DESTRUCTION_PROVIDER_REFUSED"
  | "DESTRUCTION_PROVIDER_AMBIGUOUS"
  | "DESTRUCTION_UNVERIFIED_EVIDENCE"
  | "DESTRUCTION_GATEWAY_FAILED"
  | "DESTRUCTION_UNKNOWN_OUTCOME";

/**
 * The result of a destruction step.
 *
 * `refusalCode` is typed `string` for the same reason it is on
 * {@link import("./credential-revocation.js").RevocationOutcome}: the refusal
 * vocabulary belongs to the database, and rewriting one of its refusals into
 * one of ours turns it into a different refusal.
 */
export interface KeyDestructionOutcome {
  readonly outcome: KeyDestructionOutcomeCode;
  readonly refusalCode?: string;
  readonly detail?: string;
  readonly destructionRequestId?: string | null;
  readonly attemptNumber?: number | null;
  readonly providerResult?: string | null;
  readonly providerReceiptDigest?: string | null;
  readonly providerResponseRef?: string | null;
  /**
   * Redacted CLASS of a provider failure. Never a provider payload, never a
   * key, never a secret — KLREQ-031 forbids either reaching the database, the
   * logs or an audit event.
   */
  readonly errorClassification?: string | null;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export interface EligibilityCall {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly providerKeyReference: string;
  readonly trustedNow: string;
  readonly trustedTimeStatus: string;
}

export interface DestructionRequestCall {
  readonly requestKey: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly providerKeyReference: string;
  readonly requestedBy: string;
  readonly requestReason: string;
  readonly reauthenticated: boolean;
  readonly trustedNow: string;
  readonly trustedTimeStatus: string;
}

export interface DestructionApprovalCall {
  readonly destructionRequestId: string;
  readonly approvedBy: string;
  readonly approvalReason: string;
  readonly reauthenticated: boolean;
  readonly trustedNow: string;
  readonly trustedTimeStatus: string;
}

export interface DestructionExecutionCall {
  readonly destructionRequestId: string;
  readonly executedBy: string;
}

export interface DestructionConfirmationCall {
  readonly destructionRequestId: string;
  readonly providerResult: string;
  readonly providerReceiptDigest: string;
  readonly providerResponseRef: string;
  readonly observedFingerprint: string;
  readonly observedKeyReference: string;
  readonly executedBy: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}

/**
 * The database port. One method per governed function and NOTHING else.
 *
 * There is deliberately no method that writes `device_keys.state`, inserts a
 * destruction attempt, or releases a hold outside `release_key_hold_v1`. Group
 * 0137 grants EXECUTE on the functions and withholds the underlying writes; a
 * convenience method here would be a second path to the same rows that skips
 * the retention window, the holds and the four-eyes gate.
 */
export interface KeyDestructionGateway {
  evaluateEligibility(call: EligibilityCall): Promise<Record<string, unknown>>;
  requestKeyDestruction(call: DestructionRequestCall): Promise<Record<string, unknown>>;
  approveKeyDestruction(call: DestructionApprovalCall): Promise<Record<string, unknown>>;
  beginKeyDestructionExecution(call: DestructionExecutionCall): Promise<Record<string, unknown>>;
  confirmKeyDestruction(call: DestructionConfirmationCall): Promise<Record<string, unknown>>;
}

/** The provider port. One method. It erases, and it produces evidence. */
export interface ProviderKeyDestroyer {
  destroyProviderKey(request: ProviderDestructionRequest): Promise<ProviderDestructionReceipt>;
}

// ---------------------------------------------------------------------------
// Pre-flight refusals
// ---------------------------------------------------------------------------

function blank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function refuse(code: KeyDestructionRefusalCode, detail: string): KeyDestructionOutcome {
  return { outcome: "DESTRUCTION_REFUSED", refusalCode: code, detail };
}

/**
 * Opens a governed destruction request.
 *
 * The pre-flight refusals here are the ones that are wrong on their FACE. They
 * are checked before the governed call so a malformed request never reaches
 * the point where it could consume anything.
 */
export async function requestProviderKeyDestruction(
  gateway: KeyDestructionGateway,
  call: DestructionRequestCall,
): Promise<KeyDestructionOutcome> {
  if (blank(call.requestKey)) {
    return refuse("DESTRUCTION_NO_REQUEST_KEY", "a destruction request needs a stable request key");
  }
  if (blank(call.requestedBy)) {
    return refuse("DESTRUCTION_NO_REQUESTER", "a destruction request needs a named requester");
  }
  if (blank(call.requestReason)) {
    return refuse("DESTRUCTION_NO_REASON", "KLREQ-031 §requires a reason on every request");
  }
  if (blank(call.providerKeyReference)) {
    return refuse("DESTRUCTION_NO_KEY_REFERENCE", "a destruction request names one provider key");
  }
  // KLREQ-031: re-authentication is REQUIRED. Refused here as well as in the
  // database so a caller cannot discover it only after a row exists.
  if (call.reauthenticated !== true) {
    return refuse(
      "DESTRUCTION_NOT_REAUTHENTICATED",
      "KLREQ-031 requires re-authentication to request a key destruction",
    );
  }
  return interpret(await guarded(() => gateway.requestKeyDestruction(call)));
}

/**
 * Approves a governed destruction request.
 *
 * The requester/approver split is checked in the DATABASE, which is the only
 * place that knows who requested it. What is checked here is the pair the
 * caller itself supplied, so an obviously self-approved call is refused before
 * it is made — belt and braces, with the database as the braces.
 */
export async function approveProviderKeyDestruction(
  gateway: KeyDestructionGateway,
  call: DestructionApprovalCall,
  requestedBy?: string,
): Promise<KeyDestructionOutcome> {
  if (blank(call.approvedBy)) {
    return refuse("DESTRUCTION_NO_APPROVER", "an approval needs a named approver");
  }
  if (blank(call.approvalReason)) {
    return refuse("DESTRUCTION_NO_REASON", "KLREQ-031 requires a reason on every approval");
  }
  if (call.reauthenticated !== true) {
    return refuse(
      "DESTRUCTION_NOT_REAUTHENTICATED",
      "KLREQ-031 requires re-authentication to approve a key destruction",
    );
  }
  if (requestedBy !== undefined && requestedBy.trim() === call.approvedBy.trim()) {
    return refuse(
      "DESTRUCTION_SELF_APPROVED",
      "KLREQ-031 four eyes: the requester of a destruction may not approve it",
    );
  }
  return interpret(await guarded(() => gateway.approveKeyDestruction(call)));
}

// ---------------------------------------------------------------------------
// Execution — the ordered step
// ---------------------------------------------------------------------------

/** What the caller believes about the key, re-checked against the provider. */
export interface DestructionExecutionInput {
  readonly destructionRequestId: string;
  readonly executedBy: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  /** The CURRENT provider reference, as the database holds it. */
  readonly providerKeyReference: string;
  /** The CURRENT fingerprint, as the database holds it. */
  readonly publicKeyFingerprint: string;
  readonly keyGeneration: number;
}

/**
 * Executes ONE destruction attempt, in the only safe order.
 *
 *   1. `begin_key_destruction_execution_v1` — the database re-checks eligibility,
 *      retention, holds, the approval and the attempt budget, and records that
 *      an attempt is starting. If it refuses, the provider is never called.
 *   2. the PROVIDER is called, and must produce a receipt.
 *   3. the receipt is re-checked against the bindings that were approved.
 *   4. ONLY THEN `confirm_key_destruction_v1`.
 *
 * Steps 2 and 4 are never reordered and step 4 never runs without step 2's
 * evidence. Every failure between them leaves the database non-destroyed,
 * which is the state that is safe to be wrong about.
 */
export async function executeProviderKeyDestruction(
  gateway: KeyDestructionGateway,
  provider: ProviderKeyDestroyer,
  input: DestructionExecutionInput,
): Promise<KeyDestructionOutcome> {
  // ---- 1. the database decides whether an attempt may start at all --------
  const begun = await guarded(() =>
    gateway.beginKeyDestructionExecution({
      destructionRequestId: input.destructionRequestId,
      executedBy: input.executedBy,
    }),
  );
  // `EXECUTION_CLEARED` is the ONLY answer that permits the provider to be
  // called. Everything else — EXECUTION_REFUSED (not approved, approval
  // expired, hold active, attempts exhausted) and ALREADY_EXECUTED — is
  // returned untouched, and the provider is never asked. A default that fell
  // through to the call would turn every unrecognised answer into permission.
  const beginOutcome = readString(begun, "outcome");
  if (beginOutcome !== "EXECUTION_CLEARED") {
    return interpret(begun);
  }
  const attemptNumber = readNumber(begun, "attempt_number");
  const startedAt = new Date();

  // ---- 2. the provider, which is the only party that can actually erase ---
  let receipt: ProviderDestructionReceipt;
  try {
    receipt = await provider.destroyProviderKey({
      destructionRequestId: input.destructionRequestId,
      providerKeyReference: input.providerKeyReference,
      publicKeyFingerprint: input.publicKeyFingerprint,
      keyGeneration: input.keyGeneration,
      deviceRecordId: input.deviceRecordId,
      environment: input.environment,
      purpose: input.purpose,
    });
  } catch (error) {
    if (error instanceof ProviderDestructionAmbiguousError) {
      // The provider was asked and did not say. NOT a destruction, NOT a
      // refusal. The database stays non-destroyed and a human reconciles.
      return {
        outcome: "RECONCILIATION_REQUIRED",
        refusalCode: "DESTRUCTION_PROVIDER_AMBIGUOUS",
        detail:
          "the provider did not report an outcome; the key is NOT confirmed destroyed and must be reconciled",
        destructionRequestId: input.destructionRequestId,
        attemptNumber,
        errorClassification: error.classification,
      };
    }
    if (error instanceof ReplacementKeyError) {
      // A binding the provider re-checked did not match — a changed reference,
      // fingerprint, generation, device or environment. Fail closed: this is
      // the check that stops the WRONG private key being erased.
      return {
        outcome: "DESTRUCTION_REFUSED",
        refusalCode: "DESTRUCTION_PROVIDER_BINDING_CHANGED",
        detail: `the provider refused the destruction (${error.code})`,
        destructionRequestId: input.destructionRequestId,
        attemptNumber,
        errorClassification: error.code,
      };
    }
    return {
      outcome: "DESTRUCTION_REFUSED",
      refusalCode: "DESTRUCTION_PROVIDER_REFUSED",
      detail: "the provider call failed; the key is NOT confirmed destroyed",
      destructionRequestId: input.destructionRequestId,
      attemptNumber,
      // CLASS only. A provider message could carry a payload, so it is not kept.
      errorClassification: error instanceof Error ? error.name : "UNKNOWN",
    };
  }

  // ---- 3. the evidence must describe the key that was approved ------------
  const evidenceFault = verifyReceiptBindings(receipt, input);
  if (evidenceFault !== null) {
    return {
      outcome: "MANUAL_REVIEW_REQUIRED",
      refusalCode: "DESTRUCTION_UNVERIFIED_EVIDENCE",
      detail: evidenceFault,
      destructionRequestId: input.destructionRequestId,
      attemptNumber,
    };
  }

  // ---- 4. and only now may the database say the key is gone ---------------
  const confirmed = await guarded(() =>
    gateway.confirmKeyDestruction({
      destructionRequestId: input.destructionRequestId,
      providerResult: receipt.result,
      providerReceiptDigest: receipt.receiptDigest,
      providerResponseRef: receipt.responseReference,
      observedFingerprint: receipt.publicKeyFingerprint,
      observedKeyReference: receipt.providerKeyReference,
      executedBy: input.executedBy,
      startedAt: startedAt.toISOString(),
      finishedAt: receipt.completedAt.toISOString(),
    }),
  );

  const outcome = interpret(confirmed);
  return {
    ...outcome,
    destructionRequestId: input.destructionRequestId,
    attemptNumber,
    providerResult: receipt.result,
    providerReceiptDigest: receipt.receiptDigest,
    providerResponseRef: receipt.responseReference,
  };
}

/**
 * Re-checks the receipt against what was approved.
 *
 * The provider already re-checked its own bindings; this checks that the
 * ANSWER describes the same key. A provider that erased something and reported
 * a different reference or fingerprint has either a bug or a routing fault, and
 * either way the database must not record that the approved key is gone.
 */
function verifyReceiptBindings(
  receipt: ProviderDestructionReceipt,
  input: DestructionExecutionInput,
): string | null {
  if (receipt.providerKeyReference !== input.providerKeyReference) {
    return "the provider receipt names a different provider key reference than the one approved";
  }
  if (receipt.publicKeyFingerprint !== input.publicKeyFingerprint) {
    return "the provider receipt names a different public-key fingerprint than the one approved";
  }
  if (receipt.keyGeneration !== input.keyGeneration) {
    return "the provider receipt names a different key generation than the one approved";
  }
  if (receipt.result !== "DESTROYED" && receipt.result !== "ALREADY_DESTROYED") {
    return `the provider returned ${String(receipt.result)}, which is not an accepted destruction result`;
  }
  if (blank(receipt.receiptDigest) || blank(receipt.responseReference)) {
    return "the provider returned no receipt digest or response reference, so there is no evidence to confirm on";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Outcome interpretation
// ---------------------------------------------------------------------------

const KNOWN_OUTCOMES: ReadonlySet<string> = new Set<string>([
  "DESTROYED",
  "ALREADY_DESTROYED",
  "ALREADY_CONFIRMED",
  "DESTRUCTION_REFUSED",
  "MANUAL_REVIEW_REQUIRED",
  "RECONCILIATION_REQUIRED",
  // Group 0137's non-terminal step outcomes, passed through rather than
  // rewritten. A caller that receives one has not destroyed anything.
  "REQUESTED",
  "ALREADY_REQUESTED",
  "APPROVED",
  "ALREADY_APPROVED",
  "APPROVAL_REFUSED",
  "REQUEST_REFUSED",
  "EXECUTION_CLEARED",
  "EXECUTION_REFUSED",
  "ALREADY_EXECUTED",
  "ELIGIBLE",
  "NOT_ELIGIBLE",
]);

function readString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

function readNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === "number" ? value : null;
}

/**
 * Converts a governed jsonb answer into an outcome WITHOUT improving on it.
 *
 * An unrecognised outcome is a refusal, never a success. A gateway that starts
 * returning a word this module has never heard of is a gateway that changed
 * underneath it, and guessing what the new word meant is how a refusal becomes
 * an approval.
 */
function interpret(row: Record<string, unknown>): KeyDestructionOutcome {
  const outcome = readString(row, "outcome");
  if (outcome === null || !KNOWN_OUTCOMES.has(outcome)) {
    return {
      outcome: "DESTRUCTION_REFUSED",
      refusalCode: "DESTRUCTION_UNKNOWN_OUTCOME",
      detail: `the governed destruction returned an unrecognised outcome (${String(outcome)})`,
    };
  }
  const mapped: KeyDestructionOutcomeCode =
    outcome === "DESTROYED" ||
    outcome === "ALREADY_DESTROYED" ||
    outcome === "ALREADY_CONFIRMED" ||
    outcome === "MANUAL_REVIEW_REQUIRED" ||
    outcome === "RECONCILIATION_REQUIRED"
      ? outcome
      : // Everything else — refusals, and the step outcomes that mean progress
        // rather than destruction — is NOT a destruction. They are surfaced as
        // refusals of the DESTRUCTION question, carrying the governed word in
        // `detail` so no caller has to guess which one it received.
        "DESTRUCTION_REFUSED";

  return {
    outcome: mapped,
    refusalCode: readString(row, "refusal_code") ?? undefined,
    detail: readString(row, "detail") ?? outcome,
    destructionRequestId: readString(row, "destruction_request_id"),
    attemptNumber: readNumber(row, "attempt_number"),
    providerResult: readString(row, "provider_result"),
  };
}

/**
 * Runs a gateway call and converts a THROWN failure into a refusal.
 *
 * A gateway that throws has not destroyed anything, so the safe reading is
 * always "not destroyed" — never "probably fine".
 */
async function guarded(
  call: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  try {
    return await call();
  } catch (error) {
    return {
      outcome: "DESTRUCTION_REFUSED",
      refusal_code: "DESTRUCTION_GATEWAY_FAILED",
      detail: `the governed destruction call failed (${error instanceof Error ? error.name : "unknown"})`,
    };
  }
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

/**
 * KLREQ-031: maximum execution attempts is 5.
 *
 * Exported as DATA so a worker cannot invent its own budget and a test can
 * assert the number rather than a behaviour that happens to stop.
 */
export const MAX_DESTRUCTION_EXECUTION_ATTEMPTS = 5 as const;

/**
 * Whether another attempt is permitted.
 *
 * Exhausting the budget is NOT a destruction and NOT a failure to record as
 * one: it is a manual-review trigger. The caller that runs out of attempts
 * leaves the key non-destroyed and says so.
 */
export function destructionAttemptPermitted(attemptsSoFar: number): boolean {
  return attemptsSoFar < MAX_DESTRUCTION_EXECUTION_ATTEMPTS;
}

/** KLREQ-031: an approval is valid for 24 hours. */
export const DESTRUCTION_APPROVAL_VALIDITY_HOURS = 24 as const;

/** KLREQ-031 retention windows, as data. */
export const DESTRUCTION_RETENTION_DAYS = {
  /** 30 days after `overlap_ends_at`. */
  superseded: 30,
  /** 7 days after `abandoned_at`. */
  abandoned: 7,
  /** 14 days after the latest verified terminal recovery. */
  recovery: 14,
} as const;
