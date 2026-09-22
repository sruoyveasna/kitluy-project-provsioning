/**
 * THE canonical Hub command pipeline.
 *
 * ONE shared implementation that every Hub command goes through, in this exact
 * order (Store Hub spec §9; offline contract §4; schema contract §9):
 *
 *   validate device context
 *   -> resolve device assignment (+ assignment_generation)
 *   -> validate actor session (not expired)
 *   -> validate logical terminal profile
 *   -> validate permission
 *   -> validate resource scope
 *   -> validate environment
 *   -> validate approval where required
 *   -> reserve-or-load idempotency record
 *   -> load aggregate + version
 *   -> invoke the CANONICAL DOMAIN ENGINE
 *   -> persist aggregate + effects
 *   -> append custody/payment records
 *   -> append audit event
 *   -> append event-outbox entry
 *   -> append command result
 *   -> COMMIT
 *   -> return the committed response
 *
 * TRANSACTION NOTE (stronger than the stated order, never weaker): the SINGLE
 * SERIALIZABLE transaction is opened BEFORE the authorisation reads, so the
 * terminal sequence record, the Booking row and the storage position are all
 * locked for the whole command (§1 "Transactions"). Consequently NO mutation
 * can return success before COMMIT — there is no code path that reports a
 * result from an uncommitted transaction.
 *
 * The engines (`@kitluy-verticals/phase1-laundry`, `@kitluy/payments`) are the
 * ONLY transition-decision authority. This module never decides a transition;
 * it decides authorisation, idempotency, ordering and durability.
 */
import { assertValidEnvelope } from "@kitluy/event-contracts";
import type { HubPool } from "./db.js";
import {
  isSerializationFailure,
  withSerializableHubTransaction,
  withHubTransaction,
  type HubClient,
} from "./db.js";
import { HubCommandError, fromDatabaseError, type HubCommandErrorCode } from "./errors.js";
import {
  authorizeHubCommand,
  type AuthorizedCommandContext,
  type HubApprovalEvidence,
  type HubDeviceContext,
} from "./authorization.js";
import { requireActiveHubCommand, type HubCommandDefinition } from "./command-registry.js";
import { declaredEffects } from "./effect-contract.js";
import { canonicalRequestHash, completeCommand, reserveOrLoadCommand } from "./idempotency.js";
import { HubEventRecorder, payloadChecksum } from "./outbox.js";
import { auditRepo, syncRepo } from "./repositories/index.js";
import { uuidv7 } from "./uuid.js";

/** Everything a handler may use inside the command transaction. */
export interface HubCommandExecution {
  readonly client: HubClient;
  readonly definition: HubCommandDefinition;
  readonly auth: AuthorizedCommandContext;
  readonly recorder: HubEventRecorder;
  readonly correlationId: string;
  readonly requestId: string;
  readonly idempotencyKey: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly businessDate: string;
}

export interface HubHandlerResult {
  readonly aggregateId: string;
  readonly aggregateVersion: bigint;
  readonly resultJson: Readonly<Record<string, unknown>>;
  readonly auditResourceType: string;
  readonly auditResourceId: string | null;
  readonly auditReasonCode?: string | null;
  readonly auditDetails?: Readonly<Record<string, unknown>>;
}

export type HubCommandHandler = (execution: HubCommandExecution) => Promise<HubHandlerResult>;

export interface HubCommandRequest {
  readonly commandType: string;
  readonly device: HubDeviceContext;
  /** Canonical `kl1.{terminal_device_uuid}.{client_sequence}` (offline §2). */
  readonly idempotencyKey: string;
  /** Terminal-issued client sequence; verified by the acceptance algorithm (§4). */
  readonly clientSequence: bigint;
  readonly body: Readonly<Record<string, unknown>>;
  readonly businessDate: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly approval?: HubApprovalEvidence;
  readonly requiredConditionalPermissions?: readonly string[];
  readonly targetScope?: {
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly locationId: string;
  };
}

export interface HubCommandResult {
  /** `accepted` = committed now; `duplicate` = the ORIGINAL stored result. */
  readonly outcome: "accepted" | "duplicate" | "in_progress";
  readonly commandType: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly aggregateId: string | null;
  readonly aggregateVersion: bigint | null;
  readonly eventIds: readonly string[];
  readonly hubSequenceFirst: bigint | null;
  readonly hubSequenceLast: bigint | null;
  /** WS-09 records LOCAL truth only (amendment §2). */
  readonly syncState: "committed_locally";
  /** The wire vocabulary the LAN API reports (amendment §2 mapping table). */
  readonly wireSyncState: "pending_cloud_sync";
  readonly result: Readonly<Record<string, unknown>>;
}

/**
 * SERIALIZABLE transactions may be rejected with `40001` purely because of a
 * read/write dependency cycle; PostgreSQL's contract is that such a transaction
 * may be RETRIED UNCHANGED. The retry budget covers a busy Store counter (the
 * per-Location display-number allocator is a deliberately hot row, schema
 * contract §7) without ever weakening isolation. Exactly-once is preserved by
 * the idempotency reservation, not by the retry count.
 */
const MAX_CONCURRENCY_RETRIES = 12;
const RETRY_BASE_DELAY_MS = 12;

function isDuplicateKeyRace(error: unknown): boolean {
  const err = error as { code?: string; constraint?: string } | null;
  return err?.code === "23505" && (err.constraint ?? "").includes("command_result");
}

async function backoff(attempt: number): Promise<void> {
  const ceiling = RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt, 6);
  const delay = Math.floor(Math.random() * ceiling) + 1;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Execute one command end to end. `handler` runs ONLY after every
 * authorisation dimension passed and the idempotency key was reserved, and its
 * writes share the command's single transaction.
 */
export async function executeHubCommand(
  pool: HubPool,
  request: HubCommandRequest,
  handler: HubCommandHandler,
): Promise<HubCommandResult> {
  // Fails closed for an unknown command and for every command whose permission
  // key is still a `[REQUIRED: ...]` marker (KLREQ-015).
  const definition = requireActiveHubCommand(request.commandType);

  const requestId = request.requestId ?? uuidv7();
  const correlationId = request.correlationId ?? requestId;
  const requestHash = canonicalRequestHash({
    method: definition.method,
    routeTemplate: definition.routeTemplate,
    body: request.body,
    terminalDeviceId: request.device.terminalDeviceId,
    sessionId: request.device.sessionId,
    profileCode: request.device.profileCode,
  });

  let attempt = 0;
  for (;;) {
    attempt += 1;
    // Sequence allocation is NON-transactional (offline §5), so the values this
    // attempt takes must survive a rollback in order to be journalled. The
    // recorder is therefore held OUTSIDE the transaction callback.
    const burntSequences: bigint[] = [];
    let recorderRef: HubEventRecorder | undefined;
    try {
      return await withSerializableHubTransaction(pool, async (client) => {
        const auth = await authorizeHubCommand(client, definition, request.device, {
          ...(request.targetScope ? { targetScope: request.targetScope } : {}),
          ...(request.approval ? { approval: request.approval } : {}),
          ...(request.requiredConditionalPermissions
            ? { requiredConditionalPermissions: request.requiredConditionalPermissions }
            : {}),
        });

        // The reserved command-result id is also the `kh1.*` effect-key
        // namespace for every event this command emits (KLREQ-026), so it is
        // captured rather than inlined.
        const commandResultId = uuidv7();
        const reservation = await reserveOrLoadCommand(client, {
          commandResultId,
          tenantId: request.device.tenantId,
          digitalStoreId: request.device.digitalStoreId,
          locationId: request.device.locationId,
          terminalDeviceId: request.device.terminalDeviceId,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          commandType: definition.commandType,
          aggregateType: definition.aggregateType,
          actorId: request.device.actorId,
          originSequence: request.clientSequence,
          assignmentGeneration: auth.assignmentGeneration,
          requestId,
        });

        if (reservation.outcome !== "accepted") {
          // A retry after a lost response, or a genuinely concurrent duplicate.
          // The ORIGINAL committed result is returned and NOTHING new is
          // written (offline §19 rows 1-2; §12 acceptance test 2). The stored
          // `result_json` rides along so a terminal that lost the first answer
          // learns the SAME booking number, receipt and change — not just that
          // "something" was replayed.
          const stored = await loadStoredResultJson(client, request.idempotencyKey);
          return storedResult(definition, request, reservation, requestId, stored);
        }

        const recorder = new HubEventRecorder(client, {
          tenantId: request.device.tenantId,
          digitalStoreId: request.device.digitalStoreId,
          locationId: request.device.locationId,
          hubDeviceId: auth.hubDeviceId,
          originDeviceId: request.device.terminalDeviceId,
          actorId: request.device.actorId,
          actorType: auth.actorType === "terminal_device" ? "device" : "user",
          assignmentGeneration: auth.assignmentGeneration,
          businessDate: request.businessDate,
          correlationId,
          originSequence: request.clientSequence,
          commandIdempotencyKey: request.idempotencyKey,
          commandResultId,
          commandType: definition.commandType,
          declaredEffects: declaredEffects(definition),
        });
        recorderRef = recorder;

        const handled = await handler({
          client,
          definition,
          auth,
          recorder,
          correlationId,
          requestId,
          idempotencyKey: request.idempotencyKey,
          body: request.body,
          businessDate: request.businessDate,
        });
        // Append the audit event. Four-eyes evidence, when present, names both
        // sides; the 0011 CHECK refuses one person as requester AND approver.
        const auditSequence = await syncRepo.allocateHubSequence(client);
        const auditDetails = {
          command_type: definition.commandType,
          permission: definition.permission,
          permission_source: auth.permissionSource,
          risk_class: definition.riskClass,
          request_id: requestId,
          ...(handled.auditDetails ?? {}),
        };
        await auditRepo.appendAuditEvent(client, {
          id: uuidv7(),
          tenantId: request.device.tenantId,
          digitalStoreId: request.device.digitalStoreId,
          locationId: request.device.locationId,
          eventCode: definition.auditEvent,
          actorType: auth.actorType,
          actorId: request.device.actorId,
          requesterId: request.approval?.request.requestedBy ?? null,
          approverId: request.approval?.decision.approvedBy ?? null,
          terminalDeviceId: request.device.terminalDeviceId,
          hubDeviceId: auth.hubDeviceId,
          profileCode: auth.profile,
          resourceType: handled.auditResourceType,
          resourceId: handled.auditResourceId,
          reasonCode: handled.auditReasonCode ?? null,
          correlationId,
          payloadSha256: payloadChecksum(auditDetails),
          details: auditDetails,
          localSequence: auditSequence,
        });

        const completion = await completeCommand(client, {
          idempotencyKey: request.idempotencyKey,
          commitStatus: "committed",
          syncState: "committed_locally",
          aggregateId: handled.aggregateId,
          aggregateVersion: handled.aggregateVersion,
          eventIds: recorder.eventIds,
          hubSequenceFirst: recorder.hubSequenceFirst,
          hubSequenceLast: recorder.hubSequenceLast,
          errorCode: null,
          resultJson: handled.resultJson,
        });

        return {
          outcome: "accepted" as const,
          commandType: definition.commandType,
          idempotencyKey: request.idempotencyKey,
          requestId,
          aggregateId: completion.aggregate_id,
          aggregateVersion: completion.aggregate_version,
          eventIds: recorder.eventIds,
          hubSequenceFirst: recorder.hubSequenceFirst,
          hubSequenceLast: recorder.hubSequenceLast,
          syncState: "committed_locally" as const,
          wireSyncState: syncRepo.WS09_WIRE_SYNC_STATE,
          result: handled.resultJson,
        };
      });
    } catch (error) {
      // The transaction is already rolled back: NO aggregate, NO event, NO
      // outbox row and NO command result survive. Two follow-up records are
      // written in SEPARATE transactions precisely because they must survive
      // that rollback.
      burntSequences.push(...(recorderRef?.allocatedSequences ?? []));
      await journalBurntSequences(pool, request, burntSequences);

      if (
        attempt < MAX_CONCURRENCY_RETRIES &&
        (isSerializationFailure(error) || isDuplicateKeyRace(error))
      ) {
        // A genuinely concurrent duplicate lost the unique-index race, or two
        // commands serialised badly. Retrying re-enters the pipeline, finds the
        // committed reservation and returns the ORIGINAL result — one business
        // effect, never two.
        await backoff(attempt);
        continue;
      }

      const mapped = error instanceof HubCommandError ? error : fromDatabaseError(error);
      if (mapped) {
        await recordDenialEvidence(pool, request, mapped);
        throw mapped;
      }
      throw error;
    }
  }
}

/** The committed command's own `result_json`, for a duplicate answer. */
async function loadStoredResultJson(
  client: HubClient,
  idempotencyKey: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const found = await client.query<{ result_json: Record<string, unknown>; commit_status: string }>(
    `select result_json, commit_status from edge_sync.command_result where idempotency_key = $1`,
    [idempotencyKey],
  );
  const row = found.rows[0];
  return row !== undefined && row.commit_status === "committed" ? row.result_json : null;
}

function storedResult(
  definition: HubCommandDefinition,
  request: HubCommandRequest,
  reservation: {
    aggregate_id: string | null;
    aggregate_version: bigint | null;
    event_ids: string[] | null;
    hub_sequence_first: bigint | null;
    hub_sequence_last: bigint | null;
    outcome: string;
  },
  requestId: string,
  stored: Readonly<Record<string, unknown>> | null = null,
): HubCommandResult {
  return {
    outcome: reservation.outcome === "in_progress" ? "in_progress" : "duplicate",
    commandType: definition.commandType,
    idempotencyKey: request.idempotencyKey,
    requestId,
    aggregateId: reservation.aggregate_id,
    aggregateVersion: reservation.aggregate_version,
    eventIds: reservation.event_ids ?? [],
    hubSequenceFirst: reservation.hub_sequence_first,
    hubSequenceLast: reservation.hub_sequence_last,
    syncState: "committed_locally",
    wireSyncState: syncRepo.WS09_WIRE_SYNC_STATE,
    result: { ...(stored ?? {}), replayed: true },
  };
}

/**
 * Offline contract §5: sequence allocation is non-transactional, so a
 * rolled-back command BURNS its `hub_sequence` values. Each burnt value is
 * journalled as a KNOWN gap in its own transaction — journalling it inside the
 * failed transaction would roll the journal back with it — so sync batches
 * never treat it as a missing event.
 */
async function journalBurntSequences(
  pool: HubPool,
  request: HubCommandRequest,
  sequences: readonly bigint[],
): Promise<void> {
  if (sequences.length === 0) return;
  try {
    await withHubTransaction(pool, async (client) => {
      for (const hubSequence of sequences) {
        await syncRepo.recordSequenceGap(client, {
          id: uuidv7(),
          tenantId: request.device.tenantId,
          digitalStoreId: request.device.digitalStoreId,
          locationId: request.device.locationId,
          assignmentGeneration: request.device.assignmentGeneration,
          hubSequence,
          gapReason: "transaction_rollback",
          recordedBy: "kitluy-hub-agent",
          note: `command ${request.commandType} rolled back`,
        });
      }
    });
  } catch {
    // Journalling is best-effort recovery evidence; it must never mask the
    // original refusal that the caller has to see.
  }
}

/**
 * A blocked attempt is EVIDENCE, not a silent drop.
 *
 * `edge_sync.accept_terminal_command` inserts an EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH
 * security event and then RAISES, so that insert is rolled back with the
 * transaction (recorded finding: the DDL cannot durably record it on its own).
 * The command layer therefore records the evidence here, AFTER the rollback, in
 * its own transaction.
 */
const EVIDENCE_CODES: ReadonlySet<HubCommandErrorCode> = new Set<HubCommandErrorCode>([
  "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
  "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH",
  "EDGE_IDEMPOTENCY_KEY_MALFORMED",
  "EDGE_SEQUENCE_REPLAY_REJECTED",
  "EDGE_SEQUENCE_GAP",
  "EDGE_SCOPE_MISMATCH",
  "EDGE_TERMINAL_UNKNOWN",
  "EDGE_DEVICE_CONTEXT_INVALID",
  "EDGE_DEVICE_NOT_ASSIGNED",
  "EDGE_DEVICE_REVOKED",
  "EDGE_ASSIGNMENT_GENERATION_MISMATCH",
  "EDGE_SESSION_INVALID",
  "EDGE_SESSION_EXPIRED",
  "EDGE_PROFILE_NOT_AUTHORIZED",
  "EDGE_PERMISSION_DENIED",
  "EDGE_PERMISSION_KEY_UNREGISTERED",
  "EDGE_RESOURCE_SCOPE_DENIED",
  "EDGE_ENVIRONMENT_DENIED",
  "EDGE_APPROVAL_REQUIRED",
  "EDGE_SELF_APPROVAL_FORBIDDEN",
]);

async function recordDenialEvidence(
  pool: HubPool,
  request: HubCommandRequest,
  error: HubCommandError,
): Promise<void> {
  if (!EVIDENCE_CODES.has(error.code)) return;
  const severity =
    error.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" ||
    error.code === "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH" ||
    error.code === "EDGE_DEVICE_REVOKED" ||
    error.code === "EDGE_SELF_APPROVAL_FORBIDDEN"
      ? "high"
      : "medium";
  try {
    await withHubTransaction(pool, async (client) => {
      await auditRepo.recordSecurityEvent(client, {
        id: uuidv7(),
        tenantId: request.device.tenantId,
        digitalStoreId: request.device.digitalStoreId,
        locationId: request.device.locationId,
        eventCode:
          error.code === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"
            ? "EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH"
            : error.code,
        severity,
        deviceId: request.device.terminalDeviceId,
        certificateSerial: null,
        // Redacted evidence only — never a payload, credential or contact value.
        details: {
          command_type: request.commandType,
          idempotency_key: request.idempotencyKey,
          profile_code: request.device.profileCode,
          ...error.details,
        },
      });
    });
  } catch {
    // Evidence recording must never replace the refusal the caller receives.
  }
}

/** Re-exported so command modules validate envelopes with the same authority. */
export { assertValidEnvelope };
