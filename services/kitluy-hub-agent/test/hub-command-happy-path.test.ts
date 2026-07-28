/**
 * Booking / custody / payment command happy paths, and the proof that the
 * PERSISTED result is the CANONICAL ENGINE's decision (WS-09-T002/T003).
 *
 * DB-backed. Skips VISIBLY when the local Hub database is unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  completePickup,
  markReady,
  pricePerPieceLine,
  transitionBooking,
} from "@kitluy-verticals/phase1-laundry";
import { money } from "@kitluy/money";
import {
  addBookingLine,
  assignContainer,
  assignTag,
  confirmIntake,
  createBookingDraft,
  registerGarment,
} from "../src/hub/commands/booking-commands.js";
import {
  assignReadyStorage,
  completeReady,
  openReadySession,
  recordReadyException,
  recordReadyQa,
  recordReadyScan,
} from "../src/hub/commands/ready-commands.js";
import {
  completePickupSession,
  openPickupSession,
  recordPickupPayment,
  recordPickupScan,
  verifyCollector,
} from "../src/hub/commands/pickup-commands.js";
import {
  applyProviderCallback,
  createPendingPayment,
  recordCashPayment,
  requestRefund,
  requestVoid,
} from "../src/hub/commands/payment-commands.js";
import { queueReceiptPrint } from "../src/hub/commands/print-commands.js";
import {
  ACTOR_CASHIER,
  ACTOR_MANAGER,
  ACTOR_PICKUP,
  ACTOR_READY,
  T1,
  T3,
  T4,
  TEST_LOCATION_CODE,
  approvalEvidence,
  arrangeProductionStage,
  bookingRow,
  bookingVersion,
  businessDate,
  countRows,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  locationGrants,
  nextCommandKey,
  pool,
  provisionOpenShift,
  provisionStoragePosition,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";
import { uuidv7 } from "../src/hub/uuid.js";

const SUITE = "happy";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent command happy-path suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

describe.skipIf(!available)("Hub command layer — happy paths", () => {
  let p: pg.Pool;
  let t1: ProvisionedTerminal;
  let t3: ProvisionedTerminal;
  let t4: ProvisionedTerminal;
  let today: string;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
    t1 = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
    t3 = await provisionTerminal(p, SUITE, T3, ACTOR_READY);
    t4 = await provisionTerminal(p, SUITE, T4, ACTOR_PICKUP);
    await provisionOpenShift(p, t1.terminalDeviceId, ACTOR_CASHIER);
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  async function draftWithOneLine(pieceCount = 2, unitPriceMinor = 1500n): Promise<string> {
    const created = await createBookingDraft(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    const bookingId = created.aggregateId as string;
    await addBookingLine(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      line: {
        serviceId: "e0000000-0000-4000-8000-000000000f01",
        serviceVersion: 3n,
        displayName: "Test Wash & Fold (per piece)",
        unitPriceMinor,
        unitCode: "piece",
        pieceCount,
      },
    });
    return bookingId;
  }

  it("creates a draft Booking with an engine-priced line and a local display number", async () => {
    const bookingId = await draftWithOneLine(3, 1000n);
    const row = await bookingRow(p, bookingId);
    expect(row.status).toBe("draft");
    // ENGINE DECISION == PERSISTED RESULT.
    const engineTotal = pricePerPieceLine({
      kind: "per_piece",
      serviceCode: "svc",
      unitPriceSnapshot: money("USD", 1000n),
      pieceCount: 3,
    });
    expect(row.total_minor).toBe(engineTotal.minorUnits);
    expect(row.balance_minor).toBe(engineTotal.minorUnits);

    const numbers = await p.query<{ booking_number: string }>(
      `select booking_number from edge_laundry.booking where id = $1`,
      [bookingId],
    );
    expect(numbers.rows[0]?.booking_number).toMatch(
      new RegExp(`^KLB-${TEST_LOCATION_CODE}-\\d{6}-\\d{6}$`),
    );
  });

  it("refuses a per-weight line without an explicit rounding rule (never defaulted)", async () => {
    const bookingId = await draftWithOneLine();
    await expect(
      addBookingLine(p, {
        device: deviceContext(t1),
        ...(await nextCommandKey(p, t1.terminalDeviceId)),
        businessDate: today,
        bookingId,
        expectedVersion: await bookingVersion(p, bookingId),
        line: {
          serviceId: "e0000000-0000-4000-8000-000000000f02",
          serviceVersion: 2n,
          displayName: "Test Wash (per kg)",
          unitPriceMinor: 1000n,
          unitCode: "kg",
          weightGrams: 1500,
        },
      }),
    ).rejects.toThrow(/EDGE_REQUIRED_VALUE_MISSING/);
  });

  it("confirms intake atomically: transition + price snapshot + garments + custody + deposit + audit + outbox", async () => {
    const bookingId = await draftWithOneLine(2, 1500n);
    await registerGarment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentCode: `G-${bookingId.slice(-12)}-1`,
      garmentType: "shirt",
    });
    await registerGarment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentCode: `G-${bookingId.slice(-12)}-2`,
      garmentType: "trousers",
    });
    await assignTag(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      tagCode: `KLT-${bookingId.slice(-12)}`,
      tagType: "booking",
    });
    await assignContainer(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      bagCode: `B-${bookingId.slice(-12)}`,
      expectedPieceCount: 2,
    });

    const before = await bookingRow(p, bookingId);
    // The engine decides the edge; the test asserts the SAME decision.
    expect(transitionBooking("DRAFT", "CONFIRMED/FINALIZED")).toBe("CONFIRMED/FINALIZED");

    const result = await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: before.aggregate_version,
      depositMinor: 1000n,
      locationCode: TEST_LOCATION_CODE,
    });
    expect(result.outcome).toBe("accepted");
    expect(result.syncState).toBe("committed_locally");
    expect(result.wireSyncState).toBe("pending_cloud_sync");

    const after = await bookingRow(p, bookingId);
    expect(after.status).toBe("intake_confirmed");
    expect(after.paid_minor).toBe(1000n);
    expect(after.balance_minor).toBe(after.total_minor - 1000n);

    // Append-only history, custody chain and the transactional outbox all
    // committed in the SAME transaction.
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.status_event where booking_id = $1`,
        [bookingId],
      ),
    ).toBe(1);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.custody_event where booking_id = $1`,
        [bookingId],
      ),
    ).toBe(2);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_payments.payment where booking_id = $1`,
        [bookingId],
      ),
    ).toBe(1);

    const events = await p.query<{ id: string; event_type: string }>(
      `select id, event_type from edge_sync.local_event where aggregate_id = $1 order by hub_sequence`,
      [bookingId],
    );
    // Confirm-intake emits the lifecycle fact plus ONE custody event per unit,
    // after the draft-shaping events of the earlier commands.
    expect(events.rows.slice(-3).map((r) => r.event_type)).toEqual([
      "laundry_booking.created",
      "garment.custody_recorded",
      "garment.custody_recorded",
    ]);
    // §9: EVERY event has its outbox row, and WS-09 writes only 'pending'.
    for (const row of events.rows) {
      const outbox = await p.query<{ delivery_state: string; cloud_ack_id: string | null }>(
        `select delivery_state, cloud_ack_id from edge_sync.outbox where event_id = $1`,
        [row.id],
      );
      expect(outbox.rows[0]?.delivery_state).toBe("pending");
      expect(outbox.rows[0]?.cloud_ack_id).toBeNull();
    }
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_audit.audit_event where resource_id = $1`,
        [bookingId],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  it("runs the T3 Ready session and commits READY through the canonical markReady", async () => {
    const position = await provisionStoragePosition(p, SUITE, 4);
    const bookingId = await draftWithOneLine(1, 2000n);
    await registerGarment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentCode: `RG-${bookingId.slice(-12)}`,
      garmentType: "shirt",
    });
    await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    const garment = await p.query<{ id: string }>(
      `select id from edge_laundry.garment where booking_id = $1 limit 1`,
      [bookingId],
    );
    const garmentId = garment.rows[0]!.id;

    // Ready completion is refused before the forward chain reaches QA_PACKAGING.
    await arrangeProductionStage(p, bookingId, "QA_PACKAGING");

    const opened = await openReadySession(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedCount: 1,
    });
    const readySessionId = opened.result["ready_session_id"] as string;

    await recordReadyScan(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentId,
    });
    await recordReadyQa(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId,
      expectedVersion: await bookingVersion(p, bookingId),
      qaPassed: true,
    });
    await recordReadyException(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId,
      expectedVersion: await bookingVersion(p, bookingId),
      exceptionType: "stain",
      severity: "low",
      blocking: false,
      note: "non-blocking cosmetic note",
    });
    await assignReadyStorage(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId,
      expectedVersion: await bookingVersion(p, bookingId),
      storagePositionId: position,
      garmentId,
    });

    // ENGINE DECISION == PERSISTED RESULT.
    expect(
      markReady("QA_PACKAGING", {
        profile: T3,
        qaPassed: true,
        countVerified: true,
        storageAssigned: true,
      }),
    ).toBe("READY");
    const completed = await completeReady(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    expect(completed.result["engine_state"]).toBe("READY");
    expect((await bookingRow(p, bookingId)).status).toBe("ready");

    const custody = await p.query<{ event_type: string; to_custody_state: string }>(
      `select event_type, to_custody_state from edge_laundry.custody_event
        where booking_id = $1 order by local_sequence`,
      [bookingId],
    );
    expect(custody.rows.map((r) => r.event_type)).toEqual(["intake_received", "ready_scan_in"]);
    expect(custody.rows.at(-1)?.to_custody_state).toBe("in_ready_storage");
  });

  it("completes T4 pickup atomically: count + collector + balance gate, release, clear storage", async () => {
    const position = await provisionStoragePosition(p, SUITE, 4);
    const bookingId = await draftWithOneLine(1, 2500n);
    await registerGarment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentCode: `PG-${bookingId.slice(-12)}`,
      garmentType: "shirt",
    });
    await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    const garmentId = (
      await p.query<{ id: string }>(
        `select id from edge_laundry.garment where booking_id = $1 limit 1`,
        [bookingId],
      )
    ).rows[0]!.id;
    await arrangeProductionStage(p, bookingId, "QA_PACKAGING");

    const readySession = (
      await openReadySession(p, {
        device: deviceContext(t3),
        ...(await nextCommandKey(p, t3.terminalDeviceId)),
        businessDate: today,
        bookingId,
        expectedCount: 1,
      })
    ).result["ready_session_id"] as string;
    await recordReadyScan(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: readySession,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentId,
    });
    await recordReadyQa(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: readySession,
      expectedVersion: await bookingVersion(p, bookingId),
      qaPassed: true,
    });
    await assignReadyStorage(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: readySession,
      expectedVersion: await bookingVersion(p, bookingId),
      storagePositionId: position,
      garmentId,
    });
    await completeReady(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: readySession,
      expectedVersion: await bookingVersion(p, bookingId),
    });

    const pickupSession = (
      await openPickupSession(p, {
        device: deviceContext(t4),
        ...(await nextCommandKey(p, t4.terminalDeviceId)),
        businessDate: today,
        bookingId,
      })
    ).result["pickup_session_id"] as string;
    await verifyCollector(p, {
      device: deviceContext(t4),
      ...(await nextCommandKey(p, t4.terminalDeviceId)),
      businessDate: today,
      pickupSessionId: pickupSession,
      expectedVersion: await bookingVersion(p, bookingId),
      verificationMethod: "collector_code",
    });
    await recordPickupScan(p, {
      device: deviceContext(t4),
      ...(await nextCommandKey(p, t4.terminalDeviceId)),
      businessDate: today,
      pickupSessionId: pickupSession,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentId,
    });

    // The payment gate blocks release while a balance is outstanding.
    await expect(
      completePickupSession(p, {
        device: deviceContext(t4),
        ...(await nextCommandKey(p, t4.terminalDeviceId)),
        businessDate: today,
        pickupSessionId: pickupSession,
        expectedVersion: await bookingVersion(p, bookingId),
      }),
    ).rejects.toThrow(/EDGE_PAYMENT_GATE_BLOCKED/);

    const owed = (await bookingRow(p, bookingId)).balance_minor;
    await recordPickupPayment(p, {
      device: deviceContext(t4),
      ...(await nextCommandKey(p, t4.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      tenderedMinor: owed,
      locationCode: TEST_LOCATION_CODE,
      pickupSessionId: pickupSession,
    });
    expect((await bookingRow(p, bookingId)).balance_minor).toBe(0n);

    expect(
      completePickup("READY", {
        profile: T4,
        collectorVerified: true,
        balanceSettled: true,
        releaseCompletenessVerified: true,
      }),
    ).toBe("PICKED_UP");
    const done = await completePickupSession(p, {
      device: deviceContext(t4),
      ...(await nextCommandKey(p, t4.terminalDeviceId)),
      businessDate: today,
      pickupSessionId: pickupSession,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    expect(done.result["engine_state"]).toBe("PICKED_UP");
    expect((await bookingRow(p, bookingId)).status).toBe("picked_up");

    const custody = await p.query<{ to_custody_state: string }>(
      `select to_custody_state from edge_laundry.custody_event where booking_id = $1
        order by local_sequence desc limit 1`,
      [bookingId],
    );
    expect(custody.rows[0]?.to_custody_state).toBe("released_to_customer");
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.storage_assignment
          where booking_id = $1 and cleared_at is null`,
        [bookingId],
      ),
    ).toBe(0);
  });

  it("records a cash payment as CONFIRMED with a signed cash movement and a finance event", async () => {
    const bookingId = await draftWithOneLine(1, 4000n);
    await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    const result = await recordCashPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      tenderedMinor: 5000n,
      locationCode: TEST_LOCATION_CODE,
    });
    // Cash never overpays: applied = min(tendered, balance), change is returned.
    expect(result.result["amount_minor"]).toBe("4000");
    expect(result.result["change_due_minor"]).toBe("1000");
    expect(result.result["allocation"]).toBe("settlement");
    expect(result.result["cloud_posting_status"]).toBe("unknown");
    expect(result.result["posting_dedup_key"]).toMatch(/^[0-9a-f]{64}$/);
    expect((await bookingRow(p, bookingId)).balance_minor).toBe(0n);

    const movements = await p.query<{ movement_type: string; amount_minor: bigint }>(
      `select cm.movement_type, cm.amount_minor from edge_core.cash_movement cm
        where cm.related_payment_id = $1`,
      [result.result["payment_id"]],
    );
    expect(movements.rows[0]?.movement_type).toBe("payment_received");
    expect(movements.rows[0]?.amount_minor).toBe(4000n);

    // FINANCE EVENTS ONLY — no Hub journal exists.
    const financeEvents = await p.query<{ event_type: string }>(
      `select event_type from edge_sync.local_event
        where aggregate_id = $1 order by hub_sequence`,
      [result.result["payment_id"]],
    );
    expect(financeEvents.rows.map((r) => r.event_type)).toEqual([
      "payment.recorded",
      "cash.movement_recorded",
    ]);
  });

  it("keeps PAYMENT_PENDING non-terminal: pending is NOT paid and no KHQR confirmation is fabricated", async () => {
    const bookingId = await draftWithOneLine(1, 3000n);
    await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    const before = await bookingRow(p, bookingId);
    const pending = await createPendingPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: before.aggregate_version,
      amountMinor: 3000n,
      locationCode: TEST_LOCATION_CODE,
      providerReference: `DEMO-KHQR-${bookingId.slice(0, 8)}`,
    });
    expect(pending.result["payment_state"]).toBe("pending");
    expect(pending.result["is_paid"]).toBe(false);
    expect(pending.result["http_status_hint"]).toBe(202);

    const after = await bookingRow(p, bookingId);
    expect(after.paid_minor).toBe(before.paid_minor);
    expect(after.balance_minor).toBe(before.balance_minor);
    const row = await p.query<{ state: string; confirmed_at: Date | null }>(
      `select state, confirmed_at from edge_payments.payment where id = $1`,
      [pending.result["payment_id"]],
    );
    expect(row.rows[0]?.state).toBe("pending");
    expect(row.rows[0]?.confirmed_at).toBeNull();
  });

  it("quarantines an unverified provider callback with zero business effect, then confirms a verified one, then deduplicates", async () => {
    const bookingId = await draftWithOneLine(1, 2200n);
    await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    const pending = await createPendingPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      amountMinor: 2200n,
      locationCode: TEST_LOCATION_CODE,
      providerReference: `DEMO-KHQR-CB-${bookingId.slice(0, 8)}`,
    });
    const paymentId = pending.result["payment_id"] as string;

    // KLREQ-027: a provider outcome reaches the Hub only as a SIGNED CLOUD
    // DELIVERY. `deliveryId` is that delivery's identity and, per KLREQ-026, the
    // kh1.* namespace for the effects it produces — so a REDELIVERY of the same
    // outcome must reuse it, which is what the third call below proves.
    const unverifiedDelivery = uuidv7();
    const verifiedDelivery = uuidv7();

    const quarantined = await applyProviderCallback(p, {
      paymentId,
      providerTransactionId: `TXN-${paymentId.slice(0, 8)}`,
      providerEventId: `EVT-UNVERIFIED-${paymentId.slice(0, 8)}`,
      status: "SUCCEEDED",
      amountMinor: 2200n,
      signatureVerified: false,
      businessDate: today,
      deliveryId: unverifiedDelivery,
    });
    expect(quarantined.engineState).toBe("QUARANTINED");
    expect(quarantined.paymentState).toBe("pending");
    expect((await bookingRow(p, bookingId)).paid_minor).toBe(0n);

    const applied = await applyProviderCallback(p, {
      paymentId,
      providerTransactionId: `TXN-${paymentId.slice(0, 8)}`,
      providerEventId: `EVT-OK-${paymentId.slice(0, 8)}`,
      status: "SUCCEEDED",
      amountMinor: 2200n,
      signatureVerified: true,
      businessDate: today,
      deliveryId: verifiedDelivery,
    });
    expect(applied.engineState).toBe("APPLIED");
    expect(applied.duplicate).toBe(false);
    expect((await bookingRow(p, bookingId)).paid_minor).toBe(2200n);

    const redelivered = await applyProviderCallback(p, {
      paymentId,
      providerTransactionId: `TXN-${paymentId.slice(0, 8)}`,
      providerEventId: `EVT-OK-${paymentId.slice(0, 8)}`,
      status: "SUCCEEDED",
      amountMinor: 2200n,
      signatureVerified: true,
      businessDate: today,
      deliveryId: verifiedDelivery,
    });
    expect(redelivered.duplicate).toBe(true);
    expect(redelivered.eventIds).toHaveLength(0);
    // Exactly ONE business effect for the provider transaction.
    expect((await bookingRow(p, bookingId)).paid_minor).toBe(2200n);
  });

  it("records a four-eyes refund as a compensating adjustment and refuses a destructive void", async () => {
    const bookingId = await draftWithOneLine(1, 3000n);
    await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    const paid = await recordCashPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      tenderedMinor: 3000n,
      locationCode: TEST_LOCATION_CODE,
    });
    const paymentId = paid.result["payment_id"] as string;

    const refund = await requestRefund(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      originalPaymentId: paymentId,
      amountMinor: 500n,
      reasonCode: "service_not_delivered",
      approval: approvalEvidence(ACTOR_CASHIER, ACTOR_MANAGER, `payments.refund:${paymentId}`),
      presentedGrants: locationGrants(["payments.refund.request"]),
    });
    expect(refund.result["adjustment_type"]).toBe("refund");
    const afterRefund = await bookingRow(p, bookingId);
    expect(afterRefund.refunded_minor).toBe(500n);
    expect(afterRefund.balance_minor).toBe(afterRefund.total_minor - 3000n + 500n);

    // KBR-PAY-006 / PAY-VEC-020: a finalized payment is NEVER destructively voided.
    const voided = await requestVoid(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      targetPaymentId: paymentId,
      reasonCode: "operator_error",
      approval: approvalEvidence(ACTOR_CASHIER, ACTOR_MANAGER, `payments.void:${paymentId}`),
      presentedGrants: locationGrants(["payments.void.request"]),
    });
    expect(voided.result["state"]).toBe("refused");
    expect(voided.result["required_action"]).toBe("COMPENSATING_REFUND_OR_ADJUSTMENT");
    const stillConfirmed = await p.query<{ state: string }>(
      `select state from edge_payments.payment where id = $1`,
      [paymentId],
    );
    expect(stillConfirmed.rows[0]?.state).toBe("confirmed");
  });

  it("queues a deduplicated print job without touching the WAN", async () => {
    const bookingId = await draftWithOneLine(1, 1200n);
    const jobId = await queueReceiptPrint(p, {
      tenantId: (await bookingScope(p, bookingId)).tenant_id,
      digitalStoreId: (await bookingScope(p, bookingId)).digital_store_id,
      locationId: (await bookingScope(p, bookingId)).location_id,
      documentType: "booking_ticket",
      documentId: bookingId,
      templateVersion: 3n,
      payloadSha256: "0".repeat(64),
      createdBy: ACTOR_CASHIER,
      terminalDeviceId: t1.terminalDeviceId,
    });
    // A retry reuses the SAME job id and suppression key (offline §11.1/§11.2).
    const retry = await queueReceiptPrint(p, {
      tenantId: (await bookingScope(p, bookingId)).tenant_id,
      digitalStoreId: (await bookingScope(p, bookingId)).digital_store_id,
      locationId: (await bookingScope(p, bookingId)).location_id,
      documentType: "booking_ticket",
      documentId: bookingId,
      templateVersion: 3n,
      payloadSha256: "0".repeat(64),
      createdBy: ACTOR_CASHIER,
      terminalDeviceId: t1.terminalDeviceId,
    });
    expect(retry).toBe(jobId);
  });
});

async function bookingScope(
  p: pg.Pool,
  bookingId: string,
): Promise<{ tenant_id: string; digital_store_id: string; location_id: string }> {
  const result = await p.query<{
    tenant_id: string;
    digital_store_id: string;
    location_id: string;
  }>(`select tenant_id, digital_store_id, location_id from edge_laundry.booking where id = $1`, [
    bookingId,
  ]);
  const row = result.rows[0];
  if (!row) throw new Error(`booking ${bookingId} not found`);
  return row;
}
