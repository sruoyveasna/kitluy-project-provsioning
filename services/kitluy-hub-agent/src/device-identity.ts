/**
 * Device identity and trust boundary interfaces (Hub spec Part 6).
 *
 * Three-layer identity: hardware (device), installation, assignment (§6.3).
 * Keys are generated inside the TPM/secure element, never exported, logged or
 * backed up (§6.5). "IP address never establishes trust" (§3.1).
 *
 * STATUS: SCAFFOLDED interfaces only. Real cryptography, certificate handling
 * and secure-element integration require [REQUIRED] owner values (CA/HSM
 * design, TPM model, certificate validity windows — Hub spec Appendix C).
 */

export interface HardwareIdentity {
  readonly kitluyDeviceId: string;
  readonly piFactoryDuid: string;
  readonly boardSerial: string;
  readonly secureElementId: string;
}

export interface InstallationIdentity {
  readonly installationId: string;
  readonly nvmeSerial: string;
  readonly osImageSha256: string;
}

export interface AssignmentIdentity {
  readonly assignmentId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
}

export type TrustVerdict =
  | { readonly verdict: "trusted" }
  | { readonly verdict: "quarantined"; readonly reason: string }
  | { readonly verdict: "rejected"; readonly reason: string };

/**
 * Trust evaluation boundary. The production implementation compares the
 * presented identity against the HET registry (mismatch matrix, Hub §6.4):
 * root identifiers hard-reject; NVMe serial mismatch quarantines; IP is never
 * identity. Unknown devices yield PROVISIONING_DENIED plus an immutable
 * security event — there is no "approve unknown device" path (§6.9).
 */
export interface DeviceTrustEvaluator {
  evaluate(
    hardware: HardwareIdentity,
    installation: InstallationIdentity,
    assignment: AssignmentIdentity,
  ): Promise<TrustVerdict>;
}
