/**
 * @kitluy/device-identity — device identity model, hardware-evidence contracts
 * and the ABSTRACT PKI / attestation / signing-provider interfaces.
 *
 * STATUS: WS-11-T001 (Cycle 10). The identity model, evidence contracts, state
 * machine and provider INTERFACES are implemented here. No production PKI is.
 *
 * Authority:
 *   docs/source/security/kitluy-device-certificate-and-trust-policy-v1.0.0.md
 *     §3 device identity layers, §4 manufacturing enrollment, §8 clone defense,
 *     §11 repair/NVMe/replacement.
 *   Cycle 10 T001 owner instruction (2026-07-28).
 *   Migration group 0120 (supabase/migrations/…_0120_device_enrollment_and_identity.sql)
 *     is the authoritative persistence contract; these types mirror it.
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
 * BLK-005
 * ---------------------------------------------------------------------------
 * BLK-005 (PKI root/CA design, HSM/secure-element model, certificate windows)
 * is OPEN. This module therefore ships INTERFACES and a fail-closed default
 * implementation, and no CA, no key generation, no certificate issuance, no
 * revocation distribution and no signer. `UnconfiguredPkiProvider` refuses
 * every operation with an explicit required-value error, and it is the default
 * so that "nobody wired a provider" and "the design is not approved" produce
 * the same visible refusal rather than silent success.
 */

export const PACKAGE_NAME = "@kitluy/device-identity" as const;

/** The open blocker every refusal in this module points at. */
export const PKI_BLOCKER_REF = "BLK-005" as const;

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

export type DeviceLifecycleState =
  "manufactured" | "enrolled" | "quarantined" | "active" | "suspended" | "retired" | "replaced";

export type EnrollmentState = "sealed" | "superseded" | "revoked";

export type CertificateStatus = "requested" | "active" | "expired" | "revoked" | "superseded";

/**
 * Where a device private key lives. `software` is an explicitly recorded
 * weakness permitted only for development; the production requirement is
 * `[REQUIRED: hardware-backed private-key custody]` pending BLK-005.
 */
export type KeyStorageClass = "software" | "tpm" | "secure_element" | "hsm";

export type TrustEnvironment = "development" | "pilot" | "production";

export const TRUST_ENVIRONMENTS: readonly TrustEnvironment[] = [
  "development",
  "pilot",
  "production",
] as const;

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
  enrolled: ["active", "quarantined", "suspended", "retired", "replaced"],
  active: ["suspended", "quarantined", "retired", "replaced"],
  suspended: ["active", "enrolled", "quarantined", "retired", "replaced"],
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

/**
 * Thrown when cryptographic configuration required to proceed has not been
 * approved. Carries the unresolved value and the blocker, so a caller can log
 * or surface WHY without inventing a reason.
 */
export class RequiredCryptographicValueError extends Error {
  readonly code = "KLUY-DEVICE-PKI-UNCONFIGURED" as const;
  readonly blockerRef: string;
  readonly requiredValue: string;
  readonly environment: TrustEnvironment | undefined;

  constructor(
    requiredValue: string,
    environment?: TrustEnvironment,
    blockerRef: string = PKI_BLOCKER_REF,
  ) {
    super(
      `KLUY-DEVICE-PKI-UNCONFIGURED: [REQUIRED: ${requiredValue}]` +
        (environment === undefined ? "" : ` for environment ${environment}`) +
        ` — ${blockerRef} is OPEN. Certificate issuance, key custody, ` +
        `activation and production signing are refused until the owner rules ` +
        `${blockerRef} and the approved design is implemented, tested and ` +
        `independently reviewed.`,
    );
    this.name = "RequiredCryptographicValueError";
    this.blockerRef = blockerRef;
    this.requiredValue = requiredValue;
    this.environment = environment;
  }
}

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
  readonly approvedByDecisionRef: string;
}

/**
 * The four signing purposes the owner requires to stay separate. Reusing one
 * key across two of them is a design error, not a configuration convenience.
 */
export type SigningPurpose =
  "device_identity" | "configuration_signing" | "release_signing" | "transport_signing";

export const SIGNING_PURPOSES: readonly SigningPurpose[] = [
  "device_identity",
  "configuration_signing",
  "release_signing",
  "transport_signing",
] as const;

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
export class UnconfiguredPkiProvider implements PkiProvider, AttestationProvider, SigningProvider {
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
