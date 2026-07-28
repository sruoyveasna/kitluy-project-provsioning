/**
 * T1 Booking commands (WS-09-T002).
 *
 * The CANONICAL engines decide every transition and every price:
 *   - `assertNotFinalized` (KBR-TXN-003) guards draft shaping — the
 *     finalization boundary is the immutability boundary and the Hub never
 *     edits past it.
 *   - `pricePerPieceLine` / `pricePerWeightLine` price every line; the Hub
 *     stores the engine's immutable snapshot and never recalculates a
 *     historical line (POS spec §5.6). The per-weight ROUNDING RULE is never
 *     defaulted — an absent rule refuses the command.
 *   - `transitionBooking(DRAFT -> CONFIRMED/FINALIZED)` decides confirm-intake;
 *     production then begins at RECEIVED (KBR-LND-001 "State becomes RECEIVED
 *     after successful commit").
 *
 * Confirm-intake commits ATOMICALLY: the lifecycle transition, the price
 * snapshot, the garment records, the initial custody events, any deposit /
 * payment intent, the audit event, the outbox entries and the command result
 * all share ONE transaction (schema contract §9).
 */
import { money, type CurrencyCode } from "@kitluy/money";
import {
  assertNotFinalized,
  pricePerPieceLine,
  pricePerWeightLine,
  transitionBooking,
  type WeightRoundingRule,
} from "@kitluy-verticals/phase1-laundry";
import type { HubPool } from "../db.js";
import { HubCommandError } from "../errors.js";
import type { HubDeviceContext } from "../authorization.js";
import {
  executeHubCommand,
  type HubCommandExecution,
  type HubCommandResult,
  type HubHandlerResult,
} from "../command-pipeline.js";
import {
  lifecycleStateForStatus,
  statusForLifecycleState,
  statusForProductionState,
} from "../booking-status.js";
import { payloadChecksum } from "../outbox.js";
import { laundryRepo, paymentsRepo } from "../repositories/index.js";
import { uuidv7 } from "../uuid.js";
import { assertExpectedVersion, loadStoreMoneyContract, requireLocationCode } from "./shared.js";

export interface HubCommandEnvelopeInput {
  readonly device: HubDeviceContext;
  readonly idempotencyKey: string;
  readonly clientSequence: bigint;
  readonly businessDate: string;
  readonly requestId?: string;
  readonly correlationId?: string;
}

// ---------------------------------------------------------------------------
// Create draft
// ---------------------------------------------------------------------------
export interface CreateBookingDraftInput extends HubCommandEnvelopeInput {
  /** Appendix B display code; never guessed (repository rule 9). */
  readonly locationCode: string;
  readonly customerId?: string | null;
  readonly pickupMethod: string;
  readonly dueAt?: string | null;
}

export async function createBookingDraft(
  pool: HubPool,
  input: CreateBookingDraftInput,
): Promise<HubCommandResult> {
  const body = {
    location_code: input.locationCode,
    customer_id: input.customerId ?? null,
    pickup_method: input.pickupMethod,
    due_at: input.dueAt ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.booking.create_draft",
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
      const locationCode = requireLocationCode(body.location_code);
      const contract = await loadStoreMoneyContract(client, auth.device.locationId);

      const sequence = await laundryRepo.allocateBusinessNumber(
        client,
        auth.device.locationId,
        "booking",
        execution.businessDate,
      );
      const bookingNumber = await laundryRepo.formatDisplayNumber(
        client,
        "KLB",
        locationCode,
        execution.businessDate,
        sequence,
      );

      const bookingId = uuidv7();
      // The engine names the pre-finalization state; the Hub only projects it.
      const status = statusForLifecycleState("DRAFT");
      await laundryRepo.insertBooking(client, {
        id: bookingId,
        tenantId: auth.device.tenantId,
        digitalStoreId: auth.device.digitalStoreId,
        locationId: auth.device.locationId,
        bookingNumber,
        customerId: input.customerId ?? null,
        status,
        businessDate: execution.businessDate,
        currencyCode: contract.currencyCode,
        currencyExponent: contract.currencyExponent,
        subtotalMinor: 0n,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: 0n,
        dueAt: input.dueAt ?? null,
        pickupMethod: input.pickupMethod,
        configSnapshotId: contract.snapshotId,
      });

      const payload = {
        booking_id: bookingId,
        booking_number: bookingNumber,
        status,
        currency_code: contract.currencyCode,
        currency_exponent: contract.currencyExponent,
        pickup_method: input.pickupMethod,
      };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: bookingId,
        aggregateVersion: 1n,
        eventName: execution.definition.auditEvent,
        payload,
      });

      return {
        aggregateId: bookingId,
        aggregateVersion: 1n,
        resultJson: payload,
        auditResourceType: "booking",
        auditResourceId: bookingId,
      } satisfies HubHandlerResult;
    },
  );
}

// ---------------------------------------------------------------------------
// Update draft
// ---------------------------------------------------------------------------
export interface UpdateBookingDraftInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly dueAt?: string | null;
  readonly discountMinor?: bigint;
}

export async function updateBookingDraft(
  pool: HubPool,
  input: UpdateBookingDraftInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    due_at: input.dueAt ?? null,
    discount_minor: input.discountMinor?.toString() ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.booking.update_draft",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const booking = await loadScopedBooking(execution, input.bookingId);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      // KBR-TXN-003 / §1 principle 4: a finalized Booking is never edited.
      assertNotFinalized(lifecycleStateForStatus(booking.status));

      const discount = input.discountMinor ?? booking.discount_minor;
      const total = booking.subtotal_minor - discount + booking.tax_minor;
      const version = await laundryRepo.updateBookingProjection(execution.client, {
        bookingId: booking.id,
        expectedVersion: input.expectedVersion,
        discountMinor: discount,
        totalMinor: total,
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      });
      if (version === undefined) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_VERSION_CONFLICT",
          `Booking ${booking.id} changed concurrently; nothing was written.`,
        );
      }

      const payload = {
        booking_id: booking.id,
        discount_minor: discount.toString(),
        total_minor: total.toString(),
        currency_code: booking.currency_code,
        currency_exponent: booking.currency_exponent,
      };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "booking",
        auditResourceId: booking.id,
      } satisfies HubHandlerResult;
    },
  );
}

// ---------------------------------------------------------------------------
// Add / update a priced line
// ---------------------------------------------------------------------------
export interface BookingLineInput {
  readonly serviceId: string;
  readonly serviceVersion: bigint;
  readonly displayName: string;
  readonly unitPriceMinor: bigint;
  readonly unitCode: string;
  readonly discountMinor?: bigint;
  readonly taxMinor?: bigint;
  /** PER_PIECE requires a positive integer count. */
  readonly pieceCount?: number;
  /** PER_WEIGHT requires integer grams AND an explicit rounding rule. */
  readonly weightGrams?: number;
  readonly weightRoundingRule?: WeightRoundingRule;
}

export interface AddBookingLineInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly line: BookingLineInput;
}

export async function addBookingLine(
  pool: HubPool,
  input: AddBookingLineInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    service_id: input.line.serviceId,
    unit_price_minor: input.line.unitPriceMinor.toString(),
    piece_count: input.line.pieceCount ?? null,
    weight_grams: input.line.weightGrams ?? null,
    weight_rounding_rule: input.line.weightRoundingRule ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.booking.add_line",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const booking = await loadScopedBooking(execution, input.bookingId);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      assertNotFinalized(lifecycleStateForStatus(booking.status));

      const priced = priceLine(booking.currency_code as CurrencyCode, input.line);
      const lineDiscount = input.line.discountMinor ?? 0n;
      const lineTax = input.line.taxMinor ?? 0n;
      const lineTotal = priced.subtotalMinor - lineDiscount + lineTax;
      if (lineTotal < 0n) {
        throw new HubCommandError(
          "EDGE_INVALID_TRANSITION",
          "a Booking line total may not be negative (§6.4 line CHECK).",
        );
      }

      const lineId = uuidv7();
      await laundryRepo.insertBookingLine(execution.client, {
        id: lineId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        serviceId: input.line.serviceId,
        serviceVersion: input.line.serviceVersion,
        displayName: input.line.displayName,
        pricingMethod: priced.pricingMethod,
        unitPriceMinor: input.line.unitPriceMinor,
        currencyCode: booking.currency_code,
        currencyExponent: booking.currency_exponent,
        quantity: priced.quantity,
        unitCode: input.line.unitCode,
        lineSubtotalMinor: priced.subtotalMinor,
        discountMinor: lineDiscount,
        taxMinor: lineTax,
        lineTotalMinor: lineTotal,
        addonSnapshot: {},
        sourceConfigVersion: 1n,
      });

      const lines = await laundryRepo.listBookingLines(execution.client, booking.id);
      const subtotal = lines.reduce((sum, l) => sum + l.line_subtotal_minor, 0n);
      const tax = lines.reduce((sum, l) => sum + l.tax_minor, 0n);
      const lineDiscounts = lines.reduce((sum, l) => sum + l.discount_minor, 0n);
      const total = subtotal - lineDiscounts - booking.discount_minor + tax;
      const version = await laundryRepo.updateBookingProjection(execution.client, {
        bookingId: booking.id,
        expectedVersion: input.expectedVersion,
        subtotalMinor: subtotal,
        taxMinor: tax,
        totalMinor: total,
      });
      if (version === undefined) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_VERSION_CONFLICT",
          `Booking ${booking.id} changed concurrently; nothing was written.`,
        );
      }

      const payload = {
        booking_id: booking.id,
        booking_line_id: lineId,
        pricing_method: priced.pricingMethod,
        quantity: priced.quantity,
        line_total_minor: lineTotal.toString(),
        total_minor: total.toString(),
        currency_code: booking.currency_code,
        currency_exponent: booking.currency_exponent,
      };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "booking",
        auditResourceId: booking.id,
      } satisfies HubHandlerResult;
    },
  );
}

function priceLine(
  currency: CurrencyCode,
  line: BookingLineInput,
): { readonly pricingMethod: string; readonly quantity: string; readonly subtotalMinor: bigint } {
  if (line.pieceCount !== undefined) {
    const priced = pricePerPieceLine({
      kind: "per_piece",
      serviceCode: line.serviceId,
      unitPriceSnapshot: money(currency, line.unitPriceMinor),
      pieceCount: line.pieceCount,
    });
    return {
      pricingMethod: "per_piece",
      quantity: line.pieceCount.toFixed(4),
      subtotalMinor: priced.minorUnits,
    };
  }
  if (line.weightGrams === undefined || line.weightRoundingRule === undefined) {
    // "The per-weight rounding rule is NOT guessed" — an explicit rule from
    // approved configuration is mandatory (pricing.ts header).
    throw new HubCommandError(
      "EDGE_REQUIRED_VALUE_MISSING",
      "a PER_WEIGHT line requires weightGrams AND an explicit weightRoundingRule; the rounding rule is never defaulted.",
    );
  }
  const priced = pricePerWeightLine(
    {
      kind: "per_weight",
      serviceCode: line.serviceId,
      pricePerKgSnapshot: money(currency, line.unitPriceMinor),
      weightGrams: line.weightGrams,
    },
    line.weightRoundingRule,
  );
  return {
    pricingMethod: "per_weight",
    quantity: (line.weightGrams / 1000).toFixed(4),
    subtotalMinor: priced.minorUnits,
  };
}

// ---------------------------------------------------------------------------
// Register garment / assign tag / assign container
// ---------------------------------------------------------------------------
export interface RegisterGarmentInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly garmentCode: string;
  readonly garmentType: string;
  readonly color?: string | null;
  readonly conditionCode?: string | null;
  readonly specialHandling?: string | null;
  readonly bookingLineId?: string | null;
}

export async function registerGarment(
  pool: HubPool,
  input: RegisterGarmentInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    garment_code: input.garmentCode,
    garment_type: input.garmentType,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.booking.register_garment",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const booking = await loadScopedBooking(execution, input.bookingId);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      assertNotFinalized(lifecycleStateForStatus(booking.status));

      const garmentId = uuidv7();
      await laundryRepo.insertGarment(execution.client, {
        id: garmentId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        bookingLineId: input.bookingLineId ?? null,
        garmentCode: input.garmentCode,
        garmentType: input.garmentType,
        color: input.color ?? null,
        conditionCode: input.conditionCode ?? null,
        specialHandling: input.specialHandling ?? null,
        custodyState: "in_processing",
      });
      const version = await bumpBookingVersion(execution, booking.id, input.expectedVersion);

      const payload = {
        booking_id: booking.id,
        garment_id: garmentId,
        garment_code: input.garmentCode,
        garment_type: input.garmentType,
      };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "garment",
        auditResourceId: garmentId,
      } satisfies HubHandlerResult;
    },
  );
}

export interface AssignTagInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly tagCode: string;
  readonly tagType: string;
  readonly garmentId?: string | null;
  readonly bagId?: string | null;
}

export async function assignTag(pool: HubPool, input: AssignTagInput): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    tag_code: input.tagCode,
    tag_type: input.tagType,
    garment_id: input.garmentId ?? null,
    bag_id: input.bagId ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.booking.assign_tag",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const booking = await loadScopedBooking(execution, input.bookingId);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      const tagId = uuidv7();
      await laundryRepo.insertTag(execution.client, {
        id: tagId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        garmentId: input.garmentId ?? null,
        bagId: input.bagId ?? null,
        tagCode: input.tagCode,
        tagType: input.tagType,
      });
      const version = await bumpBookingVersion(execution, booking.id, input.expectedVersion);
      const payload = { booking_id: booking.id, tag_id: tagId, tag_code: input.tagCode };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "tag",
        auditResourceId: tagId,
      } satisfies HubHandlerResult;
    },
  );
}

export interface AssignContainerInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  readonly bagCode: string;
  readonly expectedPieceCount?: number | null;
}

export async function assignContainer(
  pool: HubPool,
  input: AssignContainerInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    bag_code: input.bagCode,
    expected_piece_count: input.expectedPieceCount ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.booking.assign_container",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const booking = await loadScopedBooking(execution, input.bookingId);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      const bagId = uuidv7();
      await laundryRepo.insertBag(execution.client, {
        id: bagId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        bagCode: input.bagCode,
        expectedPieceCount: input.expectedPieceCount ?? null,
        currentPieceCount: input.expectedPieceCount ?? null,
        custodyState: "in_processing",
      });
      const version = await bumpBookingVersion(execution, booking.id, input.expectedVersion);
      const payload = { booking_id: booking.id, bag_id: bagId, bag_code: input.bagCode };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "bag",
        auditResourceId: bagId,
      } satisfies HubHandlerResult;
    },
  );
}

// ---------------------------------------------------------------------------
// Confirm intake — the finalization boundary
// ---------------------------------------------------------------------------
export interface ConfirmIntakeInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedVersion: bigint;
  /** Optional intake deposit taken in cash at T1 (KBR-PAY-004). */
  readonly depositMinor?: bigint;
  readonly locationCode?: string;
}

export async function confirmIntake(
  pool: HubPool,
  input: ConfirmIntakeInput,
): Promise<HubCommandResult> {
  const body = {
    booking_id: input.bookingId,
    expected_version: input.expectedVersion.toString(),
    deposit_minor: input.depositMinor?.toString() ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.booking.confirm_intake",
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

      // CANONICAL ENGINE DECISION. An illegal edge throws BEFORE any write.
      const from = lifecycleStateForStatus(booking.status);
      const next = transitionBooking(from, "CONFIRMED/FINALIZED");
      // KBR-LND-001: the authoritative Booking begins production at RECEIVED.
      const status = statusForProductionState("RECEIVED");
      void next;

      const lines = await laundryRepo.listBookingLines(client, booking.id);
      if (lines.length === 0) {
        throw new HubCommandError(
          "EDGE_INVALID_TRANSITION",
          "a Booking cannot be confirmed with no priced line (KBR-TXN-003 freezes protected facts).",
        );
      }
      const subtotal = lines.reduce((sum, l) => sum + l.line_subtotal_minor, 0n);
      const lineDiscounts = lines.reduce((sum, l) => sum + l.discount_minor, 0n);
      const tax = lines.reduce((sum, l) => sum + l.tax_minor, 0n);
      const total = subtotal - lineDiscounts - booking.discount_minor + tax;

      const version = await laundryRepo.updateBookingProjection(client, {
        bookingId: booking.id,
        expectedVersion: input.expectedVersion,
        status,
        subtotalMinor: subtotal,
        taxMinor: tax,
        totalMinor: total,
      });
      if (version === undefined) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_VERSION_CONFLICT",
          `Booking ${booking.id} changed concurrently; nothing was written.`,
        );
      }

      // 1. Booking lifecycle event + append-only status history.
      const bookingEvent = await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload: {
          booking_id: booking.id,
          booking_number: booking.booking_number,
          from_status: booking.status,
          to_status: status,
          subtotal_minor: subtotal.toString(),
          total_minor: total.toString(),
          currency_code: booking.currency_code,
          currency_exponent: booking.currency_exponent,
          line_count: lines.length,
        },
      });
      await laundryRepo.appendStatusEvent(client, {
        id: uuidv7(),
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: status,
        reasonCode: null,
        actorId: auth.device.actorId,
        terminalDeviceId: auth.device.terminalDeviceId,
        localSequence: await laundryRepo.nextBookingLocalSequence(
          client,
          "status_event",
          booking.id,
        ),
        eventId: bookingEvent.eventId,
      });

      // 2. Initial custody for every registered garment (append-only chain).
      const garments = await laundryRepo.listGarments(client, booking.id);
      for (const garment of garments) {
        const custodyPayload = {
          booking_id: booking.id,
          garment_id: garment.id,
          garment_code: garment.garment_code,
          event_type: "intake_received",
          to_custody_state: "in_processing",
        };
        const custodyEvent = await execution.recorder.record({
          aggregateType: "booking",
          aggregateId: booking.id,
          aggregateVersion: version,
          // PROPOSED name: intake custody is neither EVT-LND-003 (T3 scan-in)
          // nor EVT-LND-004 (T4 scan-out); it must be registered before release.
          eventName: "garment.custody_recorded",
          payload: custodyPayload,
          causationId: bookingEvent.eventId,
        });
        await laundryRepo.appendCustodyEvent(client, {
          id: uuidv7(),
          tenantId: booking.tenant_id,
          digitalStoreId: booking.digital_store_id,
          locationId: booking.location_id,
          bookingId: booking.id,
          garmentId: garment.id,
          bagId: null,
          eventType: "intake_received",
          fromCustodyState: null,
          toCustodyState: "in_processing",
          storagePositionId: null,
          actorId: auth.device.actorId,
          terminalDeviceId: auth.device.terminalDeviceId,
          sessionId: auth.device.sessionId,
          localSequence: await laundryRepo.nextBookingLocalSequence(
            client,
            "custody_event",
            booking.id,
          ),
          reasonCode: null,
          payloadSha256: payloadChecksum(custodyPayload),
          eventId: custodyEvent.eventId,
        });
      }

      // 3. Optional intake deposit — a payment EVENT, never a finance journal.
      let depositPaymentId: string | null = null;
      let paid = booking.paid_minor;
      if (input.depositMinor !== undefined && input.depositMinor > 0n) {
        const locationCode = requireLocationCode(input.locationCode);
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
        depositPaymentId = uuidv7();
        const depositPayload = {
          booking_id: booking.id,
          payment_id: depositPaymentId,
          payment_number: paymentNumber,
          payment_type: "cash",
          amount_minor: input.depositMinor.toString(),
          currency_code: booking.currency_code,
          currency_exponent: booking.currency_exponent,
          allocation: "deposit",
          // KBR-PAY-004: a deposit is money held BEFORE full settlement; it is
          // never conflated with full settlement.
          settles_booking: input.depositMinor >= total,
          cloud_posting_status: "unknown",
        };
        const depositEvent = await execution.recorder.record({
          aggregateType: "payment",
          aggregateId: depositPaymentId,
          aggregateVersion: 1n,
          eventName: "payment.recorded",
          payload: depositPayload,
          causationId: bookingEvent.eventId,
        });
        await paymentsRepo.insertPayment(client, {
          id: depositPaymentId,
          tenantId: booking.tenant_id,
          digitalStoreId: booking.digital_store_id,
          locationId: booking.location_id,
          bookingId: booking.id,
          paymentNumber,
          paymentType: "cash",
          amountMinor: input.depositMinor,
          currencyCode: booking.currency_code,
          currencyExponent: booking.currency_exponent,
          state: "confirmed",
          providerCode: null,
          providerReference: null,
          confirmed: true,
          actorId: auth.device.actorId,
          terminalDeviceId: auth.device.terminalDeviceId,
          eventId: depositEvent.eventId,
          // KLREQ-026: the payment ROW carries the TERMINAL COMMAND key, like
          // ready_scan_session and pickup_session. The event it was recorded by
          // carries its own Hub-issued kh1.* effect key; storing that here would
          // make the payment ledger's dedupe key a per-effect identity instead of
          // a per-command one.
          idempotencyKey: execution.idempotencyKey,
        });
        paid = booking.paid_minor + input.depositMinor;
        const afterDeposit = await laundryRepo.updateBookingProjection(client, {
          bookingId: booking.id,
          expectedVersion: version,
          paidMinor: paid,
          totalMinor: total,
        });
        if (afterDeposit === undefined) {
          throw new HubCommandError(
            "EDGE_AGGREGATE_VERSION_CONFLICT",
            `Booking ${booking.id} changed concurrently while recording the deposit.`,
          );
        }
      }

      const finalBooking = await laundryRepo.findBooking(client, booking.id);
      const resultJson = {
        booking_id: booking.id,
        booking_number: booking.booking_number,
        status,
        total_minor: total.toString(),
        paid_minor: paid.toString(),
        balance_minor: (finalBooking?.balance_minor ?? total - paid).toString(),
        currency_code: booking.currency_code,
        currency_exponent: booking.currency_exponent,
        garment_count: garments.length,
        deposit_payment_id: depositPaymentId,
      };
      return {
        aggregateId: booking.id,
        aggregateVersion: finalBooking?.aggregate_version ?? version,
        resultJson,
        auditResourceType: "booking",
        auditResourceId: booking.id,
      } satisfies HubHandlerResult;
    },
  );
}

// ---------------------------------------------------------------------------
// Shared loading helpers
// ---------------------------------------------------------------------------
export async function loadScopedBooking(
  execution: HubCommandExecution,
  bookingId: string,
): Promise<Awaited<ReturnType<typeof laundryRepo.loadBookingForUpdate>> & object> {
  const booking = await laundryRepo.loadBookingForUpdate(execution.client, bookingId);
  if (!booking) {
    throw new HubCommandError("EDGE_AGGREGATE_NOT_FOUND", `Booking ${bookingId} does not exist.`, {
      bookingId,
    });
  }
  // §12 acceptance test 9: cross-Tenant AND cross-Location rows are rejected.
  const device = execution.auth.device;
  if (
    booking.tenant_id !== device.tenantId ||
    booking.digital_store_id !== device.digitalStoreId ||
    booking.location_id !== device.locationId
  ) {
    throw new HubCommandError(
      "EDGE_RESOURCE_SCOPE_DENIED",
      `Booking ${bookingId} belongs to a different Tenant / Digital Store / Location.`,
      { bookingId },
    );
  }
  return booking;
}

async function bumpBookingVersion(
  execution: HubCommandExecution,
  bookingId: string,
  expectedVersion: bigint,
): Promise<bigint> {
  const version = await laundryRepo.updateBookingProjection(execution.client, {
    bookingId,
    expectedVersion,
  });
  if (version === undefined) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      `Booking ${bookingId} changed concurrently; nothing was written.`,
    );
  }
  return version;
}
