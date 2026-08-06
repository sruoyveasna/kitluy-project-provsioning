/**
 * WS-12-T001-P02 §8 discovery — the LOCKED six-source endpoint order
 * (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §5):
 *
 *   1. assigned private IP
 *   2. assigned hostname
 *   3. signed mDNS discovery
 *   4. last verified endpoint
 *   5. cloud-reported verified endpoint
 *   6. manual recovery IP
 *
 * Proven against the REAL production walk (`resolveHubEndpoint`, the exact
 * function the composed runtime calls) with a recording discovery probe.
 * No candidate is trust: the walk only produces a payload; the bootstrap
 * machine authenticates it identically whatever the source (acceptance
 * test 19 proves the manual-IP case end to end).
 */
import { describe, expect, it } from "vitest";

import { resolveHubEndpoint } from "../electron/t1-runtime.js";
import type {
  ProtectedTerminalIdentity,
  SignedDiscoveryWirePayload,
} from "../src/bootstrap/ports.js";

const PAYLOAD = {
  record: {},
  signature: "sig",
  signatureAlgorithm: "ed25519",
} as unknown as SignedDiscoveryWirePayload;

function identity(over: Partial<ProtectedTerminalIdentity> = {}): ProtectedTerminalIdentity {
  return {
    terminalDeviceId: "t-1",
    terminalCertificateSerial: "01ab",
    terminalCertificateFingerprint: "f".repeat(64),
    environment: "development",
    hubOperationalPublicKeyPem: "PEM",
    receiptExpectation: {
      pairingSessionId: "ps-1",
      transcriptHash: "0".repeat(64),
      hubDeviceId: "hub-1",
      hubCertificateFingerprint: "e".repeat(64),
      terminalDeviceId: "t-1",
      terminalCertificateFingerprint: "f".repeat(64),
      tenantId: "tenant-1",
      digitalStoreId: "store-1",
      storeLocationId: "location-1",
      environment: "development",
      terminalAssignmentGeneration: 1,
      terminalProfileKey: "laundry.t1.intake_cashier",
    },
    discoveryExpectation: {
      tenantId: "tenant-1",
      digitalStoreId: "store-1",
      storeLocationId: "location-1",
      environment: "development",
    },
    hubEndpointHint: { hostname: "hub.store.lan", port: 7443 },
    ...over,
  } as ProtectedTerminalIdentity;
}

describe("locked endpoint order (§5)", () => {
  it("walks every source in exactly the locked order when none answers", async () => {
    const attempted: string[] = [];
    const resolution = await resolveHubEndpoint(
      identity({ assignedPrivateIp: "10.0.0.1", manualRecoveryIp: "10.0.0.99" }),
      {
        readLastVerified: () => ({ hostname: "last.known.lan", port: 7443 }),
        mdnsCandidates: async () => [
          { hostname: "mdns-a.local", port: 7443 },
          { hostname: "mdns-b.local", port: 7443 },
        ],
        cloudReportedEndpoint: async () => ({ hostname: "cloud.reported.lan", port: 7443 }),
        fetchDiscovery: async (hostname) => {
          attempted.push(hostname);
          return null;
        },
      },
    );
    expect(resolution.outcome).toBe("unreachable");
    expect(attempted).toEqual([
      "10.0.0.1", // 1. assigned private IP
      "hub.store.lan", // 2. assigned hostname
      "mdns-a.local", // 3. signed mDNS discovery …
      "mdns-b.local", //    … every candidate, in answer order
      "last.known.lan", // 4. last verified endpoint
      "cloud.reported.lan", // 5. cloud-reported verified endpoint
      "10.0.0.99", // 6. manual recovery IP
    ]);
  });

  it("stops at the FIRST source that answers — later sources are never probed", async () => {
    const attempted: string[] = [];
    const resolution = await resolveHubEndpoint(
      identity({ assignedPrivateIp: "10.0.0.1", manualRecoveryIp: "10.0.0.99" }),
      {
        readLastVerified: () => ({ hostname: "last.known.lan", port: 7443 }),
        mdnsCandidates: async () => [{ hostname: "mdns-a.local", port: 7443 }],
        fetchDiscovery: async (hostname) => {
          attempted.push(hostname);
          return hostname === "10.0.0.1" ? PAYLOAD : null;
        },
      },
    );
    expect(resolution.outcome).toBe("reached");
    if (resolution.outcome === "reached") {
      expect(resolution.source).toBe("assigned_private_ip");
      expect(resolution.hostname).toBe("10.0.0.1");
    }
    expect(attempted).toEqual(["10.0.0.1"]);
  });

  it("absent sources are skipped without disturbing the order; manual recovery IP is LAST", async () => {
    const attempted: string[] = [];
    const resolution = await resolveHubEndpoint(
      identity({ manualRecoveryIp: "10.0.0.99" }), // no private IP
      {
        readLastVerified: () => null, // nothing stored
        mdnsCandidates: async () => {
          throw new Error("mdns socket unavailable"); // degraded, never fatal
        },
        // no cloudReportedEndpoint injected
        fetchDiscovery: async (hostname) => {
          attempted.push(hostname);
          return hostname === "10.0.0.99" ? PAYLOAD : null;
        },
      },
    );
    expect(attempted).toEqual(["hub.store.lan", "10.0.0.99"]);
    expect(resolution.outcome).toBe("reached");
    if (resolution.outcome === "reached") {
      expect(resolution.source).toBe("manual_recovery_ip");
    }
  });
});
