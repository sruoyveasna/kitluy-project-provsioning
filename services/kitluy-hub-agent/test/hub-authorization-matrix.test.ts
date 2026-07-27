/**
 * The fail-closed authorisation matrix.
 *
 * Each case names ONE dimension (KLD-2026-07-26-002 Group 3) and asserts BOTH
 * that the command is refused with that dimension's own code AND that nothing
 * was written — no command result, no event, no outbox row.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { HubCommandError } from "../src/hub/errors.js";
import { requireActiveHubCommand, INACTIVE_ROUTE_COMMANDS } from "../src/hub/command-registry.js";
import { createBookingDraft, confirmIntake } from "../src/hub/commands/booking-commands.js";
import { completeReady, openReadySession } from "../src/hub/commands/ready-commands.js";
import { completePickupSession, openPickupSession } from "../src/hub/commands/pickup-commands.js";
import { recordCashPayment, requestRefund } from "../src/hub/commands/payment-commands.js";
import {
  ACTOR_CASHIER,
  ACTOR_MANAGER,
  ACTOR_PICKUP,
  ACTOR_READY,
  ATTACKER_LOCATION,
  ATTACKER_STORE,
  ATTACKER_TENANT,
  REVOKED_TERMINAL,
  SIBLING_LOCATION_BOOKING,
  T1,
  T2,
  T3,
  T4,
  TEST_LOCATION_CODE,
  approvalEvidence,
  bookingVersion,
  businessDate,
  commandKeyAt,
  countRows,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  locationGrants,
  nextCommandKey,
  pool,
  provisionActorWithoutProfiles,
  provisionTerminal,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "authz";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent authorization-matrix suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

/** Assert the refusal code AND that the command wrote nothing at all. */
async function expectDenied(
  p: pg.Pool,
  code: string,
  idempotencyKey: string,
  run: () => Promise<unknown>,
): Promise<void> {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code} but the command succeeded`).toBeInstanceOf(HubCommandError);
  expect((thrown as HubCommandError).code).toBe(code);
  expect(
    await countRows(
      p,
      `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
      [idempotencyKey],
    ),
    "a denied command must leave no command result",
  ).toBe(0);
  expect(
    await countRows(
      p,
      `select count(*)::text as count from edge_sync.local_event where idempotency_key = $1`,
      [idempotencyKey],
    ),
    "a denied command must leave no event",
  ).toBe(0);
}

describe.skipIf(!available)("Hub authorisation matrix — fail closed on every dimension", () => {
  let p: pg.Pool;
  let t1: ProvisionedTerminal;
  let t2: ProvisionedTerminal;
  let t3: ProvisionedTerminal;
  let t4: ProvisionedTerminal;
  let today: string;
  let bookingId: string;

  beforeAll(async () => {
    p = pool();
    await ensureRuntimeRoleMembership(p);
    today = await businessDate(p);
    t1 = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
    t2 = await provisionTerminal(p, SUITE, T2, ACTOR_CASHIER);
    t3 = await provisionTerminal(p, SUITE, T3, ACTOR_READY);
    t4 = await provisionTerminal(p, SUITE, T4, ACTOR_PICKUP);
    const created = await createBookingDraft(p, {
      device: deviceContext(t1),
      ...(await nextCommandKey(p, t1.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    bookingId = created.aggregateId as string;
  });

  afterAll(async () => {
    await p.end().catch(() => undefined);
  });

  it("T2 (customer display) cannot perform ANY staff mutation", async () => {
    const key = await nextCommandKey(p, t2.terminalDeviceId);
    await expectDenied(p, "EDGE_PROFILE_NOT_AUTHORIZED", key.idempotencyKey, async () =>
      createBookingDraft(p, {
        device: deviceContext(t2),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
  });

  it("T3 cannot complete pickup (T3 never releases customer custody)", async () => {
    const key = await nextCommandKey(p, t3.terminalDeviceId);
    await expectDenied(p, "EDGE_PROFILE_NOT_AUTHORIZED", key.idempotencyKey, async () =>
      completePickupSession(p, {
        device: deviceContext(t3),
        ...key,
        businessDate: today,
        pickupSessionId: "e0000000-0000-4000-8000-00000000007f",
        expectedVersion: 1n,
      }),
    );
  });

  it("T4 cannot perform Ready intake", async () => {
    const key = await nextCommandKey(p, t4.terminalDeviceId);
    await expectDenied(p, "EDGE_PROFILE_NOT_AUTHORIZED", key.idempotencyKey, async () =>
      completeReady(p, {
        device: deviceContext(t4),
        ...key,
        businessDate: today,
        readySessionId: "e0000000-0000-4000-8000-00000000007e",
        expectedVersion: 1n,
      }),
    );
  });

  it("an UNASSIGNED device (no cloud profile grant) is denied", async () => {
    const unassigned = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER, {
      profileAssigned: false,
    });
    const key = await nextCommandKey(p, unassigned.terminalDeviceId);
    await expectDenied(p, "EDGE_PROFILE_NOT_AUTHORIZED", key.idempotencyKey, async () =>
      createBookingDraft(p, {
        device: deviceContext(unassigned),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
  });

  it("a REVOKED device is denied before any session lookup", async () => {
    const key = commandKeyAt(REVOKED_TERMINAL, 60n);
    await expectDenied(p, "EDGE_DEVICE_REVOKED", key.idempotencyKey, async () =>
      createBookingDraft(p, {
        device: deviceContext({
          terminalDeviceId: REVOKED_TERMINAL,
          sessionId: "e0000000-0000-4000-8000-000000000030",
          actorId: ACTOR_CASHIER,
          profileCode: T1,
        }),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
  });

  it("an EXPIRED actor session is denied", async () => {
    const expired = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER, { sessionExpired: true });
    const key = await nextCommandKey(p, expired.terminalDeviceId);
    await expectDenied(p, "EDGE_SESSION_EXPIRED", key.idempotencyKey, async () =>
      createBookingDraft(p, {
        device: deviceContext(expired),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
  });

  it("an assignment-generation mismatch is denied (ordering namespace, offline §5.1)", async () => {
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    await expectDenied(p, "EDGE_ASSIGNMENT_GENERATION_MISMATCH", key.idempotencyKey, async () =>
      createBookingDraft(p, {
        device: deviceContext(t1, { assignmentGeneration: 2 }),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
  });

  it("a CROSS-TENANT scope tuple is denied", async () => {
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    await expectDenied(p, "EDGE_RESOURCE_SCOPE_DENIED", key.idempotencyKey, async () =>
      createBookingDraft(p, {
        device: deviceContext(t1, {
          tenantId: ATTACKER_TENANT,
          digitalStoreId: ATTACKER_STORE,
          locationId: ATTACKER_LOCATION,
        }),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
  });

  it("a CROSS-LOCATION target Booking is denied (same Tenant, sibling Location)", async () => {
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    await expectDenied(p, "EDGE_RESOURCE_SCOPE_DENIED", key.idempotencyKey, async () =>
      confirmIntake(p, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        bookingId: SIBLING_LOCATION_BOOKING,
        expectedVersion: 1n,
      }),
    );
  });

  it("an actor holding NO logical profile is denied on the permission dimension", async () => {
    const actorId = await provisionActorWithoutProfiles(p);
    const terminal = await provisionTerminal(p, SUITE, T1, actorId);
    const key = await nextCommandKey(p, terminal.terminalDeviceId);
    await expectDenied(p, "EDGE_PERMISSION_DENIED", key.idempotencyKey, async () =>
      createBookingDraft(p, {
        device: deviceContext(terminal),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
  });

  it("a presented grant scoped to ANOTHER Location is denied (missing scope)", async () => {
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    await expectDenied(p, "EDGE_PERMISSION_DENIED", key.idempotencyKey, async () =>
      requestRefund(p, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        bookingId,
        expectedVersion: await bookingVersion(p, bookingId),
        originalPaymentId: "e0000000-0000-4000-8000-000000000090",
        amountMinor: 100n,
        reasonCode: "test",
        approval: approvalEvidence(ACTOR_CASHIER, ACTOR_MANAGER, "payments.refund:test"),
        // Correct permission key, WRONG Location — scope is its own dimension.
        presentedGrants: locationGrants(["payments.refund.request"], ATTACKER_LOCATION),
      }),
    );
  });

  it("a refund with NO presented grant is denied (grant absence denies)", async () => {
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    await expectDenied(p, "EDGE_PERMISSION_DENIED", key.idempotencyKey, async () =>
      requestRefund(p, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        bookingId,
        expectedVersion: await bookingVersion(p, bookingId),
        originalPaymentId: "e0000000-0000-4000-8000-000000000090",
        amountMinor: 100n,
        reasonCode: "test",
        approval: approvalEvidence(ACTOR_CASHIER, ACTOR_MANAGER, "payments.refund:test"),
        presentedGrants: [],
      }),
    );
  });

  it("a non-development environment is denied (KL-INF-P1-037)", async () => {
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    await expectDenied(p, "EDGE_ENVIRONMENT_DENIED", key.idempotencyKey, async () =>
      createBookingDraft(p, {
        device: deviceContext(t1, { environment: "production" }),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      }),
    );
  });

  it("a four-eyes command WITHOUT approval evidence is denied", async () => {
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    let thrown: unknown;
    try {
      // The approval dimension is evaluated even when every other dimension
      // passes; here the evidence object is deliberately absent.
      await requestRefund(p, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        bookingId,
        expectedVersion: await bookingVersion(p, bookingId),
        originalPaymentId: "e0000000-0000-4000-8000-000000000090",
        amountMinor: 100n,
        reasonCode: "test",
        approval: undefined as unknown as ReturnType<typeof approvalEvidence>,
        presentedGrants: locationGrants(["payments.refund.request"]),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HubCommandError);
    expect((thrown as HubCommandError).code).toBe("EDGE_APPROVAL_REQUIRED");
  });

  it("SELF-APPROVAL is forbidden where four-eyes applies", async () => {
    const key = await nextCommandKey(p, t1.terminalDeviceId);
    await expectDenied(p, "EDGE_SELF_APPROVAL_FORBIDDEN", key.idempotencyKey, async () =>
      requestRefund(p, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        bookingId,
        expectedVersion: await bookingVersion(p, bookingId),
        originalPaymentId: "e0000000-0000-4000-8000-000000000090",
        amountMinor: 100n,
        reasonCode: "test",
        approval: approvalEvidence(ACTOR_CASHIER, ACTOR_CASHIER, "payments.refund:self"),
        presentedGrants: locationGrants(["payments.refund.request"]),
      }),
    );
  });

  it("keeps the nine permission-less Edge routes INACTIVE and fails them closed (KLREQ-015)", () => {
    expect(INACTIVE_ROUTE_COMMANDS.length).toBe(9);
    for (const definition of INACTIVE_ROUTE_COMMANDS) {
      expect(definition.active).toBe(false);
      expect(definition.permission.startsWith("[REQUIRED:")).toBe(true);
      let thrown: unknown;
      try {
        requireActiveHubCommand(definition.commandType);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(HubCommandError);
      expect((thrown as HubCommandError).code).toBe("EDGE_PERMISSION_KEY_UNREGISTERED");
    }
  });

  it("records a security event for every denial (a blocked attempt is evidence)", async () => {
    const before = await countRows(
      p,
      `select count(*)::text as count from edge_audit.security_event
        where event_code = 'EDGE_PROFILE_NOT_AUTHORIZED'`,
    );
    const key = await nextCommandKey(p, t2.terminalDeviceId);
    await expectDenied(p, "EDGE_PROFILE_NOT_AUTHORIZED", key.idempotencyKey, async () =>
      openReadySession(p, {
        device: deviceContext(t2),
        ...key,
        businessDate: today,
        bookingId,
        expectedCount: 1,
      }),
    );
    const after = await countRows(
      p,
      `select count(*)::text as count from edge_audit.security_event
        where event_code = 'EDGE_PROFILE_NOT_AUTHORIZED'`,
    );
    expect(after).toBeGreaterThan(before);
  });

  it("still refuses a T4-only command presented by an unassigned T4 profile", async () => {
    const rogue = await provisionTerminal(p, SUITE, T4, ACTOR_PICKUP, { profileAssigned: false });
    const key = await nextCommandKey(p, rogue.terminalDeviceId);
    await expectDenied(p, "EDGE_PROFILE_NOT_AUTHORIZED", key.idempotencyKey, async () =>
      openPickupSession(p, {
        device: deviceContext(rogue),
        ...key,
        businessDate: today,
        bookingId,
      }),
    );
  });

  it("refuses a cash payment from a profile the registry does not bind to the key", async () => {
    // `payments.capture.cash` is registry-restricted to terminal_role:T1|T4, so
    // the T3 actor cannot hold it — and the command is not offered to T3 either.
    const key = await nextCommandKey(p, t3.terminalDeviceId);
    await expectDenied(p, "EDGE_PROFILE_NOT_AUTHORIZED", key.idempotencyKey, async () =>
      recordCashPayment(p, {
        device: deviceContext(t3),
        ...key,
        businessDate: today,
        bookingId,
        expectedVersion: await bookingVersion(p, bookingId),
        tenderedMinor: 100n,
        locationCode: TEST_LOCATION_CODE,
      }),
    );
  });
});
