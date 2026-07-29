/**
 * Device credential work, expressed as durable jobs.
 *
 * This module is the ADAPTER between the neutral job runtime
 * (`@kitluy/job-contracts`, migration group 0135) and the credential services
 * built in groups 0125-0134. It contains no reconciliation logic and no
 * lifecycle logic of its own: discovering that work exists, naming it
 * deterministically and translating an outcome into a job disposition is the
 * whole job. Reimplementing either state machine here would create a second
 * copy that drifts, and the copy nobody is testing is the one that decides.
 *
 * WHAT THIS DOES NOT DO
 * - It does not schedule. Nothing here has a timer, and there is no cron.
 * - It does not destroy keys. It cannot: destruction is disabled at the
 *   database (group 0134) pending KLREQ-031, and the cleanup handler only ever
 *   reads an eligibility answer.
 * - It does not revoke credentials. No such operation exists anywhere yet
 *   (KLRISK-DEVICE-007).
 */
import type { DurableJob, HandlerResult, JobHandler, WorkerIdentity } from "@kitluy/job-contracts";
import type { TrustedTimeEvaluation } from "./trusted-time.js";
import {
  advanceDeviceCredentialLifecycle,
  evaluateKeyDestruction,
  type LifecycleClassification,
  type LifecycleGateway,
  type LifecycleReader,
} from "./credential-lifecycle.js";
import {
  reconcileDeviceCredentialRenewal,
  type ReconciliationAuditGateway,
  type ReconciliationClassification,
  type ReconciliationExecutor,
  type ReconciliationProviderProbe,
  type ReconciliationReader,
} from "./renewal-reconciliation.js";

// ---------------------------------------------------------------------------
// Job kinds. Versioned in the NAME, so a v2 with different payload semantics
// deduplicates separately from v1 instead of silently colliding with it.
// ---------------------------------------------------------------------------
export const RENEWAL_RECONCILE_JOB_KIND = "kitluy.devices.renewal-reconcile.v1" as const;
export const CREDENTIAL_LIFECYCLE_JOB_KIND = "kitluy.devices.credential-lifecycle.v1" as const;
export const KEY_CLEANUP_EVALUATE_JOB_KIND = "kitluy.devices.key-cleanup-evaluate.v1" as const;

export const DEVICE_JOB_KINDS = [
  RENEWAL_RECONCILE_JOB_KIND,
  CREDENTIAL_LIFECYCLE_JOB_KIND,
  KEY_CLEANUP_EVALUATE_JOB_KIND,
] as const;

/** Bumped when the MEANING of a payload changes, not when code changes. */
export const DEVICE_JOB_SCHEMA_VERSION = 1;

/**
 * Deliberately bounded. Five attempts across the 0s/30s/2m/10m/30m ladder is
 * roughly forty minutes of transient-fault tolerance; beyond that a human
 * learns something a sixth identical call would not.
 */
export const DEVICE_JOB_MAX_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Deterministic identity
//
// Every key below is built from AUTHORITATIVE lifecycle facts and nothing else.
// No clock, no random value, no discovery timestamp: rediscovering the same
// work must collide with the job that already represents it, and work whose
// authoritative version moved must not.
// ---------------------------------------------------------------------------
function joinKey(parts: readonly (string | number | null)[]): string {
  return parts.map((p) => (p === null ? "~" : String(p))).join("|");
}

export function renewalReconcileDedupeKey(input: {
  readonly renewalAttemptId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
}): string {
  return joinKey([
    RENEWAL_RECONCILE_JOB_KIND,
    input.renewalAttemptId,
    input.deviceRecordId,
    input.environment,
    input.purpose,
    DEVICE_JOB_SCHEMA_VERSION,
  ]);
}

/**
 * Bound to the credential-head VERSION as well as the overlap.
 *
 * The head version is what makes a renewal visible here: when the head
 * advances, the previous credential and the overlap boundary are different
 * facts, so that is genuinely new work and deserves a new job. Without the
 * version, a device that renewed twice would reuse the first job — and that job
 * already completed.
 */
export function credentialLifecycleDedupeKey(input: {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly headVersion: number | string;
  readonly previousCredentialId: string | null;
  readonly overlapEndsAt: Date | null;
}): string {
  return joinKey([
    CREDENTIAL_LIFECYCLE_JOB_KIND,
    input.deviceRecordId,
    input.environment,
    input.purpose,
    String(input.headVersion),
    input.previousCredentialId,
    input.overlapEndsAt === null ? null : input.overlapEndsAt.toISOString(),
    DEVICE_JOB_SCHEMA_VERSION,
  ]);
}

/**
 * Includes the POLICY reference.
 *
 * While KLREQ-031 is unresolved every evaluation reaches the same answer, so
 * one job per key is exactly right and re-evaluating is pointless. When an
 * owner decision finally lands, the policy reference changes, the key changes,
 * and a NEW job asks the question again — which is how a policy decision
 * re-opens work without anything having to poll for it.
 */
export function keyCleanupDedupeKey(input: {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly providerKeyReference: string;
  readonly keyGeneration: number;
  readonly overlapEndsAt: Date | null;
  readonly policyReference: string | null;
}): string {
  return joinKey([
    KEY_CLEANUP_EVALUATE_JOB_KIND,
    input.deviceRecordId,
    input.environment,
    input.providerKeyReference,
    input.keyGeneration,
    input.overlapEndsAt === null ? null : input.overlapEndsAt.toISOString(),
    input.policyReference,
    DEVICE_JOB_SCHEMA_VERSION,
  ]);
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Reservation statuses from which a renewal can still be driven forward. */
export const RECOVERABLE_RESERVATION_STATUSES: ReadonlySet<string> = new Set([
  "reserved",
  "key_generation_pending",
  "pop_pending",
  "issuance_pending",
  "credential_issued",
  "activation_pending",
]);

/** Terminal statuses. A completed renewal needs no reconciliation. */
export const TERMINAL_RESERVATION_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "refused",
  "abandoned",
]);

export interface RenewalReconcileCandidate {
  readonly renewalAttemptId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly reservationStatus: string;
}

export interface LifecycleCandidate {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly headVersion: number | string;
  readonly previousCredentialId: string | null;
  readonly overlapEndsAt: Date | null;
}

export interface KeyCleanupCandidate {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly providerKeyReference: string;
  readonly keyGeneration: number;
  readonly keyState: string;
  readonly overlapEndsAt: Date | null;
  readonly policyReference: string | null;
}

/**
 * Discovery reads. Every one is a pure read: discovery NEVER changes business
 * state, so a sweep that runs twice — or runs against a device mid-renewal —
 * cannot itself become the thing that broke it.
 */
export interface DeviceWorkDiscovery {
  findRecoverableRenewals(environment: string): Promise<readonly RenewalReconcileCandidate[]>;
  findOverlapCandidates(environment: string): Promise<readonly LifecycleCandidate[]>;
  findKeyCleanupCandidates(environment: string): Promise<readonly KeyCleanupCandidate[]>;
}

export interface DiscoveredJobRequest {
  readonly jobKind: string;
  readonly jobVersion: number;
  readonly dedupeKey: string;
  readonly environment: string;
  readonly subjectId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly maxAttempts: number;
  readonly actorRef: string;
}

/**
 * Turns observed state into deduplicated job requests.
 *
 * Note what is NOT decided here: whether an overlap has expired. Discovery may
 * use the PERSISTED `overlap_ends_at` to find a candidate — that is an indexed
 * column, and finding is not deciding — but the expiry judgement belongs to the
 * lifecycle service, against TRUSTED time. Server time and device trusted time
 * are separate clocks by design (KLD-2026-07-28-002 §12), and a discovery sweep
 * that decided expiry with `now()` would be answering a business question with
 * the wrong clock.
 */
export async function discoverDeviceWork(
  environment: string,
  discovery: DeviceWorkDiscovery,
  actorRef: string,
): Promise<readonly DiscoveredJobRequest[]> {
  const requests: DiscoveredJobRequest[] = [];

  for (const candidate of await discovery.findRecoverableRenewals(environment)) {
    if (TERMINAL_RESERVATION_STATUSES.has(candidate.reservationStatus)) continue;
    if (!RECOVERABLE_RESERVATION_STATUSES.has(candidate.reservationStatus)) continue;
    requests.push({
      jobKind: RENEWAL_RECONCILE_JOB_KIND,
      jobVersion: DEVICE_JOB_SCHEMA_VERSION,
      dedupeKey: renewalReconcileDedupeKey(candidate),
      environment: candidate.environment,
      subjectId: candidate.deviceRecordId,
      payload: {
        renewalAttemptId: candidate.renewalAttemptId,
        deviceRecordId: candidate.deviceRecordId,
        purpose: candidate.purpose,
      },
      maxAttempts: DEVICE_JOB_MAX_ATTEMPTS,
      actorRef,
    });
  }

  for (const candidate of await discovery.findOverlapCandidates(environment)) {
    // A head with no previous credential and no overlap has nothing to advance.
    if (candidate.previousCredentialId === null && candidate.overlapEndsAt === null) continue;
    requests.push({
      jobKind: CREDENTIAL_LIFECYCLE_JOB_KIND,
      jobVersion: DEVICE_JOB_SCHEMA_VERSION,
      dedupeKey: credentialLifecycleDedupeKey(candidate),
      environment: candidate.environment,
      subjectId: candidate.deviceRecordId,
      payload: {
        deviceRecordId: candidate.deviceRecordId,
        purpose: candidate.purpose,
        headVersion: String(candidate.headVersion),
        overlapEndsAt: candidate.overlapEndsAt?.toISOString() ?? null,
      },
      maxAttempts: DEVICE_JOB_MAX_ATTEMPTS,
      actorRef,
    });
  }

  for (const candidate of await discovery.findKeyCleanupCandidates(environment)) {
    // Only keys that have finished serving. Discovery marks NOTHING eligible;
    // the lifecycle policy evaluator remains the only authority on that.
    if (candidate.keyState !== "superseded" && candidate.keyState !== "abandoned") continue;
    requests.push({
      jobKind: KEY_CLEANUP_EVALUATE_JOB_KIND,
      jobVersion: DEVICE_JOB_SCHEMA_VERSION,
      dedupeKey: keyCleanupDedupeKey(candidate),
      environment: candidate.environment,
      subjectId: candidate.deviceRecordId,
      payload: {
        deviceRecordId: candidate.deviceRecordId,
        purpose: "device_identity",
        providerKeyReference: candidate.providerKeyReference,
        keyGeneration: candidate.keyGeneration,
        policyReference: candidate.policyReference,
      },
      maxAttempts: DEVICE_JOB_MAX_ATTEMPTS,
      actorRef,
    });
  }

  return requests;
}

// ---------------------------------------------------------------------------
// Outcome translation
//
// One table per service, mapping ITS classification onto a job disposition.
// Written as data rather than branching so a classification nobody mapped is
// visibly absent instead of silently falling into an `else`.
// ---------------------------------------------------------------------------

/** Reconciliation classifications that a worker may drive automatically. */
const RECONCILE_AUTOMATIC: ReadonlySet<ReconciliationClassification> = new Set([
  "KEY_GENERATION_REQUIRED",
  "KEY_METADATA_REGISTRATION_REQUIRED",
  "POP_REQUIRED",
  "ISSUANCE_PREPARATION_REQUIRED",
  "SIGNATURE_REQUIRED",
  "SIGNATURE_RECORDING_REQUIRED",
  "FINALIZATION_REQUIRED",
  "PROVIDER_ACTIVATION_REQUIRED",
  "ACTIVATION_CONFIRMATION_REQUIRED",
  "ABANDONMENT_REQUIRED",
]);

const RECONCILE_DONE: ReadonlySet<ReconciliationClassification> = new Set([
  "NO_ACTION_COMPLETED",
  "RESPONSE_REPLAY",
]);

const RECONCILE_HUMAN: ReadonlySet<ReconciliationClassification> = new Set([
  "MANUAL_REVIEW_REQUIRED",
  "INCONSISTENT_STATE",
]);

const LIFECYCLE_DONE: ReadonlySet<LifecycleClassification> = new Set([
  "NO_ACTION_CURRENT",
  "PREVIOUS_CREDENTIAL_RETIRED",
  "KEY_STILL_REFERENCED",
  // A correct, final ANSWER — not a fault. See retry-policy.ts.
  "KEY_DESTRUCTION_NOT_AUTHORIZED",
  "KEY_DESTROYED",
]);

const LIFECYCLE_HUMAN: ReadonlySet<LifecycleClassification> = new Set([
  "MANUAL_REVIEW_REQUIRED",
  "INCONSISTENT_STATE",
]);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export interface RenewalReconcileHandlerDeps {
  readonly reader: ReconciliationReader;
  readonly probe: ReconciliationProviderProbe;
  readonly executor: ReconciliationExecutor;
  readonly audit: ReconciliationAuditGateway;
  readonly identity: WorkerIdentity;
  /** Fresh per attempt. Trusted time is never cached across a lease. */
  trustedTime(scope: { readonly deviceRecordId: string }): Promise<TrustedTimeEvaluation>;
}

function requiredString(job: DurableJob, field: string): string {
  const value = job.payload[field];
  if (typeof value !== "string" || value === "") {
    throw new Error(`job ${job.jobId} payload is missing ${field}`);
  }
  return value;
}

export function renewalReconcileHandler(deps: RenewalReconcileHandlerDeps): JobHandler {
  return {
    jobKind: RENEWAL_RECONCILE_JOB_KIND,
    async handle(job: DurableJob): Promise<HandlerResult> {
      const renewalAttemptId = requiredString(job, "renewalAttemptId");
      const deviceRecordId = requiredString(job, "deviceRecordId");
      const purpose = requiredString(job, "purpose");

      // Scope is checked against the JOB, and the reconciler checks it again
      // against the reservation. A job that named another device would be
      // refused by the service, not trusted by it.
      if (deviceRecordId !== job.subjectId) {
        return {
          disposition: { kind: "failed", failureCode: "AUTHORIZATION_FAILED" },
          evidence: {
            observedBusinessState: "scope-mismatch",
            calledOperation: "none",
            operationResult: "the job payload names a different device from its subject",
            failureCode: "AUTHORIZATION_FAILED",
            correlationId: renewalAttemptId,
          },
        };
      }

      const trustedTime = await deps.trustedTime({ deviceRecordId });
      const outcome = await reconcileDeviceCredentialRenewal(
        {
          renewalAttemptId,
          deviceRecordId,
          environment: job.environment as never,
          purpose,
          actorRef: deps.identity.serviceIdentity,
          trustedTime,
          execute: true,
        },
        deps.reader,
        deps.probe,
        deps.executor,
        deps.audit,
      );

      const classification = outcome.decision?.classification;
      const observed =
        outcome.databaseState === undefined
          ? "unknown"
          : `db=${outcome.databaseState.reservationStatus}`;
      const evidence = {
        observedBusinessState: observed,
        calledOperation: "reconcileDeviceCredentialRenewal",
        operationResult: `${outcome.outcome}:${classification ?? outcome.refusalCode ?? "none"}`,
        failureCode: null as string | null,
        correlationId: renewalAttemptId,
      };

      if (outcome.outcome === "REFUSED") {
        const code =
          outcome.refusalCode === "RECONCILE_NO_TRUSTED_TIME"
            ? "TRUSTED_TIME_UNAVAILABLE"
            : "UNKNOWN_LIFECYCLE_COMBINATION";
        return {
          disposition: { kind: "failed", failureCode: code },
          evidence: { ...evidence, failureCode: code },
        };
      }

      if (classification !== undefined && RECONCILE_HUMAN.has(classification)) {
        const code =
          classification === "INCONSISTENT_STATE"
            ? "DATABASE_ACTIVE_PROVIDER_KEY_MISSING"
            : "UNKNOWN_LIFECYCLE_COMBINATION";
        return {
          disposition: { kind: "failed", failureCode: code },
          evidence: { ...evidence, failureCode: code },
        };
      }

      // Recovery is single-step by design (group 0133): one action, one audit
      // row. When something remains, the job is not finished — it goes back for
      // another bounded attempt rather than looping inside this handler, so
      // every step is separately visible and separately interruptible.
      if (outcome.remainingAction != null) {
        return {
          disposition: { kind: "failed", failureCode: "LEASE_SAFE_TIMEOUT" },
          evidence: {
            ...evidence,
            operationResult: `${evidence.operationResult}; remaining=${outcome.remainingAction}`,
            failureCode: "LEASE_SAFE_TIMEOUT",
          },
        };
      }

      if (classification !== undefined && RECONCILE_AUTOMATIC.has(classification)) {
        return { disposition: { kind: "completed", resultCode: classification }, evidence };
      }
      if (classification !== undefined && RECONCILE_DONE.has(classification)) {
        return {
          disposition: {
            kind: "completed",
            resultCode:
              classification === "RESPONSE_REPLAY"
                ? "JOB_RESULT_REPLAYED"
                : "RECONCILIATION_ALREADY_COMPLETED",
          },
          evidence,
        };
      }
      if (classification === "RESERVATION_PENDING") {
        return {
          disposition: { kind: "failed", failureCode: "LEASE_SAFE_TIMEOUT" },
          evidence: { ...evidence, failureCode: "LEASE_SAFE_TIMEOUT" },
        };
      }

      return {
        disposition: { kind: "failed", failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
        evidence: { ...evidence, failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
      };
    },
  };
}

export interface CredentialLifecycleHandlerDeps {
  readonly reader: LifecycleReader;
  readonly gateway: LifecycleGateway;
  readonly identity: WorkerIdentity;
  trustedTime(scope: { readonly deviceRecordId: string }): Promise<TrustedTimeEvaluation>;
}

export function credentialLifecycleHandler(deps: CredentialLifecycleHandlerDeps): JobHandler {
  return {
    jobKind: CREDENTIAL_LIFECYCLE_JOB_KIND,
    async handle(job: DurableJob): Promise<HandlerResult> {
      const deviceRecordId = requiredString(job, "deviceRecordId");
      const purpose = requiredString(job, "purpose");

      const trustedTime = await deps.trustedTime({ deviceRecordId });
      const outcome = await advanceDeviceCredentialLifecycle(
        {
          deviceRecordId,
          environment: job.environment as never,
          purpose,
          trustedTime,
          actorRef: deps.identity.serviceIdentity,
          idempotencyKey: job.dedupeKey,
        },
        deps.reader,
        deps.gateway,
      );

      const classification = outcome.classification;
      const evidence = {
        observedBusinessState: `classification=${classification ?? "none"}`,
        calledOperation: "advanceDeviceCredentialLifecycle",
        operationResult: `${outcome.outcome}:${classification ?? outcome.refusalCode ?? "none"}`,
        failureCode: null as string | null,
        correlationId: null as string | null,
      };

      if (outcome.outcome === "REFUSED") {
        const code =
          outcome.refusalCode === "LIFECYCLE_NO_TRUSTED_TIME"
            ? "TRUSTED_TIME_UNAVAILABLE"
            : outcome.refusalCode === "LIFECYCLE_ACTION_FAILED"
              ? "DATABASE_UNAVAILABLE"
              : "UNKNOWN_LIFECYCLE_COMBINATION";
        return {
          disposition: { kind: "failed", failureCode: code },
          evidence: { ...evidence, failureCode: code },
        };
      }

      if (classification !== undefined && LIFECYCLE_HUMAN.has(classification)) {
        return {
          disposition: { kind: "failed", failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
          evidence: { ...evidence, failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
        };
      }

      // The overlap is still running. Come back at the AUTHORITATIVE boundary —
      // the persisted overlap_ends_at the database granted — never at a freshly
      // invented duration. A worker that picked its own interval would be
      // deciding a business deadline with a scheduler's clock.
      if (classification === "OVERLAP_ACTIVE") {
        const boundary = outcome.overlapEndsAt;
        if (boundary == null) {
          return {
            disposition: { kind: "failed", failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
            evidence: { ...evidence, failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
          };
        }
        return {
          disposition: {
            kind: "deferred",
            nextAttemptAt: boundary,
            reason: "OVERLAP_ACTIVE_UNTIL_AUTHORITATIVE_BOUNDARY",
          },
          evidence,
        };
      }

      // The overlap has expired but the retirement did not land in this run.
      // Retryable: the state is unambiguous and the same call will finish it.
      if (classification === "OVERLAP_EXPIRED") {
        return {
          disposition: { kind: "failed", failureCode: "DATABASE_UNAVAILABLE" },
          evidence: { ...evidence, failureCode: "DATABASE_UNAVAILABLE" },
        };
      }

      // Destruction that a policy actually authorized and that is genuinely
      // pending. Unreachable while KLREQ-031 is unresolved, and deliberately
      // NOT written as a retry of the policy question itself.
      if (classification === "KEY_DESTRUCTION_PENDING") {
        return {
          disposition: { kind: "failed", failureCode: "PROVIDER_TIMEOUT" },
          evidence: { ...evidence, failureCode: "PROVIDER_TIMEOUT" },
        };
      }

      if (classification !== undefined && LIFECYCLE_DONE.has(classification)) {
        return {
          disposition: {
            kind: "completed",
            resultCode:
              outcome.outcome === "REPLAYED" ? "JOB_RESULT_REPLAYED" : (classification as string),
          },
          evidence,
        };
      }

      return {
        disposition: { kind: "failed", failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
        evidence: { ...evidence, failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
      };
    },
  };
}

/**
 * Cleanup EVALUATION. Never cleanup.
 *
 * This handler reads an eligibility answer and completes. It has no reference
 * to a destroy operation — not a disabled one, not a guarded one, none — so
 * there is no branch anyone could flip to make it destroy a key. While
 * KLREQ-031 is unresolved the answer is always eligible-but-unauthorized, and
 * that is a completed job rather than a retry, because asking an absent owner
 * decision a sixth time produces the fifth answer.
 */
export function keyCleanupEvaluateHandler(deps: CredentialLifecycleHandlerDeps): JobHandler {
  return {
    jobKind: KEY_CLEANUP_EVALUATE_JOB_KIND,
    async handle(job: DurableJob): Promise<HandlerResult> {
      const deviceRecordId = requiredString(job, "deviceRecordId");
      const purpose = requiredString(job, "purpose");

      const state = await deps.reader.loadLifecycleState({
        deviceRecordId,
        environment: job.environment,
        purpose,
      });
      if (state === null) {
        return {
          disposition: { kind: "failed", failureCode: "UNKNOWN_LIFECYCLE_COMBINATION" },
          evidence: {
            observedBusinessState: "no-lifecycle-state",
            calledOperation: "loadLifecycleState",
            operationResult: "the device has no credential head",
            failureCode: "UNKNOWN_LIFECYCLE_COMBINATION",
            correlationId: null,
          },
        };
      }

      // Trusted time is passed so an APPROVED destruction can be recognised at
      // all. Omitting it made every evaluation fail closed for ever — safe, but
      // it would have left the four-eyes workflow permanently unreachable and
      // the failure indistinguishable from "nobody approved it".
      const trustedTime = await deps.trustedTime({ deviceRecordId });
      const eligibility = evaluateKeyDestruction(state, trustedTime.trustedTime);

      const evidence = {
        observedBusinessState: `eligible=${eligibility.eligible} authorized=${eligibility.authorized}`,
        calledOperation: "evaluateKeyDestruction",
        operationResult: eligibility.authorized
          ? "KEY_DESTRUCTION_AUTHORIZED"
          : "KEY_DESTRUCTION_NOT_AUTHORIZED",
        failureCode: null as string | null,
        correlationId: null as string | null,
      };

      if (!eligibility.authorized) {
        // Completed, not retried, not failed. The evaluation succeeded; the
        // answer is "no one has decided". Recorded as a policy-blocked result.
        return {
          disposition: { kind: "completed", resultCode: "KEY_DESTRUCTION_NOT_AUTHORIZED" },
          evidence,
        };
      }

      // Authorized AND eligible. There is still no destroy call here: the act
      // of destruction belongs to a governed operation that does not exist
      // until KLREQ-031 is answered and one is built.
      return {
        disposition: {
          kind: "completed",
          resultCode: "KEY_DESTRUCTION_ELIGIBLE_AWAITING_OPERATION",
        },
        evidence,
      };
    },
  };
}
