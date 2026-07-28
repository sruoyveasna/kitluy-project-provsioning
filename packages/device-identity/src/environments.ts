/** Trust environments and signing purposes, in their own module so that no
 * lower-level module needs to import index.ts at runtime. */
export type TrustEnvironment = "development" | "pilot" | "production";

export const TRUST_ENVIRONMENTS: readonly TrustEnvironment[] = [
  "development",
  "pilot",
  "production",
] as const;

/** The SIX purposes KLD-2026-07-28-002 §1/§7 requires to stay separate. */
export type SigningPurpose =
  | "device_identity"
  | "configuration_signing"
  | "release_signing"
  | "transport_signing"
  | "manufacturing_enrollment"
  | "emergency_recovery";

export const SIGNING_PURPOSES: readonly SigningPurpose[] = [
  "device_identity",
  "configuration_signing",
  "release_signing",
  "transport_signing",
  "manufacturing_enrollment",
  "emergency_recovery",
] as const;
