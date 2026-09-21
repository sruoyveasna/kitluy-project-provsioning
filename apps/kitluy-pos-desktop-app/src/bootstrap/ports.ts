/**
 * T1 bootstrap ports — WS-12-T001, revised by WS-12-T001-P02.
 *
 * Every effectful dependency of the bootstrap is a PORT, injected by the
 * composition root (the Electron main process in production, fixtures in
 * the acceptance suite). The machine itself performs no I/O.
 *
 * P02 changes (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001): the session
 * surface speaks the REAL Hub bootstrap routes — authority time (§1),
 * runtime eligibility (§2), signed configuration delivery (§3) and staff
 * sessions (§4) — and the terminal's local trusted-time port is REPLACED by
 * the Hub authority-time anchor: no validity judgement compares a
 * Hub-issued timestamp against the local wall clock.
 *
 * NOTHING in these ports lets an installer or user choose Tenant, Digital
 * Store, Location, Hub, environment, terminal profile or assignment
 * generation (owner package §5). Those values enter ONLY through the
 * protected terminal identity and the Hub-signed pairing receipt.
 */

import type {
  EdgeDiscoveryExpectation,
  ReceiptExpectation,
  TrustEnvironment,
} from "@kitluy/device-identity";
import type {
  OperationalEligibility,
  OperationalVerdict,
  SignedTerminalConfigurationRecord,
  StoredConfigurationSnapshot,
  StoredPairingReceipt,
} from "@kitluy/terminal-local-store";

import type { AuthorityTimeResponse } from "./hub-time.js";

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
   * Endpoint-order source 2 (assigned hostname). A HINT only — the signed
   * discovery record, never this value, establishes trust.
   */
  readonly hubEndpointHint: { readonly hostname: string; readonly port: number };
  /** Endpoint-order source 1 (assigned private IP), when provisioned. */
  readonly assignedPrivateIp?: string | null;
  /**
   * Endpoint-order source 6 (manual recovery IP). Set only by a governed
   * operator recovery flow in the MAIN process — never by the renderer.
   */
  readonly manualRecoveryIp?: string | null;
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
// Hub endpoint resolution (locked six-source order, decision §5)
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

/** The locked candidate order (decision §5). */
export type EndpointSource =
  | "assigned_private_ip"
  | "assigned_hostname"
  | "signed_mdns_discovery"
  | "last_verified_endpoint"
  | "cloud_reported_endpoint"
  | "manual_recovery_ip";

export type EndpointResolution =
  | {
      readonly outcome: "reached";
      readonly source: EndpointSource;
      readonly hostname: string;
      readonly port: number;
      readonly payload: SignedDiscoveryWirePayload;
    }
  | { readonly outcome: "unreachable"; readonly detail: string };

export interface HubEndpointPort {
  /**
   * Walk the locked candidate order; for each candidate, fetch the signed
   * discovery payload over TLS pinned to the provisioning-time Hub
   * certificate fingerprint. The FIRST candidate that answers is returned —
   * verification of the record itself is the machine's job, and a candidate
   * that answers with an unverifiable record is a REFUSAL, not a fallback.
   */
  resolve(identity: ProtectedTerminalIdentity): Promise<EndpointResolution>;
}

export interface VerifiedHubEndpoint {
  readonly hubDeviceId: string;
  readonly hostname: string;
  readonly port: number;
  /** SHA-256 of the TLS server certificate the session MUST see. */
  readonly pinnedCertificateFingerprint: string;
}

// ---------------------------------------------------------------------------
// The mTLS Edge Operations session and the bootstrap reads
// ---------------------------------------------------------------------------

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

/** A classified refusal from a bootstrap read (`details.result`). */
export interface EdgeReadRefusal {
  readonly outcome: "refused";
  readonly result: string;
  readonly retryable: boolean;
  readonly detail: string;
}

/** The §2 eligibility payload as the route returns it. */
export interface RuntimeEligibilityWire {
  readonly protocolVersion: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: string;
  readonly hubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly assignmentId: string;
  readonly assignmentGeneration: number;
  readonly terminalProfileCode: string;
  /** The Store's explicit primary vertical, Hub-attested (v2). */
  readonly primaryVertical: string;
  readonly credentialId: string;
  readonly credentialGeneration: number;
  readonly credentialEligibility: string;
  readonly activationEligibility: string;
  readonly pairingEligibility: string;
  readonly pairedAt: string;
  readonly containmentState: string;
  readonly hubReplacementState: string;
  readonly requiredConfigurationVersion: number | null;
  readonly authorityTime: string;
}

/** The §3 configuration delivery envelope exactly as the route returns it
 * (the `TerminalConfigurationDelivery` field vocabulary, ISO instants). */
export interface ConfigurationDeliveryEnvelopeWire {
  readonly snapshotId: string;
  readonly configurationVersion: number;
  readonly schemaVersion: number;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: string;
  readonly hubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly assignmentGeneration: number;
  readonly terminalProfileCode: string;
  /** The Store's explicit primary vertical, signed into the v2 delivery. */
  readonly primaryVertical: string;
  readonly minimumApplicationVersion: string;
  readonly maximumApplicationVersion: string | null;
  readonly issuedAt: string;
  readonly effectiveAt: string;
  readonly validUntil: string;
  readonly manifestSha256: string;
  readonly payloadSha256: string;
  readonly signingKeyId: string;
  readonly correlationId: string;
}

export interface ConfigurationDeliveryWire {
  readonly delivery: ConfigurationDeliveryEnvelopeWire;
  readonly payloadJson: string;
  readonly deliverySignature: string;
  readonly rollbackReference: number | null;
}

export interface StaffSessionWire {
  readonly sessionId: string;
  readonly actorId: string;
  readonly displayName: string;
  readonly profileCode: string;
  readonly openedAt: string;
  readonly expiresAt: string;
  readonly sessionGeneration: number;
  readonly effectivePermissions: readonly string[];
  readonly authorityTime: string;
}

/**
 * An established mutually-authenticated Edge Operations session (the P04A
 * TLS 1.3 transport on 7443). All reads are Hub-authoritative; a transport
 * failure THROWS, a governed refusal returns an `EdgeReadRefusal`.
 */
export interface EdgeOperationsSession {
  /** §1 — Hub-database authority time. Never the host clock. */
  fetchAuthorityTime(): Promise<AuthorityTimeResponse | EdgeReadRefusal>;
  /** §2 — this terminal's derived runtime eligibility. */
  fetchEligibility(): Promise<
    { readonly outcome: "eligible"; readonly eligibility: RuntimeEligibilityWire } | EdgeReadRefusal
  >;
  /** §3 — the current signed configuration delivery. */
  fetchConfigurationDelivery(): Promise<
    { readonly outcome: "delivery"; readonly wire: ConfigurationDeliveryWire } | EdgeReadRefusal
  >;
  /** §4 — open a staff session (the interactive flow's transport). */
  openStaffSession(input: {
    readonly actorId: string;
    readonly passcode: string;
    readonly profileCode: string;
  }): Promise<{ readonly outcome: "ok"; readonly session: StaffSessionWire } | EdgeReadRefusal>;
  /** §4 — refresh an open staff session within governed policy. */
  refreshStaffSession(
    sessionId: string,
  ): Promise<{ readonly outcome: "ok"; readonly session: StaffSessionWire } | EdgeReadRefusal>;
  /** §4 — close a staff session. */
  closeStaffSession(
    sessionId: string,
  ): Promise<{ readonly outcome: "ok"; readonly session: StaffSessionWire } | EdgeReadRefusal>;
}

export interface EdgeSessionPort {
  establish(
    endpoint: VerifiedHubEndpoint,
    identity: ProtectedTerminalIdentity,
  ): Promise<EdgeSessionResult>;
}

// ---------------------------------------------------------------------------
// Signed configuration cache
// ---------------------------------------------------------------------------

export type SignedTerminalConfiguration = SignedTerminalConfigurationRecord;
export type CachedConfigurationRecord = StoredConfigurationSnapshot;

/** The terminal-local cache of the last VALID signed configuration. */
export interface ConfigurationCachePort {
  loadCurrent(): CachedConfigurationRecord | null;
  persistValidated(record: CachedConfigurationRecord): void;
}

// ---------------------------------------------------------------------------
// Staff session acquisition
// ---------------------------------------------------------------------------

/**
 * A staff session available to the bootstrap: a still-valid durable
 * restoration, or an interactive login already completed through the
 * PUBLIC session adapter. `null` parks the shell at
 * `staff_authentication_required` — the fail-closed default after every
 * process restart. Never carries a verifier, passcode or token.
 */
export interface StaffSessionCandidate {
  readonly actorId: string;
  readonly displayName: string;
  /** Logical terminal profile codes this staff member may operate. */
  readonly profileCodes: readonly string[];
  /** Registered permission keys held at this Location (Amendment 002). */
  readonly effectivePermissions: readonly string[];
  readonly expiresAt: string;
}

export interface StaffSessionPort {
  acquire(session: EdgeOperationsSession): Promise<StaffSessionCandidate | null>;
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
  readonly hubEndpoint: HubEndpointPort;
  readonly edgeSession: EdgeSessionPort;
  readonly configurationCache: ConfigurationCachePort;
  readonly staffSession: StaffSessionPort;
  readonly logger: BootstrapLogger;
  /** Monotonic milliseconds for the Hub-time anchor (§1). */
  readonly monotonicNow: () => number;
}
