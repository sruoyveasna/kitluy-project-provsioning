/**
 * WS-07 DB-backed integration tests (Cycle-6 §21).
 *
 * Requires the LOCAL Supabase dev stack with migrations 0000-0095 and dev
 * fixtures applied. Skips (visibly) when unreachable — a skipped run is NEVER
 * reported as executed evidence.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import {
  BookingLifecycleTransitionError,
  ProductionTransitionError,
  T3ReadyCommitError,
  T4ReleaseError,
} from "@kitluy-verticals/phase1-laundry";
import {
  createDevPool,
  isDevDatabaseReachable,
  withServiceTransaction,
} from "@kitluy/payments-persistence";
import {
  commitReady,
  completePickupRelease,
  createVerifiedBooking,
  recordCustodyScan,
  transitionBookingLifecycle,
  transitionProductionStage,
} from "../src/index.js";

const TENANT_A = "00000000-0000-4000-8000-000000000011";
const STORE_A = "00000000-0000-4000-8000-000000000015";
const LOC_A = "00000000-0000-4000-8000-000000000018";
const CUSTOMER_A = "00000000-0000-4000-8000-000000000324";
const CASHIER = "00000000-0000-4000-8000-000000000004";
const MANAGER = "00000000-0000-4000-8000-000000000003";
const CATALOG_SHIRT = "00000000-0000-4000-8000-000000000301";
const CATALOG_KG = "00000000-0000-4000-8000-000000000304";
const POSITION_FREE = "00000000-0000-4000-8000-000000000419";

const dbAvailable = await isDevDatabaseReachable();
if (!dbAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    "SKIPPED @kitluy-verticals/phase1-laundry-persistence integration: local Supabase dev stack unreachable",
  );
}

function bookingCommand(overrides?: { weight?: boolean }) {
  const key = `itest-bkg-${randomUUID()}`;
  return {
    tenantId: TENANT_A,
    digitalStoreId: STORE_A,
    storeLocationId: LOC_A,
    customerId: CUSTOMER_A,
    orderNumber: key.slice(0, 30),
    currency: "KHR" as const,
    lines: overrides?.weight
      ? [
          {
            catalogItemId: CATALOG_KG,
            serviceCode: "WASH-KG",
            pricingMode: "PER_WEIGHT" as const,
            weightGrams: 2500n,
            weightRoundingRule: "round_half_up_minor_unit" as const,
            unitPriceMinor: 3000n,
            priceVersion: 1n,
          },
        ]
      : [
          {
            catalogItemId: CATALOG_SHIRT,
            serviceCode: "SHIRT-WASH",
            pricingMode: "PER_PIECE" as const,
            quantity: 3n,
            unitPriceMinor: 2000n,
            priceVersion: 1n,
          },
        ],
    verifiedBy: CASHIER,
    idempotencyKey: key,
    actor: { userId: CASHIER },
  };
}

describe.runIf(dbAvailable)("WS-07 laundry persistence (DB-backed)", () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createDevPool();
  });
  afterAll(async () => {
    await pool.end();
  });

  async function markPaid(orderId: string): Promise<void> {
    await withServiceTransaction(pool, async (client) => {
      await client.query(
        `update kitluy_orders.orders
            set payment_state = 'PAID', version = version + 1, updated_at = now()
          where id = $1`,
        [orderId],
      );
    });
  }

  it("verified intake persists engine-priced snapshots (per-piece and per-weight)", async () => {
    const perPiece = await createVerifiedBooking(pool, bookingCommand());
    expect(perPiece.totalMinor).toBe(6000n); // 3 x 2000 (engine pricePerPieceLine)
    const perWeight = await createVerifiedBooking(pool, bookingCommand({ weight: true }));
    expect(perWeight.totalMinor).toBe(7500n); // 3000/kg x 2500g, round_half_up

    const rows = await pool.query(
      `select status, total_minor, version from kitluy_orders.orders where id = $1`,
      [perPiece.orderId],
    );
    expect(rows.rows[0]).toMatchObject({
      status: "CONFIRMED/FINALIZED",
      total_minor: 6000n,
      version: 1n,
    });
    const production = await pool.query(
      `select production_status from kitluy_laundry.booking_production_state where order_id = $1`,
      [perPiece.orderId],
    );
    expect(production.rows[0].production_status).toBe("RECEIVED");
  });

  it("booking creation replays idempotently (no duplicate aggregate)", async () => {
    const cmd = bookingCommand();
    const first = await createVerifiedBooking(pool, cmd);
    const second = await createVerifiedBooking(pool, cmd);
    expect(second.replayed).toBe(true);
    expect(second.orderId).toBe(first.orderId);
    const count = await pool.query(
      `select count(*)::bigint as n from kitluy_orders.orders
        where tenant_id = $1 and idempotency_key = $2`,
      [TENANT_A, cmd.idempotencyKey],
    );
    expect(count.rows[0].n).toBe(1n);
  });

  it("engine decision equals persisted result across the full production walk", async () => {
    const booking = await createVerifiedBooking(pool, bookingCommand());
    await markPaid(booking.orderId);
    let version = 1n;
    for (const to of ["WASHING", "DRYING", "PRESSING", "QA_PACKAGING"] as const) {
      const result = await transitionProductionStage(pool, {
        orderId: booking.orderId,
        to,
        expectedVersion: version,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-prod-${booking.orderId}-${to}`,
      });
      expect(result.to).toBe(to);
      version = result.version;
    }
    const ready = await commitReady(pool, {
      orderId: booking.orderId,
      expectedVersion: version,
      profile: "t3_ready_scan_in",
      qaPassed: true,
      countVerified: true,
      storagePositionId: POSITION_FREE,
      actor: { userId: MANAGER },
      idempotencyKey: `itest-ready-${booking.orderId}`,
    });
    expect(ready.to).toBe("READY");
    const released = await completePickupRelease(pool, {
      orderId: booking.orderId,
      expectedVersion: ready.version,
      profile: "t4_pickup_scan_out",
      collectorVerified: true,
      releaseCompletenessVerified: true,
      actor: { userId: MANAGER },
      idempotencyKey: `itest-pickup-${booking.orderId}`,
    });
    expect(released.to).toBe("PICKED_UP");
    expect(released.balanceSettled).toBe(true);

    const state = await pool.query(
      `select production_status from kitluy_laundry.booking_production_state where order_id = $1`,
      [booking.orderId],
    );
    expect(state.rows[0].production_status).toBe("PICKED_UP");
    const history = await pool.query(
      `select count(*)::bigint as n from kitluy_laundry.booking_status_history where order_id = $1`,
      [booking.orderId],
    );
    // creation RECEIVED + 4 stages + READY + PICKED_UP = 7 rows
    expect(history.rows[0].n).toBe(7n);
    const handoff = await pool.query(
      `select status, balance_settled, release_completeness_verified
         from kitluy_laundry.pickup_handoffs where order_id = $1`,
      [booking.orderId],
    );
    expect(handoff.rows[0]).toMatchObject({
      status: "COMPLETED",
      balance_settled: true,
      release_completeness_verified: true,
    });
    const assignment = await pool.query(
      `select cleared_at, clear_reason_code from kitluy_laundry.ready_storage_assignments
        where order_id = $1`,
      [booking.orderId],
    );
    expect(assignment.rows[0].cleared_at).not.toBeNull();
    expect(assignment.rows[0].clear_reason_code).toBe("PICKUP_RELEASED");
  });

  it("invalid engine transition writes nothing (skip-ahead rejected)", async () => {
    const booking = await createVerifiedBooking(pool, bookingCommand());
    await expect(
      transitionProductionStage(pool, {
        orderId: booking.orderId,
        to: "PRESSING",
        expectedVersion: 1n,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-skip-${booking.orderId}`,
      }),
    ).rejects.toBeInstanceOf(ProductionTransitionError);
    const history = await pool.query(
      `select count(*)::bigint as n from kitluy_laundry.booking_status_history
        where order_id = $1`,
      [booking.orderId],
    );
    expect(history.rows[0].n).toBe(1n); // only the creation row
    const state = await pool.query(
      `select production_status, version from kitluy_laundry.booking_production_state
        where order_id = $1`,
      [booking.orderId],
    );
    expect(state.rows[0]).toMatchObject({ production_status: "RECEIVED", version: 1n });
  });

  it("stale aggregate version writes nothing", async () => {
    const booking = await createVerifiedBooking(pool, bookingCommand());
    await expect(
      transitionProductionStage(pool, {
        orderId: booking.orderId,
        to: "WASHING",
        expectedVersion: 99n,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-stale-${booking.orderId}`,
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    await expect(
      transitionBookingLifecycle(pool, {
        orderId: booking.orderId,
        to: "IN_PROGRESS",
        expectedVersion: 99n,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-stale-lc-${booking.orderId}`,
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    const events = await pool.query(
      `select count(*)::bigint as n from kitluy_orders.order_events
        where order_id = $1 and event_type = 'booking_lifecycle_transition'`,
      [booking.orderId],
    );
    expect(events.rows[0].n).toBe(0n);
  });

  it("duplicate idempotent replay creates no duplicate transition history", async () => {
    const booking = await createVerifiedBooking(pool, bookingCommand());
    const key = `itest-dup-${booking.orderId}`;
    const first = await transitionProductionStage(pool, {
      orderId: booking.orderId,
      to: "WASHING",
      expectedVersion: 1n,
      actor: { userId: MANAGER },
      idempotencyKey: key,
    });
    const replay = await transitionProductionStage(pool, {
      orderId: booking.orderId,
      to: "WASHING",
      expectedVersion: 1n, // stale on purpose — replay must win before the check
      actor: { userId: MANAGER },
      idempotencyKey: key,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.to).toBe(first.to);
    expect(replay.version).toBe(first.version);
    const history = await pool.query(
      `select count(*)::bigint as n from kitluy_laundry.booking_status_history
        where order_id = $1 and idempotency_key = $2`,
      [booking.orderId, key],
    );
    expect(history.rows[0].n).toBe(1n);
  });

  it("duplicate custody scan replays without a second event (KBR-LND-004 TV3)", async () => {
    const booking = await createVerifiedBooking(pool, bookingCommand());
    const key = `itest-scan-${booking.orderId}`;
    const first = await recordCustodyScan(pool, {
      orderId: booking.orderId,
      scanType: "INTAKE",
      terminalRole: "t1_intake_cashier",
      toState: "RECEIVED",
      actor: { userId: CASHIER },
      idempotencyKey: key,
      aggregateVersion: 1n,
    });
    const replay = await recordCustodyScan(pool, {
      orderId: booking.orderId,
      scanType: "INTAKE",
      terminalRole: "t1_intake_cashier",
      toState: "RECEIVED",
      actor: { userId: CASHIER },
      idempotencyKey: key,
      aggregateVersion: 1n,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.scanEventId).toBe(first.scanEventId);
    const events = await pool.query(
      `select count(*)::bigint as n from kitluy_laundry.garment_scan_events
        where tenant_id = $1 and idempotency_key = $2`,
      [TENANT_A, key],
    );
    expect(events.rows[0].n).toBe(1n);
  });

  it("T3 guard: wrong profile or missing verification writes nothing", async () => {
    const booking = await createVerifiedBooking(pool, bookingCommand());
    let version = 1n;
    for (const to of ["WASHING", "DRYING", "PRESSING", "QA_PACKAGING"] as const) {
      const r = await transitionProductionStage(pool, {
        orderId: booking.orderId,
        to,
        expectedVersion: version,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-t3guard-${booking.orderId}-${to}`,
      });
      version = r.version;
    }
    await expect(
      commitReady(pool, {
        orderId: booking.orderId,
        expectedVersion: version,
        profile: "t1_intake_cashier", // not T3
        qaPassed: true,
        countVerified: true,
        storagePositionId: POSITION_FREE,
        actor: { userId: CASHIER },
        idempotencyKey: `itest-t3wrong-${booking.orderId}`,
      }),
    ).rejects.toBeInstanceOf(T3ReadyCommitError);
    await expect(
      commitReady(pool, {
        orderId: booking.orderId,
        expectedVersion: version,
        profile: "t3_ready_scan_in",
        qaPassed: false, // QA missing
        countVerified: true,
        storagePositionId: POSITION_FREE,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-t3noqa-${booking.orderId}`,
      }),
    ).rejects.toBeInstanceOf(T3ReadyCommitError);
    const state = await pool.query(
      `select production_status from kitluy_laundry.booking_production_state where order_id = $1`,
      [booking.orderId],
    );
    expect(state.rows[0].production_status).toBe("QA_PACKAGING");
  });

  it("T4 guard: unpaid balance without approved exception blocks release (KBR-LND-005)", async () => {
    const booking = await createVerifiedBooking(pool, bookingCommand());
    let version = 1n;
    for (const to of ["WASHING", "DRYING", "PRESSING", "QA_PACKAGING"] as const) {
      const r = await transitionProductionStage(pool, {
        orderId: booking.orderId,
        to,
        expectedVersion: version,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-t4-${booking.orderId}-${to}`,
      });
      version = r.version;
    }
    const ready = await commitReady(pool, {
      orderId: booking.orderId,
      expectedVersion: version,
      profile: "t3_ready_scan_in",
      qaPassed: true,
      countVerified: true,
      storagePositionId: POSITION_FREE,
      actor: { userId: MANAGER },
      idempotencyKey: `itest-t4ready-${booking.orderId}`,
    });

    // Booking is UNPAID: engine T4 guard rejects; nothing is written.
    await expect(
      completePickupRelease(pool, {
        orderId: booking.orderId,
        expectedVersion: ready.version,
        profile: "t4_pickup_scan_out",
        collectorVerified: true,
        releaseCompletenessVerified: true,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-t4unpaid-${booking.orderId}`,
      }),
    ).rejects.toBeInstanceOf(T4ReleaseError);
    const handoffs = await pool.query(
      `select count(*)::bigint as n from kitluy_laundry.pickup_handoffs where order_id = $1`,
      [booking.orderId],
    );
    expect(handoffs.rows[0].n).toBe(0n);

    // Paid -> release completes.
    await markPaid(booking.orderId);
    const released = await completePickupRelease(pool, {
      orderId: booking.orderId,
      expectedVersion: ready.version,
      profile: "t4_pickup_scan_out",
      collectorVerified: true,
      releaseCompletenessVerified: true,
      actor: { userId: MANAGER },
      idempotencyKey: `itest-t4paid-${booking.orderId}`,
    });
    expect(released.to).toBe("PICKED_UP");
  });

  it("lifecycle: engine adjacency enforced; compensating branch requires reason", async () => {
    const booking = await createVerifiedBooking(pool, bookingCommand());
    // Illegal edge (CONFIRMED/FINALIZED -> FULFILLED/COMPLETED) throws.
    await expect(
      transitionBookingLifecycle(pool, {
        orderId: booking.orderId,
        to: "FULFILLED/COMPLETED",
        expectedVersion: 1n,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-lc-bad-${booking.orderId}`,
      }),
    ).rejects.toBeInstanceOf(BookingLifecycleTransitionError);
    // Cancellation without a reason is rejected (KBR-TXN-005).
    await expect(
      transitionBookingLifecycle(pool, {
        orderId: booking.orderId,
        to: "CANCELLED",
        expectedVersion: 1n,
        actor: { userId: MANAGER },
        idempotencyKey: `itest-lc-noreason-${booking.orderId}`,
      }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    // Valid transition persists engine result + event row.
    const moved = await transitionBookingLifecycle(pool, {
      orderId: booking.orderId,
      to: "IN_PROGRESS",
      expectedVersion: 1n,
      actor: { userId: MANAGER },
      idempotencyKey: `itest-lc-ok-${booking.orderId}`,
    });
    expect(moved).toMatchObject({ from: "CONFIRMED/FINALIZED", to: "IN_PROGRESS", version: 2n });
    const replay = await transitionBookingLifecycle(pool, {
      orderId: booking.orderId,
      to: "IN_PROGRESS",
      expectedVersion: 1n,
      actor: { userId: MANAGER },
      idempotencyKey: `itest-lc-ok-${booking.orderId}`,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.version).toBe(2n);
  });

  it("rollback leaves no partial aggregate (foreign catalog line aborts the whole creation)", async () => {
    const cmd = bookingCommand();
    const doomed = {
      ...cmd,
      lines: [
        ...cmd.lines,
        {
          catalogItemId: "00000000-0000-4000-8000-000000000313", // Tenant B item
          serviceCode: "ATK-WASH",
          pricingMode: "PER_PIECE" as const,
          quantity: 1n,
          unitPriceMinor: 1800n,
        },
      ],
    };
    await expect(createVerifiedBooking(pool, doomed)).rejects.toThrow();
    const rows = await pool.query(
      `select count(*)::bigint as n from kitluy_orders.orders
        where tenant_id = $1 and idempotency_key = $2`,
      [TENANT_A, cmd.idempotencyKey],
    );
    expect(rows.rows[0].n).toBe(0n);
  });
});
