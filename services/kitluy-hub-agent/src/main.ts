/**
 * Simulated Store Hub development entrypoint.
 *
 * Runs the LAN API kernel over HTTP on localhost with the in-memory local
 * database — a development simulation ONLY. Production Store Hub runs on
 * HET-enrolled Raspberry Pi 5 hardware (Linux ARM64) with local PostgreSQL,
 * device certificates and mTLS, none of which are simulated here.
 */
import { createServer } from "node:http";
import { createLogger } from "@kitluy/observability";
import { optionalString, requirePort } from "@kitluy/shared-config";
import { SERVICE_NAME, SERVICE_VERSION } from "./index.js";
import { handleLanRequest } from "./lan-api.js";
import { InMemoryLocalDatabase } from "./local-db.js";

const log = createLogger(SERVICE_NAME);
const port = requirePort(process.env, "HUB_LAN_PORT");
const host = optionalString(process.env, "HUB_LAN_BIND_HOST", "127.0.0.1");

const identity = {
  hubId: "hub-simulated-dev",
  storeLocationId: "loc-simulated-dev",
  certificateFingerprint: "SIMULATED-DEV-MODE",
};
const db = new InMemoryLocalDatabase(identity.storeLocationId, identity.hubId);

const server = createServer((req, res) => {
  const { status, body } = handleLanRequest(req.method ?? "GET", req.url ?? "/", identity, db);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});

server.listen(port, host, () => {
  log.info("simulated Store Hub listening", { host, port, version: SERVICE_VERSION });
});

function shutdown(signal: string): void {
  log.info("shutting down", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
