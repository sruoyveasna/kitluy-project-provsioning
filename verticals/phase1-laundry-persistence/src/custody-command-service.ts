/**
 * WS-07 production/custody command services (WS-07-T003).
 *
 * The canonical production state machine decides every transition
 * (transitionProduction for the forward chain; markReady is the ONLY path to
 * READY — KBR-LND-004; completePickup is the ONLY path to PICKED_UP —
 * KBR-LND-005). Custody history is append-only with Tenant-scoped idempotency
 * keys; a duplicate scan replays the prior event (KBR-LND-004 TV3).
 *
 * NO authoritative Edge/Hub T3/T4 routes exist this cycle (KL-DEC-001 +
 * BLK-003 fence) — these are internal services/test adapters only.
 */
import type pg from "pg";
import {
  completePickup,
  markReady,
  transitionProduction,
  type LaundryTerminalProfile,
  type ProductionState,
} from "@kitluy-verticals/phase1-laundry";
import {
  appendAuditLog,
  withServiceTransaction,
  type CommandActor,
} from "@kitluy/payments-persistence";

export class CustodyPersistenceError extends Error {
  constructor(
    readonly code:
      "BOOKING_NOT_FOUND" | "STALE_VERSION" | "STORAGE_NOT_ASSIGNED" | "POSITION_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "CustodyPersistenceError";
  }
}

interface ProductionRow {
  order_id: string;
  tenant_id: string;
  digital_store_id: string;
  store_location_id: string | null;
  production_status: ProductionState;
  version: bigint;
}

async function loadProductionForUpdate(
  client: pg.PoolClient,
  orderId: string,
): Promise<ProductionRow> {
  const result = await client.query<ProductionRow>(
    `select order_id, tenant_id, digital_store_id, store_location_id,
            production_status, version
       from kitluy_laundry.booking_production_state where order_id = $1 for update`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new CustodyPersistenceError("BOOKING_NOT_FOUND", `no production state for ${orderId}`);
  }
  return row;
}

async function persistProductionTransition(
  client: pg.PoolClient,
  row: ProductionRow,
  next: ProductionState,
  actor: CommandActor,
  idempotencyKey: string,
  reasonCode?: string,
): Promise<bigint> {
  const updated = await client.query<{ version: bigint }>(
    `update kitluy_laundry.booking_production_state
        set production_status = $1, version = version + 1, updated_at = now()
      where order_id = $2 and version = $3
      returning version`,
    [next, row.order_id, row.version],
  );
  const newVersion = updated.rows[0];
  if (!newVersion) {
    throw new CustodyPersistenceError(
      "STALE_VERSION",
      `production state for ${row.order_id} version ${row.version} is stale`,
    );
  }
  await client.query(
    `insert into kitluy_laundry.booking_status_history
       (tenant_id, order_id, from_status, to_status, reason_code, actor_user_id,
        actor_service_key, idempotency_key, aggregate_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.tenant_id,
      row.order_id,
      row.production_status,
      next,
      reasonCode ?? null,
      actor.userId ?? null,
      actor.serviceKey ?? null,
      idempotencyKey,
      newVersion.version.toString(),
    ],
  );
  return newVersion.version;
}

export interface ProductionTransitionCommand {
  readonly orderId: string;
  readonly to: ProductionState;
  readonly expectedVersion: bigint;
  readonly actor: CommandActor;
  readonly idempotencyKey: string;
}

export interface ProductionTransitionResult {
  readonly replayed: boolean;
  readonly from: ProductionState;
  readonly to: ProductionState;
  readonly version: bigint;
}

/** Forward-chain transition (never READY/PICKED_UP — engine-guarded). */
export async function transitionProductionStage(
  pool: pg.Pool,
  cmd: ProductionTransitionCommand,
): Promise<ProductionTransitionResult> {
  return withServiceTransaction(pool, async (client) => {
    const row = await loadProductionForUpdate(client, cmd.orderId);
    const replayed = await client.query<{
      from_status: ProductionState;
      to_status: ProductionState;
      aggregate_version: bigint;
    }>(
      `select from_status, to_status, aggregate_version
         from kitluy_laundry.booking_status_history
        where order_id = $1 and idempotency_key = $2`,
      [cmd.orderId, cmd.idempotencyKey],
    );
    const prior = replayed.rows[0];
    if (prior) {
      return {
        replayed: true,
        from: prior.from_status,
        to: prior.to_status,
        version: prior.aggregate_version,
      };
    }
    if (row.version !== cmd.expectedVersion) {
      throw new CustodyPersistenceError(
        "STALE_VERSION",
        `production version ${row.version} != expected ${cmd.expectedVersion}`,
      );
    }
    // Canonical engine decision (throws on skips, backwards, READY/PICKED_UP).
    const next = transitionProduction(row.production_status, cmd.to);
    const version = await persistProductionTransition(
      client,
      row,
      next,
      cmd.actor,
      cmd.idempotencyKey,
    );
    return { replayed: false, from: row.production_status, to: next, version };
  });
}

export interface CustodyScanCommand {
  readonly orderId: string;
  readonly garmentId?: string;
  readonly scanType:
    | "INTAKE"
    | "WASH_START"
    | "WASH_COMPLETE"
    | "DRY_START"
    | "DRY_COMPLETE"
    | "PRESS_START"
    | "PRESS_COMPLETE"
    | "QA_PASS"
    | "QA_FAIL"
    | "READY_SCAN_IN"
    | "PICKUP_SCAN_OUT"
    | "REWASH"
    | "ISSUE";
  readonly terminalRole: Exclude<LaundryTerminalProfile, "t2_customer_display">;
  readonly fromState?: string;
  readonly toState?: string;
  readonly storagePositionId?: string;
  readonly actor: CommandActor;
  readonly reasonCode?: string;
  readonly idempotencyKey: string;
  readonly aggregateVersion: bigint;
}

export interface CustodyScanResult {
  readonly replayed: boolean;
  readonly scanEventId: string;
}

/** Append one custody event; a duplicate idempotency key replays. */
export async function recordCustodyScan(
  pool: pg.Pool,
  cmd: CustodyScanCommand,
): Promise<CustodyScanResult> {
  return withServiceTransaction(pool, async (client) => {
    return recordCustodyScanInTx(client, cmd);
  });
}

async function recordCustodyScanInTx(
  client: pg.PoolClient,
  cmd: CustodyScanCommand,
): Promise<CustodyScanResult> {
  const order = await client.query<{
    tenant_id: string;
    digital_store_id: string;
    store_location_id: string | null;
  }>(
    `select tenant_id, digital_store_id, store_location_id
       from kitluy_orders.orders where id = $1`,
    [cmd.orderId],
  );
  const scope = order.rows[0];
  if (!scope) {
    throw new CustodyPersistenceError("BOOKING_NOT_FOUND", `order ${cmd.orderId} not found`);
  }
  const existing = await client.query<{ id: string }>(
    `select id from kitluy_laundry.garment_scan_events
      where tenant_id = $1 and idempotency_key = $2`,
    [scope.tenant_id, cmd.idempotencyKey],
  );
  if (existing.rows[0]) {
    // KBR-LND-004 TV3: duplicate scan replays the prior business result.
    return { replayed: true, scanEventId: existing.rows[0].id };
  }
  const inserted = await client.query<{ id: string }>(
    `insert into kitluy_laundry.garment_scan_events
       (tenant_id, digital_store_id, store_location_id, order_id, garment_id,
        scan_type, terminal_role, from_state, to_state, storage_position_id,
        actor_user_id, actor_service_key, reason_code, idempotency_key,
        aggregate_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning id`,
    [
      scope.tenant_id,
      scope.digital_store_id,
      scope.store_location_id,
      cmd.orderId,
      cmd.garmentId ?? null,
      cmd.scanType,
      cmd.terminalRole,
      cmd.fromState ?? null,
      cmd.toState ?? null,
      cmd.storagePositionId ?? null,
      cmd.actor.userId ?? null,
      cmd.actor.serviceKey ?? null,
      cmd.reasonCode ?? null,
      cmd.idempotencyKey,
      cmd.aggregateVersion.toString(),
    ],
  );
  return { replayed: false, scanEventId: inserted.rows[0]!.id };
}

export interface ReadyCommitCommand {
  readonly orderId: string;
  readonly garmentId?: string;
  readonly expectedVersion: bigint;
  readonly profile: LaundryTerminalProfile;
  readonly qaPassed: boolean;
  readonly countVerified: boolean;
  readonly storagePositionId: string;
  readonly actor: CommandActor;
  readonly idempotencyKey: string;
}

/** T3 Ready commit: engine markReady guards profile + QA + count + storage. */
export async function commitReady(
  pool: pg.Pool,
  cmd: ReadyCommitCommand,
): Promise<ProductionTransitionResult> {
  return withServiceTransaction(pool, async (client) => {
    const row = await loadProductionForUpdate(client, cmd.orderId);
    const replayed = await client.query<{
      from_status: ProductionState;
      to_status: ProductionState;
      aggregate_version: bigint;
    }>(
      `select from_status, to_status, aggregate_version
         from kitluy_laundry.booking_status_history
        where order_id = $1 and idempotency_key = $2`,
      [cmd.orderId, cmd.idempotencyKey],
    );
    const prior = replayed.rows[0];
    if (prior) {
      return {
        replayed: true,
        from: prior.from_status,
        to: prior.to_status,
        version: prior.aggregate_version,
      };
    }
    if (row.version !== cmd.expectedVersion) {
      throw new CustodyPersistenceError(
        "STALE_VERSION",
        `production version ${row.version} != expected ${cmd.expectedVersion}`,
      );
    }
    const position = await client.query<{ id: string }>(
      `select id from kitluy_laundry.ready_storage_positions
        where id = $1 and status in ('AVAILABLE', 'OCCUPIED')`,
      [cmd.storagePositionId],
    );
    if (!position.rows[0]) {
      throw new CustodyPersistenceError(
        "POSITION_NOT_FOUND",
        `ready storage position ${cmd.storagePositionId} not usable`,
      );
    }

    // Canonical engine commit — throws T3ReadyCommitError on wrong profile or
    // missing QA/count/storage verification (KBR-LND-004).
    const next = markReady(row.production_status, {
      profile: cmd.profile,
      qaPassed: cmd.qaPassed,
      countVerified: cmd.countVerified,
      storageAssigned: true,
    });

    const version = await persistProductionTransition(
      client,
      row,
      next,
      cmd.actor,
      cmd.idempotencyKey,
    );
    await client.query(
      `insert into kitluy_laundry.ready_storage_assignments
         (tenant_id, order_id, position_id, garment_id, assigned_by)
       values ($1, $2, $3, $4, $5)`,
      [
        row.tenant_id,
        cmd.orderId,
        cmd.storagePositionId,
        cmd.garmentId ?? null,
        cmd.actor.userId ?? null,
      ],
    );
    await recordCustodyScanInTx(client, {
      orderId: cmd.orderId,
      garmentId: cmd.garmentId,
      scanType: "READY_SCAN_IN",
      terminalRole: "t3_ready_scan_in",
      fromState: "PACKED",
      toState: "READY",
      storagePositionId: cmd.storagePositionId,
      actor: cmd.actor,
      idempotencyKey: `${cmd.idempotencyKey}:scan`,
      aggregateVersion: version,
    });
    await appendAuditLog(client, {
      tenantId: row.tenant_id,
      digitalStoreId: row.digital_store_id,
      storeLocationId: row.store_location_id ?? undefined,
      actor: cmd.actor,
      action: "garment.ready_scanned_in",
      resourceType: "garment_custody",
      resourceId: cmd.orderId,
    });
    return { replayed: false, from: row.production_status, to: next, version };
  });
}

export interface PickupReleaseCommand {
  readonly orderId: string;
  readonly expectedVersion: bigint;
  readonly profile: LaundryTerminalProfile;
  readonly collectorVerified: boolean;
  readonly collectorReference?: string;
  readonly releaseCompletenessVerified: boolean;
  readonly approvalRequestId?: string;
  readonly exceptionReasonCode?: string;
  readonly actor: CommandActor;
  readonly idempotencyKey: string;
}

export interface PickupReleaseResult extends ProductionTransitionResult {
  readonly balanceSettled: boolean;
}

/**
 * T4 pickup release: the engine guards profile, collector verification,
 * balance (or approved exception — KBR-LND-005 precondition; thresholds stay
 * open LND-OD-003) and release completeness (WS-07-T001 RV-001).
 */
export async function completePickupRelease(
  pool: pg.Pool,
  cmd: PickupReleaseCommand,
): Promise<PickupReleaseResult> {
  return withServiceTransaction(pool, async (client) => {
    const row = await loadProductionForUpdate(client, cmd.orderId);
    const replayed = await client.query<{
      from_status: ProductionState;
      to_status: ProductionState;
      aggregate_version: bigint;
    }>(
      `select from_status, to_status, aggregate_version
         from kitluy_laundry.booking_status_history
        where order_id = $1 and idempotency_key = $2`,
      [cmd.orderId, cmd.idempotencyKey],
    );
    const prior = replayed.rows[0];
    if (prior) {
      return {
        replayed: true,
        from: prior.from_status,
        to: prior.to_status,
        version: prior.aggregate_version,
        balanceSettled: true,
      };
    }
    if (row.version !== cmd.expectedVersion) {
      throw new CustodyPersistenceError(
        "STALE_VERSION",
        `production version ${row.version} != expected ${cmd.expectedVersion}`,
      );
    }

    const order = await client.query<{ payment_state: string }>(
      `select payment_state from kitluy_orders.orders where id = $1 for update`,
      [cmd.orderId],
    );
    const paymentState = order.rows[0]?.payment_state ?? "UNPAID";
    const balanceSettled = paymentState === "PAID" || paymentState === "OVERPAID";
    // KBR-LND-005 precondition: "required payment settled or approved
    // exception". The engine input is the disjunction; the DB CHECK keeps the
    // approval evidence mandatory for the exception path.
    const balanceOrException = balanceSettled || cmd.approvalRequestId !== undefined;

    // Canonical engine commit — throws T4ReleaseError on wrong profile,
    // unverified collector, unresolved balance or incomplete release.
    const next = completePickup(row.production_status, {
      profile: cmd.profile,
      collectorVerified: cmd.collectorVerified,
      balanceSettled: balanceOrException,
      releaseCompletenessVerified: cmd.releaseCompletenessVerified,
    });

    const version = await persistProductionTransition(
      client,
      row,
      next,
      cmd.actor,
      cmd.idempotencyKey,
    );
    await client.query(
      `insert into kitluy_laundry.pickup_handoffs
         (tenant_id, digital_store_id, store_location_id, order_id, status,
          collector_verified, collector_verified_by, collector_reference,
          balance_settled, release_completeness_verified, exception_reason_code,
          approval_request_id, released_by, handed_over_at)
       values ($1, $2, $3, $4, 'COMPLETED', $5, $6, $7, $8, $9, $10, $11, $12, now())`,
      [
        row.tenant_id,
        row.digital_store_id,
        row.store_location_id,
        cmd.orderId,
        cmd.collectorVerified,
        cmd.actor.userId ?? null,
        cmd.collectorReference ?? null,
        balanceSettled,
        cmd.releaseCompletenessVerified,
        cmd.exceptionReasonCode ?? null,
        cmd.approvalRequestId ?? null,
        cmd.actor.userId ?? null,
      ],
    );
    // Clear active storage custody (one-time clearing pair, append semantics).
    await client.query(
      `update kitluy_laundry.ready_storage_assignments
          set cleared_by = $1, cleared_at = now(),
              clear_reason_code = 'PICKUP_RELEASED'
        where order_id = $2 and cleared_at is null`,
      [cmd.actor.userId ?? null, cmd.orderId],
    );
    await recordCustodyScanInTx(client, {
      orderId: cmd.orderId,
      scanType: "PICKUP_SCAN_OUT",
      terminalRole: "t4_pickup_scan_out",
      fromState: "READY",
      toState: "RELEASED",
      actor: cmd.actor,
      idempotencyKey: `${cmd.idempotencyKey}:scan`,
      aggregateVersion: version,
    });
    await appendAuditLog(client, {
      tenantId: row.tenant_id,
      digitalStoreId: row.digital_store_id,
      storeLocationId: row.store_location_id ?? undefined,
      actor: cmd.actor,
      action: "garment.pickup_scanned_out",
      resourceType: "garment_custody",
      resourceId: cmd.orderId,
      reason: cmd.exceptionReasonCode,
    });
    return { replayed: false, from: row.production_status, to: next, version, balanceSettled };
  });
}
