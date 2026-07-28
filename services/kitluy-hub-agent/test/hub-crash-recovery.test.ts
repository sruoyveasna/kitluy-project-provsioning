/**
 * Hub CRASH RECOVERY (WS-09-T005 / T006 test matrix).
 *
 * HOW A CRASH IS SIMULATED — honestly, never by mocking a success path:
 *
 *   - "crash before commit"  the command runs the REAL pipeline (authorisation,
 *     idempotency reservation, business write, event + outbox write). Inside the
 *     open transaction the handler publishes its PostgreSQL backend pid and then
 *     blocks on `pg_sleep`. A second connection calls `pg_terminate_backend` on
 *     that pid: PostgreSQL kills the server process and aborts its transaction.
 *     Nothing is stubbed — the writes really happened and were really lost.
 *
 *   - "connection loss mid-command"  the same pipeline, but the client-side
 *     socket is destroyed from the agent side (the LAN link dropped), so the
 *     transaction is aborted by the server when the connection disappears.
 *
 *   - "crash after commit, before response"  a watcher on a second connection
 *     polls `edge_sync.command_result`; that row becomes visible ONLY at commit,
 *     so the instant it appears the watcher terminates every Hub backend and the
 *     pool is destroyed. The in-flight response is discarded and never asserted
 *     on — the assertions use only the retry and the durable rows.
 *
 * SKIPS VISIBLY when the local Hub database is unreachable; a skipped run is
 * never reported as executed evidence (KLD-EVIDENCE-001).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import {
  createHubPool,
  withHubTransaction,
  withSerializableHubTransaction,
} from "../src/hub/db.js";
import { HubCommandError } from "../src/hub/errors.js";
import { executeHubCommand, type HubHandlerResult } from "../src/hub/command-pipeline.js";
import { requireActiveHubCommand } from "../src/hub/command-registry.js";
import {
  canonicalRequestHash,
  completeCommand,
  loadCommandResult,
  reserveOrLoadCommand,
} from "../src/hub/idempotency.js";
import { laundryRepo } from "../src/hub/repositories/index.js";
import { loadStoreMoneyContract } from "../src/hub/commands/shared.js";
import { statusForLifecycleState } from "../src/hub/booking-status.js";
import { uuidv7 } from "../src/hub/uuid.js";
import { createBookingDraft, registerGarment } from "../src/hub/commands/booking-commands.js";
import {
  ACTOR_CASHIER,
  LOCATION,
  STORE,
  T1,
  TENANT,
  TEST_LOCATION_CODE,
  businessDate,
  countRows,
  deviceContext,
  ensureRuntimeRoleMembership,
  hubReachable,
  nextCommandKey,
  pool,
  provisionTerminal,
  terminateBackend,
  type CommandKey,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const SUITE = "crash";
const available = await hubReachable();
if (!available) {
  console.warn(
    "SKIPPED kitluy-hub-agent crash-recovery suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

const DRAFT_COMMAND = "laundry.booking.create_draft";

describe.skipIf(!available)("Store Hub crash recovery", () => {
  /** Observer connection — never the one that is killed. */
  let admin: pg.Pool;
  let t1: ProvisionedTerminal;
  let today: string;

  beforeAll(async () => {
    admin = pool();
    admin.on("error", () => undefined);
    await ensureRuntimeRoleMembership(admin);
    today = await businessDate(admin);
    t1 = await provisionTerminal(admin, SUITE, T1, ACTOR_CASHIER);
  });

  afterAll(async () => {
    await admin.end().catch(() => undefined);
  });

  /**
   * A killed backend surfaces as an 'error' on the pool AND on the individual
   * client. Both are absorbed here: the failure is the one this suite is
   * deliberately causing, and an unhandled listener would abort the run for it.
   */
  function harden(hub: pg.Pool): pg.Pool {
    hub.on("error", () => undefined);
    hub.on("connect", (client) => client.on("error", () => undefined));
    return hub;
  }

  function hubProcess(): pg.Pool {
    return harden(pool());
  }

  /**
   * The REAL pipeline running the REAL draft writes, stalled inside its open
   * transaction so the test can kill it mid-command.
   */
  function stalledDraft(
    hub: pg.Pool,
    key: CommandKey,
    bookingId: string,
    onStalled: (pid: number) => void,
  ): Promise<unknown> {
    return executeHubCommand(
      hub,
      {
        commandType: DRAFT_COMMAND,
        device: deviceContext(t1),
        idempotencyKey: key.idempotencyKey,
        clientSequence: key.clientSequence,
        businessDate: today,
        body: {
          location_code: TEST_LOCATION_CODE,
          customer_id: null,
          pickup_method: "store_pickup",
          due_at: null,
        },
      },
      async (execution) => {
        const { client, auth } = execution;
        const contract = await loadStoreMoneyContract(client, auth.device.locationId);
        const sequence = await laundryRepo.allocateBusinessNumber(
          client,
          auth.device.locationId,
          "booking",
          execution.businessDate,
        );
        const bookingNumber = await laundryRepo.formatDisplayNumber(
          client,
          "KLB",
          TEST_LOCATION_CODE,
          execution.businessDate,
          sequence,
        );
        const status = statusForLifecycleState("DRAFT");
        await laundryRepo.insertBooking(client, {
          id: bookingId,
          tenantId: auth.device.tenantId,
          digitalStoreId: auth.device.digitalStoreId,
          locationId: auth.device.locationId,
          bookingNumber,
          customerId: null,
          status,
          businessDate: execution.businessDate,
          currencyCode: contract.currencyCode,
          currencyExponent: contract.currencyExponent,
          subtotalMinor: 0n,
          discountMinor: 0n,
          taxMinor: 0n,
          totalMinor: 0n,
          dueAt: null,
          pickupMethod: "store_pickup",
          configSnapshotId: contract.snapshotId,
        });
        await execution.recorder.record({
          aggregateType: "booking",
          aggregateId: bookingId,
          aggregateVersion: 1n,
          eventName: execution.definition.auditEvent,
          payload: { booking_id: bookingId, booking_number: bookingNumber, status },
        });

        const pid = (await client.query<{ pid: number }>(`select pg_backend_pid() as pid`)).rows[0]!
          .pid;
        onStalled(pid);
        // The kill lands here: the business row, the event and the outbox row
        // are all written but NOT yet committed.
        await client.query(`select pg_sleep(30)`);
        return {
          aggregateId: bookingId,
          aggregateVersion: 1n,
          resultJson: {},
          auditResourceType: "booking",
          auditResourceId: bookingId,
        } satisfies HubHandlerResult;
      },
    );
  }

  async function assertNothingSurvived(bookingId: string, key: CommandKey): Promise<void> {
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_laundry.booking where id = $1`,
        [bookingId],
      ),
    ).toBe(0);
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_sync.local_event where aggregate_id = $1`,
        [bookingId],
      ),
    ).toBe(0);
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_sync.outbox o
           join edge_sync.local_event e on e.id = o.event_id where e.aggregate_id = $1`,
        [bookingId],
      ),
    ).toBe(0);
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_audit.audit_event where resource_id = $1`,
        [bookingId],
      ),
    ).toBe(0);
  }

  it("CRASH BEFORE COMMIT leaves no partial business effect anywhere", async () => {
    const hub = hubProcess();
    try {
      const key = await nextCommandKey(admin, t1.terminalDeviceId);
      const bookingId = uuidv7();
      let killed: (pid: number) => void = () => undefined;
      const stalled = new Promise<number>((resolve) => {
        killed = resolve;
      });
      const command = stalledDraft(hub, key, bookingId, (pid) => killed(pid)).catch(
        (error: unknown) => error,
      );

      const gapsBefore = await countRows(
        admin,
        `select count(*)::text as count from edge_sync.sequence_gap where gap_reason = 'transaction_rollback'`,
      );
      // Reaching this point PROVES the Booking row, the local_event and the
      // outbox row were all written inside the still-open transaction: the pid
      // is published only after those writes.
      const pid = await stalled;
      // REAL server-side process kill; PostgreSQL aborts the open transaction.
      await terminateBackend(admin, pid);
      const outcome = await command;
      expect(outcome).toBeInstanceOf(Error);

      await assertNothingSurvived(bookingId, key);
      // Offline §5: the hub_sequence the dead command burnt is journalled as a
      // KNOWN gap, so a later sync batch never reads it as a missing event.
      expect(
        await countRows(
          admin,
          `select count(*)::text as count from edge_sync.sequence_gap where gap_reason = 'transaction_rollback'`,
        ),
      ).toBeGreaterThan(gapsBefore);
      // The command may still be retried: the reservation died with the crash.
      const retried = await createBookingDraft(admin, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      });
      expect(retried.outcome).toBe("accepted");
      expect(retried.aggregateId).not.toBe(bookingId);
    } finally {
      await hub.end().catch(() => undefined);
    }
  }, 30_000);

  it("CONNECTION LOSS mid-command leaves no partial business effect", async () => {
    const hub = hubProcess();
    try {
      const key = await nextCommandKey(admin, t1.terminalDeviceId);
      const bookingId = uuidv7();
      let stalledResolve: (pid: number) => void = () => undefined;
      const stalled = new Promise<number>((resolve) => {
        stalledResolve = resolve;
      });
      let socketKilled = false;
      const command = executeHubCommand(
        hub,
        {
          commandType: DRAFT_COMMAND,
          device: deviceContext(t1),
          idempotencyKey: key.idempotencyKey,
          clientSequence: key.clientSequence,
          businessDate: today,
          body: {
            location_code: TEST_LOCATION_CODE,
            customer_id: null,
            pickup_method: "store_pickup",
            due_at: null,
          },
        },
        async (execution) => {
          const { client, auth } = execution;
          const contract = await loadStoreMoneyContract(client, auth.device.locationId);
          const sequence = await laundryRepo.allocateBusinessNumber(
            client,
            auth.device.locationId,
            "booking",
            execution.businessDate,
          );
          const bookingNumber = await laundryRepo.formatDisplayNumber(
            client,
            "KLB",
            TEST_LOCATION_CODE,
            execution.businessDate,
            sequence,
          );
          await laundryRepo.insertBooking(client, {
            id: bookingId,
            tenantId: auth.device.tenantId,
            digitalStoreId: auth.device.digitalStoreId,
            locationId: auth.device.locationId,
            bookingNumber,
            customerId: null,
            status: statusForLifecycleState("DRAFT"),
            businessDate: execution.businessDate,
            currencyCode: contract.currencyCode,
            currencyExponent: contract.currencyExponent,
            subtotalMinor: 0n,
            discountMinor: 0n,
            taxMinor: 0n,
            totalMinor: 0n,
            dueAt: null,
            pickupMethod: "store_pickup",
            configSnapshotId: contract.snapshotId,
          });
          const pid = (await client.query<{ pid: number }>(`select pg_backend_pid() as pid`))
            .rows[0]!.pid;
          // Pull the LAN cable: destroy the agent-side socket for this client.
          const stream = (
            client as unknown as { connection?: { stream?: { destroy: () => void } } }
          ).connection?.stream;
          if (stream) {
            socketKilled = true;
            stream.destroy();
          }
          stalledResolve(pid);
          await client.query(`select pg_sleep(30)`);
          return {
            aggregateId: bookingId,
            aggregateVersion: 1n,
            resultJson: {},
            auditResourceType: "booking",
            auditResourceId: bookingId,
          } satisfies HubHandlerResult;
        },
      ).catch((error: unknown) => error);

      const pid = await stalled;
      // If the pg internals moved and the socket could not be destroyed, fall
      // back to a real backend kill rather than silently passing.
      if (!socketKilled) await terminateBackend(admin, pid);
      const outcome = await command;
      expect(socketKilled).toBe(true);
      expect(outcome).toBeInstanceOf(Error);
      await assertNothingSurvived(bookingId, key);
    } finally {
      await hub.end().catch(() => undefined);
    }
  }, 30_000);

  it("CRASH AFTER COMMIT, BEFORE RESPONSE: the retry returns the ORIGINAL result", async () => {
    // ONE connection, so the backend that will run the command is known in
    // advance and no other suite's connection can be caught by the kill.
    const hub = harden(createHubPool(process.env, 1));
    await ensureRuntimeRoleMembership(hub);
    const hubPid = (await hub.query<{ pid: number }>(`select pg_backend_pid() as pid`)).rows[0]!
      .pid;
    const key = await nextCommandKey(admin, t1.terminalDeviceId);

    // `command_result` becomes visible on this observer connection ONLY at
    // commit, so the first sighting proves the transaction committed. The Hub's
    // backend is then terminated and its in-flight response is discarded.
    const watcher = (async () => {
      const deadline = Date.now() + 20_000;
      for (;;) {
        const committed = await admin.query<{ n: string }>(
          `select count(*)::text as n from edge_sync.command_result
            where idempotency_key = $1 and commit_status = 'committed'`,
          [key.idempotencyKey],
        );
        if (Number(committed.rows[0]?.n ?? "0") > 0) {
          await terminateBackend(admin, hubPid).catch(() => undefined);
          return true;
        }
        if (Date.now() > deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    })();

    // The response of THIS call is deliberately discarded: the Hub crashed
    // before the terminal could receive it, so no assertion may depend on it.
    await createBookingDraft(hub, {
      device: deviceContext(t1),
      ...key,
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    }).catch(() => undefined);
    const crashed = await watcher;
    await hub.end().catch(() => undefined);

    // Ground truth comes from the durable ledger, not from the lost response.
    const stored = await withHubTransaction(admin, (client) =>
      loadCommandResult(client, key.idempotencyKey),
    );
    expect(stored?.commit_status).toBe("committed");
    expect(crashed).toBe(true);

    // The Hub restarts and the terminal retries with the SAME key.
    const restarted = hubProcess();
    try {
      const replay = await createBookingDraft(restarted, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      });
      expect(replay.outcome).toBe("duplicate");
      expect(replay.aggregateId).toBe(stored?.aggregate_id);
      expect(replay.aggregateVersion).toBe(stored?.aggregate_version);
      // ONE business effect, ONE command result, ONE event.
      expect(
        await countRows(
          admin,
          `select count(*)::text as count from edge_laundry.booking where id = $1`,
          [stored?.aggregate_id],
        ),
      ).toBe(1);
      expect(
        await countRows(
          admin,
          `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
          [key.idempotencyKey],
        ),
      ).toBe(1);
      expect(
        await countRows(
          admin,
          `select count(*)::text as count from edge_sync.local_event where aggregate_id = $1`,
          [stored?.aggregate_id],
        ),
      ).toBe(1);
    } finally {
      await restarted.end().catch(() => undefined);
    }
  }, 30_000);

  it("DUPLICATE RETRY after a lost response replays and writes nothing new", async () => {
    const key = await nextCommandKey(admin, t1.terminalDeviceId);
    const first = await createBookingDraft(admin, {
      device: deviceContext(t1),
      ...key,
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    const eventsBefore = await countRows(
      admin,
      `select count(*)::text as count from edge_sync.local_event where aggregate_id = $1`,
      [first.aggregateId],
    );
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const replay = await createBookingDraft(admin, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        locationCode: TEST_LOCATION_CODE,
        pickupMethod: "store_pickup",
      });
      expect(replay.outcome).toBe("duplicate");
      expect(replay.aggregateId).toBe(first.aggregateId);
      // A replay never claims a cloud outcome it has not received.
      expect(replay.wireSyncState).toBe("pending_cloud_sync");
    }
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_sync.local_event where aggregate_id = $1`,
        [first.aggregateId],
      ),
    ).toBe(eventsBefore);
  });

  it("answers an INCOMPLETE reservation with 202/in_progress and does not wedge the key", async () => {
    // TEST ARRANGEMENT of a state the single-transaction pipeline cannot itself
    // produce: a reservation that committed without its completion. Offline
    // contract §19 row 2 mandates the behaviour, so it is proven directly.
    const definition = requireActiveHubCommand(DRAFT_COMMAND);
    const key = await nextCommandKey(admin, t1.terminalDeviceId);
    const body = {
      location_code: TEST_LOCATION_CODE,
      customer_id: null,
      pickup_method: "store_pickup",
      due_at: null,
    };
    const requestHash = canonicalRequestHash({
      method: definition.method,
      routeTemplate: definition.routeTemplate,
      body,
      terminalDeviceId: t1.terminalDeviceId,
      sessionId: t1.sessionId,
      profileCode: t1.profileCode,
    });
    await withSerializableHubTransaction(admin, (client) =>
      reserveOrLoadCommand(client, {
        commandResultId: uuidv7(),
        tenantId: TENANT,
        digitalStoreId: STORE,
        locationId: LOCATION,
        terminalDeviceId: t1.terminalDeviceId,
        idempotencyKey: key.idempotencyKey,
        requestHash,
        commandType: definition.commandType,
        aggregateType: definition.aggregateType,
        actorId: ACTOR_CASHIER,
        originSequence: key.clientSequence,
        assignmentGeneration: 1,
        requestId: uuidv7(),
      }),
    );
    const reserved = await withHubTransaction(admin, (client) =>
      loadCommandResult(client, key.idempotencyKey),
    );
    expect(reserved?.commit_status).toBe("in_progress");
    // D6: no sync state is declared until an outcome exists.
    expect(reserved?.sync_state).toBeNull();

    // §19 row 2: "same key, same hash, in progress -> 202 accepted".
    const inFlight = await createBookingDraft(admin, {
      device: deviceContext(t1),
      ...key,
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    expect(inFlight.outcome).toBe("in_progress");
    expect(inFlight.aggregateId).toBeNull();
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_sync.local_event where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);

    // NOT WEDGED: the recovery path resolves the reservation exactly once, and
    // the key then answers with its stored terminal result.
    await withHubTransaction(admin, (client) =>
      completeCommand(client, {
        idempotencyKey: key.idempotencyKey,
        commitStatus: "failed",
        syncState: "reconciliation_required",
        aggregateId: null,
        aggregateVersion: null,
        eventIds: [],
        hubSequenceFirst: null,
        hubSequenceLast: null,
        errorCode: "EDGE_COMMAND_UNKNOWN",
        resultJson: { recovered: true, reason: "reservation abandoned by a crashed command" },
      }),
    );
    const resolved = await createBookingDraft(admin, {
      device: deviceContext(t1),
      ...key,
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    expect(resolved.outcome).toBe("duplicate");
    const finalRow = await withHubTransaction(admin, (client) =>
      loadCommandResult(client, key.idempotencyKey),
    );
    expect(finalRow?.commit_status).toBe("failed");
  });

  it("writes NOTHING when the expected aggregate version is stale after a crash-and-retry", async () => {
    const created = await createBookingDraft(admin, {
      device: deviceContext(t1),
      ...(await nextCommandKey(admin, t1.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });
    const bookingId = created.aggregateId as string;
    const key = await nextCommandKey(admin, t1.terminalDeviceId);
    let thrown: unknown;
    try {
      await registerGarment(admin, {
        device: deviceContext(t1),
        ...key,
        businessDate: today,
        bookingId,
        expectedVersion: 999n,
        garmentCode: `CRASH-${bookingId.slice(-10)}`,
        garmentType: "shirt",
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HubCommandError);
    expect((thrown as HubCommandError).code).toBe("EDGE_AGGREGATE_VERSION_CONFLICT");
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_laundry.garment where garment_code = $1`,
        [`CRASH-${bookingId.slice(-10)}`],
      ),
    ).toBe(0);
    expect(
      await countRows(
        admin,
        `select count(*)::text as count from edge_sync.command_result where idempotency_key = $1`,
        [key.idempotencyKey],
      ),
    ).toBe(0);
    const after = await admin.query<{ aggregate_version: bigint }>(
      `select aggregate_version from edge_laundry.booking where id = $1`,
      [bookingId],
    );
    expect(after.rows[0]?.aggregate_version).toBe(created.aggregateVersion);
  });
});
