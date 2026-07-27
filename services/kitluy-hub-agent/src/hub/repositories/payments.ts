/**
 * `edge_payments` and the cash side of `edge_core` (schema contract §6.5/§6.3).
 *
 * RECORDED GAP G8 / KLREQ-022: there is deliberately NO `edge_finance` schema
 * and this module creates none. The Hub records the payment, refund/void and
 * cash-movement EVENTS that cloud finance derives its authoritative journal
 * from; a Hub-side journal would create a second ledger, which KLD-FIN-002
 * forbids.
 *
 * `edge_payments.payment` is a PROJECTION of append-only payment events (D10):
 * money, identity and provenance columns are frozen by the 0012 trigger, DELETE
 * is blocked, and a confirmed payment may only move to `reversed`.
 */
import type { HubClient } from "../db.js";

export interface PaymentRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  booking_id: string;
  payment_number: string;
  payment_type: string;
  amount_minor: bigint;
  currency_code: string;
  currency_exponent: number;
  state: string;
  provider_code: string | null;
  provider_reference: string | null;
  requested_at: Date;
  confirmed_at: Date | null;
  reversed_at: Date | null;
  actor_id: string;
  terminal_device_id: string;
  event_id: string;
  idempotency_key: string;
}

const PAYMENT_COLUMNS = `id, tenant_id, digital_store_id, location_id, booking_id,
  payment_number, payment_type, amount_minor, currency_code, currency_exponent, state,
  provider_code, provider_reference, requested_at, confirmed_at, reversed_at, actor_id,
  terminal_device_id, event_id, idempotency_key`;

export async function listPayments(
  client: HubClient,
  bookingId: string,
): Promise<readonly PaymentRow[]> {
  const result = await client.query<PaymentRow>(
    `select ${PAYMENT_COLUMNS} from edge_payments.payment
      where booking_id = $1 order by requested_at, id`,
    [bookingId],
  );
  return result.rows;
}

export async function loadPaymentForUpdate(
  client: HubClient,
  paymentId: string,
): Promise<PaymentRow | undefined> {
  const result = await client.query<PaymentRow>(
    `select ${PAYMENT_COLUMNS} from edge_payments.payment where id = $1 for update`,
    [paymentId],
  );
  return result.rows[0];
}

export interface InsertPaymentInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly paymentNumber: string;
  readonly paymentType: string;
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  /** `requested` | `pending` | `confirmed` | `failed` | `cancelled` (0006 CHECK). */
  readonly state: string;
  readonly providerCode: string | null;
  readonly providerReference: string | null;
  /** Only a state of `confirmed` may carry a confirmation time (0006 CHECK). */
  readonly confirmed: boolean;
  readonly actorId: string;
  readonly terminalDeviceId: string;
  readonly eventId: string;
  readonly idempotencyKey: string;
}

export async function insertPayment(client: HubClient, input: InsertPaymentInput): Promise<void> {
  await client.query(
    `insert into edge_payments.payment
       (id, tenant_id, digital_store_id, location_id, booking_id, payment_number,
        payment_type, amount_minor, currency_code, currency_exponent, state,
        provider_code, provider_reference, requested_at, confirmed_at, actor_id,
        terminal_device_id, event_id, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(),
             case when $14::boolean then now() else null end, $15, $16, $17, $18)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.paymentNumber,
      input.paymentType,
      input.amountMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.state,
      input.providerCode,
      input.providerReference,
      input.confirmed,
      input.actorId,
      input.terminalDeviceId,
      input.eventId,
      input.idempotencyKey,
    ],
  );
}

/**
 * Advance the payment state projection. Money, identity and provenance columns
 * are NOT parameters: the 0012 immutability trigger rejects any attempt to move
 * them, and a confirmed payment may only transition to `reversed`.
 */
export async function advancePaymentState(
  client: HubClient,
  input: {
    readonly paymentId: string;
    readonly state: string;
    readonly confirm?: boolean;
    readonly providerReference?: string | null;
  },
): Promise<void> {
  await client.query(
    `update edge_payments.payment
        set state = $2,
            confirmed_at = case when $3::boolean then coalesce(confirmed_at, now())
                                else confirmed_at end,
            provider_reference = coalesce($4, provider_reference)
      where id = $1`,
    [input.paymentId, input.state, input.confirm ?? false, input.providerReference ?? null],
  );
}

export interface PaymentAttemptRow {
  id: string;
  payment_id: string;
  attempt_number: number;
  request_sha256: string;
  provider_state: string;
  provider_reference: string | null;
  error_code: string | null;
  response_metadata: Record<string, unknown>;
}

export async function listPaymentAttempts(
  client: HubClient,
  paymentId: string,
): Promise<readonly PaymentAttemptRow[]> {
  const result = await client.query<PaymentAttemptRow>(
    `select id, payment_id, attempt_number, request_sha256, provider_state,
            provider_reference, error_code, response_metadata
       from edge_payments.payment_attempt where payment_id = $1
      order by attempt_number`,
    [paymentId],
  );
  return result.rows;
}

/**
 * Provider-event deduplication anchor.
 *
 * RECORDED FINDING: the Hub-local catalogue has NO `payment_provider_event`
 * relation — provider and settlement truth is CLOUD-ONLY (reconciliation §2) —
 * so a repeated provider callback is deduplicated on
 * `(payment_id, request_sha256)`, where `request_sha256` is the canonical hash
 * of the provider event (offline contract §3). The command holds the payment
 * row lock for the whole check-and-insert, so two identical callbacks cannot
 * both take effect. No schema change is requested here.
 */
export async function findPaymentAttemptByRequestHash(
  client: HubClient,
  paymentId: string,
  requestSha256: string,
): Promise<PaymentAttemptRow | undefined> {
  const result = await client.query<PaymentAttemptRow>(
    `select id, payment_id, attempt_number, request_sha256, provider_state,
            provider_reference, error_code, response_metadata
       from edge_payments.payment_attempt
      where payment_id = $1 and request_sha256 = $2`,
    [paymentId, requestSha256],
  );
  return result.rows[0];
}

export interface InsertPaymentAttemptInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly paymentId: string;
  readonly attemptNumber: number;
  readonly requestSha256: string;
  readonly providerState: string;
  readonly providerReference: string | null;
  readonly responded: boolean;
  readonly errorCode: string | null;
  readonly responseMetadata: Readonly<Record<string, unknown>>;
}

export async function insertPaymentAttempt(
  client: HubClient,
  input: InsertPaymentAttemptInput,
): Promise<void> {
  await client.query(
    `insert into edge_payments.payment_attempt
       (id, tenant_id, digital_store_id, location_id, payment_id, attempt_number,
        request_sha256, provider_state, provider_reference, requested_at,
        responded_at, error_code, response_metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(),
             case when $10::boolean then now() else null end, $11, $12::jsonb)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.paymentId,
      input.attemptNumber,
      input.requestSha256,
      input.providerState,
      input.providerReference,
      input.responded,
      input.errorCode,
      JSON.stringify(input.responseMetadata),
    ],
  );
}

export interface InsertTenderLegInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly paymentId: string;
  readonly tenderType: string;
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly state: string;
  readonly providerReference: string | null;
  readonly eventId: string;
}

export async function insertTenderLeg(
  client: HubClient,
  input: InsertTenderLegInput,
): Promise<void> {
  await client.query(
    `insert into edge_payments.tender_leg
       (id, tenant_id, digital_store_id, location_id, payment_id, tender_type,
        amount_minor, currency_code, currency_exponent, state, provider_reference,
        event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.paymentId,
      input.tenderType,
      input.amountMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.state,
      input.providerReference,
      input.eventId,
    ],
  );
}

export interface RefundAdjustmentRow {
  id: string;
  booking_id: string;
  original_payment_id: string | null;
  adjustment_type: "refund" | "void";
  amount_minor: bigint;
  currency_code: string;
  currency_exponent: number;
  reason_code: string;
  approval_id: string | null;
  state: string;
  event_id: string;
}

export async function listRefundAdjustments(
  client: HubClient,
  bookingId: string,
): Promise<readonly RefundAdjustmentRow[]> {
  const result = await client.query<RefundAdjustmentRow>(
    `select id, booking_id, original_payment_id, adjustment_type, amount_minor,
            currency_code, currency_exponent, reason_code, approval_id, state, event_id
       from edge_payments.refund_adjustment where booking_id = $1
      order by created_at, id`,
    [bookingId],
  );
  return result.rows;
}

export interface InsertRefundAdjustmentInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly originalPaymentId: string | null;
  readonly adjustmentType: "refund" | "void";
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly reasonCode: string;
  readonly approvalId: string | null;
  readonly state: string;
  readonly eventId: string;
}

/**
 * APPEND-ONLY (§6.5). A later state change is a NEW compensating row, never an
 * UPDATE — the 0012 trigger rejects both UPDATE and DELETE unconditionally.
 */
export async function insertRefundAdjustment(
  client: HubClient,
  input: InsertRefundAdjustmentInput,
): Promise<void> {
  await client.query(
    `insert into edge_payments.refund_adjustment
       (id, tenant_id, digital_store_id, location_id, booking_id, original_payment_id,
        adjustment_type, amount_minor, currency_code, currency_exponent, reason_code,
        approval_id, state, created_at, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.originalPaymentId,
      input.adjustmentType,
      input.amountMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.reasonCode,
      input.approvalId,
      input.state,
      input.eventId,
    ],
  );
}

export interface OpenShiftRow {
  id: string;
  location_id: string;
  terminal_device_id: string;
  actor_id: string;
  business_date: string;
  currency_code: string;
  currency_exponent: number;
  status: string;
}

export async function findOpenShift(
  client: HubClient,
  locationId: string,
  terminalDeviceId: string,
): Promise<OpenShiftRow | undefined> {
  const result = await client.query<OpenShiftRow>(
    `select id, location_id, terminal_device_id, actor_id,
            to_char(business_date, 'YYYY-MM-DD') as business_date,
            currency_code, currency_exponent, status
       from edge_core.shift
      where location_id = $1 and terminal_device_id = $2 and closed_at is null
      order by opened_at desc limit 1`,
    [locationId, terminalDeviceId],
  );
  return result.rows[0];
}

export interface InsertCashMovementInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly shiftId: string;
  readonly movementType: string;
  /** SIGNED minor units: a payout/refund is negative, an acceptance positive (§6.3). */
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly reasonCode: string | null;
  readonly relatedPaymentId: string | null;
  readonly actorId: string;
  readonly terminalDeviceId: string;
  readonly eventId: string;
}

/** APPEND-ONLY cash ledger (§6.3) — the cash truth cloud finance posts from. */
export async function insertCashMovement(
  client: HubClient,
  input: InsertCashMovementInput,
): Promise<void> {
  await client.query(
    `insert into edge_core.cash_movement
       (id, tenant_id, digital_store_id, location_id, shift_id, movement_type,
        amount_minor, currency_code, currency_exponent, reason_code,
        related_payment_id, actor_id, terminal_device_id, occurred_at, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), $14)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.shiftId,
      input.movementType,
      input.amountMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.reasonCode,
      input.relatedPaymentId,
      input.actorId,
      input.terminalDeviceId,
      input.eventId,
    ],
  );
}
