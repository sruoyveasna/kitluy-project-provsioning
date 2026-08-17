/**
 * Store Hub pairing composition — the cloud half of "type the code".
 *
 * Authority: KLD-2026-08-13-HUB-CLAIM-PRESENTATION-001 (group 0191, the
 * presentation door); pairing protocol §6.1; KLSRC-0162 §12; migration group
 * 0192 (this composition's least-privilege identity); group 0121 (the claim and
 * assignment model, and the redemption door).
 *
 * ===========================================================================
 * WHY THIS LAYER EXISTS AT ALL
 * ===========================================================================
 * `redeem_device_claim_v1` cannot be called by a device. It is granted to
 * `service_role` and, since group 0192, to `kitluy_hub_pairing_service` — never
 * to `anon`. So a Store Hub physically cannot redeem its own claim, and a cloud
 * route is mandatory rather than a convenience.
 *
 * The route also cannot simply forward the code and trust the answer, because
 * pairing is TWO governed steps that must happen in the right order:
 *
 *   1. PRESENTATION (`evaluate_hub_claim_code_v1`) — owns the five-attempt
 *      budget, the format rule, the fifteen-minute expiry and the lockout
 *      security event. It consumes nothing.
 *   2. REDEMPTION (`redeem_device_claim_v1`) — owns single-use, and re-checks
 *      everything under its own lock.
 *
 * Skipping step 1 would hand an attacker unlimited guesses at an eight-character
 * code, because redemption has no attempt budget. Doing step 2 without step 1
 * having answered MATCH_READY is therefore not an optimisation; it is the whole
 * vulnerability.
 *
 * ===========================================================================
 * WHY THE PAYLOAD DIGEST IS BUILT HERE AND NEVER ACCEPTED FROM THE CALLER
 * ===========================================================================
 * Redemption compares a presented `payload_sha256` against the one the issuer
 * stored, which is what binds a claim to its device and scope — "a captured
 * token cannot be replayed against a different Tenant, Digital Store or
 * Location". If this layer accepted that digest from the device, the binding
 * would verify the caller against itself and protect nothing.
 *
 * So the digest is composed HERE, from `@kitluy/device-identity`'s
 * `hubClaimPayloadBytes` over the scope the PRESENTATION DOOR returned — server
 * rows, never caller input. The device supplies exactly two things: which device
 * it claims to be, and the code an operator typed.
 *
 * ===========================================================================
 * WHERE PAIRING STOPS
 * ===========================================================================
 * At `pending_trust`, deliberately. Group 0121's redemption leaves the device at
 * `awaiting_trust` because activation is certificate-backed and gated on
 * **BLK-005**. This layer reports the assignment truthfully and never implies
 * the device is active — a surface that said "ready" here would be lying about
 * a device that cannot yet serve a terminal.
 */
import { createHash, randomUUID } from "node:crypto";

import { hubClaimPayloadBytes } from "@kitluy/device-identity";
import type pg from "pg";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";
import type { SafeLogger } from "./provisioning-composition.js";

/**
 * External result vocabulary. Deliberately COARSER than the doors', for the
 * reason `enrollment-composition.ts` records: the difference between "no code
 * was ever issued for this device" and "the code you typed is wrong" tells a
 * guesser whether it has the right device id, and it must not reach the wire.
 *
 * `PAIRED` and `CODE_REFUSED` are the only two outcomes a well-formed request
 * can normally produce. `LOCKED` is separated from `CODE_REFUSED` on purpose:
 * an operator standing at a Hub needs to be told to fetch a NEW code rather than
 * keep typing, and that instruction is useless if it is indistinguishable from
 * "try again".
 */
export type HubPairingResultCode =
  | "PAIRED"
  /** Wrong, malformed, expired, or nothing outstanding. All collapsed. */
  | "CODE_REFUSED"
  /** The attempt budget is spent. Actionable: get a new code. */
  | "LOCKED"
  /** Presentation matched but redemption refused — a genuine race or state change. */
  | "REDEMPTION_REFUSED"
  | "REQUEST_INVALID"
  | "INTERNAL_ERROR";

export interface HubPairingCompositionResult<T = undefined> {
  readonly result: HubPairingResultCode;
  readonly correlationId: string;
  readonly data?: T;
  /** Specific internal cause. Logged, NEVER returned to the caller. */
  readonly auditDetail?: string;
}

/**
 * What a paired Hub is told. Everything here is server-derived.
 *
 * `storeAssignment` is `"pending_trust"` and not a friendlier word, because that
 * is the actual state and the CLI renders it to a human who may later have to
 * describe it during support.
 */
export interface PairedHubMaterial {
  readonly deviceRecordId: string;
  readonly assignmentId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly storeAssignment: "pending_trust";
  /** True to the model: pairing does NOT activate. See the header. */
  readonly activated: false;
}

/**
 * Session presentation refusals from 0194, mapped TOTALLY.
 *
 * The value is the audit string, not a distinguishing outcome. Only
 * `KLUY-HUBSESSION-LOCKED` earns its own external code, because it is the one
 * refusal where the correct operator action differs — everything else means
 * "type it again or ask for a new one", and telling the two apart at the console
 * would tell a guesser whether a code exists.
 */
const PRESENTATION_REFUSALS: Readonly<Record<string, string>> = {
  "KLUY-HUBSESSION-NO-DEVICE": "presentation named no device",
  "KLUY-HUBSESSION-INVALID": "wrong or malformed code, or no such session",
  "KLUY-HUBSESSION-DEVICE-INELIGIBLE": "the code was right but this Hub cannot be paired",
  // `KLUY-HUBSESSION-<STATE>`, built by the door from a non-open session's state.
  // The states are open/consumed/expired/revoked/locked, so these are the four a
  // presentation can meet.
  "KLUY-HUBSESSION-CONSUMED": "that pairing code has already been used",
  "KLUY-HUBSESSION-REVOKED": "that pairing code was replaced by a newer one",
  "KLUY-HUBSESSION-EXPIRED": "the pairing code expired",
  "KLUY-HUBSESSION-LOCKED": "attempt budget exhausted",
};

/**
 * 0121 redemption refusals, mapped TOTALLY.
 *
 * Unlike the presentation door, `redeem_device_claim_v1` returns a bare `uuid`
 * and signals every refusal by RAISING. So these are matched against an error
 * message, and the map exists so a SQLSTATE, function name or row identity can
 * never reach a pre-credential caller.
 *
 * Reaching any of these means presentation said MATCH_READY and redemption then
 * disagreed — a genuine race or a state change in between, never a wrong code.
 */
const REDEMPTION_REFUSALS: Readonly<Record<string, string>> = {
  "KLUY-DEVICE-CLAIM-UNKNOWN": "no claim matches the presented token",
  "KLUY-DEVICE-CLAIM-REUSED": "claim token already redeemed; a token is single-use",
  "KLUY-DEVICE-CLAIM-REVOKED": "the claim was revoked",
  "KLUY-DEVICE-CLAIM-EXPIRED": "the claim expired between presentation and redemption",
  "KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED": "canonical payload digest mismatch",
  "KLUY-DEVICE-CLAIM-WRONG-DEVICE": "the claim was issued for another device",
  "KLUY-DEVICE-QUARANTINED": "device quarantined; needs governed re-enrollment",
  "KLUY-DEVICE-TERMINAL": "device is in a terminal lifecycle state",
  "KLUY-DEVICE-EVIDENCE-COLLISION":
    "device shares hardware evidence with another non-retired device",
  "KLUY-DEVICE-ALREADY-CLAIMED": "the device already holds a live assignment",
  "KLUY-DEVICE-MISSING": "no such device",
  // Raised by this composition, not by a door: another Hub consumed the session
  // between our match and our consume. Mapped here so it is answered as an
  // ordinary refusal rather than surfacing as an internal error.
  "KLUY-HUBSESSION-RACE-LOST": "another Store Hub used that pairing code first",
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
 * The canonical code alphabet, mirrored from
 * `kitluy_devices.hub_claim_code_alphabet_v1()` (Crockford Base32 without
 * I, L, O or U).
 *
 * Mirrored rather than queried because this check is a TRANSPORT guard: it
 * rejects a body that cannot possibly be a code before any database work, and a
 * round trip to learn the alphabet would defeat that. The database remains
 * authoritative — a value that passes here is still evaluated by 0191, which
 * would refuse it — so the two can only ever disagree by this being STRICTER,
 * never by admitting something the door would reject.
 */
const HUB_CODE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/**
 * The life of the device-bound claim this composition mints on a match.
 *
 * It is created and redeemed inside ONE transaction, so this is not a window an
 * operator ever waits in — it exists only because `issue_hub_claim_v1` requires a
 * TTL and `device_claims_ttl_chk` caps it at fifteen minutes. The session's own
 * expiry, already checked by the door above, is the deadline that governs pairing.
 */
const HUB_CLAIM_TTL_SECONDS = 900;

export interface HubPairingCompositionDeps {
  readonly source: ClientSource;
  readonly logger?: SafeLogger;
}

export class HubPairingComposition {
  private readonly logger: SafeLogger;

  constructor(private readonly deps: HubPairingCompositionDeps) {
    this.logger = deps.logger ?? NO_LOG;
  }

  /**
   * Present a code and, only on a match, redeem it.
   *
   * Both doors run in ONE transaction as `kitluy_hub_pairing_service`. That is
   * not merely tidy: presentation takes `for update` on the claim, so holding
   * the transaction open means no second caller can present or redeem the same
   * claim in the window between our match and our redemption. Two Hubs racing
   * the same code therefore serialise instead of both believing they won.
   *
   * `presentedCode` is normalised only by upper-casing, matching
   * `normalize_hub_claim_code_v1`. Nothing is trimmed and no ambiguous character
   * is aliased — a code needing repair is a code the operator did not type.
   */
  async pair(input: {
    readonly deviceRecordId: string;
    readonly presentedCode: string;
    readonly actorRef: string;
  }): Promise<HubPairingCompositionResult<PairedHubMaterial>> {
    const correlationId = randomUUID();

    if (!UUID.test(input.deviceRecordId)) {
      return { result: "REQUEST_INVALID", correlationId, auditDetail: "malformed device id" };
    }
    const code = input.presentedCode.toUpperCase();
    if (!HUB_CODE.test(code)) {
      // Refused as a CODE, not as a malformed request: a caller must not be able
      // to distinguish "that is not code-shaped" from "that code is wrong",
      // which would let it probe the alphabet for free and without spending an
      // attempt. 0191 counts an attempt for exactly this input, so answering
      // REQUEST_INVALID here would also be a cheaper channel than the door.
      return { result: "CODE_REFUSED", correlationId, auditDetail: "code failed transport shape" };
    }

    try {
      return await withServiceRole(this.deps.source, REGISTRY_ROLES.hubPairing, async (client) => {
        // Resolution is by CODE ALONE — the session is store-scoped and does not
        // know which Hub will use it. The device id still goes in, because the
        // door checks THIS Hub's eligibility before answering MATCH_READY.
        const presented = await callDoor(
          client,
          "kitluy_devices.evaluate_hub_pairing_session_v1($1, $2::uuid, $3)",
          [code, input.deviceRecordId, input.actorRef],
        );

        const outcome = presented.outcome;
        if (outcome !== "MATCH_READY") {
          const refusalCode = String(presented.refusal_code ?? "");
          const audit = PRESENTATION_REFUSALS[refusalCode] ?? `unmapped refusal ${refusalCode}`;
          this.logger.info({ event: "hub-pairing-presentation-refused", correlationId, audit });
          return {
            result: refusalCode === "KLUY-HUBSESSION-LOCKED" ? "LOCKED" : "CODE_REFUSED",
            correlationId,
            auditDetail: audit,
          };
        }

        // The scope comes from the DOOR, never from the caller. See the header.
        const sessionId = presented.session_id;
        const tenantId = presented.tenant_id;
        const digitalStoreId = presented.digital_store_id;
        const storeLocationId = presented.store_location_id;
        if (
          typeof sessionId !== "string" ||
          typeof tenantId !== "string" ||
          typeof digitalStoreId !== "string" ||
          typeof storeLocationId !== "string"
        ) {
          // A MATCH_READY without its scope means the door and this layer
          // disagree about the contract. Fail rather than guess: a fabricated
          // scope would compose a digest that redemption must reject anyway.
          return {
            result: "INTERNAL_ERROR",
            correlationId,
            auditDetail: "presentation matched but returned no usable scope",
          };
        }

        // Device + scope, and deliberately nothing server-derived: the issuer has
        // to be able to compute this same digest BEFORE the claim row exists.
        // See `hub-claim-payload.ts` on why the expiry is not in here.
        const payloadSha256 = createHash("sha256")
          .update(
            hubClaimPayloadBytes({
              deviceRecordId: input.deviceRecordId,
              tenantId,
              digitalStoreId,
              storeLocationId,
            }),
          )
          .digest("hex");

        // The claim token digest is the digest of the NORMALISED code. Computed
        // here and never logged.
        const claimTokenSha256 = createHash("sha256").update(code, "utf8").digest("hex");

        // ===================================================================
        // THE DEVICE BINDING IS CREATED HERE, AND THIS IS THE ONLY PLACE IT CAN BE
        // ===================================================================
        // A session belongs to a Store, so no claim existed until now. Group 0194
        // deliberately did NOT relax `device_claims.device_id NOT NULL` — the
        // canonical payload binds device + scope, 0191's attempt budget counts
        // against a claim resolved via its device, and redemption refuses a
        // mismatch with KLUY-DEVICE-CLAIM-WRONG-DEVICE. All three survive because
        // the claim is minted for THIS Hub, at the first moment its identity is
        // honestly known, and redeemed immediately.
        //
        // 0194 grants `issue_hub_claim_v1` to this role for exactly this step.
        // Same transaction as the presentation, so a claim can never be left
        // behind by a redemption that fails after it.
        await client.query(
          `select kitluy_devices.issue_hub_claim_v1(
                    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7::integer, $8)`,
          [
            input.deviceRecordId,
            tenantId,
            digitalStoreId,
            storeLocationId,
            claimTokenSha256,
            payloadSha256,
            HUB_CLAIM_TTL_SECONDS,
            input.actorRef,
          ],
        );

        // `redeem_hub_claim_v1`, NOT `redeem_device_claim_v1` directly.
        //
        // The 0121 door is not a SECURITY DEFINER: it runs as its caller and
        // writes three tables, so it only works for someone holding those table
        // privileges. This composition deliberately holds none, so group 0192
        // provides a definer bridge granted to this role alone. Calling 0121
        // directly here fails on its first write — which is exactly what the
        // integration suite caught.
        //
        // Redemption returns a bare `uuid` and RAISES on every refusal, so there
        // is no result object to inspect: a throw is handled by the outer catch,
        // which maps it through REDEMPTION_REFUSALS.
        const { rows } = await client.query<{ assignment_id: string | null }>(
          "select kitluy_devices.redeem_hub_claim_v1($1, $2, $3::uuid, $4) as assignment_id",
          [claimTokenSha256, payloadSha256, input.deviceRecordId, input.actorRef],
        );

        const assignmentId = rows[0]?.assignment_id;
        if (typeof assignmentId !== "string") {
          // Neither an assignment nor a raise. The door's contract says this
          // cannot happen; treated as internal rather than as a code refusal so
          // it is never mistaken for the operator having typed something wrong.
          return {
            result: "INTERNAL_ERROR",
            correlationId,
            auditDetail: "redemption returned no assignment id and raised nothing",
          };
        }

        // Spend the session, LAST — after the assignment exists.
        //
        // `consume_hub_pairing_session_v1` updates conditional on `state='open'`
        // and returns whether it won. Two Hubs presenting the same code serialise
        // on this row, so exactly one can pair; the loser is refused rather than
        // quietly producing a second assignment.
        //
        // Consuming BEFORE redemption would be worse in both directions: a failed
        // redemption would burn a code the operator still needs, and a crash
        // between the two would leave a Store unable to pair with a code that
        // still looks live.
        const { rows: consumed } = await client.query<{ won: boolean }>(
          "select kitluy_devices.consume_hub_pairing_session_v1($1::uuid, $2::uuid) as won",
          [sessionId, input.deviceRecordId],
        );
        if (consumed[0]?.won !== true) {
          // Another Hub took this session between our match and here. Roll the
          // whole transaction back rather than keep an assignment nobody
          // authorised — `withServiceRole` rolls back on a throw.
          throw new Error("KLUY-HUBSESSION-RACE-LOST");
        }

        return {
          result: "PAIRED",
          correlationId,
          data: {
            deviceRecordId: input.deviceRecordId,
            assignmentId,
            tenantId,
            digitalStoreId,
            storeLocationId,
            storeAssignment: "pending_trust",
            activated: false,
          },
        };
      });
    } catch (error) {
      // A governed door RAISES for refusals 0121 models as exceptions. Those are
      // mapped, not leaked: a SQLSTATE, function name or role name reaching a
      // pre-credential caller would describe the schema to it.
      const message = error instanceof Error ? error.message : String(error);
      const matched = Object.keys(REDEMPTION_REFUSALS).find((c) => message.includes(c));
      if (matched !== undefined) {
        this.logger.info({
          event: "hub-pairing-redemption-refused",
          correlationId,
          audit: REDEMPTION_REFUSALS[matched] ?? "unmapped",
        });
        return {
          result: "REDEMPTION_REFUSED",
          correlationId,
          auditDetail: REDEMPTION_REFUSALS[matched],
        };
      }
      this.logger.info({ event: "hub-pairing-failed", correlationId, audit: "unexpected error" });
      return { result: "INTERNAL_ERROR", correlationId, auditDetail: message };
    }
  }
}
