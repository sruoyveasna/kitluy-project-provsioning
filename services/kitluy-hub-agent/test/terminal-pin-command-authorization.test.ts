/**
 * The canonical command pipeline under a TERMINAL PIN session
 * (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001; slice 2), and the
 * assignment-generation semantics of decision 2
 * (KLREC-2026-09-19-ASSIGNMENT-GENERATION-SEMANTICS-001).
 *
 *   - the terminal device is the actor: no staff_cache row, the T1 grant plus
 *     the CLOSED T1 surface authorize it, and nothing outside that surface
 *     (a standalone cash capture, a refund) passes — whatever the command
 *     registry declares;
 *   - the presented generation is judged against the TERMINAL's own projected
 *     generation, not the Hub's: a terminal the cloud moved to generation 2
 *     operates while the Hub's own seat is still at 1, and a terminal
 *     presenting a generation it does not hold is refused.
 *
 * DB-backed; skips VISIBLY when the local Hub database is unreachable.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createBookingDraft } from "../src/hub/commands/booking-commands.js";
import { recordCashPayment } from "../src/hub/commands/payment-commands.js";
import { setupTerminalPin } from "../src/hub/edge/terminal-pin.js";
import { HubCommandError } from "../src/hub/errors.js";
import {
  T1,
  TEST_LOCATION_CODE,
  businessDate,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  nextCommandKey,
  pool,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "pincmd";
const available = await hubReachable();
if (!available) {
  console.warn("SKIPPED terminal-pin command authorization suite: local Hub database unreachable");
}

async function refusal(run: () => Promise<unknown>): Promise<HubCommandError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof HubCommandError) return error;
    throw error;
  }
  throw new Error("expected a HubCommandError refusal");
}

describe.skipIf(!available)("Hub commands under a Terminal PIN session", () => {
  let p: pg.Pool;
  let today: string;
  let terminal: ProvisionedTerminal;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
    // A terminal with NO staff session: the PIN opens the T1 session and the
    // session names the device as its actor.
    const provisioned = await provisionTerminal(p, SUITE, T1, randomUUID(), {
      openSession: false,
    });
    const pin = await setupTerminalPin(p, {
      terminalDeviceId: provisioned.terminalDeviceId,
      pin: "2468",
      pinConfirmation: "2468",
      correlationId: randomUUID(),
    });
    if (pin.outcome !== "ok") throw new Error(pin.refusal);
    terminal = {
      terminalDeviceId: provisioned.terminalDeviceId,
      sessionId: pin.value.session.sessionId,
      actorId: provisioned.terminalDeviceId,
      profileCode: T1,
    };
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  it("runs a T1-surface command with the device as actor and no staff projection", async () => {
    const { rows: staff } = await p.query(
      `select 1 from edge_identity.staff_cache where actor_id = $1`,
      [terminal.terminalDeviceId],
    );
    expect(staff).toEqual([]);
    const created = await createBookingDraft(p, {
      device: deviceContext(terminal),
      ...(await nextCommandKey(p, terminal.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    expect(created.outcome).toBe("accepted");
    const { rows: audit } = await p.query<{ actor_type: string; details: Record<string, unknown> }>(
      `select actor_type, details_json as details from edge_audit.audit_event
        where resource_id = $1 and event_code = 'laundry_booking.draft_created'`,
      [created.aggregateId],
    );
    expect(audit[0]?.actor_type).toBe("terminal_device");
    expect(audit[0]?.details["permission_source"]).toBe("terminal_pin");
    const { rows: fact } = await p.query<{ actor: string }>(
      `select payload -> 'actor' ->> 'actor_type' as actor from edge_sync.local_event
        where aggregate_id = $1`,
      [created.aggregateId],
    );
    expect(fact[0]?.actor).toBe("device");
  });

  it("refuses a command outside the T1 terminal surface, whatever the registry allows T1", async () => {
    const created = await createBookingDraft(p, {
      device: deviceContext(terminal),
      ...(await nextCommandKey(p, terminal.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    // payments.record_cash_payment allows the T1 profile, but its permission
    // (payments.capture.cash) is not in the PIN surface: a standalone cash
    // capture still needs a human actor (KLD-2026-09-03 §11). Cash AT INTAKE
    // rides inside confirm_from_draft instead (decision 1).
    const denied = await refusal(async () =>
      recordCashPayment(p, {
        device: deviceContext(terminal),
        ...(await nextCommandKey(p, terminal.terminalDeviceId)),
        businessDate: today,
        bookingId: created.aggregateId as string,
        expectedVersion: 1n,
        tenderedMinor: 100n,
        locationCode: TEST_LOCATION_CODE,
      }),
    );
    expect(denied.code).toBe("EDGE_PERMISSION_DENIED");
    expect(denied.details).toMatchObject({
      permission: "payments.capture.cash",
      credentialKind: "terminal_pin",
    });
  });

  it("refuses a PIN session presented with a different actor than the terminal", async () => {
    const denied = await refusal(async () =>
      createBookingDraft(p, {
        device: deviceContext(terminal, { actorId: randomUUID() }),
        ...(await nextCommandKey(p, terminal.terminalDeviceId)),
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
    expect(denied.code).toBe("EDGE_SESSION_INVALID");
  });

  it("judges the presented generation against the terminal's own, not the Hub's (decision 2)", async () => {
    // The cloud moved this terminal to generation 2; the Hub's own seat stays 1.
    await p.query(
      `update edge_identity.terminal_device set assignment_generation = 2 where id = $1`,
      [terminal.terminalDeviceId],
    );
    const { rows: hub } = await p.query<{ g: number }>(
      `select assignment_generation as g from edge_identity.hub_assignment
        where ended_at is null order by assignment_generation desc limit 1`,
    );
    expect(hub[0]?.g).toBe(1);
    const stale = await refusal(async () =>
      createBookingDraft(p, {
        device: deviceContext(terminal, { assignmentGeneration: 1 }),
        ...(await nextCommandKey(p, terminal.terminalDeviceId)),
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
    expect(stale.code).toBe("EDGE_ASSIGNMENT_GENERATION_MISMATCH");
    expect(stale.details).toMatchObject({ presented: 1, deviceGeneration: 2, hubGeneration: 1 });
    const current = await createBookingDraft(p, {
      device: deviceContext(terminal, { assignmentGeneration: 2 }),
      ...(await nextCommandKey(p, terminal.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    expect(current.outcome).toBe("accepted");
    // The events keep the HUB's generation as their ordering namespace (§5.1).
    const { rows: ns } = await p.query<{ g: number }>(
      `select assignment_generation as g from edge_sync.local_event where aggregate_id = $1`,
      [current.aggregateId],
    );
    expect(ns[0]?.g).toBe(1);
  });
});
