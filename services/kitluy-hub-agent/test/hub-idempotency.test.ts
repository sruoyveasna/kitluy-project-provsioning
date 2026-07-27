/**
 * Idempotency, sequencing and command-result behaviour (WS-09-T004).
 *
 * The ledger is DATABASE-AUTHORITATIVE: every assertion below is about rows in
 * `edge_sync.command_result`, never about an in-process cache.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { HubCommandError } from "../src/hub/errors.js";
import { loadCommandResult } from "../src/hub/idempotency.js";
import { withHubTransaction } from "../src/hub/db.js";
import { createBookingDraft } from "../src/hub/commands/booking-commands.js";
import {
  ACTOR_CASHIER,
  T1,
  TEST_LOCATION_CODE,
  businessDate,
  commandKeyAt,
  countRows,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  nextCommandKey,
  pool,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "idem";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent idempotency suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

describe.skipIf(!available)("Hub idempotency ledger and terminal sequencing", () => {
  let p: pg.Pool;
  let today: string;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  async function terminal(): Promise<ProvisionedTerminal> {
    return provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
  }

  function draft(
    t: ProvisionedTerminal,
    key: { idempotencyKey: string; clientSequence: bigint },
    pickupMethod = "store_pickup",
  ) {
    return createBookingDraft(p, {
      device: deviceContext(t),
      ...key,
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod,
    });
  }

  it("returns the ORIGINAL committed result for a duplicate after a lost response", async () => {
    const t = await terminal();
    const key = await nextCommandKey(p, t.terminalDeviceId);
    const first = await draft(t, key);
    expect(first.outcome).toBe("accepted");

    // The terminal never saw the response and retries with the SAME key.
    const second = await draft(t, key);
    expect(second.outcome).toBe("duplicate");
    expect(second.aggregateId).toBe(first.aggregateId);

    // ONE business effect, ONE command result, no second event.
    expect(
      await countRows(p, `select count(*)::text as count from edge_laundry.booking where id = $1`, [
        first.aggregateId,
      ]),
    ).toBe(1);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(1);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.local_event where aggregate_id = $1`,
        [first.aggregateId],
      ),
    ).toBe(1);

    const stored = await withHubTransaction(p, (client) =>
      loadCommandResult(client, key.idempotencyKey),
    );
    expect(stored?.commit_status).toBe("committed");
    // WS-09 records LOCAL truth only; it never fabricates a cloud outcome.
    expect(stored?.sync_state).toBe("committed_locally");
  });

  it("processes PARALLEL duplicate requests as exactly ONE business effect", async () => {
    const t = await terminal();
    const key = await nextCommandKey(p, t.terminalDeviceId);
    // Genuinely concurrent: both are in flight before either commits.
    const [a, b] = await Promise.all([draft(t, key), draft(t, key)]);
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["accepted", "duplicate"]);
    expect(a.aggregateId).toBe(b.aggregateId);
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(1);
    expect(
      await countRows(p, `select count(*)::text as count from edge_laundry.booking where id = $1`, [
        a.aggregateId,
      ]),
    ).toBe(1);
  });

  it("refuses the SAME key with a DIFFERENT canonical request and records evidence", async () => {
    const t = await terminal();
    const key = await nextCommandKey(p, t.terminalDeviceId);
    await draft(t, key, "store_pickup");

    const before = await countRows(
      p,
      `select count(*)::text as count from edge_audit.security_event
        where event_code = 'EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH'`,
    );
    let thrown: unknown;
    try {
      await draft(t, key, "delivery");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HubCommandError);
    expect((thrown as HubCommandError).code).toBe("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
    // The procedure's own security-event insert is rolled back with the failed
    // transaction, so the command layer records the evidence afterwards.
    const after = await countRows(
      p,
      `select count(*)::text as count from edge_audit.security_event
        where event_code = 'EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH'`,
    );
    expect(after).toBeGreaterThan(before);
  });

  it("rejects a REPLAYED (lower, unknown) terminal sequence", async () => {
    const t = await terminal();
    await draft(t, await nextCommandKey(p, t.terminalDeviceId));
    const replay = commandKeyAt(t.terminalDeviceId, 500n);
    let thrown: unknown;
    try {
      await draft(t, replay);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HubCommandError);
    expect((thrown as HubCommandError).code).toBe("EDGE_SEQUENCE_REPLAY_REJECTED");
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [replay.idempotencyKey],
      ),
    ).toBe(0);
  });

  it("rejects a SEQUENCE GAP and accepts the contiguous value afterwards (out-of-order)", async () => {
    const t = await terminal();
    const next = await nextCommandKey(p, t.terminalDeviceId);
    const skipped = commandKeyAt(t.terminalDeviceId, next.clientSequence + 2n);

    let thrown: unknown;
    try {
      await draft(t, skipped);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HubCommandError);
    expect((thrown as HubCommandError).code).toBe("EDGE_SEQUENCE_GAP");
    expect(
      await countRows(
        p,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [skipped.idempotencyKey],
      ),
    ).toBe(0);

    // The in-order command that the terminal skipped is still accepted.
    const inOrder = await draft(t, next);
    expect(inOrder.outcome).toBe("accepted");
  });

  it("refuses an idempotency key minted for a DIFFERENT terminal", async () => {
    const t = await terminal();
    const other = await terminal();
    const forged = commandKeyAt(other.terminalDeviceId, 1001n);
    let thrown: unknown;
    try {
      await draft(t, forged);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HubCommandError);
    expect((thrown as HubCommandError).code).toBe("EDGE_IDEMPOTENCY_KEY_MALFORMED");
  });

  it("refuses the NON-CANONICAL @kitluy/sync-protocol key shape (gap G1 / KLREQ-020)", async () => {
    const t = await terminal();
    let thrown: unknown;
    try {
      await createBookingDraft(p, {
        device: deviceContext(t),
        idempotencyKey:
          "location:e0000000-0000-4000-8000-000000000003:hub:e0000000-0000-4000-8000-000000000010:seq:7",
        clientSequence: 1001n,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HubCommandError);
    expect((thrown as HubCommandError).code).toBe("EDGE_IDEMPOTENCY_KEY_MALFORMED");
  });

  it("stores an IMMUTABLE command result that a later write cannot rewrite", async () => {
    const t = await terminal();
    const key = await nextCommandKey(p, t.terminalDeviceId);
    await draft(t, key);
    await expect(
      p.query(
        `update edge_sync.command_result set result_json = '{"tampered":true}'::jsonb
          where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).rejects.toThrow(/KLUY-EDGE-COMMAND-RESULT-IMMUTABLE/);
    await expect(
      p.query(`delete from edge_sync.command_result where idempotency_key = $1`, [
        key.idempotencyKey,
      ]),
    ).rejects.toThrow(/KLUY-EDGE-COMMAND-RESULT-IMMUTABLE/);
  });
});
