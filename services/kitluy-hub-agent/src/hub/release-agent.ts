/**
 * A/B release agent for the Store Hub and its T1–T4 terminals
 * (WS-11-T006-P04).
 *
 * Authority: KLD-2026-08-06-WS11-T006-001 §6 (LOCKED health gate: 5-minute
 * window / 20-second probes / 3 consecutive successes / ONE automatic
 * rollback / failed_rolled_back terminal for automatic retry); hub groups
 * 0038 (verified cache) and 0039 (durable state, matrix + one-rollback
 * enforced in schema, auto-journalled).
 *
 * DISCIPLINE. State is persisted BEFORE every externally visible step and
 * every decision resumes from the DATABASE, never process memory. Health
 * verification never touches the WAN. Application rollback restarts the
 * previous slot — it NEVER restores a database snapshot: P02 recovery is a
 * separate governed procedure this module cannot invoke (it holds no
 * backup/restore capability at all).
 *
 * ADAPTER HONESTY (§11): slot staging, restart and boot detection are
 * device adapters. The repository has no Raspberry Pi boot-slot or Electron
 * auto-update runtime to drive on this development host, so the shipped
 * adapters in the test suite are production-SHAPED fakes; the remaining
 * runtime-adapter gap is recorded in the P04 handoff and the capability
 * census, not claimed.
 */
import { randomUUID } from "node:crypto";

import { withHubTransaction, HUB_RUNTIME_ROLE, type HubPool } from "./db.js";

export const HEALTH_PROBE_INTERVAL_MS = 20_000 as const;
export const HEALTH_WINDOW_MS = 300_000 as const;
export const HEALTH_REQUIRED_CONSECUTIVE = 3 as const;

export type Slot = "a" | "b";

export interface SlotAdapter {
  bootedSlot(): Promise<Slot>;
  stage(slot: Slot, releaseId: string): Promise<void>;
  verifyStaged(slot: Slot, releaseId: string): Promise<boolean>;
  restartInto(slot: Slot): Promise<void>;
  availableDiskBytes(): Promise<number>;
}

export interface HealthProbe {
  probe(): Promise<{ readonly healthy: boolean; readonly failures: readonly string[] }>;
}

export interface GateTimings {
  readonly probeIntervalMs: number;
  readonly windowMs: number;
  readonly requiredConsecutive: number;
}

export const OWNER_GATE: GateTimings = {
  probeIntervalMs: HEALTH_PROBE_INTERVAL_MS,
  windowMs: HEALTH_WINDOW_MS,
  requiredConsecutive: HEALTH_REQUIRED_CONSECUTIVE,
};

export interface BackupEvidence {
  readonly backupId: string;
  readonly verified: boolean;
}

export interface InstallRequest {
  readonly releaseId: string;
  readonly deviceKind: "store_hub" | "terminal";
  readonly terminalDeviceId?: string;
  readonly currentVersion: string | null;
  readonly backup: BackupEvidence;
  /** Release ids the sync layer has learned are REVOKED cloud-side. */
  readonly revokedReleaseIds: ReadonlySet<string>;
  readonly operatorRef: string;
}

export type InstallOutcome =
  | {
      readonly result: "PENDING_RESTART";
      readonly installationId: string;
      readonly candidateSlot: Slot;
    }
  | {
      readonly result: "ALREADY_IN_PROGRESS";
      readonly installationId: string;
      readonly state: string;
    }
  | { readonly result: "REFUSED"; readonly refusalCode: string };

interface CacheRow {
  readonly state: string;
  readonly version: string;
  readonly artifact_size_bytes: string | number | bigint;
  readonly rollback_release_id: string | null;
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
}

/**
 * Prechecks (§13) then the durable walk assigned → … → pending_restart,
 * persisting each state. A failed precheck touches NOTHING on the active
 * slot; refusal codes are exact.
 */
export async function beginInstallation(
  pool: HubPool,
  request: InstallRequest,
  adapter: SlotAdapter,
): Promise<InstallOutcome> {
  const refusal = await withHubTransaction(
    pool,
    async (client) => {
      const live = await client.query<{ id: string; state: string }>(
        `select id, state from edge_config.release_installation
          where device_kind = $1
            and coalesce(terminal_device_id, '00000000-0000-0000-0000-000000000000') =
                coalesce($2::uuid, '00000000-0000-0000-0000-000000000000')
            and state not in ('current', 'failed', 'failed_rolled_back', 'cancelled')`,
        [request.deviceKind, request.terminalDeviceId ?? null],
      );
      if (live.rows[0] !== undefined) {
        return { kind: "in_progress", id: live.rows[0].id, state: live.rows[0].state } as const;
      }
      // §6: after failed_rolled_back, automatic retry of the SAME release is
      // blocked; an operator action or a NEWER signed release is required.
      const rolledBack = await client.query<{ n: string }>(
        `select count(*)::text as n from edge_config.release_installation
          where release_cache_id = $1 and state = 'failed_rolled_back'`,
        [request.releaseId],
      );
      if (Number(rolledBack.rows[0]?.n ?? "0") > 0) {
        return { kind: "refused", code: "INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK" } as const;
      }
      if (request.revokedReleaseIds.has(request.releaseId)) {
        return { kind: "refused", code: "RELEASE_REVOKED" } as const;
      }
      const cache = await client.query<CacheRow>(
        `select state, version, artifact_size_bytes, rollback_release_id,
                tenant_id, digital_store_id, location_id
           from edge_config.release_cache where id = $1`,
        [request.releaseId],
      );
      const row = cache.rows[0];
      if (row === undefined || row.state !== "cached") {
        return { kind: "refused", code: "RELEASE_NOT_CACHED_AND_VERIFIED" } as const;
      }
      const mode = await client.query<{ mode: string }>(
        `select mode from edge_identity.hub_replacement_state where singleton`,
      );
      if ((mode.rows[0]?.mode ?? "normal") !== "normal") {
        return { kind: "refused", code: "INSTALL_BLOCKED_BY_REPLACEMENT_STATE" } as const;
      }
      if (request.deviceKind === "terminal") {
        const contained = await client.query<{ directive: string }>(
          `select directive from edge_identity.effective_containment where device_uuid = $1`,
          [request.terminalDeviceId],
        );
        const directive = contained.rows[0]?.directive;
        if (
          directive === "operations_restricted" ||
          directive === "suspended" ||
          directive === "quarantined"
        ) {
          return { kind: "refused", code: "INSTALL_BLOCKED_BY_CONTAINMENT" } as const;
        }
      }
      if (!request.backup.verified) {
        return { kind: "refused", code: "PRE_RELEASE_BACKUP_NOT_VERIFIED" } as const;
      }
      if (row.rollback_release_id !== null) {
        const rollbackCached = await client.query<{ state: string }>(
          `select state from edge_config.release_cache where id = $1`,
          [row.rollback_release_id],
        );
        if (rollbackCached.rows[0]?.state !== "cached") {
          return { kind: "refused", code: "ROLLBACK_ARTIFACT_UNAVAILABLE" } as const;
        }
      }
      const disk = await adapter.availableDiskBytes();
      if (disk < Number(row.artifact_size_bytes) * 2) {
        return { kind: "refused", code: "INSUFFICIENT_DISK" } as const;
      }
      return { kind: "ok", row } as const;
    },
    HUB_RUNTIME_ROLE,
  );

  if (refusal.kind === "in_progress") {
    return { result: "ALREADY_IN_PROGRESS", installationId: refusal.id, state: refusal.state };
  }
  if (refusal.kind === "refused") {
    return { result: "REFUSED", refusalCode: refusal.code };
  }
  const cacheRow = refusal.row;

  const installationId = randomUUID();
  const activeSlot = await adapter.bootedSlot();
  const candidate: Slot = activeSlot === "a" ? "b" : "a";

  const persist = async (sets: string, params: unknown[]): Promise<void> => {
    await withHubTransaction(
      pool,
      async (client) => {
        await client.query(
          `update edge_config.release_installation set ${sets}, updated_at = now() where id = $1`,
          [installationId, ...params],
        );
      },
      HUB_RUNTIME_ROLE,
    );
  };

  await withHubTransaction(
    pool,
    async (client) => {
      await client.query(
        `insert into edge_config.release_installation
           (id, release_cache_id, device_kind, terminal_device_id, tenant_id,
            digital_store_id, location_id, candidate_version, current_version,
            active_slot, backup_ref)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          installationId,
          request.releaseId,
          request.deviceKind,
          request.terminalDeviceId ?? null,
          cacheRow.tenant_id,
          cacheRow.digital_store_id,
          cacheRow.location_id,
          cacheRow.version,
          request.currentVersion,
          activeSlot,
          request.backup.backupId,
        ],
      );
    },
    HUB_RUNTIME_ROLE,
  );

  // The durable walk. Each step persists BEFORE the next externally visible
  // action; a crash resumes from the recorded state.
  await persist(`state = 'downloading'`, []);
  await persist(`state = 'verified'`, []);
  await persist(`state = 'staged', candidate_slot = $2`, [candidate]);
  await adapter.stage(candidate, request.releaseId);
  const staged = await adapter.verifyStaged(candidate, request.releaseId);
  if (!staged) {
    await persist(`state = 'failed', failure_reason = 'staged slot verification failed'`, []);
    return { result: "REFUSED", refusalCode: "STAGED_SLOT_VERIFICATION_FAILED" };
  }
  await persist(`state = 'installing_inactive_slot'`, []);
  await persist(`state = 'pending_restart'`, []);
  await adapter.restartInto(candidate);
  return { result: "PENDING_RESTART", installationId, candidateSlot: candidate };
}

export type ResumeOutcome =
  | { readonly result: "PROMOTED"; readonly installationId: string }
  | { readonly result: "ROLLED_BACK"; readonly installationId: string; readonly reason: string }
  | { readonly result: "NOTHING_PENDING" };

/**
 * The post-restart half: pure durable-state resume (nothing from process
 * memory). Runs the LOCKED health gate — probes offline, promotes only on
 * three consecutive successes inside the window, otherwise takes the ONE
 * automatic rollback and lands terminal.
 */
export async function resumeAfterRestart(
  pool: HubPool,
  adapter: SlotAdapter,
  probe: HealthProbe,
  timings: GateTimings = OWNER_GATE,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<ResumeOutcome> {
  const pending = await withHubTransaction(
    pool,
    async (client) =>
      (
        await client.query<{
          id: string;
          state: string;
          active_slot: Slot | null;
          candidate_slot: Slot | null;
          candidate_version: string;
          current_version: string | null;
        }>(
          `select id, state, active_slot, candidate_slot, candidate_version, current_version
             from edge_config.release_installation
            where state in ('pending_restart', 'health_checking')
            order by created_at limit 1`,
        )
      ).rows,
    HUB_RUNTIME_ROLE,
  );
  const row = pending[0];
  if (row === undefined) return { result: "NOTHING_PENDING" };

  const persist = async (sets: string, params: unknown[]): Promise<void> => {
    await withHubTransaction(
      pool,
      async (client) => {
        await client.query(
          `update edge_config.release_installation set ${sets}, updated_at = now() where id = $1`,
          [row.id, ...params],
        );
      },
      HUB_RUNTIME_ROLE,
    );
  };

  const booted = await adapter.bootedSlot();
  if (booted !== row.candidate_slot) {
    // The candidate never came up — the device is on the previous slot.
    await persist(
      `state = case state when 'pending_restart' then 'failed' else state end,
       failure_reason = 'candidate slot did not boot'`,
      [],
    );
    if (row.state === "health_checking") {
      await persist(
        `state = 'rolling_back', failure_reason = 'candidate slot lost after restart'`,
        [],
      );
      await persist(`state = 'failed_rolled_back'`, []);
      return { result: "ROLLED_BACK", installationId: row.id, reason: "candidate slot lost" };
    }
    return { result: "ROLLED_BACK", installationId: row.id, reason: "candidate did not boot" };
  }

  if (row.state === "pending_restart") {
    await persist(`state = 'health_checking', probes_started_at = now(), probe_successes = 0`, []);
  }

  const started = Date.now();
  let consecutive = 0;
  let reason = "health window expired";
  while (Date.now() - started < timings.windowMs) {
    const health = await probe.probe();
    if (health.healthy) {
      consecutive += 1;
      await persist(`probe_successes = $2`, [consecutive]);
      if (consecutive >= timings.requiredConsecutive) {
        await persist(
          `state = 'current', active_slot = $2, rollback_version = current_version,
           current_version = candidate_version`,
          [row.candidate_slot],
        );
        return { result: "PROMOTED", installationId: row.id };
      }
    } else {
      consecutive = 0;
      reason = `health probe failed: ${health.failures.join(",")}`;
      await persist(`probe_successes = 0`, []);
    }
    await sleep(timings.probeIntervalMs);
  }

  // The ONE automatic rollback (schema-pinned): boot the previous slot,
  // verify it, land terminal. The DATABASE is untouched — recovery is P02's
  // separate governed procedure.
  await persist(`state = 'rolling_back', failure_reason = $2`, [reason]);
  if (row.active_slot !== null) {
    await adapter.restartInto(row.active_slot);
    const back = await adapter.bootedSlot();
    if (back !== row.active_slot) {
      await persist(
        `state = 'failed', failure_reason = 'previous slot did not boot after rollback'`,
        [],
      );
      return { result: "ROLLED_BACK", installationId: row.id, reason: "rollback boot failed" };
    }
  }
  await persist(`state = 'failed_rolled_back'`, []);
  return { result: "ROLLED_BACK", installationId: row.id, reason };
}

export async function cancelInstallation(
  pool: HubPool,
  installationId: string,
  operatorRef: string,
  reason: string,
): Promise<{ result: "CANCELLED" | "NOT_CANCELLABLE" }> {
  return withHubTransaction(
    pool,
    async (client) => {
      const { rows } = await client.query<{ state: string }>(
        `select state from edge_config.release_installation where id = $1 for update`,
        [installationId],
      );
      const state = rows[0]?.state;
      if (
        state === undefined ||
        !["assigned", "downloading", "verified", "staged"].includes(state)
      ) {
        return { result: "NOT_CANCELLABLE" } as const;
      }
      await client.query(
        `update edge_config.release_installation
            set state = 'cancelled', cancelled_by = $2, cancel_reason = $3, updated_at = now()
          where id = $1`,
        [installationId, operatorRef, reason],
      );
      return { result: "CANCELLED" } as const;
    },
    HUB_RUNTIME_ROLE,
  );
}

/**
 * Production-shaped OFFLINE health probe (§14): process liveness is implied
 * by execution; the rest is local database availability, schema state, the
 * outbox, device identity and operational (replacement-mode) readiness — no
 * WAN anywhere.
 */
export function createHubHealthProbe(pool: HubPool): HealthProbe {
  return {
    async probe() {
      const failures: string[] = [];
      try {
        await withHubTransaction(
          pool,
          async (client) => {
            await client.query("select 1");
            const head = await client.query<{ n: string }>(
              `select count(*)::text as n from edge_ops.migration_journal`,
            );
            if (Number(head.rows[0]?.n ?? "0") < 1) failures.push("schema_state");
            const outbox = await client.query<{ n: string }>(
              `select count(*)::text as n from edge_sync.outbox`,
            );
            if (outbox.rows[0] === undefined) failures.push("outbox_unavailable");
            const hub = await client.query<{ n: string }>(
              `select count(*)::text as n from edge_identity.hub_device`,
            );
            if (Number(hub.rows[0]?.n ?? "0") < 1) failures.push("device_identity");
            const mode = await client.query<{ mode: string }>(
              `select mode from edge_identity.hub_replacement_state where singleton`,
            );
            if ((mode.rows[0]?.mode ?? "normal") !== "normal") {
              failures.push("operational_readiness");
            }
          },
          HUB_RUNTIME_ROLE,
        );
      } catch {
        failures.push("local_database");
      }
      return { healthy: failures.length === 0, failures };
    },
  };
}
