/**
 * WS-11-T003 Step 4 Phase D — the GOVERNED EMERGENCY path under REAL
 * concurrency.
 *
 * Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.3/§2.4 and
 *   KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001. Under test: migration groups
 *   0149 (`consume_reauthentication_evidence_v1`), 0150/0152/0153
 *   (`revoke_device_credential_emergency_governed_v1`,
 *   `record_governed_emergency_post_approval_v1`,
 *   `lapse_governed_emergency_post_approvals_v1`), 0151 (the revoked legacy
 *   EXECUTE grants) and 0135 (the durable job lease).
 *
 * ===========================================================================
 * WHAT A SEQUENTIAL TEST CANNOT SAY
 * ===========================================================================
 * `supabase/tests/assertions.sql` sections 41c, 41d and 47 already drive every
 * one of these functions, and they establish the single-session properties: a
 * replayed idempotency key is refused, a spent scope cannot be spent twice, a
 * self post-approval is refused. What they cannot establish is the property the
 * decision actually asserts, which is about two transactions IN FLIGHT
 * TOGETHER. A sequential second call sees the first one's COMMITTED row and
 * never contends for anything, so it exercises the CHECK and not the RACE.
 *
 * Every scenario below therefore uses two separate `pg.Client` backends and a
 * third observer connection that reads `pg_stat_activity` and `pg_locks`, so
 * "the loser was blocked" is the server's claim rather than this file's. The
 * mechanics live in `test/support/race-harness.ts`; the reasoning for each is
 * in `race-harness.ts`'s header.
 *
 * ===========================================================================
 * THE THREE SCENARIOS THAT DO NOT BLOCK, AND WHY THAT IS THE POINT
 * ===========================================================================
 * `betaBlocked` is null for three scenarios, and a null there would otherwise
 * be indistinguishable from a race that never happened. Each is asserted
 * POSITIVELY instead of by absence:
 *
 *   * DUPLICATE LAPSE WORKERS and POST-APPROVAL VERSUS LAPSE. The sweeper uses
 *     `FOR UPDATE OF a SKIP LOCKED`, so the second reader is DESIGNED to walk
 *     past the locked authorization rather than park on it. The assertion is
 *     that exactly one verdict exists and the second call reports
 *     `lapsed_count` 0 — a block here would be the defect, because a sweeper
 *     that queues behind another sweeper is a sweeper that stalls the queue.
 *   * LEGACY RACING GOVERNED. The legacy RPC's EXECUTE was revoked from every
 *     runtime role by migration 0151, so the loser is refused by the permission
 *     system BEFORE it can reach a row lock. `42501` with no lock wait is the
 *     evidence; a lock wait would mean the legacy path had got far enough to
 *     contend, which is what Phase A removed.
 *
 * ===========================================================================
 * WHAT THIS SUITE BORROWS, AND WHAT IT REFUSES TO
 * ===========================================================================
 * The governed emergency and post-approval RPCs are granted to `authenticated`
 * — the human's own session — so the RACING connections need no borrowed role
 * at all. They impersonate a named human with `set local role authenticated`
 * plus transaction-local `request.jwt.claims`, both of which die with the
 * transaction.
 *
 * TWO FIXTURE STEPS still need memberships that no login holds:
 *
 *   1. `authoritative_revocation_scope_v1` is governor-only, and the
 *      normal-versus-emergency scenario needs the hash the DATABASE derives.
 *      That hash is ASKED FOR, never constructed here: a hash this file could
 *      build is a hash a caller could build, which is precisely what migration
 *      0145 got wrong.
 *   2. Bringing a `post_approval_due_at` deadline FORWARD, so the lapse
 *      scenarios do not have to wait out the real four-hour window. The
 *      deadline can only move earlier (0152's
 *      `KLUY-EMERGENCY-DEADLINE-FIXED`), so this cannot manufacture a
 *      post-approval that was still in time.
 *
 * Both borrow `kitluy_credential_issuer` on the KEEPER connection only, and
 * hand it straight back. `beforeAll` REFUSES TO START when the membership is
 * already held, because membership is CLUSTER-WIDE catalog state: handing back
 * somebody else's borrow would fail their run somewhere far away from this
 * file. The last test asserts the hand-back landed and `afterAll` repeats it as
 * a net.
 *
 * ===========================================================================
 * WHY THE PERMISSION GRANTS ARE TORN DOWN AND THE TEARDOWN IS ASSERTED
 * ===========================================================================
 * The scenarios grant seeded humans
 * `fleet.device_credential.emergency_revoke` and
 * `.emergency_post_approve`. Those grants are what several OTHER assertions in
 * this repository expect NOT to exist. A leaked grant would not make those
 * assertions fail; it would make them VACUOUS, which is worse, because a test
 * that cannot fail is still counted as evidence. `afterAll` removes every
 * grant, revokes every re-authentication evidence row this run created, and
 * ASSERTS that both are gone.
 *
 * ===========================================================================
 * WHY THE FIXTURES ARE COMMITTED, AND WHAT RESIDUE IS LEFT ON PURPOSE
 * ===========================================================================
 * Two connections must SEE each other's work, so the usual
 * `withDatabaseTransaction` rollback isolation is unavailable. Devices,
 * credentials, revocations, authorizations and post-approval verdicts are all
 * APPEND-ONLY by design and are left in place, exactly as
 * `supabase/tests/assertions.sql` leaves the devices it enrolls on every run.
 * Deleting a revocation would leave a credential in `revoked` state with
 * nothing explaining why, which is worse residue than the row itself. Every
 * fixture carries a per-run id so nothing else can reach it.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { isDevDatabaseReachable, reportSkippedIntegration } from "./support/dev-database.js";
import {
  actAsAuthenticatedHuman,
  asJson,
  type Backend,
  beginTransaction,
  closeBackends,
  endTransaction,
  expectFailed,
  expectSucceeded,
  type Json,
  observeBlocked,
  openBackend,
  RaceLog,
  settle,
  text,
  toFailure,
} from "./support/race-harness.js";

const SUITE = "@kitluy/device-identity governed-emergency concurrency";

// A skip is never evidence. Matches the other *.integration.test.ts files so an
// unreachable stack reports SKIPPED rather than a green run.
const reachable = await isDevDatabaseReachable();
if (!reachable) {
  reportSkippedIntegration(SUITE);
}

// ---------------------------------------------------------------------------
// Constants taken from the live database and the migrations, never guessed.
// ---------------------------------------------------------------------------
const ENVIRONMENT = "development";
const PURPOSE = "device_identity";
const GOVERNOR_ROLE = "kitluy_credential_issuer";
const ISSUANCE_ROLE = "kitluy_issuance_service";
const WORKER_ROLE = "kitluy_worker_service";
const REVOKE_PERMISSION = "fleet.device_credential.emergency_revoke";
const POST_APPROVE_PERMISSION = "fleet.device_credential.emergency_post_approve";
/** Created by `supabase/tests/assertions.sql`, NOT by the seed. */
const HARDWARE_PROFILE_KEY = "WS11-T001-HUB-PROBE";

/** Seeded `auth.users`. Four DISTINCT humans, because §2.4 is four-eyes. */
const HUMAN_EXECUTOR = "00000000-0000-4000-8000-000000000007";
const HUMAN_POST_APPROVER_A = "00000000-0000-4000-8000-000000000008";
const HUMAN_POST_APPROVER_B = "00000000-0000-4000-8000-000000000009";
const HUMAN_SECOND_EXECUTOR = "00000000-0000-4000-8000-000000000010";

const TENANT_ID = "00000000-0000-4000-8000-000000000011";
const DIGITAL_STORE_ID = "00000000-0000-4000-8000-000000000015";
const STORE_LOCATION_ID = "00000000-0000-4000-8000-000000000018";

/** Per-run marker, so this suite can never collide with a parallel run. */
const RUN_ID = randomUUID().replace(/-/g, "").slice(0, 12);

const LONG_TEST_MS = 120_000;
/**
 * Statement timeout for the calls that must NOT block. Short enough that a
 * lock wait becomes a 57014 failure instead of a slow pass.
 */
const NON_BLOCKING_TIMEOUT_MS = 2_500;

// ---------------------------------------------------------------------------
// Connections.
// ---------------------------------------------------------------------------
let alpha: Backend;
let beta: Backend;
let observer: Backend;
/** Plain `postgres`: fixtures, mid-race mutations and reads only. */
let keeper: Backend;

const races = new RaceLog();
let governorBorrowed = false;

/** Every permission fixture this run created, for an asserted teardown. */
const roleTemplateIds: string[] = [];
const roleAssignmentIds: string[] = [];
const profiledUserIds = new Set<string>();
/** Session-reference prefix for every evidence row this run created. */
const EVIDENCE_PREFIX = `phd-${RUN_ID}`;

// ---------------------------------------------------------------------------
// Keeper helpers.
// ---------------------------------------------------------------------------
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
 * Borrows the governor for ONE statement on the keeper and hands it back.
 *
 * Held for the shortest possible window because it is cluster-wide: while it is
 * held, `postgres` really is a member of the credential governor for every
 * connection to this database.
 */
async function asGovernor<T>(fn: () => Promise<T>): Promise<T> {
  await keeper.client.query(
    `do $ensure$ begin execute format('grant ${GOVERNOR_ROLE} to %I', current_user); end $ensure$;`,
  );
  governorBorrowed = true;
  try {
    return await inKeeperTransaction(fn, GOVERNOR_ROLE);
  } finally {
    await handBackGovernorMembership();
  }
}

/**
 * Returns the borrowed governor membership and reports whether it landed.
 *
 * IDEMPOTENT on purpose, because it is called for two different reasons: after
 * every borrow, and by `afterAll` as the net for the case where the suite blew
 * up mid-borrow. Revoking a membership that is already gone is a no-op.
 */
async function handBackGovernorMembership(): Promise<string | null> {
  if (keeper === undefined) return null;
  try {
    await keeper.client.query("rollback").catch(() => undefined);
    await keeper.client.query(
      `do $hand_back$ begin execute format('revoke ${GOVERNOR_ROLE} from %I', current_user); end $hand_back$;`,
    );
    const { rows } = await keeper.client.query<{ still: boolean }>(
      `select pg_has_role(current_user, '${GOVERNOR_ROLE}', 'MEMBER') as still`,
    );
    if (rows[0]?.still === true) {
      return `the borrowed ${GOVERNOR_ROLE} membership was NOT handed back`;
    }
    governorBorrowed = false;
    return null;
  } catch (error) {
    return `hand-back failed: ${toFailure(error).message}`;
  }
}

async function countRows(sql: string, params: readonly unknown[] = []): Promise<number> {
  const { rows } = await keeper.client.query<{ n: string }>(sql, [...params]);
  return Number(rows[0]?.n ?? "0");
}

async function credentialState(credentialId: string): Promise<string> {
  const { rows } = await keeper.client.query<{ state: string }>(
    "select state::text as state from kitluy_devices.device_credentials where credential_id = $1",
    [credentialId],
  );
  return rows[0]?.state ?? "absent";
}

// ---------------------------------------------------------------------------
// PERMISSION FIXTURES. Real role templates, grants, assignments and scopes —
// the same aggregate `kitluy_auth.has_permission` reads in production, so the
// authorization under test is the real one and not a stubbed verdict.
// ---------------------------------------------------------------------------
async function grantEmergencyPermission(userId: string, permissionKey: string): Promise<void> {
  const templateId = randomUUID();
  const assignmentId = randomUUID();

  await keeper.client.query(
    `insert into kitluy_auth.admin_user_profiles
       (user_id, status, assurance_level, security_metadata)
     values ($1::uuid, 'ACTIVE', 'aal2', jsonb_build_object('fixture', $2::text))
     on conflict (user_id) do nothing`,
    [userId, `phase-d-${RUN_ID}`],
  );
  profiledUserIds.add(userId);

  await keeper.client.query(
    `insert into kitluy_auth.role_templates
       (id, role_key, version, name, system_role, status)
     values ($1::uuid, $2, 1, $3, false, 'ACTIVE')`,
    [
      templateId,
      `PHD_${RUN_ID}_${permissionKey.split(".").pop()?.toUpperCase()}_${roleTemplateIds.length}`,
      `Phase D ${permissionKey}`,
    ],
  );
  roleTemplateIds.push(templateId);

  const granted = await keeper.client.query(
    `insert into kitluy_auth.role_permission_grants (role_template_id, permission_id, effect)
     select $1::uuid, p.id, 'ALLOW' from kitluy_auth.permissions p
      where p.permission_key = $2 and p.status = 'ACTIVE'`,
    [templateId, permissionKey],
  );
  if (granted.rowCount !== 1) {
    // Said explicitly: an ALLOW that granted nothing would make every
    // authorization assertion below pass for the wrong reason.
    throw new Error(
      `no ACTIVE permission row named ${permissionKey} exists, so the fixture granted nothing`,
    );
  }

  await keeper.client.query(
    `insert into kitluy_auth.role_assignments
       (id, subject_type, subject_id, role_template_id, status, valid_from)
     values ($1::uuid, 'user', $2::uuid, $3::uuid, 'ACTIVE', now() - interval '1 hour')`,
    [assignmentId, userId, templateId],
  );
  roleAssignmentIds.push(assignmentId);

  await keeper.client.query(
    `insert into kitluy_auth.assignment_scopes
       (role_assignment_id, scope_type, scope_id, environment)
     values ($1::uuid, 'platform', null, $2)`,
    [assignmentId, ENVIRONMENT],
  );
}

/** Removes ONE human's grants mid-race, for the permission-revocation scenario. */
async function revokeAllPermissionsFor(userId: string): Promise<number> {
  const result = await keeper.client.query(
    `update kitluy_auth.role_assignments set status = 'REVOKED'
      where subject_id = $1::uuid and status = 'ACTIVE'`,
    [userId],
  );
  return result.rowCount ?? 0;
}

/**
 * Records COMMITTED re-authentication evidence for a named human.
 *
 * Created through the governed RPC as the human's own session, so the actor is
 * derived from `auth.uid()` and the expiry from the governed policy window —
 * neither is passed, and neither can be widened from here.
 */
async function recordEvidence(userId: string, actionClass: string, tag: string): Promise<string> {
  return inKeeperTransaction(async () => {
    await keeper.client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await keeper.client.query("set local role authenticated");
    const { rows } = await keeper.client.query<{ id: string }>(
      `select kitluy_auth.record_reauthentication_evidence_v1($1, $2, 'PASSWORD_TOTP', $3) as id`,
      [ENVIRONMENT, actionClass, `${EVIDENCE_PREFIX}-${tag}`],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`evidence ${tag} was not recorded`);
    return id;
  });
}

// ---------------------------------------------------------------------------
// CREDENTIAL FIXTURE. Enrolled, claimed, redeemed and issued through the
// governed path, so the credential the race revokes is a real one.
// ---------------------------------------------------------------------------
interface RevocableCredential {
  readonly deviceId: string;
  readonly credentialId: string;
  readonly fingerprint: string;
}

async function revocableCredential(label: string): Promise<RevocableCredential> {
  const client = keeper.client;
  const suffix = `${RUN_ID}-${randomUUID().slice(0, 8)}`;
  const fingerprint = randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64);
  /**
   * PER-DEVICE, not per-run. `quarantine_evidence_collisions_v1` treats a
   * repeated mac_address as duplicated non-storage hardware evidence and
   * quarantines the new device, and a quarantined device cannot be claimed — so
   * deriving this from RUN_ID made every device in the run collide with the
   * first and every scenario failed as KLUY-DEVICE-QUARANTINED, which looks
   * nothing like the fixture bug it was.
   */
  const macAddress = `ad:${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  const profile = await client.query<{ id: string }>(
    "select id from kitluy_devices.hardware_profiles where profile_key = $1",
    [HARDWARE_PROFILE_KEY],
  );
  const hardwareProfileId = profile.rows[0]?.id;
  if (hardwareProfileId === undefined) {
    // NOT a seed row. Said explicitly, because "profile is missing" on its own
    // sends a reader hunting through the seed for something never there.
    throw new Error(
      `hardware profile ${HARDWARE_PROFILE_KEY} is absent. It is created by ` +
        `supabase/tests/assertions.sql (pnpm db:test), not by the seed, so this suite ` +
        `requires the canonical order: db:reset -> db:seed -> db:test -> test:rls -> vitest.`,
    );
  }

  const enrolled = await client.query<{ id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1, $2::uuid, now(), $3, 'ed25519', 'software', $4, $5, $6::jsonb) as id`,
    [
      `KL-PHD-${label}-${suffix}`,
      hardwareProfileId,
      fingerprint,
      // A UNIQUE station per device, not one station for the whole run.
      // `station_duplicate_quarantine_threshold` is 2, so a shared station key
      // quarantines the third device this suite enrols and every later scenario
      // fails with KLUY-DEVICE-QUARANTINED for a reason that has nothing to do
      // with what it was testing.
      `STATION-PHD-${suffix}`,
      `OP-PHD-${suffix}`,
      JSON.stringify([
        { signal_type: "mac_address", signal_value: macAddress },
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
    [deviceId, TENANT_ID, DIGITAL_STORE_ID, STORE_LOCATION_ID, claimToken, claimPayload, "OP-PHD"],
  );
  await client.query("select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, $4)", [
    claimToken,
    claimPayload,
    deviceId,
    "HUB-PHD",
  ]);

  const requestId = `rq-phd-${suffix}`;
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
        `PEM-PHD-${suffix}`,
        fingerprint,
        idempotencyKey,
        "9".repeat(64),
        "8".repeat(64),
        `ica-phd-${RUN_ID}`,
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
  return { deviceId, credentialId, fingerprint };
}

// ---------------------------------------------------------------------------
// RECORDED-SCOPE FIXTURE, for the overlapping-scope scenario. The approval's
// payload_hash is computed with the same functions the recording trigger uses.
// ---------------------------------------------------------------------------
interface RecordedScope {
  readonly scopeId: string;
  readonly approvalId: string;
  readonly incidentReference: string;
}

async function recordedIncidentScope(
  label: string,
  credentialIds: readonly string[],
  deviceIdForApproval: string,
): Promise<RecordedScope> {
  const client = keeper.client;
  const incidentReference = `INC-PHD-${RUN_ID}-${label}`;

  const policy = await client.query<{ id: string }>(
    `insert into kitluy_auth.approval_policies
       (policy_key, version, permission_key, environment, quorum, status, risk_class)
     values ($1, 1, 'device.credential.revoke', $2, 1, 'ACTIVE', 'A4')
     returning id`,
    [`phd.${RUN_ID}.${label}`, ENVIRONMENT],
  );
  const policyId = policy.rows[0]?.id ?? "";

  const approval = await client.query<{ id: string }>(
    `insert into kitluy_auth.approval_requests
       (policy_id, requester_id, resource_type, resource_id, environment, action,
        payload_hash, reason, status)
     values ($1::uuid, $2::uuid, 'device', $3::uuid, $4, 'device_credential_revocation',
             encode(sha256(convert_to($5, 'UTF8')), 'hex'), $6, 'APPROVED')
     returning id`,
    [
      policyId,
      HUMAN_EXECUTOR,
      deviceIdForApproval,
      ENVIRONMENT,
      `phd-${RUN_ID}-${label}`,
      `Phase D overlapping scope ${label}`,
    ],
  );
  const approvalId = approval.rows[0]?.id ?? "";

  await client.query(
    `insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
     values ($1::uuid, $2::uuid, 'APPROVE')`,
    [approvalId, HUMAN_POST_APPROVER_A],
  );

  const recorded = await inKeeperTransaction(
    () =>
      client.query<{ result: unknown }>(
        `select kitluy_devices.record_revocation_scope_v1(
           $1, $2, 'PROVIDER_COMPROMISE', null, null, null,
           $3::uuid[], $4, $5, null, $6::uuid) as result`,
        [
          incidentReference,
          ENVIRONMENT,
          credentialIds,
          `analyst-a@phd-${label}`,
          `analyst-b@phd-${label}`,
          approvalId,
        ],
      ),
    ISSUANCE_ROLE,
  );
  const result = asJson(recorded.rows[0]?.result);
  if (text(result, "outcome") !== "RECORDED") {
    throw new Error(`fixture ${label} could not record its scope: ${JSON.stringify(result)}`);
  }
  return {
    scopeId: text(result, "incident_scope_id") ?? "",
    approvalId,
    incidentReference,
  };
}

// ---------------------------------------------------------------------------
// Call wrappers, so every scenario invokes exactly the shipped signatures.
// ---------------------------------------------------------------------------
interface EmergencyArgs {
  readonly credentialId: string;
  readonly reason: string;
  readonly explanation: string;
  readonly incidentReference: string;
  readonly evidenceId: string;
  readonly idempotencyKey: string;
  readonly incidentScopeId?: string | null;
}

function governedEmergency(backend: Backend, args: EmergencyArgs): Promise<Json> {
  return backend.client
    .query<{ result: unknown }>(
      `select kitluy_devices.revoke_device_credential_emergency_governed_v1(
         $1::uuid, $2::kitluy_devices.credential_revocation_reason, $3::text, $4::text,
         $5::uuid, $6::text, $7::uuid) as result`,
      [
        args.credentialId,
        args.reason,
        args.explanation,
        args.incidentReference,
        args.evidenceId,
        args.idempotencyKey,
        args.incidentScopeId ?? null,
      ],
    )
    .then((res) => asJson(res.rows[0]?.result));
}

function postApproval(
  backend: Backend,
  args: {
    readonly authorizationId: string;
    readonly decision: "APPROVE" | "REFUSE";
    readonly evidenceId: string;
    readonly note: string;
  },
): Promise<Json> {
  return backend.client
    .query<{ result: unknown }>(
      `select kitluy_devices.record_governed_emergency_post_approval_v1(
         $1::uuid, $2::text, $3::uuid, $4::text) as result`,
      [args.authorizationId, args.decision, args.evidenceId, args.note],
    )
    .then((res) => asJson(res.rows[0]?.result));
}

function lapseSweep(backend: Backend, source: string): Promise<Json> {
  return backend.client
    .query<{ result: unknown }>(
      `select kitluy_devices.lapse_governed_emergency_post_approvals_v1($1::text, $2::text) as result`,
      [ENVIRONMENT, source],
    )
    .then((res) => asJson(res.rows[0]?.result));
}

/** Brings a post-approval deadline FORWARD. It can never be extended (0152). */
async function bringDeadlineForward(authorizationId: string): Promise<void> {
  await asGovernor(async () => {
    await keeper.client.query(
      `update kitluy_devices.device_emergency_revocation_authorizations
          set post_approval_due_at = clock_timestamp() - interval '1 second'
        where authorization_id = $1::uuid`,
      [authorizationId],
    );
  });
}

/**
 * Executes one governed emergency to completion on the keeper, and returns its
 * authorization id — the starting point for the post-approval scenarios.
 */
async function executedEmergency(label: string): Promise<{
  readonly authorizationId: string;
  readonly credentialId: string;
}> {
  const credential = await revocableCredential(label);
  const evidenceId = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, label);
  const result = await inKeeperTransaction(async () => {
    await keeper.client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: HUMAN_EXECUTOR, role: "authenticated" }),
    ]);
    await keeper.client.query("set local role authenticated");
    const { rows } = await keeper.client.query<{ result: unknown }>(
      `select kitluy_devices.revoke_device_credential_emergency_governed_v1(
         $1::uuid, 'DEVICE_STOLEN', $2, $3, $4::uuid, $5, null) as result`,
      [
        credential.credentialId,
        `Phase D ${label}: terminal reported stolen`,
        `INC-PHD-${RUN_ID}-${label}`,
        evidenceId,
        `PHD-${RUN_ID}-${label}`,
      ],
    );
    return asJson(rows[0]?.result);
  });
  if (text(result, "outcome") !== "REVOKED_IMMEDIATELY") {
    throw new Error(`fixture emergency ${label} did not execute: ${JSON.stringify(result)}`);
  }
  return {
    authorizationId: text(result, "authorization_id") ?? "",
    credentialId: credential.credentialId,
  };
}

// ===========================================================================
describe.skipIf(!reachable)("the governed emergency path under real concurrency", () => {
  beforeAll(async () => {
    keeper = await openBackend("keeper", RUN_ID);

    // REFUSE TO BORROW WHAT SOMEBODY ELSE IS ALREADY HOLDING.
    //
    // Role membership is GLOBAL catalog state: one `pg_auth_members` row shared
    // by every connection. If another session has already borrowed the governor
    // then borrowing again is a no-op and handing back at the end would revoke
    // THEIR borrow underneath them, failing their run far away from this file.
    const already = await keeper.client.query<{ held: boolean }>(
      `select pg_has_role(current_user, '${GOVERNOR_ROLE}', 'MEMBER') as held`,
    );
    if (already.rows[0]?.held === true) {
      throw new Error(
        `${SUITE}: ${GOVERNOR_ROLE} is ALREADY granted to this login, so another session ` +
          `has borrowed it. Running now would hand back somebody else's borrow. Wait for ` +
          `that session to finish and re-run; do not revoke the membership by hand.`,
      );
    }

    alpha = await openBackend("alpha", RUN_ID);
    beta = await openBackend("beta", RUN_ID);
    observer = await openBackend("observer", RUN_ID);

    await grantEmergencyPermission(HUMAN_EXECUTOR, REVOKE_PERMISSION);
    await grantEmergencyPermission(HUMAN_SECOND_EXECUTOR, REVOKE_PERMISSION);
    await grantEmergencyPermission(HUMAN_POST_APPROVER_A, POST_APPROVE_PERMISSION);
    await grantEmergencyPermission(HUMAN_POST_APPROVER_B, POST_APPROVE_PERMISSION);
  }, LONG_TEST_MS);

  /**
   * RELEASE EVERY LOCK BETWEEN SCENARIOS.
   *
   * Without this, a failed race is not one failure: the test that failed never
   * reaches its own `endTransaction`, so alpha keeps holding the credential row
   * and beta stays parked on it forever. The next scenario then times out on a
   * lock it never asked for, and the run reports six failures for one cause
   * while the real one scrolls past. Learned the hard way on the first full run
   * of this file.
   */
  afterEach(async () => {
    for (const backend of [alpha, beta]) {
      if (backend === undefined) continue;
      await backend.client.query("rollback").catch(() => undefined);
      await backend.client.query("reset role").catch(() => undefined);
      await backend.client.query("reset statement_timeout").catch(() => undefined);
    }
    await keeper?.client.query("rollback").catch(() => undefined);
  });

  afterAll(async () => {
    const problems: string[] = [];
    try {
      for (const backend of [alpha, beta]) {
        await backend?.client.query("rollback").catch(() => undefined);
      }

      if (keeper !== undefined) {
        // 1. Revoke every re-authentication evidence row this run created, so
        //    no step-up outlives the suite that created it.
        await keeper.client
          .query(
            `update kitluy_auth.reauthentication_evidence
                set lifecycle_state = 'REVOKED', revoked_at = clock_timestamp()
              where session_reference like $1 and lifecycle_state = 'ACTIVE'`,
            [`${EVIDENCE_PREFIX}-%`],
          )
          .catch((error: unknown) => {
            problems.push(`could not revoke run evidence: ${toFailure(error).message}`);
          });

        // 2. Remove every permission fixture, innermost first.
        for (const assignmentId of roleAssignmentIds) {
          await keeper.client
            .query(
              "delete from kitluy_auth.assignment_scopes where role_assignment_id = $1::uuid",
              [assignmentId],
            )
            .catch(() => undefined);
          await keeper.client
            .query("delete from kitluy_auth.role_assignments where id = $1::uuid", [assignmentId])
            .catch(() => undefined);
        }
        for (const templateId of roleTemplateIds) {
          await keeper.client
            .query(
              "delete from kitluy_auth.role_permission_grants where role_template_id = $1::uuid",
              [templateId],
            )
            .catch(() => undefined);
          await keeper.client
            .query("delete from kitluy_auth.role_templates where id = $1::uuid", [templateId])
            .catch(() => undefined);
        }
        await keeper.client
          .query(
            "delete from kitluy_auth.admin_user_profiles where security_metadata ->> $1 = $2",
            ["fixture", `phase-d-${RUN_ID}`],
          )
          .catch(() => undefined);

        // 3. ASSERT the teardown landed. A leaked grant would not fail another
        //    suite's privilege assertion, it would make it VACUOUS.
        const leaked = await keeper.client
          .query<{ n: string }>(
            `select count(*)::text as n from kitluy_auth.role_assignments
              where id = any ($1::uuid[]) and status = 'ACTIVE'`,
            [roleAssignmentIds],
          )
          .catch(() => ({ rows: [{ n: "unknown" }] }));
        if (leaked.rows[0]?.n !== "0") {
          problems.push(
            `${leaked.rows[0]?.n} emergency role assignment(s) from this run are still ACTIVE`,
          );
        }
        const liveEvidence = await keeper.client
          .query<{ n: string }>(
            `select count(*)::text as n from kitluy_auth.reauthentication_evidence
              where session_reference like $1 and lifecycle_state = 'ACTIVE'
                and expires_at > clock_timestamp()`,
            [`${EVIDENCE_PREFIX}-%`],
          )
          .catch(() => ({ rows: [{ n: "unknown" }] }));
        if (liveEvidence.rows[0]?.n !== "0") {
          problems.push(
            `${liveEvidence.rows[0]?.n} spendable re-authentication evidence row(s) survived the run`,
          );
        }

        const handBack = await handBackGovernorMembership();
        if (handBack !== null) problems.push(handBack);
      }

      if (races.count > 0) {
        console.info(`\n[Phase D governed-emergency race summary]\n${races.summary()}`);
        console.info(
          `[residue retained on purpose] devices, credentials, revocations, emergency ` +
            `authorizations and post-approval verdicts created by run ${RUN_ID} are ` +
            `APPEND-ONLY by design and are left consistent rather than deleted: removing a ` +
            `revocation would leave a credential in 'revoked' state with nothing explaining why.`,
        );
      }
    } finally {
      if (problems.length > 0) {
        // Loud, and after the summary, so the evidence is still readable.
        console.error(`${SUITE} TEARDOWN PROBLEMS:\n - ${problems.join("\n - ")}`);
      }
      await closeBackends([alpha, beta, observer, keeper]);
    }
  }, LONG_TEST_MS);

  // -------------------------------------------------------------------------
  // SCENARIO 1 — ONE re-authentication evidence row, TWO emergencies.
  //
  // Two DIFFERENT credentials, so the credential row lock cannot serialise
  // them and the only thing standing between one step-up and two emergencies
  // is `consume_reauthentication_evidence_v1`'s `SELECT ... FOR UPDATE` on the
  // evidence row. Group 0149's whole reason for existing is that a single
  // step-up must not authorize two sensitive actions.
  // -------------------------------------------------------------------------
  it(
    "spends one re-authentication evidence row on exactly one of two concurrent emergencies",
    async () => {
      const first = await revocableCredential("s1a");
      const second = await revocableCredential("s1b");
      const evidenceId = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s1");
      const incident = `INC-PHD-${RUN_ID}-s1`;

      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_EXECUTOR);
      const winner = await governedEmergency(alpha, {
        credentialId: first.credentialId,
        reason: "DEVICE_STOLEN",
        explanation: "the terminal this step-up was actually raised for",
        incidentReference: incident,
        evidenceId,
        idempotencyKey: `PHD-${RUN_ID}-s1-winner`,
      });
      expect(text(winner, "outcome")).toBe("REVOKED_IMMEDIATELY");

      // Alpha holds the evidence row uncommitted. Beta now tries to spend it.
      const betaXid = await beginTransaction(beta);
      expect(betaXid > alphaXid).toBe(true);
      await actAsAuthenticatedHuman(beta, HUMAN_EXECUTOR);
      const betaRace = settle(() =>
        governedEmergency(beta, {
          credentialId: second.credentialId,
          reason: "DEVICE_STOLEN",
          explanation: "a second terminal on the same single step-up",
          incidentReference: incident,
          evidenceId,
          idempotencyKey: `PHD-${RUN_ID}-s1-loser`,
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");
      // The winner must still be OPEN at the moment the loser parks, or the two
      // were never in flight together.
      expect(blocked.holderState).toBe("idle in transaction");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "rollback");

      // The loser RAISES rather than returning a refusal, and that is the
      // correct shape: the authorization row was already inserted in its
      // transaction, so only an abort can unmake it.
      const failure = expectFailed(loser, "the second use of one re-auth evidence row");
      expect(failure.message).toContain("KLUY-EMERGENCY-REAUTHENTICATION-REFUSED");
      expect(failure.sqlState).toBe("42501");

      expect(await credentialState(first.credentialId)).toBe("revoked");
      expect(await credentialState(second.credentialId)).toBe("issued");

      const spentOn = await keeper.client.query<{
        consumed_for_authorization: string | null;
        lifecycle_state: string;
      }>(
        `select consumed_for_authorization, lifecycle_state
           from kitluy_auth.reauthentication_evidence where evidence_id = $1::uuid`,
        [evidenceId],
      );
      expect(spentOn.rows[0]?.lifecycle_state).toBe("CONSUMED");
      expect(spentOn.rows[0]?.consumed_for_authorization).toBe(text(winner, "authorization_id"));
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.device_emergency_revocation_authorizations
            where idempotency_key = $1`,
          [`PHD-${RUN_ID}-s1-loser`],
        ),
      ).toBe(0);

      races.record({
        scenario: "1: one re-authentication evidence row, two concurrent emergencies",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "alpha's consume_reauthentication_evidence_v1 held the evidence row under " +
          "SELECT ... FOR UPDATE, uncommitted; beta parked on that row lock",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid})`,
        loser: `beta (pid ${beta.pid})`,
        loserSqlState: failure.sqlState,
        loserOutcome: "raised KLUY-EMERGENCY-REAUTHENTICATION-REFUSED; whole transaction aborted",
        finalState: {
          first_credential: "revoked",
          second_credential: "issued",
          evidence_lifecycle: spentOn.rows[0]?.lifecycle_state ?? null,
          evidence_spent_on: spentOn.rows[0]?.consumed_for_authorization ?? null,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 2 — the evidence is INVALIDATED while the loser is lock-parked.
  //
  // HONEST NAMING. The spec calls this "evidence expiry while lock-parked".
  // The 300-second window is computed by `record_reauthentication_evidence_v1`
  // from `sensitive_action_reauth_policy` against the DATABASE clock, and no
  // path updates `expires_at` — which is the control, and it is the reason a
  // test cannot shorten it without either editing governed policy or sleeping
  // out five real minutes inside a held row lock.
  //
  // So this exercises the same reachable state through the lever that DOES
  // exist: the evidence is REVOKED mid-park. `consume_reauthentication_evidence_v1`
  // checks `lifecycle_state`, `revoked_at`, `superseded_at` and `expires_at` in
  // one place and returns false for all four, so the code path proven here is
  // the code path an expiry would take. The distinction is recorded rather than
  // glossed: this is invalidation, not clock expiry.
  // -------------------------------------------------------------------------
  it(
    "refuses an emergency whose evidence was invalidated while it was lock-parked",
    async () => {
      const shared = await revocableCredential("s2");
      const alphaEvidence = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s2a");
      const betaEvidence = await recordEvidence(
        HUMAN_SECOND_EXECUTOR,
        REVOKE_PERMISSION,
        "s2b-parked",
      );
      const incident = `INC-PHD-${RUN_ID}-s2`;

      // Alpha takes the credential row and holds it.
      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_EXECUTOR);
      const winner = await governedEmergency(alpha, {
        credentialId: shared.credentialId,
        reason: "KEY_COMPROMISE",
        explanation: "device key material is believed exposed",
        incidentReference: incident,
        evidenceId: alphaEvidence,
        idempotencyKey: `PHD-${RUN_ID}-s2-winner`,
      });
      expect(text(winner, "outcome")).toBe("REVOKED_IMMEDIATELY");

      const betaXid = await beginTransaction(beta);
      await actAsAuthenticatedHuman(beta, HUMAN_SECOND_EXECUTOR);
      const betaRace = settle(() =>
        governedEmergency(beta, {
          credentialId: shared.credentialId,
          reason: "KEY_COMPROMISE",
          explanation: "a second declaration on stale freshness",
          incidentReference: incident,
          evidenceId: betaEvidence,
          idempotencyKey: `PHD-${RUN_ID}-s2-loser`,
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");

      // WHILE BETA IS PARKED, its step-up stops being spendable.
      const invalidated = await keeper.client.query(
        `update kitluy_auth.reauthentication_evidence
            set lifecycle_state = 'REVOKED', revoked_at = clock_timestamp()
          where evidence_id = $1::uuid and lifecycle_state = 'ACTIVE'`,
        [betaEvidence],
      );
      expect(invalidated.rowCount).toBe(1);

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "rollback");

      // Beta re-reads the credential after the lock is granted and finds it
      // revoked, so the authoritative affected set is empty. Either refusal is
      // correct and fail-closed; what must NOT happen is a second revocation.
      const loserOutcome = loser.ok
        ? `${text(loser.value, "outcome")} / ${text(loser.value, "refusal_code")}`
        : loser.failure.message.slice(0, 160);
      if (loser.ok) {
        expect(text(loser.value, "outcome")).not.toBe("REVOKED_IMMEDIATELY");
      }

      expect(await credentialState(shared.credentialId)).toBe("revoked");
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.device_credential_revocations
            where credential_id = $1::uuid`,
          [shared.credentialId],
        ),
      ).toBe(1);
      const betaEvidenceRow = await keeper.client.query<{
        lifecycle_state: string;
        consumed_at: Date | null;
      }>(
        `select lifecycle_state, consumed_at from kitluy_auth.reauthentication_evidence
          where evidence_id = $1::uuid`,
        [betaEvidence],
      );
      expect(betaEvidenceRow.rows[0]?.lifecycle_state).toBe("REVOKED");
      expect(betaEvidenceRow.rows[0]?.consumed_at).toBeNull();

      races.record({
        scenario: "2: evidence invalidated while the loser was lock-parked (not clock expiry)",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "alpha held the credential row under SELECT ... FOR UPDATE; beta parked there, and " +
          "beta's step-up was REVOKED while parked. expires_at cannot be shortened from a " +
          "test — it is computed from governed policy against the database clock and never " +
          "updated — so invalidation exercises the same refusal branch",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid})`,
        loser: `beta (pid ${beta.pid})`,
        loserSqlState: loser.ok ? null : loser.failure.sqlState,
        loserOutcome,
        finalState: {
          credential: "revoked",
          revocation_rows_for_credential: 1,
          beta_evidence_lifecycle: betaEvidenceRow.rows[0]?.lifecycle_state ?? null,
          beta_evidence_consumed: betaEvidenceRow.rows[0]?.consumed_at !== null,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 3 — the human's PERMISSION is revoked while it is lock-parked.
  //
  // This is only meaningful because of where the check sits: the RPC takes the
  // credential row lock FIRST and asks `emergency_revocation_permitted_v1`
  // AFTER. So the authority is evaluated once the lock is granted, against
  // whatever the grant tables say THEN — not against a verdict cached before
  // the wait. A revoked assignment therefore stops an emergency that was
  // already queued, which is the property an access review depends on.
  //
  // THAT ORDERING IS NOT ENOUGH ON ITS OWN, and the reason is worth stating
  // because it is easy to get wrong. Under READ COMMITTED a statement normally
  // keeps the snapshot it started with, which would have made the parked call
  // evaluate authority against the PRE-revocation grant tables and this
  // scenario prove nothing. It works because each SQL statement INSIDE a
  // PL/pgSQL function takes its own snapshot, so the `has_permission` query
  // that runs after the lock is granted reads the grant tables as they stand
  // then. That was verified by experiment before this test was written rather
  // than assumed from the ordering of the source lines.
  // -------------------------------------------------------------------------
  it(
    "evaluates authority after the lock is granted, so a revoked grant stops a queued emergency",
    async () => {
      const first = await revocableCredential("s3a");
      const second = await revocableCredential("s3b");
      const alphaEvidence = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s3a");
      const betaEvidence = await recordEvidence(HUMAN_SECOND_EXECUTOR, REVOKE_PERMISSION, "s3b");
      const incident = `INC-PHD-${RUN_ID}-s3`;

      // Both target the SAME credential so beta must wait; alpha wins it.
      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_EXECUTOR);
      const winner = await governedEmergency(alpha, {
        credentialId: first.credentialId,
        reason: "DEVICE_LOST",
        explanation: "terminal missing from the store since opening",
        incidentReference: incident,
        evidenceId: alphaEvidence,
        idempotencyKey: `PHD-${RUN_ID}-s3-winner`,
      });
      expect(text(winner, "outcome")).toBe("REVOKED_IMMEDIATELY");

      // Beta must contend for the SAME row, or there is no wait to speak of.
      const betaXid = await beginTransaction(beta);
      await actAsAuthenticatedHuman(beta, HUMAN_SECOND_EXECUTOR);
      const betaRace = settle(() =>
        governedEmergency(beta, {
          credentialId: first.credentialId,
          reason: "DEVICE_LOST",
          explanation: "a second declaration by a human about to lose authority",
          incidentReference: incident,
          evidenceId: betaEvidence,
          idempotencyKey: `PHD-${RUN_ID}-s3-loser`,
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");

      const revokedAssignments = await revokeAllPermissionsFor(HUMAN_SECOND_EXECUTOR);
      expect(revokedAssignments).toBeGreaterThan(0);

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "rollback");

      const loserResult = asJson(
        expectSucceeded(loser, "the emergency whose permission was revoked mid-flight"),
      );
      // The AUTHORITY refusal specifically, not merely "not revoked". The
      // permission check sits ahead of the scope resolution, so a human whose
      // grant vanished while queueing is turned away for the right reason
      // rather than incidentally because the credential is already gone.
      expect(text(loserResult, "outcome")).toBe("EMERGENCY_REFUSED");
      expect(text(loserResult, "refusal_code")).toBe("KLUY-EMERGENCY-UNAUTHORIZED");

      // And a FRESH emergency by that human against an UNTOUCHED credential is
      // refused the same way — which is what rules out the refusal above being
      // an artefact of the credential alpha had just revoked.
      const afterRevocation = await inKeeperTransaction(async () => {
        await keeper.client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: HUMAN_SECOND_EXECUTOR, role: "authenticated" }),
        ]);
        await keeper.client.query("set local role authenticated");
        const evidence = await keeper.client.query<{ id: string }>(
          `select kitluy_auth.record_reauthentication_evidence_v1($1, $2, 'PASSWORD_TOTP', $3) as id`,
          [ENVIRONMENT, REVOKE_PERMISSION, `${EVIDENCE_PREFIX}-s3c`],
        );
        const { rows } = await keeper.client.query<{ result: unknown }>(
          `select kitluy_devices.revoke_device_credential_emergency_governed_v1(
             $1::uuid, 'DEVICE_LOST', $2, $3, $4::uuid, $5, null) as result`,
          [
            second.credentialId,
            "an emergency declared after the grant was revoked",
            incident,
            evidence.rows[0]?.id,
            `PHD-${RUN_ID}-s3-after`,
          ],
        );
        return asJson(rows[0]?.result);
      });
      expect(text(afterRevocation, "outcome")).toBe("EMERGENCY_REFUSED");
      expect(text(afterRevocation, "refusal_code")).toBe("KLUY-EMERGENCY-UNAUTHORIZED");
      expect(await credentialState(second.credentialId)).toBe("issued");

      // RESTORE THE GRANT, because later scenarios use this human and a test
      // that silently disarms the ones after it is a test that makes them
      // vacuous. A fresh template and assignment, both registered for teardown.
      await grantEmergencyPermission(HUMAN_SECOND_EXECUTOR, REVOKE_PERMISSION);
      const restored = await inKeeperTransaction(async () => {
        await keeper.client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: HUMAN_SECOND_EXECUTOR, role: "authenticated" }),
        ]);
        await keeper.client.query("set local role authenticated");
        const { rows } = await keeper.client.query<{ ok: boolean }>(
          `select kitluy_auth.has_permission($1, 'device_credential', null, $2) as ok`,
          [REVOKE_PERMISSION, ENVIRONMENT],
        );
        return rows[0]?.ok === true;
      });
      expect(restored).toBe(true);

      races.record({
        scenario: "3: permission revoked while the emergency was lock-parked",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "alpha held the credential row; beta parked there, and beta's ACTIVE role " +
          "assignment was REVOKED while parked. The RPC asks " +
          "emergency_revocation_permitted_v1 AFTER taking the lock, so authority is " +
          "evaluated against the grant tables as they stand when the lock is granted",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid})`,
        loser: `beta (pid ${beta.pid})`,
        loserSqlState: null,
        loserOutcome: `${text(loserResult, "outcome")} / ${text(loserResult, "refusal_code")}`,
        finalState: {
          first_credential: "revoked",
          second_credential: "issued",
          fresh_call_after_revocation: text(afterRevocation, "refusal_code"),
          assignments_revoked: revokedAssignments,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 4 — the SAME idempotency key, concurrently, on two credentials.
  //
  // Different credentials, so nothing serialises on a credential row and the
  // only barrier is `device_emergency_revocation_authorizations_idempotency_unique`.
  //
  // The loser's outcome is worth stating plainly rather than smoothing over.
  // Both transactions read `v_prior` BEFORE either committed, so both see no
  // prior authorization and both proceed to INSERT. The unique index parks the
  // second and then raises 23505 — so the loser does NOT get the graceful
  // `ALREADY_AUTHORIZED` that a sequential replay gets. That is FAIL-CLOSED and
  // it is the property that matters here: one key, one emergency, and the
  // loser's whole transaction is unmade. It is also less legible than the
  // sequential path, and it is recorded as an observation in the Phase D
  // handoff rather than silently accepted or silently "fixed" outside scope.
  // -------------------------------------------------------------------------
  it(
    "lets one idempotency key authorize exactly one concurrent emergency",
    async () => {
      const first = await revocableCredential("s4a");
      const second = await revocableCredential("s4b");
      const alphaEvidence = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s4a");
      const betaEvidence = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s4b");
      const sharedKey = `PHD-${RUN_ID}-s4-shared`;
      const incident = `INC-PHD-${RUN_ID}-s4`;

      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_EXECUTOR);
      const winner = await governedEmergency(alpha, {
        credentialId: first.credentialId,
        reason: "DEVICE_STOLEN",
        explanation: "the emergency this key was minted for",
        incidentReference: incident,
        evidenceId: alphaEvidence,
        idempotencyKey: sharedKey,
      });
      expect(text(winner, "outcome")).toBe("REVOKED_IMMEDIATELY");

      const betaXid = await beginTransaction(beta);
      await actAsAuthenticatedHuman(beta, HUMAN_EXECUTOR);
      const betaRace = settle(() =>
        governedEmergency(beta, {
          credentialId: second.credentialId,
          reason: "DEVICE_STOLEN",
          explanation: "a different terminal under the same key",
          incidentReference: incident,
          evidenceId: betaEvidence,
          idempotencyKey: sharedKey,
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "rollback");

      const failure = expectFailed(loser, "the duplicate idempotency key");
      expect(failure.sqlState).toBe("23505");
      expect(failure.message).toContain("idempotency");

      expect(
        await countRows(
          `select count(*)::text as n
             from kitluy_devices.device_emergency_revocation_authorizations
            where idempotency_key = $1`,
          [sharedKey],
        ),
      ).toBe(1);
      expect(await credentialState(first.credentialId)).toBe("revoked");
      expect(await credentialState(second.credentialId)).toBe("issued");
      // The loser's step-up was never spent, so the human can retry honestly.
      const betaEvidenceRow = await keeper.client.query<{ lifecycle_state: string }>(
        `select lifecycle_state from kitluy_auth.reauthentication_evidence
          where evidence_id = $1::uuid`,
        [betaEvidence],
      );
      expect(betaEvidenceRow.rows[0]?.lifecycle_state).toBe("ACTIVE");

      races.record({
        scenario: "4: duplicate idempotency keys, concurrently",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "both read no prior authorization before either committed, so both inserted; " +
          "device_emergency_revocation_authorizations_idempotency_unique parked beta on the " +
          "in-progress index tuple",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid})`,
        loser: `beta (pid ${beta.pid})`,
        loserSqlState: failure.sqlState,
        loserOutcome:
          "raised 23505 unique_violation and aborted. NOTE: a CONCURRENT duplicate key " +
          "raises, where a SEQUENTIAL replay returns ALREADY_AUTHORIZED. Fail-closed, and " +
          "recorded as a legibility observation in the Phase D handoff",
        finalState: {
          authorizations_for_shared_key: 1,
          first_credential: "revoked",
          second_credential: "issued",
          loser_evidence_lifecycle: betaEvidenceRow.rows[0]?.lifecycle_state ?? null,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 5 — two OVERLAPPING recorded emergency scopes.
  //
  // Two separately approved, separately recorded incident sets that both name
  // the same credential, spent concurrently by two humans. Each scope is
  // single-use in its own right (Ruling 1), so neither consumption collides;
  // the contended object is the CREDENTIAL. Exactly one revocation row may
  // exist for it, and the second declaration must not produce a second account
  // of why it was repudiated.
  // -------------------------------------------------------------------------
  it(
    "revokes a credential named by two overlapping recorded scopes exactly once",
    async () => {
      const shared = await revocableCredential("s5");
      const scopeA = await recordedIncidentScope("s5a", [shared.credentialId], shared.deviceId);
      const scopeB = await recordedIncidentScope("s5b", [shared.credentialId], shared.deviceId);
      const alphaEvidence = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s5a");
      const betaEvidence = await recordEvidence(HUMAN_SECOND_EXECUTOR, REVOKE_PERMISSION, "s5b");

      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_EXECUTOR);
      const winner = await governedEmergency(alpha, {
        credentialId: shared.credentialId,
        reason: "PROVIDER_COMPROMISE",
        explanation: "provider root suspected — incident A",
        incidentReference: scopeA.incidentReference,
        evidenceId: alphaEvidence,
        idempotencyKey: `PHD-${RUN_ID}-s5-a`,
        incidentScopeId: scopeA.scopeId,
      });
      expect(text(winner, "outcome")).toBe("REVOKED_IMMEDIATELY");

      const betaXid = await beginTransaction(beta);
      await actAsAuthenticatedHuman(beta, HUMAN_SECOND_EXECUTOR);
      const betaRace = settle(() =>
        governedEmergency(beta, {
          credentialId: shared.credentialId,
          reason: "PROVIDER_COMPROMISE",
          explanation: "provider root suspected — incident B",
          incidentReference: scopeB.incidentReference,
          evidenceId: betaEvidence,
          idempotencyKey: `PHD-${RUN_ID}-s5-b`,
          incidentScopeId: scopeB.scopeId,
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "rollback");

      const loserOutcome = loser.ok
        ? `${text(loser.value, "outcome")} / ${text(loser.value, "refusal_code")}`
        : loser.failure.message.slice(0, 160);
      if (loser.ok) {
        expect(text(loser.value, "outcome")).not.toBe("REVOKED_IMMEDIATELY");
      }

      expect(await credentialState(shared.credentialId)).toBe("revoked");
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.device_credential_revocations
            where credential_id = $1::uuid`,
          [shared.credentialId],
        ),
      ).toBe(1);
      // Scope A was spent; scope B was NOT, because beta never completed.
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.revocation_scope_consumptions
            where incident_scope_id = $1::uuid`,
          [scopeA.scopeId],
        ),
      ).toBe(1);
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.revocation_scope_consumptions
            where incident_scope_id = $1::uuid`,
          [scopeB.scopeId],
        ),
      ).toBe(0);

      races.record({
        scenario: "5: two overlapping recorded emergency scopes naming one credential",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "each recorded scope is independently single-use, so the consumptions did not " +
          "collide; the contended object was the CREDENTIAL row, held by alpha under " +
          "SELECT ... FOR UPDATE",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid}) spending scope ${scopeA.scopeId}`,
        loser: `beta (pid ${beta.pid}) spending scope ${scopeB.scopeId}`,
        loserSqlState: loser.ok ? null : loser.failure.sqlState,
        loserOutcome,
        finalState: {
          revocation_rows_for_credential: 1,
          scope_a_consumed: 1,
          scope_b_consumed: 0,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 6 — NORMAL versus EMERGENCY revocation, same credential.
  //
  // Two different doors into the same one-way transition: the approve-before-
  // execute path (`revoke_device_credential_bound_v1`, run by the issuance
  // service — the door the shipped `RevocationGateway` uses) against the
  // governed emergency path (run by an authenticated human). One of them writes
  // the account of why this credential was repudiated, and it must not be
  // overwritten by whichever arrived second.
  //
  // The approval's payload_hash is ASKED FOR from
  // `authoritative_revocation_scope_v1`, never constructed here.
  // -------------------------------------------------------------------------
  it(
    "lets a normal and an emergency revocation of one credential produce exactly one account",
    async () => {
      const shared = await revocableCredential("s6");
      const derived = await asGovernor(async () => {
        const { rows } = await keeper.client.query<{ result: unknown }>(
          `select kitluy_devices.authoritative_revocation_scope_v1(
             $1::uuid, 'ADMINISTRATIVE_REPLACEMENT') as result`,
          [shared.credentialId],
        );
        return asJson(rows[0]?.result);
      });
      const derivedHash = text(derived, "payload_hash");
      expect(derivedHash).toMatch(/^[0-9a-f]{64}$/);

      const policy = await keeper.client.query<{ id: string }>(
        `insert into kitluy_auth.approval_policies
           (policy_key, version, permission_key, environment, quorum, status, risk_class)
         values ($1, 1, 'device.credential.revoke', $2, 1, 'ACTIVE', 'A4')
         returning id`,
        [`phd.${RUN_ID}.s6`, ENVIRONMENT],
      );
      const approval = await keeper.client.query<{ id: string }>(
        `insert into kitluy_auth.approval_requests
           (policy_id, requester_id, resource_type, resource_id, environment, action,
            payload_hash, reason, status)
         values ($1::uuid, $2::uuid, 'device', $3::uuid, $4,
                 'device_credential_revocation', $5, $6, 'APPROVED')
         returning id`,
        [
          policy.rows[0]?.id,
          HUMAN_EXECUTOR,
          shared.deviceId,
          ENVIRONMENT,
          derivedHash,
          "Phase D scenario 6 planned replacement",
        ],
      );
      const approvalId = approval.rows[0]?.id ?? "";
      await keeper.client.query(
        `insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
         values ($1::uuid, $2::uuid, 'APPROVE')`,
        [approvalId, HUMAN_POST_APPROVER_A],
      );

      const emergencyEvidence = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s6");
      const normalIntent = `PHD-${RUN_ID}-s6-normal`;

      // ALPHA runs the NORMAL path as the issuance service and holds it open.
      const alphaXid = await beginTransaction(alpha, ISSUANCE_ROLE);
      const winner = await alpha.client
        .query<{ result: unknown }>(
          `select kitluy_devices.revoke_device_credential_bound_v1(
             $1::text, $2::uuid, $3::text, $4::text, 1,
             'ADMINISTRATIVE_REPLACEMENT'::kitluy_devices.credential_revocation_reason,
             $5::text,
             'REPROVISION_REQUIRED'::kitluy_devices.credential_recovery_disposition,
             $6::text, 'PHASE-D', $7::uuid, $8::text, $9::text, null) as result`,
          [
            normalIntent,
            shared.deviceId,
            ENVIRONMENT,
            PURPOSE,
            "terminal permanently replaced under a planned change",
            "requester@phase-d",
            approvalId,
            "approver@phase-d",
            `CHG-PHD-${RUN_ID}-s6`,
          ],
        )
        .then((res) => asJson(res.rows[0]?.result));
      expect(text(winner, "outcome")).toBe("REVOKED");

      // BETA runs the EMERGENCY path as a human, against the same credential.
      const betaXid = await beginTransaction(beta);
      await actAsAuthenticatedHuman(beta, HUMAN_EXECUTOR);
      const betaRace = settle(() =>
        governedEmergency(beta, {
          credentialId: shared.credentialId,
          reason: "DEVICE_STOLEN",
          explanation: "someone else calls the same terminal stolen",
          incidentReference: `INC-PHD-${RUN_ID}-s6`,
          evidenceId: emergencyEvidence,
          idempotencyKey: `PHD-${RUN_ID}-s6-emergency`,
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "rollback");

      const loserOutcome = loser.ok
        ? `${text(loser.value, "outcome")} / ${text(loser.value, "refusal_code")}`
        : loser.failure.message.slice(0, 160);
      if (loser.ok) {
        expect(text(loser.value, "outcome")).not.toBe("REVOKED_IMMEDIATELY");
      }

      // ONE account, and it is the winner's — the two callers used different
      // reason codes on purpose, so a surviving loser update is unmistakable.
      const accounts = await keeper.client.query<{
        reason_code: string;
        source: string;
        revocation_request_id: string;
      }>(
        `select reason_code::text as reason_code, source, revocation_request_id
           from kitluy_devices.device_credential_revocations where credential_id = $1::uuid`,
        [shared.credentialId],
      );
      expect(accounts.rowCount).toBe(1);
      expect(accounts.rows[0]?.reason_code).toBe("ADMINISTRATIVE_REPLACEMENT");
      expect(accounts.rows[0]?.revocation_request_id).toBe(normalIntent);
      const credentialReason = await keeper.client.query<{ revocation_reason: string }>(
        `select revocation_reason from kitluy_devices.device_credentials
          where credential_id = $1::uuid`,
        [shared.credentialId],
      );
      expect(credentialReason.rows[0]?.revocation_reason).toMatch(/^ADMINISTRATIVE_REPLACEMENT:/);

      races.record({
        scenario: "6: normal (bound) versus emergency (governed) revocation of one credential",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}, issuance service) then beta(xid ${betaXid}, human)`,
        barrier:
          "both paths take the credential row under SELECT ... FOR UPDATE before writing; " +
          "alpha held it uncommitted and beta parked there",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid}) via revoke_device_credential_bound_v1`,
        loser: `beta (pid ${beta.pid}) via revoke_device_credential_emergency_governed_v1`,
        loserSqlState: loser.ok ? null : loser.failure.sqlState,
        loserOutcome,
        finalState: {
          revocation_rows: accounts.rowCount,
          surviving_reason_code: accounts.rows[0]?.reason_code ?? null,
          surviving_intent: accounts.rows[0]?.revocation_request_id ?? null,
          credential_reason: credentialReason.rows[0]?.revocation_reason ?? null,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 7 — OWNERSHIP changes while the emergency is lock-parked.
  //
  // The tenancy on an emergency authorization comes from
  // `emergency_device_tenancy_v1`, the activation governor's narrow bridge, and
  // it is read AFTER the credential lock is taken. So the question this answers
  // is a real one: when a device is un-assigned mid-flight, does the emergency
  // STALL, or does it still repudiate the credential?
  //
  // It must still repudiate it. A key believed compromised is not made safe by
  // an assignment change, and an emergency that could be blocked by revoking an
  // assignment would be an emergency with an off switch. What the authorization
  // records is the tenancy AS AT execution, which is why the row is append-only.
  //
  // HOW THE BARRIER IS BUILT, AND WHY NOT THE OBVIOUS WAY. Locking the
  // credential row directly would be simpler, and it is not available:
  // `kitluy_devices.device_credentials` is owned by the credential governor and
  // `kitluy_issuance_service` holds neither SELECT nor UPDATE on it, so
  // `SELECT ... FOR UPDATE` from a runtime role is refused — which is itself
  // the containment working. The lock is therefore taken the only way a runtime
  // caller can take it: by running a REAL governed emergency in alpha and then
  // ROLLING IT BACK. Rolling back rather than committing is what leaves the
  // credential `issued`, so beta's emergency is decided by the ownership change
  // under test and not by a credential alpha had already revoked.
  // -------------------------------------------------------------------------
  it(
    "still revokes when device ownership changes while the emergency is lock-parked",
    async () => {
      const first = await revocableCredential("s7a");
      const second = await revocableCredential("s7b");
      const alphaEvidence = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s7a");
      const betaEvidence = await recordEvidence(HUMAN_SECOND_EXECUTOR, REVOKE_PERMISSION, "s7b");
      const incident = `INC-PHD-${RUN_ID}-s7`;

      // Alpha takes the credential row through the governed door, and will
      // abandon the transaction rather than commit it.
      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_EXECUTOR);
      const abandoned = await governedEmergency(alpha, {
        credentialId: second.credentialId,
        reason: "KEY_COMPROMISE",
        explanation: "a declaration that will be abandoned before commit",
        incidentReference: incident,
        evidenceId: alphaEvidence,
        idempotencyKey: `PHD-${RUN_ID}-s7-abandoned`,
      });
      expect(text(abandoned, "outcome")).toBe("REVOKED_IMMEDIATELY");

      const betaXid = await beginTransaction(beta);
      await actAsAuthenticatedHuman(beta, HUMAN_SECOND_EXECUTOR);
      const betaRace = settle(() =>
        governedEmergency(beta, {
          credentialId: second.credentialId,
          reason: "KEY_COMPROMISE",
          explanation: "key exposure reported while the terminal was being reassigned",
          incidentReference: incident,
          evidenceId: betaEvidence,
          idempotencyKey: `PHD-${RUN_ID}-s7-parked`,
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");

      // FIRST, A FINDING THIS SCENARIO UNCOVERED, ASSERTED RATHER THAN
      // WORKED AROUND.
      //
      // The obvious way to change ownership is the governed door,
      // `revoke_device_assignment_v1`. It cannot run here, and the reason is
      // worth knowing: it opens with `SELECT * FROM devices ... FOR UPDATE`,
      // while an in-flight emergency holds a FOREIGN-KEY key-share lock on the
      // same `devices` row (its revocation rows reference the device). Those
      // conflict, so the governed assignment revocation QUEUES BEHIND the
      // emergency.
      //
      // That is sound behaviour — a device's assignment should not be rewritten
      // underneath a revocation that is mid-flight — but it means calling it
      // here would hang the fixture rather than test anything. It was found by
      // hanging. So the serialisation is now PROVEN, under a short statement
      // timeout so a 57014 is the evidence rather than a wall-clock stall.
      const governedDoor = await settle(() =>
        inKeeperTransaction(async () => {
          await keeper.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
          return keeper.client.query(
            `select kitluy_devices.revoke_device_assignment_v1(
               $1::uuid, 'ADMINISTRATIVE', $2::text)`,
            [second.deviceId, `PHD-${RUN_ID}-s7-governed-door`],
          );
        }),
      );
      const doorFailure = expectFailed(
        governedDoor,
        "revoke_device_assignment_v1 against a device with an in-flight emergency",
      );
      expect(doorFailure.sqlState).toBe("57014");

      // SO THE OWNERSHIP CHANGE IS MADE THE ONLY WAY THAT DOES NOT CONTEND FOR
      // THE `devices` ROW: directly on `device_assignments`, which the in-flight
      // emergency does not touch. This is a fixture walking around a service
      // boundary, which is normally the wrong thing to do, and it is stated
      // rather than hidden — `postgres` carries BYPASSRLS, the assignment
      // aggregate's own immutability trigger still applies, and the assertion
      // above is what keeps the governed door itself under test.
      //
      // `pending_trust`, not `active`, is the live state to revoke here. A claim
      // that has been redeemed sits in `pending_trust`; `activate_device_v1`
      // is the only writer of `active`, and it REFUSES without a row in
      // `device_certificates` (KLUY-DEVICE-NO-CERTIFICATE, KLD-2026-07-21-003).
      // The credential aggregate under test issues `device_credentials`, which is
      // a different table, so no fixture on this path can reach `active` without
      // fabricating a certificate. Filtering on `active` here matched zero rows
      // and is how that was found.
      const unassigned = await keeper.client.query<{ id: string; before_state: string }>(
        `update kitluy_devices.device_assignments as a
            set state = 'revoked', revoked_at = now(), revocation_reason = 'ADMINISTRATIVE'
          from (select id, state from kitluy_devices.device_assignments
                 where device_id = $1::uuid and state in ('pending_trust', 'active')) as before
          where a.id = before.id
          returning a.id, before.state as before_state`,
        [second.deviceId],
      );
      expect(unassigned.rowCount).toBeGreaterThan(0);
      const unassignedResult = {
        rows_revoked: unassigned.rowCount,
        states_before: unassigned.rows.map((row) => row.before_state),
      };
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.device_assignments
            where device_id = $1::uuid and state in ('pending_trust', 'active')`,
          [second.deviceId],
        ),
      ).toBe(0);

      // Alpha ABANDONS its emergency, so beta inherits an `issued` credential
      // and a device that no longer has an active assignment.
      await endTransaction(alpha, "rollback");
      const parked = await betaRace;
      await endTransaction(beta, "commit");

      const parkedResult = asJson(
        expectSucceeded(parked, "the emergency that was parked across the ownership change"),
      );
      expect(text(parkedResult, "outcome")).toBe("REVOKED_IMMEDIATELY");
      expect(await credentialState(second.credentialId)).toBe("revoked");

      const authorization = await keeper.client.query<{
        tenant_id: string | null;
        digital_store_id: string | null;
        store_location_id: string | null;
      }>(
        `select tenant_id, digital_store_id, store_location_id
           from kitluy_devices.device_emergency_revocation_authorizations
          where authorization_id = $1::uuid`,
        [text(parkedResult, "authorization_id")],
      );
      // TENANCY SURVIVES THE UN-ASSIGNMENT, AND THAT IS THE CORRECT ANSWER.
      //
      // `emergency_device_tenancy_v1` PREFERS an `active` assignment
      // (`order by case when state = 'active' then 0 else 1 end`) but does not
      // REQUIRE one: with no active row it falls back to the newest assignment
      // whatever its state — here the one revoked moments earlier. So the
      // authorization still records which tenant, store and location the device
      // belonged to when it was killed.
      //
      // An emergency revocation whose audit row said "tenant unknown" because the
      // device was de-assigned in the same breath would be the worst possible
      // outcome: de-assign first, then revoke, and the record of whose device it
      // was disappears. Tenancy is recorded as at execution and 0152's
      // immutability trigger forbids back-filling it, so if it were lost here it
      // would be lost permanently.
      const recordedTenancy = authorization.rows[0] ?? null;
      expect(recordedTenancy).not.toBeNull();
      expect(recordedTenancy?.tenant_id).toBe(TENANT_ID);
      expect(recordedTenancy?.digital_store_id).toBe(DIGITAL_STORE_ID);
      expect(recordedTenancy?.store_location_id).toBe(STORE_LOCATION_ID);

      // Alpha's abandoned attempt left nothing at all behind.
      expect(
        await countRows(
          `select count(*)::text as n
             from kitluy_devices.device_emergency_revocation_authorizations
            where idempotency_key = $1`,
          [`PHD-${RUN_ID}-s7-abandoned`],
        ),
      ).toBe(0);
      // The untouched first credential shows the ownership churn was local.
      expect(await credentialState(first.credentialId)).toBe("issued");

      races.record({
        scenario: "7: device ownership revoked while the emergency was lock-parked",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) held the row then abandoned, beta(xid ${betaXid}) queued`,
        barrier:
          "alpha held the target credential row by running a real governed emergency it " +
          "then ROLLED BACK — a runtime role cannot lock device_credentials directly, " +
          "because the credential governor owns it and grants the issuance service no " +
          "SELECT. The assignment was then revoked while beta was parked. The governed " +
          "revoke_device_assignment_v1 door was proven to SERIALISE behind the in-flight " +
          "emergency (57014) before falling back to a direct assignment write. The " +
          "emergency then completed AND still recorded the tenancy of the assignment " +
          "that had just been revoked",
        betaBlocked: blocked,
        winner: `beta (pid ${beta.pid}) — the emergency completed, which is the required outcome`,
        loser: "none: an emergency must not be stoppable by an assignment change",
        loserSqlState: null,
        loserOutcome: `${text(parkedResult, "outcome")}`,
        finalState: {
          target_credential: "revoked",
          untouched_credential: "issued",
          abandoned_attempt_residue: 0,
          assignment_change: unassignedResult,
          governed_assignment_door_serialised: doorFailure.sqlState === "57014",
          recorded_tenancy: recordedTenancy as unknown as Json,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 8 — POST-APPROVAL versus LAPSE, in flight together.
  //
  // NO LOCK WAIT HERE, AND THAT IS THE DESIGN. The post-approver holds the
  // authorization under `FOR UPDATE`; the sweeper reads with
  // `FOR UPDATE OF a SKIP LOCKED` and therefore WALKS PAST it rather than
  // queueing. A sweeper that parked behind one slow post-approver would stall
  // every other overdue authorization in the queue.
  //
  // What must hold is the outcome: `device_emergency_post_approval_one_verdict`
  // permits exactly one verdict, and a lapse must never invent an approver.
  // -------------------------------------------------------------------------
  it(
    "records exactly one verdict when a post-approval and the lapse sweeper run together",
    async () => {
      const emergency = await executedEmergency("s8");
      await bringDeadlineForward(emergency.authorizationId);
      const approverEvidence = await recordEvidence(
        HUMAN_POST_APPROVER_A,
        POST_APPROVE_PERMISSION,
        "s8",
      );

      // ALPHA is the human post-approver, holding the authorization row.
      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_POST_APPROVER_A);
      const approverResult = await postApproval(alpha, {
        authorizationId: emergency.authorizationId,
        decision: "APPROVE",
        evidenceId: approverEvidence,
        note: "Phase D scenario 8: the second person arrived",
      });
      // The deadline was brought forward, so an APPROVE is LATE by design and
      // §2.4 turns it into LAPSED + escalation rather than an approval.
      expect(text(approverResult, "post_approval_decision")).toBe("LAPSED");

      // BETA is the sweeper. It must NOT block, so a short statement timeout
      // turns any lock wait into a visible 57014 rather than a slow pass.
      const betaXid = await beginTransaction(beta, WORKER_ROLE);
      await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
      const sweeper = await settle(() => lapseSweep(beta, `PHD-${RUN_ID}-s8-sweeper`));
      const sweeperResult = asJson(
        expectSucceeded(sweeper, "the lapse sweep running against a held authorization"),
      );
      const sweptIds = JSON.stringify(sweeperResult["authorization_ids"] ?? []);
      // SKIP LOCKED: the sweeper walked past the row alpha is holding.
      expect(sweptIds).not.toContain(emergency.authorizationId);

      await endTransaction(alpha, "commit");
      await endTransaction(beta, "commit");

      const verdicts = await keeper.client.query<{
        verdict: string;
        actor_user_id: string | null;
        decision: string;
      }>(
        `select verdict, actor_user_id, decision
           from kitluy_devices.device_emergency_post_approval_verdicts
          where authorization_id = $1::uuid`,
        [emergency.authorizationId],
      );
      expect(verdicts.rowCount).toBe(1);
      expect(verdicts.rows[0]?.actor_user_id).toBe(HUMAN_POST_APPROVER_A);
      expect(verdicts.rows[0]?.decision).toBe("APPROVE");
      // §2.4 is one-way whatever the verdict says.
      expect(await credentialState(emergency.credentialId)).toBe("revoked");

      races.record({
        scenario: "8: human post-approval versus the lapse sweeper",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}, post-approver) then beta(xid ${betaXid}, sweeper)`,
        barrier:
          "NOT lock-serialised, BY DESIGN. alpha held the authorization under FOR UPDATE; " +
          "the sweeper reads FOR UPDATE OF a SKIP LOCKED and walked past it. Asserted " +
          "positively: the sweeper returned within a " +
          `${NON_BLOCKING_TIMEOUT_MS}ms statement timeout and did not name this ` +
          "authorization, so it neither blocked nor double-decided",
        betaBlocked: null,
        winner: `alpha (pid ${alpha.pid}) — the named human's verdict stands`,
        loser: `beta (pid ${beta.pid}) — the sweeper skipped the locked row`,
        loserSqlState: null,
        loserOutcome: `LAPSED count ${String(sweeperResult["lapsed_count"])}, ids ${sweptIds}`,
        finalState: {
          verdict_rows: verdicts.rowCount,
          verdict: verdicts.rows[0]?.verdict ?? null,
          verdict_actor: verdicts.rows[0]?.actor_user_id ?? null,
          credential_state: "revoked",
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 9 — two DIFFERENT humans post-approve the same emergency at once.
  //
  // The barrier is the authorization row itself: the RPC opens with
  // `SELECT ... FOR UPDATE`, so the second human parks there and, once the
  // first commits, re-reads and finds the verdict already written. It must
  // return `ALREADY_DECIDED` rather than colliding on the unique constraint —
  // one governed emergency has one second person, and the second arrival is
  // told so rather than crashed.
  // -------------------------------------------------------------------------
  it(
    "gives one governed emergency exactly one post-approval verdict under two competing approvers",
    async () => {
      const emergency = await executedEmergency("s9");
      const evidenceA = await recordEvidence(HUMAN_POST_APPROVER_A, POST_APPROVE_PERMISSION, "s9a");
      const evidenceB = await recordEvidence(HUMAN_POST_APPROVER_B, POST_APPROVE_PERMISSION, "s9b");

      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_POST_APPROVER_A);
      const winner = await postApproval(alpha, {
        authorizationId: emergency.authorizationId,
        decision: "APPROVE",
        evidenceId: evidenceA,
        note: "Phase D scenario 9: approver A, in time",
      });
      expect(text(winner, "outcome")).toBe("POST_APPROVED");
      expect(text(winner, "post_approval_decision")).toBe("APPROVED");

      const betaXid = await beginTransaction(beta);
      expect(betaXid > alphaXid).toBe(true);
      await actAsAuthenticatedHuman(beta, HUMAN_POST_APPROVER_B);
      const betaRace = settle(() =>
        postApproval(beta, {
          authorizationId: emergency.authorizationId,
          decision: "REFUSE",
          evidenceId: evidenceB,
          note: "Phase D scenario 9: approver B disagrees",
        }),
      );

      const blocked = await observeBlocked(observer, beta, alpha);
      expect(blocked.waitEventType).toBe("Lock");
      expect(blocked.holderState).toBe("idle in transaction");

      await endTransaction(alpha, "commit");
      const loser = await betaRace;
      await endTransaction(beta, "commit");

      const loserResult = asJson(expectSucceeded(loser, "the second post-approver's verdict"));
      expect(text(loserResult, "outcome")).toBe("ALREADY_DECIDED");
      expect(text(loserResult, "post_approval_decision")).toBe("APPROVED");

      const verdicts = await keeper.client.query<{ verdict: string; actor_user_id: string | null }>(
        `select verdict, actor_user_id from kitluy_devices.device_emergency_post_approval_verdicts
          where authorization_id = $1::uuid`,
        [emergency.authorizationId],
      );
      expect(verdicts.rowCount).toBe(1);
      expect(verdicts.rows[0]?.actor_user_id).toBe(HUMAN_POST_APPROVER_A);
      // The loser's step-up was NOT spent — an ALREADY_DECIDED costs nothing.
      const evidenceBRow = await keeper.client.query<{ lifecycle_state: string }>(
        `select lifecycle_state from kitluy_auth.reauthentication_evidence
          where evidence_id = $1::uuid`,
        [evidenceB],
      );
      expect(evidenceBRow.rows[0]?.lifecycle_state).toBe("ACTIVE");
      expect(await credentialState(emergency.credentialId)).toBe("revoked");

      races.record({
        scenario: "9: two competing post-approvers on one governed emergency",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) then beta(xid ${betaXid})`,
        barrier:
          "record_governed_emergency_post_approval_v1 opens with SELECT ... FOR UPDATE on " +
          "the authorization row; alpha held it uncommitted and beta parked there, then " +
          "re-read and found the verdict",
        betaBlocked: blocked,
        winner: `alpha (pid ${alpha.pid}), approver A`,
        loser: `beta (pid ${beta.pid}), approver B`,
        loserSqlState: null,
        loserOutcome: `${text(loserResult, "outcome")} / ${text(loserResult, "post_approval_decision")}`,
        finalState: {
          verdict_rows: verdicts.rowCount,
          verdict_actor: verdicts.rows[0]?.actor_user_id ?? null,
          loser_evidence_lifecycle: evidenceBRow.rows[0]?.lifecycle_state ?? null,
          credential_state: "revoked",
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 10 — two lapse workers sweeping the same overdue emergency.
  //
  // Again NO LOCK WAIT, and again that is the design: `SKIP LOCKED` is what
  // makes a sweeper horizontally scalable. Both workers run inside a short
  // statement timeout so a block would surface as 57014, and the assertion is
  // that exactly one verdict exists and the second worker reports lapsing
  // nothing.
  // -------------------------------------------------------------------------
  it(
    "lets two concurrent lapse workers lapse one overdue emergency exactly once",
    async () => {
      const emergency = await executedEmergency("s10");
      await bringDeadlineForward(emergency.authorizationId);

      const alphaXid = await beginTransaction(alpha, WORKER_ROLE);
      await alpha.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
      const first = await settle(() => lapseSweep(alpha, `PHD-${RUN_ID}-s10-worker-a`));
      const firstResult = asJson(
        expectSucceeded(first, "the first of two duplicate lapse workers"),
      );
      expect(JSON.stringify(firstResult["authorization_ids"] ?? [])).toContain(
        emergency.authorizationId,
      );

      // Worker A has not committed. Worker B sweeps the same environment.
      const betaXid = await beginTransaction(beta, WORKER_ROLE);
      await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
      const second = await settle(() => lapseSweep(beta, `PHD-${RUN_ID}-s10-worker-b`));
      const secondResult = asJson(
        expectSucceeded(second, "the second of two duplicate lapse workers"),
      );
      expect(JSON.stringify(secondResult["authorization_ids"] ?? [])).not.toContain(
        emergency.authorizationId,
      );

      await endTransaction(alpha, "commit");
      await endTransaction(beta, "commit");

      const verdicts = await keeper.client.query<{
        verdict: string;
        note: string | null;
        actor_user_id: string | null;
        reauth_evidence_id: string | null;
      }>(
        `select verdict, note, actor_user_id, reauth_evidence_id
           from kitluy_devices.device_emergency_post_approval_verdicts
          where authorization_id = $1::uuid`,
        [emergency.authorizationId],
      );
      expect(verdicts.rowCount).toBe(1);
      expect(verdicts.rows[0]?.verdict).toBe("LAPSED");
      // A lapse invents no approver and spends no step-up.
      expect(verdicts.rows[0]?.actor_user_id).toBeNull();
      expect(verdicts.rows[0]?.reauth_evidence_id).toBeNull();
      expect(verdicts.rows[0]?.note).toBe(`PHD-${RUN_ID}-s10-worker-a`);
      expect(await credentialState(emergency.credentialId)).toBe("revoked");
      // The lapse escalated to a case a human has to close.
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.device_recovery_cases c
             join kitluy_devices.device_credential_revocations r on r.revocation_id = c.revocation_id
            where r.emergency_authorization_id = $1::uuid
              and c.disposition = 'MANUAL_SECURITY_REVIEW'`,
          [emergency.authorizationId],
        ),
      ).toBeGreaterThan(0);

      races.record({
        scenario: "10: two concurrent lapse workers on one overdue emergency",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}, worker A) then beta(xid ${betaXid}, worker B)`,
        barrier:
          "NOT lock-serialised, BY DESIGN: FOR UPDATE OF a SKIP LOCKED. Asserted " +
          `positively — worker B returned inside a ${NON_BLOCKING_TIMEOUT_MS}ms statement ` +
          "timeout and reported lapsing nothing, so it neither blocked nor double-lapsed",
        betaBlocked: null,
        winner: `alpha (pid ${alpha.pid}), worker A`,
        loser: `beta (pid ${beta.pid}), worker B — skipped, not blocked`,
        loserSqlState: null,
        loserOutcome: `lapsed_count ${String(secondResult["lapsed_count"])}`,
        finalState: {
          verdict_rows: verdicts.rowCount,
          verdict: verdicts.rows[0]?.verdict ?? null,
          lapsed_by: verdicts.rows[0]?.note ?? null,
          invented_approver: verdicts.rows[0]?.actor_user_id !== null,
          credential_state: "revoked",
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 11 — a STALE worker whose lease was replaced.
  //
  // The lapse sweeper is driven by the durable job runtime (migration 0135),
  // and the runtime's safety property is that work is finished by the lease
  // that HOLDS it. A worker that stalled, lost its lease to expiry and woke up
  // afterwards must not be able to complete, defer or fail the job that has
  // since been handed to somebody else — otherwise a zombie worker can mark
  // real work done.
  //
  // `claim_durable_jobs_v1` uses SKIP LOCKED, so the two claims do not block;
  // the decision is made by `assert_active_lease` on the stale lease id.
  // -------------------------------------------------------------------------
  it(
    "refuses a stale worker's completion after its lease was replaced",
    async () => {
      const dedupeKey = `phd-${RUN_ID}-lease`;
      const subjectId = randomUUID();
      // `durable_jobs_kind_format` requires dotted segments ending `.vN`, so the
      // kind is shaped to the live constraint rather than to a readable guess.
      const jobKind = "device.credential-emergency-lapse.v1";

      const enqueued = await inKeeperTransaction(
        () =>
          keeper.client.query<{ result: unknown }>(
            `select kitluy_ops.enqueue_durable_job_v1(
               $1::text, 1, $2::text, $3::text, $4::uuid, $5::jsonb, 3, $6::text) as result`,
            [
              jobKind,
              dedupeKey,
              ENVIRONMENT,
              subjectId,
              JSON.stringify({ suite: "phase-d", run: RUN_ID }),
              `PHD-${RUN_ID}`,
            ],
          ),
        WORKER_ROLE,
      );
      const jobId = text(asJson(enqueued.rows[0]?.result), "job_id");
      expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

      const staleLease = randomUUID();
      const freshLease = randomUUID();

      // Worker A claims with a lease that lasts one second, then stalls.
      const alphaXid = await beginTransaction(alpha, WORKER_ROLE);
      const claimedA = await alpha.client.query<{ job_id: string }>(
        `select job_id from kitluy_ops.claim_durable_jobs_v1(
           array[$1]::text[], $2::text, $3::text, $4::uuid, 1, 5)`,
        [jobKind, ENVIRONMENT, `worker-a-${RUN_ID}`, staleLease],
      );
      expect(claimedA.rows.map((row) => row.job_id)).toContain(jobId);
      await endTransaction(alpha, "commit");

      // The lease expires, and worker B legitimately re-claims the job.
      await keeper.client.query("select pg_sleep(1.2)");
      const betaXid = await beginTransaction(beta, WORKER_ROLE);
      const claimedB = await beta.client.query<{ job_id: string; lease_id: string }>(
        `select job_id, lease_id from kitluy_ops.claim_durable_jobs_v1(
           array[$1]::text[], $2::text, $3::text, $4::uuid, 300, 5)`,
        [jobKind, ENVIRONMENT, `worker-b-${RUN_ID}`, freshLease],
      );
      expect(claimedB.rows.map((row) => row.job_id)).toContain(jobId);
      expect(claimedB.rows[0]?.lease_id).toBe(freshLease);
      await endTransaction(beta, "commit");

      // Worker A wakes up and tries to finish work it no longer holds.
      const stale = await settle(() =>
        inKeeperTransaction(
          () =>
            keeper.client.query(
              `select kitluy_ops.complete_durable_job_v1($1::uuid, $2::uuid, 'LAPSED', $3::text)`,
              [jobId, staleLease, `worker-a-${RUN_ID}`],
            ),
          WORKER_ROLE,
        ),
      );
      const failure = expectFailed(stale, "the stale worker completing a replaced lease");
      expect(failure.message).toMatch(/lease/i);

      const job = await keeper.client.query<{
        status: string;
        lease_id: string | null;
        lease_owner: string | null;
      }>(
        "select status::text as status, lease_id, lease_owner from kitluy_ops.durable_jobs where job_id = $1::uuid",
        [jobId],
      );
      expect(job.rows[0]?.lease_id).toBe(freshLease);
      expect(job.rows[0]?.lease_owner).toBe(`worker-b-${RUN_ID}`);
      expect(job.rows[0]?.status).not.toBe("completed");

      // THE OTHER HALF OF THE PROPERTY: the lease that HOLDS the job can finish
      // it. Without this, "the stale lease was refused" would be consistent with
      // a runtime that refuses everybody, which would be a broken queue rather
      // than a safe one.
      const held = await inKeeperTransaction(
        () =>
          keeper.client.query<{ result: unknown }>(
            `select kitluy_ops.complete_durable_job_v1($1::uuid, $2::uuid, 'LAPSED', $3::text) as result`,
            [jobId, freshLease, `worker-b-${RUN_ID}`],
          ),
        WORKER_ROLE,
      );
      expect(asJson(held.rows[0]?.result)).not.toEqual({});
      const finished = await keeper.client.query<{ status: string }>(
        "select status::text as status from kitluy_ops.durable_jobs where job_id = $1::uuid",
        [jobId],
      );
      // Left `completed` rather than deleted: 0135 refuses to delete job
      // evidence, so the queue is drained by finishing the job, not by removing
      // it.
      expect(finished.rows[0]?.status).toBe("completed");

      races.record({
        scenario: "11: stale worker completing a job whose lease was replaced",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: betaXid.toString(),
        transactionStartOrder: `alpha(xid ${alphaXid}) claimed with a 1s lease, beta(xid ${betaXid}) re-claimed after expiry`,
        barrier:
          "claim_durable_jobs_v1 uses SKIP LOCKED so the claims never contended; the " +
          "decision is assert_active_lease comparing the presented lease id with the one " +
          "the job row actually holds",
        betaBlocked: null,
        winner: `beta (pid ${beta.pid}), worker B holds lease ${freshLease}`,
        loser: `keeper acting as worker A with stale lease ${staleLease}`,
        loserSqlState: failure.sqlState,
        loserOutcome: failure.message.slice(0, 160),
        finalState: {
          job_lease_owner: job.rows[0]?.lease_owner ?? null,
          job_status_when_stale_worker_tried: job.rows[0]?.status ?? null,
          stale_completion_accepted: false,
          holder_completion_accepted: finished.rows[0]?.status === "completed",
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 12 — a FAILING emergency transaction leaves nothing behind.
  //
  // BE PRECISE ABOUT WHAT THIS PROVES. It does not install a broken audit sink;
  // it proves the property that makes an audit failure safe, which is that
  // every write the emergency performs — the authorization, the scope rows, the
  // revocation, the recovery case, the credential state change and the audit
  // trail — lives in ONE transaction, so any failure among them unmakes all of
  // them.
  //
  // Two things are needed for that claim to be honest, and both are asserted:
  //
  //   1. the functions contain no escape from the caller's transaction. A
  //      `dblink`, `pg_background` or autonomous-transaction call would commit
  //      an audit row that a rollback could not reach, and then this scenario
  //      would be proving nothing. The catalog is asked directly.
  //   2. after the abort, NOTHING persists — and the step-up is still ACTIVE
  //      with its original expiry, which is group 0150's stated behaviour: an
  //      emergency that rolls back must not cost the human their freshness.
  // -------------------------------------------------------------------------
  it(
    "unmakes every write, including the audit trail, when the emergency transaction fails",
    async () => {
      const target = await revocableCredential("s12");
      const evidenceId = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s12");
      const idempotencyKey = `PHD-${RUN_ID}-s12`;

      // 1. NO ESCAPE FROM THE TRANSACTION.
      const escapes = await keeper.client.query<{ proname: string; escape: boolean }>(
        `select p.proname,
                (p.prosrc ~* 'dblink|pg_background|autonomous_transaction') as escape
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('kitluy_devices', 'kitluy_auth')
            and p.proname in ('revoke_device_credential_emergency_governed_v1',
                              'record_governed_emergency_post_approval_v1',
                              'lapse_governed_emergency_post_approvals_v1',
                              'consume_reauthentication_evidence_v1')`,
      );
      expect(escapes.rowCount).toBeGreaterThan(0);
      for (const row of escapes.rows) {
        expect(row.escape, `${row.proname} can write outside the caller's transaction`).toBe(false);
      }

      const auditBefore = await countRows(
        "select count(*)::text as n from kitluy_audit.audit_logs",
      );

      // 2. A COMPLETE emergency, then a failure, then an abort.
      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_EXECUTOR);
      const executed = await governedEmergency(alpha, {
        credentialId: target.credentialId,
        reason: "DEVICE_STOLEN",
        explanation: "an emergency whose transaction is about to fail",
        incidentReference: `INC-PHD-${RUN_ID}-s12`,
        evidenceId,
        idempotencyKey,
      });
      expect(text(executed, "outcome")).toBe("REVOKED_IMMEDIATELY");
      const authorizationId = text(executed, "authorization_id") ?? "";

      // Inside the SAME transaction, the credential really is revoked.
      //
      // The read has to drop back to the session role first. `authenticated`
      // holds no SELECT on `device_credentials` — the credential governor owns
      // that table and hands runtime roles RPCs, not rows — so the actor cannot
      // verify its own effect, and a test that tried would fail with 42501
      // rather than tell us anything. `reset role` undoes the transaction-local
      // `set local role` and returns this backend to `postgres` for the read
      // only; the JWT claims stay set, and nothing here writes.
      //
      // This must happen on ALPHA. A second connection would see nothing: the
      // revocation is uncommitted, and the whole point is that it is visible
      // inside the transaction and gone once the transaction aborts.
      await alpha.client.query("reset role");
      const midFlight = await alpha.client.query<{ state: string }>(
        "select state::text as state from kitluy_devices.device_credentials where credential_id = $1::uuid",
        [target.credentialId],
      );
      expect(midFlight.rows[0]?.state).toBe("revoked");

      // ...and now the transaction fails, standing in for the audit sink
      // failing, a constraint firing, or the backend dying.
      const forced = await settle(() =>
        alpha.client.query(
          `do $fail$ begin
             raise exception 'PHASE-D-SIMULATED-AUDIT-FAILURE: the audit write failed'
               using errcode = 'P0001';
           end $fail$;`,
        ),
      );
      expect(forced.ok).toBe(false);
      await endTransaction(alpha, "rollback");

      // 3. NOTHING SURVIVED.
      expect(await credentialState(target.credentialId)).toBe("issued");
      expect(
        await countRows(
          `select count(*)::text as n
             from kitluy_devices.device_emergency_revocation_authorizations
            where idempotency_key = $1`,
          [idempotencyKey],
        ),
      ).toBe(0);
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.device_emergency_revocation_scope
            where authorization_id = $1::uuid`,
          [authorizationId],
        ),
      ).toBe(0);
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.device_credential_revocations
            where credential_id = $1::uuid`,
          [target.credentialId],
        ),
      ).toBe(0);
      expect(await countRows("select count(*)::text as n from kitluy_audit.audit_logs")).toBe(
        auditBefore,
      );

      // The step-up survives, ACTIVE and unspent: a rolled-back emergency must
      // not cost the human their freshness (group 0150).
      const evidenceRow = await keeper.client.query<{
        lifecycle_state: string;
        consumed_at: Date | null;
      }>(
        `select lifecycle_state, consumed_at from kitluy_auth.reauthentication_evidence
          where evidence_id = $1::uuid`,
        [evidenceId],
      );
      expect(evidenceRow.rows[0]?.lifecycle_state).toBe("ACTIVE");
      expect(evidenceRow.rows[0]?.consumed_at).toBeNull();

      // And because nothing was spent, the SAME step-up and key still work.
      const retried = await inKeeperTransaction(async () => {
        await keeper.client.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: HUMAN_EXECUTOR, role: "authenticated" }),
        ]);
        await keeper.client.query("set local role authenticated");
        const { rows } = await keeper.client.query<{ result: unknown }>(
          `select kitluy_devices.revoke_device_credential_emergency_governed_v1(
             $1::uuid, 'DEVICE_STOLEN', $2, $3, $4::uuid, $5, null) as result`,
          [
            target.credentialId,
            "the honest retry after the failure",
            `INC-PHD-${RUN_ID}-s12`,
            evidenceId,
            idempotencyKey,
          ],
        );
        return asJson(rows[0]?.result);
      });
      expect(text(retried, "outcome")).toBe("REVOKED_IMMEDIATELY");
      expect(await credentialState(target.credentialId)).toBe("revoked");

      races.record({
        scenario: "12: audit/transaction failure rolls the whole emergency back",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: "n/a — this scenario is about atomicity, not contention",
        transactionStartOrder: `alpha(xid ${alphaXid}) alone`,
        barrier:
          "no contention. The catalog was asked whether any of the governed functions can " +
          "write outside the caller's transaction (dblink / pg_background / autonomous): " +
          "none can, so a single rollback is sufficient to unmake the audit trail too",
        betaBlocked: null,
        winner: "nobody: the transaction aborted and left the fleet as it was",
        loser: `alpha (pid ${alpha.pid})`,
        loserSqlState: forced.ok ? null : forced.failure.sqlState,
        loserOutcome: "PHASE-D-SIMULATED-AUDIT-FAILURE; every write unmade",
        finalState: {
          credential_after_rollback: "issued",
          authorizations_left: 0,
          revocations_left: 0,
          audit_rows_unchanged: true,
          evidence_still_active: true,
          honest_retry_succeeded: true,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // SCENARIO 13 — the LEGACY emergency RPC racing the governed one.
  //
  // RC-021 was the finding that the legacy entry point accepted the actor, the
  // declaring authority and the re-authenticated boolean as PARAMETERS, so an
  // asserted CISO could revoke immediately. Migration 0151 revoked its EXECUTE
  // from every runtime role, leaving it reachable only by the NOLOGIN governor.
  //
  // NO LOCK WAIT, and that is the whole point: the legacy caller is stopped by
  // the permission system before it can contend for anything. A lock wait here
  // would mean it had got far enough to race.
  // -------------------------------------------------------------------------
  it(
    "cannot race the governed path from the legacy entry point, because no runtime role may call it",
    async () => {
      const target = await revocableCredential("s13");
      const evidenceId = await recordEvidence(HUMAN_EXECUTOR, REVOKE_PERMISSION, "s13");

      // ALPHA runs the governed emergency and holds the credential row.
      const alphaXid = await beginTransaction(alpha);
      await actAsAuthenticatedHuman(alpha, HUMAN_EXECUTOR);
      const winner = await governedEmergency(alpha, {
        credentialId: target.credentialId,
        reason: "KEY_COMPROMISE",
        explanation: "the governed declaration",
        incidentReference: `INC-PHD-${RUN_ID}-s13`,
        evidenceId,
        idempotencyKey: `PHD-${RUN_ID}-s13`,
      });
      expect(text(winner, "outcome")).toBe("REVOKED_IMMEDIATELY");

      // THE CALL IS BUILT FROM THE CATALOG, NOT TYPED OUT HERE.
      //
      // The first version of this scenario hand-wrote a 12-argument call. The
      // real function takes 18, so every attempt failed with 42883 — "function
      // does not exist" — and the scenario passed while proving NOTHING: a
      // misspelled probe is indistinguishable from a revoked grant if 42883 is
      // accepted. Deriving `null::<type>` from `pg_get_function_identity_arguments`
      // means the probe always names a function that exists, so the ONLY refusal
      // it can now collect is a real one. 42883 is asserted ABSENT below.
      //
      // NULL arguments are safe: EXECUTE is checked before the body runs, so a
      // role that is refused never evaluates them, and a role that is NOT refused
      // is the failure this scenario is looking for.
      const legacy = await keeper.client.query<{ args: string; arity: number }>(
        `select pg_get_function_identity_arguments(p.oid) as args, p.pronargs as arity
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'kitluy_devices'
            and p.proname = 'revoke_device_credential_emergency_v1'`,
      );
      expect(
        legacy.rowCount,
        "the legacy emergency RPC is gone entirely; this scenario asserts it is UNREACHABLE, " +
          "not absent, so it must be rewritten rather than left to pass vacuously",
      ).toBe(1);
      const legacyArgs = (legacy.rows[0]?.args ?? "")
        .split(", ")
        .map((argument) => `null::${argument.slice(argument.indexOf(" ") + 1)}`)
        .join(", ");
      const legacyCall = `select kitluy_devices.revoke_device_credential_emergency_v1(${legacyArgs}) as result`;

      // BETA attempts the legacy RPC as each runtime role that used to hold it.
      // A short statement timeout, so a lock wait cannot masquerade as a
      // permission refusal or as a slow pass.
      const attempts: Record<string, string> = {};
      for (const role of [ISSUANCE_ROLE, "service_role", "authenticated"]) {
        const betaXid = await beginTransaction(beta, role);
        await beta.client.query(`set local statement_timeout = ${NON_BLOCKING_TIMEOUT_MS}`);
        const attempt = await settle(() => beta.client.query(legacyCall));
        await endTransaction(beta, "rollback");

        const failure = expectFailed(attempt, `the legacy emergency RPC called as ${role}`);
        // PERMISSION DENIED, specifically.
        expect(
          failure.sqlState,
          `${role} was refused with ${failure.sqlState} rather than 42501; a 42883 means this ` +
            `probe missed the function and proved nothing: ${failure.message}`,
        ).toBe("42501");
        // NOT a lock timeout: it never got far enough to contend.
        expect(failure.sqlState).not.toBe("57014");
        attempts[role] = `${failure.sqlState}: ${failure.message.slice(0, 90)}`;

        // The catalog agrees, independently of the attempt.
        const granted = await keeper.client.query<{ held: boolean }>(
          `select has_function_privilege($1, p.oid, 'execute') as held
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'kitluy_devices'
              and p.proname = 'revoke_device_credential_emergency_v1'`,
          [role],
        );
        expect(granted.rows[0]?.held, `${role} still holds EXECUTE on the legacy RPC`).toBe(false);
        expect(betaXid).toBeGreaterThan(0n);
      }

      await endTransaction(alpha, "commit");

      expect(await credentialState(target.credentialId)).toBe("revoked");
      const accounts = await keeper.client.query<{ source: string }>(
        `select source from kitluy_devices.device_credential_revocations
          where credential_id = $1::uuid`,
        [target.credentialId],
      );
      expect(accounts.rowCount).toBe(1);
      expect(accounts.rows[0]?.source).toBe("GOVERNED_EMERGENCY_RPC");
      // And nothing was written under a legacy request id.
      expect(
        await countRows(
          `select count(*)::text as n from kitluy_devices.device_credential_revocations
            where revocation_request_id like $1`,
          [`PHD-${RUN_ID}-s13-legacy-%`],
        ),
      ).toBe(0);

      races.record({
        scenario: "13: legacy emergency RPC racing the governed one",
        alphaPid: alpha.pid,
        betaPid: beta.pid,
        alphaXid: alphaXid.toString(),
        betaXid: "one transaction per runtime role, each rolled back",
        transactionStartOrder: `alpha(xid ${alphaXid}) held the credential; beta attempted the legacy RPC as three roles`,
        barrier:
          "NOT lock-serialised, BY DESIGN. Migration 0151 revoked the legacy RPC's EXECUTE " +
          "from every runtime role, so the permission system refuses before a row lock is " +
          `ever requested. Each attempt ran under a ${NON_BLOCKING_TIMEOUT_MS}ms statement ` +
          "timeout and 57014 is asserted ABSENT, so a lock wait cannot pass as a refusal. The " +
          "call is generated from pg_get_function_identity_arguments so it cannot miss the " +
          "function, and 42883 is asserted absent as well",
        betaBlocked: null,
        winner: `alpha (pid ${alpha.pid}) via the governed RPC`,
        loser: `beta (pid ${beta.pid}) via the legacy RPC, as ${ISSUANCE_ROLE} / service_role / authenticated`,
        loserSqlState: "42501 permission denied, for every runtime role",
        loserOutcome: JSON.stringify(attempts),
        finalState: {
          credential_state: "revoked",
          revocation_rows: accounts.rowCount,
          surviving_source: accounts.rows[0]?.source ?? null,
          legacy_rows_written: 0,
        },
      });
    },
    LONG_TEST_MS,
  );

  // -------------------------------------------------------------------------
  // THE HAND-BACK, AS A TEST RATHER THAN AS CLEANUP.
  //
  // `afterAll` also hands the membership back, but a net that runs is not the
  // same as a check that can fail. This is the check.
  // -------------------------------------------------------------------------
  it("holds no borrowed governor membership when the scenarios are done", async () => {
    const problem = await handBackGovernorMembership();
    expect(problem).toBeNull();
    const held = await keeper.client.query<{ held: boolean }>(
      `select pg_has_role(current_user, '${GOVERNOR_ROLE}', 'MEMBER') as held`,
    );
    expect(held.rows[0]?.held).toBe(false);
    expect(governorBorrowed).toBe(false);
  });
});
