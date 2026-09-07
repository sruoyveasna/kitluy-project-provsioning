/**
 * THE DEPLOYED WORKER CLOSING A REAL, UNREVIEWED EMERGENCY.
 *
 * WS-11-T003 Step 4 §3.
 *
 * ===========================================================================
 * WHAT THIS PROVES THAT `lapse-worker.integration.test.ts` DOES NOT
 * ===========================================================================
 * That suite proves the worker LOGIC is correct: it hands a job to
 * `createEmergencyLapseWorker` and checks the result. Independent review pointed
 * out what it cannot prove -- that anything DEPLOYED ever calls it. Nothing did.
 * The route enqueued a lapse job on every emergency and, in a running process,
 * no one claimed it.
 *
 * That is not an ordinary missing wire-up. Lapsing is what closes an emergency
 * revocation NO SECOND HUMAN REVIEWED. With no worker running, an obligation
 * whose deadline passes stays PENDING for ever and the four-eyes rule silently
 * becomes "reviewed, or forgotten".
 *
 * So this file drives the whole chain end to end:
 *
 *   real human + real evidence
 *     -> emergency revocation through the SHIPPED HTTP ROUTE
 *     -> lapse job enqueued by that route
 *     -> `createLapseWorkerLoop(...).tick()` -- the loop `main.ts` starts
 *     -> the governed lapse door runs
 *     -> a LAPSED verdict with escalation
 *     -> credential still revoked
 *
 * ===========================================================================
 * THE ONE PRIVILEGED STEP, AND WHY IT IS THE HONEST ONE
 * ===========================================================================
 * `post_approval_due_at` is frozen at execution and the door compares it to
 * `clock_timestamp()`, so an obligation only becomes overdue by waiting hours.
 *
 * This file brings that ONE column FORWARD. It is the only mutation the model
 * permits: group 0152's immutability trigger refuses any attempt to move the
 * deadline LATER, precisely so a deadline cannot be used to buy more time, while
 * moving it earlier only makes the obligation come due sooner.
 *
 * Nothing else is fabricated. The authorization, its scope, its digest, the
 * evidence and the revocation are all produced by the governed path, and the
 * verdict is written by the governed door -- not by this file.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createIncumbentFixture,
  DEVELOPMENT,
} from "../../../packages/device-identity/test/support/renewal-fixtures.js";
import type { RequestAuthenticator } from "../src/authentication.js";
import {
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
} from "../src/composition.js";
import { createLapseWorkerLoop, type LapseWorkerLoop } from "../src/lapse-worker-runtime.js";
import {
  createEmergencyActor,
  disposeEmergencyActor,
  recordEmergencyEvidence,
  type EmergencyActor,
} from "./support/emergency-success-fixture.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;
const RUN = randomUUID().slice(0, 8);
const EMERGENCY_PREFIX = "/v1/device-credentials/emergency-revocations";

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: LOCAL_DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}
const live = await reachable();
if (!live) console.warn("SKIPPED: deployed lapse worker — local database unreachable");

describe.skipIf(!live)("the DEPLOYED worker lapses an unreviewed emergency", () => {
  let runtime: DeviceRevocationRuntime;
  let loop: LapseWorkerLoop;
  let keeper: pg.Pool;
  let keeperClient: pg.PoolClient;
  let responder: EmergencyActor;

  let credentialId = "";
  let authorizationId = "";
  let actorUserId = "";

  const logged: string[] = [];

  beforeAll(async () => {
    actorUserId = randomUUID();
    const authenticator: RequestAuthenticator = {
      authenticate: () =>
        Promise.resolve({
          authenticated: true as const,
          principal: { userId: actorUserId, method: "TEST_INJECTED_AUTHENTICATOR" },
        }),
    };
    runtime = resolveDeviceRevocationService(ENV, { authenticator });
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    keeperClient = await keeper.connect();

    // THE LOOP `main.ts` STARTS, constructed the same way.
    loop = createLapseWorkerLoop({
      gateway: runtime.jobGateway,
      service: runtime.service,
      environment: DEVELOPMENT,
      softwareVersion: "test",
      log: {
        info: (m) => logged.push(m),
        warn: (m) => logged.push(`WARN ${m}`),
      },
    });

    await keeperClient.query("begin");
    try {
      const target = await createIncumbentFixture(keeperClient, {
        issuedAtTrustedTime: new Date("2026-07-31T02:00:00.000Z"),
        label: `lapseloop-${RUN}`,
      });
      credentialId = target.credentialId;
      responder = await createEmergencyActor(keeperClient, {
        environment: DEVELOPMENT,
        label: `lapseloop-${RUN}`,
      });
      actorUserId = responder.userId;
      await keeperClient.query("commit");
    } catch (error) {
      await keeperClient.query("rollback").catch(() => undefined);
      throw error;
    }
  }, 180_000);

  afterAll(async () => {
    await loop?.stop().catch(() => undefined);
    if (responder !== undefined) {
      await disposeEmergencyActor(keeperClient, responder).catch(() => undefined);
    }
    keeperClient?.release();
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("1. an emergency revocation succeeds through the SHIPPED route", async () => {
    const evidenceId = await recordEmergencyEvidence(runtime.pool, responder, {
      environment: DEVELOPMENT,
    });
    const response = await runtime.revocationRouter.handle({
      method: "POST",
      path: EMERGENCY_PREFIX,
      headers: {},
      body: {
        credentialId,
        reasonCode: "KEY_COMPROMISE",
        explanation: `deployed lapse worker ${RUN}`,
        incidentReference: `INC-LAPSE-${RUN}`,
        reauthEvidenceId: evidenceId,
        idempotencyKey: `lapseloop-${RUN}`,
      },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.outcome).toBe("REVOKED_IMMEDIATELY");
    authorizationId = String(response.body.authorizationId ?? "");
    expect(authorizationId).not.toBe("");
  });

  it("2. that route ENQUEUED a durable lapse job", async () => {
    const { rows } = await keeperClient.query<{ n: string; environment: string }>(
      `select count(*)::text as n, min(environment) as environment
         from kitluy_ops.durable_jobs
        where job_kind = 'kitluy.devices.emergency-post-approval-lapse.v1'
          and dedupe_key like '%' || $1 || '%'`,
      [authorizationId],
    );
    expect(rows[0]?.n, "the emergency must schedule its own obligation").toBe("1");
    // The worker only claims its OWN environment; a mismatch here is how a job
    // gets enqueued and then never picked up by anyone.
    expect(rows[0]?.environment).toBe(DEVELOPMENT);
  });

  it("3. the obligation is PENDING and NOT yet due", async () => {
    const status = await runtime.service.readEmergencyStatus(authorizationId);
    expect(status?.postApprovalDecision).toBe("PENDING");
    expect(status?.postApprovalDueAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("4. a tick before the deadline changes NOTHING", async () => {
    // The worker must not close an obligation a human could still review.
    const executed = await loop.tick();
    expect(executed, "the loop must have picked the job up").toBeGreaterThan(0);

    const status = await runtime.service.readEmergencyStatus(authorizationId);
    expect(status?.postApprovalDecision, "an in-window obligation must stay open").toBe("PENDING");

    // AND IT DEFERRED RATHER THAN FAILED. NOT_DUE is not an error: the job is
    // rescheduled to look again later, which is how one enqueue survives until
    // the deadline actually passes.
    const { rows } = await keeperClient.query<{ status: string; next_attempt_at: Date | null }>(
      `select status, next_attempt_at from kitluy_ops.durable_jobs
        where dedupe_key like '%' || $1 || '%'`,
      [authorizationId],
    );
    expect(rows[0]?.status).toBe("retry_scheduled");
    expect(rows[0]?.next_attempt_at?.getTime() ?? 0).toBeGreaterThan(Date.now());
  });

  it("5. the deadline passes (moved EARLIER — the only direction allowed)", async () => {
    await keeperClient.query(
      `update kitluy_devices.device_emergency_revocation_authorizations
          set post_approval_due_at = executed_at - interval '1 minute'
        where authorization_id = $1::uuid`,
      [authorizationId],
    );
    // The job's own retry clock is brought forward too. Step 4 legitimately
    // deferred it by 60 seconds, and this stands in for waiting that out -- it is
    // queue scheduling, not a business fact, and the governed door still decides
    // the outcome entirely from `post_approval_due_at`. The write goes through
    // group 0160's narrow due-now scaffold as the borrowed test harness: with
    // the 0135 governor-membership leak closed, no test may touch the job table
    // directly.
    const { rows: jobRows } = await keeperClient.query<{ id: string }>(
      `select job_id::text as id from kitluy_ops.durable_jobs
        where dedupe_key like '%' || $1 || '%' and status = 'retry_scheduled'`,
      [authorizationId],
    );
    expect(jobRows.length, "exactly one scheduled lapse job").toBe(1);
    await keeperClient.query(
      `do $b$ begin execute format('grant kitluy_test_harness to %I', current_user); end $b$;`,
    );
    try {
      await keeperClient.query("select kitluy_ops.test_make_durable_job_due_v1($1::uuid)", [
        jobRows[0]?.id ?? "",
      ]);
    } finally {
      await keeperClient.query(
        `do $b$ begin execute format('revoke kitluy_test_harness from %I', current_user); end $b$;`,
      );
    }

    // Group 0152's trigger refuses the opposite direction. Proved here so the
    // step above cannot be mistaken for "the test can rewrite deadlines".
    await expect(
      keeperClient.query(
        `update kitluy_devices.device_emergency_revocation_authorizations
            set post_approval_due_at = post_approval_due_at + interval '10 years'
          where authorization_id = $1::uuid`,
        [authorizationId],
      ),
    ).rejects.toThrow();
  });

  it("6. the DEPLOYED worker loop claims and executes it", async () => {
    const executed = await loop.tick();
    expect(executed, "the production loop must have claimed the job").toBeGreaterThan(0);
    expect(logged, "the loop must report what it did").toContain("emergency lapse jobs executed");
  });

  it("7. a LAPSED verdict exists, with NO human attributed", async () => {
    const { rows } = await keeperClient.query<{
      verdict: string;
      actor: string | null;
      late: boolean;
      escalated_at: Date | null;
      escalation_reason: string | null;
    }>(
      `select verdict::text as verdict, actor_user_id::text as actor, late,
              escalated_at, escalation_reason
         from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
      [authorizationId],
    );
    expect(rows.length, "exactly one verdict").toBe(1);
    expect(rows[0]?.verdict).toBe("LAPSED");
    // NULL is the point: nobody came. A synthetic approver here would be a
    // fabricated human decision.
    expect(rows[0]?.actor, "a lapse must not invent an approver").toBeNull();
    expect(rows[0]?.late).toBe(true);
  });

  it("8. the lapse ESCALATED", async () => {
    const { rows } = await keeperClient.query<{ reason: string | null; at: Date | null }>(
      `select escalation_reason as reason, escalated_at as at
         from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
      [authorizationId],
    );
    expect(rows[0]?.at, "an unreviewed emergency must escalate").not.toBeNull();
    expect(rows[0]?.reason ?? "").toContain("LAPSED");
    expect(rows[0]?.reason ?? "").toContain("credentials stay revoked");
  });

  it("9. the credential REMAINS revoked", async () => {
    const { rows } = await keeperClient.query<{ state: string; revoked_at: Date | null }>(
      `select state::text as state, revoked_at from kitluy_devices.device_credentials
        where credential_id = $1::uuid`,
      [credentialId],
    );
    expect(rows[0]?.state).toBe("revoked");
    expect(rows[0]?.revoked_at, "lapsing must never reinstate anything").not.toBeNull();
  });

  it("10. a DUPLICATE tick is idempotent — no second verdict", async () => {
    await loop.tick();
    await loop.tick();
    const { rows } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
      [authorizationId],
    );
    expect(rows[0]?.n, "duplicate delivery must not decide twice").toBe("1");
  });

  it("11. the loop has ONE stable worker identity, and stops cleanly", async () => {
    // Regenerating the instance id per tick would make every claim look like a
    // new worker and defeat stale-worker detection.
    const identity = loop.identity;
    expect(identity.workerInstanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(identity.environment).toBe(DEVELOPMENT);
    expect(identity.serviceIdentity).toContain("emergency-lapse");

    loop.start();
    await loop.stop();
    expect(logged).toContain("emergency lapse worker stopped");
    expect(loop.identity.workerInstanceId).toBe(identity.workerInstanceId);
  });
});

/**
 * THE ENTRYPOINT WIRING, asserted on the SOURCE.
 *
 * Everything above proves the loop works. It does not prove a DEPLOYED process
 * runs one, and that distinction is the entire finding being closed -- so this
 * block checks `main.ts` itself.
 *
 * It is a source assertion and is labelled as one: it proves the wiring exists
 * and is ordered correctly, not that a server booted. Starting a real listener
 * here would need a port, a DSN and a signal dance for no extra information
 * about the thing under test, which is whether anyone calls `start()` at all.
 * Nothing else in the repository would fail if these lines were deleted.
 */
describe("the shipped entrypoint starts and stops the worker", () => {
  const main = readFileSync(fileURLToPath(new URL("../src/main.ts", import.meta.url)), "utf8");

  it("CONSTRUCTS the loop from the resolved production runtime", () => {
    expect(main).toContain("createLapseWorkerLoop");
    // From the real composition, not a fresh gateway of its own.
    expect(main).toMatch(/gateway:\s*revocation\.jobGateway/);
    expect(main).toMatch(/service:\s*revocation\.service/);
  });

  it("STARTS it once the socket is open, not before", () => {
    const listenAt = main.indexOf("server.listen(");
    const startAt = main.indexOf("lapseWorker.start()");
    expect(startAt, "main.ts must start the worker").toBeGreaterThan(-1);
    // A process that failed to bind must not compete for jobs with the one that did.
    expect(startAt).toBeGreaterThan(listenAt);
  });

  it("STOPS it before closing the database pool", () => {
    const stopIdx = main.indexOf("lapseWorker");
    const shutdownIdx = main.indexOf("revocation.shutdown()");
    expect(main, "main.ts must stop the worker on shutdown").toMatch(/lapseWorker\s*\.stop\(\)/);
    const stopCallIdx = main.search(/lapseWorker\s*\.stop\(\)/);
    expect(stopIdx).toBeGreaterThan(-1);
    // Otherwise shutdown abandons a claimed job and it stalls until its lease
    // expires -- with nobody left running to pick it up.
    expect(stopCallIdx).toBeLessThan(shutdownIdx);
  });
});
