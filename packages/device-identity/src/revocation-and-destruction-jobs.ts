/**
 * Revocation, recovery disposition and provider-key destruction, expressed as
 * durable jobs.
 *
 * Authority: KLREQ-031 / KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 (destruction);
 * KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 and
 * KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 (revocation finality, the
 * emergency deadline); migration groups 0136-0141.
 *
 * This module is the SECOND adapter between the neutral job runtime
 * (`@kitluy/job-contracts`, group 0135) and the governed device services — the
 * first is `credential-lifecycle-jobs.ts`, whose conventions this file reuses
 * rather than restates. Same `JobHandler`, same `DurableJob`, same
 * `HandlerResult`, same `DiscoveredJobRequest`, same schema version, same
 * attempt bound. A second worker framework would be a second lease model, a
 * second retry ladder and a second set of dispositions, and the one nobody is
 * testing is the one that decides.
 *
 * ===========================================================================
 * WHAT A WORKER IS NOT ALLOWED TO BE
 * ===========================================================================
 * Everything below exists because an automated executor sits next to two
 * irreversible acts — repudiating a credential and erasing a private key — and
 * the tempting shortcuts all have the same shape: the worker supplies something
 * a human was supposed to supply.
 *
 *   a worker never APPROVES         the approval reference is carried in the
 *                                   payload or the job is refused; nothing here
 *                                   can construct, default or infer one
 *   a worker never DESTROYS         there is no provider destroy call in this
 *                                   file; `executeProviderKeyDestruction` owns
 *                                   the ordering and the database owns the gate
 *   a worker never RE-ASKS a        an ambiguous provider outcome becomes a
 *   provider that did not answer    reconcile job and a human, never a retry
 *   a worker never GUESSES          an outcome code no table names is a failure,
 *                                   never a completion
 *   a worker never REVERSES         KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002
 *                                   Ruling 3: every revocation is irreversible
 *
 * ===========================================================================
 * WHICH CLOCK
 * ===========================================================================
 * No handler here takes device trusted time, and that is deliberate. Group 0136
 * records `effective_at` in SERVER time because a repudiation routed through a
 * device's clock lets a device with a manipulated clock postpone its own
 * revocation; group 0138 freezes `post_approval_due_at` in server time for the
 * same reason. Trusted time answers "is this device's view of now believable",
 * which is a different question from "has an operator deadline passed".
 */

import type {
  DurableJob,
  HandlerDisposition,
  HandlerResult,
  JobHandler,
  WorkerIdentity,
} from "@kitluy/job-contracts";

import type { DiscoveredJobRequest } from "./credential-lifecycle-jobs.js";
import { DEVICE_JOB_MAX_ATTEMPTS, DEVICE_JOB_SCHEMA_VERSION } from "./credential-lifecycle-jobs.js";
import type { TrustEnvironment } from "./environments.js";
import { TRUST_ENVIRONMENTS } from "./environments.js";
import type {
  CredentialRecoveryDisposition,
  CredentialRevocationReason,
  RevocationGateway,
  RevocationOutcome,
  RevocationOutcomeCode,
  RevocationRefusalCode,
} from "./credential-revocation.js";
import {
  CREDENTIAL_RECOVERY_DISPOSITIONS,
  CREDENTIAL_REVOCATION_REASONS,
  reasonForbidsNoRecovery,
  recoveryDispositionFor,
  revokeDeviceCredential,
} from "./credential-revocation.js";
import type {
  KeyDestructionGateway,
  KeyDestructionOutcome,
  KeyDestructionOutcomeCode,
  ProviderKeyDestroyer,
} from "./key-destruction.js";
import {
  MAX_DESTRUCTION_EXECUTION_ATTEMPTS,
  executeProviderKeyDestruction,
} from "./key-destruction.js";

// ---------------------------------------------------------------------------
// Job kinds
//
// Versioned in the NAME, exactly as group 0135's first adapter does, so a v2
// with different payload semantics deduplicates separately from v1 instead of
// silently colliding with it.
// ---------------------------------------------------------------------------

export const DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND =
  "kitluy.devices.credential-revocation-execute.v1" as const;

export const DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND =
  "kitluy.devices.credential-recovery-disposition.v1" as const;

export const DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND =
  "kitluy.devices.provider-key-destruction-execute.v1" as const;

export const DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND =
  "kitluy.devices.provider-key-destruction-reconcile.v1" as const;

export const DEVICE_REVOCATION_AND_DESTRUCTION_JOB_KINDS = [
  DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND,
  DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND,
  DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND,
  DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND,
] as const;

/**
 * The tighter of the two budgets governs, and it is computed rather than typed
 * out.
 *
 * The job runtime bounds attempts at {@link DEVICE_JOB_MAX_ATTEMPTS}; KLREQ-031
 * bounds destruction executions at {@link MAX_DESTRUCTION_EXECUTION_ATTEMPTS}.
 * Writing a third number here would let the two drift until a worker kept
 * asking a provider after the owner-approved budget said stop, or gave up
 * before the database had. Taking the minimum means a change to either one is
 * respected without anybody remembering to edit this line.
 */
export const DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS: number = Math.min(
  DEVICE_JOB_MAX_ATTEMPTS,
  MAX_DESTRUCTION_EXECUTION_ATTEMPTS,
);

/**
 * The failure codes these handlers emit, as DATA.
 *
 * Exported so a test can iterate every one and assert how
 * `classifyFailureCode` treats it, rather than asserting the handful someone
 * remembered. None of these appears in `RETRYABLE_FAILURE_CODES`, so the
 * runtime's documented fail-closed default routes each of them to a human —
 * which is the intended reading for every irreversible act in this file.
 */
export const DEVICE_REVOCATION_JOB_FAILURE_CODES = {
  /** The payload carried no approval request id. Rule: a worker never approves. */
  APPROVAL_REFERENCE_ABSENT: "REVOCATION_APPROVAL_REFERENCE_ABSENT",
  /** The payload named no approver. Same rule, other half of the pair. */
  APPROVER_ABSENT: "REVOCATION_APPROVER_ABSENT",
  /** The payload named the WORKER as approver — a synthesised approval. */
  WORKER_SELF_APPROVED: "REVOCATION_WORKER_SELF_APPROVED",
  REVOCATION_REFUSED: "REVOCATION_REFUSED",
  REVOCATION_MANUAL_REVIEW: "REVOCATION_MANUAL_REVIEW_REQUIRED",
  RECOVERY_DOWNGRADED: "RECOVERY_DISPOSITION_DOWNGRADED",
  RECOVERY_MANUAL_REVIEW: "RECOVERY_MANUAL_SECURITY_REVIEW",
  RECOVERY_UNKNOWN_REASON: "RECOVERY_UNKNOWN_REVOCATION_REASON",
  RECOVERY_UNKNOWN_DISPOSITION: "RECOVERY_UNKNOWN_DISPOSITION",
  DESTRUCTION_REFUSED: "DESTRUCTION_REFUSED",
  DESTRUCTION_MANUAL_REVIEW: "DESTRUCTION_MANUAL_REVIEW_REQUIRED",
  /** The provider was asked and did not say. NOT a retry. See Rule 3 below. */
  DESTRUCTION_RECONCILIATION_REQUIRED: "DESTRUCTION_RECONCILIATION_REQUIRED",
  DESTRUCTION_ATTEMPTS_EXHAUSTED: "DESTRUCTION_ATTEMPTS_EXHAUSTED",
  DESTRUCTION_REQUEST_NOT_FOUND: "DESTRUCTION_REQUEST_NOT_FOUND",
  DESTRUCTION_UNKNOWN_REQUEST_STATE: "DESTRUCTION_UNKNOWN_REQUEST_STATE",
  PAYLOAD_INCOMPLETE: "DEVICE_JOB_PAYLOAD_INCOMPLETE",
  ENVIRONMENT_UNRECOGNISED: "DEVICE_JOB_ENVIRONMENT_UNRECOGNISED",
  /** The job named a different device from its subject. Runtime-classified. */
  SCOPE_MISMATCH: "AUTHORIZATION_FAILED",
} as const;

// ---------------------------------------------------------------------------
// Deterministic identity
//
// Every key below is built from AUTHORITATIVE identifiers and nothing else. No
// clock, no random value, no discovery timestamp: replaying a job with the same
// key must collide with the job that already represents that work, because the
// business effect behind each of these keys — a repudiated credential, an
// erased private key — cannot be undone if it happens twice.
// ---------------------------------------------------------------------------

function joinKey(parts: readonly (string | number | null)[]): string {
  return parts.map((p) => (p === null ? "~" : String(p))).join("|");
}

/**
 * Bound to the revocation REQUEST id — the identity of the intent, which is
 * what `credential-revocation.ts` says makes a retry idempotent rather than a
 * second revocation of the same credential.
 *
 * The credential generation is included because it is part of the scope the
 * governed function resolves against. A credential id is deliberately absent
 * here for the same reason it is absent from `RevocationInput`: an id a caller
 * could name is an id a caller could name for ANOTHER DEVICE.
 */
export function credentialRevocationExecuteDedupeKey(input: {
  readonly revocationRequestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly credentialGeneration: number;
}): string {
  return joinKey([
    DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND,
    input.revocationRequestId,
    input.deviceRecordId,
    input.environment,
    input.purpose,
    input.credentialGeneration,
    DEVICE_JOB_SCHEMA_VERSION,
  ]);
}

/** Where a recovery obligation came from. Two id spaces, kept apart. */
export type RecoveryDispositionBasis = "REVOCATION" | "EMERGENCY_POST_APPROVAL_LAPSE";

export const RECOVERY_DISPOSITION_BASES: readonly RecoveryDispositionBasis[] = [
  "REVOCATION",
  "EMERGENCY_POST_APPROVAL_LAPSE",
] as const;

/**
 * Bound to the record the obligation ARISES FROM, plus which record that is.
 *
 * `device_credential_revocations` and `device_credential_emergency_revocations`
 * are separate tables with separate id spaces (group 0138), so the basis is in
 * the key: without it, two unrelated rows that happened to share a uuid would
 * deduplicate into one obligation and one of the two devices would be owed
 * nothing.
 *
 * Note what is NOT here: the emergency post-approval deadline. Ruling 4 of
 * KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 permits a deadline to be
 * SHORTENED, and a key that included the due instant would mint a second
 * escalation for the same emergency every time somebody brought it forward.
 * One emergency, one escalation, however the deadline moves.
 */
export function credentialRecoveryDispositionDedupeKey(input: {
  readonly basis: RecoveryDispositionBasis;
  readonly revocationRecordId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
}): string {
  return joinKey([
    DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND,
    input.basis,
    input.revocationRecordId,
    input.deviceRecordId,
    input.environment,
    input.purpose,
    DEVICE_JOB_SCHEMA_VERSION,
  ]);
}

/**
 * Bound to the destruction REQUEST id.
 *
 * Group 0137 counts attempts against that request and stops at the
 * owner-approved budget. A key that varied per attempt would hand the worker a
 * fresh job — and a fresh attempt budget — every time one ran out, which is the
 * budget deleting itself.
 */
export function providerKeyDestructionExecuteDedupeKey(input: {
  readonly destructionRequestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly providerKeyReference: string;
  readonly keyGeneration: number;
}): string {
  return joinKey([
    DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND,
    input.destructionRequestId,
    input.deviceRecordId,
    input.environment,
    input.providerKeyReference,
    input.keyGeneration,
    DEVICE_JOB_SCHEMA_VERSION,
  ]);
}

/**
 * Bound to the destruction request, and NOT to the attempt that went ambiguous.
 *
 * The open question is "what happened to this key", and there is exactly one of
 * those per request no matter how many attempts ended without an answer. Keying
 * on the attempt would put the same unresolved key in a human's queue three
 * times and invite three separate resolutions of one fact.
 */
export function providerKeyDestructionReconcileDedupeKey(input: {
  readonly destructionRequestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly providerKeyReference: string;
}): string {
  return joinKey([
    DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND,
    input.destructionRequestId,
    input.deviceRecordId,
    input.environment,
    input.providerKeyReference,
    DEVICE_JOB_SCHEMA_VERSION,
  ]);
}

// ---------------------------------------------------------------------------
// The governed destruction-request vocabulary, mirrored exactly
// ---------------------------------------------------------------------------

/** `kitluy_devices.key_destruction_request_status` (group 0137). */
export type KeyDestructionRequestStatus =
  | "requested"
  | "approved"
  | "pending_execution"
  | "executed"
  | "failed"
  | "manual_review"
  | "cancelled"
  | "expired";

export const KEY_DESTRUCTION_REQUEST_STATUSES: readonly KeyDestructionRequestStatus[] = [
  "requested",
  "approved",
  "pending_execution",
  "executed",
  "failed",
  "manual_review",
  "cancelled",
  "expired",
] as const;

/**
 * The statuses at which a worker may ask the database to begin an execution.
 *
 * `requested` is absent: at that point the four-eyes approval has not happened,
 * and a worker that proposed an execution job for it would be proposing work
 * whose only possible next step is asking a human to approve their own queue.
 * The database refuses it anyway — this list stops the job existing.
 */
export const DESTRUCTION_EXECUTABLE_STATUSES: ReadonlySet<KeyDestructionRequestStatus> =
  new Set<KeyDestructionRequestStatus>(["approved", "pending_execution"]);

// ---------------------------------------------------------------------------
// Outcome translation
//
// One table per service, mapping ITS outcome vocabulary onto a job disposition,
// written as DATA rather than branching. A code nobody mapped is then visibly
// absent from a table instead of silently falling into an `else`, and the
// fallback for every table is a FAILURE — never a completion.
// ---------------------------------------------------------------------------

/** A disposition a table may name. `deferred` is excluded on purpose: none of
 * these outcomes means "not due yet"; they mean done, refused or unresolved. */
type JobRouting = Exclude<HandlerDisposition, { readonly kind: "deferred" }>;

function completed(resultCode: string): JobRouting {
  return { kind: "completed", resultCode };
}

function failed(failureCode: string): JobRouting {
  return { kind: "failed", failureCode };
}

/**
 * Looks a code up in a routing table.
 *
 * The unmapped answer is a parameter and every caller passes a FAILURE. A
 * lookup that fell back to a success would turn "the service started returning
 * a word we have never heard" into "it worked", which is the single most
 * expensive way to be wrong about an irreversible act.
 */
function routeCode(
  index: ReadonlyMap<string, JobRouting>,
  code: string,
  unmapped: JobRouting,
): JobRouting {
  return index.get(code) ?? unmapped;
}

const REVOCATION_OUTCOME_ROUTING: Readonly<Record<RevocationOutcomeCode, JobRouting>> = {
  REVOKED: completed("REVOKED"),
  // Not "REVOKED, again". The credential was already repudiated, this attempt
  // added no second effect, and that is precisely what makes replaying a job
  // with the same dedupe key safe. Recorded as a replay, not a fresh success.
  ALREADY_REVOKED: completed("JOB_RESULT_REPLAYED"),
  REVOCATION_REFUSED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_REFUSED),
  // Group 0136 saying a DIFFERENT intent met an already-revoked credential.
  // Flattening it into a success is how a conflict becomes a green tick.
  MANUAL_REVIEW_REQUIRED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_MANUAL_REVIEW),
};

const REVOCATION_OUTCOME_INDEX = new Map<string, JobRouting>(
  Object.entries(REVOCATION_OUTCOME_ROUTING),
);

/**
 * The refusals THIS repository decides, routed by whether repeating the same
 * call could plausibly succeed with nothing else changing.
 *
 * Only one can: a gateway that threw decided nothing, so the credential's state
 * is unchanged and the same idempotent request may be sent again. Every other
 * refusal is a statement about the request itself, and a request that is wrong
 * is still wrong on the sixth attempt.
 *
 * Database-decided refusal codes are deliberately NOT in this table. Their
 * vocabulary belongs to group 0136 (`KLUY-CRED-REVOCATION-RISK-CLASS` and the
 * rest), and enumerating them here would mean either a compile error or a quiet
 * rewrite every time the database learned a new one. They fall to the unmapped
 * answer, which is a human.
 */
const REVOCATION_REFUSAL_ROUTING: Readonly<Record<RevocationRefusalCode, JobRouting>> = {
  REVOCATION_NO_REQUEST_ID: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE),
  REVOCATION_NO_REQUESTER: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE),
  REVOCATION_NO_SOURCE: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE),
  REVOCATION_NO_REASON: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE),
  REVOCATION_SELF_APPROVED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.WORKER_SELF_APPROVED),
  REVOCATION_RECOVERY_DOWNGRADED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_DOWNGRADED),
  // The only retryable one, and only because nothing was decided.
  REVOCATION_GATEWAY_FAILED: failed("DATABASE_UNAVAILABLE"),
  REVOCATION_UNKNOWN_OUTCOME: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_MANUAL_REVIEW),
};

const REVOCATION_REFUSAL_INDEX = new Map<string, JobRouting>(
  Object.entries(REVOCATION_REFUSAL_ROUTING),
);

const KEY_DESTRUCTION_OUTCOME_ROUTING: Readonly<Record<KeyDestructionOutcomeCode, JobRouting>> = {
  DESTROYED: completed("DESTROYED"),
  // The provider had already erased it and said so with evidence. One key, one
  // erasure: this is a replay, and recording it as a fresh destruction would
  // make the attempt log claim two keys died.
  ALREADY_DESTROYED: completed("JOB_RESULT_REPLAYED"),
  ALREADY_CONFIRMED: completed("JOB_RESULT_REPLAYED"),
  DESTRUCTION_REFUSED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_REFUSED),
  // AMBIGUITY IS NOT A TRANSIENT FAULT. The provider was asked and did not say,
  // so nobody knows whether a private key still exists. A retry would call the
  // provider AGAIN on a request whose first call may have succeeded; this code
  // is absent from `RETRYABLE_FAILURE_CODES` on purpose, so the runtime routes
  // it to manual review, and the handler additionally proposes a reconcile job.
  RECONCILIATION_REQUIRED: failed(
    DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED,
  ),
  MANUAL_REVIEW_REQUIRED: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_MANUAL_REVIEW),
};

const KEY_DESTRUCTION_OUTCOME_INDEX = new Map<string, JobRouting>(
  Object.entries(KEY_DESTRUCTION_OUTCOME_ROUTING),
);

/**
 * What a recovery disposition owes, as a job disposition.
 *
 * Four of the five are ROUTED and complete: the obligation is recorded and the
 * work of honouring it belongs to governed replacement issuance, not to this
 * worker. `MANUAL_SECURITY_REVIEW` is the one that must not complete — it means
 * the blast radius is undeclared, and a completed job is a job nobody looks at.
 */
const RECOVERY_DISPOSITION_ROUTING: Readonly<Record<CredentialRecoveryDisposition, JobRouting>> = {
  NO_RECOVERY: completed("NO_ACTION_REQUIRED"),
  RECOVERY_REQUIRED: completed("RECOVERY_REQUIRED"),
  REPROVISION_REQUIRED: completed("REPROVISION_REQUIRED"),
  REASSIGNMENT_REQUIRED: completed("REASSIGNMENT_REQUIRED"),
  MANUAL_SECURITY_REVIEW: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_MANUAL_REVIEW),
};

const RECOVERY_DISPOSITION_INDEX = new Map<string, JobRouting>(
  Object.entries(RECOVERY_DISPOSITION_ROUTING),
);

/**
 * What the governed destruction-request status means to a RECONCILE job.
 *
 * Exactly one status closes the question: `executed`, which group 0137 reaches
 * only after `confirm_key_destruction_v1` accepted provider evidence. Reaching
 * it means the ambiguity was in the ACKNOWLEDGEMENT of a call that did land,
 * and the proof of that is already in the database.
 *
 * `cancelled` and `expired` deliberately do NOT close it. They say the REQUEST
 * ended; they say nothing about whether the provider erased the key before it
 * did, and that is the only fact a reconciliation is about.
 */
const DESTRUCTION_REQUEST_STATUS_ROUTING: Readonly<
  Record<KeyDestructionRequestStatus, JobRouting>
> = {
  executed: completed("JOB_RESULT_REPLAYED"),
  requested: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  approved: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  pending_execution: failed(
    DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED,
  ),
  failed: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  manual_review: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  cancelled: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
  expired: failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED),
};

const DESTRUCTION_REQUEST_STATUS_INDEX = new Map<string, JobRouting>(
  Object.entries(DESTRUCTION_REQUEST_STATUS_ROUTING),
);

/**
 * Routes one governed revocation outcome. Exported so the table can be tested
 * with a code no version of the service has ever returned.
 */
export function routeRevocationOutcome(outcome: RevocationOutcome): JobRouting {
  const routed = routeCode(
    REVOCATION_OUTCOME_INDEX,
    outcome.outcome,
    failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_MANUAL_REVIEW),
  );
  if (routed.kind !== "failed" || outcome.refusalCode === undefined) return routed;
  // A refusal carries a REASON, and one of them (a gateway that threw) is worth
  // retrying while none of the others is. The refusal table refines the outcome
  // table; an unrecognised refusal keeps the outcome table's answer, which is
  // already a human.
  return routeCode(REVOCATION_REFUSAL_INDEX, outcome.refusalCode, routed);
}

/** Routes one governed destruction outcome. Unknown codes never complete. */
export function routeKeyDestructionOutcome(outcome: KeyDestructionOutcome): JobRouting {
  return routeCode(
    KEY_DESTRUCTION_OUTCOME_INDEX,
    outcome.outcome,
    failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_MANUAL_REVIEW),
  );
}

/** Routes one recovery disposition. A disposition nobody mapped is a human. */
export function routeRecoveryDisposition(disposition: string): JobRouting {
  return routeCode(
    RECOVERY_DISPOSITION_INDEX,
    disposition,
    failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_UNKNOWN_DISPOSITION),
  );
}

/** Routes one governed destruction-request status. */
export function routeDestructionRequestStatus(status: string): JobRouting {
  return routeCode(
    DESTRUCTION_REQUEST_STATUS_INDEX,
    status,
    failed(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_UNKNOWN_REQUEST_STATE),
  );
}

// ---------------------------------------------------------------------------
// Discovery
//
// Every function below is a PURE read that only proposes jobs. Discovery never
// approves, never revokes, never destroys and never writes: a sweep that runs
// twice, or runs against a device mid-revocation, must not itself become the
// thing that broke it.
// ---------------------------------------------------------------------------

export interface RevocationExecuteCandidate {
  readonly revocationRequestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly credentialGeneration: number;
  readonly reasonCode: CredentialRevocationReason;
  readonly reason: string;
  readonly requestedBy: string;
  readonly source: string;
  /** From the approval record. Never defaulted, never constructed. */
  readonly approvalRequestId: string | null;
  readonly approvedBy: string | null;
  readonly recoveryDisposition: CredentialRecoveryDisposition | null;
  readonly incidentReference: string | null;
}

export interface RecoveryDispositionCandidate {
  readonly revocationRecordId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly reasonCode: CredentialRevocationReason;
  readonly recoveryDisposition: CredentialRecoveryDisposition | null;
  readonly incidentReference: string | null;
}

export interface KeyDestructionExecuteCandidate {
  readonly destructionRequestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly providerKeyReference: string;
  readonly publicKeyFingerprint: string;
  readonly keyGeneration: number;
  /** The governed status, verbatim. Discovery filters on it, never rewrites it. */
  readonly requestStatus: string;
}

export interface KeyDestructionReconcileCandidate {
  readonly destructionRequestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly providerKeyReference: string;
  readonly requestStatus: string;
  /**
   * True when an execution attempt ended without the provider saying what
   * happened. Set from group 0137's attempt evidence — never inferred here from
   * elapsed time, because "it has been a while" is not an observation.
   */
  readonly providerOutcomeAmbiguous: boolean;
}

/** Reads only. There is deliberately no write method on this port. */
export interface RevocationAndDestructionDiscovery {
  findApprovedRevocations(environment: string): Promise<readonly RevocationExecuteCandidate[]>;
  findRevocationsAwaitingRecoveryDisposition(
    environment: string,
  ): Promise<readonly RecoveryDispositionCandidate[]>;
  findClearedKeyDestructions(
    environment: string,
  ): Promise<readonly KeyDestructionExecuteCandidate[]>;
  findUnreconciledKeyDestructions(
    environment: string,
  ): Promise<readonly KeyDestructionReconcileCandidate[]>;
}

const blank = (value: string | null | undefined): boolean => (value ?? "").trim() === "";

/**
 * Turns observed state into deduplicated job requests.
 *
 * Note what discovery REFUSES to propose. A revocation with no approval
 * reference produces no job at all — not a job that will fail, not a job a
 * human might rescue by filling something in. If the approval is missing, the
 * work does not exist yet, and manufacturing a queue entry for it is the first
 * step towards manufacturing the approval.
 */
export async function discoverRevocationAndDestructionWork(
  environment: string,
  discovery: RevocationAndDestructionDiscovery,
  actorRef: string,
): Promise<readonly DiscoveredJobRequest[]> {
  const requests: DiscoveredJobRequest[] = [];

  for (const candidate of await discovery.findApprovedRevocations(environment)) {
    if (blank(candidate.approvalRequestId) || blank(candidate.approvedBy)) continue;
    requests.push({
      jobKind: DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND,
      jobVersion: DEVICE_JOB_SCHEMA_VERSION,
      dedupeKey: credentialRevocationExecuteDedupeKey(candidate),
      environment: candidate.environment,
      subjectId: candidate.deviceRecordId,
      payload: {
        revocationRequestId: candidate.revocationRequestId,
        deviceRecordId: candidate.deviceRecordId,
        purpose: candidate.purpose,
        credentialGeneration: candidate.credentialGeneration,
        reasonCode: candidate.reasonCode,
        reason: candidate.reason,
        requestedBy: candidate.requestedBy,
        source: candidate.source,
        approvalRequestId: candidate.approvalRequestId,
        approvedBy: candidate.approvedBy,
        recoveryDisposition: candidate.recoveryDisposition,
        incidentReference: candidate.incidentReference,
      },
      maxAttempts: DEVICE_JOB_MAX_ATTEMPTS,
      actorRef,
    });
  }

  for (const candidate of await discovery.findRevocationsAwaitingRecoveryDisposition(environment)) {
    requests.push(
      recoveryDispositionJobRequest(
        {
          basis: "REVOCATION",
          revocationRecordId: candidate.revocationRecordId,
          deviceRecordId: candidate.deviceRecordId,
          environment: candidate.environment,
          purpose: candidate.purpose,
          reasonCode: candidate.reasonCode,
          recoveryDisposition: candidate.recoveryDisposition,
          escalationTrigger: null,
          incidentReference: candidate.incidentReference,
        },
        actorRef,
      ),
    );
  }

  for (const candidate of await discovery.findClearedKeyDestructions(environment)) {
    // The database decides whether an execution may begin. Discovery only
    // declines to queue work the database has already said no to, so a refused
    // or spent request does not sit in a queue being re-asked.
    if (!isExecutableDestructionStatus(candidate.requestStatus)) continue;
    requests.push({
      jobKind: DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND,
      jobVersion: DEVICE_JOB_SCHEMA_VERSION,
      dedupeKey: providerKeyDestructionExecuteDedupeKey(candidate),
      environment: candidate.environment,
      subjectId: candidate.deviceRecordId,
      payload: {
        destructionRequestId: candidate.destructionRequestId,
        deviceRecordId: candidate.deviceRecordId,
        purpose: candidate.purpose,
        providerKeyReference: candidate.providerKeyReference,
        publicKeyFingerprint: candidate.publicKeyFingerprint,
        keyGeneration: candidate.keyGeneration,
      },
      maxAttempts: DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS,
      actorRef,
    });
  }

  for (const candidate of await discovery.findUnreconciledKeyDestructions(environment)) {
    // Only an observed ambiguity. A request that is merely slow is not
    // unresolved, and putting it in a human's queue teaches people to clear
    // that queue without reading it.
    if (!candidate.providerOutcomeAmbiguous) continue;
    if (candidate.requestStatus === "executed") continue;
    requests.push(providerKeyDestructionReconcileJobRequest(candidate, actorRef));
  }

  return requests;
}

function isExecutableDestructionStatus(status: string): boolean {
  for (const known of KEY_DESTRUCTION_REQUEST_STATUSES) {
    if (known === status) return DESTRUCTION_EXECUTABLE_STATUSES.has(known);
  }
  // A status this repository does not recognise is not permission to proceed.
  return false;
}

/** Builds one reconcile request. Pure; proposes, never enqueues. */
export function providerKeyDestructionReconcileJobRequest(
  input: {
    readonly destructionRequestId: string;
    readonly deviceRecordId: string;
    readonly environment: string;
    readonly providerKeyReference: string;
  },
  actorRef: string,
): DiscoveredJobRequest {
  return {
    jobKind: DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND,
    jobVersion: DEVICE_JOB_SCHEMA_VERSION,
    dedupeKey: providerKeyDestructionReconcileDedupeKey(input),
    environment: input.environment,
    subjectId: input.deviceRecordId,
    payload: {
      destructionRequestId: input.destructionRequestId,
      deviceRecordId: input.deviceRecordId,
      providerKeyReference: input.providerKeyReference,
    },
    // One attempt is the point: reconciliation is a question for a person, and
    // a bounded ladder of automatic re-asks would only delay them.
    maxAttempts: 1,
    actorRef,
  };
}

/** Builds one recovery-disposition request. Pure; proposes, never enqueues. */
export function recoveryDispositionJobRequest(
  input: {
    readonly basis: RecoveryDispositionBasis;
    readonly revocationRecordId: string;
    readonly deviceRecordId: string;
    readonly environment: string;
    readonly purpose: string;
    readonly reasonCode: CredentialRevocationReason;
    readonly recoveryDisposition: CredentialRecoveryDisposition | null;
    readonly escalationTrigger: string | null;
    readonly incidentReference: string | null;
  },
  actorRef: string,
): DiscoveredJobRequest {
  return {
    jobKind: DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND,
    jobVersion: DEVICE_JOB_SCHEMA_VERSION,
    dedupeKey: credentialRecoveryDispositionDedupeKey(input),
    environment: input.environment,
    subjectId: input.deviceRecordId,
    payload: {
      basis: input.basis,
      revocationRecordId: input.revocationRecordId,
      deviceRecordId: input.deviceRecordId,
      purpose: input.purpose,
      reasonCode: input.reasonCode,
      recoveryDisposition: input.recoveryDisposition,
      escalationTrigger: input.escalationTrigger,
      incidentReference: input.incidentReference,
    },
    maxAttempts: DEVICE_JOB_MAX_ATTEMPTS,
    actorRef,
  };
}

// ---------------------------------------------------------------------------
// Lapse discovery — emergency post-approval deadlines
// ---------------------------------------------------------------------------

/** `kitluy_devices.emergency_post_approval_decision` (group 0138). */
export type EmergencyPostApprovalDecision = "PENDING" | "APPROVED" | "REFUSED" | "LAPSED";

export interface EmergencyPostApprovalCandidate {
  readonly emergencyRevocationId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly reasonCode: CredentialRevocationReason;
  /**
   * Frozen at declaration. Group 0138's trigger permits it to be brought
   * FORWARD and refuses to let it move out; nothing in this module writes it.
   */
  readonly postApprovalDueAt: Date;
  readonly postApprovalDecision: string;
  readonly incidentReference: string | null;
}

/**
 * Proposes ESCALATION for emergency revocations whose post-approval deadline
 * has passed with nobody answering.
 *
 * KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 RULING 4 IS THE WHOLE SHAPE OF
 * THIS FUNCTION. The deadline may be shortened but never extended, reset or
 * renewed, and a missed post-approval leaves the credential REVOKED and moves
 * the case to MANUAL_SECURITY_REVIEW with incident escalation.
 *
 * So the proposed job:
 *
 *   - carries NO deadline field of any kind. There is nothing in the payload
 *     that a downstream handler could write back as a new `post_approval_due_at`,
 *     because a deadline an automated escalation could set is a deadline an
 *     attacker who delays the approver can keep pushing out;
 *   - carries NO reversal of any kind. Ruling 3 makes every revocation
 *     irreversible, so there is no un-revoke, restore or reinstate to propose;
 *   - fixes the disposition at MANUAL_SECURITY_REVIEW, which is the one
 *     disposition that does not complete;
 *   - deduplicates on the emergency revocation id ALONE, so bringing the
 *     deadline forward — the one permitted change — escalates earlier without
 *     opening a second obligation.
 *
 * WHICH CLOCK. `instant` is the OPERATOR clock: group 0138 freezes
 * `post_approval_due_at` in server time and says why. Passing a device's
 * trusted-time evaluation here would compare an operator deadline against a
 * device clock and let a device with a manipulated clock extend its own
 * emergency window — the exact thing Ruling 4 forbids.
 *
 * Pure: reads its arguments, mutates nothing, calls nothing.
 */
export function discoverLapsedEmergencyPostApprovals(
  candidates: readonly EmergencyPostApprovalCandidate[],
  instant: Date,
  actorRef: string,
): readonly DiscoveredJobRequest[] {
  const requests: DiscoveredJobRequest[] = [];
  for (const candidate of candidates) {
    // Only a LIVE obligation can lapse. A decision that already landed —
    // approved, refused or previously recorded as lapsed — is settled evidence,
    // and re-escalating it would either duplicate a case or, worse, look like
    // an automated reopening of something a person closed.
    if (candidate.postApprovalDecision !== "PENDING") continue;
    if (candidate.postApprovalDueAt.getTime() > instant.getTime()) continue;
    requests.push(
      recoveryDispositionJobRequest(
        {
          basis: "EMERGENCY_POST_APPROVAL_LAPSE",
          revocationRecordId: candidate.emergencyRevocationId,
          deviceRecordId: candidate.deviceRecordId,
          environment: candidate.environment,
          purpose: candidate.purpose,
          reasonCode: candidate.reasonCode,
          // Ruling 4: the credential stays revoked and the case moves to
          // MANUAL_SECURITY_REVIEW. Not a proposal — the outcome is decided.
          recoveryDisposition: "MANUAL_SECURITY_REVIEW",
          escalationTrigger: "EMERGENCY_POST_APPROVAL_LAPSED",
          incidentReference: candidate.incidentReference,
        },
        actorRef,
      ),
    );
  }
  return requests;
}

// ---------------------------------------------------------------------------
// Payload reading
// ---------------------------------------------------------------------------

function readString(job: DurableJob, field: string): string | null {
  const value = job.payload[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readNumber(job: DurableJob, field: string): number | null {
  const value = job.payload[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readEnvironment(job: DurableJob): TrustEnvironment | null {
  for (const known of TRUST_ENVIRONMENTS) {
    if (known === job.environment) return known;
  }
  return null;
}

function readRevocationReason(value: string | null): CredentialRevocationReason | null {
  for (const known of CREDENTIAL_REVOCATION_REASONS) {
    if (known === value) return known;
  }
  return null;
}

function readRecoveryDisposition(value: string | null): CredentialRecoveryDisposition | null {
  for (const known of CREDENTIAL_RECOVERY_DISPOSITIONS) {
    if (known === value) return known;
  }
  return null;
}

/**
 * A refusal that happens BEFORE any governed call.
 *
 * `calledOperation: "none"` is the load-bearing part: it is how a reader of the
 * attempt log a year later can tell that this job never reached the database,
 * so no approval was consumed and no key was touched.
 */
function refuseBeforeCalling(
  failureCode: string,
  observed: string,
  why: string,
  correlationId: string | null,
): HandlerResult {
  return {
    disposition: { kind: "failed", failureCode },
    evidence: {
      observedBusinessState: observed,
      calledOperation: "none",
      operationResult: why,
      failureCode,
      correlationId,
    },
  };
}

function missingPayload(fields: readonly string[], correlationId: string | null): HandlerResult {
  return refuseBeforeCalling(
    DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE,
    "payload-incomplete",
    `the job payload is missing ${fields.join(", ")}`,
    correlationId,
  );
}

/**
 * The scope check every handler runs first.
 *
 * The governed functions check scope again, and that is the authoritative
 * check. This one exists so a job that names a different device from its own
 * subject never reaches them at all: a well-formed request applied to somebody
 * else's device is the failure mode `RevocationInput` has no `credentialId`
 * field to prevent.
 */
function scopeMismatch(
  job: DurableJob,
  deviceRecordId: string,
  correlationId: string | null,
): HandlerResult | null {
  if (deviceRecordId === job.subjectId) return null;
  return refuseBeforeCalling(
    DEVICE_REVOCATION_JOB_FAILURE_CODES.SCOPE_MISMATCH,
    "scope-mismatch",
    "the job payload names a different device from its subject",
    correlationId,
  );
}

function resultFor(
  routing: JobRouting,
  evidence: {
    readonly observedBusinessState: string;
    readonly calledOperation: string;
    readonly operationResult: string;
    readonly correlationId: string | null;
  },
): HandlerResult {
  return {
    disposition: routing,
    evidence: {
      ...evidence,
      failureCode: routing.kind === "failed" ? routing.failureCode : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Handler — governed credential revocation
// ---------------------------------------------------------------------------

export interface RevocationExecuteHandlerDeps {
  readonly gateway: RevocationGateway;
  readonly identity: WorkerIdentity;
}

/**
 * Executes ONE approved revocation.
 *
 * THE APPROVAL IS CARRIED, NEVER CONSTRUCTED. Every accountability field on the
 * governed call — requester, source, approval request id, approver — comes from
 * the payload, and the worker contributes none of them. That is why the handler
 * refuses rather than proceeds when the approval reference is absent: a worker
 * that could supply a default would be a worker that could revoke a credential
 * on nobody's authority, and group 0136 consumes an approval single-use, so
 * there would be no second gate to catch it.
 *
 * The worker's own identity appears in exactly one place: a check that it is
 * NOT the approver.
 */
export function credentialRevocationExecuteHandler(deps: RevocationExecuteHandlerDeps): JobHandler {
  return {
    jobKind: DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND,
    async handle(job: DurableJob): Promise<HandlerResult> {
      const revocationRequestId = readString(job, "revocationRequestId");
      const deviceRecordId = readString(job, "deviceRecordId");
      const purpose = readString(job, "purpose");
      const credentialGeneration = readNumber(job, "credentialGeneration");
      const reason = readString(job, "reason");
      const requestedBy = readString(job, "requestedBy");
      const source = readString(job, "source");
      const reasonCode = readRevocationReason(readString(job, "reasonCode"));

      const missing: string[] = [];
      if (revocationRequestId === null) missing.push("revocationRequestId");
      if (deviceRecordId === null) missing.push("deviceRecordId");
      if (purpose === null) missing.push("purpose");
      if (credentialGeneration === null) missing.push("credentialGeneration");
      if (reason === null) missing.push("reason");
      if (requestedBy === null) missing.push("requestedBy");
      if (source === null) missing.push("source");
      if (reasonCode === null) missing.push("reasonCode");
      if (
        missing.length > 0 ||
        revocationRequestId === null ||
        deviceRecordId === null ||
        purpose === null ||
        credentialGeneration === null ||
        reason === null ||
        requestedBy === null ||
        source === null ||
        reasonCode === null
      ) {
        return missingPayload(missing, revocationRequestId);
      }

      const scope = scopeMismatch(job, deviceRecordId, revocationRequestId);
      if (scope !== null) return scope;

      const environment = readEnvironment(job);
      if (environment === null) {
        return refuseBeforeCalling(
          DEVICE_REVOCATION_JOB_FAILURE_CODES.ENVIRONMENT_UNRECOGNISED,
          `environment=${job.environment}`,
          "the job names a trust environment this package does not recognise",
          revocationRequestId,
        );
      }

      // ---- THE APPROVAL GATE ------------------------------------------------
      // Refused here, before the gateway, for the same reason
      // `revokeDeviceCredential` refuses before the gateway: group 0136 consumes
      // an approval single-use, and a request that should never have been made
      // must not reach the point where it could burn one.
      const approvalRequestId = readString(job, "approvalRequestId");
      if (approvalRequestId === null) {
        return refuseBeforeCalling(
          DEVICE_REVOCATION_JOB_FAILURE_CODES.APPROVAL_REFERENCE_ABSENT,
          "no-approval-reference",
          "a worker may execute an approved revocation and may not create the approval; the payload carried no approvalRequestId",
          revocationRequestId,
        );
      }
      const approvedBy = readString(job, "approvedBy");
      if (approvedBy === null) {
        return refuseBeforeCalling(
          DEVICE_REVOCATION_JOB_FAILURE_CODES.APPROVER_ABSENT,
          "no-approver",
          "an approval reference without a named approver is not an approval anyone can be held to",
          revocationRequestId,
        );
      }
      if (approvedBy.trim() === deps.identity.serviceIdentity.trim()) {
        return refuseBeforeCalling(
          DEVICE_REVOCATION_JOB_FAILURE_CODES.WORKER_SELF_APPROVED,
          "worker-named-as-approver",
          "the worker identity appears as the approver; four eyes means two people, and an automated executor is neither",
          revocationRequestId,
        );
      }

      const outcome = await revokeDeviceCredential(
        {
          revocationRequestId,
          deviceRecordId,
          environment,
          purpose,
          credentialGeneration,
          reasonCode,
          reason,
          // Absent means the reason's default, which is the behaviour
          // `credential-revocation.ts` documents. The worker does not pick.
          recoveryDisposition:
            readRecoveryDisposition(readString(job, "recoveryDisposition")) ?? undefined,
          requestedBy,
          source,
          approvalRequestId,
          approvedBy,
          incidentReference: readString(job, "incidentReference"),
        },
        deps.gateway,
      );

      return resultFor(routeRevocationOutcome(outcome), {
        observedBusinessState: `outcome=${outcome.outcome}`,
        calledOperation: "revokeDeviceCredential",
        operationResult: `${outcome.outcome}:${outcome.refusalCode ?? "none"}`,
        correlationId: outcome.revocationId ?? revocationRequestId,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Handler — recovery disposition
// ---------------------------------------------------------------------------

/**
 * Records what a revocation LEAVES OWED, and routes it.
 *
 * This handler calls no gateway and no provider, and that is the design rather
 * than an omission: honouring a recovery obligation is governed replacement
 * issuance (Ruling 3 — recovery happens that way and no other), so the only
 * thing a worker adds is a durable, deduplicated statement of which obligation
 * applies. Having no business effect at all is also what makes it trivially
 * replay-safe.
 *
 * The one thing it refuses is a DOWNGRADE. `NO_RECOVERY` opens no recovery case
 * (group 0136), so accepting it for a reason that says a private key may be in
 * someone else's hands would leave a compromised device with nothing scheduled
 * and no case anyone counts.
 */
export function credentialRecoveryDispositionHandler(): JobHandler {
  return {
    jobKind: DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND,
    handle(job: DurableJob): Promise<HandlerResult> {
      return Promise.resolve(handleRecoveryDisposition(job));
    },
  };
}

function handleRecoveryDisposition(job: DurableJob): HandlerResult {
  const revocationRecordId = readString(job, "revocationRecordId");
  const deviceRecordId = readString(job, "deviceRecordId");
  const rawReason = readString(job, "reasonCode");

  const missing: string[] = [];
  if (revocationRecordId === null) missing.push("revocationRecordId");
  if (deviceRecordId === null) missing.push("deviceRecordId");
  if (rawReason === null) missing.push("reasonCode");
  if (missing.length > 0 || deviceRecordId === null) {
    return missingPayload(missing, revocationRecordId);
  }

  const scope = scopeMismatch(job, deviceRecordId, revocationRecordId);
  if (scope !== null) return scope;

  const reasonCode = readRevocationReason(rawReason);
  if (reasonCode === null) {
    // A reason this repository cannot resolve has no known default disposition,
    // and guessing one is how a compromise gets filed as routine.
    return refuseBeforeCalling(
      DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_UNKNOWN_REASON,
      `reasonCode=${String(rawReason)}`,
      "the revocation reason is not one this package knows a recovery obligation for",
      revocationRecordId,
    );
  }

  const declared = readString(job, "recoveryDisposition");
  const disposition = declared === null ? recoveryDispositionFor(reasonCode) : declared;

  if (disposition === "NO_RECOVERY" && reasonForbidsNoRecovery(reasonCode)) {
    return refuseBeforeCalling(
      DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_DOWNGRADED,
      `reason=${reasonCode} disposition=NO_RECOVERY`,
      `${reasonCode} leaves an obligation; NO_RECOVERY opens no recovery case for anyone to count`,
      revocationRecordId,
    );
  }

  const trigger = readString(job, "escalationTrigger");
  return resultFor(routeRecoveryDisposition(disposition), {
    observedBusinessState: `reason=${reasonCode} disposition=${disposition}`,
    // Nothing was called. The disposition is derived from evidence the job
    // already carries, which is why replaying it cannot produce a second effect.
    calledOperation: "recoveryDispositionFor",
    operationResult: trigger === null ? disposition : `${disposition}:${trigger}`,
    correlationId: revocationRecordId,
  });
}

// ---------------------------------------------------------------------------
// Handler — provider key destruction, execution
// ---------------------------------------------------------------------------

/**
 * Proposes follow-up work. Deduplicated by the request's dedupe key, so
 * proposing the same reconciliation twice proposes one job.
 */
export interface DestructionReconciliationProposer {
  propose(request: DiscoveredJobRequest): Promise<void>;
}

export interface KeyDestructionExecuteHandlerDeps {
  readonly gateway: KeyDestructionGateway;
  readonly provider: ProviderKeyDestroyer;
  readonly identity: WorkerIdentity;
  /**
   * Optional. Its absence changes no disposition — an ambiguous outcome still
   * routes to manual review — it only changes whether the follow-up job is
   * queued automatically. A proposer that made the difference between "a human
   * sees this" and "nobody does" would be a safety control hiding in an
   * optional dependency.
   */
  readonly reconciliation?: DestructionReconciliationProposer;
}

/** Attempts already spent on this job, discounting claims that were deferred. */
export function destructionExecutionAttemptsSpent(job: DurableJob): number {
  return Math.max(0, job.attemptCount - job.deferralCount - 1);
}

export function destructionExecutionAttemptPermitted(job: DurableJob): boolean {
  return destructionExecutionAttemptsSpent(job) < DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS;
}

/**
 * Executes ONE destruction attempt by asking the governed service to.
 *
 * THERE IS NO PROVIDER CALL IN THIS HANDLER, and there must never be one.
 * `executeProviderKeyDestruction` owns the only safe ordering — the database
 * clears the attempt, THEN the provider is asked, THEN the receipt is checked
 * against what was approved, and only THEN may the database record that the key
 * is gone. A handler that called the destroyer itself, even "just to retry",
 * would erase a private key the database had not cleared and would leave no row
 * saying it had.
 */
export function providerKeyDestructionExecuteHandler(
  deps: KeyDestructionExecuteHandlerDeps,
): JobHandler {
  return {
    jobKind: DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND,
    async handle(job: DurableJob): Promise<HandlerResult> {
      const destructionRequestId = readString(job, "destructionRequestId");
      const deviceRecordId = readString(job, "deviceRecordId");
      const purpose = readString(job, "purpose");
      const providerKeyReference = readString(job, "providerKeyReference");
      const publicKeyFingerprint = readString(job, "publicKeyFingerprint");
      const keyGeneration = readNumber(job, "keyGeneration");

      const missing: string[] = [];
      if (destructionRequestId === null) missing.push("destructionRequestId");
      if (deviceRecordId === null) missing.push("deviceRecordId");
      if (purpose === null) missing.push("purpose");
      if (providerKeyReference === null) missing.push("providerKeyReference");
      if (publicKeyFingerprint === null) missing.push("publicKeyFingerprint");
      if (keyGeneration === null) missing.push("keyGeneration");
      if (
        missing.length > 0 ||
        destructionRequestId === null ||
        deviceRecordId === null ||
        purpose === null ||
        providerKeyReference === null ||
        publicKeyFingerprint === null ||
        keyGeneration === null
      ) {
        return missingPayload(missing, destructionRequestId);
      }

      const scope = scopeMismatch(job, deviceRecordId, destructionRequestId);
      if (scope !== null) return scope;

      // ---- THE ATTEMPT BUDGET ----------------------------------------------
      // Checked BEFORE anything is called, so an exhausted budget cannot spend
      // one more. Running out of patience is not evidence of anything: the
      // budget ending is a manual-review disposition, never a success and never
      // a quiet completion that would let the key's fate go unrecorded.
      if (!destructionExecutionAttemptPermitted(job)) {
        return refuseBeforeCalling(
          DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_ATTEMPTS_EXHAUSTED,
          `attemptsSpent=${destructionExecutionAttemptsSpent(job)}`,
          `the KLREQ-031 execution budget of ${DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS} attempts is spent; the key is NOT confirmed destroyed`,
          destructionRequestId,
        );
      }

      const outcome = await executeProviderKeyDestruction(deps.gateway, deps.provider, {
        destructionRequestId,
        // The worker names itself as the EXECUTOR, which is what it is. It
        // never appears as requester or approver: executing is a worker's job,
        // approving is not.
        executedBy: deps.identity.serviceIdentity,
        deviceRecordId,
        environment: job.environment,
        purpose,
        providerKeyReference,
        publicKeyFingerprint,
        keyGeneration,
      });

      const routing = routeKeyDestructionOutcome(outcome);

      // An ambiguous provider outcome becomes a QUESTION FOR A PERSON, not a
      // second call. The reconcile job is deduplicated on the destruction
      // request, so an attempt that goes ambiguous twice still leaves one item.
      if (outcome.outcome === "RECONCILIATION_REQUIRED" && deps.reconciliation !== undefined) {
        try {
          await deps.reconciliation.propose(
            providerKeyDestructionReconcileJobRequest(
              {
                destructionRequestId,
                deviceRecordId,
                environment: job.environment,
                providerKeyReference,
              },
              deps.identity.serviceIdentity,
            ),
          );
        } catch {
          // A proposal that failed to queue must not change the disposition.
          // The outcome is still "nobody knows whether this key exists", and
          // the runtime routes that to manual review with or without a
          // follow-up job.
        }
      }

      return resultFor(routing, {
        observedBusinessState: `outcome=${outcome.outcome} attempt=${outcome.attemptNumber ?? "none"}`,
        calledOperation: "executeProviderKeyDestruction",
        operationResult: `${outcome.outcome}:${outcome.refusalCode ?? "none"}`,
        correlationId: destructionRequestId,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Handler — provider key destruction, reconciliation
// ---------------------------------------------------------------------------

/**
 * Reads one destruction request. READ ONLY, by construction.
 *
 * There is no write method and no provider method on this port, because the
 * reconcile handler must not be able to resolve the ambiguity by acting: asking
 * the provider to destroy again is the failure this whole path exists to
 * prevent, and confirming without evidence is the other one.
 */
export interface DestructionReconciliationReader {
  readDestructionRequestStatus(input: {
    readonly destructionRequestId: string;
    readonly deviceRecordId: string;
    readonly environment: string;
  }): Promise<string | null>;
}

export interface KeyDestructionReconcileHandlerDeps {
  readonly reader: DestructionReconciliationReader;
}

/**
 * Reconciles a destruction whose provider outcome was ambiguous.
 *
 * It performs exactly one READ and then routes. It cannot destroy — the deps
 * carry no destroyer — and it cannot confirm — the deps carry no gateway. The
 * only automatic conclusion available to it is the one the database can already
 * prove: a request in `executed` has provider evidence recorded against it, so
 * the ambiguity was in the acknowledgement of a call that did land. Everything
 * else is a question about a private key that only somebody with provider-side
 * access can answer, and this job is the durable, deduplicated place that
 * question waits.
 */
export function providerKeyDestructionReconcileHandler(
  deps: KeyDestructionReconcileHandlerDeps,
): JobHandler {
  return {
    jobKind: DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND,
    async handle(job: DurableJob): Promise<HandlerResult> {
      const destructionRequestId = readString(job, "destructionRequestId");
      const deviceRecordId = readString(job, "deviceRecordId");

      const missing: string[] = [];
      if (destructionRequestId === null) missing.push("destructionRequestId");
      if (deviceRecordId === null) missing.push("deviceRecordId");
      if (missing.length > 0 || destructionRequestId === null || deviceRecordId === null) {
        return missingPayload(missing, destructionRequestId);
      }

      const scope = scopeMismatch(job, deviceRecordId, destructionRequestId);
      if (scope !== null) return scope;

      let status: string | null;
      try {
        status = await deps.reader.readDestructionRequestStatus({
          destructionRequestId,
          deviceRecordId,
          environment: job.environment,
        });
      } catch {
        // A read that failed tells us nothing, and "nothing" about a key whose
        // fate is already unknown is not a reason to close the item.
        status = null;
      }

      if (status === null) {
        return refuseBeforeCalling(
          DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_REQUEST_NOT_FOUND,
          "no-destruction-request",
          "the governed destruction request could not be read; the key is NOT confirmed destroyed",
          destructionRequestId,
        );
      }

      return resultFor(routeDestructionRequestStatus(status), {
        observedBusinessState: `requestStatus=${status}`,
        calledOperation: "readDestructionRequestStatus",
        operationResult: status,
        correlationId: destructionRequestId,
      });
    },
  };
}
