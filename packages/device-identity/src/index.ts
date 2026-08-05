/**
 * @kitluy/device-identity — device identity model, hardware-evidence contracts
 * and the ABSTRACT PKI / attestation / signing-provider interfaces.
 *
 * STATUS: WS-11-T003 step 3 (Cycle 10). The identity model, evidence
 * contracts, state machine and provider INTERFACES are implemented here.
 * No CA, no key generation, no issuance and no signer are.
 *
 * Authority:
 *   docs/source/security/kitluy-device-certificate-and-trust-policy-v1.0.0.md
 *     §3 device identity layers, §4 manufacturing enrollment, §8 clone defense,
 *     §11 repair/NVMe/replacement.
 *   docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-decision-v1.0.0.md
 *     (KLD-2026-07-28-002) — hierarchy, custody, windows, revocation, the six
 *     signing purposes, trusted time, replacement and compromise response.
 *   Migration groups 0120-0122 are the authoritative persistence contract;
 *     these types mirror them, and the tests assert they still agree.
 *
 * ---------------------------------------------------------------------------
 * THE IDENTITY RULE
 * ---------------------------------------------------------------------------
 * The primary identity is an opaque, server-generated `DeviceRecordId`. It is
 * NEVER derived from hardware values.
 *
 * MAC address, storage serial and board identifiers are BINDING SIGNALS and
 * TAMPER SIGNALS. Hashing them together into an identity is forbidden, because
 * a derived identity makes a repaired device a different device and a cloned
 * device the same device. A changed signal quarantines the existing record and
 * requires governed re-enrollment — it never mints an unrelated identity.
 *
 * ---------------------------------------------------------------------------
 * BLK-005 — RULED, NOT BUILT
 * ---------------------------------------------------------------------------
 * BLK-005's DECISION VALUES are resolved (KLD-2026-07-28-002); its
 * IMPLEMENTATION is pending. Development trust is authorized; pilot activation,
 * production activation and the production signer remain BLOCKED, and pilot /
 * production HARDWARE certification additionally waits on a certified TPM 2.0
 * or secure-element SKU.
 *
 * This module therefore ships INTERFACES and a fail-closed default. There is
 * still no CA, no key generation, no certificate issuance, no revocation
 * distribution and no signer. `UnconfiguredPkiProvider` refuses every operation
 * with an explicit required-value error, and it is the DEFAULT so that "nobody
 * wired a provider" and "this environment is not authorized" produce the same
 * visible refusal rather than silent success.
 */

export const PACKAGE_NAME = "@kitluy/device-identity" as const;

export * from "./environments.js";
export * from "./errors.js";

import type { SigningPurpose, TrustEnvironment } from "./environments.js";
import { PKI_BLOCKER_REF, RequiredCryptographicValueError } from "./errors.js";

// ---------------------------------------------------------------------------
// Identity model
// ---------------------------------------------------------------------------

/**
 * The immutable KitLuy device_record_id.
 *
 * Opaque by construction. Nothing in this package derives it, parses meaning
 * out of it, or reconstructs it from hardware evidence.
 */
export type DeviceRecordId = string & { readonly __brand: "DeviceRecordId" };

export type DeviceClass = "store_hub" | "terminal" | "manufacturing_station" | "peripheral";

/**
 * `awaiting_trust` is where a claimed, scope-bound, assigned device WAITS.
 * While BLK-005 is open it is where every correctly-provisioned device stops.
 */
export type DeviceLifecycleState =
  | "manufactured"
  | "enrolled"
  | "awaiting_trust"
  | "quarantined"
  | "restricted_investigation"
  | "active"
  | "suspended"
  | "retired"
  | "replaced";

/**
 * Where a device key actually lives (KLD-2026-07-28-002 §4).
 * `development_software` is permitted ONLY for local development, automated
 * tests and non-production simulation, and is never production-eligible.
 */
export type HardwareTrustLevel = "development_software" | "tpm_2_0" | "secure_element";

export function isHardwareBacked(level: HardwareTrustLevel): boolean {
  return level !== "development_software";
}

export type ClaimState = "issued" | "redeemed" | "expired" | "revoked";

export type AssignmentState = "pending_trust" | "active" | "superseded" | "revoked";

/**
 * The provisioning chain, in order (KLD-2026-07-21-003, OWNER-LOCKED). Kept as
 * data so a reader can see the whole boundary in one place, and so a future
 * change has to edit the chain rather than quietly skip a link.
 */
export const PROVISIONING_CHAIN: readonly string[] = [
  "claim accepted",
  "identity and scope bound",
  "assignment created",
  "device remains awaiting_trust",
  "BLK-005 configuration required",
  "certificate issuance",
  "activation",
] as const;

/**
 * Terminal profile keys are validated STRUCTURALLY as `<vertical>.t<n>.<role>`.
 * This enforces the owner-locked T1-T4 shape without importing Laundry
 * vocabulary into neutral Core (repository rule 2).
 */
const TERMINAL_PROFILE_KEY_PATTERN = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;

export function isValidTerminalProfileKey(key: string): boolean {
  return TERMINAL_PROFILE_KEY_PATTERN.test(key);
}

export type EnrollmentState = "sealed" | "superseded" | "revoked";

export type CertificateStatus = "requested" | "active" | "expired" | "revoked" | "superseded";

/**
 * Where a device private key lives. `software` is an explicitly recorded
 * weakness permitted only for development; the production requirement is
 * `[REQUIRED: hardware-backed private-key custody]` pending BLK-005.
 */
export type KeyStorageClass = "software" | "tpm" | "secure_element" | "hsm";

// ---------------------------------------------------------------------------
// Hardware evidence — signals, never identity
// ---------------------------------------------------------------------------

export type HardwareSignalType =
  | "mac_address"
  | "board_serial"
  | "soc_serial"
  | "tpm_ek_public"
  | "secure_element_id"
  | "storage_serial"
  | "storage_model"
  | "boot_measurement"
  | "os_image_digest";

/**
 * The signals an approved storage-module (NVMe) replacement is expected to
 * change, and the only ones (trust policy §11). A mismatch confined to these
 * is the replacement signature; a mismatch anywhere else is an unapproved
 * hardware change.
 */
export const STORAGE_MODULE_SIGNAL_TYPES: readonly HardwareSignalType[] = [
  "storage_serial",
  "storage_model",
] as const;

export function isStorageModuleSignal(type: HardwareSignalType): boolean {
  return STORAGE_MODULE_SIGNAL_TYPES.includes(type);
}

export interface HardwareSignal {
  readonly signalType: HardwareSignalType;
  readonly signalValue: string;
}

/**
 * Trims and lower-cases a signal so that presentation differences (an
 * upper-case MAC, a padded serial) are not misread as tamper.
 */
export function normalizeHardwareSignal(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSignals(signals: readonly HardwareSignal[]): readonly HardwareSignal[] {
  return signals.map((s) => ({
    signalType: s.signalType,
    signalValue: normalizeHardwareSignal(s.signalValue),
  }));
}

/** The evidence comparison verdict. Mirrors device_hardware_observations. */
export interface EvidenceComparison {
  readonly matched: boolean;
  /** Present on both sides with a different value. */
  readonly mismatched: readonly HardwareSignalType[];
  /** Enrolled but not presented. */
  readonly missing: readonly HardwareSignalType[];
  /** Presented but never enrolled. */
  readonly unexpected: readonly HardwareSignalType[];
  /** Every difference is confined to storage-module signals. */
  readonly storageModuleOnlyChange: boolean;
}

/**
 * Compares presented evidence against the sealed enrollment manifest.
 *
 * This function DECIDES NOTHING about identity. It reports differences; the
 * database decides what a difference means, and the answer is never "this is a
 * different device".
 */
export function compareHardwareEvidence(
  enrolled: readonly HardwareSignal[],
  observed: readonly HardwareSignal[],
): EvidenceComparison {
  const enrolledByType = new Map<HardwareSignalType, Set<string>>();
  for (const s of normalizeSignals(enrolled)) {
    const set = enrolledByType.get(s.signalType) ?? new Set<string>();
    set.add(s.signalValue);
    enrolledByType.set(s.signalType, set);
  }
  const observedByType = new Map<HardwareSignalType, Set<string>>();
  for (const s of normalizeSignals(observed)) {
    const set = observedByType.get(s.signalType) ?? new Set<string>();
    set.add(s.signalValue);
    observedByType.set(s.signalType, set);
  }

  const mismatched: HardwareSignalType[] = [];
  const missing: HardwareSignalType[] = [];
  const unexpected: HardwareSignalType[] = [];

  for (const [type, values] of enrolledByType) {
    const seen = observedByType.get(type);
    if (seen === undefined) {
      missing.push(type);
      continue;
    }
    for (const value of values) {
      if (!seen.has(value)) {
        mismatched.push(type);
        break;
      }
    }
  }
  for (const type of observedByType.keys()) {
    if (!enrolledByType.has(type)) unexpected.push(type);
  }

  const matched = mismatched.length === 0 && missing.length === 0 && unexpected.length === 0;

  const storageModuleOnlyChange =
    !matched &&
    missing.length === 0 &&
    unexpected.length === 0 &&
    mismatched.every(isStorageModuleSignal);

  return { matched, mismatched, missing, unexpected, storageModuleOnlyChange };
}

// ---------------------------------------------------------------------------
// Lifecycle state machine
// ---------------------------------------------------------------------------

const LEGAL_TRANSITIONS: Readonly<Record<DeviceLifecycleState, readonly DeviceLifecycleState[]>> = {
  manufactured: ["enrolled", "quarantined", "retired"],
  // `enrolled -> active` is deliberately ABSENT. A device reaches `active` only
  // through `awaiting_trust`, which means only through an accepted claim and a
  // bound assignment. The provisioning chain is a state-machine property, not a
  // convention a caller could route around.
  enrolled: [
    "awaiting_trust",
    "quarantined",
    "restricted_investigation",
    "suspended",
    "retired",
    "replaced",
  ],
  awaiting_trust: [
    "active",
    "enrolled",
    "quarantined",
    "restricted_investigation",
    "suspended",
    "retired",
    "replaced",
  ],
  active: [
    "suspended",
    "quarantined",
    "restricted_investigation",
    "enrolled",
    "retired",
    "replaced",
  ],
  suspended: [
    "awaiting_trust",
    "enrolled",
    "quarantined",
    "restricted_investigation",
    "retired",
    "replaced",
  ],
  // KLD-2026-07-28-002 §10 lesser containment. Resolves UPWARD to whatever the
  // device was doing (false-positive disposition) or DOWNWARD to full
  // quarantine (§10 escalation). Containment never steps down, which is why
  // `quarantined` has no edge back to here.
  restricted_investigation: [
    "active",
    "awaiting_trust",
    "enrolled",
    "quarantined",
    "retired",
    "replaced",
  ],
  quarantined: ["enrolled", "retired", "replaced"],
  retired: [],
  replaced: [],
};

export function isTerminalLifecycleState(state: DeviceLifecycleState): boolean {
  return LEGAL_TRANSITIONS[state].length === 0;
}

/**
 * Mirrors the database trigger in migration 0120. Legality here is NECESSARY
 * but NOT SUFFICIENT for activation: `enrolled -> active` is legal in this
 * matrix and is still refused by the BLK-005 gate.
 */
export function isLegalLifecycleTransition(
  from: DeviceLifecycleState,
  to: DeviceLifecycleState,
): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Fail-closed error
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Abstract provider interfaces
// ---------------------------------------------------------------------------

/**
 * Approved PKI trust configuration for one environment.
 *
 * Every field is an owner/security decision on the BLK-005 ballot, and every
 * key field is a custody REFERENCE — never key material. No value in this
 * interface is ever a secret, and no implementation may accept one.
 */
export interface PkiTrustConfiguration {
  readonly environment: TrustEnvironment;
  readonly rootCaReference: string;
  readonly deviceIssuingCaReference: string;
  readonly manufacturingCaReference: string;
  readonly requiredKeyStorageClass: KeyStorageClass;
  readonly certificateLifetimeDays: number;
  readonly renewalWindowDays: number;
  readonly overlapWindowDays: number;
  readonly revocationMechanism: string;
  readonly offlineGraceHours: number;
  /** Purpose separation: these are distinct keys, never one key reused. */
  readonly configurationSigningKeyReference: string;
  readonly releaseSigningKeyReference: string;
  readonly transportSigningKeyReference: string;
  /** KLD-2026-07-28-002 §1/§7 added these two as separate purposes. */
  readonly manufacturingEnrollmentKeyReference: string;
  readonly emergencyRecoveryKeyReference: string;
  readonly approvedByDecisionRef: string;
}

/**
 * The four signing purposes the owner requires to stay separate. Reusing one
 * key across two of them is a design error, not a configuration convenience.
 */

/**
 * A signed artifact carries the purpose its key was authorized for. §7: "A
 * verifier must reject an otherwise valid signature when the signing key is not
 * authorized for the artifact purpose." Binding the purpose INTO the signed
 * material is what makes that check possible — a purpose carried only alongside
 * the signature can be swapped by whoever relays it.
 */
export interface SignedArtifact {
  readonly purpose: SigningPurpose;
  readonly environment: TrustEnvironment;
  readonly keyReference: string;
  readonly payload: Uint8Array;
  readonly signature: Uint8Array;
}

/**
 * Canonical bytes a signature is computed over. The purpose and environment are
 * prefixed, so a signature made for one purpose cannot verify as another even
 * if the same key were somehow used for both.
 */
export function signingPreimage(
  purpose: SigningPurpose,
  environment: TrustEnvironment,
  payload: Uint8Array,
): Uint8Array {
  const header = new TextEncoder().encode(`kitluy.sig.v1\n${purpose}\n${environment}\n`);
  const out = new Uint8Array(header.length + payload.length);
  out.set(header, 0);
  out.set(payload, header.length);
  return out;
}

/**
 * Device key generation. §4: keys are generated ON the device and are never
 * generated centrally and copied onto it — which is why this returns only a
 * PUBLIC key fingerprint and metadata. There is no method here that yields
 * private key material, deliberately.
 */
export interface DeviceKeyMetadata {
  readonly publicKeyFingerprint: string;
  readonly algorithm: string;
  readonly hardwareTrustLevel: HardwareTrustLevel;
  readonly exportable: boolean;
  readonly generatedOnDevice: boolean;
}

export interface DeviceKeyProvider {
  /** Generates a key pair ON the device and returns PUBLIC metadata only. */
  generateDeviceKey(
    deviceRecordId: DeviceRecordId,
    environment: TrustEnvironment,
  ): Promise<DeviceKeyMetadata>;

  /** Metadata for the key already resident on the device. */
  describeDeviceKey(deviceRecordId: DeviceRecordId): Promise<DeviceKeyMetadata>;
}

/**
 * Rejects key metadata that contradicts §4. Used at the boundary so a provider
 * that lies about its own properties is caught rather than trusted.
 */
export function assertDeviceKeyAcceptable(
  metadata: DeviceKeyMetadata,
  environment: TrustEnvironment,
): void {
  if (!metadata.generatedOnDevice) {
    throw new RequiredCryptographicValueError(
      "on-device key generation — KLD-2026-07-28-002 §4 forbids generating a device key centrally and copying it onto the Hub",
      environment,
    );
  }
  if (environment !== "development") {
    if (!isHardwareBacked(metadata.hardwareTrustLevel)) {
      throw new RequiredCryptographicValueError(
        "hardware-backed device key (TPM 2.0 or approved secure element)",
        environment,
      );
    }
    if (metadata.exportable) {
      throw new RequiredCryptographicValueError("non-exportable device private key", environment);
    }
  }
}

export interface CertificateRequest {
  readonly deviceRecordId: DeviceRecordId;
  readonly environment: TrustEnvironment;
  readonly devicePublicKeyFingerprint: string;
  readonly keyStorageClass: KeyStorageClass;
  readonly hardwareManifestDigest: string;
}

export interface IssuedCertificateRecord {
  readonly certificateSerial: string;
  readonly issuerReference: string;
  readonly publicKeyFingerprint: string;
  readonly status: CertificateStatus;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * Certificate authority operations. Implemented only after BLK-005 rules the
 * hierarchy, custody and windows.
 */
export interface PkiProvider {
  /**
   * Resolves approved trust configuration, or throws
   * {@link RequiredCryptographicValueError}. Callers must not fall back to a
   * default: there is no safe default for a trust root.
   */
  resolveTrustConfiguration(environment: TrustEnvironment): Promise<PkiTrustConfiguration>;

  issueDeviceCertificate(request: CertificateRequest): Promise<IssuedCertificateRecord>;

  revokeDeviceCertificate(
    certificateSerial: string,
    environment: TrustEnvironment,
    reasonCode: string,
  ): Promise<void>;

  /** Whether a serial is revoked, per the environment's approved mechanism. */
  isCertificateRevoked(certificateSerial: string, environment: TrustEnvironment): Promise<boolean>;
}

export interface AttestationEvidence {
  readonly secureBootEnabled: boolean;
  readonly bootMeasurement: string | undefined;
  readonly osImageDigest: string | undefined;
  readonly keyStorageClass: KeyStorageClass;
}

export interface AttestationVerdict {
  readonly trusted: boolean;
  readonly reasons: readonly string[];
}

/**
 * Hardware attestation. The reference-hardware decision (TPM / secure element)
 * is `[REQUIRED: TPM/secure-element reference hardware decision]` under
 * BLK-005, so no implementation can honestly verify attestation yet.
 */
export interface AttestationProvider {
  verifyDeviceAttestation(
    deviceRecordId: DeviceRecordId,
    environment: TrustEnvironment,
    evidence: AttestationEvidence,
  ): Promise<AttestationVerdict>;
}

/**
 * Signing for a NAMED purpose. The purpose is a required argument precisely so
 * that reusing one key across purposes cannot happen by omission.
 */
export interface SigningProvider {
  sign(
    purpose: SigningPurpose,
    environment: TrustEnvironment,
    payload: Uint8Array,
  ): Promise<Uint8Array>;

  verify(
    purpose: SigningPurpose,
    environment: TrustEnvironment,
    payload: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean>;

  /** Custody locator for the key bound to a purpose. Never key material. */
  keyReference(purpose: SigningPurpose, environment: TrustEnvironment): Promise<string>;
}

// ---------------------------------------------------------------------------
// The fail-closed default implementation
// ---------------------------------------------------------------------------

/**
 * The provider that is wired everywhere until BLK-005 is ruled.
 *
 * Every method throws {@link RequiredCryptographicValueError}. It exists so
 * that an unconfigured system refuses loudly and identically to an unapproved
 * one — the failure mode to avoid is a development stub that quietly succeeds
 * and makes a blocked programme look finished.
 */
export class UnconfiguredPkiProvider
  implements PkiProvider, AttestationProvider, SigningProvider, DeviceKeyProvider
{
  constructor(private readonly blockerRef: string = PKI_BLOCKER_REF) {}

  /**
   * Every method below is `async` so the refusal arrives as a REJECTED
   * PROMISE, not a synchronous throw. The interface promises a `Promise`, and a
   * caller written against it — `provider.sign(...).catch(handle)` — would be
   * bypassed entirely by a synchronous throw and crash somewhere unrelated.
   */
  private refuse(requiredValue: string, environment?: TrustEnvironment): never {
    throw new RequiredCryptographicValueError(requiredValue, environment, this.blockerRef);
  }

  async resolveTrustConfiguration(environment: TrustEnvironment): Promise<PkiTrustConfiguration> {
    this.refuse("approved PKI trust configuration", environment);
  }

  async issueDeviceCertificate(request: CertificateRequest): Promise<IssuedCertificateRecord> {
    this.refuse(
      "production certificate issuance authority and certificate windows",
      request.environment,
    );
  }

  async revokeDeviceCertificate(
    _certificateSerial: string,
    environment: TrustEnvironment,
  ): Promise<void> {
    this.refuse("production revocation distribution mechanism", environment);
  }

  async isCertificateRevoked(
    _certificateSerial: string,
    environment: TrustEnvironment,
  ): Promise<boolean> {
    // Deliberately refuses rather than returning `true`. "Treat everything as
    // revoked" would look like a safe default while actually asserting a
    // revocation fact nobody established.
    this.refuse("production revocation distribution mechanism", environment);
  }

  async verifyDeviceAttestation(
    _deviceRecordId: DeviceRecordId,
    environment: TrustEnvironment,
  ): Promise<AttestationVerdict> {
    this.refuse(
      "TPM/secure-element reference hardware decision and attestation policy",
      environment,
    );
  }

  async sign(purpose: SigningPurpose, environment: TrustEnvironment): Promise<Uint8Array> {
    this.refuse(`production ${purpose} key custody`, environment);
  }

  async verify(purpose: SigningPurpose, environment: TrustEnvironment): Promise<boolean> {
    this.refuse(`production ${purpose} trust anchor`, environment);
  }

  async keyReference(purpose: SigningPurpose, environment: TrustEnvironment): Promise<string> {
    this.refuse(`production ${purpose} key custody`, environment);
  }

  async generateDeviceKey(
    _deviceRecordId: DeviceRecordId,
    environment: TrustEnvironment,
  ): Promise<DeviceKeyMetadata> {
    this.refuse(
      "on-device key generation provider (TPM 2.0 or approved secure element)",
      environment,
    );
  }

  async describeDeviceKey(_deviceRecordId: DeviceRecordId): Promise<DeviceKeyMetadata> {
    this.refuse("on-device key generation provider");
  }
}

/**
 * Raised when a signature is presented for a purpose its key is not authorized
 * for. KLD-2026-07-28-002 §7: "A verifier must reject an otherwise valid
 * signature when the signing key is not authorized for the artifact purpose."
 *
 * Deliberately NOT a subclass of {@link RequiredCryptographicValueError}: this
 * is a REJECTED ARTIFACT, not a missing configuration, and conflating the two
 * would let a cross-purpose attack read as "not configured yet".
 */
export class CrossPurposeSignatureError extends Error {
  readonly code = "KLUY-DEVICE-CROSS-PURPOSE-SIGNATURE" as const;
  readonly presentedPurpose: SigningPurpose;
  readonly expectedPurpose: SigningPurpose;

  constructor(presentedPurpose: SigningPurpose, expectedPurpose: SigningPurpose) {
    super(
      `KLUY-DEVICE-CROSS-PURPOSE-SIGNATURE: signature was made for ${presentedPurpose} ` +
        `but is presented as ${expectedPurpose}; cross-purpose signing is prohibited ` +
        `(KLD-2026-07-28-002 §7)`,
    );
    this.name = "CrossPurposeSignatureError";
    this.presentedPurpose = presentedPurpose;
    this.expectedPurpose = expectedPurpose;
  }
}

/**
 * Purpose check, run BEFORE any cryptography. A cross-purpose artifact is
 * rejected on structure alone, so the guarantee does not depend on a signature
 * verifier that has not been implemented yet.
 */
export function assertPurposeAuthorized(
  artifact: SignedArtifact,
  expectedPurpose: SigningPurpose,
): void {
  if (artifact.purpose !== expectedPurpose) {
    throw new CrossPurposeSignatureError(artifact.purpose, expectedPurpose);
  }
}

// ---------------------------------------------------------------------------
// Configuration validation (used the moment BLK-005 IS ruled)
// ---------------------------------------------------------------------------

export interface TrustConfigurationProblem {
  readonly field: string;
  readonly problem: string;
}

/**
 * Structural checks that mirror the database CHECK constraints in migration
 * 0120. They exist so an approved configuration is rejected at the edge as
 * well as at the database, and so the purpose-separation rule is stated once
 * per layer rather than assumed.
 */
export function validateTrustConfiguration(
  config: PkiTrustConfiguration,
): readonly TrustConfigurationProblem[] {
  const problems: TrustConfigurationProblem[] = [];

  const decisionRef = config.approvedByDecisionRef.trim();
  if (
    decisionRef === "" ||
    /\[REQUIRED/i.test(decisionRef) ||
    /^(tbd|todo|placeholder|test|unknown|n\/?a)$/i.test(decisionRef)
  ) {
    problems.push({
      field: "approvedByDecisionRef",
      problem: "must name the owner/security decision that approved this configuration",
    });
  }

  const signingKeys: ReadonlyArray<readonly [string, string]> = [
    ["deviceIssuingCaReference", config.deviceIssuingCaReference],
    ["configurationSigningKeyReference", config.configurationSigningKeyReference],
    ["releaseSigningKeyReference", config.releaseSigningKeyReference],
    ["transportSigningKeyReference", config.transportSigningKeyReference],
    ["manufacturingEnrollmentKeyReference", config.manufacturingEnrollmentKeyReference],
    ["emergencyRecoveryKeyReference", config.emergencyRecoveryKeyReference],
  ];
  for (let i = 0; i < signingKeys.length; i += 1) {
    for (let j = i + 1; j < signingKeys.length; j += 1) {
      const a = signingKeys[i]!;
      const b = signingKeys[j]!;
      if (a[1] === b[1]) {
        problems.push({
          field: b[0],
          problem: `reuses the key referenced by ${a[0]}; device identity, configuration signing, release signing and transport signing are separate keys`,
        });
      }
    }
  }

  const cas: ReadonlyArray<readonly [string, string]> = [
    ["rootCaReference", config.rootCaReference],
    ["manufacturingCaReference", config.manufacturingCaReference],
    ["deviceIssuingCaReference", config.deviceIssuingCaReference],
  ];
  for (let i = 0; i < cas.length; i += 1) {
    for (let j = i + 1; j < cas.length; j += 1) {
      const a = cas[i]!;
      const b = cas[j]!;
      if (a[1] === b[1]) {
        problems.push({
          field: b[0],
          problem: `is the same CA as ${a[0]}; the offline root never issues device certificates directly`,
        });
      }
    }
  }

  if (config.certificateLifetimeDays <= 0) {
    problems.push({
      field: "certificateLifetimeDays",
      problem: "must be positive",
    });
  }
  if (config.renewalWindowDays >= config.certificateLifetimeDays) {
    problems.push({
      field: "renewalWindowDays",
      problem: "must be shorter than the certificate lifetime",
    });
  }
  if (config.overlapWindowDays >= config.certificateLifetimeDays) {
    problems.push({
      field: "overlapWindowDays",
      problem: "must be shorter than the certificate lifetime",
    });
  }
  if (config.offlineGraceHours < 0) {
    problems.push({
      field: "offlineGraceHours",
      problem: "must not be negative",
    });
  }
  if (config.environment === "production" && config.requiredKeyStorageClass === "software") {
    problems.push({
      field: "requiredKeyStorageClass",
      problem:
        "software key storage is a recorded weakness permitted only for development; production requires hardware-backed custody",
    });
  }

  return problems;
}
export * from "./trusted-time.js";
export * from "./certificate-validity.js";
export * from "./certificate-renewal.js";
export * from "./revocation-snapshot.js";
export * from "./configuration-validity.js";
export * from "./dev-crypto.js";
export * from "./certificate-issuance.js";
export * from "./issuance-adapter.js";
export * from "./replacement-key-pop.js";
export * from "./provisioning-pop.js";
export * from "./activation-ack.js";
export * from "./pairing.js";
export * from "./same-key-renewal-preflight.js";
export * from "./same-key-renewal-issuance.js";
export * from "./replacement-key-provider.js";
export * from "./rotate-key-renewal-issuance.js";
export * from "./renewal-reconciliation.js";
export * from "./credential-lifecycle.js";
export * from "./credential-lifecycle-jobs.js";
export * from "./credential-revocation.js";
export * from "./pg-revocation-gateway.js";
export * from "./pg-revocation-lookup.js";
export * from "./key-destruction.js";
export * from "./revocation-and-destruction-jobs.js";
export * from "./snapshot-signing.js";
export * from "./edge-discovery.js";
export * from "./credential-package.js";
