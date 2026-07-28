/**
 * Shared DB-backed test fixtures for the Store Hub command layer.
 *
 * These tests run against the LOCAL Hub database (`kitluy_hub_local`) with
 * `hub/migrations/**` applied and `hub/seed/dev-fixtures.sql` seeded. When it is
 * unreachable the suites SKIP VISIBLY — a skipped run is never reported as
 * executed evidence (KLD-EVIDENCE-001).
 *
 * Every suite provisions its OWN terminal devices, sessions, storage positions
 * and actors under a suite prefix, so suites are parallel-safe and none of them
 * mutates the shipped personas.
 */
import type pg from "pg";
import { asId, type UserId } from "@kitluy/shared-types";
import type { PermissionGrant } from "@kitluy/rbac";
import { buildIdempotencyKey } from "../src/hub-database.js";
import { createHubPool, isHubDatabaseReachable, withHubTransaction } from "../src/hub/db.js";
import type { HubApprovalEvidence, HubDeviceContext } from "../src/hub/authorization.js";
import { payloadChecksum } from "../src/hub/outbox.js";
import { readAppliedMigrations } from "../src/hub/safety-mode.js";
import type { HubMigrationEntry, HubSafetyObservations } from "../src/hub/safety-mode.js";
import { uuidv7 } from "../src/hub/uuid.js";

// --- shipped fixture identifiers (hub/seed/dev-fixtures.sql) ----------------
export const TENANT = "e0000000-0000-4000-8000-000000000001";
export const STORE = "e0000000-0000-4000-8000-000000000002";
export const LOCATION = "e0000000-0000-4000-8000-000000000003";
export const HUB_DEVICE = "e0000000-0000-4000-8000-000000000010";
export const INSTALLATION = "e0000000-0000-4000-8000-000000000011";
export const HARDWARE_PROFILE_TERMINAL = "10000000-0000-4000-8000-000000000002";
export const ACTIVE_SNAPSHOT = "e0000000-0000-4000-8000-000000000050";

export const ACTOR_CASHIER = "e0000000-0000-4000-8000-000000000040";
export const ACTOR_READY = "e0000000-0000-4000-8000-000000000041";
export const ACTOR_PICKUP = "e0000000-0000-4000-8000-000000000042";
export const ACTOR_MANAGER = "e0000000-0000-4000-8000-000000000043";

export const REVOKED_TERMINAL = "e0000000-0000-4000-8000-000000000024";
export const FIXTURE_BOOKING_READY = "e0000000-0000-4000-8000-000000000070";
export const ATTACKER_TENANT_BOOKING = "e0000000-0000-4000-8000-0000000000a5";
export const SIBLING_LOCATION_BOOKING = "e0000000-0000-4000-8000-0000000000a6";
export const ATTACKER_TENANT = "e0000000-0000-4000-8000-0000000000a1";
export const ATTACKER_STORE = "e0000000-0000-4000-8000-0000000000a2";
export const ATTACKER_LOCATION = "e0000000-0000-4000-8000-0000000000a3";

/** Appendix B display code. Suite-scoped so numbers never collide with fixtures. */
export const TEST_LOCATION_CODE = "HQA1";

export const T1 = "laundry.t1.intake_cashier" as const;
export const T2 = "laundry.t2.customer_display" as const;
export const T3 = "laundry.t3.ready_scan_in" as const;
export const T4 = "laundry.t4.pickup_scan_out" as const;

/** Terminals are provisioned ahead of 1000 so a lower UNUSED sequence exists. */
export const SEQUENCE_BASE = 1000;

export async function hubReachable(): Promise<boolean> {
  return isHubDatabaseReachable();
}

/**
 * Best-effort: make the connected development user a member of the Hub runtime
 * role so the §3 GRANT surface is actually exercised by these tests. On a
 * production Hub the agent connects AS that role; on the Supabase development
 * server the connected `postgres` user is not a superuser, so membership has to
 * be granted once. Failure is tolerated — `withHubTransaction` degrades with a
 * recorded warning and the unconditional append-only triggers still apply.
 */
export async function ensureRuntimeRoleMembership(p: pg.Pool): Promise<boolean> {
  try {
    const already = await p.query<{ ok: boolean }>(
      `select pg_has_role(current_user, 'kitluy_hub_runtime', 'USAGE') as ok`,
    );
    if (already.rows[0]?.ok === true) return true;
    // HAZARD KLRISK-HUB-001 (residual — see src/hub/open-items.ts). The grantee
    // is spelled out explicitly because `GRANT ... TO current_user` SEGFAULTS
    // the PostgreSQL 15.8 development server: the backend dies with signal 11,
    // the postmaster terminates every other backend and the whole cluster
    // restarts into crash recovery. This form only AVOIDS the bug here; the
    // server crash itself is NOT fixed, so any other caller using the
    // `current_user` form will bring the cluster down again. (Recorded gap G7:
    // the Hub production target is PG16, so this is development-image specific
    // and must not be assumed absent on the Hub image without evidence.)
    const who = await p.query<{ u: string }>(`select current_user as u`);
    const grantee = (who.rows[0]?.u ?? "postgres").replace(/"/g, '""');
    await p.query(`grant kitluy_hub_runtime, kitluy_sync_worker to "${grantee}"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Suite pool. `max` is deliberately SMALL: every suite file runs in its own
 * vitest worker and the whole monorepo test run executes many DB-backed
 * packages in parallel against ONE development PostgreSQL server
 * (`max_connections = 100`). A large per-suite ceiling exhausts it and turns
 * unrelated suites red. Four is more than the concurrency probes need (the
 * parallel-duplicate test needs two).
 */
export function pool(max = 4): pg.Pool {
  return createHubPool(process.env, max);
}

/** Business date the Hub is operating on, taken from the database clock. */
export async function businessDate(p: pg.Pool): Promise<string> {
  const result = await p.query<{ d: string }>("select to_char(current_date, 'YYYY-MM-DD') as d");
  return result.rows[0]?.d ?? new Date().toISOString().slice(0, 10);
}

export interface ProvisionedTerminal {
  readonly terminalDeviceId: string;
  readonly sessionId: string;
  readonly actorId: string;
  readonly profileCode: typeof T1 | typeof T2 | typeof T3 | typeof T4;
}

export interface ProvisionOptions {
  readonly profileAssigned?: boolean;
  readonly sessionExpired?: boolean;
  readonly openSession?: boolean;
  readonly lifecycleStatus?: string;
  readonly locationId?: string;
  readonly tenantId?: string;
  readonly digitalStoreId?: string;
}

/**
 * Insert one terminal device, its cloud profile grant and an open staff session.
 * Direct SQL is TEST ARRANGEMENT of cloud-owned projections; the Hub command
 * layer never writes these rows itself.
 */
export async function provisionTerminal(
  p: pg.Pool,
  suite: string,
  profile: ProvisionedTerminal["profileCode"],
  actorId: string,
  options: ProvisionOptions = {},
): Promise<ProvisionedTerminal> {
  const terminalDeviceId = uuidv7();
  const sessionId = uuidv7();
  const tenantId = options.tenantId ?? TENANT;
  const storeId = options.digitalStoreId ?? STORE;
  const locationId = options.locationId ?? LOCATION;
  await p.query(
    `insert into edge_identity.terminal_device
       (id, tenant_id, digital_store_id, location_id, terminal_name, hardware_profile_id,
        installation_id, certificate_serial, assignment_generation, lifecycle_status,
        last_client_sequence, last_seen_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, now(), now(), now())`,
    [
      terminalDeviceId,
      tenantId,
      storeId,
      locationId,
      `${suite}-${profile}-${terminalDeviceId.slice(-12)}`,
      HARDWARE_PROFILE_TERMINAL,
      INSTALLATION,
      `TEST-CERT-${terminalDeviceId.slice(-12)}`,
      options.lifecycleStatus ?? "active",
      SEQUENCE_BASE,
    ],
  );
  if (options.profileAssigned !== false) {
    await p.query(
      `insert into edge_config.terminal_profile_assignment
         (id, tenant_id, digital_store_id, location_id, terminal_device_id, profile_code,
          assignment_version, enabled, effective_from, effective_until, source_snapshot_id)
       values ($1, $2, $3, $4, $5, $6, 7, true, now() - interval '1 day', null, $7)`,
      [uuidv7(), tenantId, storeId, locationId, terminalDeviceId, profile, ACTIVE_SNAPSHOT],
    );
  }
  if (options.openSession !== false) {
    const opened = options.sessionExpired ? "now() - interval '2 hours'" : "now()";
    const expires = options.sessionExpired
      ? "now() - interval '1 hour'"
      : "now() + interval '1 day'";
    await p.query(
      `insert into edge_identity.terminal_session
         (id, tenant_id, digital_store_id, location_id, terminal_device_id, actor_id,
          profile_code, opened_at, expires_at, closed_at, session_generation,
          last_event_sequence, status)
       values ($1, $2, $3, $4, $5, $6, $7, ${opened}, ${expires}, null, 1, 0, 'open')`,
      [sessionId, tenantId, storeId, locationId, terminalDeviceId, actorId, profile],
    );
  }
  return { terminalDeviceId, sessionId, actorId, profileCode: profile };
}

/** A staff actor whose cached projection is VALID but grants no logical profile. */
export async function provisionActorWithoutProfiles(p: pg.Pool): Promise<string> {
  const actorId = uuidv7();
  await p.query(
    `insert into edge_identity.staff_cache
       (actor_id, tenant_id, digital_store_id, location_id, display_name,
        credential_verifier, permission_snapshot_version, profile_codes,
        offline_valid_until, disabled, last_synced_at)
     values ($1, $2, $3, $4, 'Test Actor Without Grants', decode('b1b1b1b1','hex'), 7,
             array[]::text[], now() + interval '30 days', false, now())`,
    [actorId, TENANT, STORE, LOCATION],
  );
  return actorId;
}

export function deviceContext(
  terminal: ProvisionedTerminal,
  overrides: Partial<HubDeviceContext> = {},
): HubDeviceContext {
  return {
    terminalDeviceId: terminal.terminalDeviceId,
    sessionId: terminal.sessionId,
    actorId: terminal.actorId,
    profileCode: terminal.profileCode,
    assignmentGeneration: 1,
    tenantId: TENANT,
    digitalStoreId: STORE,
    locationId: LOCATION,
    environment: "local",
    ...overrides,
  };
}

export interface CommandKey {
  readonly idempotencyKey: string;
  readonly clientSequence: bigint;
}

/**
 * Next command key for a terminal, read from the database so a REJECTED command
 * (which rolls its sequence update back) does not desynchronise the test.
 */
export async function nextCommandKey(p: pg.Pool, terminalDeviceId: string): Promise<CommandKey> {
  const result = await p.query<{ last_client_sequence: bigint }>(
    `select last_client_sequence from edge_identity.terminal_device where id = $1`,
    [terminalDeviceId],
  );
  const last = result.rows[0]?.last_client_sequence ?? 0n;
  const next = last + 1n;
  return { idempotencyKey: buildIdempotencyKey(terminalDeviceId, next), clientSequence: next };
}

/** Explicit key for replay / gap probes. */
export function commandKeyAt(terminalDeviceId: string, sequence: bigint): CommandKey {
  return {
    idempotencyKey: buildIdempotencyKey(terminalDeviceId, sequence),
    clientSequence: sequence,
  };
}

export async function bookingVersion(p: pg.Pool, bookingId: string): Promise<bigint> {
  const result = await p.query<{ aggregate_version: bigint }>(
    `select aggregate_version from edge_laundry.booking where id = $1`,
    [bookingId],
  );
  return result.rows[0]?.aggregate_version ?? 0n;
}

export async function bookingRow(
  p: pg.Pool,
  bookingId: string,
): Promise<{
  status: string;
  paid_minor: bigint;
  refunded_minor: bigint;
  balance_minor: bigint;
  total_minor: bigint;
  aggregate_version: bigint;
}> {
  const result = await p.query<{
    status: string;
    paid_minor: bigint;
    refunded_minor: bigint;
    balance_minor: bigint;
    total_minor: bigint;
    aggregate_version: bigint;
  }>(
    `select status, paid_minor, refunded_minor, balance_minor, total_minor, aggregate_version
       from edge_laundry.booking where id = $1`,
    [bookingId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`booking ${bookingId} not found`);
  return row;
}

/**
 * TEST ARRANGEMENT for the plant production stages.
 *
 * RECORDED GAP: `WASHING`, `DRYING` and `PRESSING` happen in the laundry plant.
 * No approved Edge route and no canonical RBAC permission key covers them, so
 * the Hub command layer exposes NO command for them (KLREQ-015 discipline: a
 * capability without a permission key stays absent rather than inventing one).
 * The arrangement below still asks the CANONICAL engine for every edge, so no
 * test ever bypasses the state machine — it only writes the projection the
 * plant would have produced.
 */
export async function arrangeProductionStage(
  p: pg.Pool,
  bookingId: string,
  target: "WASHING" | "DRYING" | "PRESSING" | "QA_PACKAGING",
): Promise<void> {
  const { transitionProduction } = await import("@kitluy-verticals/phase1-laundry");
  const { productionStateForStatus, statusForProductionState } =
    await import("../src/hub/booking-status.js");
  const order = ["RECEIVED", "WASHING", "DRYING", "PRESSING", "QA_PACKAGING"] as const;
  for (;;) {
    const current = await p.query<{ status: string }>(
      `select status from edge_laundry.booking where id = $1`,
      [bookingId],
    );
    const status = current.rows[0]?.status;
    if (!status) throw new Error(`booking ${bookingId} not found`);
    const from = productionStateForStatus(status);
    if (from === target) return;
    const nextIndex = order.indexOf(from as (typeof order)[number]) + 1;
    const to = order[nextIndex];
    if (to === undefined) throw new Error(`cannot reach ${target} from ${from}`);
    // CANONICAL ENGINE decides the edge; the arrangement only persists it.
    const decided = transitionProduction(from, to);
    await p.query(
      `update edge_laundry.booking set status = $2, aggregate_version = aggregate_version + 1
        where id = $1`,
      [bookingId, statusForProductionState(decided)],
    );
  }
}

export async function provisionStoragePosition(
  p: pg.Pool,
  suite: string,
  capacity = 1,
): Promise<string> {
  const id = uuidv7();
  await p.query(
    `insert into edge_laundry.storage_position
       (id, tenant_id, digital_store_id, location_id, position_code, position_type,
        zone_code, capacity, status, record_version, source_snapshot_id, updated_at)
     values ($1, $2, $3, $4, $5, 'shelf', 'T', $6, 'available', 1, $7, now())`,
    [id, TENANT, STORE, LOCATION, `${suite}-${id.slice(-12)}`, capacity, ACTIVE_SNAPSHOT],
  );
  return id;
}

export async function provisionOpenShift(
  p: pg.Pool,
  terminalDeviceId: string,
  actorId: string,
): Promise<string> {
  const id = uuidv7();
  await p.query(
    `insert into edge_core.shift
       (id, tenant_id, digital_store_id, location_id, terminal_device_id, actor_id,
        business_date, opened_at, closed_at, opening_float_minor, currency_code,
        currency_exponent, status)
     values ($1, $2, $3, $4, $5, $6, current_date, now(), null, 10000, 'USD', 2, 'open')`,
    [id, TENANT, STORE, LOCATION, terminalDeviceId, actorId],
  );
  return id;
}

export function approvalEvidence(
  requestedBy: string,
  approvedBy: string,
  actionKey: string,
): HubApprovalEvidence {
  const requestId = uuidv7();
  return {
    request: {
      requestId,
      approvalClass: "A3_FOUR_EYES",
      actionKey,
      requestedBy: asId.userId(requestedBy) as UserId,
      reason: "Test four-eyes evidence",
      requestedAt: new Date().toISOString(),
    },
    decision: {
      requestId,
      approvedBy: asId.userId(approvedBy) as UserId,
      decision: "approved",
      decidedAt: new Date().toISOString(),
    },
  };
}

/** Session-carried grants for registry keys with no `terminal_role:` row. */
export function locationGrants(
  permissions: readonly string[],
  locationId: string = LOCATION,
): readonly PermissionGrant[] {
  return permissions.map((permission) => ({
    permission,
    scope: {
      level: "store_location" as const,
      resourceId: locationId,
      environment: "local" as const,
    },
  }));
}

export async function countRows(p: pg.Pool, sql: string, params: unknown[] = []): Promise<number> {
  const result = await p.query<{ count: string }>(sql, params);
  return Number(result.rows[0]?.count ?? "0");
}

/**
 * A HEALTHY Hub safety reading. Every WS-09-T005 suite starts from this and
 * overrides exactly the one dimension it is probing, so a test can never pass
 * because an unrelated mode happened to be active.
 */
export function safetyObservations(
  overrides: Partial<HubSafetyObservations> = {},
): HubSafetyObservations {
  return {
    readOnlyDeclared: false,
    diskUsedPercent: 12,
    migration: { expected: [], applied: [] },
    databaseIntegritySuspect: false,
    configuration: { compatible: true, knownGoodActive: true },
    clockOffsetSeconds: 1,
    ...overrides,
  };
}

/** The applied migration ledger, read through the safety-mode source adapter. */
export async function appliedMigrations(p: pg.Pool): Promise<readonly HubMigrationEntry[]> {
  return withHubTransaction(p, (client) => readAppliedMigrations(client));
}

/**
 * Terminate ONE PostgreSQL backend by pid — a real server-side process kill,
 * which is how these suites simulate a crash. Nothing is mocked: the backend
 * dies, its transaction is aborted by PostgreSQL and the client sees 57P01.
 */
export async function terminateBackend(p: pg.Pool, pid: number): Promise<void> {
  await p.query(`select pg_terminate_backend($1::int)`, [pid]);
}

// ---------------------------------------------------------------------------
// WS-10 sync fixtures.
//
// Every WS-10 suite gets its OWN `assignment_generation`. Ordering, leasing and
// cursor recovery are all scoped to (location_id, assignment_generation)
// (offline contract §5.1), so a private generation gives each suite a private
// stream: suites cannot block one another's head-of-line, and a stray row from
// an earlier run cannot make a later run pass or fail.
//
// These insert the event/outbox pair DIRECTLY rather than driving a command.
// That is the correct seam: WS-10 CONSUMES the outbox, it never produces it,
// and WS-09 already proves the producing half in its own suites.
// ---------------------------------------------------------------------------

/** Generations 900+ are reserved for WS-10 suites; real Hubs start at 1. */
export const SYNC_TEST_GENERATION_BASE = 900;

/** How many generations one suite may consume from its reserved block. */
export const SYNC_TEST_GENERATION_BLOCK = 100;

/**
 * Reserve a generation block ABOVE everything already in the database.
 *
 * The Hub database is long-lived in development: it is not reset between test
 * runs, so rows from earlier runs stay. A suite that always started at a fixed
 * generation would meet its own leftovers on the second run and see a stream it
 * did not seed — which is exactly how a suite starts passing or failing for
 * reasons that have nothing to do with the code under test.
 *
 * Reading the current maximum guarantees a block above every previous run; the
 * small random offset keeps two suites that reserve concurrently from landing
 * on the same block.
 */
export async function reserveSyncGenerationBlock(p: pg.Pool): Promise<number> {
  const result = await p.query<{ next: number }>(
    `select greatest(coalesce(max(assignment_generation), 0), $1)::int as next
       from edge_sync.outbox`,
    [SYNC_TEST_GENERATION_BASE],
  );
  const floor = result.rows[0]?.next ?? SYNC_TEST_GENERATION_BASE;
  return floor + 1 + Math.floor(Math.random() * 8) * SYNC_TEST_GENERATION_BLOCK;
}

export interface SeededOutboxEvent {
  readonly eventId: string;
  readonly hubSequence: bigint;
}

export interface SeedOutboxOptions {
  readonly generation: number;
  readonly count: number;
  readonly terminalDeviceId: string;
  /** Distinguishes concurrent suites inside one generation-scoped stream. */
  readonly suite: string;
  readonly eventType?: string;
  readonly aggregateType?: string;
}

/**
 * Seed `count` immutable events with their outbox rows, contiguous in
 * `hub_sequence` within the given generation, all `delivery_state = 'pending'`.
 */
export async function seedOutboxStream(
  p: pg.Pool,
  options: SeedOutboxOptions,
): Promise<readonly SeededOutboxEvent[]> {
  const eventType = options.eventType ?? "laundry.booking_confirmed";
  const aggregateType = options.aggregateType ?? "booking";
  const seeded: SeededOutboxEvent[] = [];

  const client = await p.connect();
  try {
    await client.query("begin");
    for (let i = 0; i < options.count; i += 1) {
      const eventId = uuidv7();
      const aggregateId = uuidv7();
      const sequence = await client.query<{ allocate_hub_sequence: bigint }>(
        `select edge_sync.allocate_hub_sequence()`,
      );
      const hubSequence = sequence.rows[0]!.allocate_hub_sequence;
      const clientSequence = BigInt(Date.now()) * 1000n + BigInt(i);
      const payload = { suite: options.suite, index: i };
      // The digest is computed with the SAME helper the command layer uses, so
      // a WS-10 digest check exercises the real contract rather than agreeing
      // with a second hasher invented for the fixture.
      const digest = payloadChecksum(payload);
      await client.query(
        `insert into edge_sync.local_event
           (id, tenant_id, digital_store_id, location_id, hub_device_id, origin_device_id,
            actor_id, aggregate_type, aggregate_id, aggregate_version, event_type,
            schema_version, business_date, occurred_at, hub_sequence, origin_sequence,
            assignment_generation, idempotency_key, payload_sha256, payload, created_at)
         values ($1, $2, $3, $4, $5, $6, null, $7, $8, 1, $9, 1, current_date, now(),
                 $10, $11, $12, $13, $14, $15::jsonb, now())`,
        [
          eventId,
          TENANT,
          STORE,
          LOCATION,
          HUB_DEVICE,
          options.terminalDeviceId,
          aggregateType,
          aggregateId,
          eventType,
          hubSequence.toString(),
          clientSequence.toString(),
          options.generation,
          `kl1.${options.terminalDeviceId}.${clientSequence}`,
          digest,
          JSON.stringify(payload),
        ],
      );
      await client.query(
        `insert into edge_sync.outbox
           (event_id, tenant_id, digital_store_id, location_id, hub_sequence,
            assignment_generation, delivery_state, attempt_count, next_attempt_at)
         values ($1, $2, $3, $4, $5, $6, 'pending', 0, now())`,
        [eventId, TENANT, STORE, LOCATION, hubSequence.toString(), options.generation],
      );
      seeded.push({ eventId, hubSequence });
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return seeded;
}

/** Read one outbox row plus THE shared external projection (amendment §4). */
export async function outboxRow(
  p: pg.Pool,
  eventId: string,
): Promise<{
  delivery_state: string;
  reconciliation_state: string;
  external_status: string;
  attempt_count: number;
  last_error_code: string | null;
  cloud_ack_id: string | null;
  acknowledged_at: Date | null;
  rejected_at: Date | null;
  dead_letter_reason: string | null;
  lease_owner: string | null;
  lease_id: string | null;
  next_attempt_at: Date;
  reconciliation_conflict_id: string | null;
}> {
  const result = await p.query(
    `select o.delivery_state, o.reconciliation_state,
            edge_sync.external_sync_status(o.delivery_state, o.reconciliation_state) as external_status,
            o.attempt_count, o.last_error_code, o.cloud_ack_id, o.acknowledged_at,
            o.rejected_at, o.dead_letter_reason, o.lease_owner, o.lease_id,
            o.next_attempt_at, o.reconciliation_conflict_id
       from edge_sync.outbox o where o.event_id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`no outbox row for ${eventId}`);
  return row;
}

/** Record a `sync_conflict` so a reconciliation can name its divergence. */
export async function seedSyncConflict(
  p: pg.Pool,
  input: { readonly localEventId?: string; readonly dataClass?: string } = {},
): Promise<string> {
  const id = uuidv7();
  await p.query(
    `insert into edge_sync.sync_conflict
       (id, tenant_id, digital_store_id, location_id, conflict_type, data_class,
        local_event_id, detected_at, state, severity)
     values ($1, $2, $3, $4, 'cloud_effect_divergence', $5, $6, now(), 'operator_required', 'high')`,
    [id, TENANT, STORE, LOCATION, input.dataClass ?? "finance_payment", input.localEventId ?? null],
  );
  return id;
}

/** Every `edge_*` relation's row count — the backup/restore fingerprint body. */
export async function relationFingerprint(p: pg.Pool): Promise<ReadonlyMap<string, number>> {
  const result = await p.query<{ relation: string; rows: string }>(
    `select format('%s.%s', n.nspname, c.relname) as relation,
            (xpath('/row/c/text()',
                   query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname),
                                false, true, '')))[1]::text as rows
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and n.nspname like 'edge\\_%'
      order by 1`,
  );
  return new Map(result.rows.map((row) => [row.relation, Number(row.rows)]));
}
