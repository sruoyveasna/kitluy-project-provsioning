/**
 * T4 customer pickup commands (WS-09-T002).
 *
 * TERMINAL PROFILE FENCE: every command here is registered for
 * `laundry.t4.pickup_scan_out` ONLY, and T4 appears in NO Ready command. T4
 * therefore can never perform Ready intake, and the CANONICAL engine enforces
 * the mirror rule: `markReady` refuses any profile that is not T3
 * (KBR-LND-004).
 *
 * `completePickup` is the ONLY path to PICKED_UP (KBR-LND-005). It refuses a
 * wrong profile, an unverified collector, an unsettled balance and incomplete
 * release — so the count gate, the collector gate and the payment gate are all
 * ENGINE decisions, evaluated over evidence the Hub gathered, and a refusal
 * writes nothing.
 */
import { completePickup } from "@kitluy-verticals/phase1-laundry";
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
import { recordCashPayment, type CashPaymentInput } from "./payment-commands.js";

export interface OpenPickupSessionInput extends HubCommandEnvelopeInput {
  readonly bookingId: string;
}

export async function openPickupSession(
  pool: HubPool,
  input: OpenPickupSessionInput,
): Promise<HubCommandResult> {
  const body = { booking_id: input.bookingId };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.pickup.open_session",
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
      const booking = await loadScopedBooking(execution, input.bookingId);
      const stored = await laundryRepo.listActiveStorageAssignments(client, booking.id);
      const gate = booking.balance_minor <= 0n ? "settled" : "blocked_balance_due";
      const sessionId = uuidv7();
      await laundryRepo.insertPickupSession(client, {
        id: sessionId,
        tenantId: booking.tenant_id,
        digitalStoreId: booking.digital_store_id,
        locationId: booking.location_id,
        bookingId: booking.id,
        terminalDeviceId: execution.auth.device.terminalDeviceId,
        actorId: execution.auth.device.actorId,
        expectedCount: stored.length,
        paymentGateState: gate,
        idempotencyKey: execution.idempotencyKey,
      });
      const payload = {
        booking_id: booking.id,
        pickup_session_id: sessionId,
        expected_count: stored.length,
        payment_gate_state: gate,
        balance_minor: booking.balance_minor.toString(),
        currency_code: booking.currency_code,
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
        auditResourceType: "pickup_session",
        auditResourceId: sessionId,
      } satisfies HubHandlerResult;
    },
  );
}

export interface VerifyCollectorInput extends HubCommandEnvelopeInput {
  readonly pickupSessionId: string;
  readonly expectedVersion: bigint;
  readonly verificationMethod: string;
}

export async function verifyCollector(
  pool: HubPool,
  input: VerifyCollectorInput,
): Promise<HubCommandResult> {
  const body = {
    pickup_session_id: input.pickupSessionId,
    expected_version: input.expectedVersion.toString(),
    verification_method: input.verificationMethod,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.pickup.verify_collector",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const session = await loadScopedPickupSession(execution, input.pickupSessionId);
      const booking = await loadScopedBooking(execution, session.booking_id);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      await laundryRepo.updatePickupSession(execution.client, {
        sessionId: session.id,
        collectorVerificationMethod: input.verificationMethod,
        collectorVerified: true,
      });
      const version = await bumpBooking(execution, booking.id, input.expectedVersion);
      const payload = {
        booking_id: booking.id,
        pickup_session_id: session.id,
        collector_verification_method: input.verificationMethod,
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
        auditResourceType: "pickup_session",
        auditResourceId: session.id,
      } satisfies HubHandlerResult;
    },
  );
}

export interface PickupScanInput extends HubCommandEnvelopeInput {
  readonly pickupSessionId: string;
  readonly expectedVersion: bigint;
  readonly garmentId?: string | null;
  readonly bagId?: string | null;
}

export async function recordPickupScan(
  pool: HubPool,
  input: PickupScanInput,
): Promise<HubCommandResult> {
  const body = {
    pickup_session_id: input.pickupSessionId,
    expected_version: input.expectedVersion.toString(),
    garment_id: input.garmentId ?? null,
    bag_id: input.bagId ?? null,
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.pickup.record_scan",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const session = await loadScopedPickupSession(execution, input.pickupSessionId);
      const booking = await loadScopedBooking(execution, session.booking_id);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);
      const scanned = session.scanned_count + 1;
      await laundryRepo.updatePickupSession(execution.client, {
        sessionId: session.id,
        scannedCount: scanned,
      });
      const version = await bumpBooking(execution, booking.id, input.expectedVersion);
      const payload = {
        booking_id: booking.id,
        pickup_session_id: session.id,
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

/**
 * The T4 payment gate. Delegates to the SAME cash-payment implementation the
 * T1 counter uses — one engine decision, one persistence path — under the
 * approved `laundry-pickup-session-payment` route metadata.
 */
export async function recordPickupPayment(
  pool: HubPool,
  input: Omit<CashPaymentInput, "commandType">,
): Promise<HubCommandResult> {
  return recordCashPayment(pool, { ...input, commandType: "laundry.pickup.record_payment" });
}

export interface CompletePickupInput extends HubCommandEnvelopeInput {
  readonly pickupSessionId: string;
  readonly expectedVersion: bigint;
}

/**
 * Complete pickup ATOMICALLY: validate the count, the collector and the balance
 * gate -> release custody -> clear storage -> complete the Booking -> audit ->
 * events, all in ONE transaction. `completePickup` is the engine decision; a
 * refusal writes nothing at all.
 */
export async function completePickupSession(
  pool: HubPool,
  input: CompletePickupInput,
): Promise<HubCommandResult> {
  const body = {
    pickup_session_id: input.pickupSessionId,
    expected_version: input.expectedVersion.toString(),
  };
  return executeHubCommand(
    pool,
    {
      commandType: "laundry.pickup.complete",
      device: input.device,
      idempotencyKey: input.idempotencyKey,
      clientSequence: input.clientSequence,
      businessDate: input.businessDate,
      body,
      requiredConditionalPermissions: ["laundry.pickup_scan_out"],
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    },
    async (execution) => {
      const { client, auth } = execution;
      const session = await loadScopedPickupSession(execution, input.pickupSessionId);
      const booking = await loadScopedBooking(execution, session.booking_id);
      assertExpectedVersion(booking.aggregate_version, input.expectedVersion, booking.id);

      // §12 acceptance test 5: a BLOCKING unresolved exception fails the gate.
      const blocking = await laundryRepo.countBlockingExceptions(client, booking.id);
      if (blocking > 0) {
        throw new HubCommandError(
          "EDGE_CUSTODY_GATE_BLOCKED",
          `Booking ${booking.id} has ${blocking} unresolved BLOCKING exception(s); release is refused.`,
          { bookingId: booking.id, blocking },
        );
      }
      const stored = await laundryRepo.listActiveStorageAssignments(client, booking.id);
      const countVerified =
        session.expected_count > 0 && session.scanned_count >= session.expected_count;
      const balanceSettled = booking.balance_minor <= 0n;
      if (!balanceSettled) {
        // Reported as its own gate so the refusal names the real reason, even
        // though the engine would also refuse it.
        throw new HubCommandError(
          "EDGE_PAYMENT_GATE_BLOCKED",
          `Booking ${booking.id} still owes ${booking.balance_minor} ${booking.currency_code}; pickup is refused.`,
          { bookingId: booking.id, balanceMinor: booking.balance_minor.toString() },
        );
      }

      const from = productionStateForStatus(booking.status);
      // CANONICAL ENGINE DECISION — profile, collector, balance, completeness.
      const next = completePickup(from, {
        profile: auth.profile,
        collectorVerified: session.collector_verified_at !== null,
        balanceSettled,
        releaseCompletenessVerified: countVerified,
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
        pickup_session_id: session.id,
        from_status: booking.status,
        to_status: status,
        engine_state: next,
        scanned_count: session.scanned_count,
        expected_count: session.expected_count,
        balance_minor: booking.balance_minor.toString(),
      };
      const bookingEvent = await execution.recorder.record({
        aggregateType: "booking",
        aggregateId: booking.id,
        aggregateVersion: version,
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
        eventId: bookingEvent.eventId,
      });

      // RELEASE CUSTODY — append-only, one event per released unit.
      for (const assignment of stored) {
        const custodyPayload = {
          booking_id: booking.id,
          pickup_session_id: session.id,
          garment_id: assignment.garment_id,
          bag_id: assignment.bag_id,
          storage_position_id: assignment.storage_position_id,
          event_type: "pickup_scan_out",
          from_custody_state: "in_ready_storage",
          to_custody_state: "released_to_customer",
        };
        const custodyEvent = await execution.recorder.record({
          aggregateType: "booking",
          aggregateId: booking.id,
          aggregateVersion: version,
          // EVT-LND-004, registered.
          eventName: "garment.custody_scanned_out",
          payload: custodyPayload,
          causationId: bookingEvent.eventId,
        });
        await laundryRepo.appendCustodyEvent(client, {
          id: uuidv7(),
          tenantId: booking.tenant_id,
          digitalStoreId: booking.digital_store_id,
          locationId: booking.location_id,
          bookingId: booking.id,
          garmentId: assignment.garment_id,
          bagId: assignment.bag_id,
          eventType: "pickup_scan_out",
          fromCustodyState: "in_ready_storage",
          toCustodyState: "released_to_customer",
          storagePositionId: assignment.storage_position_id,
          actorId: auth.device.actorId,
          terminalDeviceId: auth.device.terminalDeviceId,
          sessionId: session.id,
          localSequence: await laundryRepo.nextBookingLocalSequence(
            client,
            "custody_event",
            booking.id,
          ),
          reasonCode: null,
          payloadSha256: payloadChecksum(custodyPayload),
          eventId: custodyEvent.eventId,
        });
        if (assignment.garment_id) {
          await laundryRepo.setGarmentCustodyState(
            client,
            assignment.garment_id,
            "released_to_customer",
          );
        }
        if (assignment.bag_id) {
          await laundryRepo.setBagCustodyState(client, assignment.bag_id, "released_to_customer");
        }
      }
      // CLEAR STORAGE — a one-time clearing pair; the row is never deleted (§1).
      const cleared = await laundryRepo.clearStorageAssignments(
        client,
        booking.id,
        auth.device.actorId,
        "pickup_released",
      );
      await laundryRepo.updatePickupSession(client, {
        sessionId: session.id,
        status: "completed",
        completed: true,
        paymentGateState: "settled",
      });

      return {
        aggregateId: booking.id,
        aggregateVersion: version,
        resultJson: { ...payload, released_units: stored.length, cleared_positions: cleared },
        auditResourceType: "booking",
        auditResourceId: booking.id,
      } satisfies HubHandlerResult;
    },
  );
}

async function loadScopedPickupSession(
  execution: HubCommandExecution,
  sessionId: string,
): Promise<NonNullable<Awaited<ReturnType<typeof laundryRepo.loadPickupSessionForUpdate>>>> {
  const session = await laundryRepo.loadPickupSessionForUpdate(execution.client, sessionId);
  if (!session) {
    throw new HubCommandError(
      "EDGE_AGGREGATE_NOT_FOUND",
      `pickup session ${sessionId} does not exist.`,
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
      `pickup session ${sessionId} belongs to a different Tenant / Digital Store / Location.`,
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
