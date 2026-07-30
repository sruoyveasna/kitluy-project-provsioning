/**
 * Shared plumbing for TRUE-concurrency suites (WS-11-T003 Step 4, Phase D).
 *
 * TEST-ONLY, and deliberately not exported from `src/`.
 *
 * ===========================================================================
 * WHY THIS MODULE EXISTS
 * ===========================================================================
 * `scope-consumption-concurrency.integration.test.ts` established what a race
 * has to do before it counts as evidence:
 *
 *   * two genuinely separate `pg.Client` connections, each with its own
 *     `connect()` — a pool that handed out one backend twice, or two
 *     sequential transactions on one backend, would prove nothing;
 *   * a third OBSERVER connection that reads `pg_stat_activity` and `pg_locks`
 *     and proves the loser is parked on an UNGRANTED lock while the winner is
 *     still uncommitted, so "B was blocked" is the server's claim and not this
 *     file's;
 *   * server-assigned transaction ids (`pg_current_xact_id`), so "A started
 *     before B" comes from PostgreSQL's own monotonic counter rather than from
 *     the order of two awaits;
 *   * the loser's SQLSTATE or returned refusal, and the final authoritative
 *     row state, recorded for every scenario.
 *
 * Phase D adds a second concurrency suite over the GOVERNED EMERGENCY path.
 * Rather than copy four hundred lines of that plumbing — where a copy would
 * drift and the two suites would slowly stop testing the same notion of
 * "blocked" — the mechanics live here once.
 *
 * The original suite is NOT retrofitted onto this module. It is passing
 * evidence for a closed reconciliation item, and rewriting a green privilege
 * suite to share code with a new one is a change to evidence rather than a
 * change to test plumbing. New suites use this module; that one stays as it is.
 *
 * ===========================================================================
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ===========================================================================
 * It does not borrow role memberships. Membership is CLUSTER-WIDE catalog
 * state, so a helper that quietly borrowed a governor would make an unrelated
 * privilege assertion in a concurrently running file VACUOUS rather than
 * failing — the exact outcome that turned off `fileParallelism` in
 * `vitest.config.ts`. Any suite that genuinely needs a borrow does it in its
 * own `beforeAll`, where the refusal-to-start and the hand-back are visible.
 */
import pg from "pg";

import { devDatabaseUrl } from "./dev-database.js";

export type Json = Record<string, unknown>;

export interface DbFailure {
  readonly sqlState: string;
  readonly message: string;
}

export type Settled<T> =
  | { readonly ok: true; readonly value: T; readonly elapsedMs: number }
  | { readonly ok: false; readonly failure: DbFailure; readonly elapsedMs: number };

export function toFailure(error: unknown): DbFailure {
  if (error !== null && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    return {
      sqlState: typeof candidate.code === "string" ? candidate.code : "",
      message: typeof candidate.message === "string" ? candidate.message : String(error),
    };
  }
  return { sqlState: "", message: String(error) };
}

/** Runs a query and captures success OR failure, so a race can be inspected. */
export async function settle<T>(start: () => Promise<T>): Promise<Settled<T>> {
  const startedAt = Date.now();
  try {
    return { ok: true, value: await start(), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, failure: toFailure(error), elapsedMs: Date.now() - startedAt };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Unwraps a `Settled` that was expected to SUCCEED, and throws the database's
 * own message when it did not.
 *
 * `expect(result.ok).toBe(true)` reports "expected false to be true", which
 * says nothing about which SQLSTATE or which refusal actually happened — and in
 * a concurrency suite that is the only interesting part.
 */
export function expectSucceeded<T>(settled: Settled<T>, what: string): T {
  if (!settled.ok) {
    throw new Error(
      `${what} was expected to succeed and failed after ${settled.elapsedMs}ms with ` +
        `SQLSTATE ${settled.failure.sqlState || "(none)"}: ${settled.failure.message}`,
    );
  }
  return settled.value;
}

/**
 * Unwraps a `Settled` that was expected to FAIL, and says so loudly when it
 * succeeded — the `expectRefused` discipline from `renewal-fixtures.ts`, for the
 * same reason: a refusal test that passes because the statement went through is
 * worse than no test.
 */
export function expectFailed<T>(settled: Settled<T>, what: string): DbFailure {
  if (settled.ok) {
    throw new Error(`${what} was expected to be refused and SUCCEEDED instead`);
  }
  return settled.failure;
}

export function asJson(value: unknown): Json {
  return value !== null && typeof value === "object" ? (value as Json) : {};
}

export function text(value: Json, key: string): string | null {
  const found = value[key];
  return typeof found === "string" ? found : null;
}

// ---------------------------------------------------------------------------
// Backends. `pg.Client`, not `pg.Pool`: a pool can hand back the same physical
// connection, and "two clients" that share a backend is not concurrency.
// ---------------------------------------------------------------------------
export interface Backend {
  readonly label: string;
  readonly client: pg.Client;
  readonly pid: number;
}

export async function openBackend(label: string, runId: string): Promise<Backend> {
  const client = new pg.Client({
    connectionString: devDatabaseUrl(),
    application_name: `kitluy-race-${label}-${runId}`,
  });
  await client.connect();
  const { rows } = await client.query<{ pid: string }>("select pg_backend_pid()::text as pid");
  const pid = Number(rows[0]?.pid ?? "0");
  if (!Number.isFinite(pid) || pid === 0) {
    throw new Error(`could not read a backend pid for connection ${label}`);
  }
  return { label, client, pid };
}

export async function closeBackends(backends: readonly (Backend | undefined)[]): Promise<void> {
  for (const backend of backends) {
    await backend?.client.end().catch(() => undefined);
  }
}

/**
 * Opens a transaction and returns the SERVER's transaction id.
 *
 * `pg_current_xact_id()` assigns a real xid on the spot, which is what makes
 * "A started before B" a fact from PostgreSQL's own monotonic counter rather
 * than an assumption about the order of two awaits in the calling file.
 *
 * `role` is applied with SET LOCAL, never a plain role switch: it is undone by
 * commit/rollback, so a leaked role cannot make a later assertion pass under
 * the wrong identity.
 */
export async function beginTransaction(backend: Backend, role?: string): Promise<bigint> {
  // Defensive rollback FIRST.
  //
  // When a race assertion fails mid-scenario, the failing test never reaches its
  // own `endTransaction`, and this connection is left inside an open — often
  // aborted — transaction. Every later `begin` on it then fails with "current
  // transaction is aborted", so ONE real failure is reported as five unrelated
  // ones and the actual cause is buried. A `rollback` outside a transaction is a
  // no-op warning, so this costs nothing when the previous test cleaned up.
  await backend.client.query("rollback").catch(() => undefined);
  await backend.client.query("begin");
  if (role !== undefined) {
    await backend.client.query(`set local role ${role}`);
  }
  const { rows } = await backend.client.query<{ xid: string }>(
    "select pg_current_xact_id()::text as xid",
  );
  return BigInt(rows[0]?.xid ?? "0");
}

export async function endTransaction(backend: Backend, how: "commit" | "rollback"): Promise<void> {
  await backend.client.query(how).catch(async () => {
    // An aborted transaction only accepts rollback.
    await backend.client.query("rollback").catch(() => undefined);
  });
}

/**
 * Impersonates a named authenticated human for the rest of the transaction.
 *
 * The governed emergency and post-approval RPCs resolve their actor from
 * `auth.uid()`, which reads `request.jwt.claims`. Both settings are
 * transaction-local (`set local role`, `set_config(..., true)`), so a
 * commit or rollback returns the connection to `postgres` with no claims —
 * an identity cannot outlive the transaction that assumed it.
 */
export async function actAsAuthenticatedHuman(backend: Backend, userId: string): Promise<void> {
  await backend.client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await backend.client.query("set local role authenticated");
}

// ---------------------------------------------------------------------------
// THE BARRIER OBSERVER.
//
// A third connection, so the claim "B was blocked" is made by the server and
// not by the calling file. Reads pg_stat_activity for the wait, and pg_locks
// for the UNGRANTED lock B is actually parked on — which names the constraint
// or the row doing the serialising.
// ---------------------------------------------------------------------------
export interface BlockObservation {
  readonly pid: number;
  readonly state: string;
  readonly waitEventType: string;
  readonly waitEvent: string;
  readonly ungrantedLocks: readonly string[];
  readonly holderState: string;
  readonly observedAfterMs: number;
}

export const DEFAULT_BLOCK_OBSERVATION_TIMEOUT_MS = 20_000;

export async function observeBlocked(
  observer: Backend,
  blocked: Backend,
  holder: Backend,
  timeoutMs: number = DEFAULT_BLOCK_OBSERVATION_TIMEOUT_MS,
): Promise<BlockObservation> {
  const startedAt = Date.now();
  let last = "no pg_stat_activity row was ever read";
  while (Date.now() - startedAt < timeoutMs) {
    const activity = await observer.client.query<{
      state: string;
      wait_event_type: string;
      wait_event: string;
    }>(
      `select coalesce(state, '?') as state,
              coalesce(wait_event_type, '') as wait_event_type,
              coalesce(wait_event, '') as wait_event
         from pg_stat_activity where pid = $1`,
      [blocked.pid],
    );
    const row = activity.rows[0];
    last = row === undefined ? "the backend disappeared" : JSON.stringify(row);

    if (row !== undefined && row.wait_event_type === "Lock") {
      const locks = await observer.client.query<{ descr: string }>(
        `select locktype || ':' || mode
                || coalesce(':' || relation::regclass::text, '') as descr
           from pg_locks where pid = $1 and not granted`,
        [blocked.pid],
      );
      const holderActivity = await observer.client.query<{ state: string }>(
        `select coalesce(state, '?') as state from pg_stat_activity where pid = $1`,
        [holder.pid],
      );
      return {
        pid: blocked.pid,
        state: row.state,
        waitEventType: row.wait_event_type,
        waitEvent: row.wait_event,
        ungrantedLocks: locks.rows.map((lock) => lock.descr),
        holderState: holderActivity.rows[0]?.state ?? "?",
        observedAfterMs: Date.now() - startedAt,
      };
    }
    await sleep(20);
  }
  throw new Error(
    `${blocked.label} never entered a lock wait within ${timeoutMs}ms; ` +
      `last pg_stat_activity read: ${last}. Without a real block there is no race to report.`,
  );
}

// ---------------------------------------------------------------------------
// Evidence. Every scenario records the same shape, and the whole set is
// printed once at the end so the run itself carries the proof.
// ---------------------------------------------------------------------------
export interface RaceEvidence {
  readonly scenario: string;
  readonly alphaPid: number;
  readonly betaPid: number;
  readonly alphaXid: string;
  readonly betaXid: string;
  readonly transactionStartOrder: string;
  readonly barrier: string;
  /**
   * NULL is a legitimate value, and it means one of two very different things,
   * so every scenario that records null must say which in `barrier`:
   *
   *   1. the design does not block — `SKIP LOCKED` is the example, where the
   *      second worker walks past the locked row instead of parking on it;
   *   2. the loser was refused before it ever reached a lock — a revoked
   *      EXECUTE grant is decided by the permission system, not by a lock.
   *
   * A null that means neither of those is a race that did not happen.
   */
  readonly betaBlocked: BlockObservation | null;
  readonly winner: string;
  readonly loser: string;
  readonly loserSqlState: string | null;
  readonly loserOutcome: string | null;
  readonly finalState: Json;
}

export class RaceLog {
  private readonly entries: RaceEvidence[] = [];

  record(entry: RaceEvidence): void {
    this.entries.push(entry);
    console.info(`\n[race evidence] ${entry.scenario}\n${JSON.stringify(entry, null, 2)}`);
  }

  get count(): number {
    return this.entries.length;
  }

  /** One compact table at the end, so a CI log carries the whole set. */
  summary(): string {
    return JSON.stringify(
      this.entries.map((entry) => ({
        scenario: entry.scenario,
        pids: `${entry.alphaPid}/${entry.betaPid}`,
        order: entry.transactionStartOrder,
        blockedOn: entry.betaBlocked?.ungrantedLocks ?? "not lock-serialised (see barrier)",
        winner: entry.winner,
        loser: entry.loser,
        loserSqlState: entry.loserSqlState,
        loserOutcome: entry.loserOutcome,
      })),
      null,
      2,
    );
  }
}
