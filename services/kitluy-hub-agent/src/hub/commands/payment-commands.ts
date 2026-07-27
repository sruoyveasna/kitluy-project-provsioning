/**
 * Payment commands (WS-09-T003) and FINANCE EVENTS ONLY (KLREQ-022).
 *
 * The CANONICAL `@kitluy/payments` engine decides every payment outcome:
 * `applyCashTender` (KBR-PAY-002), `createKhqrAttempt` (KBR-PAY-001),
 * `applyKhqrCallback` (KBR-PAY-003), `applyRefund` (KBR-PAY-005) and
 * `requestVoidOfFinalizedPayment` (KBR-PAY-006). The ledger is REBUILT from the
 * append-only Hub rows on every command, so the persisted result is provably
 * the engine's decision over the stored evidence.
 *
 * PAYMENT_PENDING IS NOT PAID (KLD-2026-07-26-002 Group 5). A pending payment
 * is a NON-TERMINAL 202 outcome: the Booking's `paid_minor` does not move, the
 * command result says so explicitly, and no KHQR confirmation is EVER
 * fabricated — only a signature-verified provider event can confirm one, and an
 * unverified event is quarantined with zero business effect.
 *
 * NO FINANCE JOURNAL (KLREQ-022 / gap G8). This module writes payment,
 * refund/void and cash-movement EVENTS plus their posting-deduplication key and
 * settlement reference. It creates no `edge_finance` schema and no Hub journal:
 * the authoritative ledger stays cloud-owned (KLD-FIN-002). Every finance event
 * carries `cloud_posting_status: "unknown"` because the Hub genuinely does not
 * know it — WS-10 owns transmission and acknowledgement.
 */
import {
  BookingPaymentLedger,
  PaymentError,
  applyKhqrCallback,
  applyRefund,
  createKhqrAttempt,
  requestVoidOfFinalizedPayment,
} from "@kitluy/payments";
import type { CurrencyCode } from "@kitluy/money";
import type { HubPool } from "../db.js";
import { withSerializableHubTransaction, type HubClient } from "../db.js";
import { HubCommandError } from "../errors.js";
import {
  executeHubCommand,
  type HubCommandExecution,
  type HubCommandResult,
  type HubHandlerResult,
} from "../command-pipeline.js";
import type { HubApprovalEvidence } from "../authorization.js";
import { HubEventRecorder, payloadChecksum, sha256Hex } from "../outbox.js";
import {
  auditRepo,
  identityRepo,
  laundryRepo,
  paymentsRepo,
  syncRepo,
} from "../repositories/index.js";
import { uuidv7 } from "../uuid.js";
import { assertExpectedVersion, requireLocationCode } from "./shared.js";
import { loadScopedBooking, type HubCommandEnvelopeInput } from "./booking-commands.js";
import { canonicalJson } from "../../hub-database.js";

/** Fictional development provider identity. KHQR stays simulator-only (PAY-OD-001, BLK-006). */
export const DEV_KHQR_PROVIDER = "DEV_KHQR_SIM" as const;

/**
 * Posting-deduplication key carried to cloud finance so a replayed event
 * produces ONE posting. It is a REFERENCE, not a journal (KLREQ-022).
 */
export function postingDeduplicationKey(sourceType: string, sourceId: string): string {
  return sha256Hex(canonicalJson({ source_type: sourceType, source_id: sourceId }));
}

interface LedgerSnapshot {
  readonly ledger: BookingPaymentLedger;
  readonly confirmedMinor: bigint;
  readonly refundedMinor: bigint;
}

/**
 * Rebuild the canonical per-Booking ledger from the append-only Hub rows.
 * Replay keys are namespaced so they can never collide with a live command key.
 */
async function rebuildLedger(
  client: HubClient,
  booking: { id: string; currency_code: string; total_minor: bigint },
): Promise<LedgerSnapshot> {
  const ledger = new BookingPaymentLedger({
    currency: booking.currency_code as CurrencyCode,
    bookingTotalMinor: booking.total_minor,
  });
  const payments = await paymentsRepo.listPayments(client, booking.id);
  let confirmedMinor = 0n;
  for (const payment of payments) {
    if (payment.state !== "confirmed") continue;
    ledger.applyFinalizedPayment({
      amountMinor: payment.amount_minor,
      idempotencyKey: `replay:payment:${payment.id}`,
    });
    confirmedMinor += payment.amount_minor;
  }
  const adjustments = await paymentsRepo.listRefundAdjustments(client, booking.id);
  let refundedMinor = 0n;
  for (const adjustment of adjustments) {
    if (adjustment.adjustment_type !== "refund") continue;
    if (adjustment.state !== "approved" && adjustment.state !== "completed") continue;
    applyRefund(ledger, {
      amountMinor: adjustment.amount_minor,
      approvalId: adjustment.approval_id ?? `replay:approval:${adjustment.id}`,
      reasonCode: adjustment.reason_code,
      idempotencyKey: `replay:refund:${adjustment.id}`,
    });
    refundedMinor += adjustment.amount_minor;
  }
  return { ledger, confirmedMinor, refundedMinor };
}

// ---------------------------------------------------------------------------
// Cash payment — confirmed at the drawer (KBR-PAY-002)
// ---------------------------------------------------------------------------
export interface CashPaymentInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly tenderedMinor: bigint;
  readonly locationCode: string;
  /** Overrides the command type when a pickup session collects the balance. */
  readonly commandType?: "payments.record_cash_payment" | "laundry.pickup.record_payment";
  readonly pickupSessionId?: string;
}

export async function recordCashPayment(
  pool: HubPool,
  input: CashPaymentInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    tendered_minor: input.tenderedMinor.toString(),
    tender_type: "cash",
    pickup_session_id: input.pickupSessionId ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: input.commandType ?? "payments.record_cash_payment",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => recordCashPaymentHandler(execution, input),
  );
}

async function recordCashPaymentHandler(
  execution: HubCommandExecution,
  input: CashPaymentInput,
): Promise<HubHandlerResult> {
  const { client, auth } = execution;
  const booking = await loadScopedBooking(execution, input.bookingId);
  assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);

  const locationCode = requireLocationCode(input.locationCode);
  const { ledger } = await rebuildLedger(client, booking);
  const balance = ledger.balanceMinor;
  // The T1/T4 command shape applies at most the outstanding balance and returns
  // the remainder as change; cash never overpays (overpayment policy PAY-OD-003
  // is an OPEN owner decision and is not invented here).
  const applied = input.tenderedMinor < balance ? input.tenderedMinor : balance;
  let decision;
  try {
    decision = ledger.applyCashTender({
      tenderedMinor: input.tenderedMinor,
      appliedMinor: applied,
      currency: booking.currency_code as CurrencyCode,
      idempotencyKey: execution.idempotencyKey,
    }).result;
  } catch (error) {
    if (error instanceof PaymentError) {
      throw new HubCommandError("EDGE_INVALID_TRANSITION", error.message, { code: error.code });
    }
    throw error;
  }

  const sequence = await laundryRepo.allocateBusinessNumber(
    client,
    booking.location_id,
    "payment",
    execution.businessDate,
  );
  const paymentNumber = await laundryRepo.formatDisplayNumber(
    client,
    "KLP",
    locationCode,
    execution.businessDate,
    sequence,
  );

  const paymentId = uuidv7();
  const paidMinor = booking.paid_minor + decision.appliedMinor;
  const isDeposit = paidMinor < booking.total_minor;
  const paymentPayload = {
    booking_id: booking.id,
    payment_id: paymentId,
    payment_number: paymentNumber,
    payment_type: "cash",
    amount_minor: decision.appliedMinor.toString(),
    tendered_minor: input.tenderedMinor.toString(),
    change_due_minor: decision.changeDueMinor.toString(),
    currency_code: booking.currency_code,
    currency_exponent: booking.currency_exponent,
    payment_state: "confirmed",
    is_paid: true,
    // KBR-PAY-004: a payment that leaves the Booking unsettled is a DEPOSIT;
    // the completing balance payment is not.
    allocation: isDeposit ? "deposit" : "settlement",
    posting_dedup_key: postingDeduplicationKey("payment", paymentId),
    settlement_reference: null,
    // The Hub genuinely does not know the cloud posting outcome (WS-10 owns it).
    cloud_posting_status: "unknown",
  };
  const paymentEvent = await execution.recorder.record({
    aggregateType: "payment",
    aggregateId: paymentId,
    aggregateVersion: 1n,
    eventName: "payment.recorded",
    payload: paymentPayload,
  });
  await paymentsRepo.insertPayment(client, {
    id: paymentId,
    tenantId: booking.tenant_id,
    digitalStoreId: booking.digital_store_id,
    locationId: booking.location_id,
    bookingId: booking.id,
    paymentNumber,
    paymentType: "cash",
    amountMinor: decision.appliedMinor,
    currencyCode: booking.currency_code,
    currencyExponent: booking.currency_exponent,
    state: "confirmed",
    providerCode: null,
    providerReference: null,
    confirmed: true,
    actorId: auth.device.actorId,
    terminalDeviceId: auth.device.terminalDeviceId,
    eventId: paymentEvent.eventId,
    idempotencyKey: paymentEvent.idempotencyKey,
  });
  await paymentsRepo.insertTenderLeg(client, {
    id: uuidv7(),
    tenantId: booking.tenant_id,
    digitalStoreId: booking.digital_store_id,
    locationId: booking.location_id,
    paymentId,
    tenderType: "cash",
    amountMinor: decision.appliedMinor,
    currencyCode: booking.currency_code,
    currencyExponent: booking.currency_exponent,
    state: "settled",
    providerReference: null,
    eventId: paymentEvent.eventId,
  });

  const version = await laundryRepo.updateBookingProjection(client, {
    bookingId: booking.id,
    expectedVersion: input.expectedVersion,
    paidMinor,
  });
  if (version === undefined) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      `Booking ${booking.id} changed concurrently; nothing was written.`,
    );
  }

  // Cash movement — the append-only cash truth cloud finance posts from.
  const shift = await paymentsRepo.findOpenShift(
    client,
    booking.location_id,
    auth.device.terminalDeviceId,
  );
  let cashMovementId: string | null = null;
  if (shift) {
    const movementPayload = {
      booking_id: booking.id,
      payment_id: paymentId,
      shift_id: shift.id,
      movement_type: "payment_received",
      amount_minor: decision.appliedMinor.toString(),
      currency_code: booking.currency_code,
      currency_exponent: booking.currency_exponent,
      posting_dedup_key: postingDeduplicationKey("cash_movement", paymentId),
      cloud_posting_status: "unknown",
    };
    const movementEvent = await execution.recorder.record({
      aggregateType: "payment",
      aggregateId: paymentId,
      aggregateVersion: 1n,
      eventName: "cash.movement_recorded",
      payload: movementPayload,
      causationId: paymentEvent.eventId,
    });
    cashMovementId = uuidv7();
    await paymentsRepo.insertCashMovement(client, {
      id: cashMovementId,
      tenantId: booking.tenant_id,
      digitalStoreId: booking.digital_store_id,
      locationId: booking.location_id,
      shiftId: shift.id,
      movementType: "payment_received",
      amountMinor: decision.appliedMinor,
      currencyCode: booking.currency_code,
      currencyExponent: booking.currency_exponent,
      reasonCode: null,
      relatedPaymentId: paymentId,
      actorId: auth.device.actorId,
      terminalDeviceId: auth.device.terminalDeviceId,
      eventId: movementEvent.eventId,
    });
  }

  const after = await laundryRepo.findBooking(client, booking.id);
  return {
    aggregateId: booking.id,
    aggregateVersion: version,
    resultJson: {
      ...paymentPayload,
      paid_minor: paidMinor.toString(),
      balance_minor: (after?.balance_minor ?? 0n).toString(),
      deposit_minor: ledger.depositMinor.toString(),
      payment_state_engine: ledger.paymentState,
      cash_movement_id: cashMovementId,
    },
    auditResourceType: "payment",
    auditResourceId: paymentId,
  };
}

// ---------------------------------------------------------------------------
// Pending payment — NON-TERMINAL 202 (Group 5)
// ---------------------------------------------------------------------------
export interface PendingPaymentInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly amountMinor: bigint;
  readonly locationCode: string;
  readonly providerReference: string;
}

export async function createPendingPayment(
  pool: HubPool,
  input: PendingPaymentInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    amount_minor: input.amountMinor.toString(),
    tender_type: "khqr",
    provider_reference: input.providerReference,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "payments.create_pending_payment",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const { client, auth } = execution;
      const booking = await loadScopedBooking(execution, input.bookingId);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      const locationCode = requireLocationCode(input.locationCode);

      const { ledger } = await rebuildLedger(client, booking);
      // Engine validation of the attempt shape. It declares NO money received.
      createKhqrAttempt(ledger, {
        attemptId: execution.idempotencyKey,
        amountMinor: input.amountMinor,
        currency: booking.currency_code as CurrencyCode,
        idempotencyKey: execution.idempotencyKey,
      });

      const sequence = await laundryRepo.allocateBusinessNumber(
        client,
        booking.location_id,
        "payment",
        execution.businessDate,
      );
      const paymentNumber = await laundryRepo.formatDisplayNumber(
        client,
        "KLP",
        locationCode,
        execution.businessDate,
        sequence,
      );
      const paymentId = uuidv7();
      const requestSha256 = sha256Hex(
        canonicalJson({
          provider: DEV_KHQR_PROVIDER,
          payment_number: paymentNumber,
          amount_minor: input.amountMinor.toString(),
          currency_code: booking.currency_code,
        }),
      );
      const payload = {
        booking_id: booking.id,
        payment_id: paymentId,
        payment_number: paymentNumber,
        payment_type: "khqr",
        amount_minor: input.amountMinor.toString(),
        currency_code: booking.currency_code,
        currency_exponent: booking.currency_exponent,
        payment_state: "pending",
        // Group 5: pending is NOT paid. HTTP 202, non-terminal.
        is_paid: false,
        outcome: "PAYMENT_PENDING",
        http_status_hint: 202,
        provider_code: DEV_KHQR_PROVIDER,
        provider_reference: input.providerReference,
        settlement_reference: input.providerReference,
        posting_dedup_key: postingDeduplicationKey("payment", paymentId),
        cloud_posting_status: "unknown",
      };
      const event = await execution.recorder.record({
        aggregateType: "payment",
        aggregateId: paymentId,
        aggregateVersion: 1n,
        eventName: "payment.recorded",
        payload,
      });
      await paymentsRepo.insertPayment(client, {
        id: paymentId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        paymentNumber,
        paymentType: "khqr",
        amountMinor: input.amountMinor,
        currencyCode: booking.currency_code,
        currencyExponent: booking.currency_exponent,
        state: "pending",
        providerCode: DEV_KHQR_PROVIDER,
        providerReference: input.providerReference,
        // No confirmation timestamp exists: the Hub NEVER fabricates one.
        confirmed: false,
        actorId: auth.device.actorId,
        terminalDeviceId: auth.device.terminalDeviceId,
        eventId: event.eventId,
        idempotencyKey: event.idempotencyKey,
      });
      await paymentsRepo.insertPaymentAttempt(client, {
        id: uuidv7(),
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        paymentId,
        attemptNumber: 1,
        requestSha256,
        providerState: "awaiting_customer",
        providerReference: input.providerReference,
        responded: false,
        errorCode: null,
        responseMetadata: { simulator: true },
      });

      // `paid_minor` deliberately does NOT move: pending is not paid.
      const version = await laundryRepo.updateBookingProjection(client, {
        bookingId: booking.id,
        expectedVersion: input.expectedVersion,
      });
      if (version === undefined) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_VERSION_CONFLICT",
          `Booking ${booking.id} changed concurrently; nothing was written.`,
        );
      }
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "payment_request",
        auditResourceId: paymentId,
      } satisfies HubHandlerResult;
    },
  );
}

// ---------------------------------------------------------------------------
// Refund request — four-eyes (KBR-PAY-005)
// ---------------------------------------------------------------------------
export interface RefundRequestInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly originalPaymentId: string;
  readonly amountMinor: bigint;
  readonly reasonCode: string;
  readonly approval: HubApprovalEvidence;
  /** Session-carried grant: `payments.refund.request` has no terminal_role row. */
  readonly presentedGrants: HubCommandEnvelopeInput["device"]["presentedGrants"];
}

export async function requestRefund(
  pool: HubPool,
  input: RefundRequestInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    original_payment_id: input.originalPaymentId,
    amount_minor: input.amountMinor.toString(),
    reason_code: input.reasonCode,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "payments.request_refund",
      device: {
        ...input.device,
        ...(input.presentedGrants ? { presentedGrants: input.presentedGrants } : {}),
      },
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      approval: input.approval,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const { client, auth } = execution;
      const booking = await loadScopedBooking(execution, input.bookingId);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);

      const original = await paymentsRepo.loadPaymentForUpdate(client, input.originalPaymentId);
      if (!original || original.booking_id !== booking.id) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_NOT_FOUND",
          `payment ${input.originalPaymentId} is not a payment of Booking ${booking.id}.`,
        );
      }
      if (original.state !== "confirmed") {
        throw new HubCommandError(
          "EDGE_INVALID_TRANSITION",
          `payment ${original.id} is '${original.state}'; only a confirmed payment can be refunded (KBR-PAY-005).`,
        );
      }

      const { ledger } = await rebuildLedger(client, booking);
      // CANONICAL ENGINE DECISION — the refundable ceiling is enforced INSIDE
      // the engine; an over-ceiling refund throws and NOTHING is written.
      try {
        applyRefund(ledger, {
          amountMinor: input.amountMinor,
          approvalId: input.approval.decision.requestId,
          reasonCode: input.reasonCode,
          idempotencyKey: execution.idempotencyKey,
        });
      } catch (error) {
        if (error instanceof PaymentError) {
          throw new HubCommandError("EDGE_INVALID_TRANSITION", error.message, {
            code: error.code,
          });
        }
        throw error;
      }

      const adjustmentId = uuidv7();
      const refunded = booking.refunded_minor + input.amountMinor;
      const payload = {
        booking_id: booking.id,
        refund_adjustment_id: adjustmentId,
        original_payment_id: original.id,
        adjustment_type: "refund",
        amount_minor: input.amountMinor.toString(),
        currency_code: booking.currency_code,
        currency_exponent: booking.currency_exponent,
        reason_code: input.reasonCode,
        approval_request_id: input.approval.request.requestId,
        requested_by: input.approval.request.requestedBy,
        approved_by: input.approval.decision.approvedBy,
        posting_dedup_key: postingDeduplicationKey("refund_adjustment", adjustmentId),
        cloud_posting_status: "unknown",
      };
      const event = await execution.recorder.record({
        aggregateType: "payment",
        aggregateId: original.id,
        aggregateVersion: 1n,
        eventName: execution.definition.auditEvent,
        payload,
      });
      await paymentsRepo.insertRefundAdjustment(client, {
        id: adjustmentId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        originalPaymentId: original.id,
        adjustmentType: "refund",
        amountMinor: input.amountMinor,
        currencyCode: booking.currency_code,
        currencyExponent: booking.currency_exponent,
        reasonCode: input.reasonCode,
        approvalId: null,
        state: "approved",
        eventId: event.eventId,
      });
      const version = await laundryRepo.updateBookingProjection(client, {
        bookingId: booking.id,
        expectedVersion: input.expectedVersion,
        refundedMinor: refunded,
      });
      if (version === undefined) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_VERSION_CONFLICT",
          `Booking ${booking.id} changed concurrently; nothing was written.`,
        );
      }

      // Compensating cash movement: a signed NEGATIVE amount, never an
      // overwrite of the original acceptance (§6.3, §1 movement ledger).
      const shift = await paymentsRepo.findOpenShift(
        client,
        booking.location_id,
        auth.device.terminalDeviceId,
      );
      if (shift && original.payment_type === "cash") {
        const movementEvent = await execution.recorder.record({
          aggregateType: "payment",
          aggregateId: original.id,
          aggregateVersion: 1n,
          eventName: "cash.movement_recorded",
          payload: {
            booking_id: booking.id,
            payment_id: original.id,
            refund_adjustment_id: adjustmentId,
            movement_type: "refund_paid_out",
            amount_minor: (-input.amountMinor).toString(),
            currency_code: booking.currency_code,
            currency_exponent: booking.currency_exponent,
            posting_dedup_key: postingDeduplicationKey("cash_movement", adjustmentId),
            cloud_posting_status: "unknown",
          },
          causationId: event.eventId,
        });
        await paymentsRepo.insertCashMovement(client, {
          id: uuidv7(),
          tenantId: booking.tenant_id,
          digitalStoreId: booking.digital_store_id,
          locationId: booking.location_id,
          shiftId: shift.id,
          movementType: "refund_paid_out",
          amountMinor: -input.amountMinor,
          currencyCode: booking.currency_code,
          currencyExponent: booking.currency_exponent,
          reasonCode: input.reasonCode,
          relatedPaymentId: original.id,
          actorId: auth.device.actorId,
          terminalDeviceId: auth.device.terminalDeviceId,
          eventId: movementEvent.eventId,
        });
      }

      const after = await laundryRepo.findBooking(client, booking.id);
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: {
          ...payload,
          refunded_minor: refunded.toString(),
          balance_minor: (after?.balance_minor ?? 0n).toString(),
        },
        auditResourceType: "refund_adjustment",
        auditResourceId: adjustmentId,
        auditReasonCode: input.reasonCode,
      } satisfies HubHandlerResult;
    },
  );
}

// ---------------------------------------------------------------------------
// Void request — a finalized payment is NEVER destructively voided (KBR-PAY-006)
// ---------------------------------------------------------------------------
export interface VoidRequestInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly targetPaymentId: string;
  readonly reasonCode: string;
  readonly approval: HubApprovalEvidence;
  readonly presentedGrants: HubCommandEnvelopeInput["device"]["presentedGrants"];
}

export async function requestVoid(
  pool: HubPool,
  input: VoidRequestInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    target_payment_id: input.targetPaymentId,
    reason_code: input.reasonCode,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "payments.request_void",
      device: {
        ...input.device,
        ...(input.presentedGrants ? { presentedGrants: input.presentedGrants } : {}),
      },
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      approval: input.approval,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const { client } = execution;
      const booking = await loadScopedBooking(execution, input.bookingId);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      const target = await paymentsRepo.loadPaymentForUpdate(client, input.targetPaymentId);
      if (!target || target.booking_id !== booking.id) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_NOT_FOUND",
          `payment ${input.targetPaymentId} is not a payment of Booking ${booking.id}.`,
        );
      }

      const { ledger } = await rebuildLedger(client, booking);
      const finalized = target.state === "confirmed";
      let adjustmentState: string;
      let requiredAction: string | null = null;
      if (finalized) {
        // PAY-VEC-020: ALWAYS refused, regardless of approval; redirected to
        // the compensating refund workflow. No existing record is modified.
        const decision = requestVoidOfFinalizedPayment(ledger, {
          approvalId: input.approval.decision.requestId,
          reasonCode: input.reasonCode,
        });
        adjustmentState = "refused";
        requiredAction = decision.requiredAction;
      } else if (target.state === "pending" || target.state === "requested") {
        await paymentsRepo.advancePaymentState(client, {
          paymentId: target.id,
          state: "cancelled",
        });
        adjustmentState = "accepted";
      } else {
        throw new HubCommandError(
          "EDGE_INVALID_TRANSITION",
          `payment ${target.id} is '${target.state}'; a void applies to an unsettled payment only (KBR-PAY-006).`,
        );
      }

      const adjustmentId = uuidv7();
      const payload = {
        booking_id: booking.id,
        refund_adjustment_id: adjustmentId,
        target_payment_id: target.id,
        adjustment_type: "void",
        amount_minor: target.amount_minor.toString(),
        currency_code: booking.currency_code,
        currency_exponent: booking.currency_exponent,
        reason_code: input.reasonCode,
        state: adjustmentState,
        required_action: requiredAction,
        approval_request_id: input.approval.request.requestId,
        posting_dedup_key: postingDeduplicationKey("void_request", adjustmentId),
        cloud_posting_status: "unknown",
      };
      const event = await execution.recorder.record({
        aggregateType: "payment",
        aggregateId: target.id,
        aggregateVersion: 1n,
        eventName: execution.definition.auditEvent,
        payload,
      });
      await paymentsRepo.insertRefundAdjustment(client, {
        id: adjustmentId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        originalPaymentId: target.id,
        adjustmentType: "void",
        amountMinor: target.amount_minor,
        currencyCode: booking.currency_code,
        currencyExponent: booking.currency_exponent,
        reasonCode: input.reasonCode,
        approvalId: null,
        state: adjustmentState,
        eventId: event.eventId,
      });
      const version = await laundryRepo.updateBookingProjection(client, {
        bookingId: booking.id,
        expectedVersion: input.expectedVersion,
      });
      if (version === undefined) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_VERSION_CONFLICT",
          `Booking ${booking.id} changed concurrently; nothing was written.`,
        );
      }
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "void_request",
        auditResourceId: adjustmentId,
        auditReasonCode: input.reasonCode,
      } satisfies HubHandlerResult;
    },
  );
}

// ---------------------------------------------------------------------------
// Provider callback — SERVICE pipeline (no terminal actor)
// ---------------------------------------------------------------------------
export interface ProviderCallbackInput {
  readonly paymentId: string;
  readonly providerTransactionId: string;
  readonly providerEventId: string;
  readonly status: "SUCCEEDED" | "FAILED" | "EXPIRED";
  readonly amountMinor: bigint;
  /** Supplied by the provider adapter. The engine trusts the FLAG, not the payload. */
  readonly signatureVerified: boolean;
  readonly businessDate: string;
  readonly correlationId?: string;
}

export interface ProviderCallbackOutcome {
  readonly duplicate: boolean;
  readonly engineState: "APPLIED" | "RECONCILIATION_EXCEPTION" | "ATTEMPT_CLOSED" | "QUARANTINED";
  readonly paymentState: string;
  readonly varianceMinor: bigint | null;
  readonly eventIds: readonly string[];
}

/**
 * Apply an authoritative provider callback.
 *
 * WHY THIS IS NOT A TERMINAL COMMAND (recorded, not silently resolved).
 * `edge_sync.command_result.terminal_device_id` is NOT NULL and references
 * `edge_identity.terminal_device`, so the idempotency/command ledger is
 * TERMINAL-COMMAND-ONLY by contract and cannot hold a service-originated
 * callback. The callback therefore runs its own SERIALIZABLE pipeline with:
 *   - deduplication on `(payment_id, request_sha256)` under the payment row
 *     lock — the Hub-local catalogue has no `payment_provider_event` relation
 *     because provider truth is CLOUD-ONLY (reconciliation §2);
 *   - the CANONICAL `applyKhqrCallback` decision — an unverified signature is
 *     QUARANTINED with zero business effect, an amount mismatch becomes a
 *     RECONCILIATION_EXCEPTION, and only a verified matching success confirms;
 *   - the same atomic event + outbox + audit persistence as every command.
 * The missing actor-facing permission key is registered in the command
 * catalogue as `PERMISSION_GAP_HUB_PROVIDER_CALLBACK`.
 */
export async function applyProviderCallback(
  pool: HubPool,
  input: ProviderCallbackInput,
): Promise<ProviderCallbackOutcome> {
  return withSerializableHubTransaction(pool, async (client) => {
    const assignment = await identityRepo.findActiveHubAssignment(client);
    if (!assignment || assignment.status !== "active") {
      throw new HubCommandError(
        "EDGE_DEVICE_NOT_ASSIGNED",
        "this Hub has no ACTIVE Location assignment.",
      );
    }
    const payment = await paymentsRepo.loadPaymentForUpdate(client, input.paymentId);
    if (!payment) {
      throw new HubCommandError(
        "EDGE_AGGREGATE_NOT_FOUND",
        `payment ${input.paymentId} not found.`,
      );
    }
    if (
      payment.tenant_id !== assignment.tenant_id ||
      payment.digital_store_id !== assignment.digital_store_id ||
      payment.location_id !== assignment.location_id
    ) {
      throw new HubCommandError(
        "EDGE_RESOURCE_SCOPE_DENIED",
        `payment ${payment.id} belongs to a different Tenant / Digital Store / Location.`,
      );
    }

    const requestSha256 = sha256Hex(
      canonicalJson({
        provider: DEV_KHQR_PROVIDER,
        provider_event_id: input.providerEventId,
        provider_transaction_id: input.providerTransactionId,
        status: input.status,
        amount_minor: input.amountMinor.toString(),
      }),
    );
    const priorAttempt = await paymentsRepo.findPaymentAttemptByRequestHash(
      client,
      payment.id,
      requestSha256,
    );
    if (priorAttempt) {
      // A repeated delivery replays with ZERO new business effect.
      return {
        duplicate: true,
        engineState: "APPLIED",
        paymentState: payment.state,
        varianceMinor: null,
        eventIds: [],
      } satisfies ProviderCallbackOutcome;
    }

    const booking = await laundryRepo.loadBookingForUpdate(client, payment.booking_id);
    if (!booking) {
      throw new HubCommandError(
        "EDGE_AGGREGATE_NOT_FOUND",
        `Booking ${payment.booking_id} not found.`,
      );
    }
    const { ledger } = await rebuildLedger(client, booking);
    createKhqrAttempt(ledger, {
      attemptId: payment.id,
      amountMinor: payment.amount_minor,
      currency: booking.currency_code as CurrencyCode,
    });
    // CANONICAL ENGINE DECISION.
    const decision = applyKhqrCallback(ledger, {
      providerTransactionId: input.providerTransactionId,
      deliveryId: input.providerEventId,
      status: input.status,
      amountMinor: input.amountMinor,
      currency: booking.currency_code as CurrencyCode,
      signatureVerified: input.signatureVerified,
      attemptId: payment.id,
    });

    const attempts = await paymentsRepo.listPaymentAttempts(client, payment.id);
    const attemptNumber = attempts.length + 1;
    const providerState =
      decision.state === "APPLIED"
        ? "succeeded"
        : decision.state === "QUARANTINED"
          ? "quarantined"
          : decision.state === "ATTEMPT_CLOSED"
            ? input.status === "EXPIRED"
              ? "expired"
              : "failed"
            : "reconciliation_exception";
    await paymentsRepo.insertPaymentAttempt(client, {
      id: uuidv7(),
      tenantId: payment.tenant_id,
      digitalStoreId: payment.digital_store_id,
      locationId: payment.location_id,
      paymentId: payment.id,
      attemptNumber,
      requestSha256,
      providerState,
      providerReference: input.providerTransactionId,
      responded: true,
      errorCode: decision.state === "APPLIED" ? null : `PROVIDER_${input.status}`,
      responseMetadata: {
        simulator: true,
        engine_state: decision.state,
        signature_verified: input.signatureVerified,
      },
    });

    if (decision.state === "QUARANTINED") {
      // Fail closed: unverified evidence produces NO payment effect and is
      // recorded as security evidence, never silently dropped.
      await auditRepo.recordSecurityEvent(client, {
        id: uuidv7(),
        tenantId: payment.tenant_id,
        digitalStoreId: payment.digital_store_id,
        locationId: payment.location_id,
        eventCode: "EDGE_PROVIDER_EVENT_QUARANTINED",
        severity: "high",
        deviceId: null,
        certificateSerial: null,
        details: {
          payment_id: payment.id,
          provider_event_id: input.providerEventId,
          reason: "SIGNATURE_NOT_VERIFIED",
        },
      });
      return {
        duplicate: false,
        engineState: decision.state,
        paymentState: payment.state,
        varianceMinor: null,
        eventIds: [],
      } satisfies ProviderCallbackOutcome;
    }

    const recorder = new HubEventRecorder(client, {
      tenantId: payment.tenant_id,
      digitalStoreId: payment.digital_store_id,
      locationId: payment.location_id,
      hubDeviceId: assignment.hub_device_id,
      originDeviceId: payment.terminal_device_id,
      actorId: null,
      assignmentGeneration: assignment.assignment_generation,
      businessDate: input.businessDate,
      correlationId: input.correlationId ?? uuidv7(),
      originSequence: 0n,
      // A service-originated event carries a HUB-issued key from the outset:
      // there is no terminal client_sequence behind it.
      commandIdempotencyKey: `kl1.${assignment.hub_device_id}.${Date.now()}`,
    });

    let paymentState = payment.state;
    let varianceMinor: bigint | null = null;
    if (decision.state === "APPLIED") {
      paymentState = "confirmed";
      await paymentsRepo.advancePaymentState(client, {
        paymentId: payment.id,
        state: "confirmed",
        confirm: true,
        providerReference: input.providerTransactionId,
      });
      const paidMinor = booking.paid_minor + payment.amount_minor;
      const version = await laundryRepo.updateBookingProjection(client, {
        bookingId: booking.id,
        expectedVersion: booking.aggregate_version,
        paidMinor,
      });
      if (version === undefined) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_VERSION_CONFLICT",
          `Booking ${booking.id} changed concurrently; nothing was written.`,
        );
      }
      await recorder.record({
        aggregateType: "payment",
        aggregateId: payment.id,
        aggregateVersion: 2n,
        eventName: "payment.recorded",
        payload: {
          booking_id: booking.id,
          payment_id: payment.id,
          payment_type: payment.payment_type,
          amount_minor: payment.amount_minor.toString(),
          currency_code: booking.currency_code,
          currency_exponent: booking.currency_exponent,
          payment_state: "confirmed",
          is_paid: true,
          provider_transaction_id: input.providerTransactionId,
          settlement_reference: input.providerTransactionId,
          posting_dedup_key: postingDeduplicationKey("payment", payment.id),
          cloud_posting_status: "unknown",
        },
      });
    } else if (decision.state === "ATTEMPT_CLOSED") {
      paymentState = "failed";
      await paymentsRepo.advancePaymentState(client, {
        paymentId: payment.id,
        state: "failed",
        providerReference: input.providerTransactionId,
      });
      await recorder.record({
        aggregateType: "payment",
        aggregateId: payment.id,
        aggregateVersion: 2n,
        eventName: "payment.recorded",
        payload: {
          booking_id: booking.id,
          payment_id: payment.id,
          payment_state: "failed",
          is_paid: false,
          provider_status: input.status,
          provider_transaction_id: input.providerTransactionId,
          posting_dedup_key: postingDeduplicationKey("payment", payment.id),
          cloud_posting_status: "unknown",
        },
      });
    } else {
      varianceMinor = decision.varianceMinor ?? null;
      await recorder.record({
        aggregateType: "payment",
        aggregateId: payment.id,
        aggregateVersion: 2n,
        eventName: "payment.recorded",
        payload: {
          booking_id: booking.id,
          payment_id: payment.id,
          payment_state: payment.state,
          is_paid: false,
          outcome: "RECONCILIATION_EXCEPTION",
          variance_minor: (decision.varianceMinor ?? 0n).toString(),
          provider_transaction_id: input.providerTransactionId,
          posting_dedup_key: postingDeduplicationKey("payment", payment.id),
          cloud_posting_status: "unknown",
        },
      });
    }

    const auditSequence = await syncRepo.allocateHubSequence(client);
    const auditDetails = {
      payment_id: payment.id,
      engine_state: decision.state,
      provider_event_id: input.providerEventId,
      signature_verified: input.signatureVerified,
    };
    await auditRepo.appendAuditEvent(client, {
      id: uuidv7(),
      tenantId: payment.tenant_id,
      digitalStoreId: payment.digital_store_id,
      locationId: payment.location_id,
      eventCode: "payment.recorded",
      actorType: "service",
      actorId: null,
      requesterId: null,
      approverId: null,
      terminalDeviceId: payment.terminal_device_id,
      hubDeviceId: assignment.hub_device_id,
      profileCode: null,
      resourceType: "payment",
      resourceId: payment.id,
      reasonCode: null,
      correlationId: input.correlationId ?? uuidv7(),
      payloadSha256: payloadChecksum(auditDetails),
      details: auditDetails,
      localSequence: auditSequence,
    });

    return {
      duplicate: false,
      engineState: decision.state,
      paymentState,
      varianceMinor,
      eventIds: recorder.eventIds,
    } satisfies ProviderCallbackOutcome;
  });
}
