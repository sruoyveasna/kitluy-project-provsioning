/**
 * The Terminal PIN routes, over the edge bridge — TERMINAL-PIN-AND-REAL-POS-AUTH-001.
 *
 * Five named calls (KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10-§15;
 * KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001). A PIN crosses this file
 * exactly once, on its way to the Store Hub, and is never logged or kept. The
 * Hub verifies; this only carries.
 */
import { randomUUID } from "node:crypto";

import type { StaffSessionWire } from "../src/bootstrap/ports.js";
import type { TerminalPinSummary } from "../src/bootstrap/states.js";
import { refusalFrom, type HubCall } from "./edge-operations-session.js";

export const TERMINAL_PIN_STATUS_PATH = "/edge/v1/terminal-pin/status";
export const TERMINAL_PIN_SETUP_PATH = "/edge/v1/terminal-pin/setup";
export const TERMINAL_PIN_UNLOCK_PATH = "/edge/v1/terminal-pin/unlock";
export const TERMINAL_PIN_CHANGE_PATH = "/edge/v1/terminal-pin/change";
export const TERMINAL_PIN_LOCK_PATH = "/edge/v1/terminal-pin/lock";
/** The Hub reads the session id from this header on the status route. */
export const SESSION_HEADER = "x-kitluy-session-id";

/** The Hub's PIN state, as its routes answer it (never a PIN). */
export interface TerminalPinStatusWire {
  readonly state: "setup_required" | "set" | "reset_required";
  readonly pinVersion: number;
  readonly setAt: string | null;
  readonly lockedUntil: string | null;
  readonly attemptsBeforeLock: number;
}

export interface TerminalPinSessionWire extends StaffSessionWire {
  readonly credentialKind: "terminal_pin";
}

export type TerminalPinRefusal = {
  readonly outcome: "refused";
  readonly result: string;
  readonly retryable: boolean;
  readonly detail: string;
  /** The PIN's public posture after the refusal, when the Hub gave one. */
  readonly pin?: TerminalPinSummary;
};

export type TerminalPinSessionAnswer =
  | {
      readonly outcome: "ok";
      readonly result: string;
      readonly session: TerminalPinSessionWire;
      readonly pin: TerminalPinSummary;
    }
  | TerminalPinRefusal;

export interface TerminalPinClient {
  status(sessionId: string | null): Promise<
    | {
        readonly outcome: "ok";
        readonly pin: TerminalPinSummary;
        readonly session: { readonly state: "open" | "closed" | "expired" | "unknown" } | null;
      }
    | TerminalPinRefusal
  >;
  setup(input: {
    readonly pin: string;
    readonly pinConfirmation: string;
  }): Promise<TerminalPinSessionAnswer>;
  unlock(input: { readonly pin: string }): Promise<TerminalPinSessionAnswer>;
  change(input: {
    readonly currentPin: string;
    readonly newPin: string;
    readonly newPinConfirmation: string;
  }): Promise<{ readonly outcome: "ok"; readonly pin: TerminalPinSummary } | TerminalPinRefusal>;
  lock(sessionId: string): Promise<{ readonly outcome: "ok" } | TerminalPinRefusal>;
}

export function summaryOf(value: unknown): TerminalPinSummary | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const pin = value as Partial<TerminalPinStatusWire>;
  if (pin.state !== "setup_required" && pin.state !== "set" && pin.state !== "reset_required") {
    return undefined;
  }
  return {
    state: pin.state,
    lockedUntil: typeof pin.lockedUntil === "string" ? pin.lockedUntil : null,
    attemptsBeforeLock: typeof pin.attemptsBeforeLock === "number" ? pin.attemptsBeforeLock : 0,
  };
}

function pinRefusal(status: number, body: unknown): TerminalPinRefusal {
  const base = refusalFrom(status, body);
  const details = (
    body as { readonly error?: { readonly details?: { readonly pin?: unknown } } } | null
  )?.error?.details;
  const pin = summaryOf(details?.pin);
  return pin === undefined ? base : { ...base, pin };
}

export function createTerminalPinClient(call: HubCall): TerminalPinClient {
  const key = (name: string): Record<string, string> => ({
    "idempotency-key": `t1-pin-${name}-${randomUUID()}`,
  });
  const sessionAnswer = async (
    path: string,
    body: unknown,
    name: string,
  ): Promise<TerminalPinSessionAnswer> => {
    const response = await call("POST", path, body, key(name));
    if (response.status !== 200) return pinRefusal(response.status, response.body);
    const answer = response.body as {
      readonly result: string;
      readonly session: TerminalPinSessionWire;
      readonly pin: unknown;
    };
    const pin = summaryOf(answer.pin);
    if (pin === undefined || answer.session === undefined) {
      return {
        outcome: "refused",
        result: "HUB_ANSWER_INVALID",
        retryable: false,
        detail: "malformed",
      };
    }
    return { outcome: "ok", result: answer.result, session: answer.session, pin };
  };
  return {
    async status(sessionId) {
      const response = await call(
        "GET",
        TERMINAL_PIN_STATUS_PATH,
        undefined,
        sessionId === null ? {} : { [SESSION_HEADER]: sessionId },
      );
      if (response.status !== 200) return pinRefusal(response.status, response.body);
      const answer = response.body as { readonly pin: unknown; readonly session: unknown };
      const pin = summaryOf(answer.pin);
      if (pin === undefined) {
        return {
          outcome: "refused",
          result: "HUB_ANSWER_INVALID",
          retryable: false,
          detail: "malformed",
        };
      }
      const session = answer.session as { readonly state?: unknown } | null;
      const state = session?.state;
      return {
        outcome: "ok",
        pin,
        session:
          state === "open" || state === "closed" || state === "expired" || state === "unknown"
            ? { state }
            : null,
      };
    },
    setup: (input) => sessionAnswer(TERMINAL_PIN_SETUP_PATH, input, "setup"),
    unlock: (input) => sessionAnswer(TERMINAL_PIN_UNLOCK_PATH, input, "unlock"),
    async change(input) {
      const response = await call("POST", TERMINAL_PIN_CHANGE_PATH, input, key("change"));
      if (response.status !== 200) return pinRefusal(response.status, response.body);
      const pin = summaryOf((response.body as { readonly pin?: unknown }).pin);
      if (pin === undefined) {
        return {
          outcome: "refused",
          result: "HUB_ANSWER_INVALID",
          retryable: false,
          detail: "malformed",
        };
      }
      return { outcome: "ok", pin };
    },
    async lock(sessionId) {
      const response = await call("POST", TERMINAL_PIN_LOCK_PATH, { sessionId }, key("lock"));
      if (response.status !== 200) return pinRefusal(response.status, response.body);
      return { outcome: "ok" };
    },
  };
}
