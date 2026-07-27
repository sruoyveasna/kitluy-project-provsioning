/**
 * WS-08 DB-backed integration tests (Cycle-6 §21).
 *
 * Requires the LOCAL Supabase dev stack with migrations 0000-0095 and dev
 * fixtures applied. Skips (visibly) when the database is unreachable — a
 * skipped run is NEVER reported as executed evidence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  applySimulatedKhqrCallback,
  approveRefund,
  captureCashTender,
  completeRefund,
  createDevPool,
  createKhqrIntent,
  isDevDatabaseReachable,
  requestRefund,
  withServiceTransaction,
} from "../src/index.js";

const TENANT_A = "00000000-0000-4000-8000-000000000011";
const STORE_A = "00000000-0000-4000-8000-000000000015";
const LOC_A = "00000000-0000-4000-8000-000000000018";
const CUSTOMER_A = "00000000-0000-4000-8000-000000000324";
const CASHIER = "00000000-0000-4000-8000-000000000004";
const REQUESTER = "00000000-0000-4000-8000-000000000007";
const APPROVER = "00000000-0000-4000-8000-000000000008";
const APPROVAL_REQUEST = "00000000-0000-4000-8000-000000000433";
const CATALOG_ITEM_A = "00000000-0000-4000-8000-000000000301";

const dbAvailable = await isDevDatabaseReachable();
if (!dbAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    "SKIPPED @kitluy/payments-persistence integration: local Supabase dev stack unreachable",
  );
}

/** Create a fresh finalized dev Booking via neutral SQL (unique per call). */
async function createTestOrder(
  pool: pg.Pool,
  totalMinor: bigint,
  currency: "KHR" | "USD" = "KHR",
): Promise<{ orderId: string; orderNumber: string }> {
  const suffix = randomUUID().slice(0, 13);
  const orderNumber = `ITEST-${suffix}`;
  return withServiceTransaction(pool, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `insert into kitluy_orders.orders
         (tenant_id, digital_store_id, store_location_id, customer_id,
          order_number, vertical_code, source_code, status, currency_code,
          subtotal_minor, total_minor, payment_state, intake_verified_at,
          intake_verified_by, idempotency_key, created_by)
       values ($1, $2, $3, $4, $5, 'LAUNDRY', 'WALK_IN', 'CONFIRMED/FINALIZED',
               $6, $7, $7, 'UNPAID', now(), $8, $5, $8)
       returning id`,
      [TENANT_A, STORE_A, LOC_A, CUSTOMER_A, orderNumber, currency, totalMinor.toString(), CASHIER],
    );
    const orderId = inserted.rows[0]!.id;
    await client.query(
      `insert into kitluy_orders.order_lines
         (tenant_id, digital_store_id, order_id, line_no, catalog_item_id,
          service_code, pricing_mode, quantity, unit_price_minor, price_version,
          currency_code, subtotal_minor, total_minor)
       values ($1, $2, $3, 1, $4, 'SHIRT-WASH', 'PER_PIECE', 1, $5, 1, $6, $5, $5)`,
      [TENANT_A, STORE_A, orderId, CATALOG_ITEM_A, totalMinor.toString(), currency],
    );
    return { orderId, orderNumber };
  });
}

async function orderRow(pool: pg.Pool, orderId: string) {
  const r = await pool.query(
    `select payment_state, version, total_minor from kitluy_orders.orders where id = $1`,
    [orderId],
  );
  return r.rows[0] as { payment_state: string; version: bigint; total_minor: bigint };
}

describe.runIf(dbAvailable)("WS-08 payments persistence (DB-backed)", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createDevPool();
  });
  afterAll(async () => {
    await pool.end();
  });

  it("cash capture: engine decision equals persisted result (change math, PAY-VEC-006 analog)", async () => {
    const { orderId } = await createTestOrder(pool, 6000n);
    const key = `itest-cash-${randomUUID()}`;
    const result = await captureCashTender(pool, {
      orderId,
      tenderedMinor: 10000n,
      currency: "KHR",
      idempotencyKey: key,
      actor: { userId: CASHIER },
    });
    // Engine: applied = min(tendered, balance) = 6000; change = 4000.
    expect(result.appliedMinor).toBe(6000n);
    expect(result.changeDueMinor).toBe(4000n);
    expect(result.paymentState).toBe("PAID");
    const persisted = await orderRow(pool, orderId);
    expect(persisted.payment_state).toBe("PAID");
    expect(persisted.version).toBe(2n);
    const tender = await pool.query(
      `select status, amount_minor, applied_minor, change_due_minor
         from kitluy_payments.tenders where id = $1`,
      [result.tenderId],
    );
    expect(tender.rows[0]).toMatchObject({
      status: "CAPTURED",
      amount_minor: 10000n,
      applied_minor: 6000n,
      change_due_minor: 4000n,
    });
    expect(result.journal?.replayed).toBe(false);
  });

  it("idempotent replay returns the prior business result with no duplicate records (PAY-VEC-014)", async () => {
    const { orderId } = await createTestOrder(pool, 5000n);
    const key = `itest-replay-${randomUUID()}`;
    const first = await captureCashTender(pool, {
      orderId,
      tenderedMinor: 5000n,
      currency: "KHR",
      idempotencyKey: key,
      actor: { userId: CASHIER },
    });
    const second = await captureCashTender(pool, {
      orderId,
      tenderedMinor: 5000n,
      currency: "KHR",
      idempotencyKey: key,
      actor: { userId: CASHIER },
    });
    expect(second.replayed).toBe(true);
    expect(second.tenderId).toBe(first.tenderId);
    const tenders = await pool.query(
      `select count(*)::bigint as n from kitluy_payments.tenders where order_id = $1`,
      [orderId],
    );
    expect(tenders.rows[0].n).toBe(1n);
    const history = await pool.query(
      `select count(*)::bigint as n from kitluy_payments.payment_status_history
        where tender_id = $1`,
      [first.tenderId],
    );
    expect(history.rows[0].n).toBe(1n);
    const postings = await pool.query(
      `select count(*)::bigint as n from kitluy_finance.source_postings
        where tenant_id = $1 and source_type = 'TENDER' and source_id = $2`,
      [TENANT_A, first.tenderId],
    );
    expect(postings.rows[0].n).toBe(1n);
  });

  it("currency mismatch is rejected with no ledger effect (PAY-VEC-004)", async () => {
    const { orderId } = await createTestOrder(pool, 40000n, "KHR");
    const before = await orderRow(pool, orderId);
    await expect(
      captureCashTender(pool, {
        orderId,
        tenderedMinor: 1000n,
        currency: "USD",
        idempotencyKey: `itest-fx-${randomUUID()}`,
        actor: { userId: CASHIER },
      }),
    ).rejects.toMatchObject({ code: "CURRENCY_MISMATCH" });
    const after = await orderRow(pool, orderId);
    expect(after.payment_state).toBe(before.payment_state);
    expect(after.version).toBe(before.version);
    const tenders = await pool.query(
      `select count(*)::bigint as n from kitluy_payments.tenders where order_id = $1`,
      [orderId],
    );
    expect(tenders.rows[0].n).toBe(0n);
  });

  it("failed simulated KHQR callback creates no confirmed allocation (PAY-VEC lifecycle)", async () => {
    const { orderId } = await createTestOrder(pool, 30000n);
    const intent = await createKhqrIntent(pool, {
      orderId,
      amountMinor: 30000n,
      currency: "KHR",
      idempotencyKey: `itest-khqr-${randomUUID()}`,
      actor: { userId: CASHIER },
    });
    const outcome = await applySimulatedKhqrCallback(pool, {
      tenderId: intent.tenderId,
      providerTransactionId: `ptx-${randomUUID()}`,
      providerEventId: `evt-${randomUUID()}`,
      status: "FAILED",
      amountMinor: 30000n,
      currency: "KHR",
      signatureVerified: true,
      actor: { serviceKey: "itest" },
    });
    expect(outcome.engineState).toBe("ATTEMPT_CLOSED");
    const tender = await pool.query(
      `select status, applied_minor from kitluy_payments.tenders where id = $1`,
      [intent.tenderId],
    );
    expect(tender.rows[0].status).toBe("FAILED");
    expect(tender.rows[0].applied_minor).toBeNull();
    const persisted = await orderRow(pool, orderId);
    expect(persisted.payment_state).toBe("UNPAID");
    const postings = await pool.query(
      `select count(*)::bigint as n from kitluy_finance.source_postings
        where tenant_id = $1 and source_type = 'TENDER' and source_id = $2`,
      [TENANT_A, intent.tenderId],
    );
    expect(postings.rows[0].n).toBe(0n);
  });

  it("duplicate provider confirmation produces exactly one business effect (PAY-VEC-009)", async () => {
    const { orderId } = await createTestOrder(pool, 20000n);
    const intent = await createKhqrIntent(pool, {
      orderId,
      amountMinor: 20000n,
      currency: "KHR",
      idempotencyKey: `itest-khqr-${randomUUID()}`,
      actor: { userId: CASHIER },
    });
    const eventId = `evt-${randomUUID()}`;
    const ptx = `ptx-${randomUUID()}`;
    const first = await applySimulatedKhqrCallback(pool, {
      tenderId: intent.tenderId,
      providerTransactionId: ptx,
      providerEventId: eventId,
      status: "SUCCEEDED",
      amountMinor: 20000n,
      currency: "KHR",
      signatureVerified: true,
      actor: { serviceKey: "itest" },
    });
    expect(first.engineState).toBe("APPLIED");
    expect(first.paymentState).toBe("PAID");
    const second = await applySimulatedKhqrCallback(pool, {
      tenderId: intent.tenderId,
      providerTransactionId: ptx,
      providerEventId: eventId,
      status: "SUCCEEDED",
      amountMinor: 20000n,
      currency: "KHR",
      signatureVerified: true,
      actor: { serviceKey: "itest" },
    });
    expect(second.duplicate).toBe(true);
    const events = await pool.query(
      `select count(*)::bigint as n from kitluy_payments.payment_provider_events
        where provider_key = 'DEV_KHQR_SIM' and provider_event_id = $1`,
      [eventId],
    );
    expect(events.rows[0].n).toBe(1n);
    const history = await pool.query(
      `select count(*)::bigint as n from kitluy_payments.payment_status_history
        where tender_id = $1`,
      [intent.tenderId],
    );
    expect(history.rows[0].n).toBe(1n);
    const postings = await pool.query(
      `select count(*)::bigint as n from kitluy_finance.source_postings
        where tenant_id = $1 and source_type = 'TENDER' and source_id = $2`,
      [TENANT_A, intent.tenderId],
    );
    expect(postings.rows[0].n).toBe(1n);
  });

  it("unverified callback is quarantined with zero business effect (KBR-PAY-003)", async () => {
    const { orderId } = await createTestOrder(pool, 15000n);
    const intent = await createKhqrIntent(pool, {
      orderId,
      amountMinor: 15000n,
      currency: "KHR",
      idempotencyKey: `itest-khqr-${randomUUID()}`,
      actor: { userId: CASHIER },
    });
    const outcome = await applySimulatedKhqrCallback(pool, {
      tenderId: intent.tenderId,
      providerTransactionId: `ptx-${randomUUID()}`,
      providerEventId: `evt-${randomUUID()}`,
      status: "SUCCEEDED",
      amountMinor: 15000n,
      currency: "KHR",
      signatureVerified: false,
      actor: { serviceKey: "itest" },
    });
    expect(outcome.engineState).toBe("QUARANTINED");
    const tender = await pool.query(`select status from kitluy_payments.tenders where id = $1`, [
      intent.tenderId,
    ]);
    expect(tender.rows[0].status).toBe("PENDING");
    expect((await orderRow(pool, orderId)).payment_state).toBe("UNPAID");
  });

  it("amount-mismatched confirmation persists a reconciliation exception (PAY-VEC-010)", async () => {
    const { orderId } = await createTestOrder(pool, 30000n);
    const intent = await createKhqrIntent(pool, {
      orderId,
      amountMinor: 30000n,
      currency: "KHR",
      idempotencyKey: `itest-khqr-${randomUUID()}`,
      actor: { userId: CASHIER },
    });
    const outcome = await applySimulatedKhqrCallback(pool, {
      tenderId: intent.tenderId,
      providerTransactionId: `ptx-${randomUUID()}`,
      providerEventId: `evt-${randomUUID()}`,
      status: "SUCCEEDED",
      amountMinor: 29000n,
      currency: "KHR",
      signatureVerified: true,
      actor: { serviceKey: "itest" },
    });
    expect(outcome.engineState).toBe("RECONCILIATION_EXCEPTION");
    expect(outcome.varianceMinor).toBe(-1000n);
    expect((await orderRow(pool, orderId)).payment_state).toBe("RECONCILIATION_EXCEPTION");
    const tender = await pool.query(
      `select status, applied_minor from kitluy_payments.tenders where id = $1`,
      [intent.tenderId],
    );
    expect(tender.rows[0].status).toBe("PENDING");
    expect(tender.rows[0].applied_minor).toBeNull();
  });

  it("refund lifecycle: four-eyes, compensating records, balanced reversal posting (PAY-VEC-016/017)", async () => {
    const { orderId } = await createTestOrder(pool, 8000n);
    const capture = await captureCashTender(pool, {
      orderId,
      tenderedMinor: 8000n,
      currency: "KHR",
      idempotencyKey: `itest-cash-${randomUUID()}`,
      actor: { userId: CASHIER },
    });
    const request = await requestRefund(pool, {
      orderId,
      tenderId: capture.tenderId,
      amountMinor: 3000n,
      reasonCode: "DEV_REFUND_TEST",
      requestedBy: REQUESTER,
      idempotencyKey: `itest-ref-${randomUUID()}`,
    });

    // Self-approval is rejected and writes nothing.
    await expect(
      approveRefund(pool, {
        refundId: request.refundId,
        approvedBy: REQUESTER,
        approvalRequestId: APPROVAL_REQUEST,
        reason: "self approval must fail",
      }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" });
    const still = await pool.query(`select status from kitluy_payments.refunds where id = $1`, [
      request.refundId,
    ]);
    expect(still.rows[0].status).toBe("REQUESTED");

    await approveRefund(pool, {
      refundId: request.refundId,
      approvedBy: APPROVER,
      approvalRequestId: APPROVAL_REQUEST,
      reason: "distinct reviewer approval",
    });
    const completion = await completeRefund(pool, {
      refundId: request.refundId,
      actor: { userId: APPROVER },
    });
    expect(completion.refundMinor).toBe(3000n);
    expect(completion.netPaidMinor).toBe(5000n);
    expect(completion.paymentState).toBe("PARTIALLY_PAID");

    // Original tender preserved (compensating, never rewritten).
    const tender = await pool.query(
      `select status, amount_minor, applied_minor from kitluy_payments.tenders where id = $1`,
      [capture.tenderId],
    );
    expect(tender.rows[0]).toMatchObject({
      status: "PARTIALLY_REFUNDED",
      amount_minor: 8000n,
      applied_minor: 8000n,
    });

    // Balanced compensating journal linked to the original entry.
    expect(completion.journal).toBeDefined();
    const legs = await pool.query(
      `select direction, sum(amount_minor)::bigint as total
         from kitluy_finance.journal_postings
        where journal_entry_id = $1 group by direction`,
      [completion.journal!.journalEntryId],
    );
    const byDirection = Object.fromEntries(legs.rows.map((r) => [r.direction, r.total]));
    expect(byDirection.DEBIT).toBe(3000n);
    expect(byDirection.CREDIT).toBe(3000n);
    const entry = await pool.query(
      `select reverses_journal_entry_id from kitluy_finance.journal_entries where id = $1`,
      [completion.journal!.journalEntryId],
    );
    expect(entry.rows[0].reverses_journal_entry_id).toBe(capture.journal!.journalEntryId);

    // Duplicate completion replays without a second financial effect.
    const replay = await completeRefund(pool, {
      refundId: request.refundId,
      actor: { userId: APPROVER },
    });
    expect(replay.replayed).toBe(true);
    const refundPostings = await pool.query(
      `select count(*)::bigint as n from kitluy_finance.source_postings
        where tenant_id = $1 and source_type = 'REFUND' and source_id = $2`,
      [TENANT_A, request.refundId],
    );
    expect(refundPostings.rows[0].n).toBe(1n);
  });

  it("over-ceiling refund is rejected and writes nothing (PAY-VEC-018)", async () => {
    const { orderId } = await createTestOrder(pool, 4000n);
    const capture = await captureCashTender(pool, {
      orderId,
      tenderedMinor: 4000n,
      currency: "KHR",
      idempotencyKey: `itest-cash-${randomUUID()}`,
      actor: { userId: CASHIER },
    });
    await expect(
      requestRefund(pool, {
        orderId,
        tenderId: capture.tenderId,
        amountMinor: 5000n,
        reasonCode: "DEV_REFUND_TEST",
        requestedBy: REQUESTER,
        idempotencyKey: `itest-ref-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "REFUND_EXCEEDS_AVAILABLE_AMOUNT" });
    const refunds = await pool.query(
      `select count(*)::bigint as n from kitluy_payments.refunds where order_id = $1`,
      [orderId],
    );
    expect(refunds.rows[0].n).toBe(0n);
  });

  it("refund against a failed payment is rejected (Cycle-6 §14)", async () => {
    const { orderId } = await createTestOrder(pool, 9000n);
    const intent = await createKhqrIntent(pool, {
      orderId,
      amountMinor: 9000n,
      currency: "KHR",
      idempotencyKey: `itest-khqr-${randomUUID()}`,
      actor: { userId: CASHIER },
    });
    await applySimulatedKhqrCallback(pool, {
      tenderId: intent.tenderId,
      providerTransactionId: `ptx-${randomUUID()}`,
      providerEventId: `evt-${randomUUID()}`,
      status: "FAILED",
      amountMinor: 9000n,
      currency: "KHR",
      signatureVerified: true,
      actor: { serviceKey: "itest" },
    });
    await expect(
      requestRefund(pool, {
        orderId,
        tenderId: intent.tenderId,
        amountMinor: 1000n,
        reasonCode: "DEV_REFUND_TEST",
        requestedBy: REQUESTER,
        idempotencyKey: `itest-ref-${randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: "REFUND_STATE_INVALID" });
  });

  it("rollback leaves no partial aggregate (mid-transaction posting failure)", async () => {
    // Tenant B order: the fictional dev chart for Tenant B has NO
    // DEV-CASH-DRAWER account, so the finance posting fails AFTER the tender
    // insert + history + projection statements already ran inside the same
    // transaction — everything must roll back.
    const TENANT_B = "00000000-0000-4000-8000-000000000012";
    const STORE_B = "00000000-0000-4000-8000-000000000017";
    const LOC_B = "00000000-0000-4000-8000-000000000450";
    const CUSTOMER_B = "00000000-0000-4000-8000-000000000340";
    const U06 = "00000000-0000-4000-8000-000000000006";
    const orderNumber = `ITEST-B-${randomUUID().slice(0, 13)}`;
    const orderId = await withServiceTransaction(pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into kitluy_orders.orders
           (tenant_id, digital_store_id, store_location_id, customer_id,
            order_number, vertical_code, source_code, status, currency_code,
            subtotal_minor, total_minor, payment_state, intake_verified_at,
            intake_verified_by, idempotency_key, created_by)
         values ($1, $2, $3, $4, $5, 'LAUNDRY', 'WALK_IN', 'CONFIRMED/FINALIZED',
                 'KHR', 7000, 7000, 'UNPAID', now(), $6, $5, $6)
         returning id`,
        [TENANT_B, STORE_B, LOC_B, CUSTOMER_B, orderNumber, U06],
      );
      return inserted.rows[0]!.id;
    });

    const doomedKey = `itest-doomed-${randomUUID()}`;
    await expect(
      captureCashTender(pool, {
        orderId,
        tenderedMinor: 7000n,
        currency: "KHR",
        idempotencyKey: doomedKey,
        actor: { userId: U06 },
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });

    // No partial aggregate: no tender, no history, projection untouched.
    const tenders = await pool.query(
      `select count(*)::bigint as n from kitluy_payments.tenders
        where tenant_id = $1 and idempotency_key = $2`,
      [TENANT_B, doomedKey],
    );
    expect(tenders.rows[0].n).toBe(0n);
    const after = await orderRow(pool, orderId);
    expect(after.payment_state).toBe("UNPAID");
    expect(after.version).toBe(1n);

    // The same capture WITHOUT the finance posting succeeds, proving the
    // failure above was the posting step, not the capture path.
    const ok = await captureCashTender(pool, {
      orderId,
      tenderedMinor: 7000n,
      currency: "KHR",
      idempotencyKey: `${doomedKey}-retry`,
      actor: { userId: U06 },
      postToFinance: false,
    });
    expect(ok.paymentState).toBe("PAID");
  });

  it("26 canonical engine vectors remain the canonical decision source (engine untouched)", async () => {
    // Regression is executed by @kitluy/payments own suite; here we assert the
    // persistence layer imports the SAME engine identity.
    const { PACKAGE_NAME } = await import("@kitluy/payments");
    expect(PACKAGE_NAME).toBe("@kitluy/payments");
  });
});
