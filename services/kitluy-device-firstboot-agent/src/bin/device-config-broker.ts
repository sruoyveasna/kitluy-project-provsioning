/**
 * `/usr/lib/kitluy/device-config-broker` — the root side of Terminal Settings.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 * The Settings screens in the Device Shell need to join a Wi-Fi network and set
 * the backlight. The Shell cannot: it runs as `kitluy-terminal` with an empty
 * `CapabilityBoundingSet`, `NoNewPrivileges=yes` and one writable directory, and
 * that is deliberate — the process that renders remote content is not the process
 * that reconfigures the till.
 *
 * So this runs as root and answers a CLOSED list of verbs over a unix socket.
 * `../device-config.ts` holds the whole decision surface; this file adds only
 * the socket, and is kept small on purpose so the security argument lives in one
 * reviewable place.
 *
 * ===========================================================================
 * WHO MAY CONNECT
 * ===========================================================================
 * The socket is created 0660 root:kitluy-terminal inside the unit's
 * RuntimeDirectory, so the Shell's user can connect and nobody else on the
 * device can. There is no authentication beyond that, and there does not need to
 * be: a process already running as `kitluy-terminal` IS the Shell, and anything
 * that has become another local user has not gained a verb it could not reach by
 * being that user in the first place.
 *
 * ===========================================================================
 * ONE LINE, ONE ANSWER
 * ===========================================================================
 * Newline-delimited JSON, and a line is abandoned once it exceeds the request
 * cap rather than buffered to see where it ends — a client that never sends a
 * newline must not be able to grow this process without bound.
 */
import { createServer, type Socket } from "node:net";
import {
  chownSync,
  chmodSync,
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { userInfo } from "node:os";

import { MAX_REQUEST_BYTES, serve, type DeviceConfigDeps } from "../device-config.js";
import { withoutNetwork, WPA_CONFIG_PATH } from "../network.js";

export const SOCKET_PATH = "/run/kitluy-device-config/socket";
/** The Shell's user. The socket is group-owned by it and by nothing else. */
export const CLIENT_GROUP = "kitluy-terminal";
const BACKLIGHT_ROOT = "/sys/class/backlight";

function log(message: string): void {
  process.stdout.write(`[device-config-broker] ${message}\n`);
}

/**
 * The first backlight the kernel offers, or null.
 *
 * A Pi with an HDMI monitor has NO backlight class at all, and that is the
 * common case on a development bench. Null is the honest answer; the Settings
 * screen then hides the slider rather than showing one that does nothing.
 */
export function findBacklight(root = BACKLIGHT_ROOT): string | null {
  try {
    const entries = readdirSync(root).sort();
    for (const name of entries) {
      if (existsSync(`${root}/${name}/max_brightness`)) return `${root}/${name}`;
    }
  } catch {
    /* no backlight class on this board */
  }
  return null;
}

export function readBrightnessPercent(dir: string | null): number | null {
  if (dir === null) return null;
  try {
    const max = Number(readFileSync(`${dir}/max_brightness`, "utf8").trim());
    const now = Number(readFileSync(`${dir}/brightness`, "utf8").trim());
    if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(now)) return null;
    return Math.round((now / max) * 100);
  } catch {
    return null;
  }
}

export function writeBrightnessPercent(dir: string | null, percent: number): void {
  if (dir === null) throw new Error("no backlight");
  const max = Number(readFileSync(`${dir}/max_brightness`, "utf8").trim());
  if (!Number.isFinite(max) || max <= 0) throw new Error("no usable backlight range");
  // Never 0: a till whose screen is off looks broken to the person at it, and
  // the only way back would be a reboot. `device-config.ts` clamps to 1 already;
  // this is the second half of the same rule, next to the write it protects.
  const value = Math.max(1, Math.min(max, Math.round((percent / 100) * max)));
  writeFileSync(`${dir}/brightness`, `${value}\n`, "utf8");
}

/** Remove one network from the shop's wpa_supplicant configuration. */
export function forgetNetwork(ssidHex: string, configPath = WPA_CONFIG_PATH): void {
  if (!existsSync(configPath)) return;
  const before = readFileSync(configPath, "utf8");
  const after = withoutNetwork(before, ssidHex);
  if (after === before) return;
  writeFileSync(configPath, after, { mode: 0o600 });
}

export function buildDeps(): DeviceConfigDeps {
  const backlight = findBacklight();
  return {
    forget: async (ssidHex) => forgetNetwork(ssidHex),
    getBrightness: async () => readBrightnessPercent(backlight),
    ...(backlight === null
      ? {}
      : { setBrightness: async (percent: number) => writeBrightnessPercent(backlight, percent) }),
  };
}

/** Wire one accepted connection to the verb handler. */
export function attach(socket: Socket, deps: DeviceConfigDeps): void {
  let buffer = "";
  let poisoned = false;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    if (poisoned) return;
    buffer += chunk;
    if (Buffer.byteLength(buffer, "utf8") > MAX_REQUEST_BYTES) {
      // Abandoned, not buffered further. Answering first keeps the client honest
      // about why, and destroying the socket stops an unbounded line.
      poisoned = true;
      socket.end(
        JSON.stringify({
          ok: false,
          code: "REQUEST_TOO_LARGE",
          message: "The request was refused unread.",
        }) + "\n",
      );
      return;
    }
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim() !== "") {
        void serve(line, deps).then((response) => {
          if (!socket.destroyed) socket.write(JSON.stringify(response) + "\n");
        });
      }
      index = buffer.indexOf("\n");
    }
  });
  // A client that disappears is ordinary: the Shell restarts, the screen blanks.
  socket.on("error", () => socket.destroy());
}

export async function main(): Promise<void> {
  if (userInfo().uid !== 0) {
    process.stderr.write("[device-config-broker] REFUSED: this broker must run as root\n");
    process.exit(1);
  }
  const deps = buildDeps();
  // A socket left by a killed predecessor would make bind fail with EADDRINUSE.
  if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH);

  const server = createServer((socket) => attach(socket, deps));
  await new Promise<void>((resolve) => server.listen(SOCKET_PATH, resolve));

  // Ownership BEFORE the mode widens: between bind and chown the socket is
  // root-only, so there is no window in which another user can connect.
  try {
    const { execFileSync } = await import("node:child_process");
    const gid = Number(
      execFileSync("/usr/bin/getent", ["group", CLIENT_GROUP], { encoding: "utf8" }).split(":")[2],
    );
    if (Number.isFinite(gid)) chownSync(SOCKET_PATH, 0, gid);
    chmodSync(SOCKET_PATH, 0o660);
    log(`listening on ${SOCKET_PATH} for group ${CLIENT_GROUP}`);
  } catch {
    // Fail CLOSED: a socket the Shell cannot reach is a Settings screen that
    // says so. A world-writable one would be a root command channel.
    chmodSync(SOCKET_PATH, 0o600);
    log(`listening on ${SOCKET_PATH} (group ${CLIENT_GROUP} not found; root only)`);
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes("device-config-broker")) {
  void main();
}
