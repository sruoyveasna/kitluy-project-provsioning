/**
 * @kitluy-services/kitluy-device-firstboot-agent
 *
 * The KitLuy OS firstboot identity bootstrap and cloud enrollment agent. Runs
 * on BOTH image profiles (STORE_HUB and PI_TERMINAL) — a Hub and a terminal
 * are the same platform with different roles, and enrollment is the part they
 * share.
 *
 * STATUS: IMPLEMENTED-IN-DEV (logic and state machine, executed under vitest).
 * NOT hardware-proven: no Raspberry Pi has run this. The systemd units that
 * would invoke it are staged by infra/edge/raspberry-pi/pi-terminal-image but the executables they
 * reference are not yet built, and that gap is recorded rather than described
 * as done.
 *
 * Composition boundary: this agent OWNS no truth. Tenant, Digital Store,
 * Location, Store Hub, terminal profile, lifecycle state and configuration
 * version are all server-derived and arrive through governed contracts.
 */

export { SERVICE_NAME, SERVICE_VERSION } from "./version.js";

export * from "./identity.js";
export * from "./enrollment.js";
export * from "./factory.js";
export * from "./factory-gateway.js";

// Device-side DISPLAY state readers and their path constants. Exported so a
// console that mirrors these phases — the Pi Terminal Device Shell — can assert
// against the real definitions in a drift test rather than a copy of them
// (apps/kitluy-device-shell/test/drift.test.ts). They own no truth; the cloud
// does. See each module's header.
export * from "./registration-state.js";
export * from "./pairing-state.js";
export * from "./bootstrap-state.js";
export * from "./image-env.js";

// The operational TLS client. Exported so the registry service's end-to-end
// suite can drive the REAL device code against the REAL governed route rather
// than a re-implementation of it — the only way that test proves anything.
export * from "./operational-key.js";
export * from "./operational-csr-bytes.js";
export * from "./operational-credential-state.js";
export * from "./operational-certificate-verification.js";
export * from "./operational-tls-client.js";
export * from "./operational-recovery-identity-bytes.js";
export * from "./adapters/http-operational-certificate-client.js";

// The Pi Terminal's link to its Store Hub and the edge bridge the POS reaches it
// through (T1-STORE-OPERATIONS-001). Exported so the POS end-to-end suite drives
// the REAL terminal-edge attempt and the REAL bridge against a real Hub, rather
// than a re-implementation of either.
export { runEdgeAttempt, type EdgeAttemptOptions, type EdgeStatus } from "./edge-session.js";
export {
  BRIDGE_ROUTES,
  EDGE_BRIDGE_SOCKET,
  handleBridgeRequest,
  startEdgeBridge,
  type BridgeDependencies,
  type BridgeTerminalFacts,
  type PinnedHubEndpoint,
} from "./edge-bridge.js";

// The runtime report (T1-STORE-OPERATIONS-001). Exported so the registry's
// integration suite signs reports with the REAL device code.
export {
  collectRuntimeReport,
  nextReportSequence,
  signRuntimeReport,
  type SignedRuntimeReport,
} from "./runtime-report.js";
