/**
 * Confirm a Laundry Booking FROM its Booking Draft, paid in cash, with a
 * receipt record — T1-REAL-OPERATIONS-001 slice 2.
 *
 * Authority: KLD-2026-09-19-T1-REAL-OPERATIONS-001 decision 1 (verbatim in
 * substance): "T1 creates the Booking at confirm, from the verified cart, in
 * one Hub command. The approved route POST /edge/v1/laundry/bookings/{id}/
 * confirm-intake (permission laundry.bookings.create, T1 only, idempotent) is
 * served with {id} = the WS-12-T002 Booking Draft; the body carries the lines,
 * the tender and the terminal's displayed totals. The Hub prices every line
 * itself, refuses PRICE_MISMATCH if the terminal's figures differ, converts the
 * draft (lifecycle = converted), writes edge_laundry.booking + booking_line +
 * status_event, the cash edge_payments.payment (+ USD tender_leg at the
 * configured rate), the edge_documents.receipt and a print_job, and answers
 * the receipt payload." The standalone `pos.create_full_order` is the
 * behavioural reference (one door: lines + immediate tender, idempotent
 * replay indistinguishable from a read); its SQL is not copied.
 *
 * ONE SERIALIZABLE TRANSACTION through the canonical pipeline: authorisation
 * (a Terminal PIN session's actor is the terminal itself), the terminal's
 * `kl1.*` key reserved, every row and every outbox fact below, the audit
 * event and the command result commit together or not at all. A replay of the
 * same key answers the ORIGINAL result (same booking number, same receipt,
 * same change) and writes nothing.
 *
 * WHAT THE HUB TRUSTS FROM THE TERMINAL: nothing about money. Prices come from
 * the ACTIVE snapshot's `catalog`; the rule, currency, location code and FX
 * rate from its `pricing` (money) section; the terminal's displayed total is
 * COMPARED, never used. Cash at intake rides inside this command under the
 * terminal's own T1 grant (decision 1); `payments.capture.cash` as a separate
 * command stays outside the Terminal PIN surface.
 */
import {
  parseLaundryCatalogSection,
  parseLaundryMoneySection,
  quoteIntakeLines,
  settleCashTender,
  transitionBooking,
  type IntakeLineRequest,
  type IntakeQuote,
  type CashSettlement,
} from "@kitluy-verticals/phase1-laundry";

import type { HubClient, HubPool } from "../db.js";
import { HubCommandError } from "../errors.js";
import {
  executeHubCommand,
  type HubCommandExecution,
  type HubCommandResult,
  type HubHandlerResult,
} from "../command-pipeline.js";
import { statusForLifecycleState, statusForProductionState } from "../booking-status.js";
import { payloadChecksum, sha256Hex } from "../outbox.js";
import { configRepo, documentsRepo, laundryRepo, paymentsRepo } from "../repositories/index.js";
import { uuidv7 } from "../uuid.js";
import { canonicalJson } from "../../hub-database.js";
import { BOOKING_DRAFT_EVENT_NAME } from "../t1-intake.js";
import type { HubCommandEnvelopeInput } from "./booking-commands.js";
import { enqueueReceiptPrint } from "./print-commands.js";
import { postingDeduplicationKey } from "./payment-commands.js";
import { requireLocationCode } from "./shared.js";

export const CONFIRM_FROM_DRAFT_COMMAND = "laundry.booking.confirm_from_draft" as const;
/** PROPOSED event names (recorded in the slice-2 handoff for registration). */
export const TENDER_RECORDED_EVENT_NAME = "payment.tender_recorded" as const;
export const RECEIPT_ISSUED_EVENT_NAME = "document.receipt_issued" as const;
export const BOOKING_RECEIPT_DOCUMENT_TYPE = "booking_receipt" as const;
export const BOOKING_RECEIPT_TEMPLATE_VERSION = 1n;
/** Route-level bound on the number of lines one intake may carry. */
export const MAX_INTAKE_LINES = 200;

export interface ConfirmFromDraftInput extends HubCommandEnvelopeInput {
  readonly draftId: string;
  /** The draft version the terminal last saw (optimistic concurrency). */
  readonly expectedVersion: number;
  readonly lines: readonly IntakeLineRequest[];
  readonly express: boolean;
  /** What the terminal SHOWED the customer; compared, never used. */
  readonly displayedTotalMinor: bigint;
  readonly tender: { readonly localMinor: bigint; readonly usdCents: bigint };
}

/** The wire-visible refusal vocabulary this command adds (details.result). */
export type ConfirmFromDraftRefusal =
  | "DRAFT_UNKNOWN"
  | "DRAFT_NOT_OPEN"
  | "DRAFT_VERSION_STALE"
  | "CONFIGURATION_MISSING"
  | "CATALOG_NOT_DELIVERED"
  | "MONEY_CONTRACT_MISSING"
  | "NO_LINES"
  | "SERVICE_UNKNOWN"
  | "PRICING_MODE_MISMATCH"
  | "QUANTITY_INVALID"
  | "CURRENCY_MISMATCH"
  | "WEIGHT_RULE_MISSING"
  | "MONEY_ROUNDING_UNKNOWN"
  | "EXPRESS_NOT_CONFIGURED"
  | "PRICE_MISMATCH"
  | "TENDER_INVALID"
  | "FX_RATE_UNAVAILABLE"
  | "TENDER_INSUFFICIENT";

interface DraftRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
  readonly environment: string;
  readonly terminal_device_id: string;
  readonly session_id: string;
  readonly staff_actor_id: string;
  readonly customer_id: string | null;
  readonly walk_in: boolean;
  readonly customer_snapshot: Record<string, unknown>;
  readonly preferred_language: string;
  readonly intake_source: string;
  readonly customer_notes: string;
  readonly staff_notes: string;
  readonly lifecycle: string;
  readonly cancel_reason_code: string | null;
  readonly version: string | number | bigint;
  readonly converted_booking_id: string | null;
  readonly sync_state: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/**
 * The delivered sections the Hub prices from, read from the ACTIVE snapshot
 * of the Location. Missing or malformed → the Hub refuses to price
 * (`loadStoreMoneyContract` precedent: never a default).
 */
export async function loadIntakePricingSections(
  client: HubClient,
  locationId: string,
): Promise<{
  readonly snapshotId: string;
  readonly snapshotVersion: bigint;
  readonly catalog: NonNullable<ReturnType<typeof parseLaundryCatalogSection>>;
  readonly money: NonNullable<ReturnType<typeof parseLaundryMoneySection>>;
}> {
  const active = await configRepo.findActiveConfiguration(client, locationId);
  if (!active) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `Location ${locationId} has no ACTIVE configuration snapshot; the Hub refuses to price without one.`,
      { locationId, result: "CONFIGURATION_MISSING" satisfies ConfirmFromDraftRefusal },
    );
  }
  const pricing = await configRepo.findConfigurationSection(client, active.snapshot_id, "pricing");
  const money = pricing === undefined ? null : parseLaundryMoneySection(pricing.content_json);
  if (money === null) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `configuration snapshot ${active.snapshot_id} carries no kitluy.config.money.v1 'pricing' section.`,
      {
        snapshotId: active.snapshot_id,
        result: "MONEY_CONTRACT_MISSING" satisfies ConfirmFromDraftRefusal,
      },
    );
  }
  const catalogSection = await configRepo.findConfigurationSection(
    client,
    active.snapshot_id,
    "catalog",
  );
  const catalog =
    catalogSection === undefined ? null : parseLaundryCatalogSection(catalogSection.content_json);
  if (catalog === null) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `configuration snapshot ${active.snapshot_id} carries no kitluy.config.catalog.v1 'catalog' section.`,
      {
        snapshotId: active.snapshot_id,
        result: "CATALOG_NOT_DELIVERED" satisfies ConfirmFromDraftRefusal,
      },
    );
  }
  return {
    snapshotId: active.snapshot_id,
    snapshotVersion: active.snapshot_version,
    catalog,
    money,
  };
}

/**
 * Price the lines exactly as confirm will, WITHOUT writing anything: the
 * companion read (`.../drafts/{id}/quote`). A refusal carries its wire result.
 */
export function priceIntakeOrRefuse(
  sections: Awaited<ReturnType<typeof loadIntakePricingSections>>,
  lines: readonly IntakeLineRequest[],
  express: boolean,
): IntakeQuote {
  const priced = quoteIntakeLines(sections.catalog, sections.money, lines, { express });
  if (!priced.ok) {
    const { code, ...rest } = priced.refusal;
    throw new HubCommandError(
      code === "NO_LINES" || code === "QUANTITY_INVALID"
        ? "EDGE_INVALID_TRANSITION"
        : code === "WEIGHT_RULE_MISSING" ||
            code === "MONEY_ROUNDING_UNKNOWN" ||
            code === "EXPRESS_NOT_CONFIGURED"
          ? "EDGE_CONFIGURATION_MISSING"
          : "EDGE_REQUIRED_VALUE_MISSING",
      `the Hub cannot price this intake: ${code}.`,
      { result: code satisfies ConfirmFromDraftRefusal, ...rest },
    );
  }
  return priced.quote;
}

function settleOrRefuse(
  totalMinor: bigint,
  money: Awaited<ReturnType<typeof loadIntakePricingSections>>["money"],
  tender: ConfirmFromDraftInput["tender"],
): CashSettlement {
  const settled = settleCashTender(totalMinor, money, tender);
  if (!settled.ok) {
    const { code, ...rest } = settled.refusal;
    throw new HubCommandError(
      code === "FX_RATE_UNAVAILABLE" ? "EDGE_CONFIGURATION_MISSING" : "EDGE_INVALID_TRANSITION",
      `the tender does not settle this Booking: ${code}.`,
      {
        result: code satisfies ConfirmFromDraftRefusal,
        ...Object.fromEntries(
          Object.entries(rest).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]),
        ),
      },
    );
  }
  return settled.settlement;
}

async function loadScopedDraftForUpdate(
  execution: HubCommandExecution,
  draftId: string,
): Promise<DraftRow> {
  const device = execution.auth.device;
  const found = await execution.client.query<DraftRow>(
    `select * from edge_laundry.booking_draft
      where id = $1::uuid and tenant_id = $2::uuid and digital_store_id = $3::uuid
        and location_id = $4::uuid
      for update`,
    [draftId, device.tenantId, device.digitalStoreId, device.locationId],
  );
  const draft = found.rows[0];
  if (draft === undefined) {
    // Scoped-missing merges with cross-scope: no row-existence oracle (T002).
    throw new HubCommandError(
      "EDGE_AGGREGATE_NOT_FOUND",
      `draft ${draftId} is not in this scope.`,
      {
        draftId,
        result: "DRAFT_UNKNOWN" satisfies ConfirmFromDraftRefusal,
      },
    );
  }
  return draft;
}

/** Money on the wire is a decimal string (§1). */
const s = (value: bigint): string => value.toString();

export async function confirmBookingFromDraft(
  pool: HubPool,
  input: ConfirmFromDraftInput,
): Promise<HubCommandResult> {
  const body = {
    draft_id: input.draftId,
    expected_version: input.expectedVersion,
    express: input.express,
    displayed_total_minor: s(input.displayedTotalMinor),
    tender: {
      type: "cash",
      local_minor: s(input.tender.localMinor),
      usd_cents: s(input.tender.usdCents),
    },
    lines: input.lines.map((line) => ({
      service_id: line.serviceId.toLowerCase(),
      ...(line.pieceCount === undefined ? {} : { piece_count: line.pieceCount }),
      ...(line.weighedGrams === undefined ? {} : { weighed_grams: line.weighedGrams }),
    })),
  };
  return executeHubCommand(
    pool,
    {
      commandType: CONFIRM_FROM_DRAFT_COMMAND,
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => handler(execution, input, body),
  );
}

async function handler(
  execution: HubCommandExecution,
  input: ConfirmFromDraftInput,
  body: Readonly<Record<string, unknown>>,
): Promise<HubHandlerResult> {
  const { client, auth } = execution;
  const device = auth.device;

  // 1. The draft: open, at the version the terminal saw, in this scope.
  const draft = await loadScopedDraftForUpdate(execution, input.draftId);
  if (draft.lifecycle !== "open") {
    throw new HubCommandError(
      "EDGE_INVALID_TRANSITION",
      `draft ${draft.id} is ${draft.lifecycle}; only an open draft can be confirmed.`,
      {
        draftId: draft.id,
        lifecycle: draft.lifecycle,
        convertedBookingId: draft.converted_booking_id,
        result: "DRAFT_NOT_OPEN" satisfies ConfirmFromDraftRefusal,
      },
    );
  }
  const draftVersion = Number(draft.version);
  if (draftVersion !== input.expectedVersion) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      `draft ${draft.id} is at version ${String(draftVersion)}, expected ${String(input.expectedVersion)}.`,
      {
        draftId: draft.id,
        actual: draftVersion,
        expected: input.expectedVersion,
        result: "DRAFT_VERSION_STALE" satisfies ConfirmFromDraftRefusal,
      },
    );
  }

  // 2. The Hub prices from ITS delivered sections; the terminal's total is compared.
  const sections = await loadIntakePricingSections(client, device.locationId);
  const quote = priceIntakeOrRefuse(sections, input.lines, input.express);
  if (quote.totalMinor !== input.displayedTotalMinor) {
    throw new HubCommandError(
      "EDGE_INVALID_TRANSITION",
      `the terminal displayed ${s(input.displayedTotalMinor)} but the Hub prices ${s(quote.totalMinor)} ${quote.currencyCode}.`,
      {
        result: "PRICE_MISMATCH" satisfies ConfirmFromDraftRefusal,
        hubTotalMinor: s(quote.totalMinor),
        displayedTotalMinor: s(input.displayedTotalMinor),
        currencyCode: quote.currencyCode,
      },
    );
  }
  const settlement = settleOrRefuse(quote.totalMinor, sections.money, input.tender);
  const locationCode = requireLocationCode(sections.money.locationCode);

  // 3. CANONICAL ENGINE DECISION: DRAFT -> CONFIRMED/FINALIZED; production
  //    begins at RECEIVED (KBR-LND-001). An illegal edge throws before any write.
  transitionBooking("DRAFT", "CONFIRMED/FINALIZED");
  const fromStatus = statusForLifecycleState("DRAFT");
  const status = statusForProductionState("RECEIVED");

  // 4. Numbers (Appendix B display profiles; local, never waiting on the WAN).
  const bookingNumber = await laundryRepo.formatDisplayNumber(
    client,
    "KLB",
    locationCode,
    execution.businessDate,
    await laundryRepo.allocateBusinessNumber(
      client,
      device.locationId,
      "booking",
      execution.businessDate,
    ),
  );

  // 5. The Booking and its priced lines (immutable snapshots, POS spec §5.6).
  const bookingId = uuidv7();
  await laundryRepo.insertBooking(client, {
    id: bookingId,
    tenantId: device.tenantId,
    digitalStoreId: device.digitalStoreId,
    locationId: device.locationId,
    bookingNumber,
    customerId: draft.customer_id,
    status,
    businessDate: execution.businessDate,
    currencyCode: quote.currencyCode,
    currencyExponent: quote.currencyExponent,
    subtotalMinor: quote.subtotalMinor,
    discountMinor: 0n,
    // The express surcharge is a priced addition, carried as the tax slot's
    // sibling would be if there were one: totals = subtotal + surcharge.
    taxMinor: quote.expressSurchargeMinor,
    totalMinor: quote.totalMinor,
    dueAt: null,
    pickupMethod: "store_pickup",
    configSnapshotId: sections.snapshotId,
  });
  const lineIds: string[] = [];
  for (const line of quote.lines) {
    const lineId = uuidv7();
    lineIds.push(lineId);
    await laundryRepo.insertBookingLine(client, {
      id: lineId,
      tenantId: device.tenantId,
      digitalStoreId: device.digitalStoreId,
      locationId: device.locationId,
      bookingId,
      serviceId: line.serviceId,
      serviceVersion: BigInt(line.serviceVersion),
      displayName: line.displayName,
      pricingMethod: line.pricingMethod,
      unitPriceMinor: line.unitPriceMinor,
      currencyCode: quote.currencyCode,
      currencyExponent: quote.currencyExponent,
      quantity: line.quantity,
      unitCode: line.unitCode,
      lineSubtotalMinor: line.lineSubtotalMinor,
      discountMinor: 0n,
      taxMinor: 0n,
      lineTotalMinor: line.lineSubtotalMinor,
      addonSnapshot: {
        service_code: line.serviceCode,
        family_code: line.familyCode,
        ...(line.weighedGrams === null
          ? {}
          : { weighed_grams: line.weighedGrams, billable_grams: line.billableGrams }),
      },
      sourceConfigVersion: sections.snapshotVersion,
    });
  }

  // 6. The Booking fact (the route's registered audit event) + status history.
  let version = 1n;
  const bookingPayload = {
    booking_id: bookingId,
    booking_number: bookingNumber,
    hub_draft_id: draft.id,
    from_status: fromStatus,
    to_status: status,
    walk_in: draft.walk_in,
    local_customer_id: draft.customer_id,
    customer_snapshot: draft.customer_snapshot,
    preferred_language: draft.preferred_language,
    intake_source: draft.intake_source,
    customer_notes: draft.customer_notes,
    staff_notes: draft.staff_notes,
    currency_code: quote.currencyCode,
    currency_exponent: quote.currencyExponent,
    subtotal_minor: s(quote.subtotalMinor),
    express: quote.express,
    express_surcharge_bps: quote.expressSurchargeBps,
    express_surcharge_minor: s(quote.expressSurchargeMinor),
    total_minor: s(quote.totalMinor),
    line_count: quote.lines.length,
    lines: quote.lines.map((line, index) => ({
      booking_line_id: lineIds[index],
      service_id: line.serviceId,
      service_code: line.serviceCode,
      service_version: line.serviceVersion,
      display_name: line.displayName,
      family_code: line.familyCode,
      pricing_method: line.pricingMethod,
      unit_code: line.unitCode,
      unit_price_minor: s(line.unitPriceMinor),
      quantity: line.quantity,
      piece_count: line.pieceCount,
      weighed_grams: line.weighedGrams,
      billable_grams: line.billableGrams,
      line_subtotal_minor: s(line.lineSubtotalMinor),
    })),
    config_snapshot_id: sections.snapshotId,
    config_snapshot_version: s(sections.snapshotVersion),
  };
  const bookingEvent = await execution.recorder.record({
    aggregateType: "booking",
    aggregateId: bookingId,
    aggregateVersion: version,
    eventName: execution.definition.auditEvent,
    payload: bookingPayload,
  });
  await laundryRepo.appendStatusEvent(client, {
    id: uuidv7(),
    tenantId: device.tenantId,
    digitalStoreId: device.digitalStoreId,
    locationId: device.locationId,
    bookingId,
    fromStatus,
    toStatus: status,
    reasonCode: null,
    actorId: device.actorId,
    terminalDeviceId: device.terminalDeviceId,
    localSequence: await laundryRepo.nextBookingLocalSequence(client, "status_event", bookingId),
    eventId: bookingEvent.eventId,
  });

  // 7. Cash in full at intake (owner 2026-09-19). A zero-total Booking has no
  //    payment row (0006: amount_minor > 0) and nothing to settle.
  let paymentId: string | null = null;
  let paymentNumber: string | null = null;
  let cashMovementId: string | null = null;
  if (settlement.appliedMinor > 0n) {
    paymentId = uuidv7();
    paymentNumber = await laundryRepo.formatDisplayNumber(
      client,
      "KLP",
      locationCode,
      execution.businessDate,
      await laundryRepo.allocateBusinessNumber(
        client,
        device.locationId,
        "payment",
        execution.businessDate,
      ),
    );
    const paymentPayload = {
      booking_id: bookingId,
      booking_number: bookingNumber,
      payment_id: paymentId,
      payment_number: paymentNumber,
      payment_type: "cash",
      amount_minor: s(settlement.appliedMinor),
      tendered_minor: s(settlement.tenderedMinor),
      change_due_minor: s(settlement.changeDueMinor),
      currency_code: settlement.currencyCode,
      currency_exponent: settlement.currencyExponent,
      payment_state: "confirmed",
      is_paid: true,
      // KBR-PAY-004: cash in full at intake settles the Booking; it is not a deposit.
      allocation: "settlement",
      legs: settlement.legs.map((leg) => ({
        tender_type: leg.tenderType,
        currency_code: leg.currencyCode,
        currency_exponent: leg.currencyExponent,
        amount_minor: s(leg.amountMinor),
        local_equivalent_minor: s(leg.localEquivalentMinor),
        khr_per_usd: leg.khrPerUsd,
      })),
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
      causationId: bookingEvent.eventId,
    });
    await paymentsRepo.insertPayment(client, {
      id: paymentId,
      tenantId: device.tenantId,
      digitalStoreId: device.digitalStoreId,
      locationId: device.locationId,
      bookingId,
      paymentNumber,
      paymentType: "cash",
      amountMinor: settlement.appliedMinor,
      currencyCode: settlement.currencyCode,
      currencyExponent: settlement.currencyExponent,
      state: "confirmed",
      providerCode: null,
      providerReference: null,
      confirmed: true,
      actorId: device.actorId,
      terminalDeviceId: device.terminalDeviceId,
      eventId: paymentEvent.eventId,
      // KLREQ-026: the payment ROW carries the TERMINAL COMMAND key.
      idempotencyKey: execution.idempotencyKey,
    });
    // One leg per currency handed over, each with its own fact (0006:
    // tender_leg.event_id is unique) and the rate that reproduces it.
    for (const leg of settlement.legs) {
      const legEvent = await execution.recorder.record({
        aggregateType: "payment",
        aggregateId: paymentId,
        aggregateVersion: 1n,
        eventName: TENDER_RECORDED_EVENT_NAME,
        payload: {
          booking_id: bookingId,
          payment_id: paymentId,
          tender_type: leg.tenderType,
          currency_code: leg.currencyCode,
          currency_exponent: leg.currencyExponent,
          amount_minor: s(leg.amountMinor),
          local_currency_code: settlement.currencyCode,
          local_equivalent_minor: s(leg.localEquivalentMinor),
          khr_per_usd: leg.khrPerUsd,
        },
        causationId: paymentEvent.eventId,
      });
      await paymentsRepo.insertTenderLeg(client, {
        id: uuidv7(),
        tenantId: device.tenantId,
        digitalStoreId: device.digitalStoreId,
        locationId: device.locationId,
        paymentId,
        tenderType: leg.tenderType,
        amountMinor: leg.amountMinor,
        currencyCode: leg.currencyCode,
        currencyExponent: leg.currencyExponent,
        state: "settled",
        providerReference: null,
        eventId: legEvent.eventId,
      });
    }
    const paid = await laundryRepo.updateBookingProjection(client, {
      bookingId,
      expectedVersion: version,
      paidMinor: settlement.appliedMinor,
    });
    if (paid === undefined) {
      throw new HubCommandError(
        "EDGE_AGGREGATE_VERSION_CONFLICT",
        `Booking ${bookingId} changed concurrently while recording the payment.`,
      );
    }
    version = paid;

    // The drawer movement, when this terminal has an open shift (a Pi
    // Terminal under the PIN model has none yet — recorded, not stubbed).
    const shift = await paymentsRepo.findOpenShift(
      client,
      device.locationId,
      device.terminalDeviceId,
    );
    if (shift) {
      const movementEvent = await execution.recorder.record({
        aggregateType: "payment",
        aggregateId: paymentId,
        aggregateVersion: 1n,
        eventName: "cash.movement_recorded",
        payload: {
          booking_id: bookingId,
          payment_id: paymentId,
          shift_id: shift.id,
          movement_type: "payment_received",
          amount_minor: s(settlement.appliedMinor),
          currency_code: settlement.currencyCode,
          currency_exponent: settlement.currencyExponent,
          posting_dedup_key: postingDeduplicationKey("cash_movement", paymentId),
          cloud_posting_status: "unknown",
        },
        causationId: paymentEvent.eventId,
      });
      cashMovementId = uuidv7();
      await paymentsRepo.insertCashMovement(client, {
        id: cashMovementId,
        tenantId: device.tenantId,
        digitalStoreId: device.digitalStoreId,
        locationId: device.locationId,
        shiftId: shift.id,
        movementType: "payment_received",
        amountMinor: settlement.appliedMinor,
        currencyCode: settlement.currencyCode,
        currencyExponent: settlement.currencyExponent,
        reasonCode: null,
        relatedPaymentId: paymentId,
        actorId: device.actorId,
        terminalDeviceId: device.terminalDeviceId,
        eventId: movementEvent.eventId,
      });
    }
  }

  // 8. The receipt RECORD (§6.6): the payload the terminal renders and prints,
  //    hashed into the row. Slice 3 prints it on the Pi's USB printer.
  const receiptId = uuidv7();
  const receiptNumber = await laundryRepo.formatDisplayNumber(
    client,
    "KLR",
    locationCode,
    execution.businessDate,
    await laundryRepo.allocateBusinessNumber(
      client,
      device.locationId,
      "receipt",
      execution.businessDate,
    ),
  );
  const issuedAt =
    (await client.query<{ now: Date }>(`select now() as now`)).rows[0]?.now ?? new Date();
  const receiptPayload = {
    document_type: BOOKING_RECEIPT_DOCUMENT_TYPE,
    template_version: s(BOOKING_RECEIPT_TEMPLATE_VERSION),
    receipt_id: receiptId,
    receipt_number: receiptNumber,
    /** The Hub's transaction clock — the same instant the receipt row carries. */
    issued_at: issuedAt.toISOString(),
    booking_id: bookingId,
    booking_number: bookingNumber,
    business_date: execution.businessDate,
    location_code: locationCode,
    customer: draft.walk_in ? { walk_in: true } : draft.customer_snapshot,
    preferred_language: draft.preferred_language,
    currency_code: quote.currencyCode,
    currency_exponent: quote.currencyExponent,
    lines: bookingPayload.lines,
    subtotal_minor: s(quote.subtotalMinor),
    express: quote.express,
    express_surcharge_minor: s(quote.expressSurchargeMinor),
    total_minor: s(quote.totalMinor),
    payment:
      paymentId === null
        ? null
        : {
            payment_id: paymentId,
            payment_number: paymentNumber,
            payment_type: "cash",
            amount_minor: s(settlement.appliedMinor),
            tendered_minor: s(settlement.tenderedMinor),
            change_due_minor: s(settlement.changeDueMinor),
            legs: settlement.legs.map((leg) => ({
              currency_code: leg.currencyCode,
              currency_exponent: leg.currencyExponent,
              amount_minor: s(leg.amountMinor),
              local_equivalent_minor: s(leg.localEquivalentMinor),
              khr_per_usd: leg.khrPerUsd,
            })),
          },
    paid_minor: s(settlement.appliedMinor),
    balance_minor: s(quote.totalMinor - settlement.appliedMinor),
  };
  const receiptSha256 = sha256Hex(canonicalJson(receiptPayload));
  const receiptEvent = await execution.recorder.record({
    aggregateType: "booking",
    aggregateId: bookingId,
    aggregateVersion: version,
    eventName: RECEIPT_ISSUED_EVENT_NAME,
    payload: {
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      booking_id: bookingId,
      booking_number: bookingNumber,
      payment_id: paymentId,
      document_type: BOOKING_RECEIPT_DOCUMENT_TYPE,
      template_version: s(BOOKING_RECEIPT_TEMPLATE_VERSION),
      content_sha256: receiptSha256,
    },
    causationId: bookingEvent.eventId,
  });
  await documentsRepo.insertReceipt(client, {
    id: receiptId,
    tenantId: device.tenantId,
    digitalStoreId: device.digitalStoreId,
    locationId: device.locationId,
    bookingId,
    paymentId,
    receiptNumber,
    documentType: BOOKING_RECEIPT_DOCUMENT_TYPE,
    templateVersion: BOOKING_RECEIPT_TEMPLATE_VERSION,
    contentSha256: receiptSha256,
    issuedBy: device.actorId,
    eventId: receiptEvent.eventId,
  });
  // A print job needs a configured printer binding at the Location. Without
  // one the receipt is still ISSUED (the terminal renders it from the answer)
  // and the missing binding is reported, never a job to nowhere.
  let printJobId: string | null = null;
  let printState: "queued" | "no_printer_binding" = "no_printer_binding";
  const binding = await configRepo.findPeripheralBinding(
    client,
    device.locationId,
    "receipt_printer",
  );
  if (binding) {
    printJobId = await enqueueReceiptPrint(client, {
      tenantId: device.tenantId,
      digitalStoreId: device.digitalStoreId,
      locationId: device.locationId,
      documentType: BOOKING_RECEIPT_DOCUMENT_TYPE,
      documentId: receiptId,
      templateVersion: BOOKING_RECEIPT_TEMPLATE_VERSION,
      payloadSha256: receiptSha256,
      createdBy: device.actorId,
      terminalDeviceId: device.terminalDeviceId,
    });
    printState = "queued";
  }

  // 9. The draft becomes CONVERTED (0040 guard: open -> converted, version +1;
  //    0045: it names its Booking). Its receipt and outbox fact keep the T002
  //    vocabulary so the cloud draft projection ingests the conversion today.
  const draftVersionAfter = draftVersion + 1;
  const converted = await client.query<{ updated_at: Date; created_at: Date; sync_state: string }>(
    `update edge_laundry.booking_draft
        set lifecycle = 'converted', converted_booking_id = $2::uuid, version = $3
      where id = $1::uuid
      returning updated_at, created_at, sync_state`,
    [draft.id, bookingId, draftVersionAfter],
  );
  const draftAfter = converted.rows[0];
  if (draftAfter === undefined) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      `draft ${draft.id} changed concurrently; nothing was written.`,
    );
  }
  const draftReceiptId = uuidv7();
  const draftChanges = { lifecycle: "converted", converted_booking_id: bookingId };
  await client.query(
    `insert into edge_laundry.booking_draft_event
       (id, draft_id, event_type, request_key, request_hash, changes,
        version_after, actor_id, terminal_device_id, session_id, correlation_id)
     values ($1::uuid, $2::uuid, 'updated', $3, $4, $5::jsonb, $6, $7::uuid, $8::uuid,
             $9::uuid, $10::uuid)`,
    [
      draftReceiptId,
      draft.id,
      execution.idempotencyKey,
      sha256Hex(canonicalJson(body)),
      JSON.stringify(draftChanges),
      draftVersionAfter,
      device.actorId,
      device.terminalDeviceId,
      device.sessionId,
      execution.correlationId,
    ],
  );
  await execution.recorder.record({
    aggregateType: "booking_draft",
    aggregateId: draft.id,
    aggregateVersion: BigInt(draftVersionAfter),
    eventName: BOOKING_DRAFT_EVENT_NAME,
    payload: {
      booking_draft_event_id: draftReceiptId,
      hub_draft_id: draft.id,
      event_type: "updated",
      tenant_id: device.tenantId,
      digital_store_id: device.digitalStoreId,
      location_id: device.locationId,
      walk_in: draft.walk_in,
      local_customer_id: draft.customer_id,
      customer_snapshot: draft.customer_snapshot,
      lifecycle: "converted",
      converted_booking_id: bookingId,
      version: draftVersionAfter,
      preferred_language: draft.preferred_language,
      intake_source: draft.intake_source,
      cancel_reason_code: null,
      hub_created_at: draftAfter.created_at.toISOString(),
      hub_updated_at: draftAfter.updated_at.toISOString(),
      correlation_id: execution.correlationId,
    },
    causationId: bookingEvent.eventId,
  });

  const finalBooking = await laundryRepo.findBooking(client, bookingId);
  const resultJson = {
    booking: {
      booking_id: bookingId,
      booking_number: bookingNumber,
      status,
      currency_code: quote.currencyCode,
      currency_exponent: quote.currencyExponent,
      subtotal_minor: s(quote.subtotalMinor),
      express: quote.express,
      express_surcharge_minor: s(quote.expressSurchargeMinor),
      total_minor: s(quote.totalMinor),
      paid_minor: s(settlement.appliedMinor),
      balance_minor: s(finalBooking?.balance_minor ?? quote.totalMinor - settlement.appliedMinor),
      line_count: quote.lines.length,
      aggregate_version: s(finalBooking?.aggregate_version ?? version),
    },
    lines: bookingPayload.lines,
    payment:
      paymentId === null
        ? null
        : {
            payment_id: paymentId,
            payment_number: paymentNumber,
            amount_minor: s(settlement.appliedMinor),
            tendered_minor: s(settlement.tenderedMinor),
            change_due_minor: s(settlement.changeDueMinor),
            currency_code: settlement.currencyCode,
            currency_exponent: settlement.currencyExponent,
            legs: receiptPayload.payment?.legs ?? [],
            cash_movement_id: cashMovementId,
          },
    receipt: {
      receipt_id: receiptId,
      receipt_number: receiptNumber,
      content_sha256: receiptSha256,
      payload: receiptPayload,
      print_job_id: printJobId,
      print_state: printState,
    },
    draft: {
      draft_id: draft.id,
      lifecycle: "converted",
      version: draftVersionAfter,
      converted_booking_id: bookingId,
    },
  };
  return {
    aggregateId: bookingId,
    aggregateVersion: finalBooking?.aggregate_version ?? version,
    resultJson,
    auditResourceType: "booking",
    auditResourceId: bookingId,
    auditDetails: {
      hub_draft_id: draft.id,
      booking_number: bookingNumber,
      total_minor: s(quote.totalMinor),
      payment_id: paymentId,
      receipt_id: receiptId,
      payload_sha256: payloadChecksum(bookingPayload),
    },
  };
}
