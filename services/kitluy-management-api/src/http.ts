/**
 * Pure request router for the service kernel. Kept free of node:http types so
 * the routing contract is unit-testable without sockets.
 */
import { errorEnvelope } from "@kitluy/api-errors";
import {
  authorizeRequest,
  PERMISSION,
  type AuthorizationOutcome,
  type DatabaseHandle,
  type TokenVerifier,
} from "./authorization.js";
import {
  evaluateProvisioningReadiness,
  getFleetDevice,
  listFleet,
  UNRULED_FRESHNESS_POLICY,
  type FreshnessPolicy,
} from "./fleet.js";
import { buildHealthReport, SERVICE_NAME, SERVICE_VERSION } from "./index.js";

export interface KernelResponse {
  readonly status: number;
  readonly body: unknown;
}

export function handleKernelRequest(method: string, path: string, ready: boolean): KernelResponse {
  if (method !== "GET") {
    return { status: 405, body: errorEnvelope("VALIDATION_FAILED", "Method not allowed") };
  }
  switch (path) {
    case "/health/live":
      return { status: 200, body: { status: "ok", service: SERVICE_NAME } };
    case "/health/ready": {
      const report = buildHealthReport(ready);
      return { status: report.status === "ok" ? 200 : 503, body: report };
    }
    case "/version":
      return { status: 200, body: { service: SERVICE_NAME, version: SERVICE_VERSION } };
    default:
      return {
        status: 404,
        body: errorEnvelope(
          "RESOURCE_NOT_FOUND",
          "No such route. Business contracts are not implemented in this scaffold.",
        ),
      };
  }
}

// ---------------------------------------------------------------------------
// Governed management routes
// ---------------------------------------------------------------------------

/**
 * URI-versioned prefix, per the governance block in `openapi.yaml`.
 *
 * These routes exist because OD-ADMIN-FLEET-001 keeps `kitluy_devices` CLOSED
 * to browsers. The Admin Portal cannot read a device row directly — it asks
 * here, and every answer is decided by `authorizeRequest` against canonical
 * database state before a single fleet row is read.
 */
export const MANAGEMENT_PREFIX = "/management/v1" as const;

export interface ManagementRouterDependencies {
  /** Trusted server identity. Authority to CONNECT, never authority to ACT. */
  readonly db: DatabaseHandle;
  readonly verifier: TokenVerifier;
  /** Unruled by default — see `UNRULED_FRESHNESS_POLICY`. */
  readonly freshnessPolicy?: FreshnessPolicy;
  readonly now?: () => Date;
}

export interface ManagementRequest {
  readonly method: string;
  /** Raw request target; a query string is permitted and ignored. */
  readonly url: string;
  readonly authorization: string | undefined;
}

export function isManagementPath(url: string): boolean {
  const path = requestPath(url);
  return path === MANAGEMENT_PREFIX || path.startsWith(`${MANAGEMENT_PREFIX}/`);
}

/** Strip the query string and any trailing slash. Never throws on odd input. */
function requestPath(url: string): string {
  const path = (url.split("?")[0] ?? "").split("#")[0] ?? "";
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Page cap, passed to `listFleet` so the number reported is the one in force. */
const DEVICE_PAGE_LIMIT = 200;

function nowIso(deps: ManagementRouterDependencies): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

/**
 * Operator-facing text for each denial reason.
 *
 * The canonical registry deliberately collapses "absent scope" and "absent
 * permission" into ONE code so route responses cannot be used to map the
 * permission model. That constraint is kept: the message never names the
 * permission that was missing. The machine-readable `reason` is still returned,
 * because "sign in again", "your account is disabled" and "you lack access to
 * this view" are three different things to tell a person, and a portal that
 * cannot tell them apart shows the wrong one.
 */
const DENIAL_MESSAGES: Readonly<Record<string, string>> = {
  "KLUY-AUTH-MISSING-TOKEN": "Authentication is required.",
  "KLUY-AUTH-INVALID-TOKEN": "This session is no longer valid. Sign in again.",
  "KLUY-ADMIN-NOT-PROVISIONED": "This account is not an Admin account.",
  "KLUY-ADMIN-DISABLED": "This Admin account is disabled.",
  "KLUY-ADMIN-INACTIVE": "This Admin account is not active.",
  "KLUY-PERMISSION-DENIED": "This account does not hold the access required for this view.",
};

function denialResponse(deny: Extract<AuthorizationOutcome, { kind: "deny" }>): KernelResponse {
  return {
    status: deny.status,
    body: errorEnvelope(
      deny.status === 401 ? "AUTHENTICATION_REQUIRED" : "SCOPE_PERMISSION_DENIED",
      DENIAL_MESSAGES[deny.code] ?? "Access denied.",
      { details: { reason: deny.code } },
    ),
  };
}

function notFound(message: string): KernelResponse {
  return { status: 404, body: errorEnvelope("RESOURCE_NOT_FOUND", message) };
}

/**
 * Route one management request.
 *
 * ORDER IS LOAD-BEARING: authorization runs before any argument is validated
 * and before any row is read. Validating first would let an unauthenticated
 * caller tell a well-formed device id from a malformed one, which is a small
 * but free oracle over the identifier space.
 */
export async function handleManagementRequest(
  deps: ManagementRouterDependencies,
  request: ManagementRequest,
): Promise<KernelResponse> {
  const path = requestPath(request.url);
  const route = path.slice(MANAGEMENT_PREFIX.length);

  if (request.method !== "GET") {
    // Every route in this slice is a read. Provisioning issuance is a governed
    // mutation and is deliberately NOT reachable here yet.
    return { status: 405, body: errorEnvelope("VALIDATION_FAILED", "Method not allowed") };
  }

  if (route === "/me") {
    // No specific permission: the question is only "is this a usable Admin".
    const outcome = await authorizeRequest(deps.db, deps.verifier, request.authorization, null);
    if (outcome.kind === "deny") return denialResponse(outcome);
    return {
      status: 200,
      body: {
        userId: outcome.userId,
        permissions: outcome.permissions,
        dataAsOf: nowIso(deps),
      },
    };
  }

  if (route === "/devices") {
    const outcome = await authorizeRequest(
      deps.db,
      deps.verifier,
      request.authorization,
      PERMISSION.FLEET_READ,
    );
    if (outcome.kind === "deny") return denialResponse(outcome);

    const policy = deps.freshnessPolicy ?? UNRULED_FRESHNESS_POLICY;
    const now = deps.now?.() ?? new Date();
    const devices = await listFleet(deps.db, { policy, now, limit: DEVICE_PAGE_LIMIT });
    return {
      status: 200,
      body: {
        devices,
        count: devices.length,
        // Pagination is a governed cursor contract this slice does not
        // implement. Rather than pretend the page is the whole fleet, the
        // response says when the cap was reached.
        limit: DEVICE_PAGE_LIMIT,
        truncated: devices.length >= DEVICE_PAGE_LIMIT,
        freshnessPolicyRuled: policy.staleAfterSeconds !== null,
        dataAsOf: now.toISOString(),
      },
    };
  }

  const deviceMatch = /^\/devices\/([^/]+)$/.exec(route);
  if (deviceMatch !== null) {
    const outcome = await authorizeRequest(
      deps.db,
      deps.verifier,
      request.authorization,
      PERMISSION.FLEET_READ,
    );
    if (outcome.kind === "deny") return denialResponse(outcome);

    const deviceId = decodeURIComponent(deviceMatch[1] ?? "");
    if (!UUID_PATTERN.test(deviceId)) {
      // Not 422: a malformed identifier and an absent device are the same
      // answer to an authorized caller, and the read model is keyed by uuid.
      return notFound("No such device.");
    }

    const policy = deps.freshnessPolicy ?? UNRULED_FRESHNESS_POLICY;
    const now = deps.now?.() ?? new Date();
    const device = await getFleetDevice(deps.db, deviceId, { policy, now });
    if (device === null) return notFound("No such device.");

    return {
      status: 200,
      body: {
        device,
        // DERIVED presentation gate, never a stored eligibility flag. The
        // governed issuance path revalidates server-side; this only lets the
        // UI disable a control and say why.
        provisioning: evaluateProvisioningReadiness(device),
        freshnessPolicyRuled: policy.staleAfterSeconds !== null,
        dataAsOf: now.toISOString(),
      },
    };
  }

  return notFound("No such route.");
}

// ---------------------------------------------------------------------------
// Cross-origin policy
// ---------------------------------------------------------------------------

/**
 * Resolve CORS headers for one request origin.
 *
 * An explicit allowlist, never `*`. The Admin Portal is a privileged HET
 * control plane (RB v4 §8.1); a wildcard would let any page a signed-in Admin
 * visits script this API with their live token. Unknown origins get NO
 * cross-origin headers at all, which the browser then refuses.
 */
export function resolveCorsHeaders(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): Readonly<Record<string, string>> {
  if (origin === undefined || !allowedOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}
