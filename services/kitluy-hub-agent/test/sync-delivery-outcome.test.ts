/**
 * WS-10-T004 — acknowledgement, rejection, retry/backoff and dead-letter.
 *
 * Authority: Store Hub spec §11.5, schema contract §6.8, owner amendment
 * KLD-2026-07-28-001-A01 §2 and §3.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { withHubTransaction } from "../src/hub/db.js";
import { uuidv7 } from "../src/hub/uuid.js";
import { leaseOutboxBatch } from "../src/hub/sync/outbox-lease.js";
import { prepareSignedBatch } from "../src/hub/sync/transmission.js";
import { DevelopmentHmacBatchSigner } from "../src/hub/sync/signing.js";
import {
  DEFAULT_RETRY_POLICY,
  advanceSyncCursor,
  applyBatchResponse,
  applyOutcome,
  classifyOutcome,
  recordDeliveryConflict,
} from "../src/hub/sync/delivery-outcome.js";
import {
  ACTOR_CASHIER,
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

const signer = new DevelopmentHmacBatchSigner(
  "dev-key-1",
  Buffer.from("development-only-batch-signing-key-not-a-secret-0123456789", "utf8"),
);

const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent sync-delivery-outcome suite: local Hub database unreachable",
  );
}

describe("outcome routing (pure)", () => {
  const applied = { eventId: "e-1", outcome: "applied" as const, cloudAckId: "cloud-1" };

  it("acknowledges only when the cloud supplied its OWN identity", () => {
    expect(classifyOutcome(applied, 1)).toEqual({ kind: "acknowledge", cloudAckId: "cloud-1" });
    expect(
      classifyOutcome({ eventId: "e-1", outcome: "duplicate_ignored", cloudAckId: "cloud-1" }, 1),
    ).toEqual({ kind: "acknowledge", cloudAckId: "cloud-1" });
  });

  it("DEFERS an 'applied' with no acknowledgement identity rather than fabricating one", () => {
    expect(classifyOutcome({ eventId: "e-1", outcome: "applied" }, 1)).toEqual({
      kind: "defer",
      code: "EDGE_ACK_IDENTITY_MISSING",
    });
    expect(classifyOutcome({ eventId: "e-1", outcome: "applied", cloudAckId: "" }, 1)).toEqual({
      kind: "defer",
      code: "EDGE_ACK_IDENTITY_MISSING",
    });
  });

  it("records a DURABLE rejection as a rejection, at any attempt count", () => {
    const durable = {
      eventId: "e-1",
      outcome: "rejected" as const,
      rejectionCode: "EDGE_CLOUD_REJECTED_BUSINESS_RULE",
      rejectionReason: "Booking already closed.",
    };
    expect(classifyOutcome(durable, 1).kind).toBe("reject");
    expect(classifyOutcome(durable, 99).kind).toBe("reject");
  });

  it("never turns a transport failure into a cloud verdict", () => {
    for (const code of [
      "EDGE_TRANSPORT_TIMEOUT",
      "EDGE_TRANSPORT_UNREACHABLE",
      "EDGE_CLOUD_RATE_LIMITED",
      "EDGE_OPERATOR_PAUSED",
      "SOMETHING_NOBODY_CLASSIFIED",
    ]) {
      const routing = classifyOutcome(
        { eventId: "e-1", outcome: "rejected", rejectionCode: code },
        1,
      );
      expect(routing.kind, code).toBe("defer");
    }
  });

  it("dead-letters only when retries are exhausted, and never an acknowledgement", () => {
    const transient = {
      eventId: "e-1",
      outcome: "rejected" as const,
      rejectionCode: "EDGE_TRANSPORT_TIMEOUT",
    };
    expect(classifyOutcome(transient, DEFAULT_RETRY_POLICY.maxAttempts - 1).kind).toBe("defer");
    const exhausted = classifyOutcome(transient, DEFAULT_RETRY_POLICY.maxAttempts);
    expect(exhausted.kind).toBe("dead_letter");
    // The reason states that NO cloud verdict was observed.
    expect(exhausted.kind === "dead_letter" && exhausted.reason).toMatch(/No cloud verdict/);
    // An acknowledgement is never overridden by an attempt count.
    expect(classifyOutcome(applied, 9999).kind).toBe("acknowledge");
  });
});

describe.skipIf(!available)("WS-10-T004 delivery outcomes against the Hub database", () => {
  let p: pg.Pool;
  let terminal: ProvisionedTerminal;
  let generation = 0;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    terminal = await provisionTerminal(p, "outcome", T1, ACTOR_CASHIER);
    generation = await reserveSyncGenerationBlock(p, "acknowledgement");
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  async function leased(count: number, suite: string) {
    generation += 1;
    const gen = generation;
    const events = await seedOutboxStream(p, {
      generation: gen,
      count,
      terminalDeviceId: terminal.terminalDeviceId,
      suite,
    });
    const batchId = uuidv7();
    const { lease, signed } = await withHubTransaction(p, async (client) => {
      const claimed = await leaseOutboxBatch(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        leaseOwner: "worker-outcome",
      });
      return {
        lease: claimed,
        signed: await prepareSignedBatch(client, { batchId, lease: claimed, signer }),
      };
    });
    return { gen, events, lease, signed, batchId };
  }

  const conflictFactory = (eventId: string, reason: string) =>
    withHubTransaction(p, (client) =>
      recordDeliveryConflict(client, {
        eventId,
        tenantId: TENANT,
        digitalStoreId: STORE,
        locationId: LOCATION,
        dataClass: "finance_payment",
        reason,
      }),
    );

  it("records a REAL acknowledgement and refuses one without a cloud identity", async () => {
    const { events, lease } = await leased(1, "ack");
    const eventId = events[0]!.eventId;

    await expect(
      withHubTransaction(p, (client) =>
        applyOutcome(client, {
          eventId,
          leaseId: lease.leaseId,
          routing: { kind: "acknowledge", cloudAckId: "" },
        }),
      ),
    ).rejects.toThrow(/ACK-IDENTITY-REQUIRED/);

    await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: { kind: "acknowledge", cloudAckId: "cloud-ack-real" },
      }),
    );

    const row = await outboxRow(p, eventId);
    expect(row.delivery_state).toBe("acknowledged");
    expect(row.cloud_ack_id).toBe("cloud-ack-real");
    expect(row.acknowledged_at).not.toBeNull();
    expect(row.external_status).toBe("cloud_acknowledged");
    expect(row.lease_owner).toBeNull();
  });

  it("refuses an acknowledgement that does not match the attempt that earned it", async () => {
    const { events } = await leased(1, "ack-lease");
    await expect(
      withHubTransaction(p, (client) =>
        applyOutcome(client, {
          eventId: events[0]!.eventId,
          leaseId: "33333333-3333-4333-8333-333333333333",
          routing: { kind: "acknowledge", cloudAckId: "cloud-ack" },
        }),
      ),
    ).rejects.toThrow(/ACK-UNMATCHED-LEASE/);
  });

  it("records a durable rejection and refuses a transport code as one", async () => {
    const { events, lease } = await leased(1, "reject");
    const eventId = events[0]!.eventId;

    await expect(
      p.query(`select edge_sync.reject_outbox_event($1::uuid, $2::uuid, $3::text, null)`, [
        eventId,
        lease.leaseId,
        "EDGE_TRANSPORT_TIMEOUT",
      ]),
    ).rejects.toThrow(/REJECTION-NOT-DURABLE/);

    await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: {
          kind: "reject",
          code: "EDGE_CLOUD_REJECTED_BUSINESS_RULE",
          reason: "Booking already closed.",
        },
      }),
    );

    const row = await outboxRow(p, eventId);
    expect(row.delivery_state).toBe("rejected");
    expect(row.rejected_at).not.toBeNull();
    expect(row.last_error_code).toBe("EDGE_CLOUD_REJECTED_BUSINESS_RULE");
    expect(row.external_status).toBe("cloud_rejected");
  });

  it("never rewrites a recorded cloud decision", async () => {
    const { events, lease } = await leased(1, "no-rewrite");
    const eventId = events[0]!.eventId;
    await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: { kind: "acknowledge", cloudAckId: "cloud-ack" },
      }),
    );
    await expect(
      p.query(`select edge_sync.reject_outbox_event($1::uuid, null, $2::text, null)`, [
        eventId,
        "EDGE_CLOUD_REJECTED_PERMANENT",
      ]),
    ).rejects.toThrow(/ACK-ALREADY-RECORDED/);
    await expect(
      p.query(`select edge_sync.dead_letter_outbox_event($1::uuid, null, 'x', 'y', $2::uuid)`, [
        eventId,
        uuidv7(),
      ]),
    ).rejects.toThrow(/ACK-ALREADY-RECORDED/);
  });

  it("re-reports an acknowledgement idempotently instead of erroring", async () => {
    const { events, lease } = await leased(1, "ack-replay");
    const eventId = events[0]!.eventId;
    const first = await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: { kind: "acknowledge", cloudAckId: "cloud-ack" },
      }),
    );
    const replay = await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: { kind: "acknowledge", cloudAckId: "cloud-ack" },
      }),
    );
    expect(first.changed).toBe(true);
    expect(replay.changed).toBe(false);
  });

  it("defers with growing backoff and claims no cloud outcome", async () => {
    const { events, lease } = await leased(1, "defer");
    const eventId = events[0]!.eventId;

    const deferred = await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: { kind: "defer", code: "EDGE_TRANSPORT_TIMEOUT" },
      }),
    );
    expect(deferred.nextAttemptAt).toBeInstanceOf(Date);

    const row = await outboxRow(p, eventId);
    expect(row.delivery_state).toBe("retry_wait");
    expect(row.last_error_code).toBe("EDGE_TRANSPORT_TIMEOUT");
    expect(row.cloud_ack_id).toBeNull();
    expect(row.rejected_at).toBeNull();
    // Amendment §3: retry_wait projects to retry_scheduled, not pending_cloud_sync.
    expect(row.external_status).toBe("retry_scheduled");
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to defer a durable rejection — it must be recorded as one", async () => {
    const { events, lease } = await leased(1, "defer-guard");
    await expect(
      p.query(
        `select edge_sync.defer_outbox_event($1::uuid, $2::uuid, $3::text, 5::integer, 900::integer)`,
        [events[0]!.eventId, lease.leaseId, "EDGE_CLOUD_REJECTED_SCHEMA"],
      ),
    ).rejects.toThrow(/DEFERRAL-NOT-TRANSIENT/);
  });

  it("dead-letters with an operator record AND a raised conflict — never a silent discard", async () => {
    const { events, lease } = await leased(1, "dead-letter");
    const eventId = events[0]!.eventId;

    await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: {
          kind: "dead_letter",
          code: "EDGE_TRANSPORT_UNREACHABLE",
          reason: "Delivery exhausted after 8 attempts; no cloud verdict was ever observed.",
        },
        conflictFactory,
      }),
    );

    const row = await outboxRow(p, eventId);
    expect(row.delivery_state).toBe("dead_letter");
    expect(row.dead_letter_reason).not.toBeNull();
    // The conflict dimension is raised, so the shared projection reports it as
    // requiring reconciliation rather than as quietly finished.
    expect(row.reconciliation_state).toBe("required");
    expect(row.reconciliation_conflict_id).not.toBeNull();
    expect(row.external_status).toBe("reconciliation_required");
    // …and the operator has a record to act on.
    const dead = await p.query<{ n: string }>(
      `select count(*)::text as n from edge_sync.dead_letter_item
        where source_kind = 'outbox' and source_id = $1 and operator_action_required`,
      [eventId],
    );
    expect(Number(dead.rows[0]!.n)).toBe(1);
  });

  it("dead-letters WITHOUT a conflict when delivery simply failed (amendment §2)", async () => {
    // §2 names `dead_letter + none` as a valid state: "delivery failed
    // repeatedly, but no authoritative business conflict has yet been
    // established". An earlier version REQUIRED a conflict and so made this
    // state unreachable.
    const { events, lease } = await leased(1, "dead-letter-no-conflict");
    const eventId = events[0]!.eventId;
    await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: { kind: "dead_letter", code: "EDGE_TRANSPORT_TIMEOUT", reason: "exhausted" },
      }),
    );

    const row = await outboxRow(p, eventId);
    expect(row.delivery_state).toBe("dead_letter");
    expect(row.reconciliation_state).toBe("none");
    // §3: dead_letter + none reports delivery_failed, NOT reconciliation_required.
    expect(row.external_status).toBe("delivery_failed");
    // The operator obligation is carried by the dead-letter record, which is
    // written either way.
    const dead = await p.query<{ n: string }>(
      `select count(*)::text as n from edge_sync.dead_letter_item
        where source_id = $1 and operator_action_required`,
      [eventId],
    );
    expect(Number(dead.rows[0]!.n)).toBe(1);
  });

  it("advances the cursor only to the CONTIGUOUSLY acknowledged sequence", async () => {
    const { events, lease, signed, batchId } = await leased(3, "cursor");
    const streamCode = `test-${batchId.slice(0, 8)}`;
    await withHubTransaction(p, (client) =>
      // The batch header must exist before it can be completed.
      import("../src/hub/sync/transmission.js").then((m) =>
        m.recordTransmissionBatch(client, signed, "worker-outcome"),
      ),
    );

    // Middle item durably rejected: the acknowledged cursor must stop at the
    // first item, not jump to the third.
    await withHubTransaction(p, (client) =>
      applyBatchResponse(client, {
        batch: signed,
        leaseId: lease.leaseId,
        cloudBatchId: "cloud-batch-1",
        streamCode,
        attemptCounts: new Map(events.map((e) => [e.eventId, 1])),
        outcomes: [
          { eventId: events[0]!.eventId, outcome: "applied", cloudAckId: "ack-1" },
          {
            eventId: events[1]!.eventId,
            outcome: "rejected",
            rejectionCode: "EDGE_CLOUD_REJECTED_BUSINESS_RULE",
            rejectionReason: "no",
          },
          { eventId: events[2]!.eventId, outcome: "applied", cloudAckId: "ack-3" },
        ],
      }),
    );

    const cursor = await p.query<{
      last_pushed_hub_sequence: bigint;
      last_acked_hub_sequence: bigint;
    }>(
      `select last_pushed_hub_sequence, last_acked_hub_sequence
         from edge_sync.sync_cursor where location_id = $1 and stream_code = $2`,
      [LOCATION, streamCode],
    );
    expect(cursor.rows[0]!.last_pushed_hub_sequence).toBe(events[2]!.hubSequence);
    expect(cursor.rows[0]!.last_acked_hub_sequence).toBe(events[0]!.hubSequence);

    // The batch ledger records the true tally.
    const header = await p.query<{
      outcome: string;
      applied_count: number;
      rejected_count: number;
    }>(
      `select outcome, applied_count, rejected_count from edge_sync.transmission_batch where id = $1`,
      [batchId],
    );
    expect(header.rows[0]).toMatchObject({
      outcome: "answered",
      applied_count: 2,
      rejected_count: 1,
    });
  });

  it("keeps the cursor monotonic so a late report cannot un-record progress", async () => {
    const streamCode = `monotonic-${uuidv7().slice(0, 8)}`;
    await withHubTransaction(p, (client) =>
      advanceSyncCursor(client, { locationId: LOCATION, streamCode, pushed: 50n, acked: 40n }),
    );
    await withHubTransaction(p, (client) =>
      advanceSyncCursor(client, { locationId: LOCATION, streamCode, pushed: 10n, acked: 5n }),
    );
    const cursor = await p.query<{
      last_pushed_hub_sequence: bigint;
      last_acked_hub_sequence: bigint;
    }>(
      `select last_pushed_hub_sequence, last_acked_hub_sequence
         from edge_sync.sync_cursor where location_id = $1 and stream_code = $2`,
      [LOCATION, streamCode],
    );
    expect(cursor.rows[0]!.last_pushed_hub_sequence).toBe(50n);
    expect(cursor.rows[0]!.last_acked_hub_sequence).toBe(40n);
  });

  it("refuses a cursor that acknowledges past what it pushed", async () => {
    const streamCode = `overrun-${uuidv7().slice(0, 8)}`;
    await expect(
      withHubTransaction(p, (client) =>
        advanceSyncCursor(client, { locationId: LOCATION, streamCode, pushed: 5n, acked: 99n }),
      ),
    ).rejects.toThrow(/sync_cursor_push_order_ck/);
  });
});
