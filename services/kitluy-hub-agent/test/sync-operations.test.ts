/**
 * WS-10-T009 — cursor recovery, observability and audited operator repair.
 *
 * Authority: Store Hub spec §11.5, schema contract §6.8, offline contract §5,
 * owner amendment KLD-2026-07-28-001-A01 §3 and §5.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { withHubTransaction } from "../src/hub/db.js";
import { HubCommandError } from "../src/hub/errors.js";
import { uuidv7 } from "../src/hub/uuid.js";
import { leaseOutboxBatch } from "../src/hub/sync/outbox-lease.js";
import { applyOutcome, recordDeliveryConflict } from "../src/hub/sync/delivery-outcome.js";
import {
  ABANDON_PERMISSION,
  REQUEUE_PERMISSION,
  abandonDeadLetter,
  describeStreamHealth,
  recoverSyncCursor,
  requeueDeadLetter,
} from "../src/hub/sync/operations.js";
import {
  ACTOR_CASHIER,
  ACTOR_MANAGER,
  HUB_DEVICE,
  LOCATION,
  STORE,
  T1,
  TENANT,
  ensureRuntimeRoleMembership,
  hubReachable,
  outboxRow,
  pool,
  provisionTerminal,
  reserveSyncGenerationBlock,
  seedOutboxStream,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const available = await hubReachable();
if (!available) {
  console.warn("SKIPPED kitluy-hub-agent sync-operations suite: Hub database unreachable");
}

describe("abandonment is INACTIVE, not borrowed (KLREQ-030)", () => {
  it("keeps 'try again' and 'give up' as different authorities", () => {
    expect(REQUEUE_PERMISSION).toBe("fleet.sync.trigger");
    expect(ABANDON_PERMISSION).toMatch(/^\[REQUIRED: /);
    expect(ABANDON_PERMISSION).toContain("KLREQ-030");
    expect(ABANDON_PERMISSION).toContain("must not be reused");
    expect(() => abandonDeadLetter(uuidv7())).toThrow(HubCommandError);
  });
});

describe.skipIf(!available)("WS-10-T009 recovery, health and repair", () => {
  let p: pg.Pool;
  let terminal: ProvisionedTerminal;
  let generation = 0;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    terminal = await provisionTerminal(p, "ops", T1, ACTOR_CASHIER);
    generation = await reserveSyncGenerationBlock(p, "cursor");
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  async function stream(count: number, suite: string) {
    generation += 1;
    const gen = generation;
    const events = await seedOutboxStream(p, {
      generation: gen,
      count,
      terminalDeviceId: terminal.terminalDeviceId,
      suite,
    });
    return { gen, events };
  }

  async function lease(gen: number, maxItems: number, seconds = 300) {
    return withHubTransaction(p, (client) =>
      leaseOutboxBatch(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        leaseOwner: "worker-ops",
        leaseSeconds: seconds,
        maxItems,
      }),
    );
  }

  it("recovers a cursor from stored rows after a restart", async () => {
    const { gen, events } = await stream(3, "recover");
    const claimed = await lease(gen, 3);
    await withHubTransaction(p, async (client) => {
      for (const [index, event] of events.entries()) {
        if (index === 2) break;
        await applyOutcome(client, {
          eventId: event.eventId,
          leaseId: claimed.leaseId,
          routing: { kind: "acknowledge", cloudAckId: `ack-${index}` },
        });
      }
    });

    const streamCode = `recover-${gen}`;
    const recovered = await withHubTransaction(p, (client) =>
      recoverSyncCursor(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        streamCode,
      }),
    );
    // Pushed reaches the last row that left `pending`; acknowledged stops at the
    // last CONTIGUOUS acknowledgement.
    expect(recovered.pushed).toBe(events[2]!.hubSequence);
    expect(recovered.acknowledged).toBe(events[1]!.hubSequence);
  });

  it("keeps contiguity over THIS STREAM'S rows, so a burnt sequence never stalls it", async () => {
    generation += 1;
    const gen = generation;
    const first = await seedOutboxStream(p, {
      generation: gen,
      count: 1,
      terminalDeviceId: terminal.terminalDeviceId,
      suite: "gap-a",
    });
    const burnt = await p.query<{ allocate_hub_sequence: bigint }>(
      `select edge_sync.allocate_hub_sequence()`,
    );
    await p.query(
      `select edge_sync.record_sequence_gap($1::uuid, $2::uuid, $3::uuid, $4::uuid,
              $5::integer, $6::bigint, 'transaction_rollback', 'ws-10-ops', null)`,
      [uuidv7(), TENANT, STORE, LOCATION, gen, burnt.rows[0]!.allocate_hub_sequence.toString()],
    );
    const second = await seedOutboxStream(p, {
      generation: gen,
      count: 1,
      terminalDeviceId: terminal.terminalDeviceId,
      suite: "gap-b",
    });

    const claimed = await lease(gen, 2);
    await withHubTransaction(p, async (client) => {
      for (const [index, event] of [...first, ...second].entries()) {
        await applyOutcome(client, {
          eventId: event.eventId,
          leaseId: claimed.leaseId,
          routing: { kind: "acknowledge", cloudAckId: `ack-gap-${index}` },
        });
      }
    });

    const recovered = await withHubTransaction(p, (client) =>
      recoverSyncCursor(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        streamCode: `gap-${gen}`,
      }),
    );
    // The burnt value — and every sequence another stream took meanwhile —
    // sits between these two rows. Contiguity is over the STREAM'S OWN ROWS, so
    // the acknowledged cursor reaches the SECOND event rather than stalling on
    // integers that were never this stream's to begin with.
    expect(recovered.acknowledged).toBe(second[0]!.hubSequence);
    // …and the burnt value is journalled, so nothing will chase it as missing.
    const journalled = await p.query<{ n: string }>(
      `select count(*)::text as n from edge_sync.sequence_gap
        where location_id = $1 and assignment_generation = $2 and hub_sequence = $3::bigint`,
      [LOCATION, gen, burnt.rows[0]!.allocate_hub_sequence.toString()],
    );
    expect(Number(journalled.rows[0]!.n)).toBe(1);
  });

  it("stops contiguity at a genuinely unacknowledged row", async () => {
    const { gen, events } = await stream(3, "stall");
    const claimed = await lease(gen, 3);
    await withHubTransaction(p, async (client) => {
      // Acknowledge the FIRST and the THIRD, leaving a real hole.
      await applyOutcome(client, {
        eventId: events[0]!.eventId,
        leaseId: claimed.leaseId,
        routing: { kind: "acknowledge", cloudAckId: "ack-1" },
      });
      await applyOutcome(client, {
        eventId: events[2]!.eventId,
        leaseId: claimed.leaseId,
        routing: { kind: "acknowledge", cloudAckId: "ack-3" },
      });
    });

    const recovered = await withHubTransaction(p, (client) =>
      recoverSyncCursor(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        streamCode: `stall-${gen}`,
      }),
    );
    expect(recovered.acknowledged).toBe(events[0]!.hubSequence);
  });

  it("reports a blocked stream as blocked, with the reason", async () => {
    const { gen } = await stream(3, "health-blocked");
    await lease(gen, 1, 600);

    const health = await withHubTransaction(p, (client) =>
      describeStreamHealth(client, LOCATION, gen),
    );
    expect(health?.total).toBe(3);
    expect(health?.inFlight).toBe(1);
    expect(health?.pending).toBe(2);
    // A queue depth alone would say "3 items"; the health view says the head is
    // held and by whom.
    expect(health?.blocked).toBe(true);
    expect(health?.blockedReason).toMatch(/leased by 'worker-ops'/);
  });

  it("counts BOTH dimensions, so a short queue cannot look like a clean one", async () => {
    const { gen, events } = await stream(1, "health-dimensions");
    const claimed = await lease(gen, 1);
    await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId: events[0]!.eventId,
        leaseId: claimed.leaseId,
        routing: { kind: "acknowledge", cloudAckId: "ack" },
      }),
    );
    const conflictId = await withHubTransaction(p, (client) =>
      recordDeliveryConflict(client, {
        eventId: events[0]!.eventId,
        tenantId: TENANT,
        digitalStoreId: STORE,
        locationId: LOCATION,
        dataClass: "finance_payment",
        reason: "cloud amount differs",
      }),
    );
    await p.query(`select edge_sync.raise_reconciliation($1::uuid, $2::uuid, $3::text)`, [
      events[0]!.eventId,
      conflictId,
      "cloud amount differs",
    ]);

    const health = await withHubTransaction(p, (client) =>
      describeStreamHealth(client, LOCATION, gen),
    );
    // Fully acknowledged AND fully in need of attention, at the same time.
    expect(health?.acknowledged).toBe(1);
    expect(health?.reconciliationRequired).toBe(1);
  });

  it("requeues a dead letter with an actor, a reason and immutable audit", async () => {
    const { gen, events } = await stream(1, "requeue");
    const eventId = events[0]!.eventId;
    const claimed = await lease(gen, 1);
    await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: claimed.leaseId,
        routing: {
          kind: "dead_letter",
          code: "EDGE_TRANSPORT_UNREACHABLE",
          reason: "exhausted after 8 attempts",
        },
        conflictFactory: (id, reason) =>
          withHubTransaction(p, (c) =>
            recordDeliveryConflict(c, {
              eventId: id,
              tenantId: TENANT,
              digitalStoreId: STORE,
              locationId: LOCATION,
              dataClass: "finance_payment",
              reason,
            }),
          ),
      }),
    );

    const dead = await p.query<{ id: string }>(
      `select id from edge_sync.dead_letter_item where source_id = $1`,
      [eventId],
    );
    const deadLetterId = dead.rows[0]!.id;

    // No actor, no repair.
    await expect(
      p.query(`select edge_sync.requeue_dead_letter($1::uuid, null, 'because', 0)`, [deadLetterId]),
    ).rejects.toThrow(/REPAIR-ACTOR-REQUIRED/);
    await expect(
      p.query(`select edge_sync.requeue_dead_letter($1::uuid, $2::uuid, '  ', 0)`, [
        deadLetterId,
        ACTOR_MANAGER,
      ]),
    ).rejects.toThrow(/REPAIR-REASON-REQUIRED/);

    await withHubTransaction(p, (client) =>
      requeueDeadLetter(client, {
        deadLetterId,
        actorId: ACTOR_MANAGER,
        reason: "WAN link restored; retrying the exhausted item",
        tenantId: TENANT,
        digitalStoreId: STORE,
        locationId: LOCATION,
        hubDeviceId: HUB_DEVICE,
      }),
    );

    const row = await outboxRow(p, eventId);
    expect(row.delivery_state).toBe("retry_wait");
    expect(row.last_error_code).toBe("EDGE_OPERATOR_REQUEUED");
    // Repairing TRANSPORT is not declaring the divergence resolved.
    expect(row.reconciliation_state).toBe("required");
    expect(row.external_status).toBe("reconciliation_required");
    // The attempts happened and are not hidden.
    expect(row.attempt_count).toBeGreaterThanOrEqual(1);

    const item = await p.query<{
      resolved_by: string;
      resolution_action: string;
      operator_action_required: boolean;
    }>(
      `select resolved_by, resolution_action, operator_action_required
         from edge_sync.dead_letter_item where id = $1`,
      [deadLetterId],
    );
    expect(item.rows[0]).toMatchObject({
      resolved_by: ACTOR_MANAGER,
      resolution_action: "requeued",
      operator_action_required: false,
    });

    const audit = await p.query<{ details_json: Record<string, unknown> }>(
      `select details_json from edge_audit.audit_event
        where resource_id = $1 and event_code = 'sync.dead_letter_requeued'`,
      [deadLetterId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.details_json).toMatchObject({
      permission: "fleet.sync.trigger",
      delivery_state_before: "dead_letter",
      delivery_state_after: "retry_wait",
      reconciliation_state_before: "required",
      reconciliation_state_after: "required",
    });

    // A resolved dead letter is not resolved twice.
    await expect(
      withHubTransaction(p, (client) =>
        requeueDeadLetter(client, {
          deadLetterId,
          actorId: ACTOR_MANAGER,
          reason: "again",
          tenantId: TENANT,
          digitalStoreId: STORE,
          locationId: LOCATION,
          hubDeviceId: HUB_DEVICE,
        }),
      ),
    ).rejects.toThrow(/ALREADY-RESOLVED/);
  });

  it("refuses to requeue an item that is not dead-lettered", async () => {
    const { gen, events } = await stream(1, "requeue-guard");
    await lease(gen, 1);
    const fake = await p.query<{ id: string }>(
      `insert into edge_sync.dead_letter_item
         (id, tenant_id, digital_store_id, location_id, source_kind, source_id, error_code,
          error_message, payload_sha256, first_failed_at, last_failed_at, attempt_count)
       values (gen_random_uuid(), $1, $2, $3, 'outbox', $4, 'X', 'x', repeat('0', 64),
               now(), now(), 1)
       returning id`,
      [TENANT, STORE, LOCATION, events[0]!.eventId],
    );
    await expect(
      p.query(`select edge_sync.requeue_dead_letter($1::uuid, $2::uuid, 'why', 0)`, [
        fake.rows[0]!.id,
        ACTOR_MANAGER,
      ]),
    ).rejects.toThrow(/NOT-DEAD-LETTERED/);
  });
});
