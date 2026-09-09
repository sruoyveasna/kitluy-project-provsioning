/**
 * The Shell's client for `kitluy-device-config.service`.
 *
 * ===========================================================================
 * WHY THE SHELL CANNOT JUST DO THIS ITSELF
 * ===========================================================================
 * `kitluy-device-shell.service` runs as `kitluy-terminal` with an empty
 * `CapabilityBoundingSet`, `NoNewPrivileges=yes` and one writable directory. It
 * cannot write wpa_supplicant's configuration or the backlight, and that is the
 * point: the process rendering remote content is not the process that can
 * reconfigure the till. The privileged verbs live in a root broker and this is
 * the socket client for it.
 *
 * ===========================================================================
 * A MISSING BROKER IS AN ANSWER, NOT A CRASH
 * ===========================================================================
 * An image built without the broker, or one where the unit failed, must produce
 * a Settings screen that says the device cannot be configured here — not an
 * unhandled rejection behind a blank panel. Every failure below returns a
 * refusal with a code the UI can render, exactly as `PAIRING_TRANSPORT_UNAVAILABLE`
 * does for the pairing client.
 */
import { connect } from "node:net";

export const SOCKET_PATH = "/run/kitluy-device-config/socket";

/** Long enough for a Wi-Fi scan, which is seconds of radio time, not milliseconds. */
export const REQUEST_TIMEOUT_MS = 20_000;

export interface DeviceConfigResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly code?: string;
  readonly message?: string;
}

/**
 * A reply larger than this is abandoned. A scan of a crowded high street is the
 * biggest legitimate response and is far under this; the cap exists so a broker
 * that goes wrong cannot grow the Shell without bound.
 */
const MAX_RESPONSE_BYTES = 512 * 1024;

export interface ClientOptions {
  readonly socketPath?: string;
  readonly timeoutMs?: number;
}

/**
 * Send one request and read one reply.
 *
 * A connection per request, deliberately: there is no session, no ordering
 * requirement and no shared state, so a pooled socket would add reconnection
 * logic to a path whose whole job is to keep working when things are broken.
 */
export function requestDeviceConfig(
  request: Record<string, unknown>,
  options: ClientOptions = {},
): Promise<DeviceConfigResult> {
  const socketPath = options.socketPath ?? SOCKET_PATH;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  return new Promise<DeviceConfigResult>((resolve) => {
    let settled = false;
    const finish = (result: DeviceConfigResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const socket = connect(socketPath);
    let buffer = "";

    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          code: "DEVICE_CONFIG_TIMEOUT",
          message: "The device did not answer in time.",
        }),
      timeoutMs,
    );

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(JSON.stringify(request) + "\n");
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
        finish({
          ok: false,
          code: "DEVICE_CONFIG_OVERSIZED",
          message: "The device sent more than the shell will read.",
        });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && "ok" in parsed) {
          finish(parsed as DeviceConfigResult);
          return;
        }
        finish({ ok: false, code: "DEVICE_CONFIG_MALFORMED", message: "Unreadable reply." });
      } catch {
        finish({ ok: false, code: "DEVICE_CONFIG_MALFORMED", message: "Unreadable reply." });
      }
    });
    // ENOENT is the ordinary case on an image built without the broker, and
    // EACCES on one where the Shell's user is not in the socket's group. Both
    // are the same answer to the person at the till: not configurable here.
    socket.on("error", () =>
      finish({
        ok: false,
        code: "DEVICE_CONFIG_UNAVAILABLE",
        message: "This device cannot be configured from here.",
      }),
    );
    socket.on("close", () =>
      finish({
        ok: false,
        code: "DEVICE_CONFIG_UNAVAILABLE",
        message: "This device cannot be configured from here.",
      }),
    );
  });
}
