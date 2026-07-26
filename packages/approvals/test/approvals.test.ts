import { describe, expect, it } from "vitest";
import { asId } from "@kitluy/shared-types";
import {
  APPROVAL_CLASSES,
  ApprovalError,
  assertFourEyes,
  requiresReason,
  validateRequest,
} from "../src/index.js";

const request = {
  requestId: "req-1",
  approvalClass: "A3_FOUR_EYES" as const,
  actionKey: "releases.promote.stable",
  requestedBy: asId.userId("user-a"),
  reason: "Promote build 42 to Stable after pilot sign-off",
  requestedAt: "2026-07-26T08:00:00+07:00",
};

describe("@kitluy/approvals", () => {
  it("defines the five approval classes A0-A4", () => {
    expect(APPROVAL_CLASSES).toEqual([
      "A0_READ",
      "A1_STANDARD_MUTATION",
      "A2_REAUTH_MUTATION",
      "A3_FOUR_EYES",
      "A4_OWNER_SECURITY",
    ]);
  });

  it("the requester cannot approve their own request", () => {
    expect(() =>
      assertFourEyes(request, {
        requestId: "req-1",
        approvedBy: asId.userId("user-a"),
        decision: "approved",
        decidedAt: "2026-07-26T08:05:00+07:00",
      }),
    ).toThrow(ApprovalError);
  });

  it("a different approver is accepted", () => {
    const decision = assertFourEyes(request, {
      requestId: "req-1",
      approvedBy: asId.userId("user-b"),
      decision: "approved",
      decidedAt: "2026-07-26T08:05:00+07:00",
    });
    expect(decision.decision).toBe("approved");
  });

  it("A2 and above require a reason", () => {
    expect(requiresReason("A0_READ")).toBe(false);
    expect(requiresReason("A1_STANDARD_MUTATION")).toBe(false);
    expect(requiresReason("A2_REAUTH_MUTATION")).toBe(true);
    expect(() => validateRequest({ ...request, reason: "  " })).toThrow(/requires a reason/);
    expect(validateRequest(request)).toBe(request);
  });
});
