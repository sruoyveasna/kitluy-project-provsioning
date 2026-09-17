/**
 * The Edge Operations session surface, over ANY Hub call — WS-12-T001-P02,
 * shared by T1-STORE-OPERATIONS-001.
 *
 * One implementation of the six bootstrap/session routes, parameterised by how a
 * request reaches the Hub: the WS-12-T001 composition passes a pinned mutual-TLS
 * call that holds the terminal key itself; the Pi Terminal composition passes a
 * call through the root edge bridge. The route paths, idempotency-key rules and
 * refusal classification are therefore identical by construction, not by review.
 */
import { randomUUID } from "node:crypto";

import type { AuthorityTimeResponse } from "../src/bootstrap/hub-time.js";
import type {
  ConfigurationDeliveryWire,
  EdgeOperationsSession,
  EdgeReadRefusal,
  RuntimeEligibilityWire,
  StaffSessionWire,
} from "../src/bootstrap/ports.js";

export const AUTHORITY_TIME_PATH = "/edge/v1/runtime/authority-time";
export const ELIGIBILITY_PATH = "/edge/v1/runtime/eligibility";
export const CONFIGURATION_PATH = "/edge/v1/configuration/current";
export const SESSIONS_OPEN_PATH = "/edge/v1/sessions/open";
export const SESSIONS_REFRESH_PATH = "/edge/v1/sessions/refresh";
export const SESSIONS_CLOSE_PATH = "/edge/v1/sessions/close";

/** One Hub request. A transport failure THROWS; any HTTP answer resolves. */
export type HubCall = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
) => Promise<{ readonly status: number; readonly body: unknown }>;

export function refusalFrom(status: number, body: unknown): EdgeReadRefusal {
  const envelope = body as {
    readonly error?: {
      readonly message?: string;
      readonly details?: { readonly result?: string; readonly retryable?: boolean };
    };
  } | null;
  return {
    outcome: "refused",
    result: envelope?.error?.details?.result ?? `HTTP_${status}`,
    retryable: envelope?.error?.details?.retryable ?? false,
    detail: envelope?.error?.message ?? `the Hub answered ${status}`,
  };
}

export function createEdgeOperationsSession(call: HubCall): EdgeOperationsSession {
  return {
    async fetchAuthorityTime() {
      const response = await call("GET", AUTHORITY_TIME_PATH);
      if (response.status !== 200) return refusalFrom(response.status, response.body);
      return response.body as AuthorityTimeResponse;
    },
    async fetchEligibility() {
      const response = await call("GET", ELIGIBILITY_PATH);
      if (response.status !== 200) return refusalFrom(response.status, response.body);
      const body = response.body as { readonly eligibility: RuntimeEligibilityWire };
      return { outcome: "eligible" as const, eligibility: body.eligibility };
    },
    async fetchConfigurationDelivery() {
      const response = await call("GET", CONFIGURATION_PATH);
      if (response.status !== 200) return refusalFrom(response.status, response.body);
      return {
        outcome: "delivery" as const,
        wire: response.body as ConfigurationDeliveryWire,
      };
    },
    async openStaffSession(input) {
      // One key per LOGICAL open attempt, minted once so a transport retry
      // replays the same request. Never the wall clock — the runtime reads no
      // wall clock (owner decision §1).
      const response = await call("POST", SESSIONS_OPEN_PATH, input, {
        "idempotency-key": `t1-open-${input.actorId}-${randomUUID()}`,
      });
      if (response.status !== 200) return refusalFrom(response.status, response.body);
      const body = response.body as { readonly session: StaffSessionWire };
      return { outcome: "ok" as const, session: body.session };
    },
    async refreshStaffSession(sessionId) {
      const response = await call(
        "POST",
        SESSIONS_REFRESH_PATH,
        { sessionId },
        { "idempotency-key": `t1-refresh-${sessionId}` },
      );
      if (response.status !== 200) return refusalFrom(response.status, response.body);
      const body = response.body as { readonly session: StaffSessionWire };
      return { outcome: "ok" as const, session: body.session };
    },
    async closeStaffSession(sessionId) {
      const response = await call(
        "POST",
        SESSIONS_CLOSE_PATH,
        { sessionId },
        { "idempotency-key": `t1-close-${sessionId}` },
      );
      if (response.status !== 200) return refusalFrom(response.status, response.body);
      const body = response.body as { readonly session: StaffSessionWire };
      return { outcome: "ok" as const, session: body.session };
    },
  };
}
