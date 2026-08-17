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
import {
  issueHubPairingCode,
  resolveStoreScope,
  HUB_PAIRING_TTL_SECONDS,
  type HubPairingIssuanceDeps,
} from "./hub-pairing-issuance.js";
import { authorizePartnerRequest } from "./partner-authorization.js";

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
  /**
   * Required only by the Hub pairing-code route, which MUTATES and therefore
   * needs a transaction it can enter `kitluy_hub_issuance_service` inside.
   * `db` above is a bare query handle and cannot do that. Absent means the route
   * fails CLOSED with 503 rather than 404 — "not configured" and "no such route"
   * are different facts, and a Partner who saw 404 would think the feature does
   * not exist.
   */
  readonly issuance?: HubPairingIssuanceDeps;
  /** Environment asserted to `has_permission`; RLS-022 fails closed without it. */
  readonly environment?: string;
}

export interface ManagementRequest {
  readonly method: string;
  /** Raw request target; a query string is permitted and ignored. */
  readonly url: string;
  readonly authorization: string | undefined;
  /** Raw JSON text, for the routes that mutate. Absent on every GET. */
  readonly body?: string;
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
 * `POST /management/v1/hub-pairing-codes` — a Partner issues a Store Hub pairing
 * code for one of their own Hubs.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY NAME, AND WHAT IT MAY NOT
 * ===========================================================================
 * It names the Hub and where the Hub is going: `deviceRecordId`,
 * `digitalStoreId`, `storeLocationId`. It may NOT name the Tenant — that is
 * resolved from the Store row, because a caller able to supply it could try to
 * attach a Hub across Tenants. It may not name the TTL either: fifteen minutes is
 * the protocol, enforced by a row constraint, and a caller-chosen lifetime is not
 * a thing this surface offers.
 *
 * Unknown fields are refused rather than ignored, the same discipline the
 * device-facing routes hold.
 *
 * ===========================================================================
 * TWO IDENTITIES, DELIBERATELY
 * ===========================================================================
 * Authority is decided as the ACTOR (`set local role authenticated`, so
 * `auth.uid()` resolves and every governed check answers about the human).
 * The governed door is then reached as `kitluy_hub_issuance_service`, which holds
 * one capability and no table access. Neither identity can do the other's job,
 * which is the point.
 */
async function handleHubPairingCodeIssuance(
  deps: ManagementRouterDependencies,
  request: ManagementRequest,
): Promise<KernelResponse> {
  if (deps.issuance === undefined) {
    // Fails CLOSED. A Partner seeing 404 would conclude the feature does not
    // exist; 503 says this deployment is not wired for it.
    return {
      status: 503,
      body: errorEnvelope(
        "DEPENDENCY_UNAVAILABLE",
        "hub pairing-code issuance is not configured on this instance",
      ),
    };
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(request.body ?? "");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        status: 422,
        body: errorEnvelope("VALIDATION_FAILED", "Body must be a JSON object."),
      };
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return { status: 422, body: errorEnvelope("VALIDATION_FAILED", "Body must be a JSON object.") };
  }

  const allowed = ["deviceRecordId", "digitalStoreId", "storeLocationId"];
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    return {
      status: 422,
      body: errorEnvelope("VALIDATION_FAILED", `Unknown field: ${unknown[0]}.`),
    };
  }

  const ids: Record<string, string> = {};
  for (const key of allowed) {
    const value = body[key];
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
      return { status: 422, body: errorEnvelope("VALIDATION_FAILED", `${key} must be a uuid.`) };
    }
    ids[key] = value;
  }

  // AUTHORITY FIRST, and scoped to the named Store. `authorizePartnerRequest`
  // checks the permission and the Store assignment separately, because
  // `has_permission` ignores its own resource arguments.
  const outcome = await authorizePartnerRequest(
    deps.db,
    deps.verifier,
    request.authorization,
    "fleet.hub_pairing_code.issue",
    { digitalStoreId: ids.digitalStoreId! },
    deps.environment ?? "development",
  );
  if (outcome.kind === "deny") {
    return {
      status: outcome.status,
      body: errorEnvelope(
        outcome.status === 401 ? "AUTHENTICATION_REQUIRED" : "SCOPE_PERMISSION_DENIED",
        outcome.status === 401 ? "Sign in to continue." : "Access denied.",
        { details: { reason: outcome.code } },
      ),
    };
  }

  // The Tenant comes from the Store, never from the request. This also validates
  // that the Location actually belongs to the Store.
  const scope = await resolveStoreScope(deps.issuance, ids.digitalStoreId!, ids.storeLocationId!);
  if (scope === null) {
    return notFound("No such Store or Location.");
  }

  const issued = await issueHubPairingCode(deps.issuance, {
    deviceRecordId: ids.deviceRecordId!,
    tenantId: scope.tenantId,
    digitalStoreId: ids.digitalStoreId!,
    storeLocationId: ids.storeLocationId!,
    // Names the human who issued it, for the claim's audit trail.
    operatorRef: `partner/${outcome.userId}`,
  });

  if (issued.kind === "refused") {
    return {
      status: 422,
      body: errorEnvelope("VALIDATION_FAILED", issued.detail, {
        details: { reason: issued.code },
      }),
    };
  }

  return {
    status: 201,
    body: {
      // SHOWN ONCE. Only the digest is stored, so there is no endpoint that can
      // return this value again — the Portal must render it immediately.
      code: issued.issued.code,
      claimId: issued.issued.claimId,
      deviceRecordId: issued.issued.deviceRecordId,
      expiresAt: issued.issued.expiresAt,
      ttlSeconds: HUB_PAIRING_TTL_SECONDS,
      showOnce: true,
      detail:
        "Give this code to the person at the Store Hub. It is valid once, for fifteen minutes, and cannot be retrieved again.",
    },
  };
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

  // Store Hub pairing-code issuance — the ONE mutation on this surface
  // (KLD-2026-08-13-HUB-PAIRING-ROUTE-001). Matched before the read-only guard
  // below, which the rest of the slice still relies on.
  if (route === "/hub-pairing-codes") {
    if (request.method !== "POST") {
      return { status: 405, body: errorEnvelope("VALIDATION_FAILED", "Method not allowed") };
    }
    return await handleHubPairingCodeIssuance(deps, request);
  }

  if (request.method !== "GET") {
    // Every OTHER route in this slice is a read.
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
