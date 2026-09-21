/**
 * `PiTerminalRuntime` — the controller around the edge bootstrap
 * (T1-STORE-OPERATIONS-001). Fakes answer in the Hub's wire shapes through the
 * runtime's own seams (`call`, `bridgeStatus`); no socket, no clock but the
 * injected monotonic one.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EdgeBridgeStatusWire } from "../src/bootstrap/edge-machine.js";
import { PiTerminalRuntime } from "../electron/pi-runtime.js";
import type { HubCall } from "../electron/edge-operations-session.js";

const T1 = "laundry.t1.intake_cashier";
const TERMINAL = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const HUB = "549a41c6-21e9-4838-8b48-34a3878ba290";
const SCOPE = {
  tenantId: "e0000000-0000-4000-8000-000000000001",
  digitalStoreId: "e0000000-0000-4000-8000-000000000002",
  storeLocationId: "e0000000-0000-4000-8000-000000000003",
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-pi-runtime-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const STATUS: EdgeBridgeStatusWire = {
  edge: { phase: "SERVING", detail: "connected", checkedAt: new Date().toISOString() },
  hub: { hubDeviceId: HUB, host: "h", port: 7443 },
  terminal: { deviceId: TERMINAL, assignmentGeneration: 3, profileCodes: [T1] },
};

/**
 * A scripted Hub with a Terminal PIN. `gate`, when set, holds the NEXT
 * authority-time read open. The PIN starts UNSET; five wrong entries lock it.
 */
function hub() {
  const state: {
    pin: string | null;
    failures: number;
    lockedUntil: string | null;
    gate: Promise<void> | null;
    opened: number;
    sessions: Map<string, "open" | "closed">;
  } = { pin: null, failures: 0, lockedUntil: null, gate: null, opened: 0, sessions: new Map() };
  const now = () => new Date().toISOString();
  const payloadJson = "{}";
  const call: HubCall = async (method, path, body, headers) => {
    if (path === "/edge/v1/runtime/authority-time") {
      const gate = state.gate;
      state.gate = null;
      if (gate !== null) await gate;
      return {
        status: 200,
        body: {
          protocolVersion: "1.0",
          authorityTime: now(),
          authoritySource: "hub_database",
          responseId: "r",
          generatedAt: now(),
          maxCacheAgeSeconds: 30,
          correlationId: "c",
        },
      };
    }
    if (path === "/edge/v1/runtime/eligibility") {
      return {
        status: 200,
        body: {
          eligibility: {
            protocolVersion: "1.0",
            ...SCOPE,
            environment: "development",
            hubDeviceId: HUB,
            terminalDeviceId: TERMINAL,
            assignmentId: "a",
            assignmentGeneration: 3,
            terminalProfileCode: T1,
            primaryVertical: "laundry",
            credentialId: "c",
            credentialGeneration: 3,
            credentialEligibility: "eligible",
            activationEligibility: "activated",
            pairingEligibility: "paired",
            pairedAt: now(),
            containmentState: "none",
            hubReplacementState: "normal",
            requiredConfigurationVersion: null,
            authorityTime: now(),
          },
        },
      };
    }
    if (path === "/edge/v1/configuration/current") {
      return {
        status: 200,
        body: {
          delivery: {
            snapshotId: "s",
            configurationVersion: 7,
            schemaVersion: 1,
            ...SCOPE,
            environment: "development",
            hubDeviceId: HUB,
            terminalDeviceId: TERMINAL,
            assignmentGeneration: 3,
            terminalProfileCode: T1,
            primaryVertical: "laundry",
            minimumApplicationVersion: "0.1.0",
            maximumApplicationVersion: null,
            issuedAt: new Date(Date.now() - 60_000).toISOString(),
            effectiveAt: new Date(Date.now() - 60_000).toISOString(),
            validUntil: new Date(Date.now() + 3_600_000).toISOString(),
            manifestSha256: "m",
            payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
            signingKeyId: "k",
            correlationId: "x",
          },
          payloadJson,
          deliverySignature: "AAAA",
          rollbackReference: null,
        },
      };
    }
    const posture = () => ({
      state: state.pin === null ? "setup_required" : "set",
      pinVersion: state.pin === null ? 0 : 1,
      setAt: state.pin === null ? null : now(),
      lockedUntil: state.lockedUntil,
      attemptsBeforeLock: state.lockedUntil === null ? 5 - state.failures : 0,
    });
    const refuse = (status: number, result: string) => ({
      status,
      body: { error: { message: "no", details: { result, retryable: false, pin: posture() } } },
    });
    const session = () => {
      state.opened += 1;
      const sessionId = `pin-sess-${String(state.opened)}`;
      state.sessions.set(sessionId, "open");
      return {
        sessionId,
        actorId: TERMINAL,
        displayName: "",
        profileCode: T1,
        openedAt: now(),
        expiresAt: new Date(Date.now() + 8 * 3_600_000).toISOString(),
        sessionGeneration: state.opened,
        effectivePermissions: ["pos.t1.use", "customers.read", "laundry.bookings.create"],
        authorityTime: now(),
        credentialKind: "terminal_pin",
      };
    };
    if (path === "/edge/v1/terminal-pin/status") {
      const held = headers?.["x-kitluy-session-id"];
      return {
        status: 200,
        body: {
          result: "TERMINAL_PIN_STATUS",
          pin: posture(),
          session:
            held === undefined
              ? null
              : { state: state.sessions.get(held) ?? "unknown", expiresAt: null },
          authorityTime: now(),
        },
      };
    }
    if (method === "POST" && path === "/edge/v1/terminal-pin/setup") {
      const input = body as { pin: string; pinConfirmation: string };
      if (state.pin !== null) return refuse(409, "PIN_ALREADY_SET");
      if (input.pin !== input.pinConfirmation) return refuse(422, "PIN_CONFIRMATION_MISMATCH");
      state.pin = input.pin;
      return {
        status: 200,
        body: { result: "PIN_ESTABLISHED", session: session(), pin: posture() },
      };
    }
    if (method === "POST" && path === "/edge/v1/terminal-pin/unlock") {
      const input = body as { pin: string };
      if (state.pin === null) return refuse(409, "PIN_SETUP_REQUIRED");
      if (state.lockedUntil !== null) return refuse(429, "PIN_LOCKED");
      if (input.pin !== state.pin) {
        state.failures += 1;
        if (state.failures >= 5) {
          state.lockedUntil = new Date(Date.now() + 900_000).toISOString();
          state.failures = 0;
          return refuse(429, "PIN_LOCKED");
        }
        return refuse(401, "PIN_INCORRECT");
      }
      state.failures = 0;
      return {
        status: 200,
        body: { result: "TERMINAL_UNLOCKED", session: session(), pin: posture() },
      };
    }
    if (method === "POST" && path === "/edge/v1/terminal-pin/lock") {
      const input = body as { sessionId: string };
      state.sessions.set(input.sessionId, "closed");
      return { status: 200, body: { result: "TERMINAL_LOCKED" } };
    }
    if (method === "POST" && path === "/edge/v1/sessions/open") {
      throw new Error("the staff session door must never be called from a Pi Terminal");
    }
    return { status: 404, body: null };
  };
  return { state, call };
}

function runtime(h: ReturnType<typeof hub>, devicePinPosturePath: string | null = null) {
  let t = 1_000;
  return new PiTerminalRuntime({
    socketPath: "/nonexistent",
    applicationVersion: "0.1.0",
    statusPath: join(dir, "pos-runtime.json"),
    call: h.call,
    bridgeStatus: () => Promise.resolve(STATUS),
    monotonicNow: () => (t += 1),
    logger: { log: () => undefined },
    devicePinPosturePath,
  });
}

describe("the Pi Terminal runtime", () => {
  it("T1-FIRST-BOOT-PIN-001: carries the device's PIN posture beside the Hub's answer, and only the posture", async () => {
    const posturePath = join(dir, "device-pin.json");
    writeFileSync(
      posturePath,
      JSON.stringify({ schema: "kitluy.device-pin-posture.v1", state: "sealed", sealedAt: "x" }),
    );
    const pos = runtime(hub(), posturePath);
    const report = await pos.refresh();
    expect(report.state).toBe("staff_authentication_required");
    expect(report.pin).toMatchObject({ state: "setup_required", devicePin: "sealed" });
    expect(JSON.stringify(report)).not.toMatch(/sealedAt|ciphertext/u);
    // No posture file (the workstation composition): nothing is claimed.
    const bare = await runtime(hub(), join(dir, "missing.json")).refresh();
    expect(bare.pin).not.toHaveProperty("devicePin");
  });

  it("locked until a PIN is set up twice; unlocked into T1; intake only when READY; locked again on demand", async () => {
    const h = hub();
    const pos = runtime(h);
    const first = await pos.refresh();
    expect(first.state).toBe("staff_authentication_required");
    // The Hub's answer, carried for the screen: no PIN yet.
    expect(first.pin).toMatchObject({ state: "setup_required", lockedUntil: null });
    expect(pos.intakeOperations()).toBeNull();

    // No PIN exists: an unlock cannot succeed, and a mismatched setup is refused.
    expect(await pos.unlock({ pin: "2468" })).toMatchObject({
      ok: false,
      code: "PIN_SETUP_REQUIRED",
    });
    expect(await pos.setupPin({ pin: "2468", pinConfirmation: "2486" })).toMatchObject({
      ok: false,
      code: "PIN_CONFIRMATION_MISMATCH",
    });
    expect(pos.intakeOperations()).toBeNull();

    // Set up twice: unlocked at once, READY, intake open.
    const established = await pos.setupPin({ pin: "2468", pinConfirmation: "2468" });
    expect(established.ok, JSON.stringify(established)).toBe(true);
    expect(pos.report?.state).toBe("ready");
    expect(pos.report?.pin).toMatchObject({ state: "set" });
    expect(pos.intakeOperations()).not.toBeNull();
    const status = readFileSync(join(dir, "pos-runtime.json"), "utf8");
    expect(status).toContain('"schema": "kitluy.pos-runtime-status.v2"');
    expect(status).toContain('"terminalUnlocked": true');
    expect(status).not.toContain("2468");
    expect(status).not.toContain("pin-sess");

    // Locked: the session is closed on the Hub and intake is gone.
    await pos.lock();
    expect(pos.report?.state).toBe("staff_authentication_required");
    expect(pos.report?.pin).toMatchObject({ state: "set" });
    expect(pos.intakeOperations()).toBeNull();
    expect(readFileSync(join(dir, "pos-runtime.json"), "utf8")).toContain(
      '"terminalUnlocked": false',
    );

    // A wrong PIN is refused with the Hub's count; the right one unlocks.
    const wrong = await pos.unlock({ pin: "0000" });
    expect(wrong).toMatchObject({
      ok: false,
      code: "PIN_INCORRECT",
      pin: { attemptsBeforeLock: 4 },
    });
    expect(pos.intakeOperations()).toBeNull();
    expect((await pos.unlock({ pin: "2468" })).ok).toBe(true);
    expect(pos.report?.state).toBe("ready");
  });

  it("five wrong PINs lock the terminal on the Hub's say-so, and the right PIN does not open it while locked", async () => {
    const h = hub();
    const pos = runtime(h);
    await pos.refresh();
    expect((await pos.setupPin({ pin: "1357", pinConfirmation: "1357" })).ok).toBe(true);
    await pos.lock();
    for (let i = 0; i < 4; i += 1) {
      expect((await pos.unlock({ pin: "9999" })).ok).toBe(false);
    }
    const locking = await pos.unlock({ pin: "9999" });
    expect(locking).toMatchObject({ ok: false, code: "PIN_LOCKED" });
    const whileLocked = await pos.unlock({ pin: "1357" });
    expect(whileLocked).toMatchObject({ ok: false, code: "PIN_LOCKED" });
    const report = await pos.refresh();
    expect(report.state).toBe("staff_authentication_required");
    expect(report.pin?.lockedUntil).not.toBeNull();
    expect(pos.intakeOperations()).toBeNull();
  });

  it("a session the Hub closed elsewhere (a reset) is let go on the next run, never kept on the terminal's word", async () => {
    const h = hub();
    const pos = runtime(h);
    await pos.refresh();
    expect((await pos.setupPin({ pin: "1470", pinConfirmation: "1470" })).ok).toBe(true);
    expect(pos.report?.state).toBe("ready");
    for (const id of h.state.sessions.keys()) h.state.sessions.set(id, "closed");
    expect((await pos.refresh()).state).toBe("staff_authentication_required");
    expect(pos.intakeOperations()).toBeNull();
  });

  it("no PIN action is possible while the terminal-level checks fail", async () => {
    const h = hub();
    const pos = new PiTerminalRuntime({
      socketPath: "/nonexistent",
      applicationVersion: "0.1.0",
      statusPath: null,
      call: h.call,
      bridgeStatus: () =>
        Promise.resolve({ ...STATUS, edge: { phase: "NOT_ACTIVATED", detail: "", checkedAt: "" } }),
      logger: { log: () => undefined },
    });
    const report = await pos.refresh();
    expect(report.state).not.toBe("staff_authentication_required");
    expect(report.pin).toBeUndefined();
    const refused = await pos.setupPin({ pin: "2468", pinConfirmation: "2468" });
    expect(refused.ok).toBe(false);
    expect(h.state.pin).toBeNull();
  });

  // What this proves: a sign-in that lands while the 30-second refresh is blocked
  // inside a Hub read still ends READY. What it does NOT prove: the narrower
  // window `#refreshFromNow` closes (a run that has already passed its staff
  // step, resolved, and not yet cleared itself). That window is a microtask
  // wide and no I/O gate reaches it; a mutation reverting the fix survives this
  // test, and the fix is kept because it is strictly safer, not because a test
  // demonstrated the failure.
  it("an unlock during an in-flight background refresh still ends READY", async () => {
    const h = hub();
    const pos = runtime(h);
    await pos.refresh();
    expect((await pos.setupPin({ pin: "2468", pinConfirmation: "2468" })).ok).toBe(true);
    await pos.lock();
    let release: () => void = () => undefined;
    h.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The 30-second cadence fires and blocks inside the Hub read...
    const background = pos.refresh();
    // ...while someone at the counter enters the PIN.
    const unlocking = pos.unlock({ pin: "2468" });
    await new Promise((r) => setTimeout(r, 10));
    release();
    await background;
    const unlocked = await unlocking;
    expect(unlocked.ok, JSON.stringify(unlocked)).toBe(true);
    expect(pos.report?.state).toBe("ready");
  });
});
