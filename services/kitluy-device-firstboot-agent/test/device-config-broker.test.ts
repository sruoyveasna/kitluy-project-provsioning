/**
 * The broker's socket framing and its sysfs helpers.
 *
 * `device-config.test.ts` covers what may be ASKED. This covers the parts that
 * touch the machine: a line protocol that cannot be made to buffer without
 * bound, a backlight that may not exist, and a brightness that must never reach
 * zero on a till nobody can then see to fix.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  attach,
  findBacklight,
  forgetNetwork,
  readBrightnessPercent,
  shareSocketWithGroup,
  writeBrightnessPercent,
} from "../src/bin/device-config-broker.js";
import { MAX_REQUEST_BYTES } from "../src/device-config.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "kitluy-broker-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function backlight(max: string, now: string): string {
  const root = tmp();
  mkdirSync(join(root, "10-backlight"));
  writeFileSync(join(root, "10-backlight", "max_brightness"), max);
  writeFileSync(join(root, "10-backlight", "brightness"), now);
  return root;
}

describe("a board may have no backlight at all", () => {
  it("reports null rather than throwing when the class is absent", () => {
    expect(findBacklight(join(tmp(), "nope"))).toBeNull();
    expect(readBrightnessPercent(null)).toBeNull();
  });

  it("finds the first backlight when one exists", () => {
    const root = backlight("255\n", "128\n");
    expect(findBacklight(root)).toBe(join(root, "10-backlight"));
  });

  it("reports a percentage of the board's own range, not raw units", () => {
    const root = backlight("255\n", "128\n");
    expect(readBrightnessPercent(findBacklight(root))).toBe(50);
  });

  it("reports null on a nonsense range instead of dividing by zero", () => {
    const root = backlight("0\n", "0\n");
    expect(readBrightnessPercent(findBacklight(root))).toBeNull();
  });
});

describe("brightness never reaches zero", () => {
  it("writes at least 1 raw unit even when asked for the minimum", () => {
    const root = backlight("255\n", "128\n");
    const dir = findBacklight(root)!;
    writeBrightnessPercent(dir, 1);
    expect(Number(readFileSync(join(dir, "brightness"), "utf8").trim())).toBeGreaterThanOrEqual(1);
  });

  it("never exceeds the board's maximum", () => {
    const root = backlight("10\n", "5\n");
    const dir = findBacklight(root)!;
    writeBrightnessPercent(dir, 100);
    expect(Number(readFileSync(join(dir, "brightness"), "utf8").trim())).toBe(10);
  });

  it("throws rather than guessing when there is no backlight", () => {
    expect(() => writeBrightnessPercent(null, 50)).toThrow();
  });
});

describe("forgetting a network", () => {
  it("is a no-op when no configuration exists", () => {
    expect(() => forgetNetwork("6b69", join(tmp(), "absent.conf"))).not.toThrow();
  });

  it("removes only the named network and keeps the file readable to root alone", () => {
    const path = join(tmp(), "wpa.conf");
    const keep = Buffer.from("Keep", "utf8").toString("hex");
    const drop = Buffer.from("Drop", "utf8").toString("hex");
    writeFileSync(
      path,
      `ctrl_interface=/run/wpa_supplicant\nnetwork={\n\tssid=${keep}\n}\nnetwork={\n\tssid=${drop}\n}\n`,
    );
    forgetNetwork(drop, path);
    const after = readFileSync(path, "utf8");
    expect(after).toContain(keep);
    expect(after).not.toContain(drop);
  });
});

/** Drives `attach` over a duplex stand-in and collects what it writes back. */
function conversation(): { socket: PassThrough & { destroyed: boolean }; written: string[] } {
  const written: string[] = [];
  const socket = new PassThrough() as unknown as PassThrough & { destroyed: boolean };
  const realWrite = socket.write.bind(socket);
  (socket as unknown as { write: (c: string) => boolean }).write = (chunk: string) => {
    written.push(chunk);
    return true;
  };
  (socket as unknown as { end: (c?: string) => void }).end = (chunk?: string) => {
    if (chunk !== undefined) written.push(chunk);
  };
  void realWrite;
  return { socket, written };
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe("the line protocol", () => {
  it("answers one request per line", async () => {
    const { socket, written } = conversation();
    attach(socket as never, { getBrightness: async () => 42 });
    socket.emit("data", JSON.stringify({ verb: "display.getBrightness" }) + "\n");
    await settle();
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!)).toEqual({ ok: true, data: { percent: 42 } });
  });

  it("handles two requests arriving in one chunk", async () => {
    const { socket, written } = conversation();
    attach(socket as never, { getBrightness: async () => 7 });
    const one = JSON.stringify({ verb: "display.getBrightness" });
    socket.emit("data", `${one}\n${one}\n`);
    await settle();
    expect(written).toHaveLength(2);
  });

  it("waits for the newline before acting on a split request", async () => {
    const { socket, written } = conversation();
    attach(socket as never, { getBrightness: async () => 7 });
    socket.emit("data", '{"verb":"display.get');
    await settle();
    expect(written).toHaveLength(0);
    socket.emit("data", 'Brightness"}\n');
    await settle();
    expect(JSON.parse(written[0]!)).toMatchObject({ ok: true });
  });

  it("abandons a line that never ends rather than buffering it without bound", async () => {
    const { socket, written } = conversation();
    attach(socket as never, {});
    // No newline, ever. This is the shape of the attack.
    socket.emit("data", "x".repeat(MAX_REQUEST_BYTES + 1));
    await settle();
    expect(JSON.parse(written[0]!)).toMatchObject({ ok: false, code: "REQUEST_TOO_LARGE" });
    // And it stops listening: more data must not restart the buffering.
    socket.emit("data", "y".repeat(MAX_REQUEST_BYTES));
    await settle();
    expect(written).toHaveLength(1);
  });

  it("ignores blank lines instead of answering them", async () => {
    const { socket, written } = conversation();
    attach(socket as never, {});
    socket.emit("data", "\n   \n");
    await settle();
    expect(written).toHaveLength(0);
  });
});

describe("who may connect", () => {
  // A unix socket is reached by PATH. On the first two Terminal boards the
  // socket was 0660 root:kitluy-terminal and the RuntimeDirectory around it was
  // 0750 root:root, so the Shell's connect() ended in EACCES before the socket's
  // own mode was ever consulted — every Settings verb and the Terminal PIN with
  // it (hardware, 2026-09-21). The directory is shared with the group too.
  it("shares the socket AND its directory with the client group, and nothing wider", async () => {
    const root = tmp();
    const dir = join(root, "kitluy-device-config");
    mkdirSync(dir, { mode: 0o700 });
    const socketPath = join(dir, "socket");
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const gid = process.getgid?.() ?? 0;
      shareSocketWithGroup(socketPath, gid);
      expect(statSync(dir).mode & 0o777).toBe(0o750);
      expect(statSync(socketPath).mode & 0o777).toBe(0o660);
      expect(statSync(dir).gid).toBe(gid);
      expect(statSync(socketPath).gid).toBe(gid);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
