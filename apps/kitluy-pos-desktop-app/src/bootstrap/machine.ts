/**
 * T1 startup bootstrap — WS-12-T001, completed by WS-12-T001-P02.
 *
 * Implements the owner package §5 required behaviour through the REAL Hub
 * bootstrap contract (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001):
 *
 *   1. load the protected terminal identity;
 *   2. resolve a Hub endpoint (locked six-source order) and establish the
 *      mutually-authenticated Edge Operations session;
 *   3. obtain Hub-database AUTHORITY TIME and anchor it monotonically;
 *   4. verify the signed discovery record under Hub time;
 *   5. load and verify the current pairing receipt under Hub time;
 *   6. read runtime eligibility and judge the receipt against it (§11);
 *   7. verify the assigned profile includes T1;
 *   8. obtain, verify and cache the signed configuration delivery;
 *   9. acquire the staff session and evaluate required permissions
 *      (`pos.t1.use` — session membership alone never authorizes T1);
 *  10. enter the T1 application shell.
 *
 * Every failure maps into the closed §5 state vocabulary and FAILS CLOSED.
 * Cloud availability is consulted NOWHERE. NO validity judgement compares a
 * Hub-issued timestamp against the local wall clock: the only clock in this
 * file is the monotonic-advanced Hub anchor, and an expired anchor is
 * re-acquired or the startup fails into a named state
 * (KLD-2026-08-06-WS11-CLOCK-001 unchanged).
 */

import {
  evaluateConfigurationSnapshot,
  verifyEdgeDiscoveryRecord,
  verifyTerminalConfigurationDelivery,
  TRUST_ENVIRONMENTS,
  type ConfigurationRejectionCode,
  type ConfigurationSnapshot,
  type EdgeDiscoveryRecord,
  type TrustEnvironment,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";
import { TERMINAL_PROFILE_T1_INTAKE_CASHIER } from "@kitluy/edge-contracts";
import { REJECTED_TERMINAL_IDENTIFIERS } from "@kitluy-verticals/phase1-laundry";
import type { OperationalEligibility, StoredPairingReceipt } from "@kitluy/terminal-local-store";
import { createHash } from "node:crypto";

import { HubTimeAnchor, parseAuthorityTime } from "./hub-time.js";
import type {
  CachedConfigurationRecord,
  ConfigurationDeliveryWire,
  EdgeOperationsSession,
  EdgeReadRefusal,
  ProtectedTerminalIdentity,
  RuntimeEligibilityWire,
  SignedTerminalConfiguration,
  StaffSessionCandidate,
  T1BootstrapPorts,
  VerifiedHubEndpoint,
} from "./ports.js";
import type {
  ActiveConfigurationSummary,
  ConfigurationFreshness,
  T1BootstrapReport,
  T1RuntimeState,
} from "./states.js";

/** The one configuration schema contract this runtime speaks (Hub 0003). */
export const SUPPORTED_CONFIGURATION_SCHEMA_VERSION = 1 as const;

/** Simple dotted-numeric version comparison for compatibility bounds. */
export function compareApplicationVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

interface StaffAuthorizationVerdict {
  readonly authorized: boolean;
  readonly refusalCode?:
    "STAFF_SESSION_EXPIRED" | "STAFF_PROFILE_NOT_AUTHORIZED" | "STAFF_T1_PERMISSION_MISSING";
  readonly detail?: string;
}

/**
 * Step 9 — required permission evaluation for the T1 shell: the staff
 * member must be authorized for the exact owner-locked T1 profile AND hold
 * the registered `pos.t1.use` permission (Amendment 002). Opening or
 * restoring a session never authorizes T1 by itself.
 */
export function evaluateStaffAuthorization(
  candidate: {
    readonly profileCodes: readonly string[];
    readonly effectivePermissions: readonly string[];
    readonly expiresAt: string;
  },
  at: Date,
): StaffAuthorizationVerdict {
  const expiresAt = new Date(candidate.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || at.getTime() >= expiresAt.getTime()) {
    return {
      authorized: false,
      refusalCode: "STAFF_SESSION_EXPIRED",
      detail: "the staff session is expired or carries no valid expiry",
    };
  }
  if (!candidate.profileCodes.includes(TERMINAL_PROFILE_T1_INTAKE_CASHIER)) {
    return {
      authorized: false,
      refusalCode: "STAFF_PROFILE_NOT_AUTHORIZED",
      detail: "the staff member is not authorized for the T1 profile",
    };
  }
  if (!candidate.effectivePermissions.includes("pos.t1.use")) {
    return {
      authorized: false,
      refusalCode: "STAFF_T1_PERMISSION_MISSING",
      detail: "the staff session does not carry pos.t1.use",
    };
  }
  return { authorized: true };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

/** Unpadded base64url → bytes; null on any non-url-alphabet content. */
function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function toConfigurationSnapshot(
  wire: SignedTerminalConfiguration,
  signatureValid: boolean,
): ConfigurationSnapshot {
  return {
    configurationVersion: wire.configurationVersion,
    purpose: "configuration_signing",
    environment: wire.environment,
    tenantId: wire.tenantId,
    digitalStoreId: wire.digitalStoreId,
    storeLocationId: wire.storeLocationId,
    deviceRecordId: wire.deviceRecordId,
    assignmentGeneration: wire.assignmentGeneration,
    issuedAt: new Date(wire.effectiveAt),
    validUntil: new Date(wire.validUntil),
    payloadSha256: wire.payloadSha256,
    computedPayloadSha256: sha256Hex(wire.payloadJson),
    signerKeyId: wire.signerKeyId,
    signerPurpose: "configuration_signing",
    signatureValid,
  };
}

const OPERATIONAL_REFUSAL_STATES: Record<string, T1RuntimeState> = {
  PAIR_HUB_CHANGED: "assignment_invalid",
  PAIR_HUB_NOT_ACTIVE: "assignment_invalid",
  PAIR_ASSIGNMENT_MISMATCH: "assignment_invalid",
  PAIR_CREDENTIAL_CHANGED: "credential_invalid",
  PAIR_DEVICE_NOT_ELIGIBLE: "credential_invalid",
  PAIR_RECEIPT_SUPERSEDED: "recovery_required",
};

/** Route refusal results (the Hub's closed vocabulary) → §5 states. */
const ROUTE_REFUSAL_STATES: Record<string, T1RuntimeState> = {
  TERMINAL_NOT_RECOGNIZED: "credential_invalid",
  CREDENTIAL_NOT_CURRENT: "credential_invalid",
  ACTIVATION_REQUIRED: "recovery_required",
  HUB_NOT_OPERATIONAL: "hub_unavailable",
  HUB_RETIRED: "assignment_invalid",
  HUB_REPLACEMENT_BLOCKED: "hub_unavailable",
  HUB_ASSIGNMENT_MISSING: "hub_unavailable",
  ASSIGNMENT_SCOPE_MISMATCH: "assignment_invalid",
  ASSIGNMENT_GENERATION_STALE: "assignment_invalid",
  PAIRING_REQUIRED: "recovery_required",
  PROFILE_NOT_GRANTED: "profile_not_authorized",
  PROFILE_NOT_T1: "profile_not_authorized",
  CONTAINMENT_PROHIBITS: "assignment_invalid",
  CONFIGURATION_MISSING: "configuration_incompatible",
  DELIVERY_SIGNER_UNAVAILABLE: "hub_unavailable",
};

const CONFIGURATION_REJECTION_STATES: Partial<Record<ConfigurationRejectionCode, T1RuntimeState>> =
  {
    CONFIG_EXPIRED: "stale_configuration",
    CONFIG_SCOPE_MISMATCH: "assignment_invalid",
    CONFIG_DEVICE_MISMATCH: "assignment_invalid",
    CONFIG_ASSIGNMENT_MISMATCH: "assignment_invalid",
    CONFIG_RESTRICTED_TRUST_MODE: "recovery_required",
    CONFIG_NO_TRUSTED_TIME: "recovery_required",
  };

export interface T1BootstrapOptions {
  /** This build's application version, for delivery compatibility bounds. */
  readonly applicationVersion?: string;
}

function isRefusal(value: object): value is EdgeReadRefusal {
  return "outcome" in value && (value as { outcome: unknown }).outcome === "refused";
}

/** Runs the full §5 startup sequence and reports the resulting shell state. */
export async function bootstrapT1(
  ports: T1BootstrapPorts,
  options: T1BootstrapOptions = {},
): Promise<T1BootstrapReport> {
  const applicationVersion = options.applicationVersion ?? "0.1.0";
  const transitions: T1RuntimeState[] = [];
  const enter = (state: T1RuntimeState): void => {
    transitions.push(state);
    ports.logger.log("t1.bootstrap.state", { state });
  };
  const finish = (
    state: T1RuntimeState,
    extras: Omit<Partial<T1BootstrapReport>, "state" | "transitions"> = {},
  ): T1BootstrapReport => {
    enter(state);
    if (extras.refusalCode !== undefined) {
      ports.logger.log("t1.bootstrap.refused", {
        state,
        refusalCode: extras.refusalCode,
        detail: extras.detail ?? "",
      });
    }
    return { state, transitions, ...extras };
  };
  const routeRefused = (
    refusal: EdgeReadRefusal,
    extras: Omit<Partial<T1BootstrapReport>, "state" | "transitions"> = {},
  ): T1BootstrapReport =>
    finish(ROUTE_REFUSAL_STATES[refusal.result] ?? "recovery_required", {
      refusalCode: refusal.result,
      detail: refusal.detail,
      ...extras,
    });

  enter("starting");

  // Step 1 — protected terminal identity.
  let identity: ProtectedTerminalIdentity | null;
  try {
    identity = ports.identity.load();
  } catch (error) {
    return finish("recovery_required", {
      refusalCode: "IDENTITY_UNREADABLE",
      detail: error instanceof Error ? error.message : "identity load failed",
    });
  }
  if (identity === null) {
    return finish("recovery_required", {
      refusalCode: "IDENTITY_MISSING",
      detail: "no protected terminal identity exists; provisioning is required",
    });
  }

  // Step 2 — endpoint resolution (locked order) and the mTLS session.
  enter("connecting_to_hub");
  const resolution = await ports.hubEndpoint.resolve(identity);
  if (resolution.outcome === "unreachable") {
    return finish("hub_unavailable", {
      refusalCode: "HUB_DISCOVERY_UNREACHABLE",
      detail: resolution.detail,
    });
  }
  // The pin is the RECORD's TLS fingerprint: the session below runs against
  // it under CA chain validation, and the record's signature is verified
  // with the first Hub-time anchor before anything the session read is used
  // beyond authority time. A forged record fails there and nothing proceeds.
  const endpoint: VerifiedHubEndpoint = {
    hubDeviceId: resolution.payload.record.hubDeviceId,
    hostname: resolution.hostname,
    port: resolution.port,
    pinnedCertificateFingerprint: resolution.payload.record.hubCertificateFingerprint,
  };
  const established = await ports.edgeSession.establish(endpoint, identity);
  if (established.outcome === "unreachable") {
    return finish("hub_unavailable", {
      refusalCode: "HUB_SESSION_UNREACHABLE",
      detail: established.detail,
    });
  }
  if (established.outcome === "refused") {
    const state: T1RuntimeState =
      established.code === "ACTIVATION_REQUIRED"
        ? "recovery_required"
        : established.code === "HUB_CERT_MISMATCH"
          ? "hub_unavailable"
          : "credential_invalid";
    return finish(state, { refusalCode: established.code, detail: established.detail });
  }
  const hub: EdgeOperationsSession = established.session;
  const hubSummary = {
    hubDeviceId: endpoint.hubDeviceId,
    hostname: endpoint.hostname,
    port: endpoint.port,
  };

  // Step 3 — Hub authority time, anchored monotonically. The anchor is the
  // ONLY clock every later judgement uses; when it lapses it is reacquired.
  const anchor = new HubTimeAnchor(ports.monotonicNow);
  const acquireHubTime = async (): Promise<Date | T1BootstrapReport> => {
    const existing = anchor.current();
    if (existing !== null) return existing;
    let outcome: Awaited<ReturnType<typeof hub.fetchAuthorityTime>>;
    try {
      outcome = await hub.fetchAuthorityTime();
    } catch (error) {
      return finish("hub_unavailable", {
        refusalCode: "HUB_SESSION_LOST",
        detail: error instanceof Error ? error.message : "authority time fetch failed",
        hub: hubSummary,
      });
    }
    if (isRefusal(outcome)) return routeRefused(outcome, { hub: hubSummary });
    const parsed = parseAuthorityTime(outcome);
    if (parsed === null) {
      return finish("hub_unavailable", {
        refusalCode: "AUTHORITY_TIME_MALFORMED",
        detail: "the authority-time response did not parse; there is no wall-clock fallback",
        hub: hubSummary,
      });
    }
    anchor.set(new Date(parsed.authorityTime));
    const anchored = anchor.current();
    if (anchored === null) {
      return finish("hub_unavailable", {
        refusalCode: "AUTHORITY_TIME_UNANCHORED",
        detail: "the authority-time anchor could not be established",
        hub: hubSummary,
      });
    }
    return anchored;
  };
  const initialTime = await acquireHubTime();
  if (initialTime instanceof Date === false) return initialTime;
  let hubNow: Date = initialTime;

  // Step 4 — verify the signed discovery record under Hub time.
  const wire = resolution.payload.record;
  const signature = decodeBase64Url(resolution.payload.signature);
  const issuedAt = new Date(wire.issuedAt);
  const expiresAt = new Date(wire.expiresAt);
  if (
    resolution.payload.signatureAlgorithm !== "ed25519" ||
    signature === null ||
    Number.isNaN(issuedAt.getTime()) ||
    Number.isNaN(expiresAt.getTime()) ||
    !(TRUST_ENVIRONMENTS as readonly string[]).includes(wire.environment)
  ) {
    return finish("hub_unavailable", {
      refusalCode: "DISCOVERY_MALFORMED",
      detail: "the discovery payload is not a well-formed signed record",
      hub: hubSummary,
    });
  }
  const record: EdgeDiscoveryRecord = {
    protocolVersion: wire.protocolVersion,
    recordId: wire.recordId,
    hubDeviceId: wire.hubDeviceId,
    hubCertificateFingerprint: wire.hubCertificateFingerprint,
    tenantId: wire.tenantId,
    digitalStoreId: wire.digitalStoreId,
    storeLocationId: wire.storeLocationId,
    environment: wire.environment as TrustEnvironment,
    hostname: wire.hostname,
    port: wire.port,
    issuedAt,
    expiresAt,
  };
  const discoveryVerdict = verifyEdgeDiscoveryRecord(
    record,
    signature,
    identity.hubOperationalPublicKeyPem,
    { ...identity.discoveryExpectation, hubDeviceId: identity.receiptExpectation.hubDeviceId },
    hubNow,
  );
  if (!discoveryVerdict.verified) {
    const wrongHub =
      discoveryVerdict.refusalCode === "DISCOVERY_WRONG_HUB" ||
      discoveryVerdict.refusalCode === "DISCOVERY_WRONG_SCOPE" ||
      discoveryVerdict.refusalCode === "DISCOVERY_WRONG_ENVIRONMENT";
    return finish(wrongHub ? "assignment_invalid" : "hub_unavailable", {
      refusalCode: discoveryVerdict.refusalCode ?? "DISCOVERY_SIGNATURE_INVALID",
      detail: discoveryVerdict.detail ?? "the discovery record did not verify",
      hub: hubSummary,
    });
  }

  // Step 5 — the pairing receipt, judged under Hub time.
  let receipt: StoredPairingReceipt | null;
  try {
    receipt = ports.receipts.loadVerifiedCurrentReceipt({
      hubPublicKeyPem: identity.hubOperationalPublicKeyPem,
      expectation: identity.receiptExpectation,
      at: hubNow,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "RECEIPT_UNVERIFIABLE";
    return finish("recovery_required", {
      refusalCode: code,
      detail: "the stored pairing receipt failed verification at startup",
      hub: hubSummary,
    });
  }
  if (receipt === null) {
    return finish("recovery_required", {
      refusalCode: "RECEIPT_MISSING",
      detail: "no current pairing receipt exists; pairing is required",
      hub: hubSummary,
    });
  }
  if (
    receipt.terminalDeviceId !== identity.terminalDeviceId ||
    receipt.terminalCertificateFingerprint !== identity.terminalCertificateFingerprint
  ) {
    return finish("credential_invalid", {
      refusalCode: "RECEIPT_IDENTITY_MISMATCH",
      detail: "the pairing receipt names a different terminal identity",
      hub: hubSummary,
    });
  }

  // Step 6 — runtime eligibility from the Hub, judged by the terminal-local
  // authority (§11: a verified receipt is evidence, never authorization).
  let eligibilityOutcome: Awaited<ReturnType<typeof hub.fetchEligibility>>;
  try {
    eligibilityOutcome = await hub.fetchEligibility();
  } catch (error) {
    return finish("hub_unavailable", {
      refusalCode: "HUB_SESSION_LOST",
      detail: error instanceof Error ? error.message : "the eligibility read failed",
      hub: hubSummary,
    });
  }
  if (isRefusal(eligibilityOutcome)) return routeRefused(eligibilityOutcome, { hub: hubSummary });
  const eligibility: RuntimeEligibilityWire = eligibilityOutcome.eligibility;
  const operational: OperationalEligibility = {
    hubDeviceId: eligibility.hubDeviceId,
    hubCertificateFingerprint: identity.receiptExpectation.hubCertificateFingerprint,
    terminalCertificateFingerprint: identity.terminalCertificateFingerprint,
    terminalAssignmentId: eligibility.assignmentId,
    terminalAssignmentGeneration: eligibility.assignmentGeneration,
    terminalProfileKey: eligibility.terminalProfileCode,
    terminalCredentialStatus:
      eligibility.credentialEligibility === "eligible" ? "active" : "revoked",
    hubCredentialStatus: "active",
  };
  const verdict = ports.receipts.authorizeOperationalUse(receipt, {
    ...operational,
    // The receipt stores the ASSIGNMENT row id from installation context;
    // current eligibility reports the Hub's relational assignment. The
    // authoritative comparison set stays generation + profile + identities.
    terminalAssignmentId: receipt.terminalAssignmentId,
  });
  if (!verdict.authorized) {
    const refusalCode = verdict.refusalCode ?? "OPERATIONAL_USE_REFUSED";
    return finish(OPERATIONAL_REFUSAL_STATES[refusalCode] ?? "recovery_required", {
      refusalCode,
      detail: verdict.detail ?? "current eligibility refuses this pairing receipt",
      hub: hubSummary,
    });
  }

  // Step 7 — the assigned profile must include T1; retired identifiers are
  // refused, never coerced (KLD-2026-07-26-002 Group 2).
  if (
    (REJECTED_TERMINAL_IDENTIFIERS as readonly string[]).includes(
      eligibility.terminalProfileCode,
    ) ||
    eligibility.terminalProfileCode !== TERMINAL_PROFILE_T1_INTAKE_CASHIER ||
    receipt.terminalProfileKey !== TERMINAL_PROFILE_T1_INTAKE_CASHIER
  ) {
    return finish("profile_not_authorized", {
      refusalCode: "PROFILE_NOT_T1",
      detail: "the assigned profile is not the T1 POS Cashier / Intake profile",
      hub: hubSummary,
    });
  }

  // Step 8 — the signed configuration delivery.
  enter("configuration_loading");
  const refreshed = await acquireHubTime();
  if (refreshed instanceof Date === false) return refreshed;
  hubNow = refreshed;
  const trustedTime: TrustedTimeEvaluation = {
    status: "trusted",
    trustedTime: hubNow,
    source: "authenticated_network",
    floorAdvanced: false,
    anomalyType: null,
    detail: "hub authority time (monotonic anchor)",
  };
  let cached: CachedConfigurationRecord | null;
  try {
    cached = ports.configurationCache.loadCurrent();
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "CONFIGURATION_CACHE_UNREADABLE";
    return finish("recovery_required", {
      refusalCode: code,
      detail: "the local configuration cache cannot be trusted",
      hub: hubSummary,
    });
  }

  const deliveryExpectation = {
    tenantId: receipt.tenantId,
    digitalStoreId: receipt.digitalStoreId,
    storeLocationId: receipt.storeLocationId,
    environment: identity.environment,
    hubDeviceId: receipt.hubDeviceId,
    terminalDeviceId: identity.terminalDeviceId,
    assignmentGeneration: eligibility.assignmentGeneration,
    terminalProfileCode: TERMINAL_PROFILE_T1_INTAKE_CASHIER,
  };
  const scope = {
    tenantId: receipt.tenantId,
    digitalStoreId: receipt.digitalStoreId,
    storeLocationId: receipt.storeLocationId,
    deviceRecordId: identity.terminalDeviceId,
    assignmentGeneration: eligibility.assignmentGeneration,
  };

  const verifyAndSummarize = (
    wireRecord: SignedTerminalConfiguration,
    freshness: ConfigurationFreshness,
  ):
    | { readonly ok: true; readonly summary: ActiveConfigurationSummary }
    | { readonly ok: false; readonly report: T1BootstrapReport } => {
    if (wireRecord.schemaVersion !== SUPPORTED_CONFIGURATION_SCHEMA_VERSION) {
      return {
        ok: false,
        report: finish("configuration_incompatible", {
          refusalCode: "CONFIG_SCHEMA_UNSUPPORTED",
          detail: `configuration schema version ${wireRecord.schemaVersion} is not supported`,
          hub: hubSummary,
        }),
      };
    }
    if (
      compareApplicationVersions(applicationVersion, wireRecord.minimumApplicationVersion) < 0 ||
      (wireRecord.maximumApplicationVersion !== null &&
        compareApplicationVersions(applicationVersion, wireRecord.maximumApplicationVersion) > 0)
    ) {
      return {
        ok: false,
        report: finish("configuration_incompatible", {
          refusalCode: "CONFIG_APP_VERSION_INCOMPATIBLE",
          detail: `application ${applicationVersion} is outside the compatible range`,
          hub: hubSummary,
        }),
      };
    }
    const deliverySignature = decodeBase64Url(wireRecord.deliverySignature);
    const deliveryVerdict =
      deliverySignature === null
        ? { verified: false as const, refusalCode: "DELIVERY_SIGNATURE_INVALID" as const }
        : verifyTerminalConfigurationDelivery(
            {
              snapshotId: wireRecord.snapshotId,
              configurationVersion: wireRecord.configurationVersion,
              schemaVersion: wireRecord.schemaVersion,
              tenantId: wireRecord.tenantId,
              digitalStoreId: wireRecord.digitalStoreId,
              storeLocationId: wireRecord.storeLocationId,
              environment: wireRecord.environment as TrustEnvironment,
              hubDeviceId: wireRecord.hubDeviceId,
              terminalDeviceId: wireRecord.deviceRecordId,
              assignmentGeneration: wireRecord.assignmentGeneration,
              terminalProfileCode: wireRecord.terminalProfileCode,
              minimumApplicationVersion: wireRecord.minimumApplicationVersion,
              maximumApplicationVersion: wireRecord.maximumApplicationVersion,
              issuedAt: new Date(wireRecord.issuedAt),
              effectiveAt: new Date(wireRecord.effectiveAt),
              validUntil: new Date(wireRecord.validUntil),
              manifestSha256: wireRecord.manifestSha256,
              payloadSha256: wireRecord.payloadSha256,
              signingKeyId: wireRecord.signerKeyId,
              correlationId: wireRecord.correlationId,
            },
            deliverySignature,
            identity.hubOperationalPublicKeyPem,
            deliveryExpectation,
            sha256Hex(wireRecord.payloadJson),
          );
    const validity = evaluateConfigurationSnapshot({
      snapshot: toConfigurationSnapshot(wireRecord, deliveryVerdict.verified),
      trustedTime,
      environment: identity.environment,
      scope,
      activeVersion: cached === null ? null : cached.snapshot.configurationVersion,
    });
    if (!validity.valid) {
      const rejection = validity.rejectionCode ?? "CONFIG_SIGNATURE_INVALID";
      const detail =
        rejection === "CONFIG_SIGNATURE_INVALID" && !deliveryVerdict.verified
          ? `the delivery attestation failed (${deliveryVerdict.refusalCode ?? "unverified"})`
          : (validity.detail ?? "the configuration is not valid");
      return {
        ok: false,
        report: finish(CONFIGURATION_REJECTION_STATES[rejection] ?? "configuration_incompatible", {
          refusalCode: rejection,
          detail,
          hub: hubSummary,
        }),
      };
    }
    const evaluatedAt = validity.evaluatedAt ?? hubNow;
    return {
      ok: true,
      summary: {
        configurationVersion: wireRecord.configurationVersion,
        schemaVersion: wireRecord.schemaVersion,
        freshness,
        issuedAt: wireRecord.effectiveAt,
        validUntil: wireRecord.validUntil,
        evaluatedAt: evaluatedAt.toISOString(),
      },
    };
  };

  let activeConfiguration: ActiveConfigurationSummary;
  let deliveryOutcome:
    { readonly outcome: "delivery"; readonly wire: ConfigurationDeliveryWire } | EdgeReadRefusal;
  try {
    deliveryOutcome = await hub.fetchConfigurationDelivery();
  } catch (error) {
    deliveryOutcome = {
      outcome: "refused",
      result: "CONFIGURATION_FETCH_FAILED",
      retryable: true,
      detail: error instanceof Error ? error.message : "configuration fetch failed",
    };
  }
  if (deliveryOutcome.outcome === "delivery") {
    const envelope = deliveryOutcome.wire.delivery;
    const wireRecord: SignedTerminalConfiguration = {
      snapshotId: envelope.snapshotId,
      configurationVersion: envelope.configurationVersion,
      schemaVersion: envelope.schemaVersion,
      environment: envelope.environment,
      tenantId: envelope.tenantId,
      digitalStoreId: envelope.digitalStoreId,
      storeLocationId: envelope.storeLocationId,
      hubDeviceId: envelope.hubDeviceId,
      deviceRecordId: envelope.terminalDeviceId,
      assignmentGeneration: envelope.assignmentGeneration,
      terminalProfileCode: envelope.terminalProfileCode,
      minimumApplicationVersion: envelope.minimumApplicationVersion,
      maximumApplicationVersion: envelope.maximumApplicationVersion,
      issuedAt: envelope.issuedAt,
      effectiveAt: envelope.effectiveAt,
      validUntil: envelope.validUntil,
      manifestSha256: envelope.manifestSha256,
      payloadSha256: envelope.payloadSha256,
      payloadJson: deliveryOutcome.wire.payloadJson,
      signerKeyId: envelope.signingKeyId,
      correlationId: envelope.correlationId,
      deliverySignature: deliveryOutcome.wire.deliverySignature,
    };
    const verified = verifyAndSummarize(wireRecord, "current");
    if (!verified.ok) return verified.report;
    if (
      cached === null ||
      wireRecord.configurationVersion >= cached.snapshot.configurationVersion
    ) {
      ports.configurationCache.persistValidated({
        snapshot: wireRecord,
        verifiedAt: verified.summary.evaluatedAt,
      });
    }
    activeConfiguration = verified.summary;
  } else {
    // Only UNAVAILABILITY may degrade into cached operation (§6 "the Hub
    // cannot deliver one now"); a governed refusal that names this terminal
    // ineligible never does.
    const CONFIG_FALLBACK_RESULTS = new Set([
      "CONFIGURATION_MISSING",
      "DELIVERY_SIGNER_UNAVAILABLE",
      "CONFIGURATION_FETCH_FAILED",
    ]);
    const named = ROUTE_REFUSAL_STATES[deliveryOutcome.result];
    if (named !== undefined && !CONFIG_FALLBACK_RESULTS.has(deliveryOutcome.result)) {
      return routeRefused(deliveryOutcome, { hub: hubSummary });
    }
    if (cached === null) {
      return finish("recovery_required", {
        refusalCode: "CONFIG_NEVER_OBTAINED",
        detail:
          "no configuration snapshot has ever been obtained; startup requires the Store Hub to deliver one",
        hub: hubSummary,
      });
    }
    // The last VALID signed configuration, RE-VERIFIED and labelled — never
    // presented as current (owner package §6).
    const verified = verifyAndSummarize(cached.snapshot, "cached_offline");
    if (!verified.ok) return verified.report;
    activeConfiguration = verified.summary;
  }

  // Steps 9–10 — staff session and required permissions, judged under a
  // fresh Hub-time anchor; then the shell.
  const staffTime = await acquireHubTime();
  if (staffTime instanceof Date === false) return staffTime;
  hubNow = staffTime;
  let staff: StaffSessionCandidate | null;
  try {
    staff = await ports.staffSession.acquire(hub);
  } catch (error) {
    return finish("staff_authentication_required", {
      refusalCode: "STAFF_ACQUISITION_FAILED",
      detail: error instanceof Error ? error.message : "staff session acquisition failed",
      hub: hubSummary,
      configuration: activeConfiguration,
    });
  }
  if (staff === null) {
    return finish("staff_authentication_required", {
      hub: hubSummary,
      configuration: activeConfiguration,
    });
  }
  const authorization = evaluateStaffAuthorization(staff, hubNow);
  if (!authorization.authorized) {
    return finish("staff_authentication_required", {
      refusalCode: authorization.refusalCode ?? "STAFF_NOT_AUTHORIZED",
      detail: authorization.detail ?? "the staff session is not usable",
      hub: hubSummary,
      configuration: activeConfiguration,
    });
  }

  const freshness: ConfigurationFreshness = activeConfiguration.freshness;
  return finish(freshness === "current" ? "ready" : "offline_ready", {
    hub: hubSummary,
    configuration: activeConfiguration,
    staff: { actorId: staff.actorId, displayName: staff.displayName },
  });
}
