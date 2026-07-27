/**
 * WS-08 payment command services (WS-08-T002/T003).
 *
 * Command path (Cycle-6 §6): load aggregate + version -> execute the CANONICAL
 * @kitluy/payments engine -> validate authorization/approval -> persist state
 * projection -> append history -> audit -> commit atomically. The engine
 * decides; the database stores results behind corruption guards. An invalid
 * engine decision throws BEFORE any write; the surrounding transaction
 * guarantees no partial aggregate.
 *
 * KHQR runs against the local simulator identity DEV_KHQR_SIM only — the real
 * provider contract/credentials are open owner values (PAY-OD-001, BLK-006).
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import {
  BookingPaymentLedger,
  PaymentError,
  applyKhqrCallback,
  applyRefund,
  createKhqrAttempt,
  type PaymentState,
  type ProviderCallbackResult,
} from "@kitluy/payments";
import { assertFourEyes, type ApprovalRequest, type ApprovalDecision } from "@kitluy/approvals";
import type { UserId } from "@kitluy/shared-types";
import { appendAuditLog, withServiceTransaction, type CommandActor } from "./db.js";
import { postJournalEntry, type PostJournalResult } from "./finance-posting.js";

export type Currency = "KHR" | "USD";

export class PaymentPersistenceError extends Error {
  constructor(
    readonly code:
      | "ORDER_NOT_FOUND"
      | "TENDER_NOT_FOUND"
      | "REFUND_NOT_FOUND"
      | "STALE_VERSION"
      | "CURRENCY_MISMATCH"
      | "REFUND_EXCEEDS_AVAILABLE_AMOUNT"
      | "REFUND_STATE_INVALID"
      | "SELF_APPROVAL_FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "PaymentPersistenceError";
  }
}

interface OrderRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  store_location_id: string | null;
  currency_code: string;
  total_minor: bigint;
  payment_state: string;
  version: bigint;
}

interface TenderRow {
  id: string;
  status: string;
  amount_minor: bigint;
  applied_minor: bigint | null;
  idempotency_key: string;
}

interface RefundRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  order_id: string;
  tender_id: string;
  amount_minor: bigint;
  currency_code: string;
  reason_code: string;
  status: string;
  requested_by: string;
  approval_request_id: string | null;
}

async function loadOrderForUpdate(client: pg.PoolClient, orderId: string): Promise<OrderRow> {
  const result = await client.query<OrderRow>(
    `select id, tenant_id, digital_store_id, store_location_id, currency_code,
            total_minor, payment_state, version
       from kitluy_orders.orders where id = $1 for update`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row) throw new PaymentPersistenceError("ORDER_NOT_FOUND", `order ${orderId} not found`);
  return row;
}

/**
 * Rebuild the canonical per-Booking payment ledger from persisted rows. The
 * record stream is reconstructed from confirmed tenders and completed refunds
 * (append-only evidence); replay keys are namespaced so they can never
 * collide with live command keys.
 */
async function rebuildLedger(
  client: pg.PoolClient,
  order: OrderRow,
): Promise<BookingPaymentLedger> {
  const ledger = new BookingPaymentLedger({
    currency: order.currency_code as Currency,
    bookingTotalMinor: order.total_minor,
  });
  const tenders = await client.query<TenderRow>(
    `select id, status, amount_minor, applied_minor, idempotency_key
       from kitluy_payments.tenders
      where order_id = $1 and status in ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
      order by created_at, id`,
    [order.id],
  );
  for (const t of tenders.rows) {
    ledger.applyFinalizedPayment({
      amountMinor: t.applied_minor ?? t.amount_minor,
      idempotencyKey: `replay:tender:${t.id}`,
    });
  }
  const refunds = await client.query<RefundRow>(
    `select id, tenant_id, digital_store_id, order_id, tender_id, amount_minor,
            currency_code, reason_code, status, requested_by, approval_request_id
       from kitluy_payments.refunds
      where order_id = $1 and status = 'COMPLETED'
      order by requested_at, id`,
    [order.id],
  );
  for (const r of refunds.rows) {
    applyRefund(ledger, {
      amountMinor: r.amount_minor,
      approvalId: r.approval_request_id ?? `replay:approval:${r.id}`,
      reasonCode: r.reason_code,
      idempotencyKey: `replay:refund:${r.id}`,
    });
  }
  return ledger;
}

async function appendTenderHistory(
  client: pg.PoolClient,
  tenantId: string,
  tenderId: string,
  fromStatus: string | null,
  toStatus: string,
  actor: CommandActor,
  reasonCode?: string,
): Promise<void> {
  await client.query(
    `insert into kitluy_payments.payment_status_history
       (tenant_id, tender_id, from_status, to_status, reason_code, actor_user_id, actor_service_key)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      tenantId,
      tenderId,
      fromStatus,
      toStatus,
      reasonCode ?? null,
      actor.userId ?? null,
      actor.serviceKey ?? null,
    ],
  );
}

async function updatePaymentProjection(
  client: pg.PoolClient,
  order: OrderRow,
  paymentState: PaymentState,
): Promise<bigint> {
  const result = await client.query<{ version: bigint }>(
    `update kitluy_orders.orders
        set payment_state = $1, version = version + 1, updated_at = now()
      where id = $2 and version = $3
      returning version`,
    [paymentState, order.id, order.version],
  );
  const row = result.rows[0];
  if (!row) {
    throw new PaymentPersistenceError(
      "STALE_VERSION",
      `order ${order.id} version ${order.version} is stale`,
    );
  }
  return row.version;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

// ---------------------------------------------------------------------------
// Cash capture (KBR-PAY-002; PAY-VEC-001..006, 014/015)
// ---------------------------------------------------------------------------
export interface CashCaptureCommand {
  readonly orderId: string;
  readonly tenderedMinor: bigint;
  readonly currency: Currency;
  readonly idempotencyKey: string;
  readonly actor: CommandActor;
  readonly postToFinance?: boolean;
}

export interface CashCaptureResult {
  readonly replayed: boolean;
  readonly tenderId: string;
  readonly appliedMinor: bigint;
  readonly changeDueMinor: bigint;
  readonly paymentState: PaymentState;
  readonly orderVersion: bigint;
  readonly journal?: PostJournalResult;
}

export async function captureCashTender(
  pool: pg.Pool,
  cmd: CashCaptureCommand,
): Promise<CashCaptureResult> {
  return withServiceTransaction(pool, async (client) => {
    const order = await loadOrderForUpdate(client, cmd.orderId);

    // Idempotent replay: the same command key returns the prior business
    // result without any new record (engine runIdempotent contract).
    const existing = await client.query<{
      id: string;
      applied_minor: bigint | null;
      change_due_minor: bigint | null;
    }>(
      `select id, applied_minor, change_due_minor from kitluy_payments.tenders
        where tenant_id = $1 and idempotency_key = $2`,
      [order.tenant_id, cmd.idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior) {
      return {
        replayed: true,
        tenderId: prior.id,
        appliedMinor: prior.applied_minor ?? 0n,
        changeDueMinor: prior.change_due_minor ?? 0n,
        paymentState: order.payment_state as PaymentState,
        orderVersion: order.version,
      };
    }

    if (order.currency_code !== cmd.currency) {
      // PAY-VEC-004: no ledger effect on currency mismatch.
      throw new PaymentPersistenceError(
        "CURRENCY_MISMATCH",
        `tender currency ${cmd.currency} does not match Booking currency ${order.currency_code} (no approved FX policy — PRC-OD-005)`,
      );
    }

    // Canonical engine decision. The T1 command shape applies at most the
    // outstanding balance and returns the remainder as change (KBR-PAY-002;
    // the vector harness computes applied = min(tendered, balance) — cash
    // never overpays; overpayment policy PAY-OD-003 stays open). A capture
    // against a fully paid Booking is rejected by the engine
    // (AMOUNT_NOT_POSITIVE) before any write.
    const ledger = await rebuildLedger(client, order);
    const balance = ledger.balanceMinor;
    const applied = cmd.tenderedMinor < balance ? cmd.tenderedMinor : balance;
    const envelope = ledger.applyCashTender({
      tenderedMinor: cmd.tenderedMinor,
      appliedMinor: applied,
      currency: cmd.currency,
      idempotencyKey: cmd.idempotencyKey,
    });
    const decision = envelope.result;

    const inserted = await client.query<{ id: string }>(
      `insert into kitluy_payments.tenders
         (tenant_id, digital_store_id, store_location_id, order_id, method_code,
          amount_minor, applied_minor, change_due_minor, currency_code, status,
          idempotency_key, captured_at, created_by)
       values ($1, $2, $3, $4, 'CASH', $5, $6, $7, $8, 'CAPTURED', $9, now(), $10)
       returning id`,
      [
        order.tenant_id,
        order.digital_store_id,
        order.store_location_id,
        order.id,
        cmd.tenderedMinor.toString(),
        decision.appliedMinor.toString(),
        decision.changeDueMinor.toString(),
        cmd.currency,
        cmd.idempotencyKey,
        cmd.actor.userId ?? null,
      ],
    );
    const tenderId = inserted.rows[0]!.id;
    await appendTenderHistory(client, order.tenant_id, tenderId, "PENDING", "CAPTURED", cmd.actor);
    const orderVersion = await updatePaymentProjection(client, order, ledger.paymentState);
    await appendAuditLog(client, {
      tenantId: order.tenant_id,
      digitalStoreId: order.digital_store_id,
      storeLocationId: order.store_location_id ?? undefined,
      actor: cmd.actor,
      action: "payment.cash_recorded",
      resourceType: "payment",
      resourceId: tenderId,
    });

    let journal: PostJournalResult | undefined;
    if (cmd.postToFinance !== false) {
      journal = await postJournalEntry(client, {
        tenantId: order.tenant_id,
        digitalStoreId: order.digital_store_id,
        storeLocationId: order.store_location_id ?? undefined,
        businessDate: new Date().toISOString().slice(0, 10),
        entryType: "DEV_PAYMENT_POSTING",
        postingRuleKey: "DEV-RULE-CASH-TENDER",
        postingRuleVersion: "1",
        sourceType: "TENDER",
        sourceId: tenderId,
        sourceHash: sha256(`tender:${tenderId}:${decision.appliedMinor}`),
        currency: cmd.currency,
        description: "Dev cash tender posting (fictional DEV-* chart; FIN-OD-001 open)",
        actorUserId: cmd.actor.userId,
        actorServiceKey: cmd.actor.serviceKey,
        idempotencyKey: `finpost:tender:${tenderId}`,
        legs: [
          {
            accountCode: "DEV-CASH-DRAWER",
            direction: "DEBIT",
            amountMinor: decision.appliedMinor,
          },
          {
            accountCode: "DEV-ACCOUNTS-RECEIVABLE",
            direction: "CREDIT",
            amountMinor: decision.appliedMinor,
          },
        ],
      });
    }

    return {
      replayed: envelope.replayed,
      tenderId,
      appliedMinor: decision.appliedMinor,
      changeDueMinor: decision.changeDueMinor,
      paymentState: ledger.paymentState,
      orderVersion,
      journal,
    };
  });
}

// ---------------------------------------------------------------------------
// Simulated KHQR (KBR-PAY-003; PAY-VEC-007..012) — DEV_KHQR_SIM only.
// ---------------------------------------------------------------------------
export const DEV_KHQR_PROVIDER = "DEV_KHQR_SIM";

export interface KhqrIntentCommand {
  readonly orderId: string;
  readonly amountMinor: bigint;
  readonly currency: Currency;
  readonly idempotencyKey: string;
  readonly actor: CommandActor;
}

export interface KhqrIntentResult {
  readonly replayed: boolean;
  readonly tenderId: string;
  readonly khqrTransactionId: string;
  readonly merchantRef: string;
}

export async function createKhqrIntent(
  pool: pg.Pool,
  cmd: KhqrIntentCommand,
): Promise<KhqrIntentResult> {
  return withServiceTransaction(pool, async (client) => {
    const order = await loadOrderForUpdate(client, cmd.orderId);
    const existing = await client.query<{ id: string }>(
      `select id from kitluy_payments.tenders
        where tenant_id = $1 and idempotency_key = $2`,
      [order.tenant_id, cmd.idempotencyKey],
    );
    if (existing.rows[0]) {
      const khqr = await client.query<{ id: string; merchant_ref: string }>(
        `select id, merchant_ref from kitluy_payments.khqr_transactions where tender_id = $1`,
        [existing.rows[0].id],
      );
      return {
        replayed: true,
        tenderId: existing.rows[0].id,
        khqrTransactionId: khqr.rows[0]?.id ?? "",
        merchantRef: khqr.rows[0]?.merchant_ref ?? "",
      };
    }
    if (order.currency_code !== cmd.currency) {
      throw new PaymentPersistenceError(
        "CURRENCY_MISMATCH",
        `KHQR currency ${cmd.currency} does not match Booking currency ${order.currency_code}`,
      );
    }

    // Engine validation of the attempt shape (amount positivity, currency).
    const ledger = await rebuildLedger(client, order);
    createKhqrAttempt(ledger, {
      attemptId: cmd.idempotencyKey,
      amountMinor: cmd.amountMinor,
      currency: cmd.currency,
      idempotencyKey: cmd.idempotencyKey,
    });

    const merchantRef = `DEVSIM-${cmd.idempotencyKey}`;
    const tender = await client.query<{ id: string }>(
      `insert into kitluy_payments.tenders
         (tenant_id, digital_store_id, store_location_id, order_id, method_code,
          amount_minor, currency_code, status, provider_key, idempotency_key, created_by)
       values ($1, $2, $3, $4, 'KHQR', $5, $6, 'PENDING', $7, $8, $9)
       returning id`,
      [
        order.tenant_id,
        order.digital_store_id,
        order.store_location_id,
        order.id,
        cmd.amountMinor.toString(),
        cmd.currency,
        DEV_KHQR_PROVIDER,
        cmd.idempotencyKey,
        cmd.actor.userId ?? null,
      ],
    );
    const tenderId = tender.rows[0]!.id;
    await client.query(
      `insert into kitluy_payments.payment_attempts
         (tenant_id, tender_id, provider_key, provider_attempt_ref, status)
       values ($1, $2, $3, $4, 'PENDING')`,
      [order.tenant_id, tenderId, DEV_KHQR_PROVIDER, merchantRef],
    );
    const khqr = await client.query<{ id: string }>(
      `insert into kitluy_payments.khqr_transactions
         (tenant_id, tender_id, merchant_ref, qr_payload_hash, amount_minor,
          currency_code, status, expires_at)
       values ($1, $2, $3, $4, $5, $6, 'PENDING', now() + interval '15 minutes')
       returning id`,
      [
        order.tenant_id,
        tenderId,
        merchantRef,
        sha256(`devsim:${merchantRef}:${cmd.amountMinor}`),
        cmd.amountMinor.toString(),
        cmd.currency,
      ],
    );
    await appendAuditLog(client, {
      tenantId: order.tenant_id,
      digitalStoreId: order.digital_store_id,
      storeLocationId: order.store_location_id ?? undefined,
      actor: cmd.actor,
      action: "payment.khqr_requested",
      resourceType: "payment_request",
      resourceId: tenderId,
    });
    return { replayed: false, tenderId, khqrTransactionId: khqr.rows[0]!.id, merchantRef };
  });
}

export interface KhqrCallbackCommandInput {
  readonly tenderId: string;
  readonly providerTransactionId: string;
  readonly providerEventId: string;
  readonly status: "SUCCEEDED" | "FAILED" | "EXPIRED";
  readonly amountMinor: bigint;
  readonly currency: Currency;
  readonly signatureVerified: boolean;
  readonly actor: CommandActor;
  readonly postToFinance?: boolean;
}

export interface KhqrCallbackOutcome {
  readonly duplicate: boolean;
  readonly engineState: ProviderCallbackResult["state"] | "DUPLICATE_IGNORED";
  readonly paymentState: PaymentState;
  readonly varianceMinor?: bigint;
  readonly journal?: PostJournalResult;
}

export async function applySimulatedKhqrCallback(
  pool: pg.Pool,
  cmd: KhqrCallbackCommandInput,
): Promise<KhqrCallbackOutcome> {
  return withServiceTransaction(pool, async (client) => {
    const tender = await client.query<{
      id: string;
      tenant_id: string;
      order_id: string;
      status: string;
      amount_minor: bigint;
    }>(
      `select id, tenant_id, order_id, status, amount_minor
         from kitluy_payments.tenders where id = $1 for update`,
      [cmd.tenderId],
    );
    const tenderRow = tender.rows[0];
    if (!tenderRow) {
      throw new PaymentPersistenceError("TENDER_NOT_FOUND", `tender ${cmd.tenderId} not found`);
    }
    const order = await loadOrderForUpdate(client, tenderRow.order_id);

    // AMD-I4: a repeated provider event replays with zero new business effect.
    const duplicate = await client.query<{ status: string }>(
      `select status from kitluy_payments.payment_provider_events
        where provider_key = $1 and provider_event_id = $2`,
      [DEV_KHQR_PROVIDER, cmd.providerEventId],
    );
    if (duplicate.rows[0]) {
      return {
        duplicate: true,
        engineState: "DUPLICATE_IGNORED",
        paymentState: order.payment_state as PaymentState,
      };
    }

    // Canonical engine decision over the reconstructed ledger + this attempt.
    const ledger = await rebuildLedger(client, order);
    createKhqrAttempt(ledger, {
      attemptId: tenderRow.id,
      amountMinor: tenderRow.amount_minor,
      currency: order.currency_code as Currency,
    });
    const decision = applyKhqrCallback(ledger, {
      providerTransactionId: cmd.providerTransactionId,
      status: cmd.status,
      amountMinor: cmd.amountMinor,
      currency: cmd.currency,
      signatureVerified: cmd.signatureVerified,
      attemptId: tenderRow.id,
    });

    const eventStatus =
      decision.state === "APPLIED"
        ? "APPLIED"
        : decision.state === "QUARANTINED"
          ? "QUARANTINED"
          : decision.state === "ATTEMPT_CLOSED"
            ? "ATTEMPT_CLOSED"
            : "RECONCILIATION_EXCEPTION";
    await client.query(
      `insert into kitluy_payments.payment_provider_events
         (tenant_id, tender_id, provider_key, provider_event_id,
          provider_transaction_id, signature_valid, payload_hash,
          reported_amount_minor, reported_currency_code, status, variance_minor,
          processed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
      [
        tenderRow.tenant_id,
        tenderRow.id,
        DEV_KHQR_PROVIDER,
        cmd.providerEventId,
        cmd.providerTransactionId,
        cmd.signatureVerified,
        sha256(`devsim-callback:${cmd.providerEventId}`),
        cmd.amountMinor.toString(),
        cmd.currency,
        eventStatus,
        decision.varianceMinor?.toString() ?? null,
      ],
    );

    // KBR-PAY-003: unverified events are quarantined with ZERO business effect.
    if (decision.state === "QUARANTINED") {
      return {
        duplicate: false,
        engineState: decision.state,
        paymentState: order.payment_state as PaymentState,
      };
    }

    if (decision.state === "ATTEMPT_CLOSED") {
      const closed = cmd.status === "EXPIRED" ? "EXPIRED" : "FAILED";
      await client.query(
        `update kitluy_payments.payment_attempts set status = $1, error_code = $2,
                updated_at = now()
          where tender_id = $3 and status = 'PENDING'`,
        [closed, `PROVIDER_${cmd.status}`, tenderRow.id],
      );
      await client.query(
        `update kitluy_payments.khqr_transactions set status = $1, updated_at = now()
          where tender_id = $2 and status = 'PENDING'`,
        [closed, tenderRow.id],
      );
      await client.query(
        `update kitluy_payments.tenders set status = 'FAILED', updated_at = now()
          where id = $1`,
        [tenderRow.id],
      );
      await appendTenderHistory(
        client,
        tenderRow.tenant_id,
        tenderRow.id,
        tenderRow.status,
        "FAILED",
        cmd.actor,
        `PROVIDER_${cmd.status}`,
      );
      return {
        duplicate: false,
        engineState: decision.state,
        paymentState: order.payment_state as PaymentState,
      };
    }

    if (decision.state === "RECONCILIATION_EXCEPTION") {
      const version = await updatePaymentProjection(client, order, "RECONCILIATION_EXCEPTION");
      void version;
      return {
        duplicate: false,
        engineState: decision.state,
        paymentState: "RECONCILIATION_EXCEPTION",
        varianceMinor: decision.varianceMinor,
      };
    }

    // APPLIED — confirm exactly once.
    await client.query(
      `update kitluy_payments.payment_attempts set status = 'SUCCEEDED', updated_at = now()
        where tender_id = $1 and status = 'PENDING'`,
      [tenderRow.id],
    );
    await client.query(
      `update kitluy_payments.khqr_transactions
          set status = 'SUCCEEDED', provider_transaction_id = $1,
              confirmed_at = now(), updated_at = now()
        where tender_id = $2 and status = 'PENDING'`,
      [cmd.providerTransactionId, tenderRow.id],
    );
    await client.query(
      `update kitluy_payments.tenders
          set status = 'CAPTURED', applied_minor = $1, captured_at = now(),
              updated_at = now()
        where id = $2`,
      [cmd.amountMinor.toString(), tenderRow.id],
    );
    await appendTenderHistory(
      client,
      tenderRow.tenant_id,
      tenderRow.id,
      tenderRow.status,
      "CAPTURED",
      cmd.actor,
    );
    await updatePaymentProjection(client, order, ledger.paymentState);
    await appendAuditLog(client, {
      tenantId: tenderRow.tenant_id,
      digitalStoreId: order.digital_store_id,
      actor: cmd.actor,
      action: "payment.completed",
      resourceType: "payment",
      resourceId: tenderRow.id,
    });

    let journal: PostJournalResult | undefined;
    if (cmd.postToFinance !== false) {
      journal = await postJournalEntry(client, {
        tenantId: tenderRow.tenant_id,
        digitalStoreId: order.digital_store_id,
        storeLocationId: order.store_location_id ?? undefined,
        businessDate: new Date().toISOString().slice(0, 10),
        entryType: "DEV_PAYMENT_POSTING",
        postingRuleKey: "DEV-RULE-KHQR-TENDER",
        postingRuleVersion: "1",
        sourceType: "TENDER",
        sourceId: tenderRow.id,
        sourceHash: sha256(`tender:${tenderRow.id}:${cmd.amountMinor}`),
        currency: cmd.currency,
        description: "Dev simulated KHQR posting (fictional DEV-* chart)",
        actorUserId: cmd.actor.userId,
        actorServiceKey: cmd.actor.serviceKey,
        idempotencyKey: `finpost:tender:${tenderRow.id}`,
        legs: [
          {
            accountCode: "DEV-PROVIDER-CLEARING",
            direction: "DEBIT",
            amountMinor: cmd.amountMinor,
          },
          {
            accountCode: "DEV-ACCOUNTS-RECEIVABLE",
            direction: "CREDIT",
            amountMinor: cmd.amountMinor,
          },
        ],
      });
    }

    return {
      duplicate: false,
      engineState: decision.state,
      paymentState: ledger.paymentState,
      journal,
    };
  });
}

// ---------------------------------------------------------------------------
// Refunds (KBR-PAY-005; PAY-VEC-016..018) — compensating, four-eyes.
// ---------------------------------------------------------------------------
export interface RefundRequestCommand {
  readonly orderId: string;
  readonly tenderId: string;
  readonly amountMinor: bigint;
  readonly reasonCode: string;
  readonly requestedBy: string;
  readonly idempotencyKey: string;
}

export async function requestRefund(
  pool: pg.Pool,
  cmd: RefundRequestCommand,
): Promise<{ replayed: boolean; refundId: string }> {
  return withServiceTransaction(pool, async (client) => {
    const order = await loadOrderForUpdate(client, cmd.orderId);
    const existing = await client.query<{ id: string }>(
      `select id from kitluy_payments.refunds
        where tenant_id = $1 and idempotency_key = $2`,
      [order.tenant_id, cmd.idempotencyKey],
    );
    if (existing.rows[0]) return { replayed: true, refundId: existing.rows[0].id };

    const tender = await client.query<{ id: string; status: string }>(
      `select id, status from kitluy_payments.tenders where id = $1 and order_id = $2`,
      [cmd.tenderId, cmd.orderId],
    );
    const tenderRow = tender.rows[0];
    if (!tenderRow) {
      throw new PaymentPersistenceError("TENDER_NOT_FOUND", `tender ${cmd.tenderId} not found`);
    }
    if (!["CAPTURED", "PARTIALLY_REFUNDED"].includes(tenderRow.status)) {
      // Refund against a failed/unconfirmed payment is rejected.
      throw new PaymentPersistenceError(
        "REFUND_STATE_INVALID",
        `tender ${cmd.tenderId} status ${tenderRow.status} is not refundable`,
      );
    }

    // Engine ceiling pre-check: requested amount must not exceed the
    // refundable confirmed net (RV-001 semantics re-checked at completion).
    const ledger = await rebuildLedger(client, order);
    if (cmd.amountMinor <= 0n || cmd.amountMinor > ledger.netPaidMinor) {
      throw new PaymentPersistenceError(
        "REFUND_EXCEEDS_AVAILABLE_AMOUNT",
        `refund ${cmd.amountMinor} exceeds refundable net ${ledger.netPaidMinor}`,
      );
    }

    const inserted = await client.query<{ id: string }>(
      `insert into kitluy_payments.refunds
         (tenant_id, digital_store_id, order_id, tender_id, amount_minor,
          currency_code, reason_code, status, requested_by, idempotency_key)
       values ($1, $2, $3, $4, $5, $6, $7, 'REQUESTED', $8, $9)
       returning id`,
      [
        order.tenant_id,
        order.digital_store_id,
        cmd.orderId,
        cmd.tenderId,
        cmd.amountMinor.toString(),
        order.currency_code,
        cmd.reasonCode,
        cmd.requestedBy,
        cmd.idempotencyKey,
      ],
    );
    await appendAuditLog(client, {
      tenantId: order.tenant_id,
      digitalStoreId: order.digital_store_id,
      actor: { userId: cmd.requestedBy },
      action: "payment.refund_requested",
      resourceType: "refund_request",
      resourceId: inserted.rows[0]!.id,
      reason: cmd.reasonCode,
    });
    return { replayed: false, refundId: inserted.rows[0]!.id };
  });
}

export interface RefundApprovalCommand {
  readonly refundId: string;
  readonly approvedBy: string;
  readonly approvalRequestId: string;
  readonly reason: string;
}

export async function approveRefund(pool: pg.Pool, cmd: RefundApprovalCommand): Promise<void> {
  return withServiceTransaction(pool, async (client) => {
    const refund = await client.query<RefundRow>(
      `select * from kitluy_payments.refunds where id = $1 for update`,
      [cmd.refundId],
    );
    const row = refund.rows[0];
    if (!row) throw new PaymentPersistenceError("REFUND_NOT_FOUND", `refund ${cmd.refundId}`);
    if (row.status !== "REQUESTED" && row.status !== "PENDING_APPROVAL") {
      throw new PaymentPersistenceError(
        "REFUND_STATE_INVALID",
        `refund ${cmd.refundId} status ${row.status} cannot be approved`,
      );
    }

    // Four-eyes at the application layer (@kitluy/approvals) — the requester
    // can never approve (RB v4 §8.8); the DB CHECK enforces it again.
    const request: ApprovalRequest = {
      requestId: cmd.approvalRequestId,
      approvalClass: "A3_FOUR_EYES",
      actionKey: `payments.refund.approve:${cmd.refundId}`,
      requestedBy: row.requested_by as UserId,
      reason: cmd.reason,
      requestedAt: new Date().toISOString(),
    };
    const decision: ApprovalDecision = {
      requestId: cmd.approvalRequestId,
      approvedBy: cmd.approvedBy as UserId,
      decision: "approved",
      decidedAt: new Date().toISOString(),
    };
    assertFourEyes(request, decision); // throws SELF_APPROVAL_FORBIDDEN

    await client.query(
      `update kitluy_payments.refunds
          set status = 'APPROVED', approval_request_id = $1, approved_by = $2,
              approved_at = now(), updated_at = now()
        where id = $3`,
      [cmd.approvalRequestId, cmd.approvedBy, cmd.refundId],
    );
    await appendAuditLog(client, {
      tenantId: row.tenant_id,
      digitalStoreId: row.digital_store_id,
      actor: { userId: cmd.approvedBy },
      action: "payment.refund_approved",
      resourceType: "refund_request",
      resourceId: cmd.refundId,
      reason: cmd.reason,
    });
  });
}

export interface RefundCompletionResult {
  readonly replayed: boolean;
  readonly refundMinor: bigint;
  readonly netPaidMinor: bigint;
  readonly paymentState: PaymentState;
  readonly journal?: PostJournalResult;
}

export async function completeRefund(
  pool: pg.Pool,
  cmd: { refundId: string; actor: CommandActor; postToFinance?: boolean },
): Promise<RefundCompletionResult> {
  return withServiceTransaction(pool, async (client) => {
    const refund = await client.query<RefundRow>(
      `select * from kitluy_payments.refunds where id = $1 for update`,
      [cmd.refundId],
    );
    const row = refund.rows[0];
    if (!row) throw new PaymentPersistenceError("REFUND_NOT_FOUND", `refund ${cmd.refundId}`);
    const order = await loadOrderForUpdate(client, row.order_id);
    if (row.status === "COMPLETED") {
      const ledger = await rebuildLedger(client, order);
      return {
        replayed: true,
        refundMinor: row.amount_minor,
        netPaidMinor: ledger.netPaidMinor,
        paymentState: order.payment_state as PaymentState,
      };
    }
    if (row.status !== "APPROVED" && row.status !== "PROCESSING") {
      throw new PaymentPersistenceError(
        "REFUND_STATE_INVALID",
        `refund ${cmd.refundId} status ${row.status} cannot complete`,
      );
    }

    // Canonical engine decision: ceiling enforced INSIDE the idempotent body
    // (WS-08-T001 review RV-001). An over-ceiling refund throws — no writes.
    const ledger = await rebuildLedger(client, order);
    let envelope;
    try {
      envelope = applyRefund(ledger, {
        amountMinor: row.amount_minor,
        approvalId: row.approval_request_id ?? "",
        reasonCode: row.reason_code,
        idempotencyKey: `refund:${row.id}`,
      });
    } catch (error) {
      if (error instanceof PaymentError && error.code === "REFUND_EXCEEDS_AVAILABLE_AMOUNT") {
        throw new PaymentPersistenceError("REFUND_EXCEEDS_AVAILABLE_AMOUNT", error.message);
      }
      throw error;
    }

    await client.query(
      `update kitluy_payments.refunds
          set status = 'COMPLETED', completed_at = now(), updated_at = now()
        where id = $1`,
      [cmd.refundId],
    );
    // Compensating record discipline: the ORIGINAL tender row is never
    // rewritten — only its refund-status projection advances.
    const tenderNow = await client.query<{ status: string; applied_minor: bigint | null }>(
      `select status, applied_minor from kitluy_payments.tenders where id = $1 for update`,
      [row.tender_id],
    );
    const totalRefunded = await client.query<{ sum: bigint | null }>(
      `select sum(amount_minor)::bigint as sum from kitluy_payments.refunds
        where tender_id = $1 and status = 'COMPLETED'`,
      [row.tender_id],
    );
    const applied = tenderNow.rows[0]?.applied_minor ?? 0n;
    const refunded = totalRefunded.rows[0]?.sum ?? 0n;
    const newStatus = refunded >= applied ? "REFUNDED" : "PARTIALLY_REFUNDED";
    if (tenderNow.rows[0] && tenderNow.rows[0].status !== newStatus) {
      await client.query(`update kitluy_payments.tenders set status = $1 where id = $2`, [
        newStatus,
        row.tender_id,
      ]);
      await appendTenderHistory(
        client,
        row.tenant_id,
        row.tender_id,
        tenderNow.rows[0].status,
        newStatus,
        cmd.actor,
        row.reason_code,
      );
    }
    await updatePaymentProjection(client, order, ledger.paymentState);
    await appendAuditLog(client, {
      tenantId: row.tenant_id,
      digitalStoreId: row.digital_store_id,
      actor: cmd.actor,
      action: "payment.refunded",
      resourceType: "refund_request",
      resourceId: row.id,
      reason: row.reason_code,
    });

    let journal: PostJournalResult | undefined;
    if (cmd.postToFinance !== false) {
      const original = await client.query<{ journal_entry_id: string | null }>(
        `select journal_entry_id from kitluy_finance.source_postings
          where tenant_id = $1 and source_type = 'TENDER' and source_id = $2
          limit 1`,
        [row.tenant_id, row.tender_id],
      );
      journal = await postJournalEntry(client, {
        tenantId: row.tenant_id,
        digitalStoreId: row.digital_store_id,
        businessDate: new Date().toISOString().slice(0, 10),
        entryType: "DEV_REFUND_REVERSAL",
        postingRuleKey: "DEV-RULE-REFUND",
        postingRuleVersion: "1",
        sourceType: "REFUND",
        sourceId: row.id,
        sourceHash: sha256(`refund:${row.id}:${row.amount_minor}`),
        currency: row.currency_code as Currency,
        description: "Dev compensating refund reversal (fictional DEV-* chart)",
        actorUserId: cmd.actor.userId,
        actorServiceKey: cmd.actor.serviceKey,
        idempotencyKey: `finpost:refund:${row.id}`,
        reversesJournalEntryId: original.rows[0]?.journal_entry_id ?? undefined,
        legs: [
          {
            accountCode: "DEV-ACCOUNTS-RECEIVABLE",
            direction: "DEBIT",
            amountMinor: row.amount_minor,
          },
          { accountCode: "DEV-CASH-DRAWER", direction: "CREDIT", amountMinor: row.amount_minor },
        ],
      });
    }

    return {
      replayed: envelope.replayed,
      refundMinor: envelope.result.refundMinor,
      netPaidMinor: envelope.result.netPaidMinor,
      paymentState: ledger.paymentState,
      journal,
    };
  });
}
