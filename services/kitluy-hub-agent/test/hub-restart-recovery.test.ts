/**
 * Hub RESTART behaviour (WS-09-T005 / T006 test matrix).
 *
 * A Hub restart is modelled honestly: the agent's connection pool is destroyed
 * and a NEW pool is created, exactly as a restarted `kitluy-hub-agent` process
 * would do. Nothing is cached in process, so a restart can only be survived by
 * what is actually durable in PostgreSQL.
 *
 * Covered: clean restart with state intact, restart after a committed command
 * (the stored result is still retrievable), outbox recovery (pending events
 * survive and stay EXACTLY `pending`), sequence continuation (offline contract
 * §20 acceptance test 4) and migration-ledger stability.
 *
 * SKIPS VISIBLY when the local Hub database is unreachable; a skipped run is
 * never reported as executed evidence (KLD-EVIDENCE-001).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { withHubTransaction } from "../src/hub/db.js";
import { loadCommandResult } from "../src/hub/idempotency.js";
import { readAppliedMigrations } from "../src/hub/safety-mode.js";
import { WS09_DELIVERY_STATE } from "../src/hub/repositories/sync.js";
import { createBookingDraft } from "../src/hub/commands/booking-commands.js";
import {
  ACTOR_CASHIER,
  T1,
  TEST_LOCATION_CODE,
  businessDate,
  countRows,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  nextCommandKey,
  pool,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "restart";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent restart suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

describe.skipIf(!available)("Store Hub restart", () => {
  /** The pool that survives the suite; per-test restarts use their own pools. */
  let p: pg.Pool;
  let t1: ProvisionedTerminal;
  let today: string;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
    t1 = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  /** Destroy the current pool and hand back a fresh one — a Hub restart. */
  async function restart(current: pg.Pool): Promise<pg.Pool> {
    await current.end().catch(() => undefined);
    const next = pool();
    next.on("error", () => undefined);
    await ensureRuntimeRoleMembership(next);
    return next;
  }

  function draft(target: pg.Pool, key: { idempotencyKey: string; clientSequence: bigint }) {
    return createBookingDraft(target, {
      device: deviceContext(t1),
      ...key,
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
  }

  it("survives a CLEAN restart with committed state intact", async () => {
    let hub = pool();
    hub.on("error", () => undefined);
    await ensureRuntimeRoleMembership(hub);
    const key = await nextCommandKey(hub, t1.terminalDeviceId);
    const created = await draft(hub, key);
    expect(created.outcome).toBe("accepted");

    hub = await restart(hub);
    try {
      const booking = await hub.query<{ id: string; status: string; aggregate_version: bigint }>(
        `select id, status, aggregate_version from edge_laundry.booking where id = $1`,
        [created.aggregateId],
      );
      expect(booking.rows[0]?.id).toBe(created.aggregateId);
      expect(booking.rows[0]?.aggregate_version).toBe(created.aggregateVersion);
      const events = await countRows(
        hub,
        `select count(*)::text as count from edge_sync.local_event where aggregate_id = $1`,
        [created.aggregateId],
      );
      expect(events).toBe(1);
    } finally {
      await hub.end().catch(() => undefined);
    }
  });

  it("still returns the STORED result of a committed command after a restart", async () => {
    let hub = pool();
    hub.on("error", () => undefined);
    await ensureRuntimeRoleMembership(hub);
    const key = await nextCommandKey(hub, t1.terminalDeviceId);
    const created = await draft(hub, key);

    hub = await restart(hub);
    try {
      const stored = await withHubTransaction(hub, (client) =>
        loadCommandResult(client, key.idempotencyKey),
      );
      expect(stored?.commit_status).toBe("committed");
      expect(stored?.aggregate_id).toBe(created.aggregateId);
      // WS-09 records LOCAL truth only; a restart never upgrades it.
      expect(stored?.sync_state).toBe("committed_locally");

      // A retry after the restart replays the ORIGINAL result and writes nothing.
      const replay = await draft(hub, key);
      expect(replay.outcome).toBe("duplicate");
      expect(replay.aggregateId).toBe(created.aggregateId);
      expect(
        await countRows(
          hub,
          `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
          [key.idempotencyKey],
        ),
      ).toBe(1);
    } finally {
      await hub.end().catch(() => undefined);
    }
  });

  it("recovers a PENDING outbox across a restart and never advances it (HUB-QA-011)", async () => {
    let hub = pool();
    hub.on("error", () => undefined);
    await ensureRuntimeRoleMembership(hub);
    const created = await draft(hub, await nextCommandKey(hub, t1.terminalDeviceId));
    const before = await hub.query<{ event_id: string; delivery_state: string }>(
      `select o.event_id, o.delivery_state from edge_sync.outbox o
         join edge_sync.local_event e on e.id = o.event_id
        where e.aggregate_id = $1 order by o.hub_sequence`,
      [created.aggregateId],
    );
    expect(before.rows.length).toBeGreaterThan(0);

    hub = await restart(hub);
    try {
      const after = await hub.query<{
        event_id: string;
        delivery_state: string;
        cloud_ack_id: string | null;
        acknowledged_at: Date | null;
        attempt_count: number;
      }>(
        `select o.event_id, o.delivery_state, o.cloud_ack_id, o.acknowledged_at, o.attempt_count
           from edge_sync.outbox o
           join edge_sync.local_event e on e.id = o.event_id
          where e.aggregate_id = $1 order by o.hub_sequence`,
        [created.aggregateId],
      );
      expect(after.rows.map((r) => r.event_id)).toEqual(before.rows.map((r) => r.event_id));
      for (const row of after.rows) {
        // Amendment §2: WS-09 writes ONLY 'pending'; a restart fabricates nothing.
        expect(row.delivery_state).toBe(WS09_DELIVERY_STATE);
        expect(row.cloud_ack_id).toBeNull();
        expect(row.acknowledged_at).toBeNull();
        expect(row.attempt_count).toBe(0);
      }
    } finally {
      await hub.end().catch(() => undefined);
    }
  });

  it("continues terminal and Hub sequences across a restart (offline §20 test 4)", async () => {
    let hub = pool();
    hub.on("error", () => undefined);
    await ensureRuntimeRoleMembership(hub);
    const first = await draft(hub, await nextCommandKey(hub, t1.terminalDeviceId));

    hub = await restart(hub);
    try {
      const second = await draft(hub, await nextCommandKey(hub, t1.terminalDeviceId));
      expect(second.outcome).toBe("accepted");
      // Never reused, never rewound.
      expect(second.hubSequenceFirst! > first.hubSequenceLast!).toBe(true);
      const terminal = await hub.query<{ last_client_sequence: bigint }>(
        `select last_client_sequence from edge_identity.terminal_device where id = $1`,
        [t1.terminalDeviceId],
      );
      expect(terminal.rows[0]!.last_client_sequence).toBeGreaterThan(0n);
    } finally {
      await hub.end().catch(() => undefined);
    }
  });

  it("keeps the checksum-registered migration ledger identical across a restart", async () => {
    let hub = pool();
    hub.on("error", () => undefined);
    const before = await withHubTransaction(hub, (client) => readAppliedMigrations(client));
    hub = await restart(hub);
    try {
      const after = await withHubTransaction(hub, (client) => readAppliedMigrations(client));
      expect(after).toEqual(before);
      expect(after.length).toBeGreaterThan(0);
    } finally {
      await hub.end().catch(() => undefined);
    }
  });
});
