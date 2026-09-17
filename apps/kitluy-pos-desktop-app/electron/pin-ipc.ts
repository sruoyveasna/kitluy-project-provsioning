/**
 * The Terminal PIN over IPC — TERMINAL-PIN-AND-REAL-POS-AUTH-001.
 *
 * Four NAMED operations, re-validated in the main process: set up (twice),
 * unlock, change, lock. The renderer supplies four-digit PINs and nothing
 * else — no profile, no scope, no Hub, no actor: the Store Hub verifies
 * (Argon2id, throttling, the device credential first), and the session it
 * issues never crosses back. There is no staff sign-in channel on a Pi Terminal
 * (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001).
 */
import type { T1BootstrapReport } from "../src/bootstrap/states.js";

export const PIN_CHANNELS = {
  setup: "kitluy:t1:pin:setup",
  unlock: "kitluy:t1:pin:unlock",
  change: "kitluy:t1:pin:change",
  lock: "kitluy:t1:pin:lock",
} as const;

/** Exactly four digits (KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10). */
const PIN = /^[0-9]{4}$/u;

function exactly(payload: unknown, keys: readonly string[]): Record<string, string> | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const present = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (present.length !== expected.length || present.some((k, i) => k !== expected[i])) return null;
  const out: Record<string, string> = {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string" || !PIN.test(value)) return null;
    out[key] = value;
  }
  return out;
}

export function validateSetup(payload: unknown): { pin: string; pinConfirmation: string } | null {
  const v = exactly(payload, ["pin", "pinConfirmation"]);
  return v === null ? null : { pin: v["pin"] ?? "", pinConfirmation: v["pinConfirmation"] ?? "" };
}

export function validateUnlock(payload: unknown): { pin: string } | null {
  const v = exactly(payload, ["pin"]);
  return v === null ? null : { pin: v["pin"] ?? "" };
}

export function validateChange(
  payload: unknown,
): { currentPin: string; newPin: string; newPinConfirmation: string } | null {
  const v = exactly(payload, ["currentPin", "newPin", "newPinConfirmation"]);
  return v === null
    ? null
    : {
        currentPin: v["currentPin"] ?? "",
        newPin: v["newPin"] ?? "",
        newPinConfirmation: v["newPinConfirmation"] ?? "",
      };
}

interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

export type PinVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly detail: string;
      readonly pin?: T1BootstrapReport["pin"];
    };

type Outcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      readonly detail: string;
      readonly pin?: T1BootstrapReport["pin"];
    };

export interface PinRuntimeLike {
  setupPin(input: { readonly pin: string; readonly pinConfirmation: string }): Promise<Outcome>;
  unlock(input: { readonly pin: string }): Promise<Outcome>;
  changePin(input: {
    readonly currentPin: string;
    readonly newPin: string;
    readonly newPinConfirmation: string;
  }): Promise<Outcome>;
  lock(): Promise<unknown>;
}

const INVALID: PinVerdict = {
  ok: false,
  code: "INVALID_INPUT",
  detail: "a Terminal PIN is exactly four digits",
};

/** Only the verdict crosses back: never a session id, never a PIN. */
function verdict(outcome: Outcome): PinVerdict {
  return outcome.ok
    ? { ok: true }
    : {
        ok: false,
        code: outcome.code,
        detail: outcome.detail,
        ...(outcome.pin === undefined ? {} : { pin: outcome.pin }),
      };
}

export function registerPinIpc(ipc: IpcMainLike, runtime: PinRuntimeLike): void {
  ipc.handle(PIN_CHANNELS.setup, async (_event, payload) => {
    const input = validateSetup(payload);
    return input === null ? INVALID : verdict(await runtime.setupPin(input));
  });
  ipc.handle(PIN_CHANNELS.unlock, async (_event, payload) => {
    const input = validateUnlock(payload);
    return input === null ? INVALID : verdict(await runtime.unlock(input));
  });
  ipc.handle(PIN_CHANNELS.change, async (_event, payload) => {
    const input = validateChange(payload);
    return input === null ? INVALID : verdict(await runtime.changePin(input));
  });
  ipc.handle(PIN_CHANNELS.lock, async () => {
    await runtime.lock();
    return { ok: true };
  });
}
