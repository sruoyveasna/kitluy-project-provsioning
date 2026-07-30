/**
 * Service entrypoint: environment validation, governed revocation composition,
 * HTTP kernel, graceful shutdown.
 *
 * Kubernetes-ready per infrastructure spec v1.0.0 §9.1 (health endpoints,
 * graceful termination, environment-variable configuration, stateless).
 *
 * THE REVOCATION RUNTIME IS RESOLVED BEFORE THE SOCKET OPENS. That ordering is
 * the point: `resolveDeviceRevocationService` fails closed on a missing DSN or on
 * any attempt to select an alternate implementation, and a service that came up
 * healthy and only revealed a misconfigured revocation path during an actual
 * incident is the failure worth paying a restart to avoid.
 *
 * Readiness reports `unavailable` while the authoritative database is
 * unreachable, so a Hub or operator console is never routed to an instance that
 * cannot answer a revocation question.
 */
import { createServer } from "node:http";
import { createLogger } from "@kitluy/observability";
import { requireEnvironment, requirePort } from "@kitluy/shared-config";
import { resolveDeviceRevocationService } from "./composition.js";
import { handleKernelRequest } from "./http.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./index.js";

const log = createLogger(SERVICE_NAME);
const environment = requireEnvironment(process.env);
const port = requirePort(process.env, "PORT");

// Startup-time refusal, before anything is listening.
const revocation = resolveDeviceRevocationService(process.env);

let ready = true;

const server = createServer((req, res) => {
  const { status, body } = handleKernelRequest(req.method ?? "GET", req.url ?? "/", ready);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});

server.listen(port, () => {
  log.info("listening", {
    port,
    environment,
    version: SERVICE_VERSION,
    // Recorded so a deployment can be seen to have the real wiring. No DSN, no
    // credential and no role name is logged.
    revocationWiring: "governed-database",
  });
});

function shutdown(signal: string): void {
  ready = false;
  log.info("shutting down", { signal });
  server.close(() => {
    void revocation
      .shutdown()
      .catch((error: unknown) => {
        log.warn("revocation pool did not close cleanly", {
          error: error instanceof Error ? error.name : "unknown",
        });
      })
      .finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
