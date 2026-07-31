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

export interface KernelResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface KernelDeps {
  readonly ready: boolean;
  readonly revocationRouter?: RevocationRouter;
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
  request: RouteRequest,
  deps: KernelDeps,
): Promise<KernelResponse> {
  const path = request.path.split("?")[0] ?? "";

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
