/**
 * Pure request router for the service kernel. Kept free of node:http types so
 * the routing contract is unit-testable without sockets.
 *
 * Health, readiness and version are answered here directly. Everything under
 * `/v1/` is delegated to the governed revocation router
 * (`revocation-routes.ts`), which authenticates before it does anything.
 *
 * When no revocation router is supplied the `/v1/` surface fails CLOSED with 503
 * rather than 404: "this service does not do that" and "this instance is not
 * configured to do that" are different facts, and a 404 would let a
 * misconfigured deployment look like a healthy one that simply had no such route.
 */
import { errorEnvelope } from "@kitluy/api-errors";
import { buildHealthReport, SERVICE_NAME, SERVICE_VERSION } from "./index.js";
import type { RevocationRouter, RouteRequest, RouteResponse } from "./revocation-routes.js";
import {
  TERMINAL_PROVISIONING_PREFIX,
  type TerminalProvisioningRouter,
} from "./provisioning-routes.js";
import { DEVICE_ENROLLMENT_PREFIX, type EnrollmentRouter } from "./enrollment-routes.js";
import { HUB_PAIRING_PREFIX, type HubPairingRouter } from "./hub-pairing-routes.js";

export interface KernelResponse {
  readonly status: number;
  readonly body: unknown;
  /** Transport headers a route requires (e.g. Retry-After on 429). */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface KernelDeps {
  readonly ready: boolean;
  readonly revocationRouter?: RevocationRouter;
  readonly provisioningRouter?: TerminalProvisioningRouter;
  readonly enrollmentRouter?: EnrollmentRouter;
  readonly hubPairingRouter?: HubPairingRouter;
}

/**
 * The terminal-provisioning bootstrap routes own their raw request text (16
 * KiB gate, content type, JSON shape all count toward the rate limit), so the
 * transport hands the undecoded body and the observed peer address through
 * these optional fields rather than a pre-parsed body.
 */
export interface KernelRequest extends RouteRequest {
  readonly rawBody?: string;
  readonly sourceIp?: string;
}

const GOVERNED_PREFIX = "/v1/";

/** Synchronous kernel routes: health, readiness, version. */
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

/**
 * The full request surface, including the governed `/v1/` routes.
 *
 * Async because the governed routes reach the database. The synchronous kernel
 * above is preserved and still used for health, so a liveness probe never waits
 * on a connection.
 */
export async function handleRequest(
  request: KernelRequest,
  deps: KernelDeps,
): Promise<KernelResponse> {
  const path = request.path.split("?")[0] ?? "";

  // The bootstrap surface is matched BEFORE the generic `/v1/` delegation and
  // fails CLOSED with 503 when unconfigured, for the same reason the
  // revocation surface does: an instance without the wiring must not look
  // like a healthy one that simply had no such route.
  if (path.startsWith(TERMINAL_PROVISIONING_PREFIX)) {
    if (deps.provisioningRouter === undefined) {
      return {
        status: 503,
        body: errorEnvelope(
          "DEPENDENCY_UNAVAILABLE",
          "terminal-provisioning routes are not configured on this instance",
        ),
      };
    }
    const response = await deps.provisioningRouter.handle({
      method: request.method,
      path: request.path,
      headers: request.headers,
      sourceIp: request.sourceIp ?? "",
      rawBody: request.rawBody ?? "",
    });
    return { status: response.status, body: response.body, headers: response.headers };
  }

  // Factory enrollment (DEC-2, KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001).
  // Matched before the generic delegation and fails CLOSED for the same reason
  // as the bootstrap surface above — with the added weight that this is the
  // FIRST network step a factory-fresh device takes, so an unconfigured
  // instance answering 404 would read to the device as "no such capability"
  // rather than "this deployment is not wired", and the device would give up
  // on a fleet it is entitled to join.
  if (path.startsWith(DEVICE_ENROLLMENT_PREFIX)) {
    if (deps.enrollmentRouter === undefined) {
      return {
        status: 503,
        body: errorEnvelope(
          "DEPENDENCY_UNAVAILABLE",
          "device-enrollment routes are not configured on this instance",
        ),
      };
    }
    const response = await deps.enrollmentRouter.handle({
      method: request.method,
      path: request.path,
      headers: request.headers,
      sourceIp: request.sourceIp ?? "",
      rawBody: request.rawBody ?? "",
    });
    return { status: response.status, body: response.body, headers: response.headers };
  }

  // Store Hub pairing (KLD-2026-08-13-HUB-CLAIM-PRESENTATION-001). Same
  // placement and the same fail-closed 503 as the two surfaces above, for the
  // same reason: an operator is standing at a Hub console typing a code, and a
  // 404 would tell them the code is wrong when the truth is that this deployment
  // was never wired for pairing.
  if (path.startsWith(HUB_PAIRING_PREFIX)) {
    if (deps.hubPairingRouter === undefined) {
      return {
        status: 503,
        body: errorEnvelope(
          "DEPENDENCY_UNAVAILABLE",
          "hub-pairing routes are not configured on this instance",
        ),
      };
    }
    const response = await deps.hubPairingRouter.handle({
      method: request.method,
      path: request.path,
      headers: request.headers,
      sourceIp: request.sourceIp ?? "",
      rawBody: request.rawBody ?? "",
    });
    return { status: response.status, body: response.body, headers: response.headers };
  }

  if (path.startsWith(GOVERNED_PREFIX)) {
    if (deps.revocationRouter === undefined) {
      return {
        status: 503,
        // `DEPENDENCY_UNAVAILABLE` is canonical; `SERVICE_UNAVAILABLE` is an alias
        body:
          // the envelope type does not accept.
          errorEnvelope(
            "DEPENDENCY_UNAVAILABLE",
            "governed revocation routes are not configured on this instance",
          ),
      };
    }
    const response: RouteResponse = await deps.revocationRouter.handle(request);
    return { status: response.status, body: response.body };
  }

  return handleKernelRequest(request.method, path, deps.ready);
}
