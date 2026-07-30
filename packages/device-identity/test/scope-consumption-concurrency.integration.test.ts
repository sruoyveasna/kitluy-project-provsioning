/**
 * WS-11-T003 Step 4 — the scope-consumption boundary under REAL concurrency.
 *
 * Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 **Ruling 1** —
 *   "approval consumption must be single-use and ATOMIC WITH REVOCATION".
 * Under test: migration groups 0141 (`consume_revocation_scope_v1`, the three
 *   UNIQUE constraints on `kitluy_devices.revocation_scope_consumptions`) and
 *   0142 (`revoke_device_credential_with_recorded_scope_v1`, whose step 4
 *   RAISES rather than returns when consumption loses).
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS, GIVEN SECTION 45 ALREADY EXERCISES THE SAME FUNCTIONS
 * ===========================================================================
 * `supabase/tests/assertions.sql` section 45 calls the scoped revocation twice
 * IN ONE SESSION and observes that the replay is refused. Its own comment is
 * honest about the limit: "as far as a single session can prove it". A
 * sequential replay proves the CHECK; it cannot prove the RACE, because the
 * second call sees the first one's committed row and never contends for
 * anything.
 *
 * The property Ruling 1 actually asserts is about two transactions IN FLIGHT
 * TOGETHER. That needs two connections, and it needs the loser to be blocked
 * on a real lock while the winner is still uncommitted. Everything below is
 * built around making that observable rather than assumed:
 *
 *   * two genuinely separate `pg.Client` connections, each with its own
 *     `connect()`. A pool that handed out one client twice, or two sequential
 *     transactions on one client, would be evidence of nothing;
 *   * a third OBSERVER connection that reads `pg_stat_activity` and `pg_locks`
 *     and proves the loser is parked on a lock — a blocked-then-resolved
 *     outcome is asserted here, never inferred from the ordering of awaits;
 *   * both backend PIDs, both transaction ids (`pg_current_xact_id`, which
 *     assigns a real xid and therefore ORDERS the two transactions from the
 *     server's own counter rather than from wall-clock hope);
 *   * the loser's SQLSTATE or returned refusal, and the final authoritative
 *     row state, recorded for every scenario.
 *
 * ===========================================================================
 * WHY THE FIXTURES ARE COMMITTED
 * ===========================================================================
 * Two connections must SEE each other's work, so the usual
 * `withDatabaseTransaction` rollback isolation is unavailable: everything here
 * is committed. Every fixture therefore carries a per-run random id, and
 * `afterAll` removes the rows this run created.
 *
 * TWO EXCEPTIONS, both deliberate and both stated rather than hidden:
 *
 *   1. The scenario-2 device, its credential and its issuance history are
 *      APPEND-ONLY by design (`trg_devices_append_only_delete`,
 *      `KLUY-CRED-IMMUTABLE`). They are left in place, exactly as
 *      `supabase/tests/assertions.sql` leaves the devices it enrolls on every
 *      run. The asset tag is run-unique so nothing else can reach them.
 *   2. The revocation evidence for that credential — its revocation row,
 *      recovery case, consumption row, recorded scope and approval — is also
 *      left in place. Deleting it would leave a credential in `revoked` state
 *      with NOTHING explaining why, which is worse residue than the rows
 *      themselves and would fabricate an inconsistency no real path produces.
 *
 * The purely synthetic rows (scenarios 1 and 3-6 name fictitious device uuids
 * and fictitious revocation ids; nothing real ever pointed at them) ARE
 * deleted.
 *
 * ===========================================================================
 * THE BORROWED GOVERNOR MEMBERSHIP — AND WHY IT MUST BE HANDED BACK
 * ===========================================================================
 * `consume_revocation_scope_v1` grants EXECUTE to `kitluy_credential_issuer`
 * and to nothing else, and this connection's `postgres` is NOT a superuser
 * here and holds no such membership. The migrations themselves solve this with
 * a borrow/hand-back dance (group 0142's `$borrow$` / `$hand_back$` blocks) and
 * this suite does the same.
 *
 * The hand-back is not politeness. `supabase/tests/assertions.sql` asserts
 * outright that no non-superuser retains membership of
 * `kitluy_credential_issuer` ("a non-superuser retains membership of
 * kitluy_credential_issuer"), so a leaked membership would fail the next
 * `db:test`. `afterAll` therefore revokes it in a `finally` and VERIFIES the
 * revoke landed.
 */
import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  devDatabaseUrl,
  isDevDatabaseReachable,
  reportSkippedIntegration,
} from "./support/dev-database.js";

const SUITE = "@kitluy/device-identity scope-consumption concurrency";

/** Set by teardown when the borrowed governor membership could not be returned. */
let handBackFailure: string | null = null;

// A skip is never evidence. Copied from the other *.integration.test.ts files
// so an unreachable stack reports SKIPPED rather than a green run.
const reachable = await isDevDatabaseReachable();
if (!reachable) {
  reportSkippedIntegration(SUITE);
}

// ---------------------------------------------------------------------------
// Constants taken from the migrations under test, never guessed.
// ---------------------------------------------------------------------------
const ENVIRONMENT = "development";
const PURPOSE = "device_identity";
/** Group 0141's `revocation_recorded_scopes.decision_version` default. */
const DECISION_VERSION = "KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002";
/** Group 0141's `subject_type` default. */
const SUBJECT_TYPE = "CREDENTIAL";
const GOVERNOR_ROLE = "kitluy_credential_issuer";
const ISSUANCE_ROLE = "kitluy_issuance_service";
/** Created by `supabase/tests/assertions.sql`, NOT by the seed. */
const HARDWARE_PROFILE_KEY = "WS11-T001-HUB-PROBE";
/** Seeded `auth.users` rows; `approval_requests.requester_id` has an FK to them. */
const REQUESTER_USER = "00000000-0000-4000-8000-000000000007";
const APPROVER_ONE = "00000000-0000-4000-8000-000000000008";
const APPROVER_TWO = "00000000-0000-4000-8000-000000000009";
const TENANT_ID = "00000000-0000-4000-8000-000000000011";
const DIGITAL_STORE_ID = "00000000-0000-4000-8000-000000000015";
const STORE_LOCATION_ID = "00000000-0000-4000-8000-000000000018";

/** Per-run marker, so this suite can never collide with a parallel run. */
const RUN_ID = randomUUID().replace(/-/g, "").slice(0, 12);

const LONG_TEST_MS = 120_000;
/** How long the observer will wait for the loser to be visibly parked. */
const BLOCK_OBSERVATION_TIMEOUT_MS = 20_000;
/**
 * Statement timeout for the calls that must NOT block. Short enough that a
 * lock wait becomes a 57014 failure instead of a slow pass.
 */
const NON_BLOCKING_TIMEOUT_MS = 2_500;

// ---------------------------------------------------------------------------
// Small, typed plumbing.
// ---------------------------------------------------------------------------
type Json = Record<string, unknown>;

interface DbFailure {
  readonly sqlState: string;
  readonly message: string;
}

type Settled<T> =
  | { readonly ok: true; readonly value: T; readonly elapsedMs: number }
  | { readonly ok: false; readonly failure: DbFailure; readonly elapsedMs: number };

function toFailure(error: unknown): DbFailure {
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
async function settle<T>(start: () => Promise<T>): Promise<Settled<T>> {
  const startedAt = Date.now();
  try {
    return { ok: true, value: await start(), elapsedMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, failure: toFailure(error), elapsedMs: Date.now() - startedAt };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asJson(value: unknown): Json {
  return value !== null && typeof value === "object" ? (value as Json) : {};
}

function text(value: Json, key: string): string | null {
  const found = value[key];
  return typeof found === "string" ? found : null;
}

// ---------------------------------------------------------------------------
// Backends. `pg.Client`, not `pg.Pool`: a pool can hand back the same physical
// connection, and "two clients" that share a backend is not concurrency.
// ---------------------------------------------------------------------------
interface Backend {
  readonly label: string;
  readonly client: pg.Client;
  readonly pid: number;
}

async function openBackend(label: string): Promise<Backend> {
  const client = new pg.Client({
    connectionString: devDatabaseUrl(),
    application_name: `kitluy-scope-conc-${label}-${RUN_ID}`,
  });
  await client.connect();
  const { rows } = await client.query<{ pid: string }>("select pg_backend_pid()::text as pid");
  const pid = Number(rows[0]?.pid ?? "0");
  if (!Number.isFinite(pid) || pid === 0) {
    throw new Error(`could not read a backend pid for connection ${label}`);
  }
  return { label, client, pid };
}

/**
 * Opens a transaction and returns the SERVER's transaction id.
 *
 * `pg_current_xact_id()` assigns a real xid on the spot, which is what makes
 * "A started before B" a fact from PostgreSQL's own monotonic counter rather
 * than an assumption about the order of two awaits in this file.
 */
async function beginTransaction(backend: Backend, role?: string): Promise<bigint> {
  await backend.client.query("begin");
  if (role !== undefined) {
    // SET LOCAL, never a plain role switch: it is undone by commit/rollback,
    // so a leaked role cannot make a later assertion pass under the wrong
    // identity.
    await backend.client.query(`set local role ${role}`);
  }
  const { rows } = await backend.client.query<{ xid: string }>(
    "select pg_current_xact_id()::text as xid",
  );
  return BigInt(rows[0]?.xid ?? "0");
}

async function endTransaction(backend: Backend, how: "commit" | "rollback"): Promise<void> {
  await backend.client.query(how).catch(async () => {
    // An aborted transaction only accepts rollback.
    await backend.client.query("rollback").catch(() => undefined);
  });
}

// ---------------------------------------------------------------------------
// THE BARRIER OBSERVER.
//
// A third connection, so the claim "B was blocked" is made by the server and
// not by this file. Reads pg_stat_activity for the wait, and pg_locks for the
// UNGRANTED lock B is actually parked on — which names the constraint or the
// row doing the serialising.
// ---------------------------------------------------------------------------
interface BlockObservation {
  readonly pid: number;
  readonly state: string;
  readonly waitEventType: string;
  readonly waitEvent: string;
  readonly ungrantedLocks: readonly string[];
  readonly holderState: string;
  readonly observedAfterMs: number;
}

async function observeBlocked(
  observer: Backend,
  blocked: Backend,
  holder: Backend,
): Promise<BlockObservation> {
  const startedAt = Date.now();
  let last = "no pg_stat_activity row was ever read";
  while (Date.now() - startedAt < BLOCK_OBSERVATION_TIMEOUT_MS) {
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
    `${blocked.label} never entered a lock wait within ${BLOCK_OBSERVATION_TIMEOUT_MS}ms; ` +
      `last pg_stat_activity read: ${last}. Without a real block there is no race to report.`,
  );
}

// ---------------------------------------------------------------------------
// Evidence. Every scenario records the same shape, and the whole set is
// printed once at the end so the run itself carries the proof.
// ---------------------------------------------------------------------------
interface RaceEvidence {
  readonly scenario: string;
  readonly alphaPid: number;
  readonly betaPid: number;
  readonly alphaXid: string;
  readonly betaXid: string;
  readonly transactionStartOrder: string;
  readonly barrier: string;
  readonly betaBlocked: BlockObservation | null;
  readonly winner: string;
  readonly loser: string;
  readonly loserSqlState: string | null;
  readonly loserOutcome: string | null;
  readonly finalState: Json;
}

const evidence: RaceEvidence[] = [];

function record(entry: RaceEvidence): void {
  evidence.push(entry);
  console.info(`\n[race evidence] ${entry.scenario}\n${JSON.stringify(entry, null, 2)}`);
}

// ---------------------------------------------------------------------------
// Fixtures. Committed, run-unique, registered for cleanup.
// ---------------------------------------------------------------------------
interface BoundScope {
  readonly label: string;
  readonly incidentReference: string;
  readonly scopeId: string;
  readonly approvalId: string;
  readonly policyId: string;
  readonly scopeDigest: string;
  readonly payloadHash: string;
  readonly deviceIds: readonly string[];
}

const disposableScopeIds: string[] = [];
const disposableApprovalIds: string[] = [];
const disposablePolicyIds: string[] = [];
/** Rows deliberately NOT deleted — see the header. */
const retainedScopeIds: string[] = [];

let alpha: Backend;
let beta: Backend;
let observer: Backend;
/** Plain `postgres`, used for fixture construction and cleanup only. */
let keeper: Backend;
let governorBorrowed = false;

/**
 * Runs fixture work in a transaction that is ALWAYS closed.
 *
 * A `begin` whose body throws leaves the keeper connection in an aborted
 * transaction, and every later fixture on it fails with "current transaction is
 * aborted" — one real failure wearing five unrelated costumes, and a cleanup
 * that cannot run either.
 */
async function inKeeperTransaction<T>(fn: () => Promise<T>, role?: string): Promise<T> {
  await keeper.client.query("begin");
  try {
    if (role !== undefined) {
      await keeper.client.query(`set local role ${role}`);
    }
    const value = await fn();
    await keeper.client.query("commit");
    return value;
  } catch (error) {
    await keeper.client.query("rollback").catch(() => undefined);
    throw error;
  }
}

/**
 * Builds an approval whose `payload_hash` genuinely commits to the scope, and
 * the recorded scope bound to it.
 *
 * The hash is computed with the SAME functions group 0141's BEFORE INSERT
 * trigger uses, then read back and compared — so a fixture that quietly failed
 * to bind is caught here, not three scenarios later as a mystery refusal.
 */
async function createBoundScope(
  label: string,
  deviceIds: readonly string[],
  options: { readonly retain?: boolean } = {},
): Promise<BoundScope> {
  const client = keeper.client;
  const incidentReference = `INC-CONC-${RUN_ID}-${label}`;

  const digestRow = await client.query<{ digest: string; hash: string }>(
    `with canonical as (
       select kitluy_devices.revocation_scope_digest_v1(
                kitluy_devices.canonical_revocation_scope_v1(
                  'SECURITY_INCIDENT', $2::text, $3::text,
                  null, null, null, null, $4::text,
                  $1::uuid[], '{}'::text[], '{}'::text[], '{}'::uuid[])) as digest
     )
     select canonical.digest,
            kitluy_devices.revocation_approval_payload_hash_v1(
              canonical.digest, 'SECURITY_INCIDENT', $2::text, $3::text,
              null, null, null, $5::integer, null, $4::text) as hash
       from canonical`,
    [deviceIds, ENVIRONMENT, SUBJECT_TYPE, DECISION_VERSION, deviceIds.length],
  );
  const digest = digestRow.rows[0]?.digest ?? "";
  const payloadHash = digestRow.rows[0]?.hash ?? "";
  if (!/^[0-9a-f]{64}$/.test(digest) || !/^[0-9a-f]{64}$/.test(payloadHash)) {
    throw new Error(`fixture ${label} produced a malformed binding: ${digest} / ${payloadHash}`);
  }

  // A4 risk class and a quorum of two: group 0139's gate refuses anything
  // below A3, and four eyes is not relaxable (@kitluy/approvals).
  const policy = await client.query<{ id: string }>(
    `insert into kitluy_auth.approval_policies
       (policy_key, version, permission_key, environment, quorum, status, risk_class)
     values ($1, 1, 'device.credential.revoke', $2, 2, 'ACTIVE', 'A4')
     returning id`,
    [`conc.${RUN_ID}.${label}`, ENVIRONMENT],
  );
  const policyId = policy.rows[0]?.id ?? "";

  const approval = await client.query<{ id: string }>(
    `insert into kitluy_auth.approval_requests
       (policy_id, requester_id, resource_type, resource_id, environment, action,
        payload_hash, reason, status)
     values ($1::uuid, $2::uuid, 'device', $3::uuid, $4, 'device_credential_revocation',
             $5, $6, 'APPROVED')
     returning id`,
    [
      policyId,
      REQUESTER_USER,
      deviceIds[0] ?? null,
      ENVIRONMENT,
      payloadHash,
      `scope-consumption concurrency ${label}`,
    ],
  );
  const approvalId = approval.rows[0]?.id ?? "";

  await client.query(
    `insert into kitluy_auth.approval_decisions
       (approval_request_id, approver_id, decision, reason)
     values ($1::uuid, $2::uuid, 'APPROVE', 'concurrency fixture'),
            ($1::uuid, $3::uuid, 'APPROVE', 'concurrency fixture')`,
    [approvalId, APPROVER_ONE, APPROVER_TWO],
  );

  // `record_revocation_scope_v1` is granted to the issuance executor, so the
  // fixture is written through the governed door rather than around it.
  const recorded = await inKeeperTransaction(
    () =>
      client.query<{ result: unknown }>(
        `select kitluy_devices.record_revocation_scope_v1(
           $1::text, $2::text, 'SECURITY_INCIDENT', $3::uuid[],
           '{}'::text[], '{}'::text[], '{}'::uuid[],
           'analyst:a', 'approver:b', $4::text, $5::uuid) as result`,
        [incidentReference, ENVIRONMENT, deviceIds, `concurrency fixture ${label}`, approvalId],
      ),
    ISSUANCE_ROLE,
  );

  const result = asJson(recorded.rows[0]?.result);
  if (text(result, "outcome") !== "RECORDED") {
    throw new Error(`fixture ${label} could not record its scope: ${JSON.stringify(result)}`);
  }
  const scopeId = text(result, "incident_scope_id") ?? "";

  const stored = await client.query<{ scope_digest: string; payload_hash: string }>(
    `select scope_digest, payload_hash from kitluy_devices.revocation_recorded_scopes
      where incident_scope_id = $1::uuid`,
    [scopeId],
  );
  if (stored.rows[0]?.scope_digest !== digest || stored.rows[0]?.payload_hash !== payloadHash) {
    throw new Error(
      `fixture ${label}: the trigger-computed binding does not match the recomputed one`,
    );
  }

  if (options.retain === true) {
    retainedScopeIds.push(scopeId);
  } else {
    disposableScopeIds.push(scopeId);
    disposableApprovalIds.push(approvalId);
    disposablePolicyIds.push(policyId);
  }

  return {
    label,
    incidentReference,
    scopeId,
    approvalId,
    policyId,
    scopeDigest: digest,
    payloadHash,
    deviceIds,
  };
}

/**
 * Issues one real, revocable credential through the governed issuance path.
 *
 * Scenario 2 is the only one that needs it: the other scenarios contend over
 * the consumption table directly and name fictitious device ids, which the
 * scope columns accept because they carry no foreign key.
 */
async function createRevocableCredential(): Promise<{
  readonly deviceId: string;
  readonly credentialId: string;
}> {
  const client = keeper.client;
  const suffix = `${RUN_ID}-${randomUUID().slice(0, 8)}`;
  const fingerprint = randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64);

  const profile = await client.query<{ id: string }>(
    "select id from kitluy_devices.hardware_profiles where profile_key = $1",
    [HARDWARE_PROFILE_KEY],
  );
  const hardwareProfileId = profile.rows[0]?.id;
  if (hardwareProfileId === undefined) {
    // Said explicitly: this profile comes from supabase/tests/assertions.sql,
    // not from the seed, so a missing one means the canonical order was not run.
    throw new Error(
      `hardware profile ${HARDWARE_PROFILE_KEY} is absent. It is created by ` +
        `supabase/tests/assertions.sql (pnpm db:test), not by the seed.`,
    );
  }

  const enrolled = await client.query<{ id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1, $2::uuid, now(), $3, 'ed25519', 'software', $4, $5, $6::jsonb) as id`,
    [
      `KL-SCOPE-CONC-${suffix}`,
      hardwareProfileId,
      fingerprint,
      `STATION-CONC-${RUN_ID}`,
      `OP-CONC-${RUN_ID}`,
      JSON.stringify([
        { signal_type: "mac_address", signal_value: `ac:${suffix.slice(0, 10)}` },
        { signal_type: "board_serial", signal_value: `board-${suffix}` },
        { signal_type: "storage_serial", signal_value: `nvme-${suffix}` },
      ]),
    ],
  );
  const deviceId = enrolled.rows[0]?.id ?? "";

  const claimToken = randomUUID().replace(/-/g, "").padEnd(64, "1").slice(0, 64);
  const claimPayload = randomUUID().replace(/-/g, "").padEnd(64, "2").slice(0, 64);
  await client.query(
    `select kitluy_devices.create_device_claim_v1(
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, $7)`,
    [deviceId, TENANT_ID, DIGITAL_STORE_ID, STORE_LOCATION_ID, claimToken, claimPayload, "OP-CONC"],
  );
  await client.query("select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, $4)", [
    claimToken,
    claimPayload,
    deviceId,
    "HUB-CONC",
  ]);

  const requestId = `rq-conc-${suffix}`;
  const idempotencyKey = randomUUID().replace(/-/g, "").padEnd(64, "3").slice(0, 64);
  await inKeeperTransaction(async () => {
    const prepared = await client.query<{ result: unknown }>(
      `select kitluy_devices.prepare_device_credential_issuance_v1(
         $1, $2::uuid, $3, $4, 1, $5, $6, $7, $8, 'ed25519', $9,
         decode('a1', 'hex'), true, $10, now() - interval '1 day', 'trusted', 'SVC') as result`,
      [
        requestId,
        deviceId,
        ENVIRONMENT,
        PURPOSE,
        `PEM-CONC-${suffix}`,
        fingerprint,
        idempotencyKey,
        "9".repeat(64),
        "8".repeat(64),
        `ica-conc-${RUN_ID}`,
      ],
    );
    const canonicalTbsHash = text(asJson(prepared.rows[0]?.result), "canonical_tbs_hash") ?? "";
    await client.query(
      `select kitluy_devices.record_device_credential_signature_v1(
         $1, $2, decode('1111', 'hex'), true, 'SVC')`,
      [requestId, canonicalTbsHash],
    );
    await client.query(
      `select kitluy_devices.finalize_device_credential_issuance_v1($1, $2::jsonb, 'SVC')`,
      [
        requestId,
        JSON.stringify([
          {
            link_position: 0,
            role: "root",
            subject_fingerprint: "r".repeat(64),
            issuer_key_id: "rk",
            canonical_tbs: "R",
            detached_signature_b64: "qg==",
          },
          {
            link_position: 1,
            role: "intermediate",
            subject_fingerprint: "i".repeat(64),
            issuer_key_id: "rk",
            canonical_tbs: "I",
            detached_signature_b64: "uw==",
          },
        ]),
      ],
    );
  }, ISSUANCE_ROLE);

  const credential = await client.query<{ credential_id: string; state: string }>(
    `select credential_id, state::text as state from kitluy_devices.device_credentials
      where device_record_id = $1::uuid and environment = $2 and purpose = $3
        and certificate_generation = 1`,
    [deviceId, ENVIRONMENT, PURPOSE],
  );
  const credentialId = credential.rows[0]?.credential_id;
  if (credentialId === undefined || credential.rows[0]?.state !== "issued") {
    throw new Error(`the fixture device ${deviceId} holds no issued credential`);
  }
  return { deviceId, credentialId };
}

// ---------------------------------------------------------------------------
// Call wrappers, so every scenario invokes exactly the shipped signatures.
// ---------------------------------------------------------------------------
function consume(
  backend: Backend,
  args: {
    readonly scopeId: string;
    readonly approvalId: string;
    readonly revocationId: string;
    readonly consumedBy: string;
  },
): Promise<Json> {
  return backend.client
    .query<{ result: unknown }>(
      `select kitluy_devices.consume_revocation_scope_v1(
         $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text) as result`,
      [args.scopeId, args.approvalId, args.revocationId, ENVIRONMENT, args.consumedBy],
    )
    .then((res) => asJson(res.rows[0]?.result));
}

function scopedRevoke(
  backend: Backend,
  args: {
    readonly revocationRequestId: string;
    readonly deviceId: string;
    readonly reason: string;
    readonly requestedBy: string;
    readonly approvedBy: string;
    readonly scopeId: string;
    readonly approvalId: string;
    readonly incidentReference: string;
  },
): Promise<Json> {
  return backend.client
    .query<{ result: unknown }>(
      `select kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
         $1::text, $2::uuid, $3::text, $4::text, 1,
         'SECURITY_INCIDENT'::kitluy_devices.credential_revocation_reason, $5::text,
         'REPROVISION_REQUIRED'::kitluy_devices.credential_recovery_disposition,
         $6::text, 'SCOPE-CONC', $7::uuid, $8::uuid, $9::text, $10::text) as result`,
      [
        args.revocationRequestId,
        args.deviceId,
        ENVIRONMENT,
        PURPOSE,
        args.reason,
        args.requestedBy,
        args.scopeId,
        args.approvalId,
        args.approvedBy,
        args.incidentReference,
      ],
    )
    .then((res) => asJson(res.rows[0]?.result));
}

async function countRows(sql: string, params: readonly unknown[]): Promise<number> {
  const { rows } = await keeper.client.query<{ n: string }>(sql, [...params]);
  return Number(rows[0]?.n ?? "0");
}

// ===========================================================================
describe.skipIf(!reachable)("scope consumption under real concurrency", () => {
  beforeAll(async () => {
    keeper = await openBackend("keeper");

    // The borrow. Mirrors group 0142's own $borrow$ block; handed back in
    // afterAll, because assertions.sql fails if it is not.
    await keeper.client.query(
      `do $borrow$ begin execute format('grant ${GOVERNOR_ROLE} to %I', current_user); end $borrow$;`,
    );
    governorBorrowed = true;

    alpha = await openBackend("alpha");
    beta = await openBackend("beta");
    observer = await openBackend("observer");

    // The premise of every scenario below. If these ever coincided, the file
    // would be measuring one backend arguing with itself.
    const pids = new Set([alpha.pid, beta.pid, observer.pid, keeper.pid]);
    expect(pids.size).toBe(4);
  }, LONG_TEST_MS);

  /**
   * A FAILED assertion mid-scenario leaves alpha or beta holding an open
   * transaction, and an open transaction holds locks on exactly the rows
   * cleanup then tries to delete. The first version of this file deadlocked its
   * own `afterAll` that way: one failing expect turned into a 120-second hook
   * timeout and a cleanup that never ran. Releasing here means a failure stays
   * one failure.
   */
  afterEach(async () => {
    for (const backend of [alpha, beta, observer]) {
      await backend?.client.query("rollback").catch(() => undefined);
    }
  });

  afterAll(async () => {
    try {
      if (keeper !== undefined) {
        // A failed test can leave this connection mid-transaction; without
        // this the whole cleanup would fail as "transaction is aborted".
        await keeper.client.query("rollback").catch(() => undefined);
        // session_replication_role = replica suppresses the append-only
        // triggers for THIS SESSION only — no DDL, no ACCESS EXCLUSIVE lock on
        // a shared table, nothing another session can observe. A TEST-ONLY
        // escape, and loud about being one. Children before parents anyway,
        // because replica mode also stops the foreign keys from arguing.
        await inKeeperTransaction(async () => {
          await keeper.client.query("set local session_replication_role = replica");
          // Cleanup must never be the thing that hangs a run: a leftover lock
          // becomes a fast, reported failure rather than a hook timeout.
          await keeper.client.query("set local lock_timeout = 5000");
          await keeper.client.query(
            `delete from kitluy_devices.revocation_scope_consumptions
              where incident_scope_id = any($1::uuid[])`,
            [disposableScopeIds],
          );
          await keeper.client.query(
            `delete from kitluy_devices.revocation_recorded_scopes
              where incident_scope_id = any($1::uuid[])`,
            [disposableScopeIds],
          );
          await keeper.client.query(
            `delete from kitluy_auth.approval_decisions
              where approval_request_id = any($1::uuid[])`,
            [disposableApprovalIds],
          );
          await keeper.client.query(
            `delete from kitluy_auth.approval_requests where id = any($1::uuid[])`,
            [disposableApprovalIds],
          );
          await keeper.client.query(
            `delete from kitluy_auth.approval_policies where id = any($1::uuid[])`,
            [disposablePolicyIds],
          );
        });
      }
    } catch (error) {
      // Cleanup failure must be VISIBLE; it must not also hide the hand-back.
      console.warn(`${SUITE}: fixture cleanup failed: ${toFailure(error).message}`);
      await keeper?.client.query("rollback").catch(() => undefined);
    } finally {
      let handBackError: string | null = null;
      if (governorBorrowed && keeper !== undefined) {
        try {
          await keeper.client.query(
            `do $hand_back$ begin execute format('revoke ${GOVERNOR_ROLE} from %I', current_user); end $hand_back$;`,
          );
          const { rows } = await keeper.client.query<{ still: boolean }>(
            `select pg_has_role(current_user, '${GOVERNOR_ROLE}', 'MEMBER') as still`,
          );
          if (rows[0]?.still === true) {
            handBackError = `the borrowed ${GOVERNOR_ROLE} membership was NOT handed back`;
          }
        } catch (error) {
          handBackError = `hand-back failed: ${toFailure(error).message}`;
        }
      }

      if (evidence.length > 0) {
        console.info(
          `\n[race evidence summary] ${SUITE}\n${JSON.stringify(
            evidence.map((entry) => ({
              scenario: entry.scenario,
              pids: `${entry.alphaPid}/${entry.betaPid}`,
              order: entry.transactionStartOrder,
              blockedOn: entry.betaBlocked?.ungrantedLocks ?? [],
              winner: entry.winner,
              loser: entry.loser,
              loserSqlState: entry.loserSqlState,
              loserOutcome: entry.loserOutcome,
            })),
            null,
            2,
          )}`,
        );
        console.info(
          `[residue retained on purpose] scopes=${JSON.stringify(retainedScopeIds)} — ` +
            `the scenario-2 device, its revoked credential and the evidence explaining ` +
            `that revocation are append-only and are left consistent rather than deleted.`,
        );
      }

      for (const backend of [alpha, beta, observer, keeper]) {
        await backend?.client.end().catch(() => undefined);
      }
      // Recorded, NOT thrown. A `throw` inside `finally` replaces whatever
      // exception was already propagating, so a failed hand-back would erase
      // the test failure that caused it — the one thing a reader needs. The
      // dedicated assertion below fails the suite instead, and cannot hide
      // anything.
      if (handBackError !== null) {
        handBackFailure = `${SUITE}: ${handBackError}`;
        console.error(handBackFailure);
      }
    }
  }, LONG_TEST_MS);

  // A retained governor membership is exactly what section 32's containment
  // assertion refuses, so it must fail the suite — but as its own assertion,
  // never as a throw from `finally`.
  it("hands the borrowed governor membership back", () => {
    expect(handBackFailure).toBeNull();
  });

  // -------------------------------------------------------------------------
  // SCENARIO 1 — two connections consume the SAME recorded scope.
  //
  // The UNIQUE constraint `revocation_scope_consumptions_scope_once` is the
  // decision. B does not "check and find it taken"; B inserts, collides with an
  // in-progress tuple, and PARKS until A resolves.
  // -------------------------------------------------------------------------
  it(
    "lets exactly one of two concurrent transactions consume the same recorded scope",
    async () => {
      const fixture = await createBoundScope("s1", [randomUUID()]);
      const revocationA = randomUUID();
      const revocationB = randomUUID();

      const alphaXid = await beginTransaction(alpha, GOVERNOR_ROLE);
      const winnerResult = await consume(alpha, {
        scopeId: fixture.scopeId,
        approvalId: fixture.approvalId,
        revocationId: revocationA,
        consumedBy: "alpha",
      });
      expect(text(winnerResult, "outcome")).toBe("CONSUMED");

      // A holds the index tuple and has NOT committed. B now attempts the same.
      const betaXid = await beginTransaction(beta, GOVERNOR_ROLE);
      expect(betaXid > alphaXid).toBe(true);
      const betaRace = settle(() =>
        consume(beta, {
          scopeId: fixture.scopeId,
          approvalId: fixture.approvalId,
          revocationId: revocationB,
          consumedBy: "beta",
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");
      expect(blocked.state).toBe("active");
      // The winner must still be OPEN at the moment the loser is parked —
      // otherwise the two were never in flight together.
      expect(blocked.holderState).toBe("idle in transaction");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "commit");

      expect(loser.ok).toBe(true);
      const loserResult = loser.ok ? loser.value : {};
      expect(text(loserResult, "outcome")).toBe("SCOPE_REFUSED");
      expect(text(loserResult, "refusal_code")).toBe("KLUY-CRED-REVOCATION-SCOPE-CONSUMED");

      const consumptions = await keeper.client.query<{
        revocation_id: string;
        consumed_by: string;
      }>(
        `select revocation_id, consumed_by from kitluy_devices.revocation_scope_consumptions
          where incident_scope_id = $1::uuid`,
        [fixture.scopeId],
      );
      expect(consumptions.rowCount).toBe(1);
      expect(consumptions.rows[0]?.revocation_id).toBe(revocationA);
      expect(consumptions.rows[0]?.consumed_by).toBe("alpha");

      record({
        scenario: "1: two connections consume the same recorded scope",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "alpha inserted the consumption row and held it uncommitted; beta's insert " +
          "collided with the in-progress tuple on revocation_scope_consumptions_scope_once",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid})`,
        loser: `beta (pid ${beta.pid})`,
        loserSqlState: null,
        loserOutcome: `${text(loserResult, "outcome")} / ${text(loserResult, "refusal_code")}`,
        finalState: {
          consumption_rows_for_scope: consumptions.rowCount,
          winning_revocation_id: consumptions.rows[0]?.revocation_id ?? null,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 2 — THE DECISIVE ONE.
  //
  // Two connections run the whole scoped revocation against one scope. Group
  // 0142 step 4 RAISES on a losing consumption specifically so the revocation
  // written moments earlier in the SAME transaction dies with it. If the
  // loser's revocation survived, Ruling 1's "atomic with revocation" would be
  // false and one approval would have authorized two revocations.
  //
  // So this test does not merely count revocations. It proves the loser left
  // NOTHING: no evidence row, no recovery case, no consumption, and no mark on
  // the credential — the reason text on `device_credentials` is the winner's,
  // and the two callers deliberately use DIFFERENT reason text so a surviving
  // loser update would be unmistakable.
  // -------------------------------------------------------------------------
  it(
    "rolls the loser's revocation back with its losing consumption, leaving no residue",
    async () => {
      const credential = await createRevocableCredential();
      const fixture = await createBoundScope("s2", [credential.deviceId], { retain: true });
      const requestA = `rev-conc-${RUN_ID}-winner`;
      const requestB = `rev-conc-${RUN_ID}-loser`;
      const reasonA = "the incident the approvers actually approved";
      const reasonB = "the same authority, spent a second time";

      const alphaXid = await beginTransaction(alpha, ISSUANCE_ROLE);
      const winnerResult = await scopedRevoke(alpha, {
        revocationRequestId: requestA,
        deviceId: credential.deviceId,
        reason: reasonA,
        requestedBy: "requester:a",
        approvedBy: "approver:b",
        scopeId: fixture.scopeId,
        approvalId: fixture.approvalId,
        incidentReference: fixture.incidentReference,
      });
      expect(text(winnerResult, "outcome")).toBe("REVOKED");
      expect(winnerResult.scope_consumed).toBe(true);
      const winningRevocationId = text(winnerResult, "revocation_id") ?? "";

      // A is UNCOMMITTED and holds the credential row lock plus the consumption
      // tuple. B now runs the identical governed call.
      const betaXid = await beginTransaction(beta, ISSUANCE_ROLE);
      expect(betaXid > alphaXid).toBe(true);
      const betaRace = settle(() =>
        scopedRevoke(beta, {
          revocationRequestId: requestB,
          deviceId: credential.deviceId,
          reason: reasonB,
          requestedBy: "requester:c",
          approvedBy: "approver:d",
          scopeId: fixture.scopeId,
          approvalId: fixture.approvalId,
          incidentReference: fixture.incidentReference,
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");
      expect(blocked.holderState).toBe("idle in transaction");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "rollback");

      // The loser must FAIL, not return a refusal: a return would commit the
      // revocation it had already written.
      expect(loser.ok).toBe(false);
      const loserFailure = loser.ok
        ? { sqlState: "", message: "the loser did NOT fail" }
        : loser.failure;
      expect(loserFailure.sqlState).toBe("23505");
      expect(loserFailure.message).toContain("KLUY-CRED-REVOCATION-SCOPE-CONSUMED");

      // ---- residue, one probe per thing the loser could have left behind ----
      const revocations = await keeper.client.query<{
        revocation_id: string;
        revocation_request_id: string;
        reason: string;
      }>(
        `select revocation_id, revocation_request_id, reason
           from kitluy_devices.device_credential_revocations
          where approval_request_id = $1::uuid
          order by sequence_no`,
        [fixture.approvalId],
      );
      const loserRevocations = await countRows(
        `select count(*)::text as n from kitluy_devices.device_credential_revocations
          where revocation_request_id = $1`,
        [requestB],
      );
      const consumptions = await countRows(
        `select count(*)::text as n from kitluy_devices.revocation_scope_consumptions
          where incident_scope_id = $1::uuid`,
        [fixture.scopeId],
      );
      const recoveryCases = await countRows(
        `select count(*)::text as n from kitluy_devices.device_recovery_cases
          where device_record_id = $1::uuid`,
        [credential.deviceId],
      );
      const credentialRow = await keeper.client.query<{
        state: string;
        revocation_reason: string | null;
        revoked_at: Date | null;
      }>(
        `select state::text as state, revocation_reason, revoked_at
           from kitluy_devices.device_credentials where credential_id = $1::uuid`,
        [credential.credentialId],
      );

      expect(revocations.rowCount).toBe(1);
      expect(revocations.rows[0]?.revocation_request_id).toBe(requestA);
      expect(revocations.rows[0]?.revocation_id).toBe(winningRevocationId);
      // THE point of the scenario, stated as its own assertion so a failure
      // here reads as what it is.
      expect(loserRevocations).toBe(0);
      expect(consumptions).toBe(1);
      expect(recoveryCases).toBe(1);
      expect(credentialRow.rows[0]?.state).toBe("revoked");
      expect(credentialRow.rows[0]?.revoked_at).not.toBeNull();
      expect(credentialRow.rows[0]?.revocation_reason).toContain(reasonA);
      expect(credentialRow.rows[0]?.revocation_reason).not.toContain(reasonB);

      record({
        scenario: "2: two connections run the scoped revocation against one scope (DECISIVE)",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "alpha revoked and consumed inside an uncommitted transaction, holding the " +
          "device_credentials row lock; beta blocked reaching the same row",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid}) revocation ${winningRevocationId}`,
        loser: `beta (pid ${beta.pid}) request ${requestB}`,
        loserSqlState: loserFailure.sqlState,
        loserOutcome: loserFailure.message.split("\n")[0] ?? "",
        finalState: {
          revocations_for_approval: revocations.rowCount,
          loser_revocation_rows: loserRevocations,
          consumption_rows_for_scope: consumptions,
          recovery_cases_for_device: recoveryCases,
          credential_state: credentialRow.rows[0]?.state ?? null,
          credential_revocation_reason: credentialRow.rows[0]?.revocation_reason ?? null,
          loser_left_residue: loserRevocations !== 0 || consumptions !== 1 || recoveryCases !== 1,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 3 — two DIFFERENT revocations race for ONE approval.
  //
  // A distinct replay from scenario 1: re-using the APPROVAL rather than the
  // scope. The database refuses it TWICE, in two independent places, and this
  // test proves both because only one of them is a race:
  //
  //   * `revocation_recorded_scopes_approval_idx`, a partial UNIQUE index on
  //     (environment, approval_request_id), means a second SCOPE can never even
  //     be recorded against an approval that already has one. Proved first,
  //     because a reader who only saw the second half would reasonably conclude
  //     two scopes on one approval is a reachable state;
  //   * `revocation_scope_consumptions_approval_once`, which decides the race
  //     when two consumptions arrive carrying the same approval id. That is the
  //     constraint under concurrency here, and it is defence in depth rather
  //     than dead code: it is the layer that holds if the recorded-scope index
  //     is ever relaxed.
  // -------------------------------------------------------------------------
  it(
    "lets at most one revocation consume a single approval",
    async () => {
      const first = await createBoundScope("s3a", [randomUUID()]);
      const second = await createBoundScope("s3b", [randomUUID()]);

      // Layer one: a second recorded scope on the same approval is refused
      // outright, before any concurrency is involved.
      const secondScopeOnOneApproval = await settle(() =>
        inKeeperTransaction(
          () =>
            keeper.client.query(
              `select kitluy_devices.record_revocation_scope_v1(
                 $1::text, $2::text, 'SECURITY_INCIDENT', $3::uuid[],
                 '{}'::text[], '{}'::text[], '{}'::uuid[],
                 'analyst:a', 'approver:b', 'second scope, same approval', $4::uuid)`,
              [`INC-CONC-${RUN_ID}-s3dup`, ENVIRONMENT, [randomUUID()], first.approvalId],
            ),
          ISSUANCE_ROLE,
        ),
      );
      expect(secondScopeOnOneApproval.ok).toBe(false);
      const scopeLayerFailure = secondScopeOnOneApproval.ok
        ? { sqlState: "", message: "a SECOND scope was recorded against one approval" }
        : secondScopeOnOneApproval.failure;
      expect(scopeLayerFailure.sqlState).toBe("23505");
      expect(scopeLayerFailure.message).toContain("revocation_recorded_scopes_approval_idx");

      // Layer two: the race. Two distinct scopes, two distinct revocations, one
      // approval id presented to `consume_revocation_scope_v1`.
      const revocationA = randomUUID();
      const revocationB = randomUUID();

      const alphaXid = await beginTransaction(alpha, GOVERNOR_ROLE);
      const winnerResult = await consume(alpha, {
        scopeId: first.scopeId,
        approvalId: first.approvalId,
        revocationId: revocationA,
        consumedBy: "alpha",
      });
      expect(text(winnerResult, "outcome")).toBe("CONSUMED");

      const betaXid = await beginTransaction(beta, GOVERNOR_ROLE);
      const betaRace = settle(() =>
        consume(beta, {
          scopeId: second.scopeId,
          approvalId: first.approvalId,
          revocationId: revocationB,
          consumedBy: "beta",
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");
      expect(blocked.holderState).toBe("idle in transaction");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "commit");

      const loserResult = loser.ok ? loser.value : {};
      expect(loser.ok).toBe(true);
      expect(text(loserResult, "outcome")).toBe("SCOPE_REFUSED");
      expect(text(loserResult, "refusal_code")).toBe("KLUY-CRED-REVOCATION-SCOPE-CONSUMED");

      const forApproval = await countRows(
        `select count(*)::text as n from kitluy_devices.revocation_scope_consumptions
          where approval_request_id = $1::uuid`,
        [first.approvalId],
      );
      const forLosingScope = await countRows(
        `select count(*)::text as n from kitluy_devices.revocation_scope_consumptions
          where incident_scope_id = $1::uuid`,
        [second.scopeId],
      );
      expect(forApproval).toBe(1);
      expect(forLosingScope).toBe(0);

      record({
        scenario: "3: two different revocations race to consume ONE approval",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "alpha held an uncommitted consumption row carrying the approval id; beta's " +
          "insert collided on revocation_scope_consumptions_approval_once",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid})`,
        loser: `beta (pid ${beta.pid})`,
        loserSqlState: null,
        loserOutcome: `${text(loserResult, "outcome")} / ${text(loserResult, "refusal_code")}`,
        finalState: {
          second_scope_on_one_approval_sqlstate: scopeLayerFailure.sqlState,
          consumptions_for_approval: forApproval,
          consumptions_for_losing_scope: forLosingScope,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 4 — one revocation id, two scopes and two approvals.
  //
  // The third replay: attaching two scopes to one revocation.
  // `revocation_scope_consumptions_revocation_once` is the only constraint that
  // can refuse it, because scope and approval both differ.
  // -------------------------------------------------------------------------
  it(
    "refuses a second consumption that reuses a revocation id",
    async () => {
      const first = await createBoundScope("s4a", [randomUUID()]);
      const second = await createBoundScope("s4b", [randomUUID()]);
      const sharedRevocationId = randomUUID();

      const alphaXid = await beginTransaction(alpha, GOVERNOR_ROLE);
      const winnerResult = await consume(alpha, {
        scopeId: first.scopeId,
        approvalId: first.approvalId,
        revocationId: sharedRevocationId,
        consumedBy: "alpha",
      });
      expect(text(winnerResult, "outcome")).toBe("CONSUMED");

      const betaXid = await beginTransaction(beta, GOVERNOR_ROLE);
      const betaRace = settle(() =>
        consume(beta, {
          scopeId: second.scopeId,
          approvalId: second.approvalId,
          revocationId: sharedRevocationId,
          consumedBy: "beta",
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");
      expect(blocked.holderState).toBe("idle in transaction");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "commit");

      const loserResult = loser.ok ? loser.value : {};
      expect(loser.ok).toBe(true);
      expect(text(loserResult, "outcome")).toBe("SCOPE_REFUSED");
      expect(text(loserResult, "refusal_code")).toBe("KLUY-CRED-REVOCATION-SCOPE-CONSUMED");

      const forRevocation = await countRows(
        `select count(*)::text as n from kitluy_devices.revocation_scope_consumptions
          where revocation_id = $1::uuid`,
        [sharedRevocationId],
      );
      const forLosingScope = await countRows(
        `select count(*)::text as n from kitluy_devices.revocation_scope_consumptions
          where incident_scope_id = $1::uuid`,
        [second.scopeId],
      );
      expect(forRevocation).toBe(1);
      expect(forLosingScope).toBe(0);

      record({
        scenario: "4: duplicate revocation id",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "alpha held an uncommitted consumption row carrying the revocation id; beta's " +
          "insert collided on revocation_scope_consumptions_revocation_once",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid})`,
        loser: `beta (pid ${beta.pid})`,
        loserSqlState: null,
        loserOutcome: `${text(loserResult, "outcome")} / ${text(loserResult, "refusal_code")}`,
        finalState: {
          consumptions_for_revocation_id: forRevocation,
          consumptions_for_losing_scope: forLosingScope,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 5 — the control.
  //
  // Everything above proves the boundary refuses. This proves it refuses only
  // what it must: two UNRELATED scopes consumed concurrently must not serialise
  // on each other. A table-level lock, or a constraint reaching wider than its
  // own key, would show up here as a 57014 statement timeout rather than as a
  // pass — which is why beta runs with a short statement_timeout instead of an
  // unbounded wait that could quietly succeed after alpha commits.
  // -------------------------------------------------------------------------
  it(
    "does not serialise two consumptions of different scopes",
    async () => {
      const first = await createBoundScope("s5a", [randomUUID()]);
      const second = await createBoundScope("s5b", [randomUUID()]);
      const revocationA = randomUUID();
      const revocationB = randomUUID();

      const alphaXid = await beginTransaction(alpha, GOVERNOR_ROLE);
      const alphaResult = await consume(alpha, {
        scopeId: first.scopeId,
        approvalId: first.approvalId,
        revocationId: revocationA,
        consumedBy: "alpha",
      });
      expect(text(alphaResult, "outcome")).toBe("CONSUMED");

      const betaXid = await beginTransaction(beta, GOVERNOR_ROLE);
      await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);

      // Alpha is provably still open at this instant, so if the locking were
      // over-broad beta could not get through.
      const holder = await observer.client.query<{ state: string }>(
        `select coalesce(state, '?') as state from pg_stat_activity where pid = $1`,
        [alpha.pid],
      );
      expect(holder.rows[0]?.state).toBe("idle in transaction");

      const betaRun = await settle(() =>
        consume(beta, {
          scopeId: second.scopeId,
          approvalId: second.approvalId,
          revocationId: revocationB,
          consumedBy: "beta",
        }),
      );

      await endTransaction(beta, betaRun.ok ? "commit" : "rollback");
      await endTransaction(alpha, "commit");

      expect(betaRun.ok).toBe(true);
      const betaResult = betaRun.ok ? betaRun.value : {};
      expect(text(betaResult, "outcome")).toBe("CONSUMED");
      expect(betaRun.elapsedMs).toBeLessThan(NON_BLOCKING_TIMEOUT_MS);

      const both = await countRows(
        `select count(*)::text as n from kitluy_devices.revocation_scope_consumptions
          where incident_scope_id = any($1::uuid[])`,
        [[first.scopeId, second.scopeId]],
      );
      expect(both).toBe(2);

      record({
        scenario: "5: two connections consume DIFFERENT scopes (no false serialisation)",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          `alpha's consumption stayed uncommitted (observed 'idle in transaction'); beta ran ` +
          `with statement_timeout=${NON_BLOCKING_TIMEOUT_MS}ms so a lock wait would have ` +
          `failed as 57014 rather than passing late`,
        betaBlocked: null,
        winner: "both — neither transaction blocked the other",
        loser: "none",
        loserSqlState: null,
        loserOutcome: null,
        finalState: {
          consumption_rows_for_both_scopes: both,
          beta_elapsed_ms: betaRun.elapsedMs,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 6 (the reach-if-you-can) — mutating a scope while it is being
  // consumed.
  //
  // `revocation_recorded_scopes` is append-only, so the mutation must be
  // refused REGARDLESS of ordering: with a consumption in flight, and with no
  // consumption in flight. Both orders are run, and the refusal is checked to
  // be a REFUSAL (P0001 / 42501) rather than a lock timeout (57014) — a
  // mutation that merely could not get a lock would be a very different fact.
  // -------------------------------------------------------------------------
  it(
    "refuses to mutate a recorded scope whether or not a consumption is in flight",
    async () => {
      const racing = await createBoundScope("s6a", [randomUUID()]);
      const quiet = await createBoundScope("s6b", [randomUUID()]);

      // --- order A: consumption in flight, then the mutation ---
      const alphaXid = await beginTransaction(alpha, GOVERNOR_ROLE);
      const held = await consume(alpha, {
        scopeId: racing.scopeId,
        approvalId: racing.approvalId,
        revocationId: randomUUID(),
        consumedBy: "alpha",
      });
      expect(text(held, "outcome")).toBe("CONSUMED");

      // As the TABLE OWNER, so what refuses is the append-only trigger and not
      // a missing grant.
      const betaXid = await beginTransaction(beta);
      await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
      const ownerUpdate = await settle(() =>
        beta.client.query(
          `update kitluy_devices.revocation_recorded_scopes
              set affected_device_ids = array[$1::uuid]
            where incident_scope_id = $2::uuid`,
          [randomUUID(), racing.scopeId],
        ),
      );
      await endTransaction(beta, "rollback");

      expect(ownerUpdate.ok).toBe(false);
      const ownerFailure = ownerUpdate.ok
        ? { sqlState: "", message: "the append-only mutation SUCCEEDED" }
        : ownerUpdate.failure;
      expect(ownerFailure.sqlState).toBe("P0001");
      expect(ownerFailure.message).toContain("KLUY-AUTH-APPEND-ONLY");

      // ...and the governor, the only role the scoped path ever runs as, holds
      // no UPDATE on the table at all.
      await beginTransaction(beta, GOVERNOR_ROLE);
      await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
      const governorUpdate = await settle(() =>
        beta.client.query(
          `update kitluy_devices.revocation_recorded_scopes
              set affected_device_ids = array[$1::uuid]
            where incident_scope_id = $2::uuid`,
          [randomUUID(), racing.scopeId],
        ),
      );
      await endTransaction(beta, "rollback");
      expect(governorUpdate.ok).toBe(false);
      const governorFailure = governorUpdate.ok
        ? { sqlState: "", message: "the governor MUTATED an append-only scope" }
        : governorUpdate.failure;
      expect(governorFailure.sqlState).toBe("42501");

      // A DELETE is refused too, but NOT by the same mechanism, and the
      // difference is worth writing down rather than smoothing over.
      //
      // The UPDATE above reached the append-only trigger because an UPDATE that
      // does not touch the key takes FOR NO KEY UPDATE, which is compatible
      // with the FOR KEY SHARE that alpha's consumption row holds on its FK
      // parent. A DELETE needs the exclusive row lock, so with a consumption in
      // flight it never gets as far as the trigger — it PARKS, and the short
      // statement_timeout turns that into an observable 57014 instead of a
      // silent late success.
      await beginTransaction(beta);
      await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
      const deleteWhileConsuming = await settle(() =>
        beta.client.query(
          `delete from kitluy_devices.revocation_recorded_scopes where incident_scope_id = $1::uuid`,
          [racing.scopeId],
        ),
      );
      await endTransaction(beta, "rollback");
      expect(deleteWhileConsuming.ok).toBe(false);
      expect(deleteWhileConsuming.ok ? "" : deleteWhileConsuming.failure.sqlState).toBe("57014");

      await endTransaction(alpha, "commit");

      // ...and with the consumption committed and the lock gone, the DELETE
      // gets its turn and is refused on the merits. Blocked THEN refused: the
      // scope survives either way, which is the property the scenario is for.
      await beginTransaction(beta);
      await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
      const deleteAfterwards = await settle(() =>
        beta.client.query(
          `delete from kitluy_devices.revocation_recorded_scopes where incident_scope_id = $1::uuid`,
          [racing.scopeId],
        ),
      );
      await endTransaction(beta, "rollback");
      expect(deleteAfterwards.ok).toBe(false);
      const deleteFailure = deleteAfterwards.ok
        ? { sqlState: "", message: "an append-only scope was DELETED" }
        : deleteAfterwards.failure;
      expect(deleteFailure.sqlState).toBe("P0001");
      expect(deleteFailure.message).toContain("KLUY-AUTH-APPEND-ONLY");

      // --- order B: the mutation FIRST, with nothing in flight ---
      await beginTransaction(beta);
      await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
      const quietUpdate = await settle(() =>
        beta.client.query(
          `update kitluy_devices.revocation_recorded_scopes
              set affected_device_ids = array[$1::uuid]
            where incident_scope_id = $2::uuid`,
          [randomUUID(), quiet.scopeId],
        ),
      );
      await endTransaction(beta, "rollback");
      expect(quietUpdate.ok).toBe(false);
      expect(quietUpdate.ok ? "" : quietUpdate.failure.sqlState).toBe("P0001");

      // ...and the untouched scope is still spendable afterwards, so the
      // refusal cost nobody their authority.
      await beginTransaction(alpha, GOVERNOR_ROLE);
      const afterwards = await consume(alpha, {
        scopeId: quiet.scopeId,
        approvalId: quiet.approvalId,
        revocationId: randomUUID(),
        consumedBy: "alpha",
      });
      await endTransaction(alpha, "commit");
      expect(text(afterwards, "outcome")).toBe("CONSUMED");

      const unchanged = await keeper.client.query<{
        scope_digest: string;
        payload_hash: string;
        device_ids: string[];
      }>(
        `select scope_digest, payload_hash, affected_device_ids as device_ids
           from kitluy_devices.revocation_recorded_scopes where incident_scope_id = $1::uuid`,
        [racing.scopeId],
      );
      expect(unchanged.rows[0]?.scope_digest).toBe(racing.scopeDigest);
      expect(unchanged.rows[0]?.payload_hash).toBe(racing.payloadHash);
      expect(unchanged.rows[0]?.device_ids).toEqual([...racing.deviceIds]);

      record({
        scenario: "6: scope mutation racing a consumption (append-only, order-independent)",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          `alpha held an uncommitted consumption of the scope; beta attempted the mutation ` +
          `with statement_timeout=${NON_BLOCKING_TIMEOUT_MS}ms, so a lock wait would read as ` +
          `57014 and is distinguishable from a refusal`,
        betaBlocked: null,
        winner: "the append-only rule, in both orderings",
        loser: `beta's mutation (pid ${beta.pid})`,
        loserSqlState:
          `update ${ownerFailure.sqlState} as owner, ${governorFailure.sqlState} as ` +
          `${GOVERNOR_ROLE}; delete ${deleteWhileConsuming.ok ? "SUCCEEDED" : deleteWhileConsuming.failure.sqlState} ` +
          `while consuming then ${deleteFailure.sqlState} afterwards`,
        loserOutcome: ownerFailure.message.split("\n")[0] ?? "",
        finalState: {
          scope_digest_unchanged: unchanged.rows[0]?.scope_digest === racing.scopeDigest,
          payload_hash_unchanged: unchanged.rows[0]?.payload_hash === racing.payloadHash,
          quiet_scope_still_spendable: text(afterwards, "outcome") === "CONSUMED",
        },
      });
    },
    LONG_TEST_MS,
  );
});
