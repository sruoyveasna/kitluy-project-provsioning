/**
 * Cloud fleet-health ingestion (WS-11-T005-P02) — the consumer of the Hub's
 * `device_fleet.health_projection_reported` v1 events, feeding the group-0177
 * door `kitluy_devices.ingest_device_health_report_v1`.
 *
 * Mirrors PairingReceiptIngestion exactly: a directly-callable class whose
 * `AuthenticatedHubDelivery` scope is supplied by the transport that
 * authenticated the batch — that signed Hub→cloud transport remains the
 * recorded BLK-006 gap, so the only production caller today is absent by
 * design and the integration test drives this class instead.
 *
 * Order of operations: shape → scope → door. The door DERIVES tenant/store/
 * location/assignment from the observed device's live assignment, so scope is
 * re-checked here against the authenticated delivery BEFORE the door runs.
 * Repeated deliveries are idempotent on the kh1 effect key; delayed or
 * reordered deliveries are stored as history and never replace a newer
 * projection (the door's STALE_IGNORED / ANOMALY_RECORDED contract).
 */
import type pg from "pg";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EFFECT_KEY = /^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$/;
const CLASSIFICATIONS = new Set(["healthy", "degraded", "offline_local", "unknown"]);
const ENVIRONMENTS = new Set(["development", "pilot", "production"]);

export type HealthReportIngestionResult =
  | "PROJECTED"
  | "DUPLICATE_IGNORED"
  | "STALE_IGNORED"
  | "ANOMALY_RECORDED"
  | "REJECTED_SCHEMA"
  | "REJECTED_SCOPE"
  | "REJECTED_IDENTITY"
  | "INTERNAL_ERROR";

export interface HealthReportIngestionOutcome {
  readonly result: HealthReportIngestionResult;
  readonly correlationId: string;
  readonly projectionVersion?: number;
  readonly refusalCode?: string;
}

/** The v1 event payload the Hub replicates (flat, public material only). */
export interface HealthReportEvent {
  readonly effectKey: string;
  readonly healthReportId: string;
  readonly reportVersion: number;
  readonly terminalDeviceId: string;
  readonly hubDeviceId: string;
  readonly assignmentGeneration: number;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly environment: string;
  readonly reportSequence: number;
  readonly observedAt: string;
  readonly lastLocalContactAt: string | null;
  readonly healthClassification: string;
  readonly healthReasons: readonly string[];
  readonly softwareVersion: string | null;
  readonly releaseVersion: string | null;
  readonly configurationVersion: string | null;
  readonly terminalProfileKey?: string | null;
  readonly correlationId: string;
}

/** The scope the DELIVERING Hub was authenticated for (transport-supplied). */
export interface AuthenticatedHubDelivery {
  readonly hubDeviceId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
}

export interface SafeLogger {
  info(fields: Record<string, string | number | boolean>): void;
}

interface DoorRow {
  readonly result: Record<string, unknown>;
}

async function callDoor(
  client: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<DoorRow>(`select ${sql} as result`, params);
  return rows[0]?.result ?? {};
}

function mapSentinel(message: string): HealthReportIngestionResult {
  if (message.includes("KLUY-FLEET-REPORT-REJECTED-SCHEMA")) return "REJECTED_SCHEMA";
  if (message.includes("KLUY-FLEET-REPORT-STALE-GENERATION")) return "REJECTED_IDENTITY";
  if (
    message.includes("KLUY-FLEET-REPORT-NOT-HUB") ||
    message.includes("KLUY-FLEET-REPORT-HUB-UNASSIGNED") ||
    message.includes("KLUY-FLEET-REPORT-DEVICE-UNASSIGNED") ||
    message.includes("KLUY-FLEET-REPORT-WRONG-HUB")
  ) {
    return "REJECTED_IDENTITY";
  }
  if (
    message.includes("KLUY-FLEET-REPORT-ENVIRONMENT") ||
    message.includes("KLUY-FLEET-REPORT-CLASSIFICATION") ||
    message.includes("KLUY-FLEET-REPORT-SEQUENCE")
  ) {
    return "REJECTED_SCHEMA";
  }
  return "INTERNAL_ERROR";
}

function shapeValid(event: HealthReportEvent): boolean {
  return (
    EFFECT_KEY.test(event.effectKey) &&
    UUID.test(event.healthReportId) &&
    event.effectKey === `kh1.${event.healthReportId.toLowerCase()}.1` &&
    UUID.test(event.terminalDeviceId) &&
    UUID.test(event.hubDeviceId) &&
    UUID.test(event.tenantId) &&
    UUID.test(event.digitalStoreId) &&
    UUID.test(event.locationId) &&
    UUID.test(event.correlationId) &&
    Number.isSafeInteger(event.assignmentGeneration) &&
    event.assignmentGeneration >= 1 &&
    Number.isSafeInteger(event.reportSequence) &&
    event.reportSequence >= 1 &&
    event.reportVersion === 1 &&
    ENVIRONMENTS.has(event.environment) &&
    CLASSIFICATIONS.has(event.healthClassification) &&
    Array.isArray(event.healthReasons) &&
    event.healthReasons.length <= 32 &&
    typeof event.observedAt === "string" &&
    !Number.isNaN(Date.parse(event.observedAt))
  );
}

export class HealthReportIngestion {
  public constructor(
    private readonly source: ClientSource,
    private readonly logger?: SafeLogger,
  ) {}

  public async ingest(
    delivery: AuthenticatedHubDelivery,
    event: HealthReportEvent,
  ): Promise<HealthReportIngestionOutcome> {
    const correlationId = event.correlationId;
    if (!shapeValid(event)) {
      return { result: "REJECTED_SCHEMA", correlationId };
    }
    // The delivering Hub can only report devices inside ITS authenticated
    // scope; the door re-derives truth relationally, but a scope mismatch is
    // refused before any database work (the pairing-ingestion discipline).
    if (
      delivery.hubDeviceId.toLowerCase() !== event.hubDeviceId.toLowerCase() ||
      delivery.tenantId.toLowerCase() !== event.tenantId.toLowerCase() ||
      delivery.digitalStoreId.toLowerCase() !== event.digitalStoreId.toLowerCase() ||
      delivery.locationId.toLowerCase() !== event.locationId.toLowerCase()
    ) {
      return { result: "REJECTED_SCOPE", correlationId };
    }

    try {
      const row = await withServiceRole(this.source, REGISTRY_ROLES.edgeSync, async (client) =>
        callDoor(
          client,
          `kitluy_devices.ingest_device_health_report_v1(
             $1, $2::uuid, $3::uuid, $4, $5::integer, $6::bigint, $7, $8::text[],
             $9, $10, $11, $12, $13::timestamptz, $14::timestamptz, $15::uuid)`,
          [
            event.effectKey,
            event.hubDeviceId,
            event.terminalDeviceId,
            event.environment,
            event.assignmentGeneration,
            event.reportSequence,
            event.healthClassification,
            [...event.healthReasons],
            event.terminalProfileKey ?? null,
            event.softwareVersion,
            event.configurationVersion,
            event.releaseVersion,
            event.lastLocalContactAt,
            event.observedAt,
            event.correlationId,
          ],
        ),
      );
      const outcome = String(row["outcome"] ?? "INTERNAL_ERROR");
      const projectionVersion = Number(row["projection_version"] ?? Number.NaN);
      const refusal = row["refusal_code"];
      this.logger?.info({
        event: "fleet_health.report_ingested",
        outcome,
        terminalDeviceId: event.terminalDeviceId,
        reportSequence: event.reportSequence,
      });
      return {
        result:
          outcome === "PROJECTED" ||
          outcome === "DUPLICATE_IGNORED" ||
          outcome === "STALE_IGNORED" ||
          outcome === "ANOMALY_RECORDED"
            ? outcome
            : "INTERNAL_ERROR",
        correlationId,
        ...(Number.isFinite(projectionVersion) ? { projectionVersion } : {}),
        ...(typeof refusal === "string" ? { refusalCode: refusal } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      return { result: mapSentinel(message), correlationId };
    }
  }
}
