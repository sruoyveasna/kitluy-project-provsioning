/**
 * WAN-unavailable operation (Hub spec §11; WS-09-T004/T006).
 *
 * The Store Hub is the local operational authority for its Location. This suite
 * proves the whole Store day commits with the LAN and the local database only:
 * Booking draft, intake confirmation, garment registration, custody scan, Ready
 * completion, pickup completion, cash payment, pending electronic payment,
 * print-job queue, audit and event outbox.
 *
 * The command layer OPENS NO OUTBOUND CONNECTION by construction — there is no
 * WAN client in it, because transmission is WS-10. The suite therefore asserts
 * the observable consequence: everything commits locally, every outbox row is
 * `pending`, no row claims a cloud acknowledgement, and every command reports
 * the wire state `pending_cloud_sync` and nothing stronger.
 *
 * STATUS CEILING: this is PERSISTENCE-LEVEL evidence. No T1-T4 client
 * integration is claimed — there are no application clients in this cycle.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  addBookingLine,
  confirmIntake,
  createBookingDraft,
  registerGarment,
} from "../src/hub/commands/booking-commands.js";
import {
  assignReadyStorage,
  completeReady,
  openReadySession,
  recordReadyQa,
  recordReadyScan,
} from "../src/hub/commands/ready-commands.js";
import {
  completePickupSession,
  openPickupSession,
  recordPickupScan,
  verifyCollector,
} from "../src/hub/commands/pickup-commands.js";
import { createPendingPayment, recordCashPayment } from "../src/hub/commands/payment-commands.js";
import { queueReceiptPrint } from "../src/hub/commands/print-commands.js";
import type { HubCommandResult } from "../src/hub/command-pipeline.js";
import { WS09_DELIVERY_STATE, WS09_WIRE_SYNC_STATE } from "../src/hub/repositories/sync.js";
import {
  ACTOR_CASHIER,
  ACTOR_PICKUP,
  ACTOR_READY,
  LOCATION,
  STORE,
  T1,
  T3,
  T4,
  TENANT,
  TEST_LOCATION_CODE,
  arrangeProductionStage,
  bookingRow,
  bookingVersion,
  businessDate,
  countRows,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  nextCommandKey,
  pool,
  provisionOpenShift,
  provisionStoragePosition,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "offline";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent offline-operation suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

/** Every capability the offline Store day must commit with the WAN down. */
interface OfflineDay {
  readonly bookingId: string;
  readonly garmentId: string;
  readonly printJobId: string;
  readonly ackedOutboxBefore: number;
  readonly steps: Readonly<Record<string, HubCommandResult>>;
}

describe.skipIf(!available)("WAN unavailable, LAN and local database healthy", () => {
  let p: pg.Pool;
  let t1: ProvisionedTerminal;
  let t3: ProvisionedTerminal;
  let t4: ProvisionedTerminal;
  let today: string;
  let day: OfflineDay;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
    t1 = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
    t3 = await provisionTerminal(p, SUITE, T3, ACTOR_READY);
    t4 = await provisionTerminal(p, SUITE, T4, ACTOR_PICKUP);
    await provisionOpenShift(p, t1.terminalDeviceId, ACTOR_CASHIER);
    day = await runOfflineStoreDay();
  }, 60_000);

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  /** Drive one complete Store day through the Hub with no WAN available. */
  async function runOfflineStoreDay(): Promise<OfflineDay> {
    // Scoped to assignment_generation 1 — the stream the WS-09 command layer
    // writes. WS-10's suites reserve their own generations and legitimately move
    // rows off 'pending', so an unscoped count here would be asserting that
    // WS-10 has not run rather than that the offline day acknowledged nothing.
    const ackedOutboxBefore = await countRows(
      p,
      `select count(*)::text as count from edge_sync.outbox
         where delivery_state <> 'pending' and assignment_generation = 1`,
    );
    const position = await provisionStoragePosition(p, SUITE, 4);
    const steps: Record<string, HubCommandResult> = {};

    // --- T1 intake ---------------------------------------------------------
    const created = await createBookingDraft(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    steps["booking_draft"] = created;
    const bookingId = created.aggregateId as string;

    steps["booking_line"] = await addBookingLine(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      line: {
        serviceId: "e0000000-0000-4000-8000-000000000f01",
        serviceVersion: 3n,
        displayName: "Offline wash & fold",
        unitPriceMinor: 2500n,
        unitCode: "piece",
        pieceCount: 1,
      },
    });
    steps["garment_registration"] = await registerGarment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentCode: `OF-${bookingId.slice(-10)}`,
      garmentType: "shirt",
    });
    steps["intake_confirmation"] = await confirmIntake(p, {
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

    // --- offline pending payment: pending is NOT paid -----------------------
    steps["pending_electronic_payment"] = await createPendingPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      amountMinor: 2500n,
      locationCode: TEST_LOCATION_CODE,
      providerReference: `OFFLINE-KHQR-${bookingId.slice(-8)}`,
    });

    // --- offline cash payment settles the Booking ---------------------------
    const owed = (await bookingRow(p, bookingId)).balance_minor;
    steps["cash_payment"] = await recordCashPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      tenderedMinor: owed,
      locationCode: TEST_LOCATION_CODE,
    });

    // --- print queue commits locally, never waiting on the WAN --------------
    const printJobId = await queueReceiptPrint(p, {
      tenantId: TENANT,
      digitalStoreId: STORE,
      locationId: LOCATION,
      documentType: "payment_receipt",
      documentId: bookingId,
      templateVersion: 3n,
      payloadSha256: "1".repeat(64),
      createdBy: ACTOR_CASHIER,
      terminalDeviceId: t1.terminalDeviceId,
    });

    // --- T3 Ready ----------------------------------------------------------
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
    steps["custody_scan_ready"] = await recordReadyScan(p, {
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
    steps["storage_assignment"] = await assignReadyStorage(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: readySession,
      expectedVersion: await bookingVersion(p, bookingId),
      storagePositionId: position,
      garmentId,
    });
    steps["ready_completion"] = await completeReady(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: readySession,
      expectedVersion: await bookingVersion(p, bookingId),
    });

    // --- T4 pickup ---------------------------------------------------------
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
    steps["custody_scan_pickup"] = await recordPickupScan(p, {
      device: deviceContext(t4),
      ...(await nextCommandKey(p, t4.terminalDeviceId)),
      businessDate: today,
      pickupSessionId: pickupSession,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentId,
    });
    steps["pickup_completion"] = await completePickupSession(p, {
      device: deviceContext(t4),
      ...(await nextCommandKey(p, t4.terminalDeviceId)),
      businessDate: today,
      pickupSessionId: pickupSession,
      expectedVersion: await bookingVersion(p, bookingId),
    });

    return { bookingId, garmentId, printJobId, ackedOutboxBefore, steps };
  }

  it("commits EVERY offline capability locally and reports pending_cloud_sync", () => {
    const required = [
      "booking_draft",
      "booking_line",
      "garment_registration",
      "intake_confirmation",
      "pending_electronic_payment",
      "cash_payment",
      "custody_scan_ready",
      "storage_assignment",
      "ready_completion",
      "custody_scan_pickup",
      "pickup_completion",
    ];
    for (const capability of required) {
      const step = day.steps[capability];
      expect(step, capability).toBeDefined();
      expect(step!.outcome, capability).toBe("accepted");
      // WS-09 records LOCAL truth only (amendment §2).
      expect(step!.syncState, capability).toBe("committed_locally");
      expect(step!.wireSyncState, capability).toBe(WS09_WIRE_SYNC_STATE);
      expect(step!.eventIds.length, capability).toBeGreaterThan(0);
    }
  });

  it("persists the T1 intake chain with the WAN down", async () => {
    const booking = await bookingRow(p, day.bookingId);
    expect(booking.status).toBe("picked_up");
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.booking_line where booking_id = $1`,
        [day.bookingId],
      ),
    ).toBe(1);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.garment where booking_id = $1`,
        [day.bookingId],
      ),
    ).toBe(1);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.status_event where booking_id = $1`,
        [day.bookingId],
      ),
    ).toBeGreaterThan(0);
  });

  it("persists the offline custody chain from intake to handover", async () => {
    const custody = await p.query<{ event_type: string; to_custody_state: string }>(
      `select event_type, to_custody_state from edge_laundry.custody_event
        where booking_id = $1 order by local_sequence`,
      [day.bookingId],
    );
    // Intake, Ready scan, storage assignment and handover all recorded locally.
    expect(custody.rows.length).toBeGreaterThanOrEqual(3);
    expect(custody.rows.at(-1)?.to_custody_state).toBeTruthy();
    // Storage was assigned offline and cleared on handover.
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.storage_assignment where booking_id = $1`,
        [day.bookingId],
      ),
    ).toBe(1);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.storage_assignment
          where booking_id = $1 and cleared_at is null`,
        [day.bookingId],
      ),
    ).toBe(0);
  });

  it("settles cash locally and NEVER marks the pending electronic payment paid", async () => {
    expect(day.steps["pending_electronic_payment"]!.result["is_paid"]).toBe(false);
    const booking = await bookingRow(p, day.bookingId);
    expect(booking.balance_minor).toBe(0n);
    const payments = await p.query<{
      state: string;
      payment_type: string;
      confirmed_at: Date | null;
    }>(
      `select state, payment_type, confirmed_at from edge_payments.payment
        where booking_id = $1 order by requested_at`,
      [day.bookingId],
    );
    expect(payments.rows.length).toBeGreaterThanOrEqual(2);
    // The electronic intent stays non-authoritative while the WAN is down:
    // PAYMENT_PENDING is an accepted NON-TERMINAL outcome, never "paid".
    const pending = payments.rows.filter((row) => row.state === "pending");
    expect(pending.length).toBeGreaterThan(0);
    for (const row of pending) expect(row.confirmed_at).toBeNull();
    const confirmed = payments.rows.filter((row) => row.state === "confirmed");
    expect(confirmed.length).toBeGreaterThan(0);
    for (const row of confirmed) expect(row.confirmed_at).not.toBeNull();
  });

  it("queues the print job locally without waiting on the WAN", async () => {
    const job = await p.query<{ state: string; location_id: string }>(
      `select state, location_id from edge_documents.print_job where id = $1`,
      [day.printJobId],
    );
    expect(job.rows[0]?.state).toBe("queued");
    expect(job.rows[0]?.location_id).toBe(LOCATION);
  });

  it("writes an offline audit trail for the Booking", async () => {
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_audit.audit_event where resource_id = $1`,
        [day.bookingId],
      ),
    ).toBeGreaterThanOrEqual(5);
  });

  it("leaves EVERY event-outbox row exactly 'pending' with no cloud acknowledgement", async () => {
    const outbox = await p.query<{ delivery_state: string; cloud_ack_id: string | null }>(
      `select o.delivery_state, o.cloud_ack_id from edge_sync.outbox o
         join edge_sync.local_event e on e.id = o.event_id
        where e.aggregate_id = $1`,
      [day.bookingId],
    );
    expect(outbox.rows.length).toBeGreaterThan(0);
    for (const row of outbox.rows) {
      // WS-09 records durable LOCAL state ONLY. No fabricated acknowledgement.
      expect(row.delivery_state).toBe(WS09_DELIVERY_STATE);
      expect(row.cloud_ack_id).toBeNull();
    }
    // …and the offline day acknowledged nothing anywhere in the database.
    const ackedAfter = await countRows(
      p,
      `select count(*)::text as count from edge_sync.outbox
         where delivery_state <> 'pending' and assignment_generation = 1`,
    );
    expect(ackedAfter).toBe(day.ackedOutboxBefore);
  });

  it("gives every offline event an outbox row (the §9 invariant is structural)", async () => {
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.local_event e
           left join edge_sync.outbox o on o.event_id = e.id
          where e.aggregate_id = $1 and o.event_id is null`,
        [day.bookingId],
      ),
    ).toBe(0);
  });

  it("never advances a sync cursor's acknowledged position (that is WS-10)", async () => {
    const before = await p.query<{ last_acked_hub_sequence: bigint }>(
      `select last_acked_hub_sequence from edge_sync.sync_cursor
        where location_id = $1 and stream_code = 'domain_events'`,
      [LOCATION],
    );
    const created = await createBookingDraft(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    expect(created.outcome).toBe("accepted");
    const after = await p.query<{ last_acked_hub_sequence: bigint }>(
      `select last_acked_hub_sequence from edge_sync.sync_cursor
        where location_id = $1 and stream_code = 'domain_events'`,
      [LOCATION],
    );
    expect(after.rows[0]?.last_acked_hub_sequence).toBe(before.rows[0]?.last_acked_hub_sequence);
  });
});
