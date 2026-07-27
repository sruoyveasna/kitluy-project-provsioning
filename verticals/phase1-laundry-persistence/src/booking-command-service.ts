/**
 * WS-07 Booking command services (WS-07-T002).
 *
 * Command path (Cycle-6 §6/§10): load aggregate + version -> execute the
 * CANONICAL booking-lifecycle engine -> validate scope/reason -> persist the
 * projection -> append transition history -> audit -> commit atomically.
 * An invalid engine transition throws BEFORE any write; a stale version
 * writes nothing; a duplicate idempotency key replays the prior result.
 *
 * The authoritative Booking exists only after approved staff verification
 * (KLD-2026-07-25-001): creation snapshots engine-priced lines at intake.
 */
import type pg from "pg";
import {
  isCompensatingBranch,
  pricePerPieceLine,
  pricePerWeightLine,
  transitionBooking,
  type BookingLifecycleState,
  type LaundryPriceLine,
  type WeightRoundingRule,
} from "@kitluy-verticals/phase1-laundry";
import { money, type CurrencyCode, type Money } from "@kitluy/money";
import {
  appendAuditLog,
  withServiceTransaction,
  type CommandActor,
} from "@kitluy/payments-persistence";

export class BookingPersistenceError extends Error {
  constructor(
    readonly code: "ORDER_NOT_FOUND" | "STALE_VERSION" | "REASON_REQUIRED" | "LINE_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "BookingPersistenceError";
  }
}

export interface VerifiedBookingLineInput {
  readonly catalogItemId: string;
  readonly serviceCode: string;
  readonly pricingMode: "PER_PIECE" | "PER_WEIGHT";
  readonly quantity?: bigint;
  readonly weightGrams?: bigint;
  readonly weightRoundingRule?: WeightRoundingRule;
  readonly unitPriceMinor: bigint;
  readonly priceVersion?: bigint;
}

export interface CreateVerifiedBookingCommand {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly customerId: string;
  readonly orderNumber: string;
  readonly currency: CurrencyCode;
  readonly lines: readonly VerifiedBookingLineInput[];
  readonly requiredDepositMinor?: bigint;
  readonly dueAt?: string;
  readonly verifiedBy: string;
  readonly idempotencyKey: string;
  readonly actor: CommandActor;
}

export interface CreateVerifiedBookingResult {
  readonly replayed: boolean;
  readonly orderId: string;
  readonly totalMinor: bigint;
  readonly version: bigint;
}

/** Engine pricing for one verified line (never recomputed later). */
function priceLine(cmd: CreateVerifiedBookingCommand, line: VerifiedBookingLineInput): Money {
  if (line.pricingMode === "PER_PIECE") {
    if (line.quantity === undefined) {
      throw new BookingPersistenceError("LINE_INVALID", "PER_PIECE line requires quantity");
    }
    const engineLine: LaundryPriceLine = {
      kind: "per_piece",
      serviceCode: line.serviceCode,
      unitPriceSnapshot: money(cmd.currency, line.unitPriceMinor),
      pieceCount: Number(line.quantity),
    };
    return pricePerPieceLine(engineLine);
  }
  if (line.weightGrams === undefined || line.weightRoundingRule === undefined) {
    throw new BookingPersistenceError(
      "LINE_INVALID",
      "PER_WEIGHT line requires weightGrams and an explicit rounding rule (never defaulted)",
    );
  }
  const engineLine: LaundryPriceLine = {
    kind: "per_weight",
    serviceCode: line.serviceCode,
    pricePerKgSnapshot: money(cmd.currency, line.unitPriceMinor),
    weightGrams: Number(line.weightGrams),
  };
  return pricePerWeightLine(engineLine, line.weightRoundingRule);
}

export async function createVerifiedBooking(
  pool: pg.Pool,
  cmd: CreateVerifiedBookingCommand,
): Promise<CreateVerifiedBookingResult> {
  return withServiceTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string; total_minor: bigint; version: bigint }>(
      `select id, total_minor, version from kitluy_orders.orders
        where tenant_id = $1 and idempotency_key = $2`,
      [cmd.tenantId, cmd.idempotencyKey],
    );
    const prior = existing.rows[0];
    if (prior) {
      return {
        replayed: true,
        orderId: prior.id,
        totalMinor: prior.total_minor,
        version: prior.version,
      };
    }

    // Engine-priced immutable snapshots (KBR-TXN-002; POS spec §5.6).
    const lineTotals = cmd.lines.map((line) => priceLine(cmd, line));
    const totalMinor = lineTotals.reduce((sum, m) => sum + m.minorUnits, 0n);

    const inserted = await client.query<{ id: string }>(
      `insert into kitluy_orders.orders
         (tenant_id, digital_store_id, store_location_id, customer_id,
          order_number, vertical_code, source_code, status, currency_code,
          subtotal_minor, total_minor, required_deposit_minor, payment_state,
          due_at, intake_verified_at, intake_verified_by, idempotency_key,
          created_by)
       values ($1, $2, $3, $4, $5, 'LAUNDRY', 'WALK_IN', 'CONFIRMED/FINALIZED',
               $6, $7, $7, $8, 'UNPAID', $9, now(), $10, $11, $12)
       returning id`,
      [
        cmd.tenantId,
        cmd.digitalStoreId,
        cmd.storeLocationId,
        cmd.customerId,
        cmd.orderNumber,
        cmd.currency,
        totalMinor.toString(),
        cmd.requiredDepositMinor?.toString() ?? null,
        cmd.dueAt ?? null,
        cmd.verifiedBy,
        cmd.idempotencyKey,
        cmd.actor.userId ?? null,
      ],
    );
    const orderId = inserted.rows[0]!.id;

    let lineNo = 0;
    for (const line of cmd.lines) {
      lineNo += 1;
      const total = lineTotals[lineNo - 1]!;
      await client.query(
        `insert into kitluy_orders.order_lines
           (tenant_id, digital_store_id, order_id, line_no, catalog_item_id,
            service_code, pricing_mode, quantity, weight_grams,
            weight_rounding_rule, unit_price_minor, price_version,
            currency_code, subtotal_minor, total_minor)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [
          cmd.tenantId,
          cmd.digitalStoreId,
          orderId,
          lineNo,
          line.catalogItemId,
          line.serviceCode,
          line.pricingMode,
          line.quantity?.toString() ?? null,
          line.weightGrams?.toString() ?? null,
          line.weightRoundingRule ?? null,
          line.unitPriceMinor.toString(),
          line.priceVersion?.toString() ?? null,
          cmd.currency,
          total.minorUnits.toString(),
        ],
      );
    }

    await client.query(
      `insert into kitluy_orders.order_events
         (tenant_id, order_id, event_type, from_status, to_status, to_version,
          actor_user_id, actor_service_key, idempotency_key)
       values ($1, $2, 'booking_confirmed_at_verified_intake', null,
               'CONFIRMED/FINALIZED', 1, $3, $4, $5)`,
      [
        cmd.tenantId,
        orderId,
        cmd.actor.userId ?? null,
        cmd.actor.serviceKey ?? null,
        cmd.idempotencyKey,
      ],
    );
    await client.query(
      `insert into kitluy_laundry.booking_production_state
         (order_id, tenant_id, digital_store_id, store_location_id, production_status)
       values ($1, $2, $3, $4, 'RECEIVED')`,
      [orderId, cmd.tenantId, cmd.digitalStoreId, cmd.storeLocationId],
    );
    await client.query(
      `insert into kitluy_laundry.booking_status_history
         (tenant_id, order_id, from_status, to_status, actor_user_id,
          idempotency_key, aggregate_version)
       values ($1, $2, null, 'RECEIVED', $3, $4, 1)`,
      [cmd.tenantId, orderId, cmd.actor.userId ?? null, `${cmd.idempotencyKey}:production`],
    );
    await appendAuditLog(client, {
      tenantId: cmd.tenantId,
      digitalStoreId: cmd.digitalStoreId,
      storeLocationId: cmd.storeLocationId,
      actor: cmd.actor,
      action: "laundry.booking_created",
      resourceType: "laundry_booking",
      resourceId: orderId,
    });

    return { replayed: false, orderId, totalMinor, version: 1n };
  });
}

export interface LifecycleTransitionCommand {
  readonly orderId: string;
  readonly to: BookingLifecycleState;
  readonly expectedVersion: bigint;
  readonly actor: CommandActor;
  readonly reasonCode?: string;
  readonly idempotencyKey: string;
}

export interface LifecycleTransitionResult {
  readonly replayed: boolean;
  readonly from: BookingLifecycleState;
  readonly to: BookingLifecycleState;
  readonly version: bigint;
}

export async function transitionBookingLifecycle(
  pool: pg.Pool,
  cmd: LifecycleTransitionCommand,
): Promise<LifecycleTransitionResult> {
  return withServiceTransaction(pool, async (client) => {
    const loaded = await client.query<{
      tenant_id: string;
      digital_store_id: string;
      status: BookingLifecycleState;
      version: bigint;
    }>(
      `select tenant_id, digital_store_id, status, version
         from kitluy_orders.orders where id = $1 for update`,
      [cmd.orderId],
    );
    const order = loaded.rows[0];
    if (!order) {
      throw new BookingPersistenceError("ORDER_NOT_FOUND", `order ${cmd.orderId} not found`);
    }

    // Idempotent replay: the same transition command returns the prior
    // business result without a second event or version bump.
    const replayed = await client.query<{
      from_status: BookingLifecycleState;
      to_status: BookingLifecycleState;
      to_version: bigint;
    }>(
      `select from_status, to_status, to_version from kitluy_orders.order_events
        where order_id = $1 and idempotency_key = $2`,
      [cmd.orderId, cmd.idempotencyKey],
    );
    const priorEvent = replayed.rows[0];
    if (priorEvent) {
      return {
        replayed: true,
        from: priorEvent.from_status,
        to: priorEvent.to_status,
        version: priorEvent.to_version,
      };
    }

    if (order.version !== cmd.expectedVersion) {
      throw new BookingPersistenceError(
        "STALE_VERSION",
        `order ${cmd.orderId} version ${order.version} != expected ${cmd.expectedVersion}`,
      );
    }

    // Canonical engine decision — throws BookingLifecycleTransitionError on
    // an illegal edge before anything is written.
    const next = transitionBooking(order.status, cmd.to);

    // KBR-TXN-005/006: compensating branches require an explicit reason.
    if (isCompensatingBranch(next) && !cmd.reasonCode?.trim()) {
      throw new BookingPersistenceError(
        "REASON_REQUIRED",
        `transition to ${next} requires a reason code (KBR-TXN-005/006)`,
      );
    }

    const updated = await client.query<{ version: bigint }>(
      `update kitluy_orders.orders
          set status = $1, version = version + 1, updated_at = now()
        where id = $2 and version = $3
        returning version`,
      [next, cmd.orderId, cmd.expectedVersion],
    );
    const newVersion = updated.rows[0]!.version;
    await client.query(
      `insert into kitluy_orders.order_events
         (tenant_id, order_id, event_type, from_status, to_status, from_version,
          to_version, reason_code, actor_user_id, actor_service_key, idempotency_key)
       values ($1, $2, 'booking_lifecycle_transition', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        order.tenant_id,
        cmd.orderId,
        order.status,
        next,
        cmd.expectedVersion.toString(),
        newVersion.toString(),
        cmd.reasonCode ?? null,
        cmd.actor.userId ?? null,
        cmd.actor.serviceKey ?? null,
        cmd.idempotencyKey,
      ],
    );
    await appendAuditLog(client, {
      tenantId: order.tenant_id,
      digitalStoreId: order.digital_store_id,
      actor: cmd.actor,
      action: "laundry.booking_lifecycle_transition",
      resourceType: "laundry_booking",
      resourceId: cmd.orderId,
      reason: cmd.reasonCode,
    });
    return { replayed: false, from: order.status, to: next, version: newVersion };
  });
}
