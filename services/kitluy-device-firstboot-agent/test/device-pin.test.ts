/**
 * KLD-2026-09-19-PIN-AFTER-PAIRING-001 — the Terminal PIN is created on the
 * Device Shell once the terminal is paired and connected, and it goes to the
 * Store Hub and nowhere else: the broker forwards the two entries through the
 * bridge, the Hub answers, the board keeps only the public posture.
 */
import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseRequest, serve, VERBS } from "../src/device-config.js";
import {
  bridgePinSetupCall,
  markDevicePinRegistered,
  pinSetupIdempotencyKey,
  readDevicePinPosture,
  registerDevicePinWithHub,
  TERMINAL_PIN_SETUP_ROUTE,
  type DevicePinPaths,
  type HubPinSetupCall,
} from "../src/device-pin.js";

function paths(): DevicePinPaths {
  const dir = mkdtempSync(join(tmpdir(), "kitluy-device-pin-"));
  return { posture: join(dir, "terminal", "device-pin.json"), bridgeSocket: join(dir, "no.sock") };
}

const hubSays =
  (status: number, body: unknown, seen: { pin?: string; calls: number }): HubPinSetupCall =>
  async (input) => {
    seen.calls += 1;
    seen.pin = input.pin;
    return { status, body };
  };

describe("the Terminal PIN goes to the Store Hub", () => {
  it("is absent on a fresh card, and registered once the Hub confirmed it — nothing about the PIN on disk", async () => {
    const p = paths();
    expect(readDevicePinPosture(p).state).toBe("absent");
    const seen = { calls: 0 } as { pin?: string; calls: number };
    const outcome = await registerDevicePinWithHub(
      { pin: "4812", pinConfirmation: "4812" },
      {
        call: hubSays(200, { result: "PIN_ESTABLISHED" }, seen),
        paths: p,
        now: new Date("2026-09-19T05:00:00Z"),
      },
    );
    expect(outcome).toEqual({
      ok: true,
      posture: {
        schema: "kitluy.device-pin-posture.v1",
        state: "registered",
        registeredAt: "2026-09-19T05:00:00.000Z",
      },
    });
    expect(seen).toEqual({ calls: 1, pin: "4812" });
    const raw = readFileSync(p.posture, "utf8");
    expect(raw).not.toContain("4812");
    expect(statSync(p.posture).mode & 0o777).toBe(0o644);
    // The posture directory carries nothing else.
    expect(existsSync(join(p.posture, "..", "device-pin.sealed.json"))).toBe(false);
    expect(readDevicePinPosture(p).state).toBe("registered");
  });

  it("answers an obvious mistake without a round trip, and maps the Hub's verdicts", async () => {
    const p = paths();
    const seen = { calls: 0 } as { pin?: string; calls: number };
    expect(
      await registerDevicePinWithHub(
        { pin: "12a4", pinConfirmation: "12a4" },
        { call: hubSays(200, {}, seen), paths: p },
      ),
    ).toEqual({ ok: false, code: "PIN_MALFORMED" });
    expect(
      await registerDevicePinWithHub(
        { pin: "1234", pinConfirmation: "1243" },
        { call: hubSays(200, {}, seen), paths: p },
      ),
    ).toEqual({ ok: false, code: "PIN_CONFIRMATION_MISMATCH" });
    expect(seen.calls).toBe(0);
    expect(readDevicePinPosture(p).state).toBe("absent");

    const refused = { error: { details: { result: "PIN_ALREADY_SET" } } };
    expect(
      await registerDevicePinWithHub(
        { pin: "1234", pinConfirmation: "1234" },
        { call: hubSays(409, refused, seen), paths: p },
      ),
    ).toEqual({ ok: false, code: "PIN_ALREADY_SET" });
    // The Hub holds one: the posture follows the Hub.
    expect(readDevicePinPosture(p).state).toBe("registered");

    const q = paths();
    const down: HubPinSetupCall = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(
      await registerDevicePinWithHub(
        { pin: "1234", pinConfirmation: "1234" },
        { call: down, paths: q },
      ),
    ).toEqual({
      ok: false,
      code: "HUB_NOT_CONNECTED",
    });
    expect(
      await registerDevicePinWithHub(
        { pin: "1234", pinConfirmation: "1234" },
        { call: hubSays(503, {}, seen), paths: q },
      ),
    ).toEqual({ ok: false, code: "HUB_NOT_CONNECTED" });
    expect(
      await registerDevicePinWithHub(
        { pin: "1234", pinConfirmation: "1234" },
        {
          call: hubSays(403, { error: { details: { result: "TERMINAL_NOT_ELIGIBLE" } } }, seen),
          paths: q,
        },
      ),
    ).toEqual({ ok: false, code: "HUB_REFUSED" });
    expect(readDevicePinPosture(q).state).toBe("absent");
  });

  it("marks registered idempotently", () => {
    const p = paths();
    markDevicePinRegistered(p, new Date("2026-09-19T05:00:00Z"));
    markDevicePinRegistered(p, new Date("2026-09-19T05:01:00Z"));
    expect(readDevicePinPosture(p)).toMatchObject({
      state: "registered",
      registeredAt: "2026-09-19T05:01:00.000Z",
    });
  });
});

describe("the bridge call itself — what the Hub's setup route requires", () => {
  // The Hub's edge routes refuse any mutation without an Idempotency-Key (422,
  // "an Idempotency-Key header is required") — hardware run 2026-09-21. This
  // drives the REAL request over a unix socket, the way the broker does, and
  // reads back what arrives: the route, the body and that header.
  it("POSTs the two entries to the Hub's setup route with an Idempotency-Key the Hub accepts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-bridge-"));
    const socketPath = join(dir, "bridge.sock");
    const seen: { method?: string; url?: string; key?: unknown; body?: string } = {};
    const server = createServer((req: IncomingMessage, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => (body += chunk));
      req.on("end", () => {
        seen.method = req.method;
        seen.url = req.url;
        seen.key = req.headers["idempotency-key"];
        seen.body = body;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ result: "PIN_ESTABLISHED" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      const answer = await bridgePinSetupCall(socketPath)({ pin: "2468", pinConfirmation: "2468" });
      expect(answer.status).toBe(200);
      expect(seen.method).toBe("POST");
      expect(seen.url).toBe(TERMINAL_PIN_SETUP_ROUTE);
      expect(JSON.parse(seen.body ?? "")).toEqual({ pin: "2468", pinConfirmation: "2468" });
      // The Hub's own shape for the key: /^[A-Za-z0-9_.:-]{1,96}$/ (edge routes).
      expect(typeof seen.key).toBe("string");
      expect(seen.key).toMatch(/^[A-Za-z0-9_.:-]{1,96}$/u);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("mints a fresh key per attempt", () => {
    const a = pinSetupIdempotencyKey();
    const b = pinSetupIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^shell-pin-setup-[0-9a-f-]{36}$/u);
    expect(a.length).toBeLessThanOrEqual(96);
  });

  it("reports a bridge that is not there as a connection failure, not a Hub verdict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kitluy-bridge-"));
    await expect(
      bridgePinSetupCall(join(dir, "absent.sock"))({ pin: "2468", pinConfirmation: "2468" }),
    ).rejects.toBeInstanceOf(Error);
  });
});

describe("the broker verbs", () => {
  it("declares pin.status and pin.setup, shape-checks the digits, forwards to the Hub, and never echoes them", async () => {
    expect(VERBS).toContain("pin.status");
    expect(VERBS).toContain("pin.setup");
    const bad = parseRequest(
      JSON.stringify({ verb: "pin.setup", pin: "12345", pinConfirmation: "12345" }),
    );
    expect(bad).toEqual({
      ok: false,
      code: "PIN_MALFORMED",
      message: "A Terminal PIN is exactly four digits.",
    });
    const mismatch = await serve(
      JSON.stringify({ verb: "pin.setup", pin: "1234", pinConfirmation: "4321" }),
      {
        pinSetup: async () => ({ ok: false, code: "PIN_CONFIRMATION_MISMATCH" }),
      },
    );
    expect(mismatch).toEqual({
      ok: false,
      code: "PIN_CONFIRMATION_MISMATCH",
      message: "The two entries differ. Try again.",
    });
    expect(JSON.stringify(mismatch)).not.toMatch(/1234|4321/u);
    const notYet = await serve(
      JSON.stringify({ verb: "pin.setup", pin: "1234", pinConfirmation: "1234" }),
      {
        pinSetup: async () => ({ ok: false, code: "HUB_NOT_CONNECTED" }),
      },
    );
    expect(notYet).toMatchObject({ ok: false, code: "HUB_NOT_CONNECTED" });
    let forwarded: string | undefined;
    const ok = await serve(
      JSON.stringify({ verb: "pin.setup", pin: "1234", pinConfirmation: "1234" }),
      {
        pinSetup: async (input) => {
          forwarded = input.pin;
          return {
            ok: true,
            posture: {
              schema: "kitluy.device-pin-posture.v1",
              state: "registered",
              registeredAt: "x",
            },
          };
        },
      },
    );
    expect(forwarded).toBe("1234");
    expect(ok).toMatchObject({ ok: true, data: { state: "registered" } });
    const status = await serve(JSON.stringify({ verb: "pin.status" }), {
      pinStatus: () => ({
        schema: "kitluy.device-pin-posture.v1",
        state: "absent",
        registeredAt: null,
      }),
    });
    expect(status).toMatchObject({ ok: true, data: { state: "absent" } });
    let checked = 0;
    const check = await serve(JSON.stringify({ verb: "update.check" }), {
      checkForUpdates: async () => {
        checked += 1;
      },
    });
    expect(check).toEqual({ ok: true, data: { checking: true } });
    expect(checked).toBe(1);
  });
});
