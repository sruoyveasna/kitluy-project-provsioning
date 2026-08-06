/**
 * Terminal fleet health: heartbeat acceptance, Hub-local derivation and the
 * cloud projection reporter (WS-11-T005-P02).
 *
 * Authority: owner package 2026-08-06 §2 (OWNER-LOCKED timing: heartbeat
 * interval 15 s; healthy <= 45 s; degraded <= 90 s; offline beyond 90 s;
 * unknown = never observed; report cadence 30 s; effect key
 * kh1.{health_report_id}.1); Hub spec §12.5 ("The Hub retains the local
 * authoritative observation"); hub groups 0035/0036 (relational authority);
 * cloud groups 0177/0178 (the ingestion door and its per-device
 * report_sequence contract).
 *
 * TIME. Liveness authority is the Hub DATABASE's now() captured inside the
 * accepting transaction — never the terminal's clock (its observed timestamp
 * is diagnostic only) and never this process's Date.now(). A delayed
 * heartbeat therefore cannot move the authoritative observation time
 * backward: receipt time only advances.
 *
 * SEQUENCE. Monotonic-GREATER, deliberately not accept_terminal_command's
 * strict +1: telemetry loss must not brick the stream. Equal = duplicate
 * (one business effect); lower = replay, refused; the 0036 trigger backstops
 * the same rule in schema.
 *
 * TRUTHS KEPT SEPARATE (T005 authority model): local connectivity
 * (derived_state), containment (effective_containment — a contained terminal
 * may still be locally connected and still reports), credential eligibility
 * (a revoked terminal never becomes healthy by talking: the mTLS gate
 * refuses it before this module runs, and eligibility is re-derived here for
 * the projection payload), lifecycle, and CLOUD freshness (the cloud's own
 * classification — nothing here claims it).
 */
import { randomUUID } from "node:crypto";

import { buildHubEffectKey, isValidHubEffectKey } from "@kitluy/sync-protocol";
import { assertValidEnvelope, type DomainEventEnvelope } from "@kitluy/event-contracts";
import { asId } from "@kitluy/shared-types";

import {
  withSerializableHubTransaction,
  isSerializationFailure,
  HUB_RUNTIME_ROLE,
  type HubClient,
  type HubPool,
} from "./db.js";
import { HubCommandError } from "./errors.js";
import { payloadChecksum } from "./outbox.js";
import * as syncRepo from "./repositories/sync.js";
import { SERVICE_NAME, SERVICE_VERSION } from "../index.js";

// ---------------------------------------------------------------------------
// Owner-locked values (package §2). Constants, cited — not policy invented.
// ---------------------------------------------------------------------------
export const TERMINAL_HEARTBEAT_INTERVAL_SECONDS = 15 as const;
export const TERMINAL_HEALTHY_WITHIN_SECONDS = 45 as const;
export const TERMINAL_DEGRADED_WITHIN_SECONDS = 90 as const;
export const FLEET_REPORT_CADENCE_SECONDS = 30 as const;

export const TERMINAL_HEALTH_EVENT_NAME = "device_fleet.health_projection_reported" as const;
export const TERMINAL_HEALTH_SCHEMA_VERSION = 1 as const;
export const TERMINAL_HEALTH_AGGREGATE_TYPE = "device_fleet_health" as const;

/**
 * Registered Hub-originated ordinals for this module's namespace UUIDs (the
 * pairing-replication discipline: an unregistered name never emits).
 */
const HUB_ORIGINATED_EFFECT_ORDINALS: Readonly<Record<string, number>> = {
  [TERMINAL_HEALTH_EVENT_NAME]: 1,
};

export type DerivedTerminalState = "healthy" | "degraded" | "offline_local" | "unknown";

export interface SafeLogger {
  info(fields: Record<string, string | number | boolean>): void;
}

export function healthReportEffectKey(healthReportId: string): string {
  const ordinal = HUB_ORIGINATED_EFFECT_ORDINALS[TERMINAL_HEALTH_EVENT_NAME];
  if (ordinal === undefined) {
    throw new HubCommandError("EDGE_COMMAND_UNKNOWN", "health event has no registered ordinal", {});
  }
  const key = buildHubEffectKey(healthReportId, ordinal);
  if (!isValidHubEffectKey(key)) {
    throw new HubCommandError("EDGE_COMMAND_UNKNOWN", "health effect key is not canonical kh1", {
      healthReportId,
    });
  }
  return key;
}

const FORBIDDEN_PAYLOAD_KEY_FRAGMENTS = [
  "nonce",
  "privatekey",
  "proofsignature",
  "provisioningcode",
  "codedigest",
  "password",
  "secret",
  "connectionstring",
  "token",
] as const;
const FORBIDDEN_PAYLOAD_VALUE = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|postgres(?:ql)?:\/\//;

/** Keep the payload FLAT — the guard walks top-level entries only. */
export function assertPublishableHealthPayload(payload: Readonly<Record<string, unknown>>): void {
  for (const [key, value] of Object.entries(payload)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (FORBIDDEN_PAYLOAD_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
      throw new HubCommandError("EDGE_COMMAND_UNKNOWN", "health payload carries a forbidden key", {
        key,
      });
    }
    if (typeof value === "string" && FORBIDDEN_PAYLOAD_VALUE.test(value)) {
      throw new HubCommandError(
        "EDGE_COMMAND_UNKNOWN",
        "health payload carries a forbidden value",
        {
          key,
        },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Heartbeat acceptance.
// ---------------------------------------------------------------------------
export interface TerminalHeartbeatBody {
  readonly heartbeatSequence: number;
  readonly uptimeSeconds: number;
  readonly applicationVersion: string;
  readonly releaseVersion?: string;
  readonly configSnapshotVersion: number;
  readonly queueDepth?: number;
  readonly localDatabaseAvailable?: boolean;
  readonly peripheralSummary?: string;
  readonly diskFreeBytes?: number;
  /** Diagnostic ONLY. Never ordering, never liveness authority. */
  readonly observedAt?: string;
  readonly reasonCodes?: readonly string[];
}

export type HeartbeatOutcome =
  | {
      readonly result: "ACCEPTED";
      readonly derivedState: DerivedTerminalState;
      readonly heartbeatSequence: number;
      readonly acceptedAt: string;
      readonly materialTransition: boolean;
    }
  | { readonly result: "DUPLICATE_IGNORED"; readonly heartbeatSequence: number }
  | { readonly result: "HEARTBEAT_REPLAY_REJECTED"; readonly expectedAbove: number };

interface StatusRow {
  readonly derived_state: DerivedTerminalState;
  readonly last_heartbeat_sequence: bigint;
  readonly report_sequence: bigint;
  readonly last_reported_state: string | null;
  readonly heartbeat_count: bigint;
}

interface TerminalScopeRow {
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
  readonly assignment_generation: number;
  readonly certificate_serial: string;
}

async function loadTerminalScope(
  client: HubClient,
  terminalDeviceId: string,
): Promise<TerminalScopeRow> {
  const { rows } = await client.query<TerminalScopeRow>(
    `select tenant_id, digital_store_id, location_id, assignment_generation,
            certificate_serial
       from edge_identity.terminal_device
      where id = $1`,
    [terminalDeviceId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new HubCommandError("EDGE_TERMINAL_UNKNOWN", "terminal is not registered", {
      terminalDeviceId,
    });
  }
  return row;
}

async function hubReportingIdentity(
  client: HubClient,
): Promise<{ hubDeviceId: string; assignmentGeneration: number }> {
  const { rows } = await client.query<{ hub_device_id: string; assignment_generation: number }>(
    `select hub_device_id, assignment_generation
       from edge_identity.hub_assignment
      where ended_at is null
      order by assignment_generation desc
      limit 1`,
  );
  const row = rows[0];
  if (row === undefined) {
    throw new HubCommandError("EDGE_COMMAND_UNKNOWN", "no live hub assignment", {});
  }
  return { hubDeviceId: row.hub_device_id, assignmentGeneration: row.assignment_generation };
}

async function effectiveContainment(client: HubClient, terminalDeviceId: string): Promise<string> {
  const { rows } = await client.query<{ directive: string }>(
    `select directive from edge_identity.effective_containment where device_uuid = $1`,
    [terminalDeviceId],
  );
  const directive = rows[0]?.directive;
  return directive === undefined || directive === "cleared" ? "none" : directive;
}

async function credentialEligible(client: HubClient, certificateSerial: string): Promise<boolean> {
  const { rows } = await client.query<{ eligible: boolean }>(
    `select exists (
        select 1 from edge_identity.device_credential
         where certificate_serial = $1
           and status = 'active' and revoked_at is null and expires_at > now()
      ) as eligible`,
    [certificateSerial],
  );
  return rows[0]?.eligible === true;
}

export function classifyLocalState(ageSeconds: number | null): DerivedTerminalState {
  if (ageSeconds === null) return "unknown";
  if (ageSeconds <= TERMINAL_HEALTHY_WITHIN_SECONDS) return "healthy";
  if (ageSeconds <= TERMINAL_DEGRADED_WITHIN_SECONDS) return "degraded";
  return "offline_local";
}

interface ReportContext {
  readonly terminalDeviceId: string;
  readonly scope: TerminalScopeRow;
  readonly derivedState: DerivedTerminalState;
  readonly fromState: DerivedTerminalState | null;
  readonly material: boolean;
  readonly reasons: readonly string[];
  readonly lastHeartbeatAt: string | null;
  readonly nowIso: string;
  readonly softwareVersion: string | null;
  readonly releaseVersion: string | null;
  readonly configurationVersion: string | null;
  readonly environment: string;
}

/**
 * Mints the report row (its id IS the outbox business identity), advances the
 * per-terminal report_sequence, and enqueues the v1 event — all in the
 * CALLER's transaction, so pending-at-`delivery_state = 'pending'` is the only
 * cloud coupling: no cloud client exists anywhere in this path.
 */
async function emitHealthReport(client: HubClient, ctx: ReportContext): Promise<string> {
  const reportId = randomUUID();
  const correlationId = randomUUID();

  const seqRows = await client.query<{ report_sequence: bigint }>(
    `update edge_hardware.terminal_health_status
        set report_sequence = report_sequence + 1,
            last_reported_state = $2,
            last_projection_sent_at = now(),
            updated_at = now()
      where terminal_device_id = $1
      returning report_sequence`,
    [ctx.terminalDeviceId, ctx.derivedState],
  );
  const reportSequence = seqRows.rows[0]?.report_sequence;
  if (reportSequence === undefined) {
    throw new HubCommandError("EDGE_TERMINAL_UNKNOWN", "no health status row to report from", {
      terminalDeviceId: ctx.terminalDeviceId,
    });
  }

  const containment = await effectiveContainment(client, ctx.terminalDeviceId);
  const eligible = await credentialEligible(client, ctx.scope.certificate_serial);
  const hub = await hubReportingIdentity(client);

  await client.query(
    `insert into edge_hardware.terminal_health_report
       (id, terminal_device_id, tenant_id, digital_store_id, location_id,
        report_sequence, derived_state, from_state, material, health_reasons,
        last_heartbeat_at, observed_at, software_version, release_version,
        configuration_version, containment_state, credential_eligible,
        correlation_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $13,
             $14, $15, $16, $17, now())`,
    [
      reportId,
      ctx.terminalDeviceId,
      ctx.scope.tenant_id,
      ctx.scope.digital_store_id,
      ctx.scope.location_id,
      reportSequence.toString(),
      ctx.derivedState,
      ctx.fromState,
      ctx.material,
      [...ctx.reasons],
      ctx.lastHeartbeatAt,
      ctx.softwareVersion,
      ctx.releaseVersion,
      ctx.configurationVersion,
      containment,
      eligible,
      correlationId,
    ],
  );

  const payload: Record<string, unknown> = {
    health_report_id: reportId,
    report_version: TERMINAL_HEALTH_SCHEMA_VERSION,
    terminal_device_id: ctx.terminalDeviceId,
    hub_device_id: hub.hubDeviceId,
    assignment_generation: ctx.scope.assignment_generation,
    tenant_id: ctx.scope.tenant_id,
    digital_store_id: ctx.scope.digital_store_id,
    location_id: ctx.scope.location_id,
    environment: ctx.environment,
    report_sequence: Number(reportSequence),
    observed_at: ctx.nowIso,
    last_local_contact_at: ctx.lastHeartbeatAt,
    health_classification: ctx.derivedState,
    health_reasons: [...ctx.reasons],
    software_version: ctx.softwareVersion,
    release_version: ctx.releaseVersion,
    configuration_version: ctx.configurationVersion,
    credential_eligible: eligible,
    containment_state: containment,
    correlation_id: correlationId,
  };
  assertPublishableHealthPayload(payload);

  const idempotencyKey = healthReportEffectKey(reportId);
  const hubSequence = await syncRepo.allocateHubSequence(client);
  const envelope: DomainEventEnvelope = {
    event_id: randomUUID(),
    event_name: TERMINAL_HEALTH_EVENT_NAME,
    schema_version: TERMINAL_HEALTH_SCHEMA_VERSION,
    occurred_at: ctx.nowIso,
    recorded_at: new Date().toISOString(),
    tenant_id: ctx.scope.tenant_id,
    digital_store_id: ctx.scope.digital_store_id,
    location_id: ctx.scope.location_id,
    aggregate: {
      type: TERMINAL_HEALTH_AGGREGATE_TYPE,
      id: ctx.terminalDeviceId,
      version: Number(reportSequence),
    },
    producer: SERVICE_NAME,
    source: {
      source_type: "store_hub",
      source_id: hub.hubDeviceId,
      device_id: ctx.terminalDeviceId,
      software_version: SERVICE_VERSION,
    },
    actor: null,
    correlation_id: asId.correlationId(correlationId),
    causation_id: null,
    idempotency_key: asId.idempotencyKey(idempotencyKey),
    payload,
    payload_sha256: payloadChecksum(payload),
    replay: { is_replay: false },
  };
  assertValidEnvelope(envelope);

  await syncRepo.insertLocalEventWithOutbox(client, {
    id: envelope.event_id,
    tenantId: ctx.scope.tenant_id,
    digitalStoreId: ctx.scope.digital_store_id,
    locationId: ctx.scope.location_id,
    hubDeviceId: hub.hubDeviceId,
    originDeviceId: ctx.terminalDeviceId,
    actorId: null,
    aggregateType: TERMINAL_HEALTH_AGGREGATE_TYPE,
    aggregateId: ctx.terminalDeviceId,
    aggregateVersion: reportSequence,
    eventType: TERMINAL_HEALTH_EVENT_NAME,
    schemaVersion: TERMINAL_HEALTH_SCHEMA_VERSION,
    businessDate: ctx.nowIso.slice(0, 10),
    hubSequence,
    originSequence: 0n,
    assignmentGeneration: hub.assignmentGeneration,
    idempotencyKey,
    payloadSha256: envelope.payload_sha256,
    payload: envelope as unknown as Record<string, unknown>,
  });

  return reportId;
}

/**
 * Accepts one authenticated heartbeat. The caller (the /edge/v1 route) has
 * already authenticated the peer certificate and resolved the terminal —
 * scope is DERIVED here from relational authority, never from the body.
 */
export async function acceptTerminalHeartbeat(
  pool: HubPool,
  terminalDeviceId: string,
  body: TerminalHeartbeatBody,
  environment: string,
  logger?: SafeLogger,
): Promise<HeartbeatOutcome> {
  return withSerializableHubTransaction(
    pool,
    async (client) => {
      const scope = await loadTerminalScope(client, terminalDeviceId);
      const nowRows = await client.query<{ now_iso: string }>(
        `select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now_iso`,
      );
      const nowIso = nowRows.rows[0]?.now_iso ?? new Date().toISOString();

      const statusRows = await client.query<StatusRow>(
        `select derived_state, last_heartbeat_sequence, report_sequence,
                last_reported_state, heartbeat_count
           from edge_hardware.terminal_health_status
          where terminal_device_id = $1
          for update`,
        [terminalDeviceId],
      );
      let status = statusRows.rows[0];
      if (status === undefined) {
        await client.query(
          `insert into edge_hardware.terminal_health_status
             (terminal_device_id, tenant_id, digital_store_id, location_id,
              derived_state, health_reasons, last_heartbeat_at, heartbeat_count,
              software_version, derived_at, updated_at)
           values ($1, $2, $3, $4, 'unknown', '{}', null, 0, null, now(), now())
           on conflict (terminal_device_id) do nothing`,
          [terminalDeviceId, scope.tenant_id, scope.digital_store_id, scope.location_id],
        );
        const again = await client.query<StatusRow>(
          `select derived_state, last_heartbeat_sequence, report_sequence,
                  last_reported_state, heartbeat_count
             from edge_hardware.terminal_health_status
            where terminal_device_id = $1
            for update`,
          [terminalDeviceId],
        );
        status = again.rows[0];
      }
      if (status === undefined) {
        throw new HubCommandError("EDGE_TERMINAL_UNKNOWN", "health status row unavailable", {
          terminalDeviceId,
        });
      }

      const sequence = BigInt(body.heartbeatSequence);
      if (sequence === status.last_heartbeat_sequence) {
        return { result: "DUPLICATE_IGNORED", heartbeatSequence: body.heartbeatSequence } as const;
      }
      if (sequence < status.last_heartbeat_sequence) {
        return {
          result: "HEARTBEAT_REPLAY_REJECTED",
          expectedAbove: Number(status.last_heartbeat_sequence),
        } as const;
      }

      // Raw telemetry: the canonical 0010 relation. observed_at is HUB time.
      await client.query(
        `insert into edge_hardware.device_heartbeat
           (id, tenant_id, digital_store_id, location_id, device_id, device_kind,
            observed_at, application_version, config_snapshot_version,
            uptime_seconds, disk_free_bytes, lan_state, wan_state,
            last_hub_sequence, health_state, details_json)
         values ($1, $2, $3, $4, $5, 'terminal', now(), $6, $7, $8, $9,
                 'connected', 'unreported', null, $10, $11)`,
        [
          randomUUID(),
          scope.tenant_id,
          scope.digital_store_id,
          scope.location_id,
          terminalDeviceId,
          body.applicationVersion,
          body.configSnapshotVersion,
          body.uptimeSeconds,
          body.diskFreeBytes ?? null,
          body.peripheralSummary ?? "unknown",
          JSON.stringify({
            queue_depth: body.queueDepth ?? null,
            local_database_available: body.localDatabaseAvailable ?? null,
            terminal_observed_at_diagnostic: body.observedAt ?? null,
            reason_codes: body.reasonCodes ?? [],
          }),
        ],
      );

      const fromState = status.derived_state;
      await client.query(
        `update edge_hardware.terminal_health_status
            set derived_state = 'healthy',
                health_reasons = '{}',
                last_heartbeat_at = now(),
                heartbeat_count = heartbeat_count + 1,
                last_heartbeat_sequence = $2,
                software_version = $3,
                derived_at = now(),
                updated_at = now()
          where terminal_device_id = $1`,
        [terminalDeviceId, sequence.toString(), body.applicationVersion],
      );

      const material = fromState !== "healthy";
      if (material) {
        await emitHealthReport(client, {
          terminalDeviceId,
          scope,
          derivedState: "healthy",
          fromState,
          material: true,
          reasons: [],
          lastHeartbeatAt: nowIso,
          nowIso,
          softwareVersion: body.applicationVersion,
          releaseVersion: body.releaseVersion ?? null,
          configurationVersion: String(body.configSnapshotVersion),
          environment,
        });
      }

      logger?.info({
        event: "terminal_health.heartbeat_accepted",
        terminalDeviceId,
        heartbeatSequence: body.heartbeatSequence,
        material,
      });
      return {
        result: "ACCEPTED",
        derivedState: "healthy",
        heartbeatSequence: body.heartbeatSequence,
        acceptedAt: nowIso,
        materialTransition: material,
      } as const;
    },
    HUB_RUNTIME_ROLE,
  );
}

// ---------------------------------------------------------------------------
// Periodic derivation + cadence reporting.
// ---------------------------------------------------------------------------
export interface DerivationCycleResult {
  readonly examined: number;
  readonly transitions: number;
  readonly cadenceReports: number;
}

/**
 * One derivation pass over RELATIONAL authority (restart-safe: nothing here
 * reads process memory). Ages are computed against the database's now().
 */
export async function runHealthDerivationCycle(
  pool: HubPool,
  environment: string,
  logger?: SafeLogger,
): Promise<DerivationCycleResult> {
  return withSerializableHubTransaction(
    pool,
    async (client) => {
      const rows = await client.query<{
        terminal_device_id: string;
        derived_state: DerivedTerminalState;
        last_reported_state: string | null;
        age_seconds: string | null;
        stale_projection: boolean;
        last_heartbeat_iso: string | null;
        now_iso: string;
        software_version: string | null;
      }>(
        `select s.terminal_device_id,
                s.derived_state,
                s.last_reported_state,
                case when s.last_heartbeat_at is null then null
                     else extract(epoch from (now() - s.last_heartbeat_at))::text end as age_seconds,
                (s.last_projection_sent_at is null
                 or s.last_projection_sent_at <= now() - make_interval(secs => $1)) as stale_projection,
                to_char(s.last_heartbeat_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as last_heartbeat_iso,
                to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as now_iso,
                s.software_version
           from edge_hardware.terminal_health_status s
          order by s.terminal_device_id
          for update`,
        [FLEET_REPORT_CADENCE_SECONDS],
      );

      let transitions = 0;
      let cadenceReports = 0;
      for (const row of rows.rows) {
        const age = row.age_seconds === null ? null : Number(row.age_seconds);
        const nextState = classifyLocalState(age);
        const scope = await loadTerminalScope(client, row.terminal_device_id);

        if (nextState !== row.derived_state) {
          const reasons =
            nextState === "offline_local"
              ? ["heartbeat_missed_beyond_90s"]
              : nextState === "degraded"
                ? ["heartbeat_missed_beyond_45s"]
                : [];
          await client.query(
            `update edge_hardware.terminal_health_status
                set derived_state = $2, health_reasons = $3,
                    derived_at = now(), updated_at = now()
              where terminal_device_id = $1`,
            [row.terminal_device_id, nextState, reasons],
          );
          // Duplicate-transition guard: only emit when the last REPORTED state
          // differs — a restart between derive and report cannot double-emit.
          if (row.last_reported_state !== nextState) {
            await emitHealthReport(client, {
              terminalDeviceId: row.terminal_device_id,
              scope,
              derivedState: nextState,
              fromState: row.derived_state,
              material: true,
              reasons,
              lastHeartbeatAt: row.last_heartbeat_iso,
              nowIso: row.now_iso,
              softwareVersion: row.software_version,
              releaseVersion: null,
              configurationVersion: null,
              environment,
            });
            transitions += 1;
          }
        } else if (row.stale_projection) {
          await emitHealthReport(client, {
            terminalDeviceId: row.terminal_device_id,
            scope,
            derivedState: nextState,
            fromState: null,
            material: false,
            reasons: [],
            lastHeartbeatAt: row.last_heartbeat_iso,
            nowIso: row.now_iso,
            softwareVersion: row.software_version,
            releaseVersion: null,
            configurationVersion: null,
            environment,
          });
          cadenceReports += 1;
        }
      }

      if (transitions > 0 || cadenceReports > 0) {
        logger?.info({
          event: "terminal_health.derivation_cycle",
          examined: rows.rows.length,
          transitions,
          cadenceReports,
        });
      }
      return { examined: rows.rows.length, transitions, cadenceReports };
    },
    HUB_RUNTIME_ROLE,
  );
}

/**
 * The house periodic-task idiom (edge/discovery.ts): immediate first tick,
 * unref'd interval, {stop()}. Overlapping ticks are skipped; serialization
 * failures retry on the next tick (the state is relational, nothing is lost).
 * Cloud availability is never consulted: reports land in the durable outbox
 * at delivery_state 'pending' and the WS-10 sender owns the WAN.
 */
export function startTerminalHealthReporter(
  pool: HubPool,
  environment: string,
  logger?: SafeLogger,
  intervalMs: number = 5_000,
): { stop(): void } {
  let running = false;
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (running || stopped) return;
    running = true;
    try {
      await runHealthDerivationCycle(pool, environment, logger);
    } catch (error) {
      if (!isSerializationFailure(error)) {
        logger?.info({
          event: "terminal_health.derivation_error",
          message: error instanceof Error ? error.message : "unknown",
        });
      }
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
