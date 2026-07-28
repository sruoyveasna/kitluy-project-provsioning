/**
 * WS-10-T005 — independent delivery-state and conflict-state transitions.
 *
 * Authority: owner amendment KLD-2026-07-28-001-A01 §3 and §5.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { HUB_SYNC_WORKER_ROLE, withHubTransaction } from "../src/hub/db.js";
import { HubCommandError } from "../src/hub/errors.js";
import { uuidv7 } from "../src/hub/uuid.js";
import { leaseOutboxBatch } from "../src/hub/sync/outbox-lease.js";
import { applyOutcome } from "../src/hub/sync/delivery-outcome.js";
import {
  OPERATOR_CLEARANCE_PERMISSION,
  clearReconciliationByGovernedAutomation,
  clearReconciliationByOperator,
  raiseReconciliation,
  readItemDimensions,
} from "../src/hub/sync/reconciliation.js";
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
  seedSyncConflict,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const available = await hubReachable();
if (!available) {
  console.warn("SKIPPED kitluy-hub-agent sync-reconciliation suite: Hub database unreachable");
}

describe("operator clearance is INACTIVE, not invented (KLREQ-029)", () => {
  it("fails closed carrying the [REQUIRED: ...] marker", () => {
    expect(OPERATOR_CLEARANCE_PERMISSION).toMatch(/^\[REQUIRED: /);
    expect(OPERATOR_CLEARANCE_PERMISSION).toContain("KLREQ-029");
    // It must NOT silently reuse a key that permits a different act.
    expect(OPERATOR_CLEARANCE_PERMISSION).toContain("fleet.sync.trigger");
    expect(() =>
      clearReconciliationByOperator({
        tenantId: TENANT,
        digitalStoreId: STORE,
        locationId: LOCATION,
        hubDeviceId: HUB_DEVICE,
        eventId: uuidv7(),
        actorId: ACTOR_MANAGER,
        reason: "checked by hand",
        resolutionEventId: uuidv7(),
      }),
    ).toThrow(HubCommandError);
  });
});

describe.skipIf(!available)("WS-10-T005 dimension independence", () => {
  let p: pg.Pool;
  let terminal: ProvisionedTerminal;
  let generation = 0;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    terminal = await provisionTerminal(p, "recon", T1, ACTOR_CASHIER);
    generation = await reserveSyncGenerationBlock(p, "inbox");
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

  const scope = {
    tenantId: TENANT,
    digitalStoreId: STORE,
    locationId: LOCATION,
    hubDeviceId: HUB_DEVICE,
  };

  it("raises the conflict dimension without moving the delivery dimension", async () => {
    const { gen, events } = await stream(1, "raise");
    const eventId = events[0]!.eventId;
    const lease = await withHubTransaction(p, (client) =>
      leaseOutboxBatch(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        leaseOwner: "worker-recon",
        leaseSeconds: 300,
      }),
    );
    expect(lease.items).toHaveLength(1);

    const conflictId = await seedSyncConflict(p, { localEventId: eventId });
    await withHubTransaction(p, (client) =>
      raiseReconciliation(client, {
        ...scope,
        eventId,
        conflictId,
        reason: "cloud reported a different applied amount",
      }),
    );

    const dimensions = await withHubTransaction(p, (client) => readItemDimensions(client, eventId));
    // Still in flight: raising a conflict does not abandon the attempt.
    expect(dimensions?.deliveryState).toBe("in_flight");
    expect(dimensions?.reconciliationState).toBe("required");
    // Conflict override wins the shared projection (§4).
    expect(dimensions?.externalStatus).toBe("reconciliation_required");
  });

  it("moves the delivery dimension without disturbing a raised conflict", async () => {
    const { gen, events } = await stream(1, "deliver-under-conflict");
    const eventId = events[0]!.eventId;
    const lease = await withHubTransaction(p, (client) =>
      leaseOutboxBatch(client, {
        locationId: LOCATION,
        assignmentGeneration: gen,
        leaseOwner: "worker-recon",
        leaseSeconds: 300,
      }),
    );
    const conflictId = await seedSyncConflict(p, { localEventId: eventId });
    await withHubTransaction(p, (client) =>
      raiseReconciliation(client, { ...scope, eventId, conflictId, reason: "divergence" }),
    );

    // A REAL cloud acknowledgement still lands. The two facts — "the cloud
    // accepted it" and "the effect diverges" — are both true at once, which is
    // exactly why the dimensions are separate.
    await withHubTransaction(p, (client) =>
      applyOutcome(client, {
        eventId,
        leaseId: lease.leaseId,
        routing: { kind: "acknowledge", cloudAckId: "cloud-ack-under-conflict" },
      }),
    );

    const row = await outboxRow(p, eventId);
    expect(row.delivery_state).toBe("acknowledged");
    expect(row.cloud_ack_id).toBe("cloud-ack-under-conflict");
    expect(row.reconciliation_state).toBe("required");
    expect(row.reconciliation_conflict_id).toBe(conflictId);
    // Conflict override still wins over an acknowledgement.
    expect(row.external_status).toBe("reconciliation_required");
  });

  it("refuses a bare clearance from the SYNC WORKER role", async () => {
    const { events } = await stream(1, "worker-cannot-clear");
    const eventId = events[0]!.eventId;
    const conflictId = await seedSyncConflict(p, { localEventId: eventId });
    await withHubTransaction(p, (client) =>
      raiseReconciliation(client, { ...scope, eventId, conflictId, reason: "divergence" }),
    );

    // The delivery worker holds UPDATE on edge_sync, so this is the attempt the
    // amendment actually forbids — and it is refused structurally, not by
    // convention.
    await expect(
      withHubTransaction(
        p,
        (client) =>
          client.query(
            `update edge_sync.outbox set reconciliation_state = 'none' where event_id = $1`,
            [eventId],
          ),
        HUB_SYNC_WORKER_ROLE,
      ),
    ).rejects.toThrow(/RECONCILIATION-GOVERNED/);

    // …and the sync worker cannot call the governed clearing procedure either.
    await expect(
      withHubTransaction(
        p,
        (client) =>
          client.query(
            `select edge_sync.clear_reconciliation($1::uuid, null, 'worker', 'because', $2::uuid)`,
            [eventId, eventId],
          ),
        HUB_SYNC_WORKER_ROLE,
      ),
    ).rejects.toThrow(/permission denied/i);

    expect((await outboxRow(p, eventId)).reconciliation_state).toBe("required");
  });

  it("clears under governed automated authority, with immutable audit", async () => {
    const { events } = await stream(1, "automated-clearance");
    const eventId = events[0]!.eventId;
    const conflictId = await seedSyncConflict(p, { localEventId: eventId });
    await withHubTransaction(p, (client) =>
      raiseReconciliation(client, { ...scope, eventId, conflictId, reason: "divergence" }),
    );

    const governingDeliveryId = uuidv7();
    await withHubTransaction(p, (client) =>
      clearReconciliationByGovernedAutomation(client, {
        ...scope,
        eventId,
        governingDeliveryId,
        policyReference: "KLPOL-SYNC-RECON-DEV",
        reason: "cloud reconciliation matched the compensating adjustment",
        resolutionEventId: eventId,
      }),
    );

    const row = await outboxRow(p, eventId);
    expect(row.reconciliation_state).toBe("cleared");
    // No actor: the authority is the signed cloud decision, and it is named.
    expect(row.external_status).toBe("pending_cloud_sync");

    const dimensions = await withHubTransaction(p, (client) => readItemDimensions(client, eventId));
    expect(dimensions?.clearedAuthority).toContain("KLPOL-SYNC-RECON-DEV");
    expect(dimensions?.clearedAuthority).toContain(governingDeliveryId);

    // The audit row records BOTH dimensions, before and after.
    const audit = await p.query<{ details_json: Record<string, unknown>; event_code: string }>(
      `select event_code, details_json from edge_audit.audit_event
        where resource_id = $1 and event_code = 'sync.reconciliation_cleared'`,
      [eventId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.details_json).toMatchObject({
      reconciliation_state_before: "required",
      reconciliation_state_after: "cleared",
      delivery_state_before: "pending",
      delivery_state_after: "pending",
      authority: "governed_automated_reconciliation",
    });

    // …and it is immutable.
    await expect(
      p.query(`update edge_audit.audit_event set reason_code = 'x' where resource_id = $1`, [
        eventId,
      ]),
    ).rejects.toThrow(/APPEND-ONLY/);
  });

  it("refuses an automated clearance with no governing authority", async () => {
    const { events } = await stream(1, "no-authority");
    const eventId = events[0]!.eventId;
    const conflictId = await seedSyncConflict(p, { localEventId: eventId });
    await withHubTransaction(p, (client) =>
      raiseReconciliation(client, { ...scope, eventId, conflictId, reason: "divergence" }),
    );

    for (const bad of [
      { governingDeliveryId: "", policyReference: "KLPOL" },
      { governingDeliveryId: uuidv7(), policyReference: "" },
    ]) {
      await expect(
        withHubTransaction(p, (client) =>
          clearReconciliationByGovernedAutomation(client, {
            ...scope,
            eventId,
            reason: "because",
            resolutionEventId: eventId,
            ...bad,
          }),
        ),
      ).rejects.toThrow(/requires/);
    }
    expect((await outboxRow(p, eventId)).reconciliation_state).toBe("required");
  });

  it("re-raises only against a NEW conflict record", async () => {
    const { events } = await stream(1, "re-raise");
    const eventId = events[0]!.eventId;
    const first = await seedSyncConflict(p, { localEventId: eventId });
    await withHubTransaction(p, (client) =>
      raiseReconciliation(client, { ...scope, eventId, conflictId: first, reason: "one" }),
    );
    await withHubTransaction(p, (client) =>
      clearReconciliationByGovernedAutomation(client, {
        ...scope,
        eventId,
        governingDeliveryId: uuidv7(),
        policyReference: "KLPOL-SYNC-RECON-DEV",
        reason: "resolved",
        resolutionEventId: eventId,
      }),
    );

    await expect(
      withHubTransaction(p, (client) =>
        raiseReconciliation(client, { ...scope, eventId, conflictId: first, reason: "again" }),
      ),
    ).rejects.toThrow(/STALE-CONFLICT/);

    const second = await seedSyncConflict(p, { localEventId: eventId });
    await withHubTransaction(p, (client) =>
      raiseReconciliation(client, { ...scope, eventId, conflictId: second, reason: "new one" }),
    );
    expect((await outboxRow(p, eventId)).reconciliation_state).toBe("required");
  });
});

/**
 * Regression tests for independent review finding RV-001
 * (`00_AI_HANDOFF/reviews/2026-07-28__WS-10-SYNC__REVIEW.md`).
 *
 * The 0015 trigger gated on `current_setting('kitluy.reconciliation_governed')`
 * — a custom GUC that ANY role can set with `set_config()`. The reviewer
 * reproduced the forge; so did I before writing the fix. Migration 0024 moves
 * the gate to the EXECUTING IDENTITY, which a caller cannot produce.
 *
 * These reproduce the attack VERBATIM rather than testing the fix's mechanism,
 * so the tests stay meaningful if the mechanism changes again.
 */
describe.skipIf(!available)("RV-001 regression — the governed marker is unforgeable", () => {
  let p: pg.Pool;
  let terminal: ProvisionedTerminal;
  let generation = 0;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    terminal = await provisionTerminal(p, "rv001", T1, ACTOR_CASHIER);
    generation = await reserveSyncGenerationBlock(p, "lease");
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  async function raised(): Promise<string> {
    generation += 1;
    const [event] = await seedOutboxStream(p, {
      generation,
      count: 1,
      terminalDeviceId: terminal.terminalDeviceId,
      suite: "rv001",
    });
    const conflictId = await seedSyncConflict(p, { localEventId: event!.eventId });
    await p.query(`select edge_sync.raise_reconciliation($1::uuid, $2::uuid, 'divergence')`, [
      event!.eventId,
      conflictId,
    ]);
    return event!.eventId;
  }

  const forge = (eventId: string) => `
    select set_config('kitluy.reconciliation_governed', 'on', true);
    update edge_sync.outbox
       set reconciliation_state = 'cleared', reconciliation_cleared_at = now(),
           reconciliation_cleared_authority = 'FORGED',
           reconciliation_clearing_reason = 'forged',
           reconciliation_clearing_event_id = '${eventId}'
     where event_id = '${eventId}';`;

  it("refuses the forge from the SYNC WORKER, the role the amendment names", async () => {
    const eventId = await raised();
    await expect(
      withHubTransaction(p, (client) => client.query(forge(eventId)), HUB_SYNC_WORKER_ROLE),
    ).rejects.toThrow(/RECONCILIATION-GOVERNED/);
    expect((await outboxRow(p, eventId)).reconciliation_state).toBe("required");
  });

  it("refuses the forge from the DATABASE OWNER too — the functions are the only door", async () => {
    const eventId = await raised();
    await expect(p.query(forge(eventId))).rejects.toThrow(/RECONCILIATION-GOVERNED/);
    expect((await outboxRow(p, eventId)).reconciliation_state).toBe("required");
  });

  it("still lets the GOVERNED path through", async () => {
    const eventId = await raised();
    await p.query(
      `select edge_sync.clear_reconciliation($1::uuid, null, 'automation:KLPOL-DEV:delivery:x',
                                             'resolved', $2::uuid)`,
      [eventId, eventId],
    );
    expect((await outboxRow(p, eventId)).reconciliation_state).toBe("cleared");
  });

  it("keeps the governor role unassumable — its membership is granted to nobody", async () => {
    const members = await p.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members m
         join pg_roles r on r.oid = m.roleid
        where r.rolname = 'kitluy_reconciliation_governor'`,
    );
    expect(Number(members.rows[0]!.n)).toBe(0);
    const login = await p.query<{ rolcanlogin: boolean }>(
      `select rolcanlogin from pg_roles where rolname = 'kitluy_reconciliation_governor'`,
    );
    expect(login.rows[0]!.rolcanlogin).toBe(false);
  });
});
