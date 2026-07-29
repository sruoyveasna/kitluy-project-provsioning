/**
 * Governed provider-key destruction — service and provider behaviour.
 *
 * Authority: KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 (KLREQ-031); migration
 * group 0137; WS-11-T003 Step 4 §8/§9/§11.
 *
 * WHAT THIS FILE DOES NOT PROVE. Retention windows, holds, four-eyes and the
 * attempt budget are enforced in the DATABASE, and a stub gateway asserting
 * them here would prove only that the stub agrees with itself. Those live in
 * `key-destruction.integration.test.ts` against the real functions. What IS
 * proved here is the ordering the database cannot enforce, because the database
 * cannot observe the provider call: that nothing is confirmed without evidence.
 */
import { describe, expect, it } from "vitest";

import {
  DESTRUCTION_RETENTION_DAYS,
  MAX_DESTRUCTION_EXECUTION_ATTEMPTS,
  approveProviderKeyDestruction,
  destructionAttemptPermitted,
  executeProviderKeyDestruction,
  requestProviderKeyDestruction,
  type DestructionExecutionInput,
  type KeyDestructionGateway,
  type ProviderKeyDestroyer,
} from "../src/key-destruction.js";
import {
  DevelopmentReplacementKeyProvider,
  ProviderDestructionAmbiguousError,
  ReplacementKeyError,
  type ProviderDestructionReceipt,
} from "../src/replacement-key-provider.js";
import { vaultHolds, vaultSign } from "../src/dev-crypto.js";

// ---------------------------------------------------------------------------
// Recording stubs
// ---------------------------------------------------------------------------

interface Recorded {
  readonly step: string;
  readonly payload: Record<string, unknown>;
}

function gatewayReturning(
  answers: Partial<Record<string, Record<string, unknown>>>,
  log: Recorded[] = [],
): KeyDestructionGateway {
  const answer = (step: string, payload: Record<string, unknown>) => {
    log.push({ step, payload });
    return Promise.resolve(answers[step] ?? { outcome: "EXECUTION_REFUSED" });
  };
  return {
    evaluateEligibility: (c) => answer("evaluate", { ...c }),
    requestKeyDestruction: (c) => answer("request", { ...c }),
    approveKeyDestruction: (c) => answer("approve", { ...c }),
    beginKeyDestructionExecution: (c) => answer("begin", { ...c }),
    confirmKeyDestruction: (c) => answer("confirm", { ...c }),
  };
}

const EXECUTION_INPUT: DestructionExecutionInput = {
  destructionRequestId: "11111111-1111-4111-8111-111111111111",
  executedBy: "operator:executor",
  deviceRecordId: "22222222-2222-4222-8222-222222222222",
  environment: "development",
  purpose: "device_identity",
  providerKeyReference: "ref-approved",
  publicKeyFingerprint: "fp-approved",
  keyGeneration: 2,
};

function receipt(over: Partial<ProviderDestructionReceipt> = {}): ProviderDestructionReceipt {
  return {
    destructionRequestId: EXECUTION_INPUT.destructionRequestId,
    providerKeyReference: EXECUTION_INPUT.providerKeyReference,
    publicKeyFingerprint: EXECUTION_INPUT.publicKeyFingerprint,
    keyGeneration: EXECUTION_INPUT.keyGeneration,
    result: "DESTROYED",
    receiptDigest: "a".repeat(64),
    responseReference: "dev-destruction:1",
    requestedAt: new Date("2026-07-29T10:00:00.000Z"),
    completedAt: new Date("2026-07-29T10:00:01.000Z"),
    attestationKind: "development_simulated",
    ...over,
  };
}

function providerReturning(
  r: ProviderDestructionReceipt,
  calls: { n: number },
): ProviderKeyDestroyer {
  return {
    destroyProviderKey: () => {
      calls.n += 1;
      return Promise.resolve(r);
    },
  };
}

function providerThrowing(error: Error, calls: { n: number }): ProviderKeyDestroyer {
  return {
    destroyProviderKey: () => {
      calls.n += 1;
      return Promise.reject(error);
    },
  };
}

// ---------------------------------------------------------------------------

describe("KLREQ-031 policy values are data, not folklore", () => {
  it("carries the owner-approved retention windows and attempt budget verbatim", () => {
    expect(DESTRUCTION_RETENTION_DAYS.superseded).toBe(30);
    expect(DESTRUCTION_RETENTION_DAYS.abandoned).toBe(7);
    expect(DESTRUCTION_RETENTION_DAYS.recovery).toBe(14);
    expect(MAX_DESTRUCTION_EXECUTION_ATTEMPTS).toBe(5);
  });

  it("stops permitting attempts at the approved budget and not one later", () => {
    expect(destructionAttemptPermitted(4)).toBe(true);
    expect(destructionAttemptPermitted(5)).toBe(false);
    expect(destructionAttemptPermitted(6)).toBe(false);
  });
});

describe("pre-flight refusals happen before any governed call", () => {
  it("refuses a request that is not re-authenticated, without calling the gateway", async () => {
    const log: Recorded[] = [];
    const outcome = await requestProviderKeyDestruction(gatewayReturning({}, log), {
      requestKey: "rk-1",
      deviceRecordId: EXECUTION_INPUT.deviceRecordId,
      environment: "development",
      purpose: "device_identity",
      providerKeyReference: "ref-1",
      requestedBy: "operator:a",
      requestReason: "superseded key past retention",
      reauthenticated: false,
      trustedNow: "2026-07-29T10:00:00Z",
      trustedTimeStatus: "verified",
    });
    expect(outcome.outcome).toBe("DESTRUCTION_REFUSED");
    expect(outcome.refusalCode).toBe("DESTRUCTION_NOT_REAUTHENTICATED");
    expect(log).toHaveLength(0);
  });

  it("refuses an obviously self-approved destruction before the gateway sees it", async () => {
    const log: Recorded[] = [];
    const outcome = await approveProviderKeyDestruction(
      gatewayReturning({}, log),
      {
        destructionRequestId: EXECUTION_INPUT.destructionRequestId,
        approvedBy: "operator:a",
        approvalReason: "reviewed",
        reauthenticated: true,
        trustedNow: "2026-07-29T10:00:00Z",
        trustedTimeStatus: "verified",
      },
      "operator:a",
    );
    expect(outcome.outcome).toBe("DESTRUCTION_REFUSED");
    expect(outcome.refusalCode).toBe("DESTRUCTION_SELF_APPROVED");
    expect(log).toHaveLength(0);
  });
});

describe("the provider is never called unless the database cleared the attempt", () => {
  for (const refusal of [
    { outcome: "EXECUTION_REFUSED", refusal_code: "KLUY-KEYDESTROY-NOT-APPROVED" },
    { outcome: "EXECUTION_REFUSED", refusal_code: "KLUY-KEYDESTROY-APPROVAL-EXPIRED" },
    { outcome: "EXECUTION_REFUSED", refusal_code: "KLUY-KEYDESTROY-HOLD-ACTIVE" },
    { outcome: "EXECUTION_REFUSED", refusal_code: "KLUY-KEYDESTROY-ATTEMPTS-EXHAUSTED" },
    { outcome: "ALREADY_EXECUTED" },
  ]) {
    it(`does not call the provider when begin returns ${String(refusal.refusal_code ?? refusal.outcome)}`, async () => {
      const calls = { n: 0 };
      const log: Recorded[] = [];
      const outcome = await executeProviderKeyDestruction(
        gatewayReturning({ begin: refusal }, log),
        providerReturning(receipt(), calls),
        EXECUTION_INPUT,
      );
      expect(calls.n).toBe(0);
      expect(log.some((e) => e.step === "confirm")).toBe(false);
      expect(outcome.outcome).not.toBe("DESTROYED");
    });
  }

  it("refuses an unrecognised begin answer rather than treating it as permission", async () => {
    const calls = { n: 0 };
    const outcome = await executeProviderKeyDestruction(
      gatewayReturning({ begin: { outcome: "SOMETHING_NEW" } }),
      providerReturning(receipt(), calls),
      EXECUTION_INPUT,
    );
    expect(calls.n).toBe(0);
    expect(outcome.outcome).toBe("DESTRUCTION_REFUSED");
    expect(outcome.refusalCode).toBe("DESTRUCTION_UNKNOWN_OUTCOME");
  });
});

describe("the database is never told a key is destroyed without provider evidence", () => {
  it("calls the provider BEFORE it confirms, and confirms only after", async () => {
    const log: Recorded[] = [];
    const calls = { n: 0 };
    const order: string[] = [];
    const provider: ProviderKeyDestroyer = {
      destroyProviderKey: () => {
        order.push("provider");
        calls.n += 1;
        return Promise.resolve(receipt());
      },
    };
    const gateway: KeyDestructionGateway = {
      ...gatewayReturning(
        {
          begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 },
          confirm: { outcome: "DESTROYED" },
        },
        log,
      ),
    };
    const wrapped: KeyDestructionGateway = {
      ...gateway,
      confirmKeyDestruction: (c) => {
        order.push("confirm");
        return gateway.confirmKeyDestruction(c);
      },
    };

    const outcome = await executeProviderKeyDestruction(wrapped, provider, EXECUTION_INPUT);
    expect(order).toEqual(["provider", "confirm"]);
    expect(outcome.outcome).toBe("DESTROYED");
    expect(outcome.providerReceiptDigest).toBe("a".repeat(64));
  });

  for (const [label, error] of [
    ["a timeout", new ProviderDestructionAmbiguousError("ref-approved", "TIMEOUT", "no answer")],
    [
      "a connection failure",
      new ProviderDestructionAmbiguousError("ref-approved", "CONNECTION_FAILED", "socket closed"),
    ],
    [
      "an indeterminate answer",
      new ProviderDestructionAmbiguousError("ref-approved", "INDETERMINATE", "unknown"),
    ],
  ] as const) {
    it(`leaves the database non-destroyed and reconciles after ${label}`, async () => {
      const log: Recorded[] = [];
      const outcome = await executeProviderKeyDestruction(
        gatewayReturning({ begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } }, log),
        providerThrowing(error, { n: 0 }),
        EXECUTION_INPUT,
      );
      expect(outcome.outcome).toBe("RECONCILIATION_REQUIRED");
      expect(outcome.refusalCode).toBe("DESTRUCTION_PROVIDER_AMBIGUOUS");
      // The decisive assertion: confirm was never called.
      expect(log.some((e) => e.step === "confirm")).toBe(false);
    });
  }

  it("leaves the database non-destroyed when the provider refuses outright", async () => {
    const log: Recorded[] = [];
    const outcome = await executeProviderKeyDestruction(
      gatewayReturning({ begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } }, log),
      providerThrowing(
        new ReplacementKeyError("PROVIDER_KEY_FINGERPRINT_MISMATCH", "not the key we hold"),
        { n: 0 },
      ),
      EXECUTION_INPUT,
    );
    expect(outcome.outcome).toBe("DESTRUCTION_REFUSED");
    expect(outcome.refusalCode).toBe("DESTRUCTION_PROVIDER_BINDING_CHANGED");
    expect(log.some((e) => e.step === "confirm")).toBe(false);
  });

  it("leaves the database non-destroyed when the provider throws anything at all", async () => {
    const log: Recorded[] = [];
    const outcome = await executeProviderKeyDestruction(
      gatewayReturning({ begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } }, log),
      providerThrowing(new Error("boom"), { n: 0 }),
      EXECUTION_INPUT,
    );
    expect(outcome.outcome).toBe("DESTRUCTION_REFUSED");
    expect(log.some((e) => e.step === "confirm")).toBe(false);
  });
});

describe("evidence that does not describe the approved key is not evidence", () => {
  for (const [label, over] of [
    ["a changed provider reference", { providerKeyReference: "ref-other" }],
    ["a changed fingerprint", { publicKeyFingerprint: "fp-other" }],
    ["a changed key generation", { keyGeneration: 9 }],
    ["a missing receipt digest", { receiptDigest: "" }],
    ["a missing response reference", { responseReference: "" }],
  ] as const) {
    it(`refuses to confirm on ${label}`, async () => {
      const log: Recorded[] = [];
      const outcome = await executeProviderKeyDestruction(
        gatewayReturning({ begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } }, log),
        providerReturning(receipt(over), { n: 0 }),
        EXECUTION_INPUT,
      );
      expect(outcome.outcome).toBe("MANUAL_REVIEW_REQUIRED");
      expect(outcome.refusalCode).toBe("DESTRUCTION_UNVERIFIED_EVIDENCE");
      expect(log.some((e) => e.step === "confirm")).toBe(false);
    });
  }

  it("refuses a provider result that is not one of the two accepted outcomes", async () => {
    const log: Recorded[] = [];
    const outcome = await executeProviderKeyDestruction(
      gatewayReturning({ begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } }, log),
      providerReturning(receipt({ result: "NOT_FOUND" as unknown as "DESTROYED" }), { n: 0 }),
      EXECUTION_INPUT,
    );
    expect(outcome.outcome).toBe("MANUAL_REVIEW_REQUIRED");
    expect(log.some((e) => e.step === "confirm")).toBe(false);
  });

  it("never carries a provider payload into the outcome — only a redacted class", async () => {
    const outcome = await executeProviderKeyDestruction(
      gatewayReturning({ begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } }),
      providerThrowing(
        new ProviderDestructionAmbiguousError(
          "ref-approved",
          "TIMEOUT",
          "SECRET-PROVIDER-PAYLOAD-should-never-surface",
        ),
        { n: 0 },
      ),
      EXECUTION_INPUT,
    );
    expect(JSON.stringify(outcome)).not.toContain("SECRET-PROVIDER-PAYLOAD");
    expect(outcome.errorClassification).toBe("TIMEOUT");
  });
});

// ---------------------------------------------------------------------------
// The development provider
// ---------------------------------------------------------------------------

async function generatedKey(): Promise<{
  provider: DevelopmentReplacementKeyProvider;
  reference: string;
  fingerprint: string;
}> {
  const provider = new DevelopmentReplacementKeyProvider();
  const descriptor = await provider.generateReplacementKey({
    deviceRecordId: EXECUTION_INPUT.deviceRecordId,
    environment: "development",
    purpose: "device_identity",
    renewalAttemptId: "attempt-1",
    keyGeneration: 2,
  });
  return {
    provider,
    reference: descriptor.providerKeyReference,
    fingerprint: descriptor.publicKeyFingerprint,
  };
}

describe("the development provider actually erases, and says what it erased", () => {
  it("removes the private half so signing REFUSES afterwards", async () => {
    const { provider, reference, fingerprint } = await generatedKey();
    expect(vaultHolds(reference)).toBe(true);
    expect(() => vaultSign(reference, new Uint8Array([1, 2, 3]))).not.toThrow();

    const r = await provider.destroyProviderKey({
      destructionRequestId: EXECUTION_INPUT.destructionRequestId,
      providerKeyReference: reference,
      publicKeyFingerprint: fingerprint,
      keyGeneration: 2,
      deviceRecordId: EXECUTION_INPUT.deviceRecordId,
      environment: "development",
      purpose: "device_identity",
    });

    expect(r.result).toBe("DESTROYED");
    // Not a flag — the key is gone and the operation that needs it now fails.
    expect(vaultHolds(reference)).toBe(false);
    expect(() => vaultSign(reference, new Uint8Array([1, 2, 3]))).toThrow();
    expect(provider.destructionCount).toBe(1);
  });

  it("is idempotent, and the second answer carries the FIRST receipt", async () => {
    const { provider, reference, fingerprint } = await generatedKey();
    const request = {
      destructionRequestId: EXECUTION_INPUT.destructionRequestId,
      providerKeyReference: reference,
      publicKeyFingerprint: fingerprint,
      keyGeneration: 2,
      deviceRecordId: EXECUTION_INPUT.deviceRecordId,
      environment: "development",
      purpose: "device_identity",
    };
    const first = await provider.destroyProviderKey(request);
    const second = await provider.destroyProviderKey(request);

    expect(first.result).toBe("DESTROYED");
    expect(second.result).toBe("ALREADY_DESTROYED");
    // KLREQ-031 accepts ALREADY_DESTROYED only with MATCHING prior evidence.
    expect(second.receiptDigest).toBe(first.receiptDigest);
    expect(second.completedAt).toEqual(first.completedAt);
    // The erasure happened once, not twice.
    expect(provider.destructionCount).toBe(1);
  });

  it("keeps the receipt after the key is gone", async () => {
    const { provider, reference, fingerprint } = await generatedKey();
    const first = await provider.destroyProviderKey({
      destructionRequestId: EXECUTION_INPUT.destructionRequestId,
      providerKeyReference: reference,
      publicKeyFingerprint: fingerprint,
      keyGeneration: 2,
      deviceRecordId: EXECUTION_INPUT.deviceRecordId,
      environment: "development",
      purpose: "device_identity",
    });
    expect(vaultHolds(reference)).toBe(false);
    expect(first.receiptDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.attestationKind).toBe("development_simulated");
  });

  for (const [label, mutation] of [
    ["fingerprint", { publicKeyFingerprint: "fp-not-ours" }],
    ["key generation", { keyGeneration: 7 }],
    ["device", { deviceRecordId: "33333333-3333-4333-8333-333333333333" }],
    ["environment", { environment: "pilot" }],
  ] as const) {
    it(`refuses a destruction whose ${label} does not match what it holds`, async () => {
      const { provider, reference, fingerprint } = await generatedKey();
      await expect(
        provider.destroyProviderKey({
          destructionRequestId: EXECUTION_INPUT.destructionRequestId,
          providerKeyReference: reference,
          publicKeyFingerprint: fingerprint,
          keyGeneration: 2,
          deviceRecordId: EXECUTION_INPUT.deviceRecordId,
          environment: "development",
          purpose: "device_identity",
          ...mutation,
        }),
      ).rejects.toBeInstanceOf(ReplacementKeyError);
      // The decisive part: it refused WITHOUT erasing.
      expect(vaultHolds(reference)).toBe(true);
      expect(provider.destructionCount).toBe(0);
    });
  }

  it("refuses a key it never held rather than reporting it destroyed", async () => {
    const { provider } = await generatedKey();
    await expect(
      provider.destroyProviderKey({
        destructionRequestId: EXECUTION_INPUT.destructionRequestId,
        providerKeyReference: "ref-never-existed",
        publicKeyFingerprint: "fp",
        keyGeneration: 2,
        deviceRecordId: EXECUTION_INPUT.deviceRecordId,
        environment: "development",
        purpose: "device_identity",
      }),
    ).rejects.toBeInstanceOf(ReplacementKeyError);
    expect(provider.destructionCount).toBe(0);
  });

  it("never returns key material on the receipt", async () => {
    const { provider, reference, fingerprint } = await generatedKey();
    const r = await provider.destroyProviderKey({
      destructionRequestId: EXECUTION_INPUT.destructionRequestId,
      providerKeyReference: reference,
      publicKeyFingerprint: fingerprint,
      keyGeneration: 2,
      deviceRecordId: EXECUTION_INPUT.deviceRecordId,
      environment: "development",
      purpose: "device_identity",
    });
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain("BEGIN");
  });
});
