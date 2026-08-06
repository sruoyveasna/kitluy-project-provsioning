/**
 * Cloud ingestion of Hub-issued pairing receipts — WS-11-T004-P04C3.
 *
 * Authority: the P04C owner package §23; migration group 0176; Store Hub spec
 * §11.4 (per-data-class conflict policy — no generic last-write-wins) and
 * §11.5 (per-event results); KLREQ-026 (the `kh1.*` effect key).
 *
 * ===========================================================================
 * WHAT THE CLOUD IS, AND IS NOT
 * ===========================================================================
 * The Store Hub is the pairing authority. This module stores fleet evidence.
 * It has no method that CREATES a pairing, none that changes `paired_at`, and
 * none that reaches a Hub — so no code path here can make the cloud the LAN
 * pairing authority, cause a second local receipt, or turn a delayed delivery
 * into a re-pairing.
 *
 * FRESHNESS IS NOT HISTORY. The read projection returns HUB time (`pairedAt`)
 * and CLOUD time (`firstReceivedAt` / `lastReceivedAt`) as separate fields,
 * because a fleet view that merges them reports "last seen" for something that
 * happened weeks earlier.
 *
 * ===========================================================================
 * SCOPE IS RE-DERIVED FROM THE AUTHENTICATED HUB, NOT FROM THE EVENT
 * ===========================================================================
 * The event body says which Tenant, Store and Location it belongs to. So does
 * the authenticated Hub that delivered it. When they disagree, THE EVENT IS
 * REFUSED — a Hub authenticated for one Store cannot ingest a receipt claiming
 * another, whatever its payload says. That check lives here, above the door,
 * because the door sees only facts and cannot know who delivered them.
 *
 * Every operation is ONE governed transaction under the NOLOGIN
 * `kitluy_edge_sync_service` identity, ENTERED with `set local role` so the
 * capability dies with the transaction (the 0173 discipline, applied to the
 * 0176 identity).
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;
const EFFECT_KEY = /^kh1\.[0-9a-fA-F-]{36}\.[0-9]{1,10}$/;
const PROFILE = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;
const ENVIRONMENTS = ["development", "pilot", "production"] as const;

/** Closed result vocabulary. No SQLSTATE, role name or SQL text escapes. */
export type PairingReceiptIngestionResult =
  | "INGESTED"
  | "DUPLICATE_IGNORED"
  | "REJECTED_SCHEMA"
  | "REJECTED_SCOPE"
  | "CONFLICT"
  | "INTERNAL_ERROR";

export interface IngestionOutcome {
  readonly result: PairingReceiptIngestionResult;
  readonly correlationId: string;
  readonly receiptId?: string;
  /** HUB time. Never recomputed, never moved by ingestion. */
  readonly pairedAt?: string;
  readonly deliveryCount?: number;
}

/** The PUBLIC receipt facts the Hub replicates (owner package §22). */
export interface PairingReceiptEvent {
  readonly effectKey: string;
  readonly receiptId: string;
  readonly receiptVersion: string;
  readonly pairingSessionId: string;
  readonly hubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileCode: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly environment: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalCertificateFingerprint: string;
  readonly hubCertificateSerial: string;
  readonly transcriptHash: string;
  readonly hubReceiptSignature: string;
  readonly pairedAt: string;
  readonly correlationId: string;
}

/**
 * The scope the DELIVERING Hub was authenticated for.
 *
 * Supplied by the transport that authenticated it, never taken from the event.
 */
export interface AuthenticatedHubDelivery {
  readonly hubDeviceId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
}

export interface SafeLogger {
  info(fields: Readonly<Record<string, string | number | boolean>>): void;
}
const NO_LOG: SafeLogger = { info: () => undefined };

/** Shape validation only. Relational truth is the door's job. */
export function validateReceiptEventShape(event: PairingReceiptEvent): boolean {
  return (
    EFFECT_KEY.test(event.effectKey) &&
    UUID.test(event.receiptId) &&
    UUID.test(event.pairingSessionId) &&
    UUID.test(event.hubDeviceId) &&
    UUID.test(event.terminalDeviceId) &&
    UUID.test(event.tenantId) &&
    UUID.test(event.digitalStoreId) &&
    UUID.test(event.locationId) &&
    UUID.test(event.correlationId) &&
    HEX64.test(event.hubCertificateFingerprint) &&
    HEX64.test(event.terminalCertificateFingerprint) &&
    HEX64.test(event.transcriptHash) &&
    PROFILE.test(event.terminalProfileCode) &&
    (ENVIRONMENTS as readonly string[]).includes(event.environment) &&
    Number.isInteger(event.terminalAssignmentGeneration) &&
    event.terminalAssignmentGeneration >= 1 &&
    event.receiptVersion.length > 0 &&
    event.hubCertificateSerial.length > 0 &&
    event.hubReceiptSignature.length > 0 &&
    !Number.isNaN(Date.parse(event.pairedAt)) &&
    // The effect key's namespace IS the receipt id (KLREQ-026 as applied to a
    // Hub-originated fact — see the Hub's pairing-replication module). An
    // event whose key names another receipt is refused rather than ingested
    // under a key that does not identify it.
    event.effectKey.split(".")[1]?.toLowerCase() === event.receiptId.toLowerCase()
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Maps the door's sentinel family — never a SQLSTATE — to a closed result. */
function mapSentinel(message: string): PairingReceiptIngestionResult {
  if (message.includes("KLUY-PAIRING-RECEIPT-CONFLICT")) return "CONFLICT";
  if (message.includes("KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA")) return "REJECTED_SCHEMA";
  // WS-11-T008 NEW-1: group 0183 moved Hub identity, scope and generation
  // binding INTO the door. Those refusals are scope refusals here — the
  // same closed result the envelope check produces — so a caller cannot
  // tell whether the consumer or the database refused, and neither leaks
  // which scope actually owns the devices.
  if (
    message.includes("KLUY-PAIRING-RECEIPT-WRONG-HUB") ||
    message.includes("KLUY-PAIRING-RECEIPT-WRONG-SCOPE") ||
    message.includes("KLUY-PAIRING-RECEIPT-STALE-GENERATION") ||
    message.includes("KLUY-PAIRING-RECEIPT-HUB-UNASSIGNED") ||
    message.includes("KLUY-PAIRING-RECEIPT-DEVICE-UNASSIGNED")
  ) {
    return "REJECTED_SCOPE";
  }
  return "INTERNAL_ERROR";
}

export interface TerminalPairingState {
  readonly found: boolean;
  readonly receiptId?: string;
  readonly pairingSessionId?: string;
  readonly hubDeviceId?: string;
  readonly terminalProfileCode?: string;
  readonly terminalAssignmentGeneration?: number;
  readonly environment?: string;
  /** HUB time — when the terminal actually paired. */
  readonly pairedAt?: string;
  /** CLOUD time — when this cloud first and last heard about it. */
  readonly firstReceivedAt?: string;
  readonly lastReceivedAt?: string;
  readonly deliveryCount?: number;
}

export class PairingReceiptIngestion {
  constructor(
    private readonly source: ClientSource,
    private readonly logger: SafeLogger = NO_LOG,
  ) {}

  /**
   * Ingest ONE replicated receipt.
   *
   * Order is the contract:
   *   1. SHAPE — a malformed event is a durable schema rejection; retrying
   *      sends the same malformed event;
   *   2. SCOPE — the authenticated Hub's scope must be the event's scope, and
   *      the delivering Hub must be the Hub the receipt names;
   *   3. the governed door decides, and its idempotence is keyed on the
   *      receipt id, so repeated, delayed or reordered delivery produces
   *      exactly one business effect.
   */
  async ingest(
    event: PairingReceiptEvent,
    delivery: AuthenticatedHubDelivery,
  ): Promise<IngestionOutcome> {
    const correlationId = randomUUID();
    if (!validateReceiptEventShape(event)) {
      this.logger.info({ operation: "ingest", correlationId, result: "REJECTED_SCHEMA" });
      return { result: "REJECTED_SCHEMA", correlationId };
    }
    // A Hub authenticated for one Store cannot ingest another Store's receipt,
    // and cannot ingest a receipt naming a Hub that is not itself.
    if (
      event.tenantId.toLowerCase() !== delivery.tenantId.toLowerCase() ||
      event.digitalStoreId.toLowerCase() !== delivery.digitalStoreId.toLowerCase() ||
      event.locationId.toLowerCase() !== delivery.locationId.toLowerCase() ||
      event.hubDeviceId.toLowerCase() !== delivery.hubDeviceId.toLowerCase()
    ) {
      this.logger.info({ operation: "ingest", correlationId, result: "REJECTED_SCOPE" });
      return { result: "REJECTED_SCOPE", correlationId };
    }

    try {
      const row = await withServiceRole(this.source, REGISTRY_ROLES.edgeSync, async (client) =>
        callDoor(
          client,
          `kitluy_devices.ingest_terminal_pairing_receipt_v1(
             $1, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, $7::integer, $8, $9::uuid, $10::uuid,
             $11::uuid, $12, $13, $14, $15, $16, $17, $18::timestamptz, $19::uuid)`,
          [
            event.effectKey,
            event.receiptId,
            event.receiptVersion,
            event.pairingSessionId,
            event.hubDeviceId,
            event.terminalDeviceId,
            event.terminalAssignmentGeneration,
            event.terminalProfileCode,
            event.tenantId,
            event.digitalStoreId,
            event.locationId,
            event.environment,
            event.hubCertificateFingerprint,
            event.terminalCertificateFingerprint,
            event.hubCertificateSerial,
            event.transcriptHash,
            event.hubReceiptSignature,
            event.pairedAt,
            event.correlationId,
          ],
        ),
      );
      const result = String(row["outcome"] ?? "") === "INGESTED" ? "INGESTED" : "DUPLICATE_IGNORED";
      this.logger.info({ operation: "ingest", correlationId, result });
      return {
        result,
        correlationId,
        receiptId: String(row["receipt_id"] ?? ""),
        pairedAt: String(row["paired_at"] ?? ""),
        deliveryCount: Number(row["delivery_count"] ?? 0),
      };
    } catch (error) {
      const result = mapSentinel(messageOf(error));
      this.logger.info({ operation: "ingest", correlationId, result });
      return { result, correlationId };
    }
  }

  /** Fleet read projection. Hub time and cloud time stay separate fields. */
  async readTerminalPairingState(terminalDeviceId: string): Promise<TerminalPairingState> {
    if (!UUID.test(terminalDeviceId)) return { found: false };
    const row = await withServiceRole(this.source, REGISTRY_ROLES.edgeSync, async (client) =>
      callDoor(client, `kitluy_devices.read_terminal_pairing_state_v1($1::uuid)`, [
        terminalDeviceId,
      ]),
    );
    if (row["found"] !== true) return { found: false };
    return {
      found: true,
      receiptId: String(row["receipt_id"] ?? ""),
      pairingSessionId: String(row["pairing_session_id"] ?? ""),
      hubDeviceId: String(row["hub_device_id"] ?? ""),
      terminalProfileCode: String(row["terminal_profile_code"] ?? ""),
      terminalAssignmentGeneration: Number(row["terminal_assignment_generation"] ?? 0),
      environment: String(row["environment"] ?? ""),
      pairedAt: String(row["paired_at"] ?? ""),
      firstReceivedAt: String(row["first_received_at"] ?? ""),
      lastReceivedAt: String(row["last_received_at"] ?? ""),
      deliveryCount: Number(row["delivery_count"] ?? 0),
    };
  }
}

interface DoorRow {
  result: Record<string, unknown>;
}

async function callDoor(
  client: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<DoorRow>(`select ${sql} as result`, params);
  return rows[0]?.result ?? {};
}
