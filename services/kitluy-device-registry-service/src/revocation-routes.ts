/**
 * The RUNTIME ROUTES. This is the caller Phase E kept saying did not exist.
 *
 * Authority: WS-11-T003 Step 4 final completion §2; KLD-2026-07-29-DEVICE-
 * CREDENTIAL-REVOCATION-001; migration groups 0145-0155.
 *
 * ===========================================================================
 * WHAT WAS MISSING, TWICE
 * ===========================================================================
 * Phase E: the gateway was library-available-but-uncalled. The previous session
 * built the composition root — and two independent reviewers found the same thing
 * one layer up: `main.ts` resolved a service and invoked no method, `http.ts`
 * served only health and version, so a deployed process still called no door.
 *
 * These are the four doors, reachable over HTTP:
 *
 *   POST /v1/device-credentials/revocations                       normal, governed
 *   POST /v1/device-credentials/emergency-revocations             emergency, human
 *   POST /v1/device-credentials/emergency-revocations/:id/post-approval  human
 *   GET  /v1/device-credentials/emergency-revocations/:id         status
 *
 * ===========================================================================
 * WHAT A REQUEST MAY AND MAY NOT SAY
 * ===========================================================================
 * A request body carries WHAT to do. It never carries WHO is asking or WHETHER
 * they may. The subject comes from {@link RequestAuthenticator} and goes onto the
 * database session; permission and re-authentication are evaluated by the
 * database against that subject. A body field naming an actor is rejected rather
 * than ignored — silently dropping it would let a caller believe it worked.
 *
 * The normal door is the one exception worth naming: it takes `approvalRequestId`
 * and `approvedBy`, which look like caller-supplied authority but are not. The
 * database re-derives the affected set from stored rows and requires the
 * approval's `payload_hash` to equal the digest IT computed (RC-019, group 0146),
 * so a forged pair fails the binding rather than passing it.
 */
import { randomUUID } from "node:crypto";

import type {
  AuthenticatedPrincipal,
  RequestAuthenticator,
  RequestHeaders,
} from "./authentication.js";
import { EMERGENCY_REASON_CODES, type DeviceRevocationService } from "./revocation-service.js";
import { RedactedRevocationError } from "./revocation-failures.js";
import { InvalidHumanSessionError } from "./database.js";
import type { EmergencyLapseScheduler } from "./lapse-scheduling.js";

export interface RouteRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: RequestHeaders;
  /** Already parsed. Routing does not own transport concerns. */
  readonly body: unknown;
}

export interface RouteResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export interface RevocationRouterDeps {
  readonly service: DeviceRevocationService;
  readonly authenticator: RequestAuthenticator;
  /**
   * Schedules the post-approval lapse obligation. Optional ONLY so a deployment
   * without a job runtime fails loudly at the one place it matters rather than at
   * import time; when absent, a successful emergency reports
   * `lapseScheduled: false` and the response says so.
   */
  readonly lapseScheduler?: EmergencyLapseScheduler;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Body fields that would be caller-supplied authority. Presence is a refusal. */
const FORBIDDEN_BODY_FIELDS: readonly string[] = [
  "actorUserId",
  "actor_user_id",
  "userId",
  "user_id",
  "sub",
  "auth",
  "role",
  "permissionKey",
  "permission_key",
];

interface Invalid {
  readonly ok: false;
  readonly response: RouteResponse;
}

function fail(status: number, code: string, detail: string, extra: Record<string, unknown> = {}) {
  return { status, body: { code, detail, ...extra } };
}

function invalid(detail: string, fields: readonly string[] = []): Invalid {
  return {
    ok: false,
    response: fail(400, "VALIDATION_FAILED", detail, fields.length > 0 ? { fields } : {}),
  };
}

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function rejectAuthorityFields(body: Record<string, unknown>): Invalid | null {
  const offending = FORBIDDEN_BODY_FIELDS.filter((f) => f in body);
  if (offending.length === 0) return null;
  return {
    ok: false,
    response: fail(
      400,
      "CALLER_SUPPLIED_AUTHORITY_REFUSED",
      "identity and authority are established by the authenticated session, not by the request body",
      { fields: offending },
    ),
  };
}

function requireString(
  body: Record<string, unknown>,
  key: string,
  opts: { readonly uuid?: boolean; readonly maxLength?: number } = {},
): string | null {
  const value = body[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (opts.uuid === true && !UUID.test(trimmed)) return null;
  if (opts.maxLength !== undefined && trimmed.length > opts.maxLength) return null;
  return trimmed;
}

/**
 * Correlates a request with the audit rows the database writes.
 *
 * Generated here when the caller supplies none. A caller MAY supply one so a
 * retry correlates to the same operator action, but it is only ever a label: no
 * authorization decision reads it, so a forged value buys nothing.
 */
function correlationId(headers: RequestHeaders): string {
  const raw = headers["x-kitluy-correlation-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && UUID.test(value.trim()) ? value.trim() : randomUUID();
}

/**
 * Maps a redacted failure onto a status code.
 *
 * `403` for authorization, `422` for a permanently invalid request, `409` for an
 * unconfirmed outcome referred to reconciliation, `503` for transient contention.
 * A `409` is NOT a retry invitation — the body says reconciliation is under way,
 * because a client that retried an unconfirmed revocation could produce a second
 * one.
 */
function statusForFailure(error: RedactedRevocationError): RouteResponse {
  const { failureClass, code, safeSummary, operation } = error.failure;
  const base = { code, detail: safeSummary, operation, retryable: false };
  switch (failureClass) {
    case "PERMANENT_AUTHORIZATION":
      return { status: 403, body: { ...base, permanent: true } };
    case "PERMANENT_INVALID":
      return { status: 422, body: { ...base, permanent: true } };
    case "RETRYABLE":
      return { status: 503, body: { ...base, retryable: true } };
    case "AMBIGUOUS_NEEDS_RECONCILIATION":
    default:
      return {
        status: 409,
        body: { ...base, reconciliation: "PENDING", permanent: false },
      };
  }
}

/** Any error leaving a handler. Nothing raw reaches the client. */
function redactUnexpected(error: unknown, correlation: string): RouteResponse {
  if (error instanceof RedactedRevocationError) {
    const mapped = statusForFailure(error);
    return { status: mapped.status, body: { ...mapped.body, correlationId: correlation } };
  }
  if (error instanceof InvalidHumanSessionError) {
    // The session could not be established as the verified human. Treated as an
    // authorization failure, permanently: acting anyway is the one thing that
    // must not happen.
    return {
      status: 403,
      body: {
        code: "SESSION_IDENTITY_REFUSED",
        detail: "the authenticated subject could not be established on the database session",
        permanent: true,
        retryable: false,
        correlationId: correlation,
      },
    };
  }
  return {
    status: 500,
    body: {
      code: "INTERNAL_ERROR",
      detail: "the operation failed and the details are not disclosed",
      retryable: false,
      correlationId: correlation,
    },
  };
}

export interface RevocationRouter {
  handle(request: RouteRequest): Promise<RouteResponse>;
}

const EMERGENCY_PREFIX = "/v1/device-credentials/emergency-revocations";

export function createRevocationRouter(deps: RevocationRouterDeps): RevocationRouter {
  return {
    async handle(request: RouteRequest): Promise<RouteResponse> {
      const correlation = correlationId(request.headers);
      const withCorrelation = (response: RouteResponse): RouteResponse => ({
        status: response.status,
        body: { ...response.body, correlationId: correlation },
      });

      // EVERY governed route authenticates FIRST. There is no unauthenticated
      // read of emergency state either: an authorization id plus its status is
      // itself incident information.
      const matched = matchRoute(request);
      if (matched === null) {
        return withCorrelation(fail(404, "RESOURCE_NOT_FOUND", "no such route"));
      }
      if (matched === "METHOD_NOT_ALLOWED") {
        return withCorrelation(fail(405, "VALIDATION_FAILED", "method not allowed"));
      }

      const auth = await deps.authenticator.authenticate(request.headers);
      if (!auth.authenticated) {
        const status = auth.code === "AUTHENTICATION_NOT_CONFIGURED" ? 503 : 401;
        return withCorrelation(fail(status, auth.code, auth.detail));
      }

      try {
        switch (matched.route) {
          case "normal":
            return withCorrelation(await handleNormal(deps, request, auth.principal, correlation));
          case "emergency":
            return withCorrelation(
              await handleEmergency(deps, request, auth.principal, correlation),
            );
          case "post-approval":
            return withCorrelation(
              await handlePostApproval(deps, request, auth.principal, matched.id ?? ""),
            );
          case "status":
            return withCorrelation(await handleStatus(deps, matched.id ?? ""));
        }
      } catch (error) {
        return redactUnexpected(error, correlation);
      }
    },
  };
}

type Matched =
  | { readonly route: "normal" | "emergency"; readonly id?: undefined }
  | { readonly route: "post-approval" | "status"; readonly id: string };

function matchRoute(request: RouteRequest): Matched | "METHOD_NOT_ALLOWED" | null {
  const path = request.path.split("?")[0]?.replace(/\/+$/, "") ?? "";
  if (path === "/v1/device-credentials/revocations") {
    return request.method === "POST" ? { route: "normal" } : "METHOD_NOT_ALLOWED";
  }
  if (path === EMERGENCY_PREFIX) {
    return request.method === "POST" ? { route: "emergency" } : "METHOD_NOT_ALLOWED";
  }
  if (path.startsWith(`${EMERGENCY_PREFIX}/`)) {
    const rest = path.slice(EMERGENCY_PREFIX.length + 1);
    if (rest.endsWith("/post-approval")) {
      const id = rest.slice(0, -"/post-approval".length);
      if (!UUID.test(id)) return null;
      return request.method === "POST" ? { route: "post-approval", id } : "METHOD_NOT_ALLOWED";
    }
    if (!UUID.test(rest)) return null;
    return request.method === "GET" ? { route: "status", id: rest } : "METHOD_NOT_ALLOWED";
  }
  return null;
}

async function handleNormal(
  deps: RevocationRouterDeps,
  request: RouteRequest,
  principal: AuthenticatedPrincipal,
  correlation: string,
): Promise<RouteResponse> {
  const body = asObject(request.body);
  if (body === null) return invalid("a JSON object body is required").response;
  const rejected = rejectAuthorityFields(body);
  if (rejected !== null) return rejected.response;

  const deviceRecordId = requireString(body, "deviceRecordId", { uuid: true });
  const environment = requireString(body, "environment", { maxLength: 32 });
  const purpose = requireString(body, "purpose", { maxLength: 64 });
  const reasonCode = requireString(body, "reasonCode", { maxLength: 64 });
  const reason = requireString(body, "reason", { maxLength: 2000 });
  const recoveryDisposition = requireString(body, "recoveryDisposition", { maxLength: 64 });
  const approvalRequestId = requireString(body, "approvalRequestId", { uuid: true });
  const approvedBy = requireString(body, "approvedBy", { maxLength: 256 });
  const generationRaw = body["credentialGeneration"];
  const credentialGeneration =
    typeof generationRaw === "number" && Number.isInteger(generationRaw) && generationRaw > 0
      ? generationRaw
      : null;

  const missing = Object.entries({
    deviceRecordId,
    environment,
    purpose,
    reasonCode,
    reason,
    recoveryDisposition,
    approvalRequestId,
    approvedBy,
    credentialGeneration,
  })
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (missing.length > 0)
    return invalid("required fields are absent or malformed", missing).response;

  // IDEMPOTENCY. `revocationRequestId` is the database's own idempotency key for
  // this door; a caller may supply one so a retry is the same request, and one is
  // minted when absent so a request without it is still safe.
  const revocationRequestId =
    requireString(body, "revocationRequestId", { maxLength: 128 }) ?? `route-${correlation}`;

  const outcome = await deps.service.revokeNormal({
    revocationRequestId,
    deviceRecordId: deviceRecordId as string,
    environment: environment as string,
    purpose: purpose as string,
    credentialGeneration: credentialGeneration as number,
    reasonCode: reasonCode as never,
    reason: reason as string,
    recoveryDisposition: recoveryDisposition as never,
    // The AUTHENTICATED subject, not a body field.
    requestedBy: principal.userId,
    source: "DEVICE_REGISTRY_HTTP",
    approvalRequestId,
    approvedBy,
    incidentReference: requireString(body, "incidentReference", { maxLength: 128 }),
    incidentScopeId: requireString(body, "incidentScopeId", { uuid: true }),
  });

  const accepted = outcome.outcome === "REVOKED" || outcome.outcome === "ALREADY_REVOKED";
  return {
    status: accepted ? 200 : outcome.outcome === "MANUAL_REVIEW_REQUIRED" ? 409 : 422,
    body: {
      outcome: outcome.outcome,
      revocationId: outcome.revocationId ?? null,
      credentialId: outcome.credentialId ?? null,
      refusalCode: outcome.refusalCode ?? null,
      // The governed refusal DETAIL is the database's own governed text, not a
      // driver message, so it is safe and useful to return.
      detail: outcome.detail ?? null,
      requestedBy: principal.userId,
      authenticationMethod: principal.method,
    },
  };
}

async function handleEmergency(
  deps: RevocationRouterDeps,
  request: RouteRequest,
  principal: AuthenticatedPrincipal,
  correlation: string,
): Promise<RouteResponse> {
  const body = asObject(request.body);
  if (body === null) return invalid("a JSON object body is required").response;
  const rejected = rejectAuthorityFields(body);
  if (rejected !== null) return rejected.response;

  const credentialId = requireString(body, "credentialId", { uuid: true });
  const reasonCode = requireString(body, "reasonCode", { maxLength: 64 });
  const explanation = requireString(body, "explanation", { maxLength: 2000 });
  const incidentReference = requireString(body, "incidentReference", { maxLength: 128 });
  const reauthEvidenceId = requireString(body, "reauthEvidenceId", { uuid: true });

  const missing = Object.entries({
    credentialId,
    reasonCode,
    explanation,
    incidentReference,
    reauthEvidenceId,
  })
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (missing.length > 0)
    return invalid("required fields are absent or malformed", missing).response;

  if (!(EMERGENCY_REASON_CODES as readonly string[]).includes(reasonCode as string)) {
    return invalid(
      `reasonCode must be one of the approved emergency reasons: ${EMERGENCY_REASON_CODES.join(", ")}`,
      ["reasonCode"],
    ).response;
  }

  const idempotencyKey =
    requireString(body, "idempotencyKey", { maxLength: 128 }) ?? `route-${correlation}`;

  // THE HUMAN'S OWN SESSION. `principal` came from the authenticator, never the body.
  const result = await deps.service.revokeEmergency(
    { userId: principal.userId },
    {
      credentialId: credentialId as string,
      reasonCode: reasonCode as never,
      explanation: explanation as string,
      incidentReference: incidentReference as string,
      reauthEvidenceId: reauthEvidenceId as string,
      idempotencyKey,
      incidentScopeId: requireString(body, "incidentScopeId", { uuid: true }),
    },
  );

  if (result.outcome === "EMERGENCY_REFUSED") {
    // A governed refusal is the database declining, not a transport fault. 403
    // when it is about authority, 422 when it is about the request.
    const authorityRefusal = /UNAUTHORIZED|REAUTH|NO-AUTHENTICATED-ACTOR|PERMISSION/i.test(
      result.refusalCode ?? "",
    );
    return {
      status: authorityRefusal ? 403 : 422,
      body: {
        outcome: result.outcome,
        refusalCode: result.refusalCode,
        permanent: true,
        retryable: false,
      },
    };
  }

  // SCHEDULE THE LAPSE OBLIGATION. Done after the emergency committed, because a
  // job for an authorization that does not exist is a job that can only fail.
  let lapseScheduled = false;
  let lapseJobId: string | null = null;
  if (deps.lapseScheduler !== undefined && result.authorizationId !== null) {
    const scheduled = await deps.lapseScheduler.scheduleLapse({
      authorizationId: result.authorizationId,
      environment: requireString(body, "environment", { maxLength: 32 }) ?? "development",
      postApprovalDueAt: result.postApprovalDueAt,
      actorRef: principal.userId,
    });
    lapseScheduled = scheduled.scheduled;
    lapseJobId = scheduled.jobId;
  }

  return {
    status: result.outcome === "ALREADY_AUTHORIZED" ? 200 : 201,
    body: {
      outcome: result.outcome,
      authorizationId: result.authorizationId,
      revokedCredentialCount: result.revokedCredentialCount,
      postApprovalDueAt: result.postApprovalDueAt,
      lapseScheduled,
      lapseJobId,
      declaredBy: principal.userId,
    },
  };
}

async function handlePostApproval(
  deps: RevocationRouterDeps,
  request: RouteRequest,
  principal: AuthenticatedPrincipal,
  authorizationId: string,
): Promise<RouteResponse> {
  const body = asObject(request.body);
  if (body === null) return invalid("a JSON object body is required").response;
  const rejected = rejectAuthorityFields(body);
  if (rejected !== null) return rejected.response;

  const decision = requireString(body, "decision", { maxLength: 16 });
  const reauthEvidenceId = requireString(body, "reauthEvidenceId", { uuid: true });
  if (decision !== "APPROVE" && decision !== "REFUSE") {
    return invalid("decision must be APPROVE or REFUSE", ["decision"]).response;
  }
  if (reauthEvidenceId === null) {
    return invalid("reauthEvidenceId is absent or malformed", ["reauthEvidenceId"]).response;
  }

  const result = await deps.service.postApproveEmergency(
    { userId: principal.userId },
    {
      authorizationId,
      decision,
      reauthEvidenceId,
      note: requireString(body, "note", { maxLength: 2000 }),
    },
  );

  const refused = result.outcome === "POST_APPROVAL_REFUSED";
  const authorityRefusal = /UNAUTHORIZED|REAUTH|SELF-POST-APPROVAL|NO-AUTHENTICATED-ACTOR/i.test(
    result.refusalCode ?? "",
  );
  return {
    status: refused ? (authorityRefusal ? 403 : 422) : 200,
    body: {
      outcome: result.outcome,
      authorizationId: result.authorizationId ?? authorizationId,
      verdictId: result.verdictId,
      postApprovalDecision: result.postApprovalDecision,
      refusalCode: result.refusalCode,
      decidedBy: principal.userId,
      ...(refused ? { permanent: true, retryable: false } : {}),
    },
  };
}

async function handleStatus(
  deps: RevocationRouterDeps,
  authorizationId: string,
): Promise<RouteResponse> {
  const status = await deps.service.readEmergencyStatus(authorizationId);
  if (status === null) {
    return fail(404, "RESOURCE_NOT_FOUND", "no such governed emergency authorization");
  }
  return {
    status: 200,
    body: {
      authorizationId: status.authorizationId,
      environment: status.environment,
      reasonCode: status.reasonCode,
      incidentReference: status.incidentReference,
      scopeDigest: status.scopeDigest,
      revokedCredentialCount: status.revokedCredentialCount,
      postApprovalDueAt: status.postApprovalDueAt.toISOString(),
      postApprovalDecision: status.postApprovalDecision,
      decidedAt: status.decidedAt?.toISOString() ?? null,
      // RECONCILIATION SIGNAL. A PENDING obligation past its deadline is exactly
      // what the lapse worker exists to settle; surfacing it here means an
      // operator console can see the same thing without a second query path.
      reconciliationRequired:
        status.postApprovalDecision === "PENDING" &&
        status.postApprovalDueAt.getTime() < Date.now(),
    },
  };
}
