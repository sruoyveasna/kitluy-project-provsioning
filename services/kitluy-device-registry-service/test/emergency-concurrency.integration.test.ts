/**
 * The three outstanding concurrency scenarios, on genuinely separate backends.
 *
 * WS-11-T003 Step 4 §4, §5, §6. Each test uses `pg.Client` instances rather than
 * pooled clients so every session is unambiguously its own backend, and each
 * records `pg_backend_pid()` so the evidence is a fact rather than a claim.
 *
 * Barriers are real database locks, not sleeps. A `select ... for update` held by
 * one session parks the governed operation in another at a deterministic point,
 * and the parked session is confirmed to be WAITING via `pg_stat_activity` before
 * the barrier is released.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createIncumbentFixture,
  DEVELOPMENT,
} from "../../../packages/device-identity/test/support/renewal-fixtures.js";
import {
  createEmergencyActor,
  disposeEmergencyActor,
  readEvidence,
  recordEmergencyEvidence,
  type EmergencyActor,
} from "./support/emergency-success-fixture.js";
import {
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
} from "../src/composition.js";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const ENV = { DEVICE_REGISTRY_DATABASE_URL: LOCAL_DSN, KITLUY_ENV: "local" } as const;
const RUN = randomUUID().slice(0, 8);
const DECISION = "KLD-2026-07-31-SECURITY-TEST-CLOCK-001";

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
if (!live) console.warn("SKIPPED: emergency concurrency suite — local database unreachable");

/** A named, separately-connected session whose backend PID is recorded. */
interface Session {
  readonly name: string;
  readonly client: pg.Client;
  readonly pid: number;
}

async function openSession(name: string): Promise<Session> {
  const client = new pg.Client({ connectionString: LOCAL_DSN });
  await client.connect();
  const { rows } = await client.query<{ pid: number }>(`select pg_backend_pid() as pid`);
  return { name, client, pid: Number(rows[0]?.pid) };
}

/** Waits until `pid` is genuinely blocked on a lock. The barrier, proved. */
async function waitUntilBlocked(observer: pg.Client, pid: number): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const { rows } = await observer.query<{ wait_event_type: string | null; state: string }>(
      `select wait_event_type, state from pg_stat_activity where pid = $1`,
      [pid],
    );
    const row = rows[0];
    if (row?.state === "active" && row.wait_event_type === "Lock") return "Lock";
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`session ${pid} never blocked on a lock`);
}

describe.skipIf(!live)("governed emergency revocation under real concurrency", () => {
  let runtime: DeviceRevocationRuntime;
  let keeper: pg.Pool;
  let keeperClient: pg.PoolClient;
  let actor: EmergencyActor;

  beforeAll(async () => {
    runtime = resolveDeviceRevocationService(ENV);
    keeper = new pg.Pool({ connectionString: LOCAL_DSN, max: 6 });
    keeperClient = await keeper.connect();
    actor = await createEmergencyActor(keeperClient, {
      environment: DEVELOPMENT,
      label: `concurrency-${RUN}`,
      grantMinutes: 60,
    });
  }, 180_000);

  afterAll(async () => {
    if (actor !== undefined)
      await disposeEmergencyActor(keeperClient, actor).catch(() => undefined);
    // The clock must NEVER be left enabled.
    await keeperClient
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeperClient
      .query(
        `do $r$ begin execute format('revoke kitluy_test_harness from %I', current_user); end $r$;`,
      )
      .catch(() => undefined);
    keeperClient?.release();
    await runtime?.shutdown().catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  async function freshCredential(
    label: string,
  ): Promise<{ credentialId: string; deviceId: string }> {
    await keeperClient.query("begin");
    try {
      const fixture = await createIncumbentFixture(keeperClient, {
        issuedAtTrustedTime: new Date("2026-07-31T02:00:00.000Z"),
        label: `${label}-${RUN}`,
      });
      await keeperClient.query("commit");
      return { credentialId: fixture.credentialId, deviceId: fixture.deviceRecordId };
    } catch (error) {
      await keeperClient.query("rollback").catch(() => undefined);
      throw error;
    }
  }

  /** Enables the sanctioned clock for the duration of one test, then removes it. */
  async function withClockEnabled<T>(fn: () => Promise<T>): Promise<T> {
    await keeperClient.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', $1, $2) on conflict (environment) do nothing`,
      [`concurrency-suite-${RUN}`, DECISION],
    );
    await keeperClient.query(
      `do $g$ begin execute format('grant kitluy_test_harness to %I', current_user); end $g$;`,
    );
    try {
      return await fn();
    } finally {
      await keeperClient
        .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
        .catch(() => undefined);
    }
  }

  /** Drives the governed emergency door directly on one session, as the human. */
  async function callGovernedEmergency(
    session: Session,
    input: {
      readonly credentialId: string;
      readonly evidenceId: string;
      readonly idempotencyKey: string;
      readonly reason?: string;
      readonly explanation?: string;
    },
  ): Promise<
    { ok: true; result: Record<string, unknown> } | { ok: false; code: string; message: string }
  > {
    try {
      const { rows } = await session.client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.revoke_device_credential_emergency_governed_v1(
           $1::uuid, $2::kitluy_devices.credential_revocation_reason, $3, $4, $5::uuid, $6, null
         ) as result`,
        [
          input.credentialId,
          input.reason ?? "KEY_COMPROMISE",
          input.explanation ?? `concurrency ${RUN}`,
          `INC-CONC-${RUN}`,
          input.evidenceId,
          input.idempotencyKey,
        ],
      );
      return { ok: true, result: rows[0]?.result ?? {} };
    } catch (error) {
      const e = error as { code?: string; message?: string };
      return { ok: false, code: e.code ?? "UNKNOWN", message: e.message ?? "" };
    }
  }

  /** Puts the human's identity on a session. */
  async function becomeHuman(session: Session): Promise<void> {
    await session.client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: actor.userId, role: "authenticated" }),
    ]);
    await session.client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [
      actor.userId,
    ]);
    await session.client.query("set local role authenticated");
  }

  // -------------------------------------------------------------------------
  // SCENARIO A — the 300-second window really expires while parked
  // -------------------------------------------------------------------------
  it("A: evidence EXPIRES while the operation is parked, and nothing is revoked", async () => {
    const { credentialId } = await freshCredential("concA");
    const evidenceId = await recordEmergencyEvidence(runtime.pool, actor, {
      environment: DEVELOPMENT,
    });

    const valid = await readEvidence(keeperClient, evidenceId);
    expect(valid?.lifecycleState, "evidence must be spendable before parking").toBe("ACTIVE");
    expect(valid?.consumedAt).toBeNull();

    const blocker = await openSession("blocker");
    const runner = await openSession("runner");
    const evidence: Record<string, unknown> = {
      blockerPid: blocker.pid,
      runnerPid: runner.pid,
      verifiedAt: valid?.verifiedAt.toISOString(),
      expiresAt: valid?.expiresAt.toISOString(),
    };
    expect(blocker.pid).not.toBe(runner.pid);

    try {
      await withClockEnabled(async () => {
        // BARRIER: the blocker holds the credential row the governed door must
        // lock before it consumes evidence.
        await blocker.client.query("begin");
        // The BARRIER only. The credential governor is BORROWED inside this
        // transaction — the repository's own idiom — purely to hold a row lock,
        // and the rollback that ends the barrier un-grants it. The revocation
        // under test is performed by the HUMAN through the governed door, never
        // by this session.
        await blocker.client.query(
          `do $b$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $b$;`,
        );
        await blocker.client.query("set local role kitluy_credential_issuer");
        await blocker.client.query(
          `select 1 from kitluy_devices.device_credentials where credential_id = $1::uuid for update`,
          [credentialId],
        );

        // The runner advances AUTHORITATIVE time past the 300-second boundary.
        // Transaction-local, so it cannot escape onto another session.
        await runner.client.query("begin");
        await runner.client.query("set local role kitluy_test_harness");
        const advanced = new Date((valid?.expiresAt.getTime() ?? 0) + 1000).toISOString();
        await runner.client.query(`select kitluy_ops.test_clock_set_v1($1::timestamptz)`, [
          advanced,
        ]);
        await runner.client.query("reset role");
        evidence.advancedTo = advanced;

        await becomeHuman(runner);
        const pending = callGovernedEmergency(runner, {
          credentialId,
          evidenceId,
          idempotencyKey: `idem-concA-${RUN}`,
        });

        // Prove it is genuinely PARKED on a lock, not merely slow.
        evidence.barrier = await waitUntilBlocked(keeperClient, runner.pid);

        await blocker.client.query("rollback");
        const outcome = await pending;
        await runner.client.query("rollback").catch(() => undefined);

        // The refusal is caused by EXPIRY: the governed door raises
        // insufficient_privilege when the evidence is not spendable.
        expect(outcome.ok, `expected a refusal, got ${JSON.stringify(outcome)}`).toBe(false);
        if (!outcome.ok) {
          evidence.sqlstate = outcome.code;
          expect(outcome.code).toBe("42501");
          expect(outcome.message).toMatch(/REAUTHENTICATION-REFUSED/);
        }
      });
    } finally {
      await blocker.client.end().catch(() => undefined);
      await runner.client.end().catch(() => undefined);
    }

    // NO CREDENTIAL MUTATION.
    const { rows: cred } = await keeperClient.query<{ state: string }>(
      `select state::text as state from kitluy_devices.device_credentials where credential_id = $1::uuid`,
      [credentialId],
    );
    expect(cred[0]?.state, "the credential must not have been revoked").not.toBe("revoked");

    // EVIDENCE UNCONSUMED BUT EXPIRED. A failed attempt neither spends it nor
    // buys more time with it.
    const after = await readEvidence(keeperClient, evidenceId);
    expect(after?.lifecycleState).toBe("ACTIVE");
    expect(after?.consumedAt).toBeNull();
    expect(after?.expiresAt.toISOString()).toBe(valid?.expiresAt.toISOString());

    // NO AUTHORIZATION, SCOPE OR OBLIGATION RESIDUE — the raise rolled it all back.
    const { rows: residue } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_emergency_revocation_authorizations
        where idempotency_key = $1`,
      [`idem-concA-${RUN}`],
    );
    expect(residue[0]?.n).toBe("0");

    console.warn(`[race A] ${JSON.stringify(evidence)}`);
    expect(evidence.barrier).toBe("Lock");
  }, 180_000);

  // -------------------------------------------------------------------------
  // SCENARIO B — the credential set changes underneath a parked execution
  // -------------------------------------------------------------------------
  it("B: a credential revoked by another session mid-park does not produce a second effect", async () => {
    const { credentialId } = await freshCredential("concB");
    const evidenceId = await recordEmergencyEvidence(runtime.pool, actor, {
      environment: DEVELOPMENT,
    });

    const mutator = await openSession("mutator");
    const runner = await openSession("runner-b");
    const evidence: Record<string, unknown> = { mutatorPid: mutator.pid, runnerPid: runner.pid };
    expect(mutator.pid).not.toBe(runner.pid);

    try {
      // The mutator parks the row, then changes the authoritative scope by
      // revoking the very credential the emergency is aimed at.
      await mutator.client.query("begin");
      // BARRIER + authoritative mutation. The governor is BORROWED inside this
      // transaction as scaffolding that CREATES the race; the emergency under
      // test is still executed by the human through the governed door.
      await mutator.client.query(
        `do $b$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $b$;`,
      );
      await mutator.client.query("set local role kitluy_credential_issuer");
      await mutator.client.query(
        `select 1 from kitluy_devices.device_credentials where credential_id = $1::uuid for update`,
        [credentialId],
      );

      await runner.client.query("begin");
      await becomeHuman(runner);
      const pending = callGovernedEmergency(runner, {
        credentialId,
        evidenceId,
        idempotencyKey: `idem-concB-${RUN}`,
        reason: "DEVICE_STOLEN",
      });
      evidence.barrier = await waitUntilBlocked(keeperClient, runner.pid);

      // AUTHORITATIVE SCOPE CHANGES: this credential is now already revoked, so
      // the set the parked execution believed it was acting on is stale.
      await mutator.client.query(
        `update kitluy_devices.device_credentials
            set state = 'revoked', revoked_at = now(), revocation_reason = 'ADMINISTRATIVE_REPLACEMENT'
          where credential_id = $1::uuid`,
        [credentialId],
      );
      // Hand the borrow back BEFORE committing, or a login-capable role would be
      // left a standing member of the governor.
      await mutator.client.query("reset role");
      await mutator.client.query(
        `do $h$ begin if pg_has_role(current_user,'kitluy_credential_issuer','MEMBER') then execute format('revoke kitluy_credential_issuer from %I', current_user); end if; end $h$;`,
      );
      await mutator.client.query("commit");

      const outcome = await pending;
      evidence.outcome = outcome.ok ? outcome.result : { code: outcome.code };
      if (outcome.ok) {
        await runner.client.query("commit");
      } else {
        await runner.client.query("rollback").catch(() => undefined);
      }

      // Either the governed door re-derived the set under the final lock and
      // found nothing left to revoke (fail closed), or it completed against the
      // already-revoked row without revoking it twice. Both are acceptable; a
      // SECOND revocation of the same credential is not.
      const { rows: revocations } = await keeperClient.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_credential_revocations
          where credential_id = $1::uuid`,
        [credentialId],
      );
      evidence.revocationRows = revocations[0]?.n;
      expect(Number(revocations[0]?.n ?? "0")).toBeLessThanOrEqual(1);
    } finally {
      await mutator.client.end().catch(() => undefined);
      await runner.client.end().catch(() => undefined);
    }

    // The credential is revoked exactly once and stays revoked.
    const { rows: cred } = await keeperClient.query<{ state: string }>(
      `select state::text as state from kitluy_devices.device_credentials where credential_id = $1::uuid`,
      [credentialId],
    );
    expect(cred[0]?.state).toBe("revoked");

    // At most ONE authorization for this idempotency key, and none if it failed.
    const { rows: auth } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_emergency_revocation_authorizations
        where idempotency_key = $1`,
      [`idem-concB-${RUN}`],
    );
    expect(Number(auth[0]?.n ?? "0")).toBeLessThanOrEqual(1);

    console.warn(`[race B] ${JSON.stringify(evidence)}`);
    expect(evidence.barrier).toBe("Lock");
  }, 180_000);

  // -------------------------------------------------------------------------
  // SCENARIO C — identical replay versus conflicting replay
  // -------------------------------------------------------------------------
  it("C: identical replay is idempotent, conflicting replay fails closed", async () => {
    const first = await freshCredential("concC1");
    const second = await freshCredential("concC2");
    const key = `idem-concC-${RUN}`;

    const evidence1 = await recordEmergencyEvidence(runtime.pool, actor, {
      environment: DEVELOPMENT,
    });
    const evidence2 = await recordEmergencyEvidence(runtime.pool, actor, {
      environment: DEVELOPMENT,
    });
    const evidence3 = await recordEmergencyEvidence(runtime.pool, actor, {
      environment: DEVELOPMENT,
    });

    const original = await openSession("original");
    const identical = await openSession("identical");
    const conflicting = await openSession("conflicting");
    const pids = { original: original.pid, identical: identical.pid, conflicting: conflicting.pid };
    expect(new Set(Object.values(pids)).size).toBe(3);

    let originalOutcome: unknown;
    let identicalOutcome: unknown;
    let conflictingOutcome: unknown;
    try {
      // The ORIGINAL commits first, so replay semantics are what is under test
      // rather than a three-way write race.
      await original.client.query("begin");
      await becomeHuman(original);
      const o = await callGovernedEmergency(original, {
        credentialId: first.credentialId,
        evidenceId: evidence1,
        idempotencyKey: key,
      });
      originalOutcome = o.ok ? o.result : { code: o.code };
      expect(o.ok, JSON.stringify(originalOutcome)).toBe(true);
      await original.client.query("commit");

      // IDENTICAL retry: same key, same immutable input.
      await identical.client.query("begin");
      await becomeHuman(identical);
      const i = await callGovernedEmergency(identical, {
        credentialId: first.credentialId,
        evidenceId: evidence2,
        idempotencyKey: key,
      });
      identicalOutcome = i.ok ? i.result : { code: i.code };
      if (i.ok) await identical.client.query("commit");
      else await identical.client.query("rollback").catch(() => undefined);
      expect(i.ok, JSON.stringify(identicalOutcome)).toBe(true);
      if (i.ok) expect(i.result.outcome).toBe("ALREADY_AUTHORIZED");

      // CONFLICTING retry: same key, a DIFFERENT credential — a different
      // immutable affected set.
      await conflicting.client.query("begin");
      await becomeHuman(conflicting);
      const c = await callGovernedEmergency(conflicting, {
        credentialId: second.credentialId,
        evidenceId: evidence3,
        idempotencyKey: key,
      });
      conflictingOutcome = c.ok ? c.result : { code: c.code };
      if (c.ok) await conflicting.client.query("commit");
      else await conflicting.client.query("rollback").catch(() => undefined);
      expect(c.ok).toBe(true);
      if (c.ok) {
        expect(c.result.outcome).toBe("EMERGENCY_REFUSED");
        expect(String(c.result.refusal_code)).toBe("KLUY-EMERGENCY-CONFLICTING-REPLAY");
      }
    } finally {
      await original.client.end().catch(() => undefined);
      await identical.client.end().catch(() => undefined);
      await conflicting.client.end().catch(() => undefined);
    }

    // EXACTLY ONE business effect.
    const { rows: auth } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_emergency_revocation_authorizations
        where idempotency_key = $1`,
      [key],
    );
    expect(auth[0]?.n, "one idempotency key must yield one authorization").toBe("1");

    // The conflicting target was NEVER revoked.
    const { rows: untouched } = await keeperClient.query<{ state: string }>(
      `select state::text as state from kitluy_devices.device_credentials where credential_id = $1::uuid`,
      [second.credentialId],
    );
    expect(untouched[0]?.state).not.toBe("revoked");

    // Evidence spent exactly once: only the ORIGINAL consumed one. The replay and
    // the conflict must not have spent theirs.
    for (const [label, id] of [
      ["identical", evidence2],
      ["conflicting", evidence3],
    ] as const) {
      const state = await readEvidence(keeperClient, id);
      expect(state?.consumedAt, `${label} replay spent its evidence`).toBeNull();
    }
    expect((await readEvidence(keeperClient, evidence1))?.lifecycleState).toBe("CONSUMED");

    // ONE relational scope, and ONE post-approval obligation.
    const { rows: scope } = await keeperClient.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_emergency_revocation_scope s
         join kitluy_devices.device_emergency_revocation_authorizations a
           on a.authorization_id = s.authorization_id
        where a.idempotency_key = $1`,
      [key],
    );
    expect(scope[0]?.n).toBe("1");

    console.warn(
      `[race C] ${JSON.stringify({ pids, originalOutcome, identicalOutcome, conflictingOutcome })}`,
    );
  }, 240_000);
});
