/**
 * T1 runtime composition root — WS-12-T001, completed by WS-12-T001-P02.
 *
 * Wires the bootstrap machine's ports to CONCRETE adapters speaking the
 * owner-approved Hub bootstrap routes
 * (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001):
 *
 *   REAL  terminal identity file (safeStorage custody, atomic writer)
 *   REAL  pairing-receipt store + configuration cache (encrypted SQLite)
 *   REAL  endpoint resolution in the locked six-source order, including
 *         the mDNS/DNS-SD listener (`_kitluy-edge._tcp.local`)
 *   REAL  signed-discovery fetch and mTLS establishment with pinning
 *   REAL  authority-time / eligibility / configuration / session adapters
 *   FAIL-CLOSED  transport credentials (BLK-005 gates key custody)
 *   FAIL-CLOSED  staff acquisition (no durable session exists; a restart
 *                always re-authenticates interactively)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import type { OsEncryptionFacility } from "@kitluy/terminal-local-store";

import { bootstrapT1 } from "../src/bootstrap/machine.js";
import type {
  EdgeOperationsSession,
  EdgeSessionResult,
  EndpointResolution,
  EndpointSource,
  ProtectedTerminalIdentity,
  SignedDiscoveryWirePayload,
  T1BootstrapPorts,
  VerifiedHubEndpoint,
} from "../src/bootstrap/ports.js";
import type { T1BootstrapReport } from "../src/bootstrap/states.js";
import {
  pinnedHubRequest,
  unavailableTransportCredentials,
  type TransportCredentialProvider,
} from "./lan-client.js";
import { discoverKitluyHubCandidates, multicastSocket, type MulticastSocketPort } from "./mdns.js";
import { createEdgeOperationsSession } from "./edge-operations-session.js";
import { openTerminalPairingStore } from "./terminal-store.js";
import { protectedTerminalIdentityPort } from "./terminal-identity.js";

const WELL_KNOWN_DISCOVERY_PATH = "/.well-known/kitluy-edge-discovery/v1";

const LAST_VERIFIED_ENDPOINT_FILE = "last-verified-hub-endpoint.json";

interface StoredEndpoint {
  readonly hostname: string;
  readonly port: number;
}

/** Non-secret endpoint memo (trust never derives from it). */
function readLastVerifiedEndpoint(userDataPath: string): StoredEndpoint | null {
  const file = path.join(userDataPath, "terminal-state", LAST_VERIFIED_ENDPOINT_FILE);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as StoredEndpoint;
    return typeof parsed.hostname === "string" && typeof parsed.port === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export function recordLastVerifiedEndpoint(userDataPath: string, endpoint: StoredEndpoint): void {
  const file = path.join(userDataPath, "terminal-state", LAST_VERIFIED_ENDPOINT_FILE);
  writeFileSync(file, JSON.stringify(endpoint), { mode: 0o600 });
}

export interface T1RuntimeOptions {
  readonly credentials?: TransportCredentialProvider;
  /** mDNS socket factory — injected so tests can drive real DNS packets. */
  readonly mdnsSocket?: () => MulticastSocketPort;
  readonly mdnsTimeoutMs?: number;
  /** Cloud-reported endpoint source (§5 order, position 5). Absent → skipped. */
  readonly cloudReportedEndpoint?: () => Promise<StoredEndpoint | null>;
  readonly applicationVersion?: string;
  /**
   * Staff acquisition. The production default returns `null` (a restart
   * always re-authenticates interactively). The completed interactive
   * login supplies its result through this seam — always via the PUBLIC
   * session adapter, never a side channel.
   */
  readonly staffSession?: T1BootstrapPorts["staffSession"];
}

/** Injectable dependencies for the locked six-source endpoint walk. */
export interface EndpointResolutionDeps {
  readonly readLastVerified: () => StoredEndpoint | null;
  readonly mdnsCandidates: () => Promise<readonly StoredEndpoint[]>;
  readonly cloudReportedEndpoint?: () => Promise<StoredEndpoint | null>;
  readonly fetchDiscovery: (
    hostname: string,
    port: number,
  ) => Promise<SignedDiscoveryWirePayload | null>;
}

/**
 * The §5 endpoint walk in the LOCKED order: assigned private IP → assigned
 * hostname → signed mDNS discovery → last verified endpoint →
 * cloud-reported verified endpoint → manual recovery IP. Every candidate
 * merely produces a discovery payload; NO candidate is trust — the machine
 * authenticates the record's signature before the endpoint may pin any
 * session, whatever the source (a manual recovery IP included).
 */
export async function resolveHubEndpoint(
  identity: ProtectedTerminalIdentity,
  deps: EndpointResolutionDeps,
): Promise<EndpointResolution> {
  const attempts: Array<{ source: EndpointSource; endpoint: StoredEndpoint | null }> = [
    {
      source: "assigned_private_ip",
      endpoint:
        typeof identity.assignedPrivateIp === "string"
          ? { hostname: identity.assignedPrivateIp, port: identity.hubEndpointHint.port }
          : null,
    },
    { source: "assigned_hostname", endpoint: identity.hubEndpointHint },
  ];
  // Source 3: signed mDNS discovery — candidates only; trust follows.
  let mdnsCandidates: readonly StoredEndpoint[] = [];
  try {
    mdnsCandidates = await deps.mdnsCandidates();
  } catch {
    mdnsCandidates = [];
  }
  for (const candidate of mdnsCandidates) {
    attempts.push({ source: "signed_mdns_discovery", endpoint: candidate });
  }
  attempts.push({ source: "last_verified_endpoint", endpoint: deps.readLastVerified() });
  if (deps.cloudReportedEndpoint !== undefined) {
    try {
      attempts.push({
        source: "cloud_reported_endpoint",
        endpoint: await deps.cloudReportedEndpoint(),
      });
    } catch {
      attempts.push({ source: "cloud_reported_endpoint", endpoint: null });
    }
  }
  attempts.push({
    source: "manual_recovery_ip",
    endpoint:
      typeof identity.manualRecoveryIp === "string"
        ? { hostname: identity.manualRecoveryIp, port: identity.hubEndpointHint.port }
        : null,
  });

  for (const attempt of attempts) {
    if (attempt.endpoint === null) continue;
    const payload = await deps.fetchDiscovery(attempt.endpoint.hostname, attempt.endpoint.port);
    if (payload !== null) {
      return {
        outcome: "reached",
        source: attempt.source,
        hostname: attempt.endpoint.hostname,
        port: attempt.endpoint.port,
        payload,
      };
    }
  }
  return {
    outcome: "unreachable",
    detail: "no endpoint candidate answered with a discovery payload",
  };
}

/** Compose the production-shaped runtime and run one full bootstrap. */
export async function runT1Bootstrap(
  safeStorage: OsEncryptionFacility,
  userDataPath: string,
  options: T1RuntimeOptions = {},
): Promise<T1BootstrapReport> {
  const credentials = options.credentials ?? unavailableTransportCredentials();
  const identityPort = protectedTerminalIdentityPort(safeStorage, userDataPath);

  let opened: ReturnType<typeof openTerminalPairingStore> | null = null;
  const store = (): ReturnType<typeof openTerminalPairingStore> => {
    opened = opened ?? openTerminalPairingStore(safeStorage, userDataPath);
    return opened;
  };

  const fetchDiscoveryAt = async (
    identity: ProtectedTerminalIdentity,
    hostname: string,
    port: number,
  ): Promise<SignedDiscoveryWirePayload | null> => {
    try {
      // The discovery fetch is CA-anchored (provisioned Hub CA) with the
      // DEFAULT TLS server-identity check — hostname/IP binding is never
      // disabled. Trust still does not come from this connection: the
      // record's Ed25519 signature must verify under the provisioned Hub
      // operational key BEFORE its TLS fingerprint may pin any session
      // (machine.ts step 2), and freshness is re-judged under Hub time.
      const response = await pinnedHubRequest({
        hostname,
        port,
        method: "GET",
        path: WELL_KNOWN_DISCOVERY_PATH,
        credentials: credentials.obtain(),
        timeoutMs: 4_000,
      });
      if (response.status !== 200) return null;
      return response.body as SignedDiscoveryWirePayload;
    } catch {
      return null;
    }
  };

  const ports: T1BootstrapPorts = {
    identity: identityPort,
    receipts: {
      loadVerifiedCurrentReceipt: (input) => store().receipts.loadVerifiedCurrentReceipt(input),
      authorizeOperationalUse: (stored, eligibility) =>
        store().receipts.authorizeOperationalUse(stored, eligibility),
    },
    hubEndpoint: {
      resolve: (identity): Promise<EndpointResolution> =>
        resolveHubEndpoint(identity, {
          readLastVerified: () => readLastVerifiedEndpoint(userDataPath),
          mdnsCandidates: async () => {
            const socket = (options.mdnsSocket ?? multicastSocket)();
            try {
              return (
                await discoverKitluyHubCandidates(socket, options.mdnsTimeoutMs ?? 1_500)
              ).map((c) => ({ hostname: c.hostname, port: c.port }));
            } finally {
              socket.close();
            }
          },
          ...(options.cloudReportedEndpoint === undefined
            ? {}
            : { cloudReportedEndpoint: options.cloudReportedEndpoint }),
          fetchDiscovery: (hostname, port) => fetchDiscoveryAt(identity, hostname, port),
        }),
    },
    edgeSession: {
      async establish(endpoint: VerifiedHubEndpoint): Promise<EdgeSessionResult> {
        const call = async (
          method: "GET" | "POST" | "PATCH",
          requestPath: string,
          body?: unknown,
          headers?: Record<string, string>,
        ): Promise<{ status: number; body: unknown }> =>
          pinnedHubRequest({
            hostname: endpoint.hostname,
            port: endpoint.port,
            method,
            path: requestPath,
            pinnedCertificateFingerprint: endpoint.pinnedCertificateFingerprint,
            credentials: credentials.obtain(),
            ...(body === undefined ? {} : { body }),
            ...(headers === undefined ? {} : { headers }),
          });
        const session: EdgeOperationsSession = createEdgeOperationsSession(call);
        // Prove the mTLS boundary once; classification of governed refusals
        // happens per-read.
        try {
          const probe = await call("GET", WELL_KNOWN_DISCOVERY_PATH);
          if (probe.status !== 200) {
            return { outcome: "unreachable", detail: `the Hub answered ${probe.status}` };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "session establishment failed";
          if (message.includes("KLUY-TERMINAL-HUB-CERT-MISMATCH")) {
            return { outcome: "refused", code: "HUB_CERT_MISMATCH", detail: message };
          }
          return { outcome: "unreachable", detail: message };
        }
        return { outcome: "established", session };
      },
    },
    configurationCache: {
      loadCurrent: () => store().configuration.loadCurrent(),
      persistValidated: (record) => {
        store().configuration.persistValidated(record);
      },
    },
    staffSession: options.staffSession ?? {
      // No durable staff session authority exists; a restart always requires
      // interactive staff authentication through the session adapter above.
      acquire: () => Promise.resolve(null),
    },
    logger: {
      log: (event, fields) => {
        console.log(JSON.stringify({ event, ...fields }));
      },
    },
    monotonicNow: () => performance.now(),
  };

  const report = await bootstrapT1(ports, {
    ...(options.applicationVersion === undefined
      ? {}
      : { applicationVersion: options.applicationVersion }),
  });
  if ((report.state === "ready" || report.state === "offline_ready") && report.hub !== undefined) {
    recordLastVerifiedEndpoint(userDataPath, {
      hostname: report.hub.hostname,
      port: report.hub.port,
    });
  }
  return report;
}
