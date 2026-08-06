/**
 * T1 bootstrap ports — WS-12-T001.
 *
 * Every effectful dependency of the bootstrap is a PORT, injected by the
 * composition root (the Electron main process in production, fixtures in the
 * acceptance suite). The machine itself performs no I/O, which is what makes
 * the required startup behaviour testable without launching Electron — the
 * same seam discipline as `electron/terminal-store.ts` (P04C2).
 *
 * NOTHING in these ports lets an installer or user choose Tenant, Digital
 * Store, Location, Hub, environment, terminal profile or assignment
 * generation (owner package §5). Those values enter ONLY through the
 * protected terminal identity and the Hub-signed pairing receipt, both of
 * which are provisioning outcomes the runtime verifies rather than accepts.
 */

import type {
  EdgeDiscoveryExpectation,
  ReceiptExpectation,
  TrustEnvironment,
  TrustedTimeEvaluation,
} from "@kitluy/device-identity";
import type {
  OperationalEligibility,
  OperationalVerdict,
  SignedTerminalConfigurationRecord,
  StoredConfigurationSnapshot,
  StoredPairingReceipt,
} from "@kitluy/terminal-local-store";

// ---------------------------------------------------------------------------
// Protected terminal identity
// ---------------------------------------------------------------------------

/**
 * The terminal's provisioning outcome, loaded from OS-protected storage.
 * It carries PUBLIC identity and expectation material only — the private
 * signing key stays in the OS key store and never crosses this port
 * (terminal-local-store custody rule).
 */
export interface ProtectedTerminalIdentity {
  readonly terminalDeviceId: string;
  readonly terminalCertificateSerial: string;
  readonly terminalCertificateFingerprint: string;
  readonly environment: TrustEnvironment;
  /** The Hub's operational PUBLIC signing key, delivered at provisioning. */
  readonly hubOperationalPublicKeyPem: string;
  /** What the stored pairing receipt must say (recorded at pairing time). */
  readonly receiptExpectation: ReceiptExpectation;
  /** What a signed discovery record must say (cloud-provisioned scope). */
  readonly discoveryExpectation: EdgeDiscoveryExpectation;
  /**
   * Where the Hub was last reached (recorded at pairing time). A HINT for
   * the discovery fetch only — the signed discovery record, not this value,
   * establishes trust. The mDNS listener that would refresh it is a recorded
   * successor gap (no multicast responder exists in the repository yet).
   */
  readonly hubEndpointHint: { readonly hostname: string; readonly port: number };
}

export interface TerminalIdentityPort {
  /** `null` means the terminal was never provisioned — fail closed. */
  load(): ProtectedTerminalIdentity | null;
}

// ---------------------------------------------------------------------------
// Pairing receipt (the terminal-local authority, P04C2)
// ---------------------------------------------------------------------------

/** The subset of `PairingReceiptStore` the bootstrap consumes. */
export interface ReceiptStorePort {
  loadVerifiedCurrentReceipt(input: {
    readonly hubPublicKeyPem: string;
    readonly expectation: ReceiptExpectation;
    readonly at: Date;
  }): StoredPairingReceipt | null;
  authorizeOperationalUse(
    stored: StoredPairingReceipt,
    eligibility: OperationalEligibility,
  ): OperationalVerdict;
}

// ---------------------------------------------------------------------------
// Hub resolution and the mTLS Edge Operations session
// ---------------------------------------------------------------------------

/** A signed discovery payload exactly as it travels (P04B wire shape). */
export interface SignedDiscoveryWirePayload {
  readonly record: {
    readonly protocolVersion: string;
    readonly recordId: string;
    readonly hubDeviceId: string;
    readonly hubCertificateFingerprint: string;
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
    readonly environment: string;
    readonly hostname: string;
    readonly port: number;
    readonly issuedAt: string;
    readonly expiresAt: string;
  };
  /** Unpadded base64url over the canonical record bytes. */
  readonly signature: string;
  readonly signatureAlgorithm: string;
}

export type DiscoveryFetchResult =
  | { readonly outcome: "payload"; readonly payload: SignedDiscoveryWirePayload }
  | { readonly outcome: "unreachable"; readonly detail: string };

export interface HubDiscoveryPort {
  /**
   * Fetch the current signed discovery payload from the assigned Hub's
   * well-known endpoint. Transport trust for THIS fetch is pinned to the
   * pairing receipt's `hubCertificateFingerprint`; the returned record is
   * then verified independently against the Hub operational key.
   */
  fetchSignedDiscovery(): Promise<DiscoveryFetchResult>;
}

export interface VerifiedHubEndpoint {
  readonly hubDeviceId: string;
  readonly hostname: string;
  readonly port: number;
  /** SHA-256 of the TLS server certificate the session MUST see. */
  readonly pinnedCertificateFingerprint: string;
}

/** Session refusals, already classified by the transport adapter. */
export type EdgeSessionRefusalCode =
  | "TERMINAL_NOT_RECOGNIZED"
  | "CREDENTIAL_NOT_CURRENT"
  | "ACTIVATION_REQUIRED"
  | "HUB_CERT_MISMATCH";

export type EdgeSessionResult =
  | { readonly outcome: "established"; readonly session: EdgeOperationsSession }
  | { readonly outcome: "unreachable"; readonly detail: string }
  | {
      readonly outcome: "refused";
      readonly code: EdgeSessionRefusalCode;
      readonly detail: string;
    };

/**
 * An established mutually-authenticated Edge Operations session (the P04A
 * TLS 1.3 transport on 7443). All reads below are Hub-authoritative.
 */
export interface EdgeOperationsSession {
  /** Hub-anchored instant — never the terminal host clock (CLOCK-001). */
  hubTime(): Promise<Date>;
  /** What CURRENT Hub records say about this terminal's eligibility. */
  describeEligibility(): Promise<OperationalEligibility>;
  /** The Hub's active signed configuration snapshot for this terminal. */
  fetchConfigurationSnapshot(): Promise<ConfigurationFetchResult>;
}

export interface EdgeSessionPort {
  establish(
    endpoint: VerifiedHubEndpoint,
    identity: ProtectedTerminalIdentity,
  ): Promise<EdgeSessionResult>;
}

// ---------------------------------------------------------------------------
// Signed configuration
// ---------------------------------------------------------------------------

/**
 * A signed configuration snapshot as delivered to the terminal. The wire and
 * cache shape is ONE type, owned by the terminal-local persistence authority
 * (`@kitluy/terminal-local-store`) so the two can never drift.
 * `schemaVersion` mirrors the Hub's
 * `edge_config.configuration_snapshot.schema_version` contract.
 */
export type SignedTerminalConfiguration = SignedTerminalConfigurationRecord;

/** The cached form: the snapshot plus when THIS terminal verified it. */
export type CachedConfigurationRecord = StoredConfigurationSnapshot;

export type ConfigurationFetchResult =
  | { readonly outcome: "snapshot"; readonly snapshot: SignedTerminalConfiguration }
  | { readonly outcome: "unavailable"; readonly detail: string };

/** The terminal-local cache of the last VALID signed configuration. */
export interface ConfigurationCachePort {
  loadCurrent(): CachedConfigurationRecord | null;
  persistValidated(record: CachedConfigurationRecord): void;
}

// ---------------------------------------------------------------------------
// Trusted time
// ---------------------------------------------------------------------------

export interface TrustedTimePort {
  evaluate(): Promise<TrustedTimeEvaluation>;
}

// ---------------------------------------------------------------------------
// Staff session
// ---------------------------------------------------------------------------

/**
 * A restored or newly opened staff session. Carries evaluation inputs only:
 * profile authorizations and presented permission grants — never a
 * credential verifier, PIN, password or token.
 */
export interface StaffSessionCandidate {
  readonly actorId: string;
  readonly displayName: string;
  /** Logical terminal profile codes this staff member may operate. */
  readonly profileCodes: readonly string[];
  readonly expiresAt: string;
}

export interface StaffSessionPort {
  /**
   * Restore a durable staff session ONLY if one exists and is still valid.
   * `null` requires interactive staff authentication — the fail-closed
   * default after every process restart.
   */
  restore(): Promise<StaffSessionCandidate | null>;
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/**
 * Structured, allow-listed logging. Values are primitives only; the machine
 * never logs key material, tokens, certificate bodies, payloads or
 * signatures (owner package §7; asserted by the acceptance suite).
 */
export interface BootstrapLogger {
  log(event: string, fields: Record<string, string | number | boolean>): void;
}

export interface T1BootstrapPorts {
  readonly identity: TerminalIdentityPort;
  readonly receipts: ReceiptStorePort;
  readonly discovery: HubDiscoveryPort;
  readonly edgeSession: EdgeSessionPort;
  readonly configurationCache: ConfigurationCachePort;
  readonly trustedTime: TrustedTimePort;
  readonly staffSession: StaffSessionPort;
  readonly logger: BootstrapLogger;
}
