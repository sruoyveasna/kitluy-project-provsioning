/**
 * `bootstrapT1ThroughEdge` — the Pi Terminal startup (T1-STORE-OPERATIONS-001).
 *
 * Every row is a state a real shop reaches, and every refusal must land in the
 * closed §5 vocabulary with a named code. The fakes answer in the Hub's own
 * wire shapes; nothing here reads a wall clock (the anchor is monotonic).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  bootstrapT1ThroughEdge,
  type EdgeBootstrapPorts,
  type EdgeBridgeStatusWire,
  type EdgeVerifiedConfiguration,
} from "../src/bootstrap/edge-machine.js";
import type {
  ConfigurationDeliveryWire,
  EdgeOperationsSession,
  EdgeReadRefusal,
  RuntimeEligibilityWire,
  StaffSessionCandidate,
} from "../src/bootstrap/ports.js";

const T1 = "laundry.t1.intake_cashier";
const TERMINAL = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const HUB = "549a41c6-21e9-4838-8b48-34a3878ba290";
const SCOPE = {
  tenantId: "e0000000-0000-4000-8000-000000000001",
  digitalStoreId: "e0000000-0000-4000-8000-000000000002",
  storeLocationId: "e0000000-0000-4000-8000-000000000003",
};
const HUB_NOW = new Date("2026-09-17T03:00:00.000Z");

function status(overrides: Partial<EdgeBridgeStatusWire> = {}): EdgeBridgeStatusWire {
  return {
    edge: { phase: "SERVING", detail: "connected", checkedAt: HUB_NOW.toISOString() },
    hub: { hubDeviceId: HUB, host: "172.16.13.205", port: 7443 },
    terminal: { deviceId: TERMINAL, assignmentGeneration: 3, profileCodes: [T1] },
    ...overrides,
  };
}

function eligibility(overrides: Partial<RuntimeEligibilityWire> = {}): RuntimeEligibilityWire {
  return {
    protocolVersion: "1.0",
    ...SCOPE,
    environment: "development",
    hubDeviceId: HUB,
    terminalDeviceId: TERMINAL,
    assignmentId: "a1",
    assignmentGeneration: 3,
    terminalProfileCode: T1,
    credentialId: "c1",
    credentialGeneration: 3,
    credentialEligibility: "eligible",
    activationEligibility: "activated",
    pairingEligibility: "paired",
    pairedAt: HUB_NOW.toISOString(),
    containmentState: "none",
    hubReplacementState: "normal",
    requiredConfigurationVersion: null,
    authorityTime: HUB_NOW.toISOString(),
    ...overrides,
  };
}

function delivery(
  overrides: Partial<ConfigurationDeliveryWire["delivery"]> = {},
  payloadJson = '{"sections":[]}',
): ConfigurationDeliveryWire {
  return {
    delivery: {
      snapshotId: "s1",
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
      issuedAt: new Date(HUB_NOW.getTime() - 60_000).toISOString(),
      effectiveAt: new Date(HUB_NOW.getTime() - 60_000).toISOString(),
      validUntil: new Date(HUB_NOW.getTime() + 3_600_000).toISOString(),
      manifestSha256: "m".repeat(64),
      payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
      signingKeyId: "k1",
      correlationId: "x",
      ...overrides,
    },
    payloadJson,
    deliverySignature: "AAAA",
    rollbackReference: null,
  };
}

const STAFF: StaffSessionCandidate = {
  actorId: "e0000000-0000-4000-8000-0000000000aa",
  displayName: "Cashier Sokha",
  profileCodes: [T1],
  effectivePermissions: ["pos.t1.use", "laundry.bookings.create"],
  expiresAt: new Date(HUB_NOW.getTime() + 1_800_000).toISOString(),
};

const refused = (result: string): EdgeReadRefusal => ({
  outcome: "refused",
  result,
  retryable: false,
  detail: result,
});

interface Script {
  status?: EdgeBridgeStatusWire | Error;
  eligibility?: RuntimeEligibilityWire | EdgeReadRefusal;
  delivery?: ConfigurationDeliveryWire | EdgeReadRefusal | Error;
  staff?: StaffSessionCandidate | null;
  cache?: EdgeVerifiedConfiguration | null;
}

function ports(script: Script = {}) {
  let cache = script.cache ?? null;
  const calls: string[] = [];
  const hub: EdgeOperationsSession = {
    fetchAuthorityTime: () => {
      calls.push("time");
      return Promise.resolve({
        protocolVersion: "1.0",
        authorityTime: HUB_NOW.toISOString(),
        authoritySource: "hub_database",
        responseId: "r",
        generatedAt: HUB_NOW.toISOString(),
        maxCacheAgeSeconds: 30,
        correlationId: "c",
      });
    },
    fetchEligibility: () => {
      calls.push("eligibility");
      const e = script.eligibility ?? eligibility();
      return Promise.resolve("outcome" in e ? e : { outcome: "eligible" as const, eligibility: e });
    },
    fetchConfigurationDelivery: () => {
      calls.push("configuration");
      const d = script.delivery ?? delivery();
      if (d instanceof Error) return Promise.reject(d);
      return Promise.resolve("outcome" in d ? d : { outcome: "delivery" as const, wire: d });
    },
    openStaffSession: () => Promise.reject(new Error("not used")),
    refreshStaffSession: () => Promise.reject(new Error("not used")),
    closeStaffSession: () => Promise.reject(new Error("not used")),
  };
  const p: EdgeBootstrapPorts = {
    bridgeStatus: () =>
      script.status instanceof Error
        ? Promise.reject(script.status)
        : Promise.resolve(script.status ?? status()),
    hub,
    configurationCache: {
      loadCurrent: () => cache,
      persist: (record) => {
        cache = record;
      },
    },
    staffSession: {
      acquire: () => Promise.resolve(script.staff === undefined ? STAFF : script.staff),
    },
    logger: { log: () => undefined },
    monotonicNow: () => 1_000,
  };
  return { ports: p, calls, cache: () => cache };
}

describe("the Pi Terminal reaches READY through the edge", () => {
  it("walks the vocabulary to READY and names what it could not verify", async () => {
    const { ports: p } = ports();
    const report = await bootstrapT1ThroughEdge(p, { applicationVersion: "0.1.0" });
    expect(report.state).toBe("ready");
    expect(report.transitions).toEqual([
      "starting",
      "connecting_to_hub",
      "configuration_loading",
      "ready",
    ]);
    expect(report.configuration).toMatchObject({ configurationVersion: 7, freshness: "current" });
    expect(report.staff).toEqual({ actorId: STAFF.actorId, displayName: STAFF.displayName });
    expect(report.hub?.hubDeviceId).toBe(HUB);
    // Said, never implied: the Hub signatures are NOT verified on this path.
    expect(report.link).toEqual({
      transport: "edge_bridge",
      hubAuthentication: "terminal_edge_mtls_pinned",
      hubSignatures: "not_verified_hub_key_not_provisioned",
    });
  });

  it("stops at STAFF AUTHENTICATION REQUIRED with the configuration loaded when nobody is signed in", async () => {
    const { ports: p } = ports({ staff: null });
    const report = await bootstrapT1ThroughEdge(p);
    expect(report.state).toBe("staff_authentication_required");
    expect(report.configuration?.configurationVersion).toBe(7);
    expect(report.refusalCode).toBeUndefined();
  });

  it("a staff session without pos.t1.use never reaches READY", async () => {
    const { ports: p } = ports({
      staff: { ...STAFF, effectivePermissions: ["laundry.bookings.create"] },
    });
    const report = await bootstrapT1ThroughEdge(p);
    expect(report.state).toBe("staff_authentication_required");
    expect(report.refusalCode).toBe("STAFF_T1_PERMISSION_MISSING");
  });
});

describe("every refusal fails closed into a named state", () => {
  it.each<[string, Script, string, string]>([
    [
      "the bridge cannot be reached",
      { status: new Error("ECONNREFUSED") },
      "hub_unavailable",
      "EDGE_BRIDGE_UNAVAILABLE",
    ],
    [
      "the board has no cloud identity",
      {
        status: status({ terminal: { deviceId: null, assignmentGeneration: 3, profileCodes: [] } }),
      },
      "recovery_required",
      "IDENTITY_MISSING",
    ],
    [
      "the terminal is not activated",
      {
        status: status({ edge: { phase: "NOT_ACTIVATED", detail: "", checkedAt: "" }, hub: null }),
      },
      "recovery_required",
      "ACTIVATION_REQUIRED",
    ],
    [
      "no Hub is verified yet",
      { status: status({ hub: null }) },
      "hub_unavailable",
      "HUB_DISCOVERY_UNREACHABLE",
    ],
    [
      "the Hub asks for pairing",
      { eligibility: refused("PAIRING_REQUIRED") },
      "recovery_required",
      "PAIRING_REQUIRED",
    ],
    [
      "the Hub holds a newer receipt (generation stale)",
      { eligibility: refused("ASSIGNMENT_GENERATION_STALE") },
      "assignment_invalid",
      "ASSIGNMENT_GENERATION_STALE",
    ],
    [
      "the credential is revoked",
      { eligibility: refused("CREDENTIAL_NOT_CURRENT") },
      "credential_invalid",
      "CREDENTIAL_NOT_CURRENT",
    ],
    [
      "the Hub grants no T1",
      { eligibility: refused("PROFILE_NOT_T1") },
      "profile_not_authorized",
      "PROFILE_NOT_T1",
    ],
    [
      "eligibility answers for another terminal",
      { eligibility: eligibility({ terminalDeviceId: "00000000-0000-4000-8000-000000000999" }) },
      "credential_invalid",
      "ELIGIBILITY_TERMINAL_MISMATCH",
    ],
    [
      "eligibility names a Hub other than the pinned one",
      { eligibility: eligibility({ hubDeviceId: "00000000-0000-4000-8000-000000000998" }) },
      "assignment_invalid",
      "ELIGIBILITY_HUB_MISMATCH",
    ],
    [
      "the Hub serves an older generation than this board's seat",
      { eligibility: eligibility({ assignmentGeneration: 2 }) },
      "assignment_invalid",
      "ASSIGNMENT_GENERATION_MISMATCH",
    ],
    [
      "containment is in force",
      { eligibility: eligibility({ containmentState: "quarantined" }) },
      "assignment_invalid",
      "CONTAINMENT_PROHIBITS",
    ],
    [
      "the eligible profile is T2",
      { eligibility: eligibility({ terminalProfileCode: "laundry.t2.customer_display" }) },
      "profile_not_authorized",
      "PROFILE_NOT_T1",
    ],
    [
      "eligibility is outside the 30-second Hub-time window",
      {
        eligibility: eligibility({
          authorityTime: new Date(HUB_NOW.getTime() - 60_000).toISOString(),
        }),
      },
      "hub_unavailable",
      "ELIGIBILITY_STALE",
    ],
    [
      "the configuration is for another location",
      { delivery: delivery({ storeLocationId: "e0000000-0000-4000-8000-00000000ffff" }) },
      "assignment_invalid",
      "CONFIG_SCOPE_MISMATCH",
    ],
    [
      "the configuration is for another profile",
      { delivery: delivery({ terminalProfileCode: "laundry.t3.ready_scan_in" }) },
      "assignment_invalid",
      "CONFIG_SCOPE_MISMATCH",
    ],
    [
      "the configuration payload was altered",
      { delivery: { ...delivery(), payloadJson: '{"sections":["tampered"]}' } },
      "configuration_incompatible",
      "CONFIG_PAYLOAD_DIGEST_MISMATCH",
    ],
    [
      "the configuration has expired under Hub time",
      { delivery: delivery({ validUntil: new Date(HUB_NOW.getTime() - 1).toISOString() }) },
      "stale_configuration",
      "CONFIG_EXPIRED",
    ],
    [
      "this application version is too old",
      { delivery: delivery({ minimumApplicationVersion: "9.0.0" }) },
      "configuration_incompatible",
      "CONFIG_APP_VERSION_INCOMPATIBLE",
    ],
    [
      "a governed refusal of the delivery never degrades to a cache",
      {
        delivery: refused("ASSIGNMENT_SCOPE_MISMATCH"),
        cache: { wire: delivery(), verifiedAtHubTime: HUB_NOW.toISOString() },
      },
      "assignment_invalid",
      "ASSIGNMENT_SCOPE_MISMATCH",
    ],
    [
      "the Hub cannot deliver and nothing was ever obtained",
      { delivery: refused("DELIVERY_SIGNER_UNAVAILABLE") },
      "recovery_required",
      "CONFIG_NEVER_OBTAINED",
    ],
  ])("%s", async (_name, script, state, code) => {
    const { ports: p } = ports(script);
    const report = await bootstrapT1ThroughEdge(p);
    expect(report.state).toBe(state);
    expect(report.refusalCode).toBe(code);
    expect(report.link?.transport).toBe("edge_bridge");
  });
});

describe("offline: only unavailability degrades, and only to a re-judged configuration", () => {
  it("the Hub cannot deliver now, a verified configuration from this run exists: OFFLINE_READY, labelled cached", async () => {
    const { ports: p } = ports({
      delivery: refused("DELIVERY_SIGNER_UNAVAILABLE"),
      cache: { wire: delivery(), verifiedAtHubTime: HUB_NOW.toISOString() },
    });
    const report = await bootstrapT1ThroughEdge(p);
    expect(report.state).toBe("offline_ready");
    expect(report.configuration?.freshness).toBe("cached_offline");
  });

  it("an expired cached configuration is NOT offline ready", async () => {
    const { ports: p } = ports({
      delivery: new Error("socket hang up"),
      cache: {
        wire: delivery({ validUntil: new Date(HUB_NOW.getTime() - 1).toISOString() }),
        verifiedAtHubTime: HUB_NOW.toISOString(),
      },
    });
    const report = await bootstrapT1ThroughEdge(p);
    expect(report.state).toBe("stale_configuration");
  });

  it("a cached configuration bound to an older generation is refused, not reused", async () => {
    const { ports: p } = ports({
      delivery: refused("CONFIGURATION_MISSING"),
      cache: {
        wire: delivery({ assignmentGeneration: 2 }),
        verifiedAtHubTime: HUB_NOW.toISOString(),
      },
    });
    const report = await bootstrapT1ThroughEdge(p);
    expect(report.state).toBe("assignment_invalid");
    expect(report.refusalCode).toBe("CONFIG_SCOPE_MISMATCH");
  });

  it("a delivered configuration is what the cache holds afterwards", async () => {
    const harness = ports();
    await bootstrapT1ThroughEdge(harness.ports);
    expect(harness.cache()?.wire.delivery.configurationVersion).toBe(7);
  });
});

describe("no later step runs when an earlier one refuses", () => {
  it("a refused eligibility reads no configuration and asks for no staff", async () => {
    const harness = ports({ eligibility: refused("CREDENTIAL_NOT_CURRENT") });
    await bootstrapT1ThroughEdge(harness.ports);
    expect(harness.calls).toEqual(["time", "eligibility"]);
  });
});
