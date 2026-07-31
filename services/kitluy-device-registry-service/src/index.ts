/**
 * kitluy-device-registry-service — Device registry — HET-enrolled device identity, hardware manifests, certificate records (Hub spec Appendix A)
 *
 * STATUS: runtime kernel (health/readiness/version, config validation, graceful
 * shutdown) BUILT + TESTED.
 *
 * Governed device-credential revocation is COMPOSED here (WS-11-T003 Step 4
 * remediation §2/§3, migration group 0155): `main.ts` resolves the real service
 * over a real pool at startup and fails closed if it cannot.
 *
 * WHAT IS NOT YET TRUE, stated because an earlier version of this comment said
 * otherwise: no HTTP route, queue subscriber or scheduled process INVOKES any of
 * the four governed doors. `http.ts` still serves only health and version. The
 * online verifier and the lapse worker have no runtime caller at all, and no
 * producer enqueues the lapse job kind. So the doors are reachable and proven
 * against the real database BY TESTS, and a deployed process would call none of
 * them. RV-GW-002 is NOT closed; see the handoff for the exact open conditions.
 */
import type { HealthReport } from "@kitluy/observability";

export {
  handleKernelRequest,
  handleRequest,
  type KernelDeps,
  type KernelResponse,
} from "./http.js";

export const SERVICE_NAME = "kitluy-device-registry-service" as const;
export const SERVICE_VERSION = "0.1.0" as const;

export function buildHealthReport(ready: boolean): HealthReport {
  return {
    status: ready ? "ok" : "unavailable",
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    checks: { startup: ready ? "ok" : "failed" },
  };
}

export {
  DEVICE_REGISTRY_DATABASE_URL,
  InvalidHumanSessionError,
  REGISTRY_ROLES,
  createRegistryPool,
  deviceRegistryDatabaseUrl,
  observeSessionIdentity,
  withHumanSession,
  withServiceRole,
  type ClientSource,
  type RegistryRole,
  type VerifiedHumanSession,
} from "./database.js";

export {
  FORBIDDEN_IMPLEMENTATION_OVERRIDES,
  resolveDeviceRevocationService,
  type DeviceRevocationRuntime,
  type ResolveOptions,
} from "./composition.js";

export {
  refuseAllRequests,
  type AuthenticatedPrincipal,
  type AuthenticationOutcome,
  type RequestAuthenticator,
  type RequestHeaders,
} from "./authentication.js";

export {
  createRevocationRouter,
  type RevocationRouter,
  type RevocationRouterDeps,
  type RouteRequest,
  type RouteResponse,
} from "./revocation-routes.js";

export {
  createEmergencyLapseScheduler,
  type EmergencyLapseScheduler,
  type ScheduleLapseRequest,
  type ScheduleLapseResult,
} from "./lapse-scheduling.js";

export {
  EMERGENCY_REASON_CODES,
  createDeviceRevocationService,
  type DeviceRevocationService,
  type EmergencyAuthorizationStatus,
  type EmergencyOutcomeCode,
  type EmergencyReasonCode,
  type EmergencyRevocationRequest,
  type EmergencyRevocationResult,
  type LapseResult,
  type PostApprovalDecision,
  type PostApprovalOutcomeCode,
  type PostApprovalRequest,
  type PostApprovalResult,
} from "./revocation-service.js";

export {
  INSUFFICIENT_PRIVILEGE,
  RedactedRevocationError,
  UNDEFINED_FUNCTION,
  classifyRevocationFailure,
  throwRedacted,
  type RedactedRevocationFailure,
  type RevocationFailureClass,
} from "./revocation-failures.js";

export {
  createOnlineCredentialVerifier,
  type OnlineCredentialVerifier,
  type OnlineVerificationOutcome,
  type OnlineVerificationRequest,
} from "./online-verifier.js";

export {
  UNSIGNED_SIGNER_KEY_ID,
  buildRevocationSnapshot,
  canonicalPayload,
  enforcedRevocationUnion,
  payloadDigest,
  recomputePayloadDigest,
  scopedDigest,
  verifySnapshotScope,
  type BuildSnapshotOptions,
  type EnforcedRevocations,
  type ScopedRevocationSnapshot,
  type SnapshotScope,
  type SnapshotScopeVerdict,
} from "./revocation-snapshot-builder.js";

export {
  EMERGENCY_LAPSE_JOB_KIND,
  createEmergencyLapseWorker,
  emergencyLapseDedupeKey,
  emergencyLapseJobHandler,
  readLapseAuthorizationId,
  type EmergencyLapseWorker,
} from "./lapse-worker.js";
