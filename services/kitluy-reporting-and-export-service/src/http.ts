/**
 * Pure request router for the service kernel. Kept free of node:http types so
 * the routing contract is unit-testable without sockets.
 */
import { errorEnvelope } from "@kitluy/api-errors";
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
          "NOT_FOUND",
          "No such route. Business contracts are not implemented in this scaffold.",
        ),
      };
  }
}
