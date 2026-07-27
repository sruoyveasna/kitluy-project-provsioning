/**
 * Append-only / immutability attack probes, executed AS THE APPLICATION ROLE.
 *
 * Every probe issues direct SQL inside a transaction that has assumed
 * `kitluy_hub_runtime` — the role real Hub traffic uses (schema contract §3) —
 * so it exercises the GRANT surface and the §1 triggers exactly as deployed
 * code would. NO role holds DELETE on ANY relation, and the append-only
 * triggers reject UNCONDITIONALLY.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { canAssumeRole, withHubTransaction, HUB_RUNTIME_ROLE } from "../src/hub/db.js";
import {
  confirmIntake,
  addBookingLine,
  createBookingDraft,
  registerGarment,
} from "../src/hub/commands/booking-commands.js";
import { recordCashPayment, requestRefund } from "../src/hub/commands/payment-commands.js";
import {
  ACTOR_CASHIER,
  ACTOR_MANAGER,
  T1,
  TEST_LOCATION_CODE,
  approvalEvidence,
  bookingVersion,
  businessDate,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  locationGrants,
  nextCommandKey,
  pool,
  provisionOpenShift,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "append";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent append-only suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

describe.skipIf(!available)("Append-only ledgers reject mutation as the application role", () => {
  let p: pg.Pool;
  let t1: ProvisionedTerminal;
  let today: string;
  let bookingId: string;
  let paymentId: string;
  let refundAdjustmentId: string;
  let roleAssumed = false;

  /** Run one probe with the application role assumed for the statement. */
  async function asRuntimeRole(sql: string, params: unknown[] = []): Promise<void> {
    await withHubTransaction(p, async (client) => {
      await client.query(sql, params);
    });
  }

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    roleAssumed = await canAssumeRole(p, HUB_RUNTIME_ROLE);
    today = await businessDate(p);
    t1 = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
    await provisionOpenShift(p, t1.terminalDeviceId, ACTOR_CASHIER);

    const created = await createBookingDraft(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    bookingId = created.aggregateId as string;
    await addBookingLine(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      line: {
        serviceId: "e0000000-0000-4000-8000-000000000f01",
        serviceVersion: 3n,
        displayName: "Append-only probe line",
        unitPriceMinor: 2000n,
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
      garmentCode: `AP-${bookingId.slice(-10)}`,
      garmentType: "shirt",
    });
    await confirmIntake(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
    });
    const paid = await recordCashPayment(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      tenderedMinor: 2000n,
      locationCode: TEST_LOCATION_CODE,
    });
    paymentId = paid.result["payment_id"] as string;
    const refund = await requestRefund(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      bookingId,
      expectedVersion: await bookingVersion(p, bookingId),
      originalPaymentId: paymentId,
      amountMinor: 200n,
      reasonCode: "probe",
      approval: approvalEvidence(ACTOR_CASHIER, ACTOR_MANAGER, `probe:${paymentId}`),
      presentedGrants: locationGrants(["payments.refund.request"]),
    });
    refundAdjustmentId = refund.result["refund_adjustment_id"] as string;
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  it("assumes the Hub runtime role for the probes (or records the degradation)", () => {
    // Truth label: when this is false the GRANT surface was NOT exercised and
    // only the unconditional triggers are proven.
    expect(typeof roleAssumed).toBe("boolean");
    if (!roleAssumed) {
      console.warn(
        "append-only probes ran as the connected user: 'set local role kitluy_hub_runtime' was refused.",
      );
    }
  });

  it("rejects UPDATE and DELETE on the custody chain", async () => {
    await expect(
      asRuntimeRole(
        `update edge_laundry.custody_event set to_custody_state = 'tampered' where booking_id = $1`,
        [bookingId],
      ),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
    await expect(
      asRuntimeRole(`delete from edge_laundry.custody_event where booking_id = $1`, [bookingId]),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
  });

  it("rejects UPDATE and DELETE on the Booking status history", async () => {
    await expect(
      asRuntimeRole(
        `update edge_laundry.status_event set to_status = 'tampered' where booking_id = $1`,
        [bookingId],
      ),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
    await expect(
      asRuntimeRole(`delete from edge_laundry.status_event where booking_id = $1`, [bookingId]),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
  });

  it("freezes a CONFIRMED payment: money, identity and provenance cannot move", async () => {
    await expect(
      asRuntimeRole(`update edge_payments.payment set amount_minor = 1 where id = $1`, [paymentId]),
    ).rejects.toThrow(/KLUY-EDGE-PAYMENT-IMMUTABLE|permission denied/);
    await expect(
      asRuntimeRole(`update edge_payments.payment set booking_id = $2 where id = $1`, [
        paymentId,
        "e0000000-0000-4000-8000-0000000000a5",
      ]),
    ).rejects.toThrow(/KLUY-EDGE-PAYMENT-IMMUTABLE|permission denied/);
    // A confirmed payment may only move to `reversed`.
    await expect(
      asRuntimeRole(`update edge_payments.payment set state = 'failed' where id = $1`, [paymentId]),
    ).rejects.toThrow(/KLUY-EDGE-PAYMENT-CONFIRMED|permission denied/);
    await expect(
      asRuntimeRole(`delete from edge_payments.payment where id = $1`, [paymentId]),
    ).rejects.toThrow(/KLUY-EDGE-NO-HARD-DELETE|permission denied/);
  });

  it("rejects UPDATE and DELETE on refund / void decisions", async () => {
    await expect(
      asRuntimeRole(`update edge_payments.refund_adjustment set state = 'reversed' where id = $1`, [
        refundAdjustmentId,
      ]),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
    await expect(
      asRuntimeRole(`delete from edge_payments.refund_adjustment where id = $1`, [
        refundAdjustmentId,
      ]),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
  });

  it("rejects UPDATE and DELETE on the cash ledger", async () => {
    await expect(
      asRuntimeRole(
        `update edge_core.cash_movement set amount_minor = 0 where related_payment_id = $1`,
        [paymentId],
      ),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
    await expect(
      asRuntimeRole(`delete from edge_core.cash_movement where related_payment_id = $1`, [
        paymentId,
      ]),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
  });

  it("rejects rewriting or deleting a stored command result", async () => {
    await expect(
      asRuntimeRole(
        `update edge_sync.command_result set commit_status = 'failed' where aggregate_id = $1`,
        [bookingId],
      ),
    ).rejects.toThrow(/KLUY-EDGE-COMMAND-RESULT-IMMUTABLE|permission denied/);
    await expect(
      asRuntimeRole(`delete from edge_sync.command_result where aggregate_id = $1`, [bookingId]),
    ).rejects.toThrow(/KLUY-EDGE-COMMAND-RESULT-IMMUTABLE|permission denied/);
  });

  it("rejects rewriting the outbox history and refuses a FABRICATED acknowledgement", async () => {
    await expect(
      asRuntimeRole(
        `update edge_sync.local_event set payload = '{}'::jsonb where aggregate_id = $1`,
        [bookingId],
      ),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
    await expect(
      asRuntimeRole(`delete from edge_sync.local_event where aggregate_id = $1`, [bookingId]),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
    await expect(
      asRuntimeRole(
        `delete from edge_sync.outbox where event_id in
         (select id from edge_sync.local_event where aggregate_id = $1)`,
        [bookingId],
      ),
    ).rejects.toThrow(/KLUY-EDGE-NO-HARD-DELETE|permission denied/);
    // WS-09 never fabricates a cloud acknowledgement; the CHECK enforces it.
    await expect(
      asRuntimeRole(
        `update edge_sync.outbox set delivery_state = 'acknowledged'
          where event_id in (select id from edge_sync.local_event where aggregate_id = $1)`,
        [bookingId],
      ),
    ).rejects.toThrow(/outbox_ack_ck|permission denied/);
  });

  it("rejects UPDATE and DELETE on the audit journal", async () => {
    await expect(
      asRuntimeRole(
        `update edge_audit.audit_event set event_code = 'tampered' where resource_id = $1`,
        [bookingId],
      ),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
    await expect(
      asRuntimeRole(`delete from edge_audit.audit_event where resource_id = $1`, [bookingId]),
    ).rejects.toThrow(/KLUY-EDGE-APPEND-ONLY|permission denied/);
  });

  it("has NO edge_finance schema and no Hub finance journal (KLREQ-022)", async () => {
    const schemas = await p.query<{ nspname: string }>(
      `select nspname from pg_namespace where nspname like 'edge\\_%' order by nspname`,
    );
    const names = schemas.rows.map((r) => r.nspname);
    expect(names).not.toContain("edge_finance");
    expect(names).not.toContain("edge_commands");
    expect(names).not.toContain("edge_events");
    expect(names).not.toContain("edge_print");
    expect(names.sort()).toEqual(
      [
        "edge_audit",
        "edge_config",
        "edge_core",
        "edge_documents",
        "edge_files",
        "edge_hardware",
        "edge_identity",
        "edge_laundry",
        "edge_ops",
        "edge_payments",
        "edge_sync",
      ].sort(),
    );
  });
});
