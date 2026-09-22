/**
 * T1 intake LAN adapters — WS-12-T002-P02 §4.
 *
 * Concrete typed adapters for the eight T002 Edge routes over the SAME
 * pinned TLS 1.3 mTLS client the bootstrap uses. There is NO generic
 * renderer-controlled HTTP surface here: each function speaks exactly one
 * route with operation-specific input; the staff session id is attached by
 * THIS module (main process) as the `x-kitluy-session-id` header, and each
 * mutation mints its own Idempotency-Key.
 *
 * Governed Hub sentinels map onto the closed IntakeFailureKind vocabulary;
 * a transport failure is `unavailable` — explicitly DISTINCT from a
 * successful empty search (§6: never display unavailable as "no customer
 * found"). No raw SQLSTATE exists on this path end to end (the Hub's
 * public error envelope already forbids it).
 */
import { randomUUID } from "node:crypto";

import type {
  IntakeBookingSummary,
  IntakeConfirmation,
  IntakeCustomer,
  IntakeDraft,
  IntakeFailureKind,
  IntakeOperations,
  IntakeQuote,
  IntakeResult,
} from "../src/intake/ports.js";
import type { HubCall } from "./edge-operations-session.js";
import { pinnedHubRequest, type TransportCredentials } from "./lan-client.js";

const CUSTOMERS_PATH = "/edge/v1/customers";
const CUSTOMERS_SEARCH_PATH = "/edge/v1/customers/search";
const DRAFTS_PATH = "/edge/v1/laundry/bookings/drafts";
const BOOKINGS_PATH = "/edge/v1/laundry/bookings";
const BOOKINGS_RECENT_PATH = "/edge/v1/laundry/bookings/recent";
const SESSION_HEADER = "x-kitluy-session-id";

/**
 * The terminal's command keys — T1-REAL-OPERATIONS-001 slice 2.
 *
 * A Hub COMMAND (confirm-intake) is keyed `kl1.{terminal}.{sequence}` with a
 * client sequence the Hub verifies against its own record of this terminal
 * (offline contract §2/§4). The terminal never keeps that counter on its own:
 * it is seeded from the Hub's eligibility answer (`nextClientSequence`) and
 * advanced only when the Hub accepted or replayed the key — a refused command
 * rolls its reservation back and the SAME key serves the corrected attempt; a
 * lost answer is retried with the SAME key and the Hub replays the original
 * result. A sequence refusal (gap / replay) re-seeds from the Hub and retries
 * once. Nothing here is persisted on the terminal.
 */
export interface CommandSequence {
  /** The next canonical key for this terminal, or null when unknown. */
  nextKey(): Promise<string | null>;
  /** The Hub accepted or replayed `key`: the sequence moves on. */
  advance(key: string): void;
  /** The Hub refused the sequence: forget it and re-seed from Hub truth. */
  resync(): Promise<void>;
}

/** Key shape check (offline contract §2) — the Hub verifies the sequence. */
const CANONICAL_KEY =
  /^kl1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]{1,20}$/u;

/**
 * A `CommandSequence` over a Hub eligibility read: the seed is the Hub's
 * `nextClientSequence`, advanced locally per accepted command.
 */
export function createHubSeededCommandSequence(input: {
  readonly terminalDeviceId: () => string | null;
  readonly readNextClientSequence: () => Promise<string | null>;
}): CommandSequence {
  let next: bigint | null = null;
  return {
    async nextKey() {
      const terminal = input.terminalDeviceId();
      if (terminal === null) return null;
      if (next === null) {
        const seed = await input.readNextClientSequence();
        if (seed === null || !/^[0-9]{1,20}$/u.test(seed)) return null;
        next = BigInt(seed);
      }
      const key = `kl1.${terminal.toLowerCase()}.${next.toString()}`;
      return CANONICAL_KEY.test(key) ? key : null;
    },
    advance(key) {
      const sequence = key.split(".")[2];
      if (sequence === undefined || next === null) return;
      const used = BigInt(sequence);
      if (used >= next) next = used + 1n;
    },
    async resync() {
      next = null;
    },
  };
}

interface IntakeEndpoint {
  readonly hostname: string;
  readonly port: number;
  readonly pinnedCertificateFingerprint: string;
}

function failureOf(
  status: number,
  body: unknown,
): {
  readonly kind: IntakeFailureKind;
  readonly detail: string;
} {
  const envelope = body as {
    readonly error?: { readonly details?: { readonly result?: string } };
  } | null;
  const result = envelope?.error?.details?.result ?? `HTTP_${status}`;
  const kind: IntakeFailureKind =
    result === "DRAFT_VERSION_STALE" || result === "EDGE_AGGREGATE_VERSION_CONFLICT"
      ? "stale_version"
      : result === "SESSION_UNKNOWN" ||
          result === "SESSION_EXPIRED" ||
          result === "SESSION_CLOSED" ||
          result === "EDGE_SESSION_INVALID" ||
          result === "EDGE_SESSION_EXPIRED"
        ? "session_invalid"
        : result === "CUSTOMER_UNKNOWN" || result === "DRAFT_UNKNOWN"
          ? "not_found"
          : result === "PRICE_MISMATCH"
            ? "price_mismatch"
            : result === "TENDER_INSUFFICIENT"
              ? "tender_insufficient"
              : result === "CONFIGURATION_MISSING" ||
                  result === "CATALOG_NOT_DELIVERED" ||
                  result === "MONEY_CONTRACT_MISSING" ||
                  result === "FX_RATE_UNAVAILABLE" ||
                  result === "WEIGHT_RULE_MISSING" ||
                  result === "CURRENCY_MISMATCH" ||
                  result === "MONEY_ROUNDING_UNKNOWN"
                ? "configuration_missing"
                : result.includes("IDEMPOTENCY") ||
                    result.includes("SEQUENCE") ||
                    result === "DRAFT_NOT_OPEN"
                  ? "conflict"
                  : result === "T1_NOT_AUTHORIZED" ||
                      result === "SESSION_PERMISSION_DENIED" ||
                      result === "STAFF_SCOPE_MISMATCH" ||
                      result.startsWith("EDGE_PERMISSION") ||
                      result.startsWith("EDGE_PROFILE") ||
                      result.startsWith("EDGE_DEVICE") ||
                      result.startsWith("EDGE_RESOURCE") ||
                      result.startsWith("EDGE_ASSIGNMENT")
                    ? "permission_denied"
                    : status === 422
                      ? "invalid_input"
                      : "unavailable";
  return { kind, detail: result };
}

/**
 * Build the complete typed intake surface for ONE authenticated runtime:
 * a verified pinned endpoint, this terminal's transport credentials and
 * the CURRENT staff session id (all main-process state — the renderer
 * supplies none of them).
 */
export function createIntakeOperations(input: {
  readonly endpoint: IntakeEndpoint;
  readonly credentials: TransportCredentials;
  readonly sessionId: string;
  readonly commandSequence?: CommandSequence;
}): IntakeOperations {
  return createIntakeOperationsWithCall({
    sessionId: input.sessionId,
    ...(input.commandSequence === undefined ? {} : { commandSequence: input.commandSequence }),
    call: (method, path, body, headers) =>
      pinnedHubRequest({
        hostname: input.endpoint.hostname,
        port: input.endpoint.port,
        method,
        path,
        pinnedCertificateFingerprint: input.endpoint.pinnedCertificateFingerprint,
        credentials: input.credentials,
        ...(body === undefined ? {} : { body }),
        ...(headers === undefined ? {} : { headers }),
      }),
  });
}

/**
 * The same eight adapters over ANY Hub call — the Pi Terminal composition
 * passes a call through the root edge bridge (T1-STORE-OPERATIONS-001), so
 * the route set, the session header and the idempotency discipline are this
 * one implementation for both.
 */
export function createIntakeOperationsWithCall(input: {
  readonly call: HubCall;
  readonly sessionId: string;
  /** Absent → confirm-intake answers `unavailable` (no command key can be minted). */
  readonly commandSequence?: CommandSequence;
}): IntakeOperations {
  /** The key held for a confirm whose answer was lost, per draft. */
  const pendingConfirmKeys = new Map<string, string>();

  async function call<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body: Record<string, unknown> | undefined,
    withIdempotency: boolean,
    pick: (responseBody: Record<string, unknown>) => T,
  ): Promise<IntakeResult<T>> {
    let response: { status: number; body: unknown };
    try {
      response = await input.call(method, path, body, {
        [SESSION_HEADER]: input.sessionId,
        ...(withIdempotency ? { "idempotency-key": `t1i-${randomUUID()}` } : {}),
      });
    } catch (error) {
      return {
        ok: false,
        kind: "unavailable",
        detail: error instanceof Error ? error.message : "the Hub is unreachable",
      };
    }
    if (response.status !== 200) {
      const failure = failureOf(response.status, response.body);
      return { ok: false, ...failure };
    }
    return { ok: true, value: pick(response.body as Record<string, unknown>) };
  }

  return {
    searchCustomers: (phone) =>
      call(
        "GET",
        `${CUSTOMERS_SEARCH_PATH}?phone=${encodeURIComponent(phone)}`,
        undefined,
        false,
        (b) => b["matches"] as readonly IntakeCustomer[],
      ),
    readCustomer: (customerId) =>
      call(
        "GET",
        `${CUSTOMERS_PATH}/${customerId}`,
        undefined,
        false,
        (b) => b["customer"] as IntakeCustomer,
      ),
    createCustomer: (request) =>
      call(
        "POST",
        CUSTOMERS_PATH,
        {
          displayName: request.displayName,
          ...(request.phone === null ? {} : { phone: request.phone }),
          preferredLanguage: request.preferredLanguage,
        },
        true,
        (b) => b["customer"] as IntakeCustomer,
      ),
    recordConsentDecision: (request) =>
      call(
        "POST",
        `${CUSTOMERS_PATH}/${request.customerId}/consent-decisions`,
        {
          purposeKey: request.purposeKey,
          policyRef: request.policyRef,
          policyVersion: request.policyVersion,
          decision: request.decision,
          channel: "t1_terminal",
          staffAssisted: request.staffAssisted,
        },
        true,
        (b) => ({
          decisionId: String(b["decisionId"]),
          recordedAt: String(b["recordedAt"]),
        }),
      ),
    createDraft: (request) =>
      call(
        "POST",
        DRAFTS_PATH,
        {
          ...(request.walkIn ? { walkIn: true } : { customerId: request.customerId }),
          preferredLanguage: request.preferredLanguage,
          intakeSource: "t1_walkup",
          customerNotes: request.customerNotes,
          staffNotes: request.staffNotes,
        },
        true,
        (b) => b["draft"] as IntakeDraft,
      ),
    readDraft: (draftId) =>
      call("GET", `${DRAFTS_PATH}/${draftId}`, undefined, false, (b) => b["draft"] as IntakeDraft),
    updateDraft: (request) =>
      call(
        "PATCH",
        `${DRAFTS_PATH}/${request.draftId}`,
        {
          expectedVersion: request.expectedVersion,
          ...(request.customerNotes === undefined ? {} : { customerNotes: request.customerNotes }),
          ...(request.staffNotes === undefined ? {} : { staffNotes: request.staffNotes }),
          ...(request.preferredLanguage === undefined
            ? {}
            : { preferredLanguage: request.preferredLanguage }),
        },
        true,
        (b) => b["draft"] as IntakeDraft,
      ),
    cancelDraft: (request) =>
      call(
        "POST",
        `${DRAFTS_PATH}/${request.draftId}/cancel`,
        { reasonCode: request.reasonCode },
        true,
        (b) => b["draft"] as IntakeDraft,
      ),
    quote: (request) =>
      call(
        "POST",
        `${DRAFTS_PATH}/${request.draftId}/quote`,
        { lines: request.lines, express: request.express },
        false,
        (b) => b["quote"] as IntakeQuote,
      ),
    listRecentBookings: () =>
      call(
        "GET",
        BOOKINGS_RECENT_PATH,
        undefined,
        false,
        (b) => b["bookings"] as readonly IntakeBookingSummary[],
      ),
    confirmIntake: async (request) => {
      const sequence = input.commandSequence;
      if (sequence === undefined) {
        return {
          ok: false,
          kind: "unavailable",
          detail: "this composition holds no command sequence; confirm-intake is not available",
        };
      }
      const body = {
        expectedVersion: request.expectedVersion,
        lines: request.lines,
        express: request.express,
        displayedTotalMinor: request.displayedTotalMinor,
        tender: {
          type: "cash",
          localMinor: request.tender.localMinor,
          usdCents: request.tender.usdCents,
        },
      };
      const path = `${BOOKINGS_PATH}/${request.draftId}/confirm-intake`;
      // The same key after a lost answer: the Hub replays, never books twice.
      let key = pendingConfirmKeys.get(request.draftId) ?? (await sequence.nextKey());
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (key === null) {
          return {
            ok: false,
            kind: "unavailable",
            detail: "the terminal has not learned its command sequence from the Store Hub",
          };
        }
        pendingConfirmKeys.set(request.draftId, key);
        let response: { status: number; body: unknown };
        try {
          response = await input.call("POST", path, body, {
            [SESSION_HEADER]: input.sessionId,
            "idempotency-key": key,
          });
        } catch (error) {
          // The answer is lost: keep THIS draft's key so the next attempt
          // replays it, and forget the local counter so any OTHER draft mints
          // its key from the Hub's record (which may or may not include this
          // one) instead of colliding with it.
          await sequence.resync();
          return {
            ok: false,
            kind: "unavailable",
            detail: error instanceof Error ? error.message : "the Hub is unreachable",
          };
        }
        if (response.status === 200) {
          pendingConfirmKeys.delete(request.draftId);
          sequence.advance(key);
          const answer = response.body as Record<string, unknown>;
          return {
            ok: true,
            value: {
              outcome: answer["result"] === "BOOKING_CONFIRMED_REPLAYED" ? "replayed" : "confirmed",
              booking: answer["booking"],
              lines: answer["lines"],
              payment: answer["payment"],
              receipt: answer["receipt"],
              draft: answer["draft"],
            } as IntakeConfirmation,
          };
        }
        const failure = failureOf(response.status, response.body);
        if (
          attempt === 0 &&
          (failure.detail === "EDGE_SEQUENCE_GAP" ||
            failure.detail === "EDGE_SEQUENCE_REPLAY_REJECTED")
        ) {
          // The Hub's record of this terminal moved (or ours was stale):
          // nothing was written; re-seed from the Hub and try once more.
          pendingConfirmKeys.delete(request.draftId);
          await sequence.resync();
          key = await sequence.nextKey();
          continue;
        }
        if (failure.detail === "BOOKING_CONFIRM_IN_PROGRESS" || response.status === 202) {
          // A concurrent attempt holds the reservation: keep the key, report.
          return { ok: false, kind: "conflict", detail: "BOOKING_CONFIRM_IN_PROGRESS" };
        }
        // A governed refusal rolled the reservation back (nothing written, the
        // sequence not spent): the pending key is released and the next
        // attempt mints again — from the Hub's record if the key was reserved
        // by something else in the meantime.
        pendingConfirmKeys.delete(request.draftId);
        if (failure.detail.includes("IDEMPOTENCY")) await sequence.resync();
        return { ok: false, ...failure };
      }
      return {
        ok: false,
        kind: "unavailable",
        detail: "the command sequence could not be re-seeded",
      };
    },
  };
}
