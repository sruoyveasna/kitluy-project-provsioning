/**
 * `PiTerminalRuntime` — the controller around the edge bootstrap
 * (T1-STORE-OPERATIONS-001). Fakes answer in the Hub's wire shapes through the
 * runtime's own seams (`call`, `bridgeStatus`); no socket, no clock but the
 * injected monotonic one.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EdgeBridgeStatusWire } from "../src/bootstrap/edge-machine.js";
import { PiTerminalRuntime } from "../electron/pi-runtime.js";
import type { HubCall } from "../electron/edge-operations-session.js";

const T1 = "laundry.t1.intake_cashier";
const TERMINAL = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const HUB = "549a41c6-21e9-4838-8b48-34a3878ba290";
const ACTOR = "e0000000-0000-4000-8000-0000000000aa";
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

/** A scripted Hub. `gate`, when set, holds the NEXT authority-time read open. */
function hub() {
  const state: { passcode: string; gate: Promise<void> | null; opened: number } = {
    passcode: "2468",
    gate: null,
    opened: 0,
  };
  const now = () => new Date().toISOString();
  const payloadJson = "{}";
  const call: HubCall = async (method, path, body) => {
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
    if (method === "POST" && path === "/edge/v1/sessions/open") {
      const input = body as { passcode: string; profileCode: string };
      if (input.passcode !== state.passcode) {
        return {
          status: 403,
          body: { error: { message: "no", details: { result: "STAFF_CREDENTIAL_INVALID" } } },
        };
      }
      state.opened += 1;
      return {
        status: 200,
        body: {
          session: {
            sessionId: "sess-1",
            actorId: ACTOR,
            displayName: "Cashier Sokha",
            profileCode: input.profileCode,
            openedAt: now(),
            expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
            sessionGeneration: 1,
            effectivePermissions: ["pos.t1.use", "laundry.bookings.create"],
            authorityTime: now(),
          },
        },
      };
    }
    if (method === "POST" && path === "/edge/v1/sessions/close") {
      return { status: 200, body: { session: {} } };
    }
    return { status: 404, body: null };
  };
  return { state, call };
}

function runtime(h: ReturnType<typeof hub>) {
  let t = 1_000;
  return new PiTerminalRuntime({
    socketPath: "/nonexistent",
    applicationVersion: "0.1.0",
    statusPath: join(dir, "pos-runtime.json"),
    call: h.call,
    bridgeStatus: () => Promise.resolve(STATUS),
    monotonicNow: () => (t += 1),
    logger: { log: () => undefined },
  });
}

describe("the Pi Terminal runtime", () => {
  it("waits for staff, signs into T1, and opens intake only when READY", async () => {
    const h = hub();
    const pos = runtime(h);
    expect((await pos.refresh()).state).toBe("staff_authentication_required");
    expect(pos.intakeOperations()).toBeNull();
    expect(await pos.signIn({ actorId: ACTOR, passcode: "0000" })).toMatchObject({
      ok: false,
      code: "STAFF_CREDENTIAL_INVALID",
    });
    expect(pos.intakeOperations()).toBeNull();
    const signed = await pos.signIn({ actorId: ACTOR, passcode: "2468" });
    expect(signed.ok).toBe(true);
    expect(pos.report?.state).toBe("ready");
    expect(pos.intakeOperations()).not.toBeNull();
    const status = readFileSync(join(dir, "pos-runtime.json"), "utf8");
    expect(status).toContain('"staffSignedIn": true');
    expect(status).not.toContain("2468");
    expect(status).not.toContain(ACTOR);

    await pos.signOut();
    expect(pos.report?.state).toBe("staff_authentication_required");
    expect(pos.intakeOperations()).toBeNull();
  });

  // What this proves: a sign-in that lands while the 30-second refresh is blocked
  // inside a Hub read still ends READY. What it does NOT prove: the narrower
  // window `#refreshFromNow` closes (a run that has already passed its staff
  // step, resolved, and not yet cleared itself). That window is a microtask
  // wide and no I/O gate reaches it; a mutation reverting the fix survives this
  // test, and the fix is kept because it is strictly safer, not because a test
  // demonstrated the failure.
  it("a sign-in during an in-flight background refresh still ends READY", async () => {
    const h = hub();
    const pos = runtime(h);
    await pos.refresh();
    let release: () => void = () => undefined;
    h.state.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The 30-second cadence fires and blocks inside the Hub read...
    const background = pos.refresh();
    // ...while a cashier signs in.
    const signing = pos.signIn({ actorId: ACTOR, passcode: "2468" });
    await new Promise((r) => setTimeout(r, 10));
    release();
    await background;
    const signed = await signing;
    expect(signed.ok, JSON.stringify(signed)).toBe(true);
    expect(pos.report?.state).toBe("ready");
  });
});
