/**
 * Service entrypoint: environment validation, HTTP kernel, governed management
 * routes, graceful shutdown.
 *
 * Kubernetes-ready per infrastructure spec v1.0.0 §9.1 (health endpoints,
 * graceful termination, environment-variable configuration, stateless).
 *
 * THE RUNTIME IS RESOLVED BEFORE THE SOCKET OPENS. `createManagementRuntime`
 * refuses a missing DSN, a missing auth URL, or a privileged credential where a
 * publishable key belongs. A service that started healthy and only revealed a
 * misconfigured credential when an Admin tried to sign in is the failure this
 * ordering pays a restart to avoid.
 *
 * Readiness does NOT probe the database: `ready` is true from startup until
 * shutdown. Adding a real dependency probe is worthwhile and is recorded as an
 * open condition rather than described as done.
 */
import { createServer } from "node:http";
import { createLogger } from "@kitluy/observability";
import { requireEnvironment, requirePort } from "@kitluy/shared-config";
import { createManagementRuntime } from "./composition.js";
import {
  handleKernelRequest,
  handleManagementRequest,
  isManagementPath,
  resolveCorsHeaders,
} from "./http.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./index.js";

const log = createLogger(SERVICE_NAME);
const environment = requireEnvironment(process.env);
const port = requirePort(process.env, "PORT");

// Startup-time refusal, before anything is listening.
const runtime = createManagementRuntime(process.env);

let ready = true;

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";
  const cors = resolveCorsHeaders(req.headers.origin, runtime.allowedOrigins);

  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json", ...cors });
    res.end(JSON.stringify(body));
  };

  // Preflight. Answered for allowed origins only; an unknown origin receives no
  // cross-origin headers and the browser refuses the real request.
  if (method === "OPTIONS") {
    res.writeHead(Object.keys(cors).length > 0 ? 204 : 403, cors);
    res.end();
    return;
  }

  if (!isManagementPath(url)) {
    const { status, body } = handleKernelRequest(method, url, ready);
    send(status, body);
    return;
  }

  handleManagementRequest(runtime.dependencies, {
    method,
    url,
    authorization: req.headers.authorization,
  })
    .then(({ status, body }) => send(status, body))
    .catch((error: unknown) => {
      // The message is never returned to the caller: a database error text can
      // carry schema and identity detail that a browser has no business seeing.
      log.error("management route failed", {
        route: url.split("?")[0] ?? url,
        kind: error instanceof Error ? error.name : "unknown",
      });
      send(500, {
        error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
      });
    });
});

server.listen(port, () => {
  log.info("listening", { port, environment, version: SERVICE_VERSION, ...runtime.describe() });
});

function shutdown(signal: string): void {
  ready = false;
  log.info("shutting down", { signal });
  server.close(() => {
    void runtime.pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
