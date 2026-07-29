/**
 * Credential overlap expiry and superseded-key lifecycle — focused unit tests.
 *
 * The boundary is exercised on all three sides — before, exactly at, and after
 * — because "exactly at" is where a half-open interval either holds or opens a
 * one-millisecond hole.
 */
import { describe, it, expect } from "vitest";

import {
  advanceDeviceCredentialLifecycle,
  classifyLifecycle,
  evaluateKeyDestruction,
  lifecycleRequiresHumanReview,
  overlapIsActive,
  permittedOverlapFrom,
  type KeyDestructionPolicy,
  type LifecycleAuditRecord,
  type LifecycleGateway,
  type LifecycleInput,
  type LifecycleReader,
  type ObservedLifecycleState,
} from "../src/credential-lifecycle.js";
import type { TrustedTimeEvaluation, TrustedTimeStatus } from "../src/trusted-time.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const CURRENT_ID = "33333333-3333-4333-8333-333333333333";
const PREVIOUS_ID = "22222222-2222-4222-8222-222222222222";
const SHARED_FP = "a".repeat(64);
const OLD_FP = "b".repeat(64);
const NEW_FP = "c".repeat(64);

const NOW = new Date("2026-07-22T00:00:00.000Z");
const OVERLAP_END = new Date("2026-07-25T00:00:00.000Z");
const MS_PER_DAY = 86_400_000;

function trustedAt(instant: Date): TrustedTimeEvaluation {
  return {
    status: "trusted",
    trustedTime: instant,
    source: "authenticated_network",
    floorAdvanced: true,
    anomalyType: null,
    detail: "unit fixture",
  };
}

function untrusted(status: TrustedTimeStatus): TrustedTimeEvaluation {
  return {
    status,
    trustedTime: null,
    source: "none",
    floorAdvanced: false,
    anomalyType: status,
    detail: "unit fixture",
  };
}

/** No owner decision exists, which is the shipped reality. */
const NO_POLICY: KeyDestructionPolicy = {
  destructionEnabled: false,
  minimumRetentionDays: null,
  recoveryRetentionDays: null,
  requiresOperatorApproval: true,
  approvedByDecisionRef: null,
  requiredOwnerDecision: "[REQUIRED: device_key_destruction_owner_decision]",
};

const NO_BLOCKERS = {
  referencingCredentialIds: [] as readonly string[],
  unfinishedIssuanceCount: 0,
  openRenewalCount: 0,
  activationPendingCount: 0,
  openReconciliationCount: 0,
  manualReviewOutstanding: false,
};

/** A ROTATION world: two credentials, two distinct keys. */
function rotated(overrides: Partial<ObservedLifecycleState> = {}): ObservedLifecycleState {
  return {
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    headGeneration: 2,
    headPreviousGeneration: 1,
    overlapEndsAt: OVERLAP_END,
    currentCredential: {
      credentialId: CURRENT_ID,
      certificateGeneration: 2,
      publicKeyFingerprint: NEW_FP,
      state: "issued",
      notAfter: new Date(NOW.getTime() + 30 * MS_PER_DAY),
    },
    previousCredential: {
      credentialId: PREVIOUS_ID,
      certificateGeneration: 1,
      publicKeyFingerprint: OLD_FP,
      state: "issued",
      notAfter: new Date(NOW.getTime() + 9 * MS_PER_DAY),
    },
    currentKey: {
      providerKeyReference: "dev-replacement:new",
      publicKeyFingerprint: NEW_FP,
      generation: 2,
      keyGeneration: 2,
      state: "active",
    },
    previousKey: {
      providerKeyReference: "dev-device:old",
      publicKeyFingerprint: OLD_FP,
      generation: 1,
      keyGeneration: 1,
      state: "superseded",
    },
    destructionPolicy: NO_POLICY,
    retention: NO_BLOCKERS,
    ...overrides,
  };
}

/** A SAME-KEY world: two credentials, ONE shared key that stays active. */
function sameKey(overrides: Partial<ObservedLifecycleState> = {}): ObservedLifecycleState {
  const base = rotated();
  return {
    ...base,
    currentCredential: { ...base.currentCredential!, publicKeyFingerprint: SHARED_FP },
    previousCredential: { ...base.previousCredential!, publicKeyFingerprint: SHARED_FP },
    currentKey: {
      providerKeyReference: "dev-device:shared",
      publicKeyFingerprint: SHARED_FP,
      generation: 1,
      keyGeneration: 1,
      state: "active",
    },
    previousKey: {
      providerKeyReference: "dev-device:shared",
      publicKeyFingerprint: SHARED_FP,
      generation: 1,
      keyGeneration: 1,
      state: "active",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function harness(
  states: ObservedLifecycleState[],
  options: { retireOutcome?: string; retireThrows?: string; auditThrows?: boolean } = {},
) {
  const audited: LifecycleAuditRecord[] = [];
  const retirements: unknown[] = [];
  let index = 0;
  const reader: LifecycleReader = {
    async loadLifecycleState() {
      const s = states[Math.min(index, states.length - 1)]!;
      index += 1;
      return s;
    },
  };
  const gateway: LifecycleGateway = {
    async retireOverlappedCredential(i) {
      retirements.push(i);
      if (options.retireThrows !== undefined) throw new Error(options.retireThrows);
      return { outcome: options.retireOutcome ?? "RETIRED", previousCredentialId: PREVIOUS_ID };
    },
    async recordLifecycleEvent(r) {
      if (options.auditThrows === true) throw new Error("audit unavailable");
      audited.push(r);
      return { lifecycleExecutionId: `life-${audited.length}` };
    },
  };
  return { reader, gateway, audited, retirements };
}

function input(overrides: Partial<LifecycleInput> = {}): LifecycleInput {
  return {
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    trustedTime: trustedAt(NOW),
    actorRef: "UNIT-LIFECYCLE",
    idempotencyKey: "a".repeat(64),
    ...overrides,
  };
}

// ===========================================================================
// The boundary
// ===========================================================================
describe("overlap boundary", () => {
  it("is HALF-OPEN: usable before, spent exactly at, spent after", () => {
    const oneBefore = new Date(OVERLAP_END.getTime() - 1);
    expect(overlapIsActive(OVERLAP_END, oneBefore)).toBe(true);
    // EXACTLY at the boundary is EXPIRED. `trusted_now >= overlap_end`, stated
    // identically in the verifier and in retire_overlapped_credential_v1, so no
    // millisecond gap can open between the layers.
    expect(overlapIsActive(OVERLAP_END, OVERLAP_END)).toBe(false);
    expect(overlapIsActive(OVERLAP_END, new Date(OVERLAP_END.getTime() + 1))).toBe(false);
    expect(overlapIsActive(null, NOW)).toBe(false);
  });

  it("classifies before the boundary as active", () => {
    expect(classifyLifecycle(rotated(), NOW).classification).toBe("OVERLAP_ACTIVE");
  });

  it("classifies exactly at the boundary as expired", () => {
    expect(classifyLifecycle(rotated(), OVERLAP_END).classification).toBe("OVERLAP_EXPIRED");
  });

  it("classifies after the boundary as expired", () => {
    const after = new Date(OVERLAP_END.getTime() + MS_PER_DAY);
    expect(classifyLifecycle(rotated(), after).classification).toBe("OVERLAP_EXPIRED");
  });

  it("refuses to advance without trusted time", async () => {
    const h = harness([rotated()]);
    for (const status of [
      "uninitialized",
      "restricted_clock_rollback",
      "restricted_forward_jump",
    ] as const) {
      const outcome = await advanceDeviceCredentialLifecycle(
        input({ trustedTime: untrusted(status) }),
        h.reader,
        h.gateway,
      );
      expect(outcome.refusalCode).toBe("LIFECYCLE_NO_TRUSTED_TIME");
    }
    expect(h.retirements).toHaveLength(0);
  });
});

// ===========================================================================
// The overlap grant
// ===========================================================================
describe("the overlap grant is built from authoritative state", () => {
  it("is offered only while the window is open", () => {
    expect(permittedOverlapFrom(rotated(), NOW)).not.toBeNull();
    expect(permittedOverlapFrom(rotated(), OVERLAP_END)).toBeNull();
  });

  it("carries the previous credential's PERSISTED state, so a retired one cannot be revived", () => {
    const grant = permittedOverlapFrom(rotated(), NOW);
    expect(grant?.previousCredentialState).toBe("issued");
    // Once retired the grant still exists as an object but the verifier refuses
    // it — proven in the certificate-validity suite. Here the point is that the
    // state is CARRIED rather than assumed.
    const retired = permittedOverlapFrom(
      rotated({ previousCredential: { ...rotated().previousCredential!, state: "superseded" } }),
      NOW,
    );
    expect(retired?.previousCredentialState).toBe("superseded");
  });

  it("refuses a generation GAP — an overlap is the immediately previous one", () => {
    const gapped = rotated({
      headGeneration: 4,
      headPreviousGeneration: 1,
      currentCredential: { ...rotated().currentCredential!, certificateGeneration: 4 },
    });
    expect(permittedOverlapFrom(gapped, NOW)).toBeNull();
  });

  it("offers nothing when the head records no previous generation", () => {
    expect(
      permittedOverlapFrom(
        rotated({ headPreviousGeneration: null, previousCredential: null }),
        NOW,
      ),
    ).toBeNull();
  });
});

// ===========================================================================
// Same-key
// ===========================================================================
describe("same-key lifecycle", () => {
  it("retires the previous credential and keeps the shared key active", async () => {
    const before = sameKey();
    const after = sameKey({
      previousCredential: { ...before.previousCredential!, state: "superseded" },
    });
    const h = harness([before, after]);
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );

    expect(outcome.outcome).toBe("ADVANCED");
    expect(outcome.classification).toBe("PREVIOUS_CREDENTIAL_RETIRED");
    expect(h.retirements).toHaveLength(1);
    // The shared key is retained, and the result says so rather than implying it.
    expect(outcome.providerKeyAction).toContain("retained");
  });

  it("never makes the shared current key destruction-eligible", () => {
    const state = sameKey({
      previousCredential: { ...sameKey().previousCredential!, state: "superseded" },
    });
    const eligibility = evaluateKeyDestruction(state);

    expect(eligibility.eligible).toBe(false);
    // The FIRST reason is the one that matters: a routine same-key renewal must
    // never nominate the device's only working key for destruction.
    expect(eligibility.blockers[0]).toContain("CURRENT credential");
    expect(eligibility.authorized).toBe(false);
  });

  it("is idempotent: a second advancement replays", async () => {
    const retiredState = sameKey({
      previousCredential: { ...sameKey().previousCredential!, state: "superseded" },
    });
    const h = harness([retiredState], { retireOutcome: "ALREADY_RETIRED" });
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );
    // The previous credential is already retired, so the classification is
    // about the KEY, and no retirement call is made at all.
    expect(outcome.classification).toBe("KEY_STILL_REFERENCED");
    expect(outcome.outcome).toBe("REPLAYED");
    expect(h.retirements).toHaveLength(0);
  });

  it("leaves the current credential untouched", async () => {
    const before = sameKey();
    const h = harness([before, before]);
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );
    expect(outcome.currentCredentialGeneration).toBe(2);
    expect(outcome.currentCredentialId).toBe(CURRENT_ID);
  });
});

// ===========================================================================
// Rotation
// ===========================================================================
describe("rotation lifecycle", () => {
  it("keeps the superseded key during the overlap and destroys nothing", async () => {
    const h = harness([rotated()]);
    const outcome = await advanceDeviceCredentialLifecycle(input(), h.reader, h.gateway);

    expect(outcome.classification).toBe("OVERLAP_ACTIVE");
    expect(outcome.outcome).toBe("NO_ACTION");
    expect(outcome.providerKeyAction).toContain("must survive the overlap");
    expect(h.retirements).toHaveLength(0);
  });

  it("makes the old key eligible only after the credential is retired", () => {
    // Still issued: not eligible, because retirement has not happened.
    const duringOverlap = evaluateKeyDestruction(rotated());
    expect(duringOverlap.eligible).toBe(false);
    expect(duringOverlap.blockers.some((b) => b.includes("not been retired"))).toBe(true);

    const afterRetirement = evaluateKeyDestruction(
      rotated({
        previousCredential: { ...rotated().previousCredential!, state: "superseded" },
      }),
    );
    expect(afterRetirement.eligible).toBe(true);
    // ELIGIBLE is still not AUTHORIZED.
    expect(afterRetirement.authorized).toBe(false);
  });

  it("never makes the current replacement key eligible", () => {
    const state = rotated({
      previousCredential: { ...rotated().previousCredential!, state: "superseded" },
      // A world where the "previous" key IS the current one — the shape a bug
      // would produce.
      previousKey: { ...rotated().currentKey! },
    });
    const eligibility = evaluateKeyDestruction(state);
    expect(eligibility.eligible).toBe(false);
    expect(
      eligibility.blockers.some((b) => /CURRENT credential|current provider key/.test(b)),
    ).toBe(true);
  });

  const blockers: ReadonlyArray<readonly [string, Partial<typeof NO_BLOCKERS>]> = [
    ["an unfinished issuance", { unfinishedIssuanceCount: 1 }],
    ["an open renewal", { openRenewalCount: 1 }],
    ["a key awaiting activation", { activationPendingCount: 1 }],
    ["an unresolved reconciliation", { openReconciliationCount: 1 }],
    ["another credential referencing the key", { referencingCredentialIds: ["other-cred"] }],
  ];

  for (const [name, retention] of blockers) {
    it(`blocks destruction while there is ${name}`, () => {
      const state = rotated({
        previousCredential: { ...rotated().previousCredential!, state: "superseded" },
        retention: { ...NO_BLOCKERS, ...retention },
      });
      const eligibility = evaluateKeyDestruction(state);
      expect(eligibility.eligible).toBe(false);
      expect(eligibility.blockers.length).toBeGreaterThan(0);
    });
  }

  it("requires a human when a provider/database divergence is outstanding", async () => {
    const state = rotated({
      retention: { ...NO_BLOCKERS, manualReviewOutstanding: true },
    });
    const h = harness([state]);
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );
    expect(outcome.classification).toBe("MANUAL_REVIEW_REQUIRED");
    expect(outcome.refusalCode).toBe("LIFECYCLE_MANUAL_REVIEW");
    expect(h.retirements).toHaveLength(0);
    // Recorded even though refused — that is the evidence a human needs.
    expect(h.audited).toHaveLength(1);
  });
});

// ===========================================================================
// Destruction policy
// ===========================================================================
describe("destruction policy", () => {
  it("is NOT authorized while no owner decision exists", () => {
    const eligibility = evaluateKeyDestruction(
      rotated({ previousCredential: { ...rotated().previousCredential!, state: "superseded" } }),
    );
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.authorized).toBe(false);
    expect(eligibility.requiredOwnerDecision).toContain("device_key_destruction_owner_decision");
    expect(eligibility.policyReference).toBeNull();
  });

  it("classifies a fully unblocked key as NOT AUTHORIZED rather than destroying it", async () => {
    const state = rotated({
      previousCredential: { ...rotated().previousCredential!, state: "superseded" },
    });
    const h = harness([state]);
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );

    expect(outcome.classification).toBe("KEY_DESTRUCTION_NOT_AUTHORIZED");
    expect(outcome.providerKeyAction).toContain("retained");
    expect(outcome.reason).toContain("owner decision");
    // Nothing was destroyed, and the record says which decision is missing.
    expect(h.audited[0]?.destructionPolicyReference).toContain(
      "device_key_destruction_owner_decision",
    );
    expect(h.audited[0]?.providerResult).toBeNull();
  });

  it("requires BOTH a decision reference and both retention periods to authorize", () => {
    const partial: ReadonlyArray<Partial<KeyDestructionPolicy>> = [
      { destructionEnabled: true, approvedByDecisionRef: null },
      { destructionEnabled: true, approvedByDecisionRef: "KLD-X", minimumRetentionDays: null },
      {
        destructionEnabled: true,
        approvedByDecisionRef: "KLD-X",
        minimumRetentionDays: 30,
        recoveryRetentionDays: null,
      },
    ];
    for (const policy of partial) {
      const eligibility = evaluateKeyDestruction(
        rotated({
          previousCredential: { ...rotated().previousCredential!, state: "superseded" },
          destructionPolicy: { ...NO_POLICY, ...policy },
        }),
      );
      expect(eligibility.authorized).toBe(false);
    }

    // Complete policy: authorized. Eligibility and authorization are separate,
    // and both must hold.
    const complete = evaluateKeyDestruction(
      rotated({
        previousCredential: { ...rotated().previousCredential!, state: "superseded" },
        destructionPolicy: {
          destructionEnabled: true,
          approvedByDecisionRef: "KLD-TEST-DESTRUCTION",
          minimumRetentionDays: 30,
          recoveryRetentionDays: 7,
          requiresOperatorApproval: true,
          requiredOwnerDecision: null,
        },
      }),
    );
    expect(complete.authorized).toBe(true);
    expect(complete.eligible).toBe(true);
  });
});

// ===========================================================================
// Divergence, audit and idempotency
// ===========================================================================
describe("divergence, audit and idempotency", () => {
  const divergences: ReadonlyArray<readonly [string, Partial<ObservedLifecycleState>]> = [
    ["the head points at no credential", { currentCredential: null }],
    [
      "the current credential is not at the head generation",
      { currentCredential: { ...rotated().currentCredential!, certificateGeneration: 9 } },
    ],
    ["the head names a previous generation with no credential", { previousCredential: null }],
  ];

  for (const [name, override] of divergences) {
    it(`fails closed when ${name}`, async () => {
      const h = harness([rotated(override)]);
      const outcome = await advanceDeviceCredentialLifecycle(
        input({ trustedTime: trustedAt(OVERLAP_END) }),
        h.reader,
        h.gateway,
      );
      expect(lifecycleRequiresHumanReview(outcome.classification!)).toBe(true);
      expect(h.retirements).toHaveLength(0);
    });
  }

  it("refuses to retire anything while the CURRENT credential is not issued", async () => {
    const h = harness([
      rotated({ currentCredential: { ...rotated().currentCredential!, state: "revoked" } }),
    ]);
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );
    expect(outcome.classification).toBe("MANUAL_REVIEW_REQUIRED");
    expect(outcome.reason).toContain("nothing");
    expect(h.retirements).toHaveLength(0);
  });

  it("records every field the lifecycle evidence contract requires", async () => {
    const h = harness([rotated(), rotated()]);
    await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );
    const record = h.audited[0]!;

    expect(record.deviceRecordId).toBe(DEVICE);
    expect(record.trustedTimeStatus).toBe("trusted");
    expect(record.trustedTimeSource).toBe("authenticated_network");
    expect(record.currentCredentialGeneration).toBe(2);
    expect(record.previousCredentialGeneration).toBe(1);
    expect(record.overlapEndsAt).toEqual(OVERLAP_END);
    expect(record.classification).not.toBe("");
    expect(record.credentialTransition).not.toBe("");
    expect(record.providerKeyTransition).not.toBe("");
    expect(record.actorRef).toBe("UNIT-LIFECYCLE");
    expect(record.replayOutcome).not.toBe("");
    // Lifecycle names only.
    const flattened = JSON.stringify(record);
    expect(flattened).not.toContain("PRIVATE KEY");
    expect(flattened).not.toContain("postgresql://");
  });

  it("refuses when the advancement cannot be recorded", async () => {
    const h = harness([rotated()], { auditThrows: true });
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );
    expect(outcome.outcome).toBe("REFUSED");
    expect(outcome.detail).toContain("could not be recorded");
  });

  it("reports a failed retirement rather than claiming progress", async () => {
    const h = harness([rotated()], { retireThrows: "KLUY-LIFECYCLE-NO-HEAD: nothing to advance" });
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );
    expect(outcome.refusalCode).toBe("LIFECYCLE_ACTION_FAILED");
    expect(outcome.detail).toContain("KLUY-LIFECYCLE-NO-HEAD");
  });

  it("produces one business effect when two executors race", async () => {
    // Both see the same pre-state; the database function is idempotent, so the
    // loser gets ALREADY_RETIRED rather than retiring a second time.
    const first = harness([rotated()], { retireOutcome: "RETIRED" });
    const second = harness([rotated()], { retireOutcome: "ALREADY_RETIRED" });
    const [a, b] = await Promise.all([
      advanceDeviceCredentialLifecycle(
        input({ trustedTime: trustedAt(OVERLAP_END) }),
        first.reader,
        first.gateway,
      ),
      advanceDeviceCredentialLifecycle(
        input({ trustedTime: trustedAt(OVERLAP_END) }),
        second.reader,
        second.gateway,
      ),
    ]);

    expect(a.outcome).toBe("ADVANCED");
    expect(b.outcome).toBe("REPLAYED");
    expect(b.replayOutcome).toBe("replayed");
    // One real retirement between them.
    expect([a.outcome, b.outcome].filter((o) => o === "ADVANCED")).toHaveLength(1);
  });

  it("does nothing when the head records no previous generation at all", async () => {
    const h = harness([rotated({ headPreviousGeneration: null, previousCredential: null })]);
    const outcome = await advanceDeviceCredentialLifecycle(
      input({ trustedTime: trustedAt(OVERLAP_END) }),
      h.reader,
      h.gateway,
    );
    expect(outcome.classification).toBe("NO_ACTION_CURRENT");
    expect(outcome.outcome).toBe("NO_ACTION");
    expect(h.retirements).toHaveLength(0);
  });

  it("refuses a lifecycle state loaded for another device", async () => {
    const h = harness([rotated({ deviceRecordId: "99999999-9999-4999-8999-999999999999" })]);
    const outcome = await advanceDeviceCredentialLifecycle(input(), h.reader, h.gateway);
    expect(outcome.refusalCode).toBe("LIFECYCLE_WRONG_SCOPE");
  });

  it("refuses when no head exists", async () => {
    const outcome = await advanceDeviceCredentialLifecycle(
      input(),
      {
        async loadLifecycleState() {
          return null;
        },
      },
      harness([rotated()]).gateway,
    );
    expect(outcome.refusalCode).toBe("LIFECYCLE_NO_HEAD");
  });
});
