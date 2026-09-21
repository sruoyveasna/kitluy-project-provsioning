/**
 * The Terminal PIN is created on the Device Shell RIGHT AFTER the terminal is
 * paired and connected to its Store Hub, and it lives on the Hub only —
 * owner ruling 2026-09-19 (KLD-2026-09-19-PIN-AFTER-PAIRING-001, amending
 * KLD-2026-09-18-FIRST-BOOT-PIN-001: "creating PIN is after we connect our Pi
 * terminals to our store hub because PIN is stored on the server").
 *
 * KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001 STANDS: the Store Hub is
 * the verifier (Argon2id on the Hub, attempts and lock on the Hub, "PIN set" a
 * Hub fact). Nothing about the PIN is written on the board — no seal, no hash,
 * no digits. The broker (root) forwards the person's two entries to the Hub's
 * own setup route through the terminal-edge bridge, once, and the Hub answers.
 *
 * What this module keeps is the POSTURE the Shell and the POS read
 * (`/var/lib/kitluy/terminal/device-pin.json`, world-readable):
 *   `absent`     — this board has not registered a PIN with a Hub yet;
 *   `registered` — the Hub confirmed it (`registeredAt`).
 * The posture is a convenience for the screens; the Hub's own PIN status
 * (edge status `terminalPin.state`) is the truth the Shell gates on.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { dirname } from "node:path";

import { writeDurable } from "./durable-write.js";
import { EDGE_BRIDGE_SOCKET } from "./edge-bridge.js";

export const DEVICE_PIN_POSTURE_PATH = "/var/lib/kitluy/terminal/device-pin.json";
/** The Hub's setup route, through the bridge (allow-listed as `pin.setup`). */
export const TERMINAL_PIN_SETUP_ROUTE = "/edge/v1/terminal-pin/setup";

/** Four digits — the same shape the Hub's `TERMINAL_PIN_PATTERN` accepts. */
export const DEVICE_PIN_PATTERN = /^[0-9]{4}$/u;

export type DevicePinState = "absent" | "registered";

export interface DevicePinPosture {
  readonly schema: "kitluy.device-pin-posture.v1";
  readonly state: DevicePinState;
  readonly registeredAt: string | null;
}

/**
 * Why the Hub, or the board, refused. `HUB_NOT_CONNECTED` is the one the Shell
 * shows before pairing has finished; the rest are the Hub's own verdicts.
 */
export type DevicePinRefusal =
  | "PIN_MALFORMED"
  | "PIN_CONFIRMATION_MISMATCH"
  | "PIN_ALREADY_SET"
  | "HUB_NOT_CONNECTED"
  | "HUB_REFUSED";

export interface DevicePinPaths {
  readonly posture: string;
  readonly bridgeSocket: string;
}

export const DEFAULT_DEVICE_PIN_PATHS: DevicePinPaths = {
  posture: DEVICE_PIN_POSTURE_PATH,
  bridgeSocket: EDGE_BRIDGE_SOCKET,
};

/** The public posture. A missing file on a fresh card is `absent`. */
export function readDevicePinPosture(
  paths: Pick<DevicePinPaths, "posture"> = DEFAULT_DEVICE_PIN_PATHS,
): DevicePinPosture {
  const absent: DevicePinPosture = {
    schema: "kitluy.device-pin-posture.v1",
    state: "absent",
    registeredAt: null,
  };
  if (!existsSync(paths.posture)) return absent;
  try {
    const parsed = JSON.parse(readFileSync(paths.posture, "utf8")) as Partial<DevicePinPosture>;
    if (parsed.state !== "registered") return absent;
    return {
      schema: "kitluy.device-pin-posture.v1",
      state: "registered",
      registeredAt: typeof parsed.registeredAt === "string" ? parsed.registeredAt : null,
    };
  } catch {
    return absent;
  }
}

function writePosture(paths: Pick<DevicePinPaths, "posture">, posture: DevicePinPosture): void {
  mkdirSync(dirname(paths.posture), { recursive: true });
  // World-readable: the Shell and the POS read it; it carries no secret.
  writeDurable(paths.posture, JSON.stringify(posture, null, 2) + "\n", 0o644);
}

/** The Hub holds the PIN now; the posture says so. */
export function markDevicePinRegistered(
  paths: Pick<DevicePinPaths, "posture"> = DEFAULT_DEVICE_PIN_PATHS,
  now: Date = new Date(),
): DevicePinPosture {
  const posture: DevicePinPosture = {
    schema: "kitluy.device-pin-posture.v1",
    state: "registered",
    registeredAt: now.toISOString(),
  };
  writePosture(paths, posture);
  return posture;
}

/** One call to the Hub through the bridge. Injected in tests. */
export type HubPinSetupCall = (body: {
  readonly pin: string;
  readonly pinConfirmation: string;
}) => Promise<{ readonly status: number; readonly body: unknown }>;

export function bridgePinSetupCall(socketPath: string, timeoutMs = 15_000): HubPinSetupCall {
  return (body) =>
    new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify(body), "utf8");
      const req = request(
        {
          socketPath,
          method: "POST",
          path: TERMINAL_PIN_SETUP_ROUTE,
          timeout: timeoutMs,
          headers: { "content-type": "application/json", "content-length": String(payload.length) },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            if (chunks.reduce((n, c) => n + c.length, 0) < 64 * 1024) chunks.push(chunk);
          });
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed: unknown = null;
            try {
              parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
            } catch {
              parsed = null;
            }
            resolve({ status: response.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on("timeout", () => req.destroy(new Error("bridge timeout")));
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
}

/** The Hub's refusal code, from the edge error envelope; `HUB_REFUSED` otherwise. */
function hubResult(body: unknown): string | null {
  if (body === null || typeof body !== "object") return null;
  const error = (body as { error?: { details?: { result?: unknown } } }).error;
  const result = error?.details?.result;
  return typeof result === "string" ? result : null;
}

/**
 * Create the Terminal PIN on the Store Hub — the person's two entries go to
 * the Hub's setup route and nowhere else. Shape and equality are checked here
 * only so an obvious mistake is answered without a round trip; the Hub's own
 * checks stand behind them. On success the posture becomes `registered`.
 */
export async function registerDevicePinWithHub(
  input: { readonly pin: string; readonly pinConfirmation: string },
  deps: {
    readonly call?: HubPinSetupCall;
    readonly paths?: DevicePinPaths;
    readonly now?: Date;
  } = {},
): Promise<
  | { readonly ok: true; readonly posture: DevicePinPosture }
  | { readonly ok: false; readonly code: DevicePinRefusal }
> {
  if (!DEVICE_PIN_PATTERN.test(input.pin)) return { ok: false, code: "PIN_MALFORMED" };
  if (input.pin !== input.pinConfirmation) return { ok: false, code: "PIN_CONFIRMATION_MISMATCH" };
  const paths = deps.paths ?? DEFAULT_DEVICE_PIN_PATHS;
  const call = deps.call ?? bridgePinSetupCall(paths.bridgeSocket);
  let answer: { readonly status: number; readonly body: unknown };
  try {
    answer = await call({ pin: input.pin, pinConfirmation: input.pinConfirmation });
  } catch {
    return { ok: false, code: "HUB_NOT_CONNECTED" };
  }
  if (answer.status === 200) {
    return { ok: true, posture: markDevicePinRegistered(paths, deps.now ?? new Date()) };
  }
  const result = hubResult(answer.body);
  if (result === "PIN_CONFIRMATION_MISMATCH")
    return { ok: false, code: "PIN_CONFIRMATION_MISMATCH" };
  if (result === "PIN_ALREADY_SET") {
    // The Hub already holds one (a re-run after success): the posture follows the Hub.
    markDevicePinRegistered(paths, deps.now ?? new Date());
    return { ok: false, code: "PIN_ALREADY_SET" };
  }
  if (answer.status === 0 || answer.status >= 500) return { ok: false, code: "HUB_NOT_CONNECTED" };
  return { ok: false, code: "HUB_REFUSED" };
}
