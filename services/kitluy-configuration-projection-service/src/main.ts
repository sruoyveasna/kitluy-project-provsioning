/**
 * Service entrypoint: environment validation, HTTP kernel, graceful shutdown.
 * Kubernetes-ready per infrastructure spec v1.0.0 §9.1 (health endpoints,
 * graceful termination, environment-variable configuration, stateless).
 */
import { createServer } from "node:http";
import { createLogger } from "@kitluy/observability";
import { requireEnvironment, requirePort } from "@kitluy/shared-config";
import { handleKernelRequest } from "./http.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./index.js";

const log = createLogger(SERVICE_NAME);
const environment = requireEnvironment(process.env);
const port = requirePort(process.env, "PORT");

let ready = true;

const server = createServer((req, res) => {
  const { status, body } = handleKernelRequest(req.method ?? "GET", req.url ?? "/", ready);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});

server.listen(port, () => {
  log.info("listening", { port, environment, version: SERVICE_VERSION });
});

function shutdown(signal: string): void {
  ready = false;
  log.info("shutting down", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
