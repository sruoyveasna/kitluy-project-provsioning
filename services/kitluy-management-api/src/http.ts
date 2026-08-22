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
  listPartnerStores,
  openHubPairingSession,
  readPairingSession,
  resolveStoreScope,
  HUB_PAIRING_TTL_SECONDS,
  type HubPairingIssuanceDeps,
} from "./hub-pairing-issuance.js";
import {
  approveDeviceEnrollment,
  listPendingRegistrations,
  type DeviceApprovalDeps,
} from "./device-approval.js";
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
  /**
   * Required only by the device-approval route, which MUTATES and must enter
   * `service_role` inside a transaction to reach the governed door. Absent means
   * the route fails CLOSED with 503 rather than 404 — "not configured" and "no
   * such route" are different facts, and an Admin who saw 404 would conclude
   * approval does not exist.
   */
  readonly approval?: DeviceApprovalDeps;
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
 * `POST /management/v1/hub-pairing-codes` — a Partner opens a pairing session for
 * one of their own Stores.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY NAME, AND WHAT IT MAY NOT
 * ===========================================================================
 * It names WHERE the Hub is going, and nothing else: `digitalStoreId` and
 * `storeLocationId`.
 *
 * It may NOT name a device. The code belongs to the Store and any Hub may use it
 * (KLD-2026-08-13-HUB-PAIRING-SESSION-001) — the device binding is created when a
 * specific Hub presents the code, which is the only moment it is honestly known.
 *
 * It may NOT name the Tenant — that is resolved from the Store row, because a
 * caller able to supply it could try to attach a Hub across Tenants. It may not
 * name the TTL either: fifteen minutes is the protocol, enforced by a row
 * constraint, and a caller-chosen lifetime is not a thing this surface offers.
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

  // No `deviceRecordId`. The code belongs to the STORE and any Hub may use it
  // (KLD-2026-08-13-HUB-PAIRING-SESSION-001); the device binding is created when
  // a specific Hub presents the code, which is the only moment it is honestly
  // known. A caller that sends one is refused rather than ignored, so an
  // integration built against the old per-device shape fails loudly.
  const allowed = ["digitalStoreId", "storeLocationId"];
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

  const issued = await openHubPairingSession(deps.issuance, {
    tenantId: scope.tenantId,
    digitalStoreId: ids.digitalStoreId!,
    storeLocationId: ids.storeLocationId!,
    // Names the human who opened it, for the session's audit trail.
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
      sessionId: issued.issued.sessionId,
      expiresAt: issued.issued.expiresAt,
      ttlSeconds: HUB_PAIRING_TTL_SECONDS,
      showOnce: true,
      // Says "any Store Hub" deliberately: the operator does not need to know
      // which unit will use it, and telling them otherwise invents a constraint
      // the system does not have. Opening this session revoked any earlier one
      // for this Store, so a previously issued code has already stopped working.
      detail:
        "Type this code into any Store Hub at this Location. It is valid once, for fifteen minutes, and cannot be retrieved again. Any code issued earlier for this Store no longer works.",
    },
  };
}

/**
 * `POST /management/v1/devices/{id}/approve-enrollment` — HET admits one
 * verified board to the trusted fleet.
 *
 * ===========================================================================
 * VERIFY AND APPROVE, NOT "TRUST DEVICE"
 * ===========================================================================
 * Plan §4.4 supersedes the old "never approve an unknown Pi" prohibition in
 * exactly one narrow way: an Admin may approve an observed untrusted device
 * AFTER explicit HET hardware verification. So this route requires the caller to
 * state WHAT was verified (`verificationEvidenceRef`) as well as why
 * (`reason`) — both refused when blank by the governed door, and refused here
 * too so the caller learns it without a round trip through PostgreSQL.
 *
 * A route that accepted a bare device id would be the one-click "Trust Device"
 * the plan forbids, no matter what the button said.
 *
 * ===========================================================================
 * TWO IDENTITIES, DELIBERATELY — the same shape as pairing-code issuance
 * ===========================================================================
 * Authority is decided as the ACTOR: `authorizeRequest` evaluates the human's
 * permission, scope, environment and account state against canonical database
 * state. Only then is the governed door reached, inside a transaction, as the
 * role migration 0197 granted it to. Frontend visibility authorizes nothing.
 */
async function handleApproveEnrollment(
  deps: ManagementRouterDependencies,
  request: ManagementRequest,
  deviceId: string,
): Promise<KernelResponse> {
  // AUTHORITY FIRST — before the id is validated and before any row is read, so
  // an unauthorized caller cannot tell a real device from a malformed one.
  const outcome = await authorizeRequest(
    deps.db,
    deps.verifier,
    request.authorization,
    PERMISSION.FLEET_ENROLLMENT_APPROVE,
  );
  if (outcome.kind === "deny") return denialResponse(outcome);

  if (deps.approval === undefined) {
    return {
      status: 503,
      body: errorEnvelope(
        "DEPENDENCY_UNAVAILABLE",
        "device approval is not configured on this instance",
      ),
    };
  }

  if (!UUID_PATTERN.test(deviceId)) return notFound("No such device.");

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

  // Unknown fields are REFUSED, not ignored — the same discipline the rest of
  // this surface holds. A caller that believes it may set `lifecycleState` or
  // name its own approver is a caller to fix, and silence would hide that.
  const allowed = ["reason", "verificationEvidenceRef", "secondApproverRef"];
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    return {
      status: 422,
      body: errorEnvelope("VALIDATION_FAILED", `Unknown field: ${unknown[0]}.`),
    };
  }

  const reason = typeof body["reason"] === "string" ? body["reason"].trim() : "";
  const evidence =
    typeof body["verificationEvidenceRef"] === "string"
      ? body["verificationEvidenceRef"].trim()
      : "";
  if (reason === "") {
    return {
      status: 422,
      body: errorEnvelope("VALIDATION_FAILED", "A reason is required to approve a device."),
    };
  }
  if (evidence === "") {
    return {
      status: 422,
      body: errorEnvelope(
        "VALIDATION_FAILED",
        "A verification evidence reference is required — approval records WHAT was verified.",
      ),
    };
  }

  const second = body["secondApproverRef"];
  if (second !== undefined && (typeof second !== "string" || second.trim() === "")) {
    return {
      status: 422,
      body: errorEnvelope("VALIDATION_FAILED", "secondApproverRef must be a non-empty string."),
    };
  }

  const result = await approveDeviceEnrollment(deps.approval, {
    deviceId,
    // Names the HUMAN, resolved from the verified token — never taken from the
    // body. A caller able to name its own approver could sign someone else's
    // name to an immutable audit record.
    actorRef: `admin/${outcome.userId}`,
    reason,
    verificationEvidenceRef: evidence,
    ...(typeof second === "string" ? { secondApproverRef: second.trim() } : {}),
    environment: deps.environment ?? "development",
  });

  if (result.kind === "refused") {
    // 422, not 403: the caller HELD the permission. The device is not in a state
    // that may be approved, which is a fact about the device and not about them.
    return {
      status: result.code === "KLUY-APPROVE-NO-DEVICE" ? 404 : 422,
      body: errorEnvelope(
        result.code === "KLUY-APPROVE-NO-DEVICE" ? "RESOURCE_NOT_FOUND" : "VALIDATION_FAILED",
        result.detail,
        { details: { reason: result.code } },
      ),
    };
  }

  return {
    status: 200,
    body: {
      deviceId: result.deviceId,
      lifecycleState: result.lifecycleState,
      // Says what approval did and did NOT do. An approved board is
      // provisioning-ELIGIBLE; it holds no operational certificate, because
      // nothing in the codebase can issue one yet (BLK-005). A portal that read
      // "enrolled" as "ready to serve terminals" would be wrong.
      detail:
        "This device is admitted to the trusted fleet and is now eligible for provisioning. It has not been issued an operational certificate and cannot yet serve terminals.",
      dataAsOf: nowIso(deps),
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

  // Device-enrollment approval — the second mutation on this surface
  // (KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001). Matched before the
  // read-only guard below, as pairing-code issuance is.
  const approveMatch = /^\/devices\/([^/]+)\/approve-enrollment$/.exec(route);
  if (approveMatch !== null) {
    if (request.method !== "POST") {
      return { status: 405, body: errorEnvelope("VALIDATION_FAILED", "Method not allowed") };
    }
    return await handleApproveEnrollment(deps, request, decodeURIComponent(approveMatch[1] ?? ""));
  }

  if (request.method !== "GET") {
    // Every OTHER route in this slice is a read.
    return { status: 405, body: errorEnvelope("VALIDATION_FAILED", "Method not allowed") };
  }

  // Pairing session status — how a Partner learns the code was used.
  // A GET, so it sits after the mutation guard above and before the read-only
  // routes below.
  const sessionMatch = /^\/hub-pairing-codes\/([^/]+)$/.exec(route);
  if (sessionMatch !== null) {
    if (deps.issuance === undefined) {
      return {
        status: 503,
        body: errorEnvelope("DEPENDENCY_UNAVAILABLE", "Pairing is not configured on this service."),
      };
    }
    // AUTHORITY FIRST, with no Store named: the session decides which Store this
    // is, and the caller's holdings are checked against it below. Authorizing
    // against a Store read out of the session would let the session choose its
    // own auditor.
    const outcome = await authorizePartnerRequest(
      deps.db,
      deps.verifier,
      request.authorization,
      "fleet.hub_pairing_code.issue",
      null,
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

    const sessionId = decodeURIComponent(sessionMatch[1] ?? "");
    if (!UUID_PATTERN.test(sessionId)) return notFound("No such pairing session.");

    const session = await readPairingSession(deps.issuance, sessionId);
    // A session belonging to another Partner's Store is reported as ABSENT, not
    // as forbidden: "no such session" and "not yours" must look identical, or the
    // route becomes an oracle for which session ids exist.
    if (session === null || !outcome.digitalStoreIds.includes(session.digitalStoreId)) {
      return notFound("No such pairing session.");
    }

    return {
      status: 200,
      body: {
        sessionId: session.sessionId,
        state: session.state,
        paired: session.state === "consumed",
        pairedAt: session.pairedAt,
        pairedDeviceId: session.pairedDeviceId,
        pairedDeviceReference: session.pairedDeviceReference,
        failedAttemptCount: session.failedAttemptCount,
        locked: session.lockedAt !== null,
        expiresAt: session.expiresAt,
        dataAsOf: nowIso(deps),
      },
    };
  }

  // The Stores a PARTNER may open a session for. Separate from `/me`, which
  // answers the Admin question and refuses anyone without an HET admin profile —
  // a Partner is exactly that caller.
  if (route === "/partner/stores") {
    if (deps.issuance === undefined) {
      // Fail CLOSED, and say so: an empty list would read as "you hold no
      // Stores", which is a different and wrong answer.
      return {
        status: 503,
        body: errorEnvelope("DEPENDENCY_UNAVAILABLE", "Pairing is not configured on this service."),
      };
    }
    const outcome = await authorizePartnerRequest(
      deps.db,
      deps.verifier,
      request.authorization,
      "fleet.hub_pairing_code.issue",
      // No Store named: this is the call that finds out which Stores exist for
      // this actor. The permission is still required.
      null,
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

    const stores = await listPartnerStores(deps.issuance, outcome.userId, outcome.digitalStoreIds);
    return { status: 200, body: { stores, count: stores.length, dataAsOf: nowIso(deps) } };
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

  // Pending registrations. A SEPARATE route from `/devices` because it answers a
  // different question and carries verification evidence the fleet list does not:
  // this is the queue a person works through with hardware in front of them.
  if (route === "/devices-pending") {
    const outcome = await authorizeRequest(
      deps.db,
      deps.verifier,
      request.authorization,
      // Reading the queue needs the APPROVE permission, not merely fleet read.
      // The evidence here — board serials, key fingerprints — is exactly what an
      // attacker would want to forge a convincing registration, so it is not
      // shown to every operator who may view the fleet.
      PERMISSION.FLEET_ENROLLMENT_APPROVE,
    );
    if (outcome.kind === "deny") return denialResponse(outcome);

    const pending = await listPendingRegistrations(deps.db, { limit: DEVICE_PAGE_LIMIT });
    return {
      status: 200,
      body: {
        pending,
        count: pending.length,
        limit: DEVICE_PAGE_LIMIT,
        truncated: pending.length >= DEVICE_PAGE_LIMIT,
        // Told to the client so the UI can require a second approver without
        // hardcoding an environment rule that lives in the database.
        fourEyesRequired: ["pilot", "production"].includes(deps.environment ?? "development"),
        dataAsOf: nowIso(deps),
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
    // POST is listed because this surface HAS mutations: Hub pairing-code
    // issuance and device-enrollment approval. It previously advertised only
    // "GET, OPTIONS", so a browser preflight for either POST was answered with
    // a method list that excluded it and the browser refused the request — the
    // route worked for curl and could never work from the Portal it exists for.
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}
