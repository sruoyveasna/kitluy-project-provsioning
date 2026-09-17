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
  IntakeCustomer,
  IntakeDraft,
  IntakeFailureKind,
  IntakeOperations,
  IntakeResult,
} from "../src/intake/ports.js";
import type { HubCall } from "./edge-operations-session.js";
import { pinnedHubRequest, type TransportCredentials } from "./lan-client.js";

const CUSTOMERS_PATH = "/edge/v1/customers";
const CUSTOMERS_SEARCH_PATH = "/edge/v1/customers/search";
const DRAFTS_PATH = "/edge/v1/laundry/bookings/drafts";
const SESSION_HEADER = "x-kitluy-session-id";

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
    result === "DRAFT_VERSION_STALE"
      ? "stale_version"
      : result === "SESSION_UNKNOWN" || result === "SESSION_EXPIRED" || result === "SESSION_CLOSED"
        ? "session_invalid"
        : result === "CUSTOMER_UNKNOWN" || result === "DRAFT_UNKNOWN"
          ? "not_found"
          : result.includes("IDEMPOTENCY") || result === "DRAFT_NOT_OPEN"
            ? "conflict"
            : result === "T1_NOT_AUTHORIZED" ||
                result === "SESSION_PERMISSION_DENIED" ||
                result === "STAFF_SCOPE_MISMATCH"
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
}): IntakeOperations {
  return createIntakeOperationsWithCall({
    sessionId: input.sessionId,
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
}): IntakeOperations {
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
  };
}
