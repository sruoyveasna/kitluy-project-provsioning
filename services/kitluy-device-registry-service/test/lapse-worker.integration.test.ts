/**
 * THE LAPSE CHAIN, END TO END, AGAINST THE REAL QUEUE.
 *
 * WS-11-T003 Step 4 final completion §3. RV-GW-002 was that no TypeScript ever
 * invoked the lapse sweeper: the governed function was reachable, the handler
 * existed, and nothing enqueued its job kind — so in a deployed system the only
 * mechanism that converts an unreviewed emergency into a LAPSED verdict and an
 * escalation would never have fired, and a missing escalation looks exactly like
 * "nothing to escalate".
 *
 * This suite runs the whole chain with production components only:
 *
 *   createEmergencyLapseScheduler  -> kitluy_ops.enqueue_durable_job_v1
 *   createEmergencyLapseWorker     -> claim / start / recordAttempt / complete
 *   service.lapseEmergencyPostApproval -> kitluy_devices.lapse_governed_emergency_post_approval_v1
 *
 * The only privileged step is CREATING the overdue authorization, because
 * reaching one through the governed emergency door needs a granted permission and
 * live re-authentication evidence — a fixture this suite deliberately does not
 * own. What is under test is the LAPSE half, and the row it acts on is the row
 * the governed door writes.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
} from "../src/composition.js";
import { createEmergencyLapseWorker, EMERGENCY_LAPSE_JOB_KIND } from "../src/lapse-worker.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = randomUUID().slice(0, 8);
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;
const ENVIRONMENT = "development";

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
if (!live) console.warn("SKIPPED: lapse worker integration suite — local database unreachable");

/**
 * Creates the rows the authorization's foreign keys require.
 *
 * `reauth_evidence_id` is NOT NULL and references
 * `kitluy_auth.reauthentication_evidence`, and `actor_user_id` references
 * `auth.users` — so an overdue authorization cannot be conjured from nothing.
 * The evidence is written CONSUMED and already expired, which is what it would be
 * after a real emergency execution spent it: this fixture must not leave a
 * spendable credential behind.
 */
async function seedConsumedEvidence(
  client: pg.PoolClient,
  actorUserId: string,
  authorizationHint: string,
): Promise<string> {
  const { rows } = await client.query<{ evidence_id: string }>(
    `insert into kitluy_auth.reauthentication_evidence (
       actor_user_id, environment, action_class, verified_at, expires_at,
       authentication_method, lifecycle_state, consumed_at, consumed_for_authorization,
       audit_correlation_id)
     values ($1::uuid, $2, 'fleet.device_credential.emergency_revoke',
             now() - interval '6 hours', now() - interval '6 hours' + interval '300 seconds',
             'PASSWORD_TOTP', 'CONSUMED', now() - interval '6 hours', $3::uuid, $4::uuid)
     returning evidence_id`,
    [actorUserId, ENVIRONMENT, authorizationHint, randomUUID()],
  );
  return rows[0]?.evidence_id ?? "";
}

/** A seeded human. FK-valid, and not invented. */
const SEEDED_ACTOR = "00000000-0000-4000-8000-000000000001";

describe.skipIf(!live)("an overdue emergency is lapsed by the production worker", () => {
  let runtime: DeviceRevocationRuntime;
  let keeper: pg.Pool;
  let authorizationId: string;

  beforeAll(async () => {
    runtime = resolveDeviceRevocationService(ENV);
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });

    // An authorization whose post-approval window has ALREADY closed. Written
    // privileged, because the governed door needs a permission grant and live
    // re-auth evidence this suite does not own.
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(
        `do $borrow$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $borrow$;`,
      );
      const evidenceId = await seedConsumedEvidence(client, SEEDED_ACTOR, randomUUID());
      await client.query("set local role kitluy_credential_issuer");
      const { rows } = await client.query<{ authorization_id: string }>(
        `insert into kitluy_devices.device_emergency_revocation_authorizations (
           actor_user_id, permission_key, reauth_evidence_id, reason_code, explanation,
           incident_reference, environment, subject_type, identifier_count, scope_digest,
           decision_version, idempotency_key, executed_at, post_approval_due_at)
         values ($1::uuid, 'fleet.device_credential.emergency_revoke', $7::uuid,
                 'KEY_COMPROMISE', $2, $3, $4, 'CREDENTIAL', 1, $5,
                 'KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001',
                 $6, now() - interval '5 hours', now() - interval '1 hour')
         returning authorization_id`,
        [
          SEEDED_ACTOR,
          `lapse worker suite ${RUN}`,
          `INC-LAPSE-${RUN}`,
          ENVIRONMENT,
          randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64),
          `idem-lapse-${RUN}`,
          evidenceId,
        ],
      );
      authorizationId = rows[0]?.authorization_id ?? "";
      await client.query("reset role");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    expect(authorizationId).not.toBe("");
  }, 120_000);

  afterAll(async () => {
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("SCHEDULES a lapse job carrying only the immutable authorization id", async () => {
    const scheduled = await runtime.lapseScheduler.scheduleLapse({
      authorizationId,
      environment: ENVIRONMENT,
      postApprovalDueAt: null,
      actorRef: "lapse-suite",
    });
    expect(scheduled.scheduled).toBe(true);
    expect(scheduled.outcome).toBe("CREATED");

    const { rows } = await keeper.query<{
      job_kind: string;
      payload: Record<string, unknown>;
      dedupe_key: string;
      subject_id: string;
    }>(
      `select job_kind, payload, dedupe_key, subject_id
         from kitluy_ops.durable_jobs where job_id = $1::uuid`,
      [scheduled.jobId],
    );
    const job = rows[0];
    expect(job?.job_kind).toBe(EMERGENCY_LAPSE_JOB_KIND);
    // ONE FIELD. No actor, reason, incident, scope or deadline — the worker must
    // be unable to decide anything.
    expect(Object.keys(job?.payload ?? {})).toEqual(["authorizationId"]);
    expect(job?.payload.authorizationId).toBe(authorizationId);
    expect(job?.subject_id).toBe(authorizationId);
    expect(job?.dedupe_key).toContain(authorizationId);
  });

  it("is IDEMPOTENT: a second schedule returns the same job, not a second obligation", async () => {
    const again = await runtime.lapseScheduler.scheduleLapse({
      authorizationId,
      environment: ENVIRONMENT,
      postApprovalDueAt: null,
      actorRef: "lapse-suite",
    });
    expect(again.outcome).toBe("EXISTING");

    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_ops.durable_jobs
        where job_kind = $1 and subject_id = $2::uuid`,
      [EMERGENCY_LAPSE_JOB_KIND, authorizationId],
    );
    expect(rows[0]?.n).toBe("1");
  });

  it("the WORKER claims it and the governed lapse writes a LAPSED verdict", async () => {
    const worker = createEmergencyLapseWorker({
      gateway: runtime.jobGateway,
      service: runtime.service,
      identity: {
        serviceIdentity: "kitluy-device-registry-service",
        workerInstanceId: `lapse-suite-${RUN}`,
        // REQUIRED, and the reason the first run claimed nothing:
        // `runDurableJobs` claims with `identity.environment`, so an absent value
        // matches no queued job.
        environment: ENVIRONMENT,
        softwareVersion: "0.1.0",
      },
      lease: { leaseId: randomUUID(), leaseOwner: `lapse-suite-${RUN}`, leaseSeconds: 60 },
      clock: { now: () => new Date() },
      jitter: { next: () => 0 },
      maxJobs: 10,
    });

    const executed = await worker.runOnce();
    const mine = executed.filter((job) => job.subjectId === authorizationId);
    expect(mine.length, `executed: ${JSON.stringify(executed)}`).toBe(1);
    expect(mine[0]?.disposition).toBe("completed");
    expect(mine[0]?.resultCode).toBe("EMERGENCY_POST_APPROVAL_LAPSED");

    // THE GOVERNED EFFECT: a LAPSED verdict with NO approver and NO re-auth,
    // because a lapse has neither by definition.
    const { rows } = await keeper.query<{
      verdict: string;
      actor_user_id: string | null;
      reauth_evidence_id: string | null;
      late: boolean;
      escalation_reason: string | null;
    }>(
      `select verdict::text as verdict, actor_user_id, reauth_evidence_id, late, escalation_reason
         from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
      [authorizationId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.verdict).toBe("LAPSED");
    expect(rows[0]?.actor_user_id).toBeNull();
    expect(rows[0]?.reauth_evidence_id).toBeNull();
    expect(rows[0]?.late).toBe(true);
    expect(rows[0]?.escalation_reason ?? "").toContain("LAPSED");
  });

  it("recorded IMMUTABLE attempt evidence naming the governed operation", async () => {
    const { rows } = await keeper.query<{
      called_operation: string;
      operation_result: string;
      classification: string;
    }>(
      `select a.called_operation, a.operation_result,
              a.outcome_classification::text as classification
         from kitluy_ops.durable_job_attempts a
         join kitluy_ops.durable_jobs j on j.job_id = a.job_id
        where j.subject_id = $1::uuid`,
      [authorizationId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.called_operation).toBe("lapse_governed_emergency_post_approval_v1");
    expect(rows[0]?.operation_result).toBe("LAPSED");
    expect(rows[0]?.classification).toBe("terminal_success");
  });

  it("a DUPLICATE delivery is idempotent — ALREADY_DECIDED, never a second verdict", async () => {
    // Re-running the governed lapse directly is the faithful duplicate: the job
    // itself is complete, so a second delivery would reach exactly this call.
    const again = await runtime.service.lapseEmergencyPostApproval(authorizationId);
    expect(again.outcome).toBe("ALREADY_DECIDED");
    expect(again.verdictId).not.toBeNull();

    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
      [authorizationId],
    );
    // The UNIQUE (authorization_id) constraint is the backstop; the blocking
    // FOR UPDATE is what makes the outcome a clean ALREADY_DECIDED rather than a
    // 23505 the worker would have to interpret.
    expect(rows[0]?.n).toBe("1");
  });

  it("REFUSES to lapse an obligation whose window has not closed", async () => {
    const client = await keeper.connect();
    let futureAuthorization = "";
    try {
      await client.query("begin");
      await client.query(
        `do $borrow$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $borrow$;`,
      );
      const evidenceId = await seedConsumedEvidence(client, SEEDED_ACTOR, randomUUID());
      await client.query("set local role kitluy_credential_issuer");
      const { rows } = await client.query<{ authorization_id: string }>(
        `insert into kitluy_devices.device_emergency_revocation_authorizations (
           actor_user_id, permission_key, reauth_evidence_id, reason_code, explanation,
           incident_reference, environment, subject_type, identifier_count, scope_digest,
           decision_version, idempotency_key, executed_at, post_approval_due_at)
         values ($1::uuid, 'fleet.device_credential.emergency_revoke', $7::uuid,
                 'DEVICE_LOST', $2, $3, $4, 'CREDENTIAL', 1, $5,
                 'KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001',
                 $6, now(), now() + interval '4 hours')
         returning authorization_id`,
        [
          SEEDED_ACTOR,
          `not-due ${RUN}`,
          `INC-NOTDUE-${RUN}`,
          ENVIRONMENT,
          randomUUID().replace(/-/g, "").padEnd(64, "1").slice(0, 64),
          `idem-notdue-${RUN}`,
          evidenceId,
        ],
      );
      futureAuthorization = rows[0]?.authorization_id ?? "";
      await client.query("reset role");
      await client.query("commit");
    } finally {
      client.release();
    }

    const result = await runtime.service.lapseEmergencyPostApproval(futureAuthorization);
    // NOT_DUE, not a refusal and not a lapse. A worker that could lapse early
    // could manufacture an escalation against a human who still had time.
    expect(result.outcome).toBe("NOT_DUE");

    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_emergency_post_approval_verdicts
        where authorization_id = $1::uuid`,
      [futureAuthorization],
    );
    expect(rows[0]?.n).toBe("0");
  });
});
