/**
 * T1 runtime composition root — WS-12-T001.
 *
 * Wires the bootstrap machine's ports to the REAL adapters that exist today
 * and to explicit fail-closed defaults where the authority does not exist
 * yet. Nothing here invents a route, a permission key or a trust anchor:
 *
 *   REAL      terminal identity file (safeStorage custody)
 *   REAL      pairing-receipt store + configuration cache (encrypted SQLite)
 *   REAL      signed-discovery fetch over pinned TLS (P04B route)
 *   REAL      mTLS establishment with certificate pinning (P04A transport)
 *   FAIL-CLOSED  transport credentials (BLK-005 gates private-key custody)
 *   FAIL-CLOSED  trusted time (T003 providers are hardware wiring; the
 *                default refuses rather than trusting the host clock —
 *                KLD-2026-08-06-WS11-CLOCK-001)
 *   FAIL-CLOSED  eligibility/configuration reads (no approved `/edge/v1`
 *                route serves them yet — recorded WS-12-T002+ dependency)
 *   FAIL-CLOSED  staff session restore (no durable staff session exists;
 *                restart always re-authenticates)
 *   FAIL-CLOSED  configuration signature verification (review condition C4)
 */
import type { TrustedTimeEvaluation } from "@kitluy/device-identity";
import type { OsEncryptionFacility } from "@kitluy/terminal-local-store";

import { bootstrapT1 } from "../src/bootstrap/machine.js";
import type {
  DiscoveryFetchResult,
  EdgeSessionResult,
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
import { openTerminalPairingStore } from "./terminal-store.js";
import { protectedTerminalIdentityPort } from "./terminal-identity.js";

const WELL_KNOWN_DISCOVERY_PATH = "/.well-known/kitluy-edge-discovery/v1";

/** Fail-closed trusted time: no provider, no trust — never the host clock. */
function unavailableTrustedTime(): TrustedTimeEvaluation {
  return {
    status: "restricted_no_trusted_source",
    trustedTime: null,
    source: "none",
    floorAdvanced: false,
    anomalyType: null,
    detail:
      "no trusted-time provider is wired in this composition; the host clock is diagnostic only",
  };
}

export interface T1RuntimeOptions {
  readonly credentials?: TransportCredentialProvider;
  readonly trustedTime?: () => Promise<TrustedTimeEvaluation>;
}

/** Compose the production-shaped runtime and run one full bootstrap. */
export async function runT1Bootstrap(
  safeStorage: OsEncryptionFacility,
  userDataPath: string,
  options: T1RuntimeOptions = {},
): Promise<T1BootstrapReport> {
  const credentials = options.credentials ?? unavailableTransportCredentials();
  const identityPort = protectedTerminalIdentityPort(safeStorage, userDataPath);

  // The store opens lazily so an unprovisioned terminal reports
  // `recovery_required` from the identity step instead of failing on custody.
  let opened: ReturnType<typeof openTerminalPairingStore> | null = null;
  const store = (): ReturnType<typeof openTerminalPairingStore> => {
    opened = opened ?? openTerminalPairingStore(safeStorage, userDataPath);
    return opened;
  };

  let identityForTransport: ProtectedTerminalIdentity | null = null;

  const ports: T1BootstrapPorts = {
    identity: {
      load: () => {
        identityForTransport = identityPort.load();
        return identityForTransport;
      },
    },
    receipts: {
      loadVerifiedCurrentReceipt: (input) => store().receipts.loadVerifiedCurrentReceipt(input),
      authorizeOperationalUse: (stored, eligibility) =>
        store().receipts.authorizeOperationalUse(stored, eligibility),
    },
    discovery: {
      async fetchSignedDiscovery(): Promise<DiscoveryFetchResult> {
        const identity = identityForTransport;
        if (identity === null) {
          return { outcome: "unreachable", detail: "no terminal identity is loaded" };
        }
        try {
          const response = await pinnedHubRequest({
            hostname: identity.hubEndpointHint.hostname,
            port: identity.hubEndpointHint.port,
            method: "GET",
            path: WELL_KNOWN_DISCOVERY_PATH,
            pinnedCertificateFingerprint: identity.receiptExpectation.hubCertificateFingerprint,
            credentials: credentials.obtain(),
          });
          if (response.status !== 200) {
            return { outcome: "unreachable", detail: `discovery returned ${response.status}` };
          }
          return {
            outcome: "payload",
            payload: response.body as SignedDiscoveryWirePayload,
          };
        } catch (error) {
          return {
            outcome: "unreachable",
            detail: error instanceof Error ? error.message : "discovery fetch failed",
          };
        }
      },
    },
    edgeSession: {
      async establish(endpoint: VerifiedHubEndpoint): Promise<EdgeSessionResult> {
        try {
          // Establishing the session IS the mutual TLS handshake against the
          // pinned certificate; the discovery route doubles as the probe.
          const probe = await pinnedHubRequest({
            hostname: endpoint.hostname,
            port: endpoint.port,
            method: "GET",
            path: WELL_KNOWN_DISCOVERY_PATH,
            pinnedCertificateFingerprint: endpoint.pinnedCertificateFingerprint,
            credentials: credentials.obtain(),
          });
          if (probe.status !== 200) {
            return { outcome: "unreachable", detail: `the Hub answered ${probe.status}` };
          }
          return {
            outcome: "established",
            session: {
              hubTime: () =>
                Promise.reject(
                  new Error(
                    "KLUY-TERMINAL-HUB-TIME-UNSERVED: no approved /edge/v1 route serves Hub time to a terminal yet",
                  ),
                ),
              describeEligibility: () =>
                Promise.reject(
                  new Error(
                    "KLUY-TERMINAL-ELIGIBILITY-UNSERVED: no approved /edge/v1 route serves terminal eligibility yet",
                  ),
                ),
              fetchConfigurationSnapshot: () =>
                Promise.resolve({
                  outcome: "unavailable" as const,
                  detail:
                    "KLUY-TERMINAL-CONFIG-UNSERVED: no approved /edge/v1 route delivers a configuration snapshot yet",
                }),
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "session establishment failed";
          if (message.includes("KLUY-TERMINAL-HUB-CERT-MISMATCH")) {
            return { outcome: "refused", code: "HUB_CERT_MISMATCH", detail: message };
          }
          return { outcome: "unreachable", detail: message };
        }
      },
    },
    configurationCache: {
      loadCurrent: () => store().configuration.loadCurrent(),
      persistValidated: (record) => {
        store().configuration.persistValidated(record);
      },
    },
    trustedTime: {
      evaluate: options.trustedTime ?? (() => Promise.resolve(unavailableTrustedTime())),
    },
    staffSession: {
      // No durable staff session authority exists; a restart always requires
      // interactive staff authentication.
      restore: () => Promise.resolve(null),
    },
    logger: {
      log: (event, fields) => {
        console.log(JSON.stringify({ event, ...fields }));
      },
    },
  };

  return bootstrapT1(ports);
}
