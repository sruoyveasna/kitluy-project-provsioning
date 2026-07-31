/**
 * Scheduling the post-approval lapse obligation.
 *
 * Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.4 RULING 4 (the
 * deadline may be shortened but never extended, reset or renewed); WS-11-T003
 * Step 4 final completion §3.
 *
 * ===========================================================================
 * THE CHAIN THIS COMPLETES
 * ===========================================================================
 *   emergency authorization created (route)
 *     -> fixed post-approval deadline stored (database, from policy)
 *     -> durable lapse job scheduled            <- THIS FILE
 *     -> worker claims job                      (lapse-worker.ts)
 *     -> governed lapse function invoked        (group 0155)
 *     -> MANUAL_SECURITY_REVIEW + escalation    (group 0152)
 *
 * Until now the middle link did not exist: the worker existed and nothing ever
 * enqueued its job kind, so the only mechanism that converts an unreviewed
 * emergency into a LAPSED verdict would never have fired in a deployed system.
 *
 * ===========================================================================
 * THE PAYLOAD CARRIES ONE FIELD
 * ===========================================================================
 * The authorization id, and nothing else. Not the deadline — RULING 4 forbids a
 * deadline any automated step could set, because a deadline an escalation can
 * write is a deadline an attacker who delays the approver can keep pushing out.
 * Not the actor, reason, incident or scope: all are read from the stored row by
 * the governed function.
 *
 * `postApprovalDueAt` IS used, for exactly one thing: `runAt`. That is a
 * scheduling hint about when to first ask, not an input to the decision. The
 * governed function re-reads the stored deadline and compares against DATABASE
 * time, so a wrong hint can only make the worker ask early and be told NOT_DUE.
 */
import type { DurableJobGateway } from "@kitluy/job-contracts";

import { EMERGENCY_LAPSE_JOB_KIND, emergencyLapseDedupeKey } from "./lapse-worker.js";

export interface ScheduleLapseRequest {
  /** IMMUTABLE. The only thing that reaches the payload. */
  readonly authorizationId: string;
  readonly environment: string;
  /** ISO instant from the governed emergency result, or null. Hint only. */
  readonly postApprovalDueAt: string | null;
  readonly actorRef: string;
}

export interface ScheduleLapseResult {
  readonly scheduled: boolean;
  readonly jobId: string | null;
  readonly outcome: "CREATED" | "EXISTING" | "REFUSED";
  readonly detail?: string;
}

export interface EmergencyLapseScheduler {
  scheduleLapse(request: ScheduleLapseRequest): Promise<ScheduleLapseResult>;
}

/**
 * Attempts a lapse job per emergency, and NEVER fails the emergency.
 *
 * The ordering is deliberate and the failure mode is chosen. A revocation that
 * already committed must not be reported as failed because its follow-up
 * obligation could not be queued — the credential is dead either way, and
 * containment is the urgent half. So a scheduling failure returns
 * `scheduled: false` with a reason, the route surfaces it, and the group 0152
 * ENVIRONMENT sweeper remains the safety net that catches an obligation whose job
 * was never enqueued.
 *
 * That safety net is why this is allowed to be best-effort at all. Without it,
 * a swallowed scheduling failure would mean a four-eyes obligation that silently
 * never closes.
 */
export function createEmergencyLapseScheduler(
  gateway: DurableJobGateway,
  options: { readonly maxAttempts?: number } = {},
): EmergencyLapseScheduler {
  return {
    async scheduleLapse(request: ScheduleLapseRequest): Promise<ScheduleLapseResult> {
      try {
        const result = await gateway.enqueue({
          jobKind: EMERGENCY_LAPSE_JOB_KIND,
          jobVersion: 1,
          // DETERMINISTIC, and keyed on the authorization ALONE. Group 0138 lets
          // the deadline be brought forward; including it would open a second
          // obligation each time it moved, so an earlier deadline must reuse this
          // job rather than create another.
          dedupeKey: emergencyLapseDedupeKey(request.authorizationId),
          environment: request.environment,
          subjectId: request.authorizationId,
          payload: { authorizationId: request.authorizationId },
          maxAttempts: options.maxAttempts ?? 5,
          actorRef: request.actorRef,
        });
        return {
          scheduled: true,
          jobId: result.jobId,
          outcome: result.outcome,
        };
      } catch {
        // The raw fault is deliberately not propagated or logged here: it would
        // carry job-table names and driver text into an emergency response path.
        return {
          scheduled: false,
          jobId: null,
          outcome: "REFUSED",
          detail:
            "the lapse obligation could not be queued; the group 0152 environment sweeper remains the safety net",
        };
      }
    },
  };
}
