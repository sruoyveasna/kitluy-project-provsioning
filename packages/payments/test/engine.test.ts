/**
 * Targeted unit tests for engine invariants beyond the canonical vectors:
 * append-only enforcement, float rejection, currency isolation, and the
 * "verified provider evidence only" rule (KBR-PAY-003).
 */

import { MoneyError } from "@kitluy/money";
import { describe, expect, it } from "vitest";
import {
  applyKhqrCallback,
  applyKhqrClientConfirm,
  applyRefund,
  BookingPaymentLedger,
  createKhqrAttempt,
  PaymentError,
  SettlementReconciler,
  voidAttempt,
} from "../src/index.js";

const khrLedger = (totalMinor: number): BookingPaymentLedger =>
  new BookingPaymentLedger({ currency: "KHR", bookingTotalMinor: totalMinor });

function expectPaymentError(fn: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(PaymentError);
  expect((thrown as PaymentError).code).toBe(code);
}

describe("append-only enforcement", () => {
  it("freezes every record; mutation attempts throw", () => {
    const ledger = khrLedger(10000);
    ledger.applyCashTender({ amountMinor: 10000, idempotencyKey: "k1" });
    const record = ledger.getRecords()[0]!;
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.postings)).toBe(true);
    expect(Object.isFrozen(record.meta)).toBe(true);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (record as any).amount = null;
    }).toThrow(TypeError);
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (record.meta as any).finalized = false;
    }).toThrow(TypeError);
  });

  it("exposes no update or delete API; snapshots do not leak the internal array", () => {
    const ledger = khrLedger(10000);
    ledger.applyCashTender({ amountMinor: 10000, idempotencyKey: "k1" });
    const proto = Object.getOwnPropertyNames(BookingPaymentLedger.prototype);
    expect(proto.some((name) => /update|delete|remove|mutate/i.test(name))).toBe(false);
    const snapshot = ledger.getRecords() as unknown[];
    snapshot.pop(); // mutating the snapshot copy…
    expect(ledger.getRecords()).toHaveLength(1); // …never touches the ledger
  });

  it("a full refund retains the original payment record unchanged", () => {
    const ledger = khrLedger(40000);
    const { result } = ledger.applyFinalizedPayment({ amountMinor: 40000 });
    applyRefund(ledger, { amountMinor: 40000, approvalId: "appr-x" });
    const original = ledger.getRecord(result.recordSeq)!;
    expect(original.kind).toBe("PAYMENT");
    expect(original.amount?.minorUnits).toBe(40000n);
    expect(ledger.netPaidMinor).toBe(0n);
    expect(ledger.getRecords()).toHaveLength(2); // original + compensating refund
  });
});

describe("float rejection (no binary floating point for money)", () => {
  it("rejects fractional cash amounts", () => {
    const ledger = khrLedger(10000);
    expect(() => ledger.applyCashTender({ amountMinor: 99.5 })).toThrow(MoneyError);
    expect(ledger.getRecords()).toHaveLength(0);
  });

  it("rejects fractional refund and callback amounts", () => {
    const ledger = khrLedger(10000);
    ledger.applyCashTender({ amountMinor: 10000 });
    expect(() => applyRefund(ledger, { amountMinor: 0.5, approvalId: "a" })).toThrow(MoneyError);
    expect(() =>
      applyKhqrCallback(ledger, {
        providerTransactionId: "p-float",
        status: "SUCCEEDED",
        amountMinor: 10.25,
        signatureVerified: true,
      }),
    ).toThrow(MoneyError);
  });

  it("rejects fractional settlement amounts", () => {
    const reconciler = new SettlementReconciler("KHR");
    expect(() =>
      reconciler.registerLedgerPayment({ providerTransactionId: "p", amountMinor: 1.5 }),
    ).toThrow(MoneyError);
  });
});

describe("currency isolation (no silent conversion)", () => {
  it("rejects a USD tender on a KHR booking with the canonical error code", () => {
    const ledger = khrLedger(40000);
    expectPaymentError(
      () => ledger.applyCashTender({ amountMinor: 1000, currency: "USD" }),
      "CURRENCY_MISMATCH_OR_CONVERSION_REQUIRED",
    );
    expect(ledger.financialEffectCount).toBe(0);
  });

  it("rejects a KHR provider callback on a USD booking", () => {
    const ledger = new BookingPaymentLedger({ currency: "USD", bookingTotalMinor: 1250 });
    expect(() =>
      applyKhqrCallback(ledger, {
        providerTransactionId: "p-usd",
        status: "SUCCEEDED",
        amountMinor: 1250,
        currency: "KHR",
        signatureVerified: true,
      }),
    ).toThrow(PaymentError);
    expect(ledger.paidMinor).toBe(0n);
  });
});

describe("provider evidence authority (KBR-PAY-003)", () => {
  it("quarantines an unverified callback with zero business effect", () => {
    const ledger = khrLedger(30000);
    const result = applyKhqrCallback(ledger, {
      providerTransactionId: "p-unverified",
      status: "SUCCEEDED",
      amountMinor: 30000,
      signatureVerified: false,
    });
    expect(result).toEqual({ accepted: false, state: "QUARANTINED" });
    expect(ledger.paidMinor).toBe(0n);
    expect(ledger.businessEffectCount).toBe(0);
  });

  it("a client success screen alone never completes a payment", () => {
    const ledger = khrLedger(30000);
    createKhqrAttempt(ledger, { attemptId: "a1", amountMinor: 30000 });
    const observed = applyKhqrClientConfirm(ledger, { providerTransactionId: "p-ui" });
    expect(observed.providerEventAlreadyApplied).toBe(false);
    expect(ledger.paidMinor).toBe(0n);
    expect(ledger.paymentState).toBe("PAYMENT_PENDING");
  });
});

describe("refund and void guardrails", () => {
  it("requires approval evidence for refunds (KBR-PAY-005)", () => {
    const ledger = khrLedger(10000);
    ledger.applyCashTender({ amountMinor: 10000 });
    expectPaymentError(
      () => applyRefund(ledger, { amountMinor: 5000, approvalId: "" }),
      "REFUND_APPROVAL_REQUIRED",
    );
  });

  it("refuses to void a succeeded attempt (KBR-PAY-006)", () => {
    const ledger = khrLedger(30000);
    createKhqrAttempt(ledger, { attemptId: "a1", amountMinor: 30000 });
    applyKhqrCallback(ledger, {
      providerTransactionId: "p-ok",
      status: "SUCCEEDED",
      amountMinor: 30000,
      signatureVerified: true,
      attemptId: "a1",
    });
    expectPaymentError(
      () => voidAttempt(ledger, { attemptId: "a1" }),
      "VOID_NOT_ALLOWED_FOR_STATE",
    );
    expect(ledger.paidMinor).toBe(30000n);
  });
});

describe("RV-001 regression — refund replay idempotency (WS-08-T001 review)", () => {
  it("replaying an identical full refund returns the original result, no double effect", async () => {
    const { BookingPaymentLedger } = await import("../src/ledger.js");
    const { applyRefund } = await import("../src/refunds.js");
    const ledger = new BookingPaymentLedger({ bookingTotalMinor: 5000n, currency: "KHR" });
    ledger.applyCashTender({ amountMinor: 5000n, currency: "KHR", idempotencyKey: "pay-1" });
    const cmd = {
      amountMinor: 5000n,
      currency: "KHR" as const,
      approvalId: "appr-1",
      idempotencyKey: "refund-1",
    };
    const first = applyRefund(ledger, cmd);
    const replay = applyRefund(ledger, cmd);
    expect(replay.result).toEqual(first.result);
    expect(ledger.refundedMinor).toBe(5000n);
    expect(ledger.records.filter((r) => r.kind === "REFUND")).toHaveLength(1);
    expect(ledger.records.filter((r) => r.kind === "REFUND_REJECTED")).toHaveLength(0);
  });
});
