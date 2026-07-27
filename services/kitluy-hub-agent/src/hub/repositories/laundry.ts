/**
 * `edge_laundry` repository adapters (schema contract §6.4).
 *
 * THIN and TYPED. No transition is decided here: `booking.status` is a
 * PROJECTION written from a canonical-engine decision, and `status_event` /
 * `custody_event` are APPEND-ONLY (the 0012 triggers reject UPDATE and DELETE
 * unconditionally).
 */
import type { HubClient } from "../db.js";

export interface BookingRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  booking_number: string;
  customer_id: string | null;
  status: string;
  business_date: string;
  currency_code: string;
  currency_exponent: number;
  subtotal_minor: bigint;
  discount_minor: bigint;
  tax_minor: bigint;
  total_minor: bigint;
  paid_minor: bigint;
  refunded_minor: bigint;
  balance_minor: bigint;
  due_at: Date | null;
  pickup_method: string;
  config_snapshot_id: string;
  aggregate_version: bigint;
}

const BOOKING_COLUMNS = `id, tenant_id, digital_store_id, location_id, booking_number,
  customer_id, status, to_char(business_date, 'YYYY-MM-DD') as business_date,
  currency_code, currency_exponent, subtotal_minor, discount_minor, tax_minor,
  total_minor, paid_minor, refunded_minor, balance_minor, due_at, pickup_method,
  config_snapshot_id, aggregate_version`;

/** Load the Booking aggregate and take its row lock for the command. */
export async function loadBookingForUpdate(
  client: HubClient,
  bookingId: string,
): Promise<BookingRow | undefined> {
  const result = await client.query<BookingRow>(
    `select ${BOOKING_COLUMNS} from edge_laundry.booking where id = $1 for update`,
    [bookingId],
  );
  return result.rows[0];
}

export async function findBooking(
  client: HubClient,
  bookingId: string,
): Promise<BookingRow | undefined> {
  const result = await client.query<BookingRow>(
    `select ${BOOKING_COLUMNS} from edge_laundry.booking where id = $1`,
    [bookingId],
  );
  return result.rows[0];
}

export interface InsertBookingInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingNumber: string;
  readonly customerId: string | null;
  readonly status: string;
  readonly businessDate: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly subtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly totalMinor: bigint;
  readonly dueAt: string | null;
  readonly pickupMethod: string;
  readonly configSnapshotId: string;
}

/**
 * Insert a Booking. `balance_minor` is written explicitly so the §6.4 CHECK
 * (`balance = total - paid + refunded`) is verified by the database on every
 * write rather than trusted from the caller.
 */
export async function insertBooking(client: HubClient, input: InsertBookingInput): Promise<void> {
  await client.query(
    `insert into edge_laundry.booking
       (id, tenant_id, digital_store_id, location_id, booking_number, customer_id,
        status, business_date, currency_code, currency_exponent, subtotal_minor,
        discount_minor, tax_minor, total_minor, paid_minor, refunded_minor,
        balance_minor, due_at, pickup_method, config_snapshot_id, aggregate_version,
        created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, $11, $12, $13, $14,
             0, 0, $14, $15, $16, $17, 1, now(), now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingNumber,
      input.customerId,
      input.status,
      input.businessDate,
      input.currencyCode,
      input.currencyExponent,
      input.subtotalMinor.toString(),
      input.discountMinor.toString(),
      input.taxMinor.toString(),
      input.totalMinor.toString(),
      input.dueAt,
      input.pickupMethod,
      input.configSnapshotId,
    ],
  );
}

/**
 * Advance the Booking projection under OPTIMISTIC CONCURRENCY (offline
 * contract §6): the update matches on `aggregate_version`, so a stale expected
 * version writes NOTHING and the caller must refuse the command.
 */
export async function updateBookingProjection(
  client: HubClient,
  input: {
    readonly bookingId: string;
    readonly expectedVersion: bigint;
    readonly status?: string;
    readonly subtotalMinor?: bigint;
    readonly discountMinor?: bigint;
    readonly taxMinor?: bigint;
    readonly totalMinor?: bigint;
    readonly paidMinor?: bigint;
    readonly refundedMinor?: bigint;
    readonly dueAt?: string | null;
  },
): Promise<bigint | undefined> {
  const result = await client.query<{ aggregate_version: bigint }>(
    `update edge_laundry.booking
        set status         = coalesce($3, status),
            subtotal_minor = coalesce($4::bigint, subtotal_minor),
            discount_minor = coalesce($5::bigint, discount_minor),
            tax_minor      = coalesce($6::bigint, tax_minor),
            total_minor    = coalesce($7::bigint, total_minor),
            paid_minor     = coalesce($8::bigint, paid_minor),
            refunded_minor = coalesce($9::bigint, refunded_minor),
            due_at         = coalesce($10::timestamptz, due_at),
            balance_minor  = coalesce($7::bigint, total_minor)
                             - coalesce($8::bigint, paid_minor)
                             + coalesce($9::bigint, refunded_minor),
            aggregate_version = aggregate_version + 1
      where id = $1 and aggregate_version = $2
      returning aggregate_version`,
    [
      input.bookingId,
      input.expectedVersion.toString(),
      input.status ?? null,
      input.subtotalMinor?.toString() ?? null,
      input.discountMinor?.toString() ?? null,
      input.taxMinor?.toString() ?? null,
      input.totalMinor?.toString() ?? null,
      input.paidMinor?.toString() ?? null,
      input.refundedMinor?.toString() ?? null,
      input.dueAt ?? null,
    ],
  );
  return result.rows[0]?.aggregate_version;
}

export interface BookingLineRow {
  id: string;
  booking_id: string;
  service_id: string;
  service_version: bigint;
  display_name: string;
  pricing_method: string;
  unit_price_minor: bigint;
  currency_code: string;
  currency_exponent: number;
  quantity: string;
  unit_code: string;
  line_subtotal_minor: bigint;
  discount_minor: bigint;
  tax_minor: bigint;
  line_total_minor: bigint;
}

export async function listBookingLines(
  client: HubClient,
  bookingId: string,
): Promise<readonly BookingLineRow[]> {
  const result = await client.query<BookingLineRow>(
    `select id, booking_id, service_id, service_version, display_name, pricing_method,
            unit_price_minor, currency_code, currency_exponent, quantity::text as quantity,
            unit_code, line_subtotal_minor, discount_minor, tax_minor, line_total_minor
       from edge_laundry.booking_line where booking_id = $1 order by created_at, id`,
    [bookingId],
  );
  return result.rows;
}

export interface InsertBookingLineInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly serviceId: string;
  readonly serviceVersion: bigint;
  readonly displayName: string;
  readonly pricingMethod: string;
  readonly unitPriceMinor: bigint;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  /** numeric(18,4) decimal string — never a JavaScript float (§1). */
  readonly quantity: string;
  readonly unitCode: string;
  readonly lineSubtotalMinor: bigint;
  readonly discountMinor: bigint;
  readonly taxMinor: bigint;
  readonly lineTotalMinor: bigint;
  readonly addonSnapshot: Readonly<Record<string, unknown>>;
  readonly sourceConfigVersion: bigint;
}

export async function insertBookingLine(
  client: HubClient,
  input: InsertBookingLineInput,
): Promise<void> {
  await client.query(
    `insert into edge_laundry.booking_line
       (id, tenant_id, digital_store_id, location_id, booking_id, service_id,
        service_version, display_name, pricing_method, unit_price_minor,
        currency_code, currency_exponent, quantity, unit_code, line_subtotal_minor,
        discount_minor, tax_minor, line_total_minor, addon_snapshot_json,
        source_config_version, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::numeric,
             $14, $15, $16, $17, $18, $19::jsonb, $20, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.serviceId,
      input.serviceVersion.toString(),
      input.displayName,
      input.pricingMethod,
      input.unitPriceMinor.toString(),
      input.currencyCode,
      input.currencyExponent,
      input.quantity,
      input.unitCode,
      input.lineSubtotalMinor.toString(),
      input.discountMinor.toString(),
      input.taxMinor.toString(),
      input.lineTotalMinor.toString(),
      JSON.stringify(input.addonSnapshot),
      input.sourceConfigVersion.toString(),
    ],
  );
}

export async function deleteDraftBookingLines(): Promise<never> {
  // §1 "No hard delete for finalized business records"; the 0012 trigger blocks
  // DELETE on booking_line and NO role holds the DELETE grant. A draft line is
  // superseded by a new priced snapshot, never removed.
  throw new Error(
    "edge_laundry.booking_line rows are never deleted (schema contract §1); supersede the draft instead.",
  );
}

export interface InsertGarmentInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly bookingLineId: string | null;
  readonly garmentCode: string;
  readonly garmentType: string;
  readonly color: string | null;
  readonly conditionCode: string | null;
  readonly specialHandling: string | null;
  readonly custodyState: string;
}

export async function insertGarment(client: HubClient, input: InsertGarmentInput): Promise<void> {
  await client.query(
    `insert into edge_laundry.garment
       (id, tenant_id, digital_store_id, location_id, booking_id, booking_line_id,
        garment_code, garment_type, color, condition_code, special_handling,
        current_custody_state, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.bookingLineId,
      input.garmentCode,
      input.garmentType,
      input.color,
      input.conditionCode,
      input.specialHandling,
      input.custodyState,
    ],
  );
}

export interface GarmentRow {
  id: string;
  booking_id: string;
  garment_code: string;
  current_custody_state: string;
}

export async function listGarments(
  client: HubClient,
  bookingId: string,
): Promise<readonly GarmentRow[]> {
  const result = await client.query<GarmentRow>(
    `select id, booking_id, garment_code, current_custody_state
       from edge_laundry.garment where booking_id = $1 order by created_at, id`,
    [bookingId],
  );
  return result.rows;
}

export async function setGarmentCustodyState(
  client: HubClient,
  garmentId: string,
  custodyState: string,
): Promise<void> {
  await client.query(`update edge_laundry.garment set current_custody_state = $2 where id = $1`, [
    garmentId,
    custodyState,
  ]);
}

export interface InsertBagInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly bagCode: string;
  readonly expectedPieceCount: number | null;
  readonly currentPieceCount: number | null;
  readonly custodyState: string;
}

export async function insertBag(client: HubClient, input: InsertBagInput): Promise<void> {
  await client.query(
    `insert into edge_laundry.bag
       (id, tenant_id, digital_store_id, location_id, booking_id, bag_code,
        expected_piece_count, current_piece_count, current_custody_state, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.bagCode,
      input.expectedPieceCount,
      input.currentPieceCount,
      input.custodyState,
    ],
  );
}

export async function setBagCustodyState(
  client: HubClient,
  bagId: string,
  custodyState: string,
): Promise<void> {
  await client.query(`update edge_laundry.bag set current_custody_state = $2 where id = $1`, [
    bagId,
    custodyState,
  ]);
}

export interface InsertTagInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly garmentId: string | null;
  readonly bagId: string | null;
  readonly tagCode: string;
  readonly tagType: string;
}

export async function insertTag(client: HubClient, input: InsertTagInput): Promise<void> {
  await client.query(
    `insert into edge_laundry.tag
       (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
        tag_code, tag_type, issued_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.garmentId,
      input.bagId,
      input.tagCode,
      input.tagType,
    ],
  );
}

/** Voiding is a lifecycle state, never a delete (§1). */
export async function voidTag(client: HubClient, tagId: string, voidReason: string): Promise<void> {
  await client.query(
    `update edge_laundry.tag set voided_at = now(), void_reason = $2
      where id = $1 and voided_at is null`,
    [tagId, voidReason],
  );
}

export interface AppendStatusEventInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reasonCode: string | null;
  readonly actorId: string;
  readonly terminalDeviceId: string;
  readonly localSequence: bigint;
  /** `edge_sync.local_event.id` — the UNIQUE tie between row and event. */
  readonly eventId: string;
}

/** APPEND-ONLY (§6.4). UPDATE/DELETE are rejected by the 0012 trigger. */
export async function appendStatusEvent(
  client: HubClient,
  input: AppendStatusEventInput,
): Promise<void> {
  await client.query(
    `insert into edge_laundry.status_event
       (id, tenant_id, digital_store_id, location_id, booking_id, from_status,
        to_status, reason_code, actor_id, terminal_device_id, occurred_at,
        local_sequence, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.fromStatus,
      input.toStatus,
      input.reasonCode,
      input.actorId,
      input.terminalDeviceId,
      input.localSequence.toString(),
      input.eventId,
    ],
  );
}

export interface AppendCustodyEventInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly garmentId: string | null;
  readonly bagId: string | null;
  readonly eventType: string;
  readonly fromCustodyState: string | null;
  readonly toCustodyState: string;
  readonly storagePositionId: string | null;
  readonly actorId: string;
  readonly terminalDeviceId: string;
  readonly sessionId: string;
  readonly localSequence: bigint;
  readonly reasonCode: string | null;
  readonly payloadSha256: string;
  readonly eventId: string;
}

/**
 * APPEND-ONLY custody chain (§6.4). Every custody change records the unit, the
 * from->to state, the actor, the device, the session, the Booking, the event
 * time, the local sequence, the reason and the payload hash.
 */
export async function appendCustodyEvent(
  client: HubClient,
  input: AppendCustodyEventInput,
): Promise<void> {
  await client.query(
    `insert into edge_laundry.custody_event
       (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
        event_type, from_custody_state, to_custody_state, storage_position_id,
        actor_id, terminal_device_id, session_id, occurred_at, local_sequence,
        reason_code, payload_sha256, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(),
             $15, $16, $17, $18)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.garmentId,
      input.bagId,
      input.eventType,
      input.fromCustodyState,
      input.toCustodyState,
      input.storagePositionId,
      input.actorId,
      input.terminalDeviceId,
      input.sessionId,
      input.localSequence.toString(),
      input.reasonCode,
      input.payloadSha256,
      input.eventId,
    ],
  );
}

export async function nextBookingLocalSequence(
  client: HubClient,
  table: "status_event" | "custody_event",
  bookingId: string,
): Promise<bigint> {
  const relation =
    table === "status_event" ? "edge_laundry.status_event" : "edge_laundry.custody_event";
  const result = await client.query<{ next: bigint }>(
    `select coalesce(max(local_sequence), 0) + 1 as next from ${relation} where booking_id = $1`,
    [bookingId],
  );
  return result.rows[0]?.next ?? 1n;
}

export interface InsertExceptionInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly garmentId: string | null;
  readonly bagId: string | null;
  readonly exceptionType: string;
  readonly severity: string;
  readonly blocking: boolean;
  readonly status: string;
  readonly note: string | null;
  readonly evidenceAssetId: string | null;
  readonly createdBy: string;
}

export async function insertException(
  client: HubClient,
  input: InsertExceptionInput,
): Promise<void> {
  await client.query(
    `insert into edge_laundry.exception
       (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
        exception_type, severity, blocking, status, note, evidence_asset_id,
        created_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.garmentId,
      input.bagId,
      input.exceptionType,
      input.severity,
      input.blocking,
      input.status,
      input.note,
      input.evidenceAssetId,
      input.createdBy,
    ],
  );
}

/**
 * A BLOCKING unresolved exception must fail the T4 completion gate (§12
 * acceptance test 5).
 */
export async function countBlockingExceptions(
  client: HubClient,
  bookingId: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from edge_laundry.exception
      where booking_id = $1 and blocking and resolved_at is null`,
    [bookingId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

export interface StoragePositionRow {
  id: string;
  location_id: string;
  position_code: string;
  capacity: number;
  status: string;
  record_version: bigint;
}

export async function findStoragePosition(
  client: HubClient,
  positionId: string,
): Promise<StoragePositionRow | undefined> {
  const result = await client.query<StoragePositionRow>(
    `select id, location_id, position_code, capacity, status, record_version
       from edge_laundry.storage_position where id = $1 for update`,
    [positionId],
  );
  return result.rows[0];
}

export interface InsertStorageAssignmentInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly garmentId: string | null;
  readonly bagId: string | null;
  readonly storagePositionId: string;
  readonly assignedBy: string;
  readonly terminalDeviceId: string;
  /** `edge_sync.local_event.id`; UNIQUE on the relation. */
  readonly assignmentEventId: string;
}

/**
 * Ready storage occupancy (§6.4). Over-capacity is rejected by the 0012
 * trigger and double occupancy by the partial unique indexes; the command layer
 * additionally runs SERIALIZABLE (§1) so §12 acceptance test 4 holds under
 * concurrency.
 */
export async function insertStorageAssignment(
  client: HubClient,
  input: InsertStorageAssignmentInput,
): Promise<void> {
  await client.query(
    `insert into edge_laundry.storage_assignment
       (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
        storage_position_id, assigned_at, assigned_by, terminal_device_id,
        assignment_event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, $11)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.garmentId,
      input.bagId,
      input.storagePositionId,
      input.assignedBy,
      input.terminalDeviceId,
      input.assignmentEventId,
    ],
  );
}

export interface StorageAssignmentRow {
  id: string;
  booking_id: string;
  garment_id: string | null;
  bag_id: string | null;
  storage_position_id: string;
  cleared_at: Date | null;
}

export async function listActiveStorageAssignments(
  client: HubClient,
  bookingId: string,
): Promise<readonly StorageAssignmentRow[]> {
  const result = await client.query<StorageAssignmentRow>(
    `select id, booking_id, garment_id, bag_id, storage_position_id, cleared_at
       from edge_laundry.storage_assignment
      where booking_id = $1 and cleared_at is null
      order by assigned_at, id`,
    [bookingId],
  );
  return result.rows;
}

/** Clearing is a one-time paired write; the row itself is never deleted (§1). */
export async function clearStorageAssignments(
  client: HubClient,
  bookingId: string,
  clearedBy: string,
  clearReason: string,
): Promise<number> {
  const result = await client.query(
    `update edge_laundry.storage_assignment
        set cleared_at = now(), cleared_by = $2, clear_reason = $3
      where booking_id = $1 and cleared_at is null`,
    [bookingId, clearedBy, clearReason],
  );
  return result.rowCount ?? 0;
}

export interface ReadyScanSessionRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  booking_id: string;
  terminal_device_id: string;
  actor_id: string;
  expected_count: number;
  scanned_count: number;
  qa_state: string;
  storage_state: string;
  status: string;
  idempotency_key: string;
  completed_at: Date | null;
}

export async function insertReadyScanSession(
  client: HubClient,
  input: {
    readonly id: string;
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly locationId: string;
    readonly bookingId: string;
    readonly terminalDeviceId: string;
    readonly actorId: string;
    readonly expectedCount: number;
    readonly idempotencyKey: string;
  },
): Promise<void> {
  await client.query(
    `insert into edge_laundry.ready_scan_session
       (id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
        actor_id, started_at, expected_count, scanned_count, qa_state, storage_state,
        status, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, now(), $8, 0, 'pending', 'unassigned',
             'in_progress', $9)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.terminalDeviceId,
      input.actorId,
      input.expectedCount,
      input.idempotencyKey,
    ],
  );
}

export async function loadReadyScanSessionForUpdate(
  client: HubClient,
  sessionId: string,
): Promise<ReadyScanSessionRow | undefined> {
  const result = await client.query<ReadyScanSessionRow>(
    `select id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
            actor_id, expected_count, scanned_count, qa_state, storage_state, status,
            idempotency_key, completed_at
       from edge_laundry.ready_scan_session where id = $1 for update`,
    [sessionId],
  );
  return result.rows[0];
}

export async function updateReadyScanSession(
  client: HubClient,
  input: {
    readonly sessionId: string;
    readonly scannedCount?: number;
    readonly qaState?: string;
    readonly storageState?: string;
    readonly status?: string;
    readonly completed?: boolean;
  },
): Promise<void> {
  await client.query(
    `update edge_laundry.ready_scan_session
        set scanned_count = coalesce($2::integer, scanned_count),
            qa_state      = coalesce($3, qa_state),
            storage_state = coalesce($4, storage_state),
            status        = coalesce($5, status),
            completed_at  = case when $6::boolean then now() else completed_at end
      where id = $1`,
    [
      input.sessionId,
      input.scannedCount ?? null,
      input.qaState ?? null,
      input.storageState ?? null,
      input.status ?? null,
      input.completed ?? false,
    ],
  );
}

export interface PickupSessionRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  booking_id: string;
  terminal_device_id: string;
  actor_id: string;
  collector_verification_method: string | null;
  collector_verified_at: Date | null;
  expected_count: number;
  scanned_count: number;
  payment_gate_state: string;
  completed_at: Date | null;
  status: string;
  idempotency_key: string;
}

export async function insertPickupSession(
  client: HubClient,
  input: {
    readonly id: string;
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly locationId: string;
    readonly bookingId: string;
    readonly terminalDeviceId: string;
    readonly actorId: string;
    readonly expectedCount: number;
    readonly paymentGateState: string;
    readonly idempotencyKey: string;
  },
): Promise<void> {
  await client.query(
    `insert into edge_laundry.pickup_session
       (id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
        actor_id, started_at, expected_count, scanned_count, payment_gate_state,
        status, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, now(), $8, 0, $9, 'in_progress', $10)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.terminalDeviceId,
      input.actorId,
      input.expectedCount,
      input.paymentGateState,
      input.idempotencyKey,
    ],
  );
}

export async function loadPickupSessionForUpdate(
  client: HubClient,
  sessionId: string,
): Promise<PickupSessionRow | undefined> {
  const result = await client.query<PickupSessionRow>(
    `select id, tenant_id, digital_store_id, location_id, booking_id, terminal_device_id,
            actor_id, collector_verification_method, collector_verified_at,
            expected_count, scanned_count, payment_gate_state, completed_at, status,
            idempotency_key
       from edge_laundry.pickup_session where id = $1 for update`,
    [sessionId],
  );
  return result.rows[0];
}

export async function updatePickupSession(
  client: HubClient,
  input: {
    readonly sessionId: string;
    readonly collectorVerificationMethod?: string;
    readonly collectorVerified?: boolean;
    readonly scannedCount?: number;
    readonly paymentGateState?: string;
    readonly status?: string;
    readonly completed?: boolean;
  },
): Promise<void> {
  await client.query(
    `update edge_laundry.pickup_session
        set collector_verification_method = coalesce($2, collector_verification_method),
            collector_verified_at = case when $3::boolean then now()
                                         else collector_verified_at end,
            scanned_count = coalesce($4::integer, scanned_count),
            payment_gate_state = coalesce($5, payment_gate_state),
            status = coalesce($6, status),
            completed_at = case when $7::boolean then now() else completed_at end
      where id = $1`,
    [
      input.sessionId,
      input.collectorVerificationMethod ?? null,
      input.collectorVerified ?? false,
      input.scannedCount ?? null,
      input.paymentGateState ?? null,
      input.status ?? null,
      input.completed ?? false,
    ],
  );
}

/**
 * Display-number allocation (§7, offline contract §14). Runs the SERIALIZABLE
 * stored procedure; it never blocks on WAN.
 */
export async function allocateBusinessNumber(
  client: HubClient,
  locationId: string,
  sequenceCode: string,
  businessDate: string,
): Promise<bigint> {
  const result = await client.query<{ allocate_business_number: bigint }>(
    `select edge_core.allocate_business_number($1::uuid, $2::text, $3::date)`,
    [locationId, sequenceCode, businessDate],
  );
  return result.rows[0]?.allocate_business_number ?? 1n;
}

export async function formatDisplayNumber(
  client: HubClient,
  prefix: string,
  locationCode: string,
  businessDate: string,
  sequence: bigint,
): Promise<string> {
  const result = await client.query<{ format_display_number: string }>(
    `select edge_core.format_display_number($1::text, $2::text, $3::date, $4::bigint)`,
    [prefix, locationCode, businessDate, sequence.toString()],
  );
  const value = result.rows[0]?.format_display_number;
  if (value === undefined) {
    throw new Error("edge_core.format_display_number returned no row.");
  }
  return value;
}
