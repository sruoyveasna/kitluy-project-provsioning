/**
 * T3 Clean & Ready commands (WS-09-T002).
 *
 * TERMINAL PROFILE FENCE: every command here is registered for
 * `laundry.t3.ready_scan_in` ONLY, and the CANONICAL engine enforces the same
 * rule again — `markReady` throws unless the committing profile is T3
 * (KBR-LND-004), and `releaseCustody`/`completePickup` throw for anything that
 * is not T4 (KBR-LND-005). T3 therefore can NEVER release customer custody: the
 * capability is absent from the command catalogue AND refused by the engine.
 *
 * `markReady` also refuses any source state other than QA_PACKAGING, so the
 * Ready completion cannot skip the forward-only production chain
 * (KBR-LND-003). See hub/booking-status.ts for the recorded conflict between
 * that chain and the shipped fixture's direct `intake_confirmed -> ready` edge.
 */
import { markReady } from "@kitluy-verticals/phase1-laundry";
import type { HubPool } from "../db.js";
import { HubCommandError } from "../errors.js";
import {
  executeHubCommand,
  type HubCommandExecution,
  type HubCommandResult,
  type HubHandlerResult,
} from "../command-pipeline.js";
import { productionStateForStatus, statusForProductionState } from "../booking-status.js";
import { payloadChecksum } from "../outbox.js";
import { laundryRepo } from "../repositories/index.js";
import { uuidv7 } from "../uuid.js";
import { assertExpectedVersion } from "./shared.js";
import { loadScopedBooking, type HubCommandEnvelopeInput } from "./booking-commands.js";

export interface OpenReadySessionInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
  readonly expectedCount: number;
}

export async function openReadySession(
  pool: HubPool,
  input: OpenReadySessionInput,
): Promise<HubCommandResult> {
  const body = { booking_id: input.bookingId, expected_count: input.expectedCount };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.ready.open_session",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const booking = await loadScopedBooking(execution, input.bookingId);
      const sessionId = uuidv7();
      await laundryRepo.insertReadyScanSession(execution.client, {
        id: sessionId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        terminalDeviceId: execution.auth.device.terminalDeviceId,
        actorId: execution.auth.device.actorId,
        expectedCount: input.expectedCount,
        idempotencyKey: execution.idempotencyKey,
      });
      const payload = {
        booking_id: booking.id,
        ready_session_id: sessionId,
        expected_count: input.expectedCount,
      };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: booking.aggregate_version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: booking.aggregate_version,
        resultJson: payload,
        auditResourceType: "ready_scan_session",
        auditResourceId: sessionId,
      } satisfies HubHandlerResult;
    },
  );
}

export interface ReadyScanInput extends HubCommandEnvelopeInput {
  readonly readySessionId: string;
  readonly expectedVersion: bigint;
  readonly garmentId?: string | null;
  readonly bagId?: string | null;
}

/**
 * Record ONE Ready scan against the session. The custody STATE change happens
 * at storage assignment (that is where the fixture's `ready_scan_in` custody
 * event carries its storage position), so this command advances the session and
 * emits the registered EVT-LND-003 domain event without inventing a new custody
 * state token.
 */
export async function recordReadyScan(
  pool: HubPool,
  input: ReadyScanInput,
): Promise<HubCommandResult> {
  const body = {
    ready_session_id: input.readySessionId,
    expected_version: input.expectedVersion.toString(),
    garment_id: input.garmentId ?? null,
    bag_id: input.bagId ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.ready.record_scan",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const session = await loadScopedReadySession(execution, input.readySessionId);
      const booking = await loadScopedBooking(execution, session.booking_id);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);

      const scanned = session.scanned_count + 1;
      await laundryRepo.updateReadyScanSession(execution.client, {
        sessionId: session.id,
        scannedCount: scanned,
      });
      const version = await bumpBooking(execution, booking.id, input.expectedVersion);

      const payload = {
        booking_id: booking.id,
        ready_session_id: session.id,
        garment_id: input.garmentId ?? null,
        bag_id: input.bagId ?? null,
        scanned_count: scanned,
        expected_count: session.expected_count,
      };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "garment_custody",
        auditResourceId: input.garmentId ?? session.id,
      } satisfies HubHandlerResult;
    },
  );
}

export interface ReadyQaInput extends HubCommandEnvelopeInput {
  readonly readySessionId: string;
  readonly expectedVersion: bigint;
  readonly qaPassed: boolean;
  readonly reasonCode?: string | null;
}

export async function recordReadyQa(pool: HubPool, input: ReadyQaInput): Promise<HubCommandResult> {
  const body = {
    ready_session_id: input.readySessionId,
    expected_version: input.expectedVersion.toString(),
    qa_passed: input.qaPassed,
    reason_code: input.reasonCode ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.ready.record_qa",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const session = await loadScopedReadySession(execution, input.readySessionId);
      const booking = await loadScopedBooking(execution, session.booking_id);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);

      const qaState = input.qaPassed ? "passed" : "failed";
      await laundryRepo.updateReadyScanSession(execution.client, {
        sessionId: session.id,
        qaState,
      });
      const version = await bumpBooking(execution, booking.id, input.expectedVersion);
      const payload = {
        booking_id: booking.id,
        ready_session_id: session.id,
        qa_state: qaState,
        reason_code: input.reasonCode ?? null,
      };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "ready_scan_session",
        auditResourceId: session.id,
        auditReasonCode: input.reasonCode ?? null,
      } satisfies HubHandlerResult;
    },
  );
}

export interface ReadyExceptionInput extends HubCommandEnvelopeInput {
  readonly readySessionId: string;
  readonly expectedVersion: bigint;
  readonly exceptionType: string;
  readonly severity: string;
  readonly blocking: boolean;
  readonly note?: string | null;
  readonly garmentId?: string | null;
  readonly bagId?: string | null;
}

export async function recordReadyException(
  pool: HubPool,
  input: ReadyExceptionInput,
): Promise<HubCommandResult> {
  const body = {
    ready_session_id: input.readySessionId,
    expected_version: input.expectedVersion.toString(),
    exception_type: input.exceptionType,
    severity: input.severity,
    blocking: input.blocking,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.ready.record_exception",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const session = await loadScopedReadySession(execution, input.readySessionId);
      const booking = await loadScopedBooking(execution, session.booking_id);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);

      const exceptionId = uuidv7();
      await laundryRepo.insertException(execution.client, {
        id: exceptionId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        garmentId: input.garmentId ?? null,
        bagId: input.bagId ?? null,
        exceptionType: input.exceptionType,
        severity: input.severity,
        blocking: input.blocking,
        status: "open",
        note: input.note ?? null,
        evidenceAssetId: null,
        createdBy: execution.auth.device.actorId,
      });
      const version = await bumpBooking(execution, booking.id, input.expectedVersion);
      const payload = {
        booking_id: booking.id,
        ready_session_id: session.id,
        exception_id: exceptionId,
        exception_type: input.exceptionType,
        severity: input.severity,
        blocking: input.blocking,
      };
      await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        eventName: execution.definition.auditEvent,
        payload,
      });
      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "laundry_exception",
        auditResourceId: exceptionId,
        auditReasonCode: input.exceptionType,
      } satisfies HubHandlerResult;
    },
  );
}

export interface AssignReadyStorageInput extends HubCommandEnvelopeInput {
  readonly readySessionId: string;
  readonly expectedVersion: bigint;
  readonly storagePositionId: string;
  readonly garmentId?: string | null;
  readonly bagId?: string | null;
}

/**
 * Assign Ready storage. Runs SERIALIZABLE (§1) with the storage position row
 * locked; over-capacity is refused by the 0012 trigger and double occupancy by
 * the partial unique indexes, so §12 acceptance test 4 holds under concurrency.
 */
export async function assignReadyStorage(
  pool: HubPool,
  input: AssignReadyStorageInput,
): Promise<HubCommandResult> {
  const body = {
    ready_session_id: input.readySessionId,
    expected_version: input.expectedVersion.toString(),
    storage_position_id: input.storagePositionId,
    garment_id: input.garmentId ?? null,
    bag_id: input.bagId ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.ready.assign_storage",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const { client } = execution;
      const session = await loadScopedReadySession(execution, input.readySessionId);
      const booking = await loadScopedBooking(execution, session.booking_id);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);

      if ((input.garmentId ? 1 : 0) + (input.bagId ? 1 : 0) !== 1) {
        throw new HubCommandError(
          "EDGE_INVALID_TRANSITION",
          "exactly one of garmentId / bagId must be stored (§6.4 storage_assignment CHECK).",
        );
      }
      const position = await laundryRepo.findStoragePosition(client, input.storagePositionId);
      if (!position) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_NOT_FOUND",
          `storage position ${input.storagePositionId} does not exist.`,
        );
      }
      if (position.location_id !== booking.location_id) {
        throw new HubCommandError(
          "EDGE_RESOURCE_SCOPE_DENIED",
          `storage position ${position.id} belongs to a different Location.`,
        );
      }

      const version = await bumpBooking(execution, booking.id, input.expectedVersion);
      const custodyPayload = {
        booking_id: booking.id,
        ready_session_id: session.id,
        garment_id: input.garmentId ?? null,
        bag_id: input.bagId ?? null,
        storage_position_id: position.id,
        position_code: position.position_code,
        event_type: "ready_scan_in",
        from_custody_state: "in_processing",
        to_custody_state: "in_ready_storage",
      };
      const event = await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        // EVT-LND-003, registered in the Domain Event Registry.
        eventName: "garment.custody_scanned_in",
        payload: custodyPayload,
      });
      await laundryRepo.insertStorageAssignment(client, {
        id: uuidv7(),
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        garmentId: input.garmentId ?? null,
        bagId: input.bagId ?? null,
        storagePositionId: position.id,
        assignedBy: execution.auth.device.actorId,
        terminalDeviceId: execution.auth.device.terminalDeviceId,
        assignmentEventId: event.eventId,
      });
      await laundryRepo.appendCustodyEvent(client, {
        id: uuidv7(),
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        garmentId: input.garmentId ?? null,
        bagId: input.bagId ?? null,
        eventType: "ready_scan_in",
        fromCustodyState: "in_processing",
        toCustodyState: "in_ready_storage",
        storagePositionId: position.id,
        actorId: execution.auth.device.actorId,
        terminalDeviceId: execution.auth.device.terminalDeviceId,
        sessionId: session.id,
        localSequence: await laundryRepo.nextBookingLocalSequence(
          client,
          "custody_event",
          booking.id,
        ),
        reasonCode: null,
        payloadSha256: payloadChecksum(custodyPayload),
        eventId: event.eventId,
      });
      if (input.garmentId) {
        await laundryRepo.setGarmentCustodyState(client, input.garmentId, "in_ready_storage");
      }
      if (input.bagId) {
        await laundryRepo.setBagCustodyState(client, input.bagId, "in_ready_storage");
      }
      await laundryRepo.updateReadyScanSession(client, {
        sessionId: session.id,
        storageState: "assigned",
      });

      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: custodyPayload,
        auditResourceType: "garment_custody",
        auditResourceId: input.garmentId ?? input.bagId ?? session.id,
      } satisfies HubHandlerResult;
    },
  );
}

export interface CompleteReadyInput extends HubCommandEnvelopeInput {
  readonly readySessionId: string;
  readonly expectedVersion: bigint;
}

/**
 * Complete Ready. The CANONICAL `markReady` decides: it refuses any profile
 * other than T3, any source state other than QA_PACKAGING, and any missing
 * QA / count / storage precondition (KBR-LND-003/004). An invalid decision
 * throws BEFORE any write, so the transaction rolls back with no event, no
 * outbox row and no command result.
 */
export async function completeReady(
  pool: HubPool,
  input: CompleteReadyInput,
): Promise<HubCommandResult> {
  const body = {
    ready_session_id: input.readySessionId,
    expected_version: input.expectedVersion.toString(),
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.ready.complete",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const { client, auth } = execution;
      const session = await loadScopedReadySession(execution, input.readySessionId);
      const booking = await loadScopedBooking(execution, session.booking_id);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);

      const from = productionStateForStatus(booking.status);
      // CANONICAL ENGINE DECISION — profile, QA, count and storage guards.
      const next = markReady(from, {
        profile: auth.profile,
        qaPassed: session.qa_state === "passed",
        countVerified: session.scanned_count >= session.expected_count,
        storageAssigned: session.storage_state === "assigned",
      });
      const status = statusForProductionState(next);

      const version = await laundryRepo.updateBookingProjection(client, {
        bookingId: booking.id,
        expectedVersion: input.expectedVersion,
        status,
      });
      if (version === undefined) {
        throw new HubCommandError(
          "EDGE_AGGREGATE_VERSION_CONFLICT",
          `Booking ${booking.id} changed concurrently; nothing was written.`,
        );
      }
      const payload = {
        booking_id: booking.id,
        ready_session_id: session.id,
        from_status: booking.status,
        to_status: status,
        engine_state: next,
        scanned_count: session.scanned_count,
        expected_count: session.expected_count,
      };
      const event = await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
        // EVT-LND-002, registered.
        eventName: execution.definition.auditEvent,
        payload,
      });
      await laundryRepo.appendStatusEvent(client, {
        id: uuidv7(),
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        fromStatus: booking.status,
        toStatus: status,
        reasonCode: null,
        actorId: auth.device.actorId,
        terminalDeviceId: auth.device.terminalDeviceId,
        localSequence: await laundryRepo.nextBookingLocalSequence(
          client,
          "status_event",
          booking.id,
        ),
        eventId: event.eventId,
      });
      await laundryRepo.updateReadyScanSession(client, {
        sessionId: session.id,
        status: "completed",
        completed: true,
      });

      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: payload,
        auditResourceType: "booking",
        auditResourceId: booking.id,
      } satisfies HubHandlerResult;
    },
  );
}

async function loadScopedReadySession(
  execution: HubCommandExecution,
  sessionId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof laundryRepo.loadReadyScanSessionForUpdate>>>> {
  const session = await laundryRepo.loadReadyScanSessionForUpdate(execution.client, sessionId);
  if (!session) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_NOT_FOUND",
      `Ready session ${sessionId} does not exist.`,
    );
  }
  const device = execution.auth.device;
  if (
    session.tenant_id !== device.tenantId ||
    session.digital_store_id !== device.digitalStoreId ||
    session.location_id !== device.locationId
  ) {
    throw new HubCommandError(
      "EDGE_RESOURCE_SCOPE_DENIED",
      `Ready session ${sessionId} belongs to a different Tenant / Digital Store / Location.`,
    );
  }
  return session;
}

async function bumpBooking(
  execution: HubCommandExecution,
  bookingId: string,
  expectedVersion: bigint,
): Promise<bigint> {
  const version = await laundryRepo.updateBookingProjection(execution.client, {
    bookingId,
    expectedVersion,
  });
  if (version === undefined) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_VERSION_CONFLICT",
      `Booking ${bookingId} changed concurrently; nothing was written.`,
    );
  }
  return version;
}
