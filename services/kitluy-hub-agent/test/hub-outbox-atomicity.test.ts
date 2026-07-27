/**
 * Outbox atomicity and "a refusal writes nothing" (WS-09-T004; §9, §12 test 3).
 *
 * A rolled-back command must leave NO event, NO outbox row and NO command
 * result — and the `hub_sequence` values it burnt must be journalled as KNOWN
 * gaps so a sync batch never mistakes them for missing events (offline §5).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { HubCommandError } from "../src/hub/errors.js";
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
  ACTOR_CASHIER,
  ACTOR_READY,
  T1,
  T3,
  TEST_LOCATION_CODE,
  arrangeProductionStage,
  bookingVersion,
  businessDate,
  countRows,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  nextCommandKey,
  pool,
  provisionStoragePosition,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "atomic";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent outbox-atomicity suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

describe.skipIf(!available)("Outbox atomicity — a rolled-back command leaves nothing", () => {
  let p: pg.Pool;
  let t1: ProvisionedTerminal;
  let t3: ProvisionedTerminal;
  let today: string;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
    t1 = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
    t3 = await provisionTerminal(p, SUITE, T3, ACTOR_READY);
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  async function confirmedBookingWithGarment(): Promise<{ bookingId: string; garmentId: string }> {
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
        displayName: "Atomicity probe line",
        unitPriceMinor: 1000n,
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
      garmentCode: `AT-${bookingId.slice(-10)}`,
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
    return { bookingId, garmentId: garment.rows[0]!.id };
  }

  it("leaves NO event, NO outbox row and NO command result when the command fails after recording", async () => {
    // A capacity-1 storage position that is already occupied: the event is
    // recorded first, then the 0012 capacity trigger refuses the assignment.
    const position = await provisionStoragePosition(p, SUITE, 1);
    const first = await confirmedBookingWithGarment();
    const second = await confirmedBookingWithGarment();
    await arrangeProductionStage(p, first.bookingId, "QA_PACKAGING");
    await arrangeProductionStage(p, second.bookingId, "QA_PACKAGING");

    const sessionA = (
      await openReadySession(p, {
        device: deviceContext(t3),
        ...(await nextCommandKey(p, t3.terminalDeviceId)),
        businessDate: today,
        bookingId: first.bookingId,
        expectedCount: 1,
      })
    ).result["ready_session_id"] as string;
    await assignReadyStorage(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: sessionA,
      expectedVersion: await bookingVersion(p, first.bookingId),
      storagePositionId: position,
      garmentId: first.garmentId,
    });

    const sessionB = (
      await openReadySession(p, {
        device: deviceContext(t3),
        ...(await nextCommandKey(p, t3.terminalDeviceId)),
        businessDate: today,
        bookingId: second.bookingId,
        expectedCount: 1,
      })
    ).result["ready_session_id"] as string;

    const gapsBefore = await countRows(
      p,
      `select count(*)::text as count from edge_sync.sequence_gap where gap_reason = 'transaction_rollback'`,
    );
    const key = await nextCommandKey(p, t3.terminalDeviceId);
    await expect(
      assignReadyStorage(p, {
        device: deviceContext(t3),
        ...key,
        businessDate: today,
        readySessionId: sessionB,
        expectedVersion: await bookingVersion(p, second.bookingId),
        storagePositionId: position,
        garmentId: second.garmentId,
      }),
    ).rejects.toThrow(/KLUY-EDGE-STORAGE-CAPACITY/);

    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.local_event where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.storage_assignment
          where booking_id = $1 and cleared_at is null`,
        [second.bookingId],
      ),
    ).toBe(0);
    // Offline §5: the burnt hub_sequence is journalled as a KNOWN gap.
    const gapsAfter = await countRows(
      p,
      `select count(*)::text as count from edge_sync.sequence_gap where gap_reason = 'transaction_rollback'`,
    );
    expect(gapsAfter).toBeGreaterThan(gapsBefore);
  });

  it("writes nothing when the CANONICAL ENGINE refuses the transition", async () => {
    const { bookingId, garmentId } = await confirmedBookingWithGarment();
    const position = await provisionStoragePosition(p, SUITE, 2);
    const session = (
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
      readySessionId: session,
      expectedVersion: await bookingVersion(p, bookingId),
      garmentId,
    });
    await recordReadyQa(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: session,
      expectedVersion: await bookingVersion(p, bookingId),
      qaPassed: true,
    });
    await assignReadyStorage(p, {
      device: deviceContext(t3),
      ...(await nextCommandKey(p, t3.terminalDeviceId)),
      businessDate: today,
      readySessionId: session,
      expectedVersion: await bookingVersion(p, bookingId),
      storagePositionId: position,
      garmentId,
    });

    // The Booking is still at RECEIVED (`intake_confirmed`): the forward-only
    // production chain forbids RECEIVED -> READY, so markReady refuses.
    const key = await nextCommandKey(p, t3.terminalDeviceId);
    await expect(
      completeReady(p, {
        device: deviceContext(t3),
        ...key,
        businessDate: today,
        readySessionId: session,
        expectedVersion: await bookingVersion(p, bookingId),
      }),
    ).rejects.toThrow(/Illegal production transition/);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
    const status = await p.query<{ status: string }>(
      `select status from edge_laundry.booking where id = $1`,
      [bookingId],
    );
    expect(status.rows[0]?.status).toBe("intake_confirmed");
  });

  it("writes nothing when the expected aggregate version is stale", async () => {
    const { bookingId } = await confirmedBookingWithGarment();
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    let thrown: unknown;
    try {
      await registerGarment(p, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        bookingId,
        expectedVersion: 1n, // stale on purpose
        garmentCode: `STALE-${bookingId.slice(-10)}`,
        garmentType: "shirt",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HubCommandError);
    expect((thrown as HubCommandError).code).toBe("EDGE_AGGREGATE_VERSION_CONFLICT");
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_laundry.garment where garment_code = $1`,
        [`STALE-${bookingId.slice(-10)}`],
      ),
    ).toBe(0);
  });

  it("gives every committed event an outbox row (the §9 invariant is structural)", async () => {
    const { bookingId } = await confirmedBookingWithGarment();
    const orphans = await countRows(
      p,
      `select count(*)::text as count from edge_sync.local_event e
        left join edge_sync.outbox o on o.event_id = e.id
       where e.aggregate_id = $1 and o.event_id is null`,
      [bookingId],
    );
    expect(orphans).toBe(0);
    const states = await p.query<{ delivery_state: string }>(
      `select distinct o.delivery_state from edge_sync.outbox o
         join edge_sync.local_event e on e.id = o.event_id
        where e.aggregate_id = $1`,
      [bookingId],
    );
    // Amendment §2: WS-09 writes ONLY 'pending'.
    expect(states.rows.map((r) => r.delivery_state)).toEqual(["pending"]);
  });
});
