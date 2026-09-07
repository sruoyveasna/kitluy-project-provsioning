/**
 * Pi Terminal pairing composition — the cloud half of "type the code" for a
 * terminal.
 *
 * Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 §6–§7 (the Partner opens
 * a session for a named seat; the Pi types the code and learns everything else
 * from server rows); KLD-2026-09-03-FACTORY-ENROLLMENT-001 §8; migration group
 * 0213 (the seat, the session, the two doors and this composition's identity).
 *
 * ===========================================================================
 * THE SAME SHAPE AS STORE HUB PAIRING, ON PURPOSE
 * ===========================================================================
 * `hub-pairing-composition.ts` records why pairing is two governed steps in ONE
 * transaction: presentation owns the attempt budget and consumes nothing;
 * consumption owns single-use and re-checks everything under its own lock.
 * Everything there applies here unchanged, with one simplification: the 0213
 * consume door performs the whole assignment itself (claim, redeem, one
 * terminal assignment per role) so this layer composes no digest and calls no
 * 0121 bridge. Two calls, one transaction, as `kitluy_terminal_pairing_service`.
 *
 * ===========================================================================
 * WHERE PAIRING STOPS
 * ===========================================================================
 * At `pending_trust` / `awaiting_trust`, exactly as for a Hub. The route may
 * then try to advance trust (group 0198+), and reports what actually happened.
 */
import { randomUUID } from "node:crypto";

import type pg from "pg";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";
import type { SafeLogger } from "./provisioning-composition.js";

/** Coarse, for the reasons `hub-pairing-composition.ts` records. */
export type TerminalPairingResultCode =
  | "PAIRED"
  | "CODE_REFUSED"
  | "LOCKED"
  | "REDEMPTION_REFUSED"
  | "ALREADY_ASSIGNED"
  | "REQUEST_INVALID"
  | "INTERNAL_ERROR";

export interface TerminalPairingCompositionResult<T = undefined> {
  readonly result: TerminalPairingResultCode;
  readonly correlationId: string;
  readonly data?: T;
  /** Specific internal cause. Logged, NEVER returned to the caller. */
  readonly auditDetail?: string;
}

/**
 * The owner's §7 context: what a paired terminal is told. Every value is a
 * server row from the session and its scope. `requiredAppFamily` and
 * `releaseChannel` are null until the application-family model exists
 * (program task KL-PT-CLOUD-401); saying null is truer than guessing.
 */
export interface TerminalPairingContext {
  readonly contextVersion: string;
  readonly tenantId: string;
  readonly tenantReference: string;
  readonly digitalStoreId: string;
  readonly digitalStoreReference: string;
  readonly storeLocationId: string;
  readonly storeLocationReference: string;
  readonly storeHubDeviceId: string;
  readonly storeHubReference: string | null;
  readonly physicalTerminalId: string;
  readonly physicalTerminalLabel: string;
  readonly terminalProfileKeys: readonly string[];
  readonly terminalAssignments: readonly {
    readonly terminalAssignmentId: string;
    readonly terminalProfileKey: string;
  }[];
  readonly vertical: string;
  readonly requiredAppFamily: null;
  readonly releaseChannel: null;
  readonly environment: string;
}

export interface PairedTerminalMaterial {
  readonly deviceRecordId: string;
  readonly sessionId: string;
  readonly assignmentId: string;
  readonly assignmentGeneration: number;
  readonly storeAssignment: "pending_trust";
  /** True to the model: pairing does NOT activate. */
  readonly activated: false;
  readonly context: TerminalPairingContext;
}

/** Presentation refusals from 0213, mapped TOTALLY to audit strings. */
const PRESENTATION_REFUSALS: Readonly<Record<string, string>> = {
  "KLUY-TERMSESSION-NO-DEVICE": "presentation named no device",
  "KLUY-TERMSESSION-INVALID": "wrong or malformed code, or no such session",
  "KLUY-TERMSESSION-DEVICE-INELIGIBLE":
    "the code was right but this device is not an approved, eligible terminal",
  "KLUY-TERMSESSION-HUB-INACTIVE": "the Store Hub behind this session is no longer active",
  "KLUY-TERMSESSION-CONSUMED": "that pairing code has already been used",
  "KLUY-TERMSESSION-REVOKED": "that pairing code was replaced or cancelled",
  "KLUY-TERMSESSION-EXPIRED": "the pairing code expired",
  "KLUY-TERMSESSION-LOCKED": "attempt budget exhausted",
};

/** Consume-door refusals (returned as jsonb) and 0121 raises, mapped TOTALLY. */
const CONSUME_REFUSALS: Readonly<Record<string, string>> = {
  "KLUY-TERMSESSION-UNKNOWN": "the matched session vanished before consumption",
  "KLUY-TERMSESSION-RACE-LOST": "another device used that pairing code first",
  "KLUY-TERMSESSION-EXPIRED": "the pairing code expired between presentation and consumption",
  "KLUY-TERMSESSION-HUB-INACTIVE": "the Store Hub behind this session is no longer active",
  "KLUY-TERMSESSION-TERMINAL-BOUND": "another device already holds this seat",
};

const ASSIGNMENT_CONFLICTS: Readonly<Record<string, string>> = {
  "KLUY-DEVICE-ALREADY-CLAIMED": "the device already holds a live assignment",
  "KLUY-DEVICE-OWNERSHIP-TRANSFER":
    "the device holds a live assignment to a different Tenant/Store/Location",
};

const REDEMPTION_REFUSALS: Readonly<Record<string, string>> = {
  "KLUY-DEVICE-CLAIM-UNKNOWN": "no claim matches the presented token",
  "KLUY-DEVICE-CLAIM-REUSED": "claim token already redeemed; a token is single-use",
  "KLUY-DEVICE-CLAIM-REVOKED": "the claim was revoked",
  "KLUY-DEVICE-CLAIM-EXPIRED": "the claim expired between presentation and redemption",
  "KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED": "canonical payload digest mismatch",
  "KLUY-DEVICE-CLAIM-WRONG-DEVICE": "the claim was issued for another device",
  "KLUY-DEVICE-CLAIM-STATE": "the device is not in a claimable lifecycle state",
  "KLUY-DEVICE-CLAIM-TTL": "the claim lifetime was refused",
  "KLUY-DEVICE-QUARANTINED": "device quarantined; needs governed re-enrollment",
  "KLUY-DEVICE-TERMINAL": "device is in a terminal lifecycle state",
  "KLUY-DEVICE-EVIDENCE-COLLISION":
    "device shares hardware evidence with another non-retired device",
  "KLUY-DEVICE-MISSING": "no such device",
  "KLUY-DEVICE-GENERATION-UNKNOWN": "the assignment generation was not found",
  "KLUY-DEVICE-GENERATION-REVOKED": "the assignment generation was revoked",
  "KLUY-DEVICE-GENERATION-STALE": "the assignment generation was superseded",
  "KLUY-DEVICE-TERMINAL-WRONG-LOCATION": "the role could not be bound at this Location",
  "KLUY-TERMSESSION-RACE-LOST": "another device used that pairing code first",
};

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_LOG: SafeLogger = { info: () => undefined };

/**
 * Mirrored from `kitluy_devices.hub_claim_code_alphabet_v1()` as a TRANSPORT
 * guard only; the database remains authoritative (see the Hub composition).
 */
const TERMINAL_CODE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strings(value: unknown): readonly string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : null;
}

export interface TerminalPairingCompositionDeps {
  readonly source: ClientSource;
  readonly logger?: SafeLogger;
}

export class TerminalPairingComposition {
  private readonly logger: SafeLogger;

  constructor(private readonly deps: TerminalPairingCompositionDeps) {
    this.logger = deps.logger ?? NO_LOG;
  }

  /**
   * Present a code and, only on a match, consume it — which performs the
   * assignment inside the door. One transaction as
   * `kitluy_terminal_pairing_service`; the presentation takes `for update` on
   * the session, so two devices racing one code serialise.
   */
  async pair(input: {
    readonly deviceRecordId: string;
    readonly presentedCode: string;
    readonly actorRef: string;
  }): Promise<TerminalPairingCompositionResult<PairedTerminalMaterial>> {
    const correlationId = randomUUID();

    if (!UUID.test(input.deviceRecordId)) {
      return { result: "REQUEST_INVALID", correlationId, auditDetail: "malformed device id" };
    }
    const code = input.presentedCode.toUpperCase();
    if (!TERMINAL_CODE.test(code)) {
      // Refused as a CODE, never as a malformed request — see the Hub composition.
      return { result: "CODE_REFUSED", correlationId, auditDetail: "code failed transport shape" };
    }

    try {
      return await withServiceRole(
        this.deps.source,
        REGISTRY_ROLES.terminalPairing,
        async (client) => {
          const presented = await callDoor(
            client,
            "kitluy_devices.evaluate_terminal_pairing_session_v1($1, $2::uuid, $3)",
            [code, input.deviceRecordId, input.actorRef],
          );

          if (presented.outcome !== "MATCH_READY") {
            const refusalCode = String(presented.refusal_code ?? "");
            const audit = PRESENTATION_REFUSALS[refusalCode] ?? `unmapped refusal ${refusalCode}`;
            this.logger.info({
              event: "terminal-pairing-presentation-refused",
              correlationId,
              audit,
            });
            return {
              result: refusalCode === "KLUY-TERMSESSION-LOCKED" ? "LOCKED" : "CODE_REFUSED",
              correlationId,
              auditDetail: audit,
            };
          }

          // Every value below is a server row. A MATCH_READY missing any of
          // them means the door and this layer disagree; fail, never guess.
          const sessionId = str(presented.session_id);
          const tenantId = str(presented.tenant_id);
          const digitalStoreId = str(presented.digital_store_id);
          const storeLocationId = str(presented.store_location_id);
          const storeHubDeviceId = str(presented.store_hub_device_id);
          const physicalTerminalId = str(presented.physical_terminal_id);
          const label = str(presented.label);
          const keys = strings(presented.terminal_profile_keys);
          const vertical = str(presented.vertical);
          const environment = str(presented.environment);
          if (
            sessionId === null ||
            tenantId === null ||
            digitalStoreId === null ||
            storeLocationId === null ||
            storeHubDeviceId === null ||
            physicalTerminalId === null ||
            label === null ||
            keys === null ||
            vertical === null ||
            environment === null
          ) {
            return {
              result: "INTERNAL_ERROR",
              correlationId,
              auditDetail: "presentation matched but returned an incomplete context",
            };
          }

          const consumed = await callDoor(
            client,
            "kitluy_devices.consume_terminal_pairing_session_v1($1::uuid, $2::uuid, $3)",
            [sessionId, input.deviceRecordId, input.actorRef],
          );
          if (consumed.outcome !== "CONSUMED") {
            const refusalCode = String(consumed.refusal_code ?? "");
            // Roll back: `withServiceRole` rolls back on a throw, and a refused
            // consumption must leave nothing behind.
            throw new Error(refusalCode === "" ? "KLUY-TERMSESSION-UNKNOWN" : refusalCode);
          }
          const assignmentId = str(consumed.assignment_id);
          const generation = consumed.assignment_generation;
          const rawAssignments = consumed.terminal_assignments;
          if (
            assignmentId === null ||
            typeof generation !== "number" ||
            !Array.isArray(rawAssignments)
          ) {
            return {
              result: "INTERNAL_ERROR",
              correlationId,
              auditDetail: "consumption succeeded but returned no assignment",
            };
          }
          const terminalAssignments = rawAssignments.flatMap((entry) => {
            if (entry === null || typeof entry !== "object") return [];
            const rec = entry as Record<string, unknown>;
            const id = str(rec.terminal_assignment_id);
            const key = str(rec.terminal_profile_key);
            return id === null || key === null
              ? []
              : [{ terminalAssignmentId: id, terminalProfileKey: key }];
          });

          return {
            result: "PAIRED",
            correlationId,
            data: {
              deviceRecordId: input.deviceRecordId,
              sessionId,
              assignmentId,
              assignmentGeneration: generation,
              storeAssignment: "pending_trust",
              activated: false,
              context: {
                contextVersion:
                  str(presented.context_version) ?? "kitluy.terminal-pairing-context.v1",
                tenantId,
                tenantReference: str(presented.tenant_reference) ?? tenantId,
                digitalStoreId,
                digitalStoreReference: str(presented.digital_store_reference) ?? digitalStoreId,
                storeLocationId,
                storeLocationReference: str(presented.store_location_reference) ?? storeLocationId,
                storeHubDeviceId,
                storeHubReference: str(presented.store_hub_reference),
                physicalTerminalId,
                physicalTerminalLabel: label,
                terminalProfileKeys: keys,
                terminalAssignments,
                vertical,
                requiredAppFamily: null,
                releaseChannel: null,
                environment,
              },
            },
          };
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const conflict = Object.keys(ASSIGNMENT_CONFLICTS).find((c) => message.includes(c));
      if (conflict !== undefined) {
        this.logger.info({
          event: "terminal-pairing-already-assigned",
          correlationId,
          audit: ASSIGNMENT_CONFLICTS[conflict] ?? "unmapped",
        });
        return {
          result: "ALREADY_ASSIGNED",
          correlationId,
          auditDetail: ASSIGNMENT_CONFLICTS[conflict],
        };
      }
      const consumeRefusal = Object.keys(CONSUME_REFUSALS).find((c) => message.includes(c));
      if (consumeRefusal !== undefined) {
        this.logger.info({
          event: "terminal-pairing-consumption-refused",
          correlationId,
          audit: CONSUME_REFUSALS[consumeRefusal] ?? "unmapped",
        });
        return {
          result: "REDEMPTION_REFUSED",
          correlationId,
          auditDetail: CONSUME_REFUSALS[consumeRefusal],
        };
      }
      const matched = Object.keys(REDEMPTION_REFUSALS).find((c) => message.includes(c));
      if (matched !== undefined) {
        this.logger.info({
          event: "terminal-pairing-redemption-refused",
          correlationId,
          audit: REDEMPTION_REFUSALS[matched] ?? "unmapped",
        });
        return {
          result: "REDEMPTION_REFUSED",
          correlationId,
          auditDetail: REDEMPTION_REFUSALS[matched],
        };
      }
      this.logger.info({
        event: "terminal-pairing-failed",
        correlationId,
        audit: "unexpected error",
      });
      return { result: "INTERNAL_ERROR", correlationId, auditDetail: message };
    }
  }
}
