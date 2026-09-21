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
import { randomUUID } from "node:crypto";
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
export const DEFAULT_DEVICE_PIN_PATHS = {
    posture: DEVICE_PIN_POSTURE_PATH,
    bridgeSocket: EDGE_BRIDGE_SOCKET,
};
/** The public posture. A missing file on a fresh card is `absent`. */
export function readDevicePinPosture(paths = DEFAULT_DEVICE_PIN_PATHS) {
    const absent = {
        schema: "kitluy.device-pin-posture.v1",
        state: "absent",
        registeredAt: null,
    };
    if (!existsSync(paths.posture))
        return absent;
    try {
        const parsed = JSON.parse(readFileSync(paths.posture, "utf8"));
        if (parsed.state !== "registered")
            return absent;
        return {
            schema: "kitluy.device-pin-posture.v1",
            state: "registered",
            registeredAt: typeof parsed.registeredAt === "string" ? parsed.registeredAt : null,
        };
    }
    catch {
        return absent;
    }
}
function writePosture(paths, posture) {
    mkdirSync(dirname(paths.posture), { recursive: true });
    // World-readable: the Shell and the POS read it; it carries no secret.
    writeDurable(paths.posture, JSON.stringify(posture, null, 2) + "\n", 0o644);
}
/** The Hub holds the PIN now; the posture says so. */
export function markDevicePinRegistered(paths = DEFAULT_DEVICE_PIN_PATHS, now = new Date()) {
    const posture = {
        schema: "kitluy.device-pin-posture.v1",
        state: "registered",
        registeredAt: now.toISOString(),
    };
    writePosture(paths, posture);
    return posture;
}
/**
 * Every Hub mutation carries an Idempotency-Key (edge routes: "an
 * Idempotency-Key header is required", 422 without one — the second thing the
 * 2026-09-21 hardware run found once the socket was reachable). One fresh key
 * per attempt: a person pressing the digits twice is two attempts, and the
 * Hub's own PIN_ALREADY_SET answers the second.
 */
export function pinSetupIdempotencyKey() {
    return `shell-pin-setup-${randomUUID()}`;
}
export function bridgePinSetupCall(socketPath, timeoutMs = 15_000) {
    return (body) => new Promise((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify(body), "utf8");
        const req = request({
            socketPath,
            method: "POST",
            path: TERMINAL_PIN_SETUP_ROUTE,
            timeout: timeoutMs,
            headers: {
                "content-type": "application/json",
                "content-length": String(payload.length),
                "idempotency-key": pinSetupIdempotencyKey(),
            },
        }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => {
                if (chunks.reduce((n, c) => n + c.length, 0) < 64 * 1024)
                    chunks.push(chunk);
            });
            response.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                let parsed = null;
                try {
                    parsed = text.length > 0 ? JSON.parse(text) : null;
                }
                catch {
                    parsed = null;
                }
                resolve({ status: response.statusCode ?? 0, body: parsed });
            });
        });
        req.on("timeout", () => req.destroy(new Error("bridge timeout")));
        req.on("error", reject);
        req.write(payload);
        req.end();
    });
}
/** The Hub's refusal code, from the edge error envelope; `HUB_REFUSED` otherwise. */
function hubResult(body) {
    if (body === null || typeof body !== "object")
        return null;
    const error = body.error;
    const result = error?.details?.result;
    return typeof result === "string" ? result : null;
}
/**
 * Create the Terminal PIN on the Store Hub — the person's two entries go to
 * the Hub's setup route and nowhere else. Shape and equality are checked here
 * only so an obvious mistake is answered without a round trip; the Hub's own
 * checks stand behind them. On success the posture becomes `registered`.
 */
export async function registerDevicePinWithHub(input, deps = {}) {
    if (!DEVICE_PIN_PATTERN.test(input.pin))
        return { ok: false, code: "PIN_MALFORMED" };
    if (input.pin !== input.pinConfirmation)
        return { ok: false, code: "PIN_CONFIRMATION_MISMATCH" };
    const paths = deps.paths ?? DEFAULT_DEVICE_PIN_PATHS;
    const call = deps.call ?? bridgePinSetupCall(paths.bridgeSocket);
    let answer;
    try {
        answer = await call({ pin: input.pin, pinConfirmation: input.pinConfirmation });
    }
    catch {
        return { ok: false, code: "HUB_NOT_CONNECTED" };
    }
    if (answer.status === 200) {
        // The Hub holds the PIN from this instant. The posture file is a convenience
        // for the screens; failing to write it must not report the Hub's success as
        // a failure (the Shell would ask again and the Hub would answer ALREADY_SET).
        return { ok: true, posture: markRegisteredBestEffort(paths, deps.now ?? new Date()) };
    }
    const result = hubResult(answer.body);
    if (result === "PIN_CONFIRMATION_MISMATCH")
        return { ok: false, code: "PIN_CONFIRMATION_MISMATCH" };
    if (result === "PIN_ALREADY_SET") {
        // The Hub already holds one (a re-run after success): the posture follows the Hub.
        markRegisteredBestEffort(paths, deps.now ?? new Date());
        return { ok: false, code: "PIN_ALREADY_SET" };
    }
    if (answer.status === 0 || answer.status >= 500)
        return { ok: false, code: "HUB_NOT_CONNECTED" };
    return { ok: false, code: "HUB_REFUSED" };
}
function markRegisteredBestEffort(paths, now) {
    try {
        return markDevicePinRegistered(paths, now);
    }
    catch {
        return {
            schema: "kitluy.device-pin-posture.v1",
            state: "registered",
            registeredAt: now.toISOString(),
        };
    }
}
//# sourceMappingURL=device-pin.js.map