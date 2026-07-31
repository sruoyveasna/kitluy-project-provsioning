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
 * Readiness does NOT probe the database. An earlier version of this comment
 * claimed it did; `ready` is `true` from startup until shutdown. Adding a real
 * probe is worthwhile and is recorded as an open condition rather than described
 * as done.
 */
import { createServer, type IncomingMessage } from "node:http";
import { createLogger } from "@kitluy/observability";
import { requireEnvironment, requirePort } from "@kitluy/shared-config";
import { resolveDeviceRevocationService } from "./composition.js";
import { handleRequest } from "./http.js";
import { createLapseWorkerLoop } from "./lapse-worker-runtime.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./index.js";

const log = createLogger(SERVICE_NAME);
const environment = requireEnvironment(process.env);
const port = requirePort(process.env, "PORT");

// Startup-time refusal, before anything is listening.
const revocation = resolveDeviceRevocationService(process.env);

/**
 * THE DEPLOYED LAPSE WORKER.
 *
 * Every emergency revocation enqueues an obligation to have a SECOND human
 * review it. Lapsing is what happens when nobody does: the deadline passes, the
 * worker closes the obligation and it escalates to manual security review.
 *
 * Until this line existed the route enqueued that job and no deployed process
 * ever claimed it, so an unreviewed emergency stayed PENDING for ever and the
 * four-eyes rule quietly became "reviewed, or forgotten". It runs IN THIS
 * PROCESS rather than as a separate deployment because the obligation belongs to
 * the same service that creates it; splitting them would let one be deployed
 * without the other, which is exactly the failure being fixed.
 */
const lapseWorker = createLapseWorkerLoop({
  gateway: revocation.jobGateway,
  service: revocation.service,
  environment,
  softwareVersion: SERVICE_VERSION,
  log,
});

let ready = true;

/** Bounded body read. A governed route must not be a memory-exhaustion surface. */
const MAX_BODY_BYTES = 64 * 1024;

async function readJsonBody(req: IncomingMessage): Promise<{ ok: boolean; value: unknown }> {
  if (req.method === "GET" || req.method === "HEAD") return { ok: true, value: undefined };
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    // Refused rather than truncated: a half-read governed request is a request
    // whose meaning nobody knows.
    if (total > MAX_BODY_BYTES) return { ok: false, value: undefined };
    chunks.push(buf);
  }
  if (total === 0) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, value: undefined };
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const body = await readJsonBody(req);
    if (!body.ok) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "VALIDATION_FAILED", detail: "malformed or oversized body" }));
      return;
    }
    // THE RUNTIME INVOCATION. `handleRequest` delegates `/v1/` to the governed
    // revocation router, which authenticates and then calls the real doors.
    const { status, body: payload } = await handleRequest(
      {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body: body.value,
      },
      { ready, revocationRouter: revocation.revocationRouter },
    );
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  })().catch(() => {
    // Nothing raw reaches the socket. The routes redact their own failures; this
    // is only the last resort for a transport-level fault.
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ code: "INTERNAL_ERROR", detail: "request could not be served" }));
  });
});

server.listen(port, () => {
  // Started only once the socket is open, so a process that failed to bind never
  // competes for jobs with the instance that did.
  lapseWorker.start();
  log.info("listening", {
    port,
    environment,
    version: SERVICE_VERSION,
    // Recorded so a deployment can be seen to have the real wiring. No DSN, no
    // credential and no role name is logged.
    revocationWiring: "governed-database",
    governedRoutes: "/v1/device-credentials/*",
    lapseWorker: lapseWorker.identity.workerInstanceId,
  });
});

function shutdown(signal: string): void {
  ready = false;
  log.info("shutting down", { signal });
  server.close(() => {
    // The worker stops FIRST and waits for an in-flight tick, so shutdown cannot
    // abandon a claimed job and leave it stalled until its lease expires.
    void lapseWorker
      .stop()
      .catch(() => undefined)
      .then(() => revocation.shutdown())
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
