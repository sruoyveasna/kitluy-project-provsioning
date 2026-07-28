/**
 * Shared fixtures for the four governed consumers.
 *
 * The TrustedTimeEvaluation is built by hand here: these tests are about how
 * each CONSUMER reacts to a given trusted-time verdict. The cross-consumer test
 * drives all four from one real evaluator instead, which is where the layers
 * are proven to agree rather than assumed to.
 */
import type { TrustedTimeEvaluation, TrustedTimeStatus } from "../src/trusted-time.js";
import type {
  CertificateIssuerRegistration,
  DeviceCertificate,
  RevocationLookup,
} from "../src/certificate-validity.js";

export const DEVICE = "11111111-1111-4111-8111-111111111111";
export const OTHER_DEVICE = "22222222-2222-4222-8222-222222222222";
export const NOW = new Date("2026-07-28T08:00:00.000Z");
export const days = (n: number): Date => new Date(NOW.getTime() + n * 86400000);
export const hours = (n: number): Date => new Date(NOW.getTime() + n * 3600000);

export const ISSUER = "dev-device-identity-ca";

export const ISSUERS: CertificateIssuerRegistration[] = [
  {
    issuerKeyId: ISSUER,
    environment: "development",
    purpose: "device_identity",
    revoked: false,
  },
  {
    issuerKeyId: "dev-release-ca",
    environment: "development",
    purpose: "release_signing",
    revoked: false,
  },
  {
    issuerKeyId: "dev-revoked-ca",
    environment: "development",
    purpose: "device_identity",
    revoked: true,
  },
  {
    issuerKeyId: "prod-device-identity-ca",
    environment: "production",
    purpose: "device_identity",
    revoked: false,
  },
];

export const trusted = (
  at: Date = NOW,
  status: TrustedTimeStatus = "trusted",
): TrustedTimeEvaluation => ({
  status,
  trustedTime: at,
  source: "rtc",
  floorAdvanced: false,
  anomalyType: status === "trusted" ? null : "probe anomaly",
  detail: status,
});

export const noRevocations: RevocationLookup = {
  isCertificateRevoked: () => false,
  isDeviceRevoked: () => false,
};

export const revokes = (serial: string): RevocationLookup => ({
  isCertificateRevoked: (s) => s === serial,
  isDeviceRevoked: () => false,
});

export const certificate = (over: Partial<DeviceCertificate> = {}): DeviceCertificate => ({
  certificateSerial: "SER-1",
  purpose: "device_identity",
  environment: "development",
  deviceRecordId: DEVICE,
  publicKeyFingerprint: "a".repeat(64),
  deviceKeyGeneration: 2,
  assignmentGeneration: 5,
  notBefore: days(-5),
  notAfter: days(25),
  issuerKeyId: ISSUER,
  signature: new Uint8Array([1]),
  ...over,
});

export const RESTRICTED_STATUSES = [
  "restricted_clock_rollback",
  "restricted_forward_jump",
  "restricted_rtc_failure",
  "restricted_no_trusted_source",
] as const;
