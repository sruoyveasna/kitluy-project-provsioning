/**
 * T1 startup bootstrap — WS-12-T001.
 *
 * Implements the owner package §5 required behaviour in order:
 *
 *   1. load the protected terminal identity;
 *   2. load and verify the current pairing receipt;
 *   3. resolve and verify the exact assigned Store Hub;
 *   4. establish the existing mTLS Edge Operations session;
 *   5. verify Tenant, Digital Store, Location, environment and assignment
 *      generation;
 *   6. verify that the assigned profile includes T1;
 *   7. obtain the approved signed configuration snapshot;
 *   8. open or restore the staff session;
 *   9. evaluate required permissions;
 *  10. enter the T1 application shell (the returned report drives it).
 *
 * Every failure maps into the closed §5 state vocabulary and FAILS CLOSED:
 * an invalid pairing receipt, revoked credential or wrong assignment never
 * degrades into a warning. Cloud availability is consulted NOWHERE — there
 * is no cloud port to consult (owner package §6), and the Store Hub is never
 * bypassed.
 *
 * Time discipline (KLD-2026-08-06-WS11-CLOCK-001): validity judgements use
 * the terminal's TRUSTED time (WS-11-T003 floor semantics) and, once a
 * session exists, Hub-anchored instants. The Node host clock is diagnostic
 * only and is never read here.
 */

import {
  evaluateConfigurationSnapshot,
  isRestricted,
  trustedInstant,
  type ConfigurationRejectionCode,
  type ConfigurationSnapshot,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";
import { TERMINAL_PROFILE_T1_INTAKE_CASHIER } from "@kitluy/edge-contracts";
import { REJECTED_TERMINAL_IDENTIFIERS } from "@kitluy-verticals/phase1-laundry";
import type { StoredPairingReceipt } from "@kitluy/terminal-local-store";
import { createHash } from "node:crypto";

import type {
  CachedConfigurationRecord,
  ProtectedTerminalIdentity,
  SignedTerminalConfiguration,
  T1BootstrapPorts,
  VerifiedHubEndpoint,
} from "./ports.js";
import { resolveVerifiedHubEndpoint } from "./hub-endpoint.js";
import type {
  ActiveConfigurationSummary,
  ConfigurationFreshness,
  T1BootstrapReport,
  T1RuntimeState,
} from "./states.js";

/** The one configuration schema contract this runtime speaks (Hub 0003). */
export const SUPPORTED_CONFIGURATION_SCHEMA_VERSION = 1 as const;

/**
 * Verifies the detached signature on a delivered configuration snapshot.
 *
 * CALLER-SUPPLIED VERIFICATION, deliberately (device-identity review
 * condition C4): no production configuration signer exists yet, so the
 * composition root decides which trust anchor — if any — can say `true`.
 * The shipped default refuses everything; a snapshot nobody can verify is
 * not activatable.
 */
export type ConfigurationSignatureVerifier = (snapshot: SignedTerminalConfiguration) => boolean;

export const refuseAllConfigurationSignatures: ConfigurationSignatureVerifier = () => false;

interface StaffAuthorizationVerdict {
  readonly authorized: boolean;
  readonly refusalCode?: "STAFF_SESSION_EXPIRED" | "STAFF_PROFILE_NOT_AUTHORIZED";
  readonly detail?: string;
}

/**
 * Step 9 — required permission evaluation for the T1 shell.
 *
 * The implemented authority is PROFILE authorization: the staff member must
 * be authorized for the exact owner-locked T1 profile (Hub `staff_cache`
 * `profile_codes` semantics). The four `/edge/v1/sessions/*` permission keys
 * remain `[REQUIRED:]` gaps in `@kitluy/edge-contracts` and are NOT guessed
 * here — canonical grant evaluation joins when those keys are ruled.
 */
export function evaluateStaffAuthorization(
  candidate: { readonly profileCodes: readonly string[]; readonly expiresAt: string },
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
  return { authorized: true };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
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
    issuedAt: new Date(wire.issuedAt),
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
  readonly configurationSignatureVerifier?: ConfigurationSignatureVerifier;
}

/** Runs the full §5 startup sequence and reports the resulting shell state. */
export async function bootstrapT1(
  ports: T1BootstrapPorts,
  options: T1BootstrapOptions = {},
): Promise<T1BootstrapReport> {
  const verifySignature =
    options.configurationSignatureVerifier ?? refuseAllConfigurationSignatures;
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

  enter("starting");

  // Step 1 — protected terminal identity. Absent identity is not an error
  // popup; it is an unprovisioned terminal.
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

  // Trusted time underpins every validity judgement that follows. Restricted
  // trust mode cannot be reasoned around at startup.
  let time: TrustedTimeEvaluation;
  try {
    time = await ports.trustedTime.evaluate();
  } catch (error) {
    return finish("recovery_required", {
      refusalCode: "TRUSTED_TIME_UNAVAILABLE",
      detail: error instanceof Error ? error.message : "trusted time evaluation failed",
    });
  }
  const now = trustedInstant(time);
  if (isRestricted(time.status) || now === null) {
    return finish("recovery_required", {
      refusalCode: "TRUSTED_TIME_RESTRICTED",
      detail: `trusted time status is ${time.status}`,
    });
  }

  // Step 2 — the pairing receipt: `null` means never provisioned, a throw
  // means the store cannot be trusted. Both fail closed.
  let receipt: StoredPairingReceipt | null;
  try {
    receipt = ports.receipts.loadVerifiedCurrentReceipt({
      hubPublicKeyPem: identity.hubOperationalPublicKeyPem,
      expectation: identity.receiptExpectation,
      at: now,
    });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "RECEIPT_UNVERIFIABLE";
    return finish("recovery_required", {
      refusalCode: code,
      detail: "the stored pairing receipt failed verification at startup",
    });
  }
  if (receipt === null) {
    return finish("recovery_required", {
      refusalCode: "RECEIPT_MISSING",
      detail: "no current pairing receipt exists; pairing is required",
    });
  }
  if (
    receipt.terminalDeviceId !== identity.terminalDeviceId ||
    receipt.terminalCertificateFingerprint !== identity.terminalCertificateFingerprint
  ) {
    return finish("credential_invalid", {
      refusalCode: "RECEIPT_IDENTITY_MISMATCH",
      detail: "the pairing receipt names a different terminal identity",
    });
  }

  // Step 3 — resolve and verify the EXACT assigned Store Hub.
  enter("connecting_to_hub");
  const discovered = await ports.discovery.fetchSignedDiscovery();
  if (discovered.outcome === "unreachable") {
    return finish("hub_unavailable", {
      refusalCode: "HUB_DISCOVERY_UNREACHABLE",
      detail: discovered.detail,
    });
  }
  const resolution = resolveVerifiedHubEndpoint(
    discovered.payload,
    identity.hubOperationalPublicKeyPem,
    // The expectation is provisioning truth plus the receipt's Hub binding —
    // never the record's own claims.
    { ...identity.discoveryExpectation, hubDeviceId: receipt.hubDeviceId },
    now,
  );
  if (resolution.outcome === "refused") {
    const wrongHub =
      resolution.refusalCode === "DISCOVERY_WRONG_HUB" ||
      resolution.refusalCode === "DISCOVERY_WRONG_SCOPE" ||
      resolution.refusalCode === "DISCOVERY_WRONG_ENVIRONMENT";
    return finish(wrongHub ? "assignment_invalid" : "hub_unavailable", {
      refusalCode: resolution.refusalCode,
      detail: resolution.detail,
    });
  }
  const endpoint: VerifiedHubEndpoint = resolution.endpoint;

  // Step 4 — the mTLS Edge Operations session, pinned to the verified record.
  const session = await ports.edgeSession.establish(endpoint, identity);
  if (session.outcome === "unreachable") {
    return finish("hub_unavailable", {
      refusalCode: "HUB_SESSION_UNREACHABLE",
      detail: session.detail,
    });
  }
  if (session.outcome === "refused") {
    const state: T1RuntimeState =
      session.code === "ACTIVATION_REQUIRED"
        ? "recovery_required"
        : session.code === "HUB_CERT_MISMATCH"
          ? "hub_unavailable"
          : "credential_invalid";
    return finish(state, { refusalCode: session.code, detail: session.detail });
  }
  const hub = session.session;
  const hubSummary = {
    hubDeviceId: endpoint.hubDeviceId,
    hostname: endpoint.hostname,
    port: endpoint.port,
  };

  // Step 5 — scope, environment and assignment generation, judged by the
  // terminal-local authority against CURRENT Hub eligibility. A verified
  // receipt is evidence, never a standing authorization (protocol §11). A
  // transport failure mid-read is a lost Hub, not a validation verdict.
  let hubNow: Date;
  let eligibility: Awaited<ReturnType<typeof hub.describeEligibility>>;
  try {
    hubNow = await hub.hubTime();
    eligibility = await hub.describeEligibility();
  } catch (error) {
    return finish("hub_unavailable", {
      refusalCode: "HUB_SESSION_LOST",
      detail: error instanceof Error ? error.message : "a Hub read failed",
      hub: hubSummary,
    });
  }
  const verdict = ports.receipts.authorizeOperationalUse(receipt, eligibility);
  if (!verdict.authorized) {
    const refusalCode = verdict.refusalCode ?? "OPERATIONAL_USE_REFUSED";
    return finish(OPERATIONAL_REFUSAL_STATES[refusalCode] ?? "recovery_required", {
      refusalCode,
      detail: verdict.detail ?? "current eligibility refuses this pairing receipt",
      hub: hubSummary,
    });
  }

  // Step 6 — the assigned profile must include T1. A retired or pre-rename
  // identifier is refused, never coerced (KLD-2026-07-26-002 Group 2).
  if (
    (REJECTED_TERMINAL_IDENTIFIERS as readonly string[]).includes(receipt.terminalProfileKey) ||
    receipt.terminalProfileKey !== TERMINAL_PROFILE_T1_INTAKE_CASHIER
  ) {
    return finish("profile_not_authorized", {
      refusalCode: "PROFILE_NOT_T1",
      detail: `the assigned profile is not the T1 POS Cashier / Intake profile`,
      hub: hubSummary,
    });
  }

  // Step 7 — the approved signed configuration snapshot.
  enter("configuration_loading");
  const scope = {
    tenantId: receipt.tenantId,
    digitalStoreId: receipt.digitalStoreId,
    storeLocationId: receipt.storeLocationId,
    deviceRecordId: receipt.terminalDeviceId,
    assignmentGeneration: receipt.terminalAssignmentGeneration,
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

  const evaluate = (wire: SignedTerminalConfiguration) => {
    if (wire.schemaVersion !== SUPPORTED_CONFIGURATION_SCHEMA_VERSION) {
      return {
        validity: null,
        incompatible: `configuration schema version ${wire.schemaVersion} is not supported (${SUPPORTED_CONFIGURATION_SCHEMA_VERSION})`,
      };
    }
    const snapshot = toConfigurationSnapshot(wire, verifySignature(wire));
    return {
      validity: evaluateConfigurationSnapshot({
        snapshot,
        trustedTime: time,
        environment: identity.environment,
        scope,
        activeVersion: cached === null ? null : cached.snapshot.configurationVersion,
      }),
      incompatible: null,
    };
  };

  let activeConfiguration: ActiveConfigurationSummary | null = null;
  let fetched: Awaited<ReturnType<typeof hub.fetchConfigurationSnapshot>>;
  try {
    fetched = await hub.fetchConfigurationSnapshot();
  } catch (error) {
    fetched = {
      outcome: "unavailable",
      detail: error instanceof Error ? error.message : "configuration fetch failed",
    };
  }
  if (fetched.outcome === "snapshot") {
    const { validity, incompatible } = evaluate(fetched.snapshot);
    if (incompatible !== null) {
      return finish("configuration_incompatible", {
        refusalCode: "CONFIG_SCHEMA_UNSUPPORTED",
        detail: incompatible,
        hub: hubSummary,
      });
    }
    if (validity === null || !validity.valid) {
      const rejection = validity?.rejectionCode ?? "CONFIG_SIGNATURE_INVALID";
      return finish(CONFIGURATION_REJECTION_STATES[rejection] ?? "configuration_incompatible", {
        refusalCode: rejection,
        detail: validity?.detail ?? "the delivered configuration snapshot is not valid",
        hub: hubSummary,
      });
    }
    const evaluatedAt = validity.evaluatedAt ?? hubNow;
    if (
      cached === null ||
      fetched.snapshot.configurationVersion >= cached.snapshot.configurationVersion
    ) {
      ports.configurationCache.persistValidated({
        snapshot: fetched.snapshot,
        verifiedAt: evaluatedAt.toISOString(),
      });
    }
    activeConfiguration = {
      configurationVersion: fetched.snapshot.configurationVersion,
      schemaVersion: fetched.snapshot.schemaVersion,
      freshness: "current",
      issuedAt: fetched.snapshot.issuedAt,
      validUntil: fetched.snapshot.validUntil,
      evaluatedAt: evaluatedAt.toISOString(),
    };
  } else {
    // The Hub cannot deliver a snapshot now. The last VALID signed snapshot
    // may be used — re-verified, never trusted from disk, and labelled.
    if (cached === null) {
      return finish("recovery_required", {
        refusalCode: "CONFIG_NEVER_OBTAINED",
        detail:
          "no configuration snapshot has ever been obtained; startup requires the Store Hub to deliver one",
        hub: hubSummary,
      });
    }
    const { validity, incompatible } = evaluate(cached.snapshot);
    if (incompatible !== null) {
      return finish("configuration_incompatible", {
        refusalCode: "CONFIG_SCHEMA_UNSUPPORTED",
        detail: incompatible,
        hub: hubSummary,
      });
    }
    if (validity === null || !validity.valid) {
      const rejection = validity?.rejectionCode ?? "CONFIG_SIGNATURE_INVALID";
      return finish(CONFIGURATION_REJECTION_STATES[rejection] ?? "configuration_incompatible", {
        refusalCode: rejection,
        detail: validity?.detail ?? "the cached configuration snapshot is no longer valid",
        hub: hubSummary,
      });
    }
    const evaluatedAt = validity.evaluatedAt ?? hubNow;
    activeConfiguration = {
      configurationVersion: cached.snapshot.configurationVersion,
      schemaVersion: cached.snapshot.schemaVersion,
      freshness: "cached_offline",
      issuedAt: cached.snapshot.issuedAt,
      validUntil: cached.snapshot.validUntil,
      evaluatedAt: evaluatedAt.toISOString(),
    };
  }

  // Steps 8 and 9 — staff session restore and required permissions. A
  // process restart restores nothing unless the port proves a still-valid
  // durable session; everything else re-authenticates interactively.
  const staff = await ports.staffSession.restore();
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
      detail: authorization.detail ?? "the restored staff session is not usable",
      hub: hubSummary,
      configuration: activeConfiguration,
    });
  }

  // Step 10 — the T1 application shell. Freshness decides which ready state
  // is entered; cached configuration is never presented as current.
  const freshness: ConfigurationFreshness = activeConfiguration.freshness;
  return finish(freshness === "current" ? "ready" : "offline_ready", {
    hub: hubSummary,
    configuration: activeConfiguration,
    staff: { actorId: staff.actorId, displayName: staff.displayName },
  });
}
