/**
 * THE canonical Hub idempotency service (KLREQ-020: "Key parsing/generation is
 * isolated behind ONE interface").
 *
 * DATABASE-AUTHORITATIVE. There is deliberately no in-process Map: the
 * reservation IS the unique index on `edge_sync.command_result.idempotency_key`
 * (offline contract §4 "reserve idempotency key"), so a concurrent duplicate
 * blocks on the row lock until the first transaction commits or rolls back and
 * no uncommitted reservation ever survives a crash.
 *
 * Contract (offline §4/§19; WS-09-T004 failure modes):
 *   same key + same request hash, committed   -> return the ORIGINAL result
 *   same key + same request hash, in progress -> `in_progress` (202 accepted)
 *   same key + different request hash         -> refusal
 *       EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH == IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST
 *   lower origin_sequence                     -> EDGE_SEQUENCE_REPLAY_REJECTED
 *   higher origin_sequence with a gap         -> EDGE_SEQUENCE_GAP
 *
 * KEY FORMAT — the canonical `kl1.{terminal_device_uuid}.{client_sequence}`
 * only (offline contract §2; recorded gap G1). The non-canonical
 * `location:…:hub:…:seq:N` shape emitted by `@kitluy/sync-protocol` is rejected
 * here and by every Hub CHECK constraint; its correction is KLREQ-020 and is
 * NOT aliased.
 */
import type { HubClient } from "./db.js";
import { HubCommandError, fromDatabaseError } from "./errors.js";
import {
  buildIdempotencyKey,
  canonicalRequestHash,
  isCanonicalIdempotencyKey,
  parseIdempotencyKey,
  type CanonicalRequest,
  type ParsedIdempotencyKey,
} from "../hub-database.js";

export {
  buildIdempotencyKey,
  canonicalRequestHash,
  isCanonicalIdempotencyKey,
  parseIdempotencyKey,
  type CanonicalRequest,
  type ParsedIdempotencyKey,
};

/**
 * Hub-issued event key for the SECOND and later events of one command.
 *
 * RECORDED FINDING (WS-09 command layer). `edge_sync.local_event.idempotency_key`
 * is UNIQUE and CHECKed against the canonical §2 shape, while a single approved
 * command legitimately produces several events (confirm-intake writes a status
 * event, one custody event per unit and a payment event — each business row
 * carries its own UNIQUE `event_id` referencing a distinct `local_event`). The
 * offline contract §2 defines only TERMINAL-issued keys, so a second namespace
 * is unavoidable. It is derived from the HUB device UUID plus the never-reused
 * `hub_sequence` (offline §5), which:
 *   - satisfies the canonical shape byte for byte,
 *   - is unique by construction, and
 *   - is unambiguously distinguishable from a terminal key, because the Hub
 *     device id is never a `edge_identity.terminal_device` id.
 * The first event of a command keeps the terminal-issued command key, matching
 * the shipped fixtures. Amendment to the offline contract is OWED.
 */
export function deriveHubEventKey(hubDeviceId: string, hubSequence: bigint): string {
  return buildIdempotencyKey(hubDeviceId, hubSequence);
}

/** Commit status vocabulary of `edge_sync.command_result` (0009 CHECK). */
export type CommandCommitStatus = "in_progress" | "committed" | "failed" | "rejected";

/**
 * `edge_sync.command_result.sync_state` — the COMMAND outcome vocabulary
 * (WS-09-T004), a different subject from the per-event
 * `edge_sync.delivery_state` (recorded gap G2 / KLREQ-021).
 *
 * WS-09 may write only `committed_locally`, `pending_cloud_sync` and
 * `reconciliation_required`. `cloud_acknowledged` and `cloud_rejected` belong
 * to WS-10 after a REAL cloud response and are never fabricated here.
 */
export type CommandSyncState =
  | "committed_locally"
  | "pending_cloud_sync"
  | "cloud_acknowledged"
  | "cloud_rejected"
  | "reconciliation_required";

/** Sync states WS-09 is permitted to persist (amendment §2 acceptance rule 5). */
export const WS09_WRITABLE_SYNC_STATES: readonly CommandSyncState[] = [
  "committed_locally",
  "pending_cloud_sync",
  "reconciliation_required",
];

export interface CommandOutcomeRow {
  request_id: string | null;
  aggregate_id: string | null;
  aggregate_version: bigint | null;
  event_ids: string[] | null;
  hub_sequence_first: bigint | null;
  hub_sequence_last: bigint | null;
  sync_state: CommandSyncState | null;
  outcome: "accepted" | "duplicate" | "in_progress" | "rejected";
  error_code: string | null;
}

export interface ReserveCommandInput {
  readonly commandResultId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly terminalDeviceId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly commandType: string;
  readonly aggregateType: string;
  readonly actorId: string | null;
  readonly originSequence: bigint | null;
  readonly assignmentGeneration: number;
  readonly requestId: string | null;
}

/**
 * LOCK the terminal sequence record, VERIFY the origin sequence and RESERVE the
 * key — offline contract §4 steps 1-3, executed by
 * `edge_sync.accept_terminal_command` so the algorithm has exactly ONE
 * implementation and it is the one the database enforces.
 *
 * MUST be called inside a SERIALIZABLE transaction (§1 "Transactions"); the
 * caller completes the reservation with {@link completeCommand} in the SAME
 * transaction.
 */
export async function reserveOrLoadCommand(
  client: HubClient,
  input: ReserveCommandInput,
): Promise<CommandOutcomeRow> {
  if (!isCanonicalIdempotencyKey(input.idempotencyKey)) {
    throw new HubCommandError(
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      `'${input.idempotencyKey}' is not kl1.{terminal_device_uuid}.{client_sequence} (offline contract §2).`,
      { idempotencyKey: input.idempotencyKey },
    );
  }
  // §2 rule: the key names the terminal that issued it. A key minted for a
  // different device is a forged key, not a retry.
  const parsed = parseIdempotencyKey(input.idempotencyKey);
  if (parsed.terminalDeviceId.toLowerCase() !== input.terminalDeviceId.toLowerCase()) {
    throw new HubCommandError(
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      `idempotency key names terminal ${parsed.terminalDeviceId} but the command was presented by ${input.terminalDeviceId}.`,
      { idempotencyKey: input.idempotencyKey },
    );
  }

  try {
    const result = await client.query<CommandOutcomeRow>(
      `select * from edge_sync.accept_terminal_command(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::char(64),
         $8::text, $9::text, $10::uuid, $11::bigint, $12::integer, $13::uuid)`,
      [
        input.commandResultId,
        input.tenantId,
        input.digitalStoreId,
        input.locationId,
        input.terminalDeviceId,
        input.idempotencyKey,
        input.requestHash,
        input.commandType,
        input.aggregateType,
        input.actorId,
        input.originSequence === null ? null : input.originSequence.toString(),
        input.assignmentGeneration,
        input.requestId,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new HubCommandError(
        "EDGE_TERMINAL_UNKNOWN",
        "edge_sync.accept_terminal_command returned no outcome row.",
      );
    }
    return row;
  } catch (error) {
    const mapped = fromDatabaseError(error);
    if (mapped) {
      // WS-09-T004 spells the same fact with its own code; both are surfaced so
      // neither vocabulary silently disappears.
      if (mapped.code === "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH") {
        throw new HubCommandError(
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
          `${mapped.message} (offline contract §3 EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH).`,
          { idempotencyKey: input.idempotencyKey, commandType: input.commandType },
        );
      }
      throw mapped;
    }
    throw error;
  }
}

export interface CompleteCommandInput {
  readonly idempotencyKey: string;
  readonly commitStatus: Exclude<CommandCommitStatus, "in_progress">;
  readonly syncState: CommandSyncState;
  readonly aggregateId: string | null;
  readonly aggregateVersion: bigint | null;
  readonly eventIds: readonly string[];
  readonly hubSequenceFirst: bigint | null;
  readonly hubSequenceLast: bigint | null;
  readonly errorCode: string | null;
  readonly resultJson: Readonly<Record<string, unknown>>;
}

/**
 * Freeze the command result (offline §4 "store immutable command result").
 * Exactly one `in_progress -> terminal` transition is permitted; the 0012
 * trigger rejects every other write and every DELETE.
 */
export async function completeCommand(
  client: HubClient,
  input: CompleteCommandInput,
): Promise<CommandOutcomeRow> {
  if (!WS09_WRITABLE_SYNC_STATES.includes(input.syncState)) {
    // A fabricated cloud outcome is refused BEFORE it can be written
    // (amendment §2: WS-09 never claims a cloud acknowledgement).
    throw new HubCommandError(
      "EDGE_COMMAND_INACTIVE",
      `WS-09 may not persist sync_state '${input.syncState}'; cloud acknowledgement belongs to WS-10.`,
      { syncState: input.syncState },
    );
  }
  try {
    const result = await client.query<CommandOutcomeRow>(
      `select * from edge_sync.complete_command(
         $1::text, $2::text, $3::text, $4::uuid, $5::bigint, $6::uuid[],
         $7::bigint, $8::bigint, $9::text, $10::jsonb)`,
      [
        input.idempotencyKey,
        input.commitStatus,
        input.syncState,
        input.aggregateId,
        input.aggregateVersion === null ? null : input.aggregateVersion.toString(),
        [...input.eventIds],
        input.hubSequenceFirst === null ? null : input.hubSequenceFirst.toString(),
        input.hubSequenceLast === null ? null : input.hubSequenceLast.toString(),
        input.errorCode,
        JSON.stringify(input.resultJson),
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new HubCommandError(
        "EDGE_COMMAND_UNKNOWN",
        `no in-progress command result for key ${input.idempotencyKey}.`,
      );
    }
    return row;
  } catch (error) {
    const mapped = fromDatabaseError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

export interface StoredCommandResult {
  idempotency_key: string;
  request_hash: string;
  command_type: string;
  commit_status: CommandCommitStatus;
  sync_state: CommandSyncState | null;
  aggregate_id: string | null;
  aggregate_version: bigint | null;
  event_ids: string[];
  hub_sequence_first: bigint | null;
  hub_sequence_last: bigint | null;
  error_code: string | null;
  result_json: Record<string, unknown>;
  created_at: Date;
  completed_at: Date | null;
}

/** Read the immutable stored result — used to answer a retry after a lost response. */
export async function loadCommandResult(
  client: HubClient,
  idempotencyKey: string,
): Promise<StoredCommandResult | undefined> {
  const result = await client.query<StoredCommandResult>(
    `select idempotency_key, request_hash, command_type, commit_status, sync_state,
            aggregate_id, aggregate_version, event_ids, hub_sequence_first,
            hub_sequence_last, error_code, result_json, created_at, completed_at
       from edge_sync.command_result where idempotency_key = $1`,
    [idempotencyKey],
  );
  return result.rows[0];
}
