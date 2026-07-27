/**
 * WAN-unavailable operation (Hub spec §11; WS-09-T004).
 *
 * The Store Hub is the local operational authority for its Location. This suite
 * proves the whole Store day commits with the LAN and the local database only:
 * intake, garment registration, custody scan, Ready completion, pickup
 * completion, cash payment, pending payment, print queue, audit and outbox.
 *
 * The command layer OPENS NO OUTBOUND CONNECTION by construction — there is no
 * WAN client in it, because transmission is WS-10. The suite therefore asserts
 * the observable consequence: everything commits locally, every outbox row is
 * `pending`, no row claims a cloud acknowledgement, and every command reports
 * the wire state `pending_cloud_sync` and nothing stronger.
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

describe.skipIf(!available)("WAN unavailable, LAN and local database healthy", () => {
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

  it("runs a full offline Store day and reports pending_cloud_sync throughout", async () => {
    const ackedBefore = await countRows(
      p,
      `select count(*)::text as count from edge_sync.outbox where delivery_state <> 'pending'`,
    );
    const position = await provisionStoragePosition(p, SUITE, 4);

    // --- T1 intake ---------------------------------------------------------
    const created = await createBookingDraft(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    expect(created.wireSyncState).toBe(WS09_WIRE_SYNC_STATE);
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
        displayName: "Offline wash & fold",
        unitPriceMinor: 2500n,
        unitCode: "piece",
        pieceCount: 1,
      },
    });
    await registerGarment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentCode: `OF-${bookingId.slice(-10)}`,
      garmentType: "shirt",
    });
    const intake = await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    expect(intake.outcome).toBe("accepted");
    expect(intake.syncState).toBe("committed_locally");
    const garmentId = (
      await p.query<{ id: string }>(
        `select id from edge_laundry.garment where booking_id = $1 limit 1`,
        [bookingId],
      )
    ).rows[0]!.id;

    // --- offline pending payment: pending is NOT paid -----------------------
    const pending = await createPendingPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      amountMinor: 2500n,
      locationCode: TEST_LOCATION_CODE,
      providerReference: `OFFLINE-KHQR-${bookingId.slice(-8)}`,
    });
    expect(pending.result["is_paid"]).toBe(false);
    expect((await bookingRow(p, bookingId)).paid_minor).toBe(0n);

    // --- offline cash payment settles the Booking ---------------------------
    const owed = (await bookingRow(p, bookingId)).balance_minor;
    await recordCashPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      tenderedMinor: owed,
      locationCode: TEST_LOCATION_CODE,
    });
    expect((await bookingRow(p, bookingId)).balance_minor).toBe(0n);

    // --- print queue commits locally, never waiting on the WAN --------------
    const jobId = await queueReceiptPrint(p, {
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
    const job = await p.query<{ state: string }>(
      `select state from edge_documents.print_job where id = $1`,
      [jobId],
    );
    expect(job.rows[0]?.state).toBe("queued");

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
    const ready = await completeReady(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: readySession,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    expect(ready.wireSyncState).toBe(WS09_WIRE_SYNC_STATE);

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
    await recordPickupScan(p, {
      device: deviceContext(t4),
      ...(await nextCommandKey(p, t4.terminalDeviceId)),
      businessDate: today,
      pickupSessionId: pickupSession,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentId,
    });
    const completed = await completePickupSession(p, {
      device: deviceContext(t4),
      ...(await nextCommandKey(p, t4.terminalDeviceId)),
      businessDate: today,
      pickupSessionId: pickupSession,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    expect(completed.outcome).toBe("accepted");
    expect((await bookingRow(p, bookingId)).status).toBe("picked_up");

    // --- audit and outbox --------------------------------------------------
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_audit.audit_event where resource_id = $1`,
        [bookingId],
      ),
    ).toBeGreaterThanOrEqual(5);

    const outbox = await p.query<{ delivery_state: string; cloud_ack_id: string | null }>(
      `select o.delivery_state, o.cloud_ack_id from edge_sync.outbox o
         join edge_sync.local_event e on e.id = o.event_id
        where e.aggregate_id = $1`,
      [bookingId],
    );
    expect(outbox.rows.length).toBeGreaterThan(0);
    for (const row of outbox.rows) {
      // WS-09 records durable LOCAL state ONLY. No fabricated acknowledgement.
      expect(row.delivery_state).toBe(WS09_DELIVERY_STATE);
      expect(row.cloud_ack_id).toBeNull();
    }
    const ackedAfter = await countRows(
      p,
      `select count(*)::text as count from edge_sync.outbox where delivery_state <> 'pending'`,
    );
    expect(ackedAfter).toBe(ackedBefore);
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
