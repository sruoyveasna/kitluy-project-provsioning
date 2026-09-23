/**
 * The Terminals screen's logic, tested without a browser or a server.
 *
 * Every place the screen could LIE: offering Pair against a Hub that is not
 * active (or not reported), inventing a ladder rung nothing reported, sending a
 * request the API would refuse, showing a code after it was used, or offering
 * a role vocabulary for a vertical the API never named.
 */
import { describe, expect, it } from "vitest";

import { classifyManagementResponse } from "../src/management-request.js";
import { classifyPairingResponse } from "../src/pairing-client.js";
import { codeLife } from "../src/pairing-presentation.js";
import {
  canOpenTerminalSession,
  codePresentation,
  deriveLadder,
  hubReadiness,
  LADDER_RUNGS,
  sessionFacts,
} from "../src/terminal-presentation.js";
import {
  roleShortCode,
  roleVocabulary,
  validateTerminalLabel,
  validateTerminalRoles,
} from "../src/terminal-roles.js";
import { createTerminalsClient, type PhysicalTerminal } from "../src/terminals-client.js";
import { MESSAGES } from "../src/messages.js";

const NOW = new Date("2026-09-04T10:00:00Z");
const STORE = "22222222-2222-4222-8222-222222222222";
const KEYS = ["laundry.t1.intake_cashier", "laundry.t2.customer_display"];

function terminal(over: Partial<PhysicalTerminal> = {}): PhysicalTerminal {
  return {
    physicalTerminalId: "t-1",
    digitalStoreId: STORE,
    storeLocationId: "l-1",
    locationReference: "BKK1 — Boeung Keng Kang 1",
    label: "Front Counter 01",
    terminalProfileKeys: KEYS,
    boundDevice: null,
    lastSession: null,
    createdAt: "2026-09-04T09:00:00Z",
    ...over,
  };
}

describe("transport classification", () => {
  it("tells every outcome apart, and never lets an odd status through as ok", () => {
    expect(classifyManagementResponse(200, {}).kind).toBe("ok");
    expect(classifyManagementResponse(201, {}).kind).toBe("ok");
    expect(classifyManagementResponse(401, {}).kind).toBe("unauthenticated");
    expect(classifyManagementResponse(403, {}).kind).toBe("denied");
    expect(classifyManagementResponse(404, {}).kind).toBe("not_found");
    expect(classifyManagementResponse(422, { error: { message: "no" } })).toEqual({
      kind: "refused",
      message: "no",
    });
    for (const status of [204, 302, 418, 500, 503]) {
      expect(classifyManagementResponse(status, {}).kind).toBe("unavailable");
    }
  });

  it("keeps the Hub client's contract: a 404 is unavailable there", () => {
    expect(classifyPairingResponse(404, {}).kind).toBe("unavailable");
  });
});

describe("the Terminals client sends exactly what the API accepts", () => {
  function capture() {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = ((url: string, init?: RequestInit) => {
      seen.push({ url, init });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            terminal: terminal(),
            terminals: [terminal()],
            code: "ABCD8291",
            sessionId: "s",
            expiresAt: "2026-09-04T10:15:00Z",
            ttlSeconds: 900,
            showOnce: true,
            physicalTerminalId: "t-1",
            label: "Front Counter 01",
            terminalProfileKeys: KEYS,
            storeHubReference: null,
            detail: "",
          }),
          { status: 201 },
        ),
      );
    }) as unknown as typeof fetch;
    const client = createTerminalsClient({
      baseUrl: "http://localhost:8787",
      accessToken: async () => "token-abc",
      fetchImpl,
    });
    return { seen, client };
  }

  it("defines a seat with the exact body, omitting a blank name", async () => {
    const { seen, client } = capture();
    await client.defineTerminal({
      digitalStoreId: STORE,
      storeLocationId: "l-1",
      label: "  ",
      terminalProfileKeys: KEYS,
    });
    expect(seen[0]?.url).toBe("http://localhost:8787/management/v1/partner/terminals");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({
      digitalStoreId: STORE,
      storeLocationId: "l-1",
      terminalProfileKeys: KEYS,
    });
    expect((seen[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-abc",
    );
  });

  it("opens a session naming only the seat, and re-validates the code", async () => {
    const { seen, client } = capture();
    const outcome = await client.openSession({ physicalTerminalId: "t-1" });
    expect(seen[0]?.url).toBe("http://localhost:8787/management/v1/terminal-pairing-sessions");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual({ physicalTerminalId: "t-1" });
    expect(outcome.kind).toBe("ok");
  });

  it("lists, watches and cancels at the right paths", async () => {
    const { seen, client } = capture();
    await client.listTerminals(STORE);
    await client.sessionStatus("sess 1");
    await client.cancelSession("sess 1");
    expect(seen.map((s) => s.url)).toEqual([
      `http://localhost:8787/management/v1/partner/stores/${STORE}/terminals`,
      "http://localhost:8787/management/v1/terminal-pairing-sessions/sess%201",
      "http://localhost:8787/management/v1/terminal-pairing-sessions/sess%201/cancel",
    ]);
    expect(JSON.parse(String(seen[2]?.init?.body))).toEqual({});
  });

  it("does not call the network without a session", async () => {
    let called = false;
    const client = createTerminalsClient({
      baseUrl: "http://localhost:8787",
      accessToken: async () => null,
      fetchImpl: (() => {
        called = true;
        return Promise.resolve(new Response("{}"));
      }) as unknown as typeof fetch,
    });
    expect((await client.listTerminals(STORE)).kind).toBe("unauthenticated");
    expect(called).toBe(false);
  });

  it("treats a 200 with the wrong shape as unavailable, never as an empty list", async () => {
    const client = createTerminalsClient({
      baseUrl: "http://localhost:8787",
      accessToken: async () => "t",
      fetchImpl: (() =>
        Promise.resolve(
          new Response(JSON.stringify({ nope: 1 }), { status: 200 }),
        )) as unknown as typeof fetch,
    });
    expect((await client.listTerminals(STORE)).kind).toBe("unavailable");
    expect((await client.openSession({ physicalTerminalId: "t-1" })).kind).toBe("unavailable");
  });
});

describe("the Store Hub is the precondition, and it fails closed", () => {
  it("allows Pair only for an active Hub", () => {
    expect(
      canOpenTerminalSession(hubReadiness({ hub: { deviceReference: "KL-1", state: "active" } })),
    ).toEqual({ allowed: true });
    expect(
      canOpenTerminalSession(
        hubReadiness({ hub: { deviceReference: "KL-1", state: "pending_trust" } }),
      ),
    ).toEqual({ allowed: false, reason: "hubNotActive" });
    expect(
      canOpenTerminalSession(hubReadiness({ hub: { deviceReference: null, state: "none" } })),
    ).toEqual({ allowed: false, reason: "hubNone" });
    expect(
      canOpenTerminalSession(hubReadiness({ hub: { deviceReference: null, state: "weird" } })),
    ).toEqual({ allowed: false, reason: "hubNotActive" });
    expect(canOpenTerminalSession(hubReadiness({}))).toEqual({
      allowed: false,
      reason: "hubUnreported",
    });
  });
});

describe("the ladder reports, never infers", () => {
  const active = hubReadiness({ hub: { deviceReference: "KL-HUB", state: "active" } });
  const pending = hubReadiness({ hub: { deviceReference: "KL-HUB", state: "pending_trust" } });
  const state = (rungs: ReturnType<typeof deriveLadder>) =>
    Object.fromEntries(rungs.map((r) => [r.key, r.state]));
  const activeDevice = {
    deviceId: "d",
    deviceReference: "KL-1",
    lifecycle: "active",
    assignmentState: "active",
  };
  const RELEASE = "0b6f3f58-8d5a-4f52-9f59-6d2f8d7f0a11";
  const OTHER_RELEASE = "1c7e4f69-9e6b-4a63-8a6a-7e3a9e8a1b22";
  type Runtime = NonNullable<PhysicalTerminal["runtime"]>;
  const APPLICATION: NonNullable<Runtime["application"]> = {
    product: "kitluy-terminal",
    installedReleaseId: RELEASE,
    installedVersion: "0.1.0-t1a",
    journalPhase: "COMMITTED",
    lastOutcome: "INSTALLED",
    runningReleaseId: RELEASE,
    unitActive: true,
  };
  const POS: NonNullable<Runtime["pos"]> = {
    state: "ready",
    refusalCode: null,
    applicationVersion: "0.1.0",
    configurationVersion: 7,
    configurationFreshness: "current",
    terminalUnlocked: true,
  };
  const PIN_SET = { state: "set" as const, setAt: "2026-09-04T09:00:00Z", lockedUntil: null };
  const SERVING: NonNullable<Runtime["hubLink"]> = {
    phase: "SERVING",
    hubDeviceId: "h",
    checkedAt: "2026-09-04T09:59:20Z",
    terminalPin: PIN_SET,
  };
  function runtime(over: Partial<Runtime> = {}): Runtime {
    return {
      source: "device_reported",
      receivedAt: "2026-09-04T09:59:30Z",
      ageSeconds: 30,
      hubLink: SERVING,
      application: APPLICATION,
      pos: POS,
      ...over,
    };
  }

  it("has ten rungs in the owner's order — the PIN right after the Hub link, before the application", () => {
    // KLD-2026-09-19-PIN-AFTER-PAIRING-001: paired -> connected -> PIN on the
    // Shell -> the POS installs. The update agent holds the first install while
    // the Hub says setup_required, so this is the sequence a Partner watches.
    expect(LADDER_RUNGS).toEqual([
      "hubActive",
      "issued",
      "redeemed",
      "activated",
      "hubConnected",
      "pinSet",
      "appInstalled",
      "appRunning",
      "configurationLoaded",
      "active",
    ]);
    expect(LADDER_RUNGS.indexOf("pinSet")).toBeLessThan(LADDER_RUNGS.indexOf("appInstalled"));
  });

  it("with no session: Hub done, issuing is next, the rest not reported", () => {
    const s = state(deriveLadder({ hub: active, terminal: terminal(), session: null }, NOW));
    expect(s).toMatchObject({
      hubActive: "done",
      issued: "current",
      redeemed: "not_reported",
      hubConnected: "not_reported",
      pinSet: "not_reported",
      active: "not_reported",
    });
  });

  it("with a live session: issued done, redeemed next", () => {
    const session = sessionFacts({
      sessionId: "s",
      state: "open",
      expiresAt: "2026-09-04T10:10:00Z",
      pairedAt: null,
      failedAttemptCount: 0,
      locked: false,
    });
    const s = state(deriveLadder({ hub: active, terminal: terminal(), session }, NOW));
    expect(s).toMatchObject({ issued: "done", redeemed: "current" });
  });

  it("an expired session is not an issued code", () => {
    const session = sessionFacts({
      sessionId: "s",
      state: "open",
      expiresAt: "2026-09-04T09:00:00Z",
      pairedAt: null,
      failedAttemptCount: 0,
      locked: false,
    });
    expect(state(deriveLadder({ hub: active, terminal: terminal(), session }, NOW)).issued).toBe(
      "current",
    );
  });

  it("a paired session and a bound device mark redeemed with the device reference", () => {
    const bound = terminal({
      boundDevice: {
        deviceId: "d",
        deviceReference: "KL-6783D70CB6BF",
        lifecycle: "awaiting_trust",
        assignmentState: "pending_trust",
      },
    });
    const rungs = deriveLadder({ hub: active, terminal: bound, session: null }, NOW);
    expect(state(rungs)).toMatchObject({ issued: "done", redeemed: "done", activated: "current" });
    expect(rungs.find((r) => r.key === "redeemed")?.detail).toBe("KL-6783D70CB6BF");
  });

  it("an active device with NO runtime report: activated done, connection is next — nothing invented", () => {
    const s = state(
      deriveLadder(
        { hub: active, terminal: terminal({ boundDevice: activeDevice }), session: null },
        NOW,
      ),
    );
    expect(s).toMatchObject({
      activated: "done",
      hubConnected: "current",
      appInstalled: "not_reported",
      appRunning: "not_reported",
      configurationLoaded: "not_reported",
      pinSet: "not_reported",
      active: "not_reported",
    });
  });

  it("a fresh report of everything: connected, installed (version), running, configuration loaded, PIN set, Operational — each device-reported", () => {
    const rungs = deriveLadder(
      {
        hub: active,
        terminal: terminal({ boundDevice: activeDevice, runtime: runtime() }),
        session: null,
      },
      NOW,
    );
    expect(state(rungs)).toMatchObject({
      hubConnected: "done",
      appInstalled: "done",
      appRunning: "done",
      configurationLoaded: "done",
      pinSet: "done",
      active: "done",
    });
    expect(rungs.find((r) => r.key === "appInstalled")).toMatchObject({
      detail: "0.1.0-t1a",
      source: "device_reported",
    });
    expect(rungs.find((r) => r.key === "configurationLoaded")?.detail).toBe("v7");
    expect(rungs.find((r) => r.key === "pinSet")?.source).toBe("device_reported");
    expect(rungs.find((r) => r.key === "active")?.source).toBe("device_reported");
    expect(rungs.find((r) => r.key === "activated")?.source).toBeUndefined();
  });

  it("PIN set comes ONLY from the Store Hub's answer — never from the application running", () => {
    for (const terminalPin of [undefined, null] as const) {
      const r = runtime({ hubLink: { ...SERVING, terminalPin } });
      const s = state(
        deriveLadder(
          {
            hub: active,
            terminal: terminal({ boundDevice: activeDevice, runtime: r }),
            session: null,
          },
          NOW,
        ),
      );
      expect(s).toMatchObject({
        appRunning: "done",
        configurationLoaded: "done",
        pinSet: "current",
        active: "not_reported",
      });
    }
    const setupRequired = runtime({
      hubLink: {
        ...SERVING,
        terminalPin: { state: "setup_required", setAt: null, lockedUntil: null },
      },
    });
    expect(
      state(
        deriveLadder(
          {
            hub: active,
            terminal: terminal({ boundDevice: activeDevice, runtime: setupRequired }),
            session: null,
          },
          NOW,
        ),
      ),
    ).toMatchObject({ pinSet: "current", active: "not_reported" });
  });

  it("OPERATIONAL is never done without the PIN set (LOCKED §10), nor with any earlier rung missing", () => {
    const cases: Array<[string, Partial<Runtime>]> = [
      ["no PIN", { hubLink: { ...SERVING, terminalPin: null } }],
      [
        "PIN awaiting reset",
        {
          hubLink: {
            ...SERVING,
            terminalPin: { state: "reset_required", setAt: null, lockedUntil: null },
          },
        },
      ],
      [
        "not running",
        { application: { ...APPLICATION, unitActive: false, runningReleaseId: null } },
      ],
      [
        "no configuration",
        { pos: { ...POS, state: "hub_unavailable", configurationVersion: null } },
      ],
      ["not connected", { hubLink: { ...SERVING, phase: "DEGRADED" } }],
    ];
    for (const [label, over] of cases) {
      const s = state(
        deriveLadder(
          {
            hub: active,
            terminal: terminal({ boundDevice: activeDevice, runtime: runtime(over) }),
            session: null,
          },
          NOW,
        ),
      );
      expect(s.active, label).not.toBe("done");
    }
  });

  it("a locked PIN is set but the Terminal is not Operational, and the ladder says why", () => {
    const r = runtime({
      hubLink: { ...SERVING, terminalPin: { ...PIN_SET, lockedUntil: "2026-09-04T10:14:00Z" } },
    });
    const rungs = deriveLadder(
      { hub: active, terminal: terminal({ boundDevice: activeDevice, runtime: r }), session: null },
      NOW,
    );
    // Set, and the next step is the unlock — said on the rung itself, never "done".
    expect(state(rungs)).toMatchObject({ pinSet: "done", active: "current" });
    expect(rungs.find((r) => r.key === "pinSet")?.note).toBe("pinLocked");
  });

  it("a PIN awaiting reset is the step to look at, in words", () => {
    const r = runtime({
      hubLink: {
        ...SERVING,
        terminalPin: { state: "reset_required", setAt: null, lockedUntil: null },
      },
    });
    const rungs = deriveLadder(
      { hub: active, terminal: terminal({ boundDevice: activeDevice, runtime: r }), session: null },
      NOW,
    );
    expect(rungs.find((r) => r.key === "pinSet")).toMatchObject({
      state: "current",
      note: "pinResetRequired",
      source: "device_reported",
    });
  });

  it("installed is not running: a committed release the unit is not running", () => {
    const r = runtime({
      application: { ...APPLICATION, unitActive: false, runningReleaseId: null },
    });
    const s = state(
      deriveLadder(
        {
          hub: active,
          terminal: terminal({ boundDevice: activeDevice, runtime: r }),
          session: null,
        },
        NOW,
      ),
    );
    expect(s).toMatchObject({ appInstalled: "done", appRunning: "current" });
  });

  it("the launcher running ANOTHER release is not this release running", () => {
    const r = runtime({
      application: { ...APPLICATION, runningReleaseId: OTHER_RELEASE },
    });
    const s = state(
      deriveLadder(
        {
          hub: active,
          terminal: terminal({ boundDevice: activeDevice, runtime: r }),
          session: null,
        },
        NOW,
      ),
    );
    expect(s.appRunning).toBe("current");
  });

  it("a paired but refused link is not connected; a POS that never loaded a configuration has not loaded one", () => {
    const r = runtime({
      hubLink: { phase: "HUB_REFUSED", hubDeviceId: "h", checkedAt: "2026-09-04T09:59:20Z" },
      pos: { ...POS, state: "hub_unavailable", configurationVersion: null },
    });
    const s = state(
      deriveLadder(
        {
          hub: active,
          terminal: terminal({ boundDevice: activeDevice, runtime: r }),
          session: null,
        },
        NOW,
      ),
    );
    expect(s).toMatchObject({
      hubConnected: "current",
      appInstalled: "done",
      configurationLoaded: "not_reported",
    });
  });

  it("a report the cloud received too long ago is STALE — not done, not 'nothing yet'", () => {
    const rungs = deriveLadder(
      {
        hub: active,
        terminal: terminal({ boundDevice: activeDevice, runtime: runtime({ ageSeconds: 181 }) }),
        session: null,
      },
      NOW,
    );
    expect(state(rungs)).toMatchObject({
      activated: "done",
      hubConnected: "stale",
      appInstalled: "stale",
      appRunning: "stale",
      configurationLoaded: "stale",
      pinSet: "stale",
      active: "stale",
    });
  });

  it("a report is ignored for a seat with no bound device", () => {
    const s = state(
      deriveLadder({ hub: active, terminal: terminal({ runtime: runtime() }), session: null }, NOW),
    );
    expect(s.hubConnected).toBe("not_reported");
    expect(s.appInstalled).toBe("not_reported");
  });

  it("a Hub that is not active blocks the next rung but keeps done rungs done", () => {
    const bound = terminal({
      boundDevice: {
        deviceId: "d",
        deviceReference: "KL-1",
        lifecycle: "awaiting_trust",
        assignmentState: "pending_trust",
      },
    });
    const rungs = deriveLadder({ hub: pending, terminal: bound, session: null }, NOW);
    expect(state(rungs)).toMatchObject({
      hubActive: "blocked",
      issued: "done",
      redeemed: "done",
    });
    expect(rungs[0]?.reason).toBe("hubNotActive");
  });

  it("an unreported Hub blocks with its own reason", () => {
    const rungs = deriveLadder({ hub: hubReadiness({}), terminal: terminal(), session: null }, NOW);
    expect(rungs[0]).toMatchObject({ state: "blocked", reason: "hubUnreported" });
  });

  it("no rung is unbuilt any more: every rung can be reported", () => {
    const s = state(
      deriveLadder(
        {
          hub: active,
          terminal: terminal({ boundDevice: activeDevice, runtime: runtime() }),
          session: null,
        },
        NOW,
      ),
    );
    expect(Object.values(s)).not.toContain("unbuilt");
  });

  it("every rung has a label in both languages, and so does every state", () => {
    for (const locale of ["km-KH", "en-US"] as const) {
      const m = MESSAGES[locale];
      for (const key of [
        "rungHubConnected",
        "rungAppRunning",
        "rungConfigurationLoaded",
        "rungStale",
        "deviceReported",
        "pinLocked",
        "pinResetRequired",
      ] as const) {
        expect(m[key].length).toBeGreaterThan(0);
      }
    }
  });

  // 2026-09-23: a Store Hub whose volume would not unlock never started its edge
  // API, and this ladder said "Connected to the Store Hub — Next" and no more —
  // so a Hub that was DOWN read exactly like a terminal that could not FIND one.
  // The board knew the difference and had nowhere to say it.
  it("says WHERE and WHY while the Hub rung is not done, and goes quiet once it serves", () => {
    const refused = deriveLadder(
      {
        hub: active,
        terminal: terminal({
          boundDevice: activeDevice,
          runtime: runtime({
            hubLink: {
              phase: "NO_HUB_FOUND",
              hubDeviceId: null,
              checkedAt: "2026-09-04T09:59:20Z",
              terminalPin: null,
              endpoint: { host: "172.16.13.204", port: 7443 },
              detail: "did not complete a mutual-TLS handshake (connect ECONNREFUSED)",
            },
          }),
        }),
        session: null,
      },
      NOW,
    );
    const stuck = refused.find((r) => r.key === "hubConnected");
    expect(stuck?.state).not.toBe("done");
    expect(stuck?.detail).toContain("172.16.13.204:7443");
    expect(stuck?.detail).toContain("mutual-TLS");

    // Serving: the address is noise on a till that works.
    const serving = deriveLadder(
      {
        hub: active,
        terminal: terminal({ boundDevice: activeDevice, runtime: runtime() }),
        session: null,
      },
      NOW,
    );
    const ok = serving.find((r) => r.key === "hubConnected");
    expect(ok?.state).toBe("done");
    expect(ok?.detail).toBeUndefined();
  });
});

describe("the code panel's face", () => {
  const expired = codeLife("2026-09-04T09:00:00Z", NOW);
  const live = codeLife("2026-09-04T10:10:00Z", NOW);
  it("success wins over the clock; a lock beats expiry; expiry beats live", () => {
    expect(codePresentation({ paired: true, locked: false }, expired)).toBe("paired");
    expect(codePresentation({ paired: false, locked: true }, expired)).toBe("locked");
    expect(codePresentation({ paired: false, locked: false }, expired)).toBe("expired");
    expect(codePresentation(null, live)).toBe("live");
  });
});

describe("the role vocabulary comes from the vertical, labels from the app", () => {
  it("offers the four laundry profiles, each with a label in both locales", () => {
    const v = roleVocabulary("LAUNDRY");
    expect(v.kind).toBe("offered");
    if (v.kind !== "offered") return;
    expect(v.roles.map((r) => r.key)).toEqual([
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
      "laundry.t3.ready_scan_in",
      "laundry.t4.pickup_scan_out",
    ]);
    expect(v.roles.map((r) => r.short)).toEqual(["T1", "T2", "T3", "T4"]);
    for (const r of v.roles) {
      expect(MESSAGES["km-KH"][r.labelKey].length).toBeGreaterThan(0);
      expect(MESSAGES["en-US"][r.labelKey].length).toBeGreaterThan(0);
    }
  });

  it("offers nothing for an unreported or unsupported vertical", () => {
    expect(roleVocabulary(undefined)).toEqual({ kind: "unreported" });
    expect(roleVocabulary(null)).toEqual({ kind: "unreported" });
    expect(roleVocabulary("RETAIL")).toEqual({ kind: "unsupported", vertical: "RETAIL" });
  });

  it("short codes come from the key shape; a retired identifier has none", () => {
    expect(roleShortCode("laundry.t2.customer_display")).toBe("T2");
    expect(roleShortCode("t2_scan_in")).toBeNull();
  });

  it("validates the optional name and the role set", () => {
    expect(validateTerminalLabel("")).toBeNull();
    expect(validateTerminalLabel("x".repeat(65))).toBe("labelTooLong");
    const v = roleVocabulary("laundry");
    expect(validateTerminalRoles([], v)).toBe("rolesRequired");
    expect(validateTerminalRoles(["t2_scan_in"], v)).toBe("roleUnknown");
    expect(validateTerminalRoles(KEYS, v)).toBeNull();
    expect(validateTerminalRoles(KEYS, roleVocabulary(undefined))).toBe("roleUnknown");
  });
});
