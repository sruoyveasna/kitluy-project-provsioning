/**
 * Errors shared across the device-identity modules.
 *
 * These live in their OWN module rather than index.ts to break an import cycle:
 * index re-exports the consumers, the consumers import trusted-time, and
 * trusted-time needs this class at RUNTIME. Routing that hop through index made
 * the cycle real — the policy tables came back `undefined` at import time and
 * every consumer failed with "cannot read properties of undefined". A type-only
 * import would have been erased; this one is a value.
 */
import type { TrustEnvironment } from "./environments.js";

/** The open blocker every unresolved cryptographic value points at. */
export const PKI_BLOCKER_REF = "BLK-005" as const;

/**
 * Thrown when cryptographic configuration required to proceed has not been
 * approved. Carries the unresolved value and the blocker, so a caller can
 * surface WHY without inventing a reason.
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
