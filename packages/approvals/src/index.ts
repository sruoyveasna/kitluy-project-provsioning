/**
 * @kitluy/approvals — sensitive-action approval classes and four-eyes contracts.
 *
 * Source authority: rebuild bible v4.0.0 §8.7 (approval classes A0–A4) and
 * §8.8 (four-eyes list; "The requester cannot approve their own request").
 *
 * STATUS: BUILT + TESTED (test/approvals.test.ts). Persistence and workflow
 * engines are later implementations; these contracts are the shared truth.
 */
import type { UserId } from "@kitluy/shared-types";

/** Approval classes (RB v4 §8.7). */
export const APPROVAL_CLASSES = [
  "A0_READ",
  "A1_STANDARD_MUTATION",
  "A2_REAUTH_MUTATION",
  "A3_FOUR_EYES",
  "A4_OWNER_SECURITY",
] as const;
export type ApprovalClass = (typeof APPROVAL_CLASSES)[number];

export interface ApprovalRequest {
  readonly requestId: string;
  readonly approvalClass: ApprovalClass;
  /** Bound to one action + entity + parameters (POS spec v4 §4.4). */
  readonly actionKey: string;
  readonly requestedBy: UserId;
  /** Reason is mandatory for A2 and above. */
  readonly reason: string;
  readonly requestedAt: string; // ISO-8601
}

export interface ApprovalDecision {
  readonly requestId: string;
  readonly approvedBy: UserId;
  readonly decision: "approved" | "rejected";
  readonly decidedAt: string; // ISO-8601
}

export class ApprovalError extends Error {
  constructor(
    readonly code: "SELF_APPROVAL_FORBIDDEN" | "REASON_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalError";
  }
}

/**
 * Validate a four-eyes decision: the requester can never approve their own
 * request (RB v4 §8.8). Throws on violation; returns the decision otherwise.
 */
export function assertFourEyes(
  request: ApprovalRequest,
  decision: ApprovalDecision,
): ApprovalDecision {
  if (request.requestedBy === decision.approvedBy) {
    throw new ApprovalError(
      "SELF_APPROVAL_FORBIDDEN",
      "The requester cannot approve their own request (RB v4 §8.8).",
    );
  }
  return decision;
}

/** Reason text is mandatory for A2_REAUTH_MUTATION and above. */
export function requiresReason(cls: ApprovalClass): boolean {
  return cls === "A2_REAUTH_MUTATION" || cls === "A3_FOUR_EYES" || cls === "A4_OWNER_SECURITY";
}

export function validateRequest(request: ApprovalRequest): ApprovalRequest {
  if (requiresReason(request.approvalClass) && request.reason.trim() === "") {
    throw new ApprovalError(
      "REASON_REQUIRED",
      `Approval class ${request.approvalClass} requires a reason.`,
    );
  }
  return request;
}
