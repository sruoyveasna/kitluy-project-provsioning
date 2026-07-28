/**
 * WS-10-T001 — outbox leasing and the `pending -> in_flight` transition.
 *
 * Ordering authority: Store Hub spec §11.5 (oldest-unacknowledged-first),
 * offline contract §5.1 (the ordering namespace), owner amendment
 * KLD-2026-07-28-001-A01 §2 (in_flight is a transport state) and §3 (the two
 * dimensions transition independently).
 *
 * Each suite owns a private `assignment_generation` so head-of-line blocking in
 * one test cannot stall another.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { withHubTransaction, HUB_SYNC_WORKER_ROLE } from "../src/hub/db.js";
import {
  DEFAULT_LEASE_SECONDS,
  assertStrictlyIncreasing,
  describeStreamHead,
  leaseOutboxBatch,
  reapExpiredLeases,
  releaseOutboxLease,
  type OutboxLeaseItem,
} from "../src/hub/sync/outbox-lease.js";
import { SyncDeliveryError } from "../src/hub/sync/errors.js";
import {
  ACTOR_CASHIER,
  LOCATION,
  T1,
  ensureRuntimeRoleMembership,
  hubReachable,
  outboxRow,
  pool,
  provisionTerminal,
  reserveSyncGenerationBlock,
  seedOutboxStream,
  seedSyncConflict,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent sync-outbox-lease suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

describe.skipIf(!available)("WS-10-T001 outbox leasing", () => {
  let p: pg.Pool;
  let terminal: ProvisionedTerminal;
  // Reserved at run time, ABOVE every generation already in the database: the
  // Hub database is not reset between runs, so a fixed base would meet the
  // previous run's leftovers.
  let generation = 0;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    terminal = await provisionTerminal(p, "lease", T1, ACTOR_CASHIER);
    generation = await reserveSyncGenerationBlock(p);
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  /** A fresh private stream per test. */
  async function stream(count: number, suite: string) {
    generation += 1;
    const events = await seedOutboxStream(p, {
      generation,
      count,
      terminalDeviceId: terminal.terminalDeviceId,
      suite,
    });
    return { generation, events };
  }

  function lease(gen: number, options: Partial<Parameters<typeof leaseOutboxBatch>[1]> = {}) {
    return withHubTransaction(p, (client) =>
      leaseOutboxBatch(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        leaseOwner: "worker-a",
        ...options,
      }),
    );
  }

  it("claims the whole pending stream in hub_sequence order and marks it in_flight", async () => {
    const { generation: gen, events } = await stream(4, "ordered");
    const claimed = await lease(gen);

    expect(claimed.items.map((i) => i.eventId)).toEqual(events.map((e) => e.eventId));
    expect(claimed.leaseId).toMatch(/^[0-9a-f-]{36}$/);
    for (const event of events) {
      const row = await outboxRow(p, event.eventId);
      expect(row.delivery_state).toBe("in_flight");
      expect(row.lease_owner).toBe("worker-a");
      expect(row.lease_id).toBe(claimed.leaseId);
      // The attempt is counted at claim time, so a worker that dies before
      // recording an outcome has still burnt an attempt.
      expect(row.attempt_count).toBe(1);
    }
  });

  it("bounds the batch and leaves the remainder queued", async () => {
    const { generation: gen, events } = await stream(5, "bounded");
    const claimed = await lease(gen, { maxItems: 2 });

    expect(claimed.items).toHaveLength(2);
    expect(claimed.items.map((i) => i.eventId)).toEqual([events[0]!.eventId, events[1]!.eventId]);
    expect((await outboxRow(p, events[2]!.eventId)).delivery_state).toBe("pending");
  });

  it("never skips ahead: a live lease at the head stops the scan", async () => {
    const { generation: gen, events } = await stream(3, "head-lease");
    await lease(gen, { maxItems: 1, leaseSeconds: 300 });

    const second = await lease(gen, { leaseOwner: "worker-b" });
    expect(second.items).toEqual([]);
    expect((await outboxRow(p, events[1]!.eventId)).delivery_state).toBe("pending");

    const head = await withHubTransaction(p, (client) => describeStreamHead(client, LOCATION, gen));
    expect(head?.eventId).toBe(events[0]!.eventId);
    expect(head?.deliveryState).toBe("in_flight");
    expect(head?.leaseOwner).toBe("worker-a");
  });

  it("never skips ahead: an item still in backoff stops the scan", async () => {
    const { generation: gen, events } = await stream(3, "head-backoff");
    const claimed = await lease(gen, { maxItems: 1 });
    await withHubTransaction(p, (client) =>
      releaseOutboxLease(client, {
        eventId: events[0]!.eventId,
        leaseId: claimed.leaseId,
        reasonCode: "EDGE_TRANSPORT_TIMEOUT",
        backoffSeconds: 600,
      }),
    );

    const second = await lease(gen);
    expect(second.items).toEqual([]);
    expect((await outboxRow(p, events[1]!.eventId)).delivery_state).toBe("pending");
  });

  it("never skips ahead: an unresolved divergence blocks its own stream", async () => {
    const { generation: gen, events } = await stream(3, "head-conflict");
    const conflictId = await seedSyncConflict(p, { localEventId: events[0]!.eventId });
    await p.query(`select edge_sync.raise_reconciliation($1::uuid, $2::uuid, $3::text)`, [
      events[0]!.eventId,
      conflictId,
      "cloud reported a different applied amount",
    ]);

    const claimed = await lease(gen);
    expect(claimed.items).toEqual([]);

    // The blocked head is REPORTABLE, and the shared projection shows the
    // conflict override winning over the pending delivery state.
    const head = await withHubTransaction(p, (client) => describeStreamHead(client, LOCATION, gen));
    expect(head?.deliveryState).toBe("pending");
    expect(head?.reconciliationState).toBe("required");
    expect(head?.externalStatus).toBe("reconciliation_required");
  });

  it("steps over rows the cloud can never acknowledge", async () => {
    const { generation: gen, events } = await stream(3, "terminal-skip");
    // A durable cloud rejection on the head: the cloud has answered, and the
    // stream must not stall forever waiting for a second answer.
    await p.query(
      `update edge_sync.outbox
          set delivery_state = 'rejected', last_error_code = 'EDGE_CLOUD_REJECTED_SCHEMA',
              rejected_at = now()
        where event_id = $1`,
      [events[0]!.eventId],
    );

    const claimed = await lease(gen);
    expect(claimed.items.map((i) => i.eventId)).toEqual([events[1]!.eventId, events[2]!.eventId]);
  });

  it("reclaims an expired lease without inventing a cloud outcome", async () => {
    const { generation: gen, events } = await stream(1, "reap");
    await lease(gen, { maxItems: 1, leaseSeconds: 300 });
    // Age the lease past its window; both timestamps move so the lease-window
    // CHECK stays satisfied.
    await p.query(
      `update edge_sync.outbox
          set leased_at = now() - interval '10 minutes',
              lease_expires_at = now() - interval '1 second'
        where event_id = $1`,
      [events[0]!.eventId],
    );

    const reaped = await withHubTransaction(p, (client) => reapExpiredLeases(client, LOCATION));
    expect(reaped).toBeGreaterThanOrEqual(1);

    const row = await outboxRow(p, events[0]!.eventId);
    expect(row.delivery_state).toBe("retry_wait");
    expect(row.last_error_code).toBe("EDGE_LEASE_EXPIRED");
    expect(row.lease_owner).toBeNull();
    // An unverified timeout is NOT a durable cloud rejection (amendment §2).
    expect(row.rejected_at).toBeNull();
    expect(row.cloud_ack_id).toBeNull();
    // The attempt history survives the crash.
    expect(row.attempt_count).toBe(1);
  });

  it("refuses to release a lease under a durable-rejection code", async () => {
    const { generation: gen, events } = await stream(1, "release-guard");
    const claimed = await lease(gen, { maxItems: 1 });

    await expect(
      withHubTransaction(p, (client) =>
        releaseOutboxLease(client, {
          eventId: events[0]!.eventId,
          leaseId: claimed.leaseId,
          reasonCode: "EDGE_CLOUD_REJECTED_SCHEMA",
        }),
      ),
    ).rejects.toThrow(SyncDeliveryError);

    expect((await outboxRow(p, events[0]!.eventId)).delivery_state).toBe("in_flight");
  });

  it("will not let one worker release another worker's attempt", async () => {
    const { generation: gen, events } = await stream(1, "foreign-release");
    await lease(gen, { maxItems: 1, leaseSeconds: 300 });

    const released = await withHubTransaction(p, (client) =>
      releaseOutboxLease(client, {
        eventId: events[0]!.eventId,
        leaseId: "33333333-3333-4333-8333-333333333333",
        reasonCode: "EDGE_WORKER_SHUTDOWN",
      }),
    );
    expect(released).toBe(false);
    expect((await outboxRow(p, events[0]!.eventId)).delivery_state).toBe("in_flight");
  });

  it("leaves the conflict dimension untouched when it moves delivery state", async () => {
    const { generation: gen, events } = await stream(1, "independence");
    const before = await outboxRow(p, events[0]!.eventId);
    expect(before.reconciliation_state).toBe("none");

    await lease(gen, { maxItems: 1 });

    const after = await outboxRow(p, events[0]!.eventId);
    expect(after.delivery_state).toBe("in_flight");
    expect(after.reconciliation_state).toBe("none");
    expect(after.reconciliation_conflict_id).toBeNull();
  });

  it("reports an empty queue and a blocked queue as different facts", async () => {
    const { generation: gen } = await stream(0, "empty");
    const claimed = await lease(gen);
    expect(claimed.items).toEqual([]);
    const head = await withHubTransaction(p, (client) => describeStreamHead(client, LOCATION, gen));
    // Drained: no head at all. A blocked stream returns a head (see above).
    expect(head).toBeUndefined();
  });

  it("works as the sync worker role, which is what actually runs it", async () => {
    const { generation: gen, events } = await stream(1, "role");
    const claimed = await withHubTransaction(
      p,
      (client) =>
        leaseOutboxBatch(client, {
          locationId: LOCATION,
          assignmentGeneration: gen,
          leaseOwner: "sync-worker",
        }),
      HUB_SYNC_WORKER_ROLE,
    );
    expect(claimed.items.map((i) => i.eventId)).toEqual([events[0]!.eventId]);
  });

  it("refuses an unowned or unbounded claim", async () => {
    const { generation: gen } = await stream(1, "invalid");
    await expect(lease(gen, { leaseOwner: "  " })).rejects.toThrow(/LEASE-OWNER-REQUIRED/);
    await expect(lease(gen, { maxItems: 0 })).rejects.toThrow(/LEASE-BATCH-INVALID/);
    await expect(lease(gen, { leaseSeconds: 0 })).rejects.toThrow(/LEASE-WINDOW-INVALID/);
  });

  it("uses a bounded default lease window", () => {
    expect(DEFAULT_LEASE_SECONDS).toBeGreaterThan(0);
    expect(DEFAULT_LEASE_SECONDS).toBeLessThanOrEqual(300);
  });
});

describe("batch ordering guard (pure)", () => {
  const item = (generation: number, sequence: bigint): OutboxLeaseItem =>
    ({
      eventId: `e-${generation}-${sequence}`,
      hubSequence: sequence,
      assignmentGeneration: generation,
    }) as OutboxLeaseItem;

  /** Assert on the CODE, not the prose — the message is free to be readable. */
  function expectOrderingViolation(run: () => void): void {
    expect(run).toThrow(SyncDeliveryError);
    try {
      run();
    } catch (error) {
      expect((error as SyncDeliveryError).code).toBe("EDGE_BATCH_ORDERING_VIOLATION");
    }
  }

  it("accepts a strictly increasing batch", () => {
    expect(() => assertStrictlyIncreasing([item(1, 1n), item(1, 2n), item(2, 1n)])).not.toThrow();
  });

  it("rejects a repeated or decreasing hub_sequence", () => {
    expectOrderingViolation(() => assertStrictlyIncreasing([item(1, 2n), item(1, 2n)]));
    expectOrderingViolation(() => assertStrictlyIncreasing([item(1, 3n), item(1, 2n)]));
  });

  it("rejects a generation that goes backwards", () => {
    expectOrderingViolation(() => assertStrictlyIncreasing([item(2, 1n), item(1, 9n)]));
  });
});
