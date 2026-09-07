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

  it("has eight rungs in the owner's order", () => {
    expect(LADDER_RUNGS).toEqual([
      "hubActive",
      "issued",
      "redeemed",
      "hubPaired",
      "activated",
      "appInstalled",
      "pinSet",
      "active",
    ]);
  });

  it("with no session: Hub done, issuing is next, the rest not reported", () => {
    const s = state(deriveLadder({ hub: active, terminal: terminal(), session: null }, NOW));
    expect(s).toMatchObject({
      hubActive: "done",
      issued: "current",
      redeemed: "not_reported",
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
    expect(s).toMatchObject({ issued: "done", redeemed: "current", hubPaired: "not_reported" });
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
    expect(state(rungs)).toMatchObject({ issued: "done", redeemed: "done", hubPaired: "current" });
    expect(rungs.find((r) => r.key === "redeemed")?.detail).toBe("KL-6783D70CB6BF");
  });

  it("an active device marks activated, and never invents app / PIN / serving", () => {
    const bound = terminal({
      boundDevice: {
        deviceId: "d",
        deviceReference: "KL-1",
        lifecycle: "active",
        assignmentState: "active",
      },
    });
    const s = state(deriveLadder({ hub: active, terminal: bound, session: null }, NOW));
    expect(s).toMatchObject({
      activated: "done",
      hubPaired: "current",
      appInstalled: "not_reported",
      pinSet: "not_reported",
      active: "not_reported",
    });
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
      hubPaired: "not_reported",
    });
    expect(rungs[0]?.reason).toBe("hubNotActive");
  });

  it("an unreported Hub blocks with its own reason", () => {
    const rungs = deriveLadder({ hub: hubReadiness({}), terminal: terminal(), session: null }, NOW);
    expect(rungs[0]).toMatchObject({ state: "blocked", reason: "hubUnreported" });
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
