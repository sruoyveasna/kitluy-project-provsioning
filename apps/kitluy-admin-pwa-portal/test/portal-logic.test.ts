/**
 * Admin Portal logic: routing, the management client, the guard, sign-in
 * classification and device presentation.
 *
 * The load-bearing tests are the ones about TRUTHFULNESS — a device under
 * containment must not render as ordinary, and an unruled liveness threshold
 * must not become the word "Online". Those are the failures that would be
 * believed.
 */
import { describe, expect, it } from "vitest";

import { resolveAccess, holdsPermission, PERMISSION_FLEET_READ } from "../src/access.js";
import { readPortalConfig, resolvePortalRuntime } from "../src/config.js";
import {
  conditionLabel,
  deviceCondition,
  filterByClass,
  terminalAssignmentSummary,
  freshnessLabel,
  hubAssignmentSummary,
  sortForOperator,
} from "../src/device-presentation.js";
import {
  classifyResponse,
  createManagementClient,
  type FleetDeviceView,
} from "../src/management-client.js";
import { MESSAGES } from "../src/messages.js";
import { parseRoute, routeHref } from "../src/routing.js";
import { classifySignInError, validateCredentials } from "../src/sign-in.js";

const DEVICE: FleetDeviceView = {
  deviceId: "11111111-2222-3333-4444-555555555555",
  deviceReference: "KL-CLOUD-HUB-0001",
  deviceClass: "store_hub",
  hardwareProfile: "CLOUD-HUB-PI5",
  lifecycle: "enrolled",
  trustLevel: "development_software",
  certificateStatus: null,
  assignmentState: null,
  tenantReference: null,
  digitalStoreReference: null,
  locationReference: null,
  digitalStoreLabel: null,
  locationLabel: null,
  terminalAssignmentCount: 0,
  openIncidentCount: 0,
  lastSeenAt: null,
  fleetStatus: "enrolled",
  freshness: "NEVER_SEEN",
  requiresAttention: false,
};

describe("routing", () => {
  it("parses the portal's routes", () => {
    expect(parseRoute("#/login")).toEqual({ kind: "login" });
    expect(parseRoute("#/devices")).toEqual({ kind: "devices" });
    expect(parseRoute("#/devices/abc")).toEqual({ kind: "device", deviceId: "abc" });
    expect(parseRoute("")).toEqual({ kind: "devices" });
    expect(parseRoute("#/")).toEqual({ kind: "devices" });
  });

  it("never throws on hostile input", () => {
    for (const hash of ["#", "#//", "#/devices/a/b/c", "#/%", "#/devices/%zz"]) {
      expect(() => parseRoute(hash)).not.toThrow();
    }
  });

  it("round-trips a device route", () => {
    const route = { kind: "device", deviceId: "a b/c" } as const;
    expect(parseRoute(routeHref(route))).toEqual(route);
  });
});

describe("management response classification", () => {
  it("maps each status to a distinct outcome", () => {
    expect(classifyResponse(200, { userId: "u" })).toMatchObject({ kind: "ok" });
    expect(classifyResponse(401, {})).toMatchObject({ kind: "unauthenticated" });
    expect(classifyResponse(404, {})).toMatchObject({ kind: "not_found" });
  });

  it("carries the denial reason so the portal can show the right message", () => {
    const outcome = classifyResponse(403, {
      error: {
        code: "SCOPE_PERMISSION_DENIED",
        message: "no",
        details: { reason: "KLUY-ADMIN-DISABLED" },
      },
    });
    expect(outcome).toMatchObject({ kind: "denied", reason: "KLUY-ADMIN-DISABLED" });
  });

  it("treats an unexpected status as unavailable, never as data", () => {
    for (const status of [204, 302, 418, 500, 502, 503]) {
      expect(classifyResponse(status, {}).kind).toBe("unavailable");
    }
  });
});

describe("management client transport", () => {
  const page = { devices: [], count: 0, limit: 200, truncated: false, freshnessPolicyRuled: false };

  function client(fetchImpl: typeof fetch, token: string | null = "tok") {
    return createManagementClient({
      baseUrl: "http://localhost:8787",
      accessToken: async () => token,
      fetchImpl,
    });
  }

  it("sends the caller's bearer token to the versioned route", async () => {
    let seenUrl = "";
    let seenAuth: string | null = null;
    const api = client((async (url: string, init?: RequestInit) => {
      seenUrl = url;
      seenAuth = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch);

    await api.listDevices();
    expect(seenUrl).toBe("http://localhost:8787/management/v1/devices");
    expect(seenAuth).toBe("Bearer tok");
  });

  it("does not call the service at all without a session", async () => {
    let called = false;
    const api = client(
      (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
      null,
    );
    expect((await api.getCurrentAdmin()).kind).toBe("unauthenticated");
    expect(called).toBe(false);
  });

  it("reports an unreachable service instead of an empty fleet", async () => {
    const api = client((async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch);
    // The dangerous failure would be rendering "0 devices" here.
    expect(await api.listDevices()).toMatchObject({ kind: "unavailable" });
  });

  it("reports an unusable 200 body as unavailable", async () => {
    const api = client(
      (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch,
    );
    expect((await api.listDevices()).kind).toBe("unavailable");
  });

  it("encodes the device identifier", async () => {
    let seenUrl = "";
    const api = client((async (url: string) => {
      seenUrl = url;
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch);
    await api.getDevice("a/../b");
    expect(seenUrl).toContain("a%2F..%2Fb");
  });
});

describe("route guard", () => {
  it("grants only on an explicit ok", () => {
    const state = resolveAccess({
      kind: "ok",
      value: { userId: "u", permissions: ["fleet.read"] },
    });
    expect(state.kind).toBe("granted");
    expect(holdsPermission(state, PERMISSION_FLEET_READ)).toBe(true);
  });

  it("distinguishes the refusals an operator must be told apart", () => {
    const cases = [
      ["KLUY-ADMIN-NOT-PROVISIONED", "notAdmin"],
      ["KLUY-ADMIN-DISABLED", "accountDisabled"],
      ["KLUY-ADMIN-INACTIVE", "accountInactive"],
      ["KLUY-PERMISSION-DENIED", "accessRefused"],
    ] as const;
    for (const [reason, messageKey] of cases) {
      expect(resolveAccess({ kind: "denied", reason, message: "" })).toMatchObject({
        kind: "refused",
        messageKey,
      });
    }
  });

  it("falls back to a refusal — never a grant — for an unknown reason", () => {
    const state = resolveAccess({ kind: "denied", reason: "KLUY-SOMETHING-NEW", message: "" });
    expect(state.kind).toBe("refused");
  });

  it("sends an unauthenticated caller back to sign in", () => {
    expect(resolveAccess({ kind: "unauthenticated", reason: "x" })).toMatchObject({
      kind: "signed_out",
    });
  });

  it("treats an unreachable service as unavailable, not as permission", () => {
    // Failing "open" here would show an empty control plane as if it were the
    // truth; failing to "denied" would tell an Admin they were revoked.
    expect(resolveAccess({ kind: "unavailable", detail: "down" }).kind).toBe("unavailable");
    expect(resolveAccess({ kind: "not_found" }).kind).toBe("unavailable");
  });

  it("reports no permission while access is still being checked", () => {
    expect(holdsPermission({ kind: "checking" }, PERMISSION_FLEET_READ)).toBe(false);
  });
});

describe("sign-in classification", () => {
  it("checks the fields before touching the network", () => {
    expect(validateCredentials("", "pw")).toBe("missing_email");
    expect(validateCredentials("  ", "pw")).toBe("missing_email");
    expect(validateCredentials("a@b.co", "")).toBe("missing_password");
    expect(validateCredentials("a@b.co", "pw")).toBeNull();
  });

  it("recognises wrong credentials however the library reports them", () => {
    expect(classifySignInError({ code: "invalid_credentials" })).toBe("invalid_credentials");
    expect(classifySignInError({ message: "Invalid login credentials", status: 400 })).toBe(
      "invalid_credentials",
    );
    expect(classifySignInError({ status: 400 })).toBe("invalid_credentials");
  });

  it("recognises a network failure", () => {
    expect(classifySignInError({ name: "AuthRetryableFetchError", status: 0 })).toBe(
      "network_error",
    );
    expect(classifySignInError({ message: "Failed to fetch" })).toBe("network_error");
    expect(classifySignInError({ status: 503 })).toBe("network_error");
  });

  it("falls back to unexpected rather than guessing", () => {
    expect(classifySignInError(null)).toBe("unexpected");
    expect(classifySignInError("boom")).toBe("unexpected");
    expect(classifySignInError({ status: 422 })).toBe("unexpected");
  });
});

describe("device presentation truthfulness", () => {
  it("presents containment states as ABNORMAL", () => {
    for (const lifecycle of ["quarantined", "restricted_investigation", "suspended"]) {
      expect(deviceCondition({ ...DEVICE, lifecycle })).toBe("abnormal");
    }
  });

  it("presents an open trust incident as abnormal even on a healthy lifecycle", () => {
    expect(deviceCondition({ ...DEVICE, openIncidentCount: 1 })).toBe("abnormal");
  });

  it("presents an ordinary enrolled device as normal", () => {
    expect(deviceCondition(DEVICE)).toBe("normal");
  });

  it("never labels an abnormal device with the normal word", () => {
    for (const locale of ["km-KH", "en-US"] as const) {
      expect(conditionLabel("abnormal", locale)).not.toBe(conditionLabel("normal", locale));
    }
  });

  it("never renders UNKNOWN freshness as online", () => {
    for (const locale of ["km-KH", "en-US"] as const) {
      const unknown = freshnessLabel("UNKNOWN", locale);
      expect(unknown).not.toContain("Online");
      expect(unknown).toBe(MESSAGES[locale].freshnessUnknown);
      expect(freshnessLabel("NEVER_SEEN", locale)).toBe(MESSAGES[locale].neverSeen);
    }
  });

  it("maps an unrecognised freshness value to unknown, never to healthy", () => {
    expect(freshnessLabel("SOMETHING_NEW", "en-US")).toBe(MESSAGES["en-US"].freshnessUnknown);
  });

  it("puts abnormal devices first, then stable order by reference", () => {
    const devices = [
      { ...DEVICE, deviceId: "3", deviceReference: "TERM-0001" },
      {
        ...DEVICE,
        deviceId: "1",
        deviceReference: "HUB-0001",
        lifecycle: "restricted_investigation",
      },
      { ...DEVICE, deviceId: "2", deviceReference: "HUB-0002", lifecycle: "quarantined" },
    ];
    expect(sortForOperator(devices).map((d) => d.deviceReference)).toEqual([
      "HUB-0001",
      "HUB-0002",
      "TERM-0001",
    ]);
  });

  it("does not mutate the caller's list", () => {
    const devices = [
      { ...DEVICE, deviceReference: "B" },
      { ...DEVICE, deviceReference: "A", lifecycle: "quarantined" },
    ];
    sortForOperator(devices);
    expect(devices[0]?.deviceReference).toBe("B");
  });
});

describe("portal configuration", () => {
  const ENV = {
    VITE_KITLUY_SUPABASE_URL: "https://projectref.supabase.co",
    VITE_KITLUY_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fictitious",
    VITE_KITLUY_MANAGEMENT_API_URL: "http://localhost:8787/",
  };

  it("reads the three public values and trims the API trailing slash", () => {
    expect(readPortalConfig(ENV).managementApiUrl).toBe("http://localhost:8787");
  });

  it("fails closed on any missing value", () => {
    for (const key of Object.keys(ENV)) {
      const env: Record<string, string | undefined> = { ...ENV };
      delete env[key];
      expect(() => readPortalConfig(env), key).toThrow();
    }
  });

  it("reports misconfiguration instead of throwing during render", () => {
    expect(resolvePortalRuntime({})).toMatchObject({ kind: "misconfigured" });
  });

  it("refuses a privileged credential in the browser slot", () => {
    // The client factory is the one place allowed to build a client, and this
    // is the mistake it exists to convert into a startup error.
    const result = resolvePortalRuntime({
      ...ENV,
      VITE_KITLUY_SUPABASE_PUBLISHABLE_KEY: "sb_secret_pretend",
    });
    expect(result.kind).toBe("misconfigured");
  });

  it("builds a runtime from a valid publishable configuration", () => {
    expect(resolvePortalRuntime(ENV).kind).toBe("ready");
  });
});

describe("message bundle", () => {
  it("covers every key in both locales", () => {
    const km = Object.keys(MESSAGES["km-KH"]).sort();
    const en = Object.keys(MESSAGES["en-US"]).sort();
    expect(km).toEqual(en);
    for (const locale of ["km-KH", "en-US"] as const) {
      for (const [key, value] of Object.entries(MESSAGES[locale])) {
        expect(value.length, `${locale}.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });
});

describe("the Store Hub view", () => {
  // Built on the file's own DEVICE fixture (a store_hub) so this suite cannot
  // drift from the shape the rest of the tests exercise.
  const device = (over: Partial<FleetDeviceView>): FleetDeviceView => ({ ...DEVICE, ...over });

  it("shows every device when the filter is off", () => {
    const all = [device({}), device({ deviceClass: "terminal", deviceId: "t" })];
    expect(filterByClass(all, "all")).toHaveLength(2);
  });

  it("narrows to Store Hubs, which is the question asked when a shop is stuck", () => {
    const all = [device({}), device({ deviceClass: "terminal", deviceId: "t" })];
    const hubs = filterByClass(all, "store_hub");
    expect(hubs).toHaveLength(1);
    expect(hubs[0]?.deviceId).toBe(DEVICE.deviceId);
  });

  it("returns nothing rather than everything when no device matches", () => {
    // Falling back to the unfiltered list would silently answer a different
    // question than the operator asked.
    expect(filterByClass([device({ deviceClass: "terminal" })], "store_hub")).toHaveLength(0);
  });

  it("reports a Hub as SERVING only when its assignment is active", () => {
    const hub = (state: string | null) => hubAssignmentSummary(device({ assignmentState: state }));

    expect(hub("active")?.serving).toBe(true);
    // pending_trust is a correctly paired Hub waiting on BLK-005 activation. It
    // is not faulty and it cannot serve Terminals — both are true at once.
    expect(hub("pending_trust")?.serving).toBe(false);
    expect(hub("revoked")?.serving).toBe(false);
    expect(hub(null)?.state).toBe("unassigned");
    expect(hub(null)?.serving).toBe(false);
  });

  it("refuses to describe a Terminal in Hub terms", () => {
    expect(hubAssignmentSummary(device({ deviceClass: "terminal" }))).toBeNull();
  });
});

describe("a Terminal's assignment, in the four owner-locked stages", () => {
  const terminal = (over: Partial<FleetDeviceView>): FleetDeviceView => ({
    ...DEVICE,
    deviceClass: "terminal",
    ...over,
  });

  it("refuses to describe a Hub in Terminal terms", () => {
    expect(terminalAssignmentSummary(DEVICE)).toBeNull();
  });

  it("reads an unassigned Terminal as unassigned", () => {
    expect(terminalAssignmentSummary(terminal({}))).toEqual({ kind: "unassigned" });
  });

  it("reads pending_trust as ASSIGNED, awaiting activation — with the Store and the profiles", () => {
    const s = terminalAssignmentSummary(
      terminal({
        assignmentState: "pending_trust",
        terminalAssignmentCount: 2,
        digitalStoreLabel: "DEMO-LAUNDRY-001 — Demo Laundry",
      }),
    );
    expect(s).toEqual({
      kind: "assigned_awaiting",
      profiles: 2,
      store: "DEMO-LAUNDRY-001 — Demo Laundry",
    });
  });

  it("reads active as active, and anything else verbatim", () => {
    expect(terminalAssignmentSummary(terminal({ assignmentState: "active" }))?.kind).toBe("active");
    expect(terminalAssignmentSummary(terminal({ assignmentState: "revoked" }))).toEqual({
      kind: "other",
      state: "revoked",
    });
  });
});
