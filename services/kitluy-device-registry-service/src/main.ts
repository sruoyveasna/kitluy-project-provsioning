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
import { ConfigError, requireEnvironment, requirePort } from "@kitluy/shared-config";
import type { TrustEnvironment } from "@kitluy/device-identity";
import { resolveDeviceRevocationService } from "./composition.js";
import { EnrollmentComposition, type DevelopmentOpenEnrollment } from "./enrollment-composition.js";
import { createEnrollmentRouter, DEVICE_ENROLLMENT_PREFIX } from "./enrollment-routes.js";
import { HubPairingComposition } from "./hub-pairing-composition.js";
import { createHubPairingRouter, HUB_PAIRING_PREFIX } from "./hub-pairing-routes.js";
import { createDeviceBootRouter, DEVICE_BOOT_PREFIX } from "./device-boot-routes.js";
import { createDeviceRuntimeRouter, DEVICE_RUNTIME_PREFIX } from "./device-runtime-routes.js";
import { recordDeviceRuntimeReport } from "./device-runtime-status.js";
import { classifyDeviceBoot } from "./device-boot-classification.js";
import { createTerminalPairingRouter, TERMINAL_PAIRING_PREFIX } from "./terminal-pairing-routes.js";
import { TerminalPairingComposition } from "./terminal-pairing-composition.js";
import { createOperationalCertificateRouter } from "./operational-certificate-routes.js";
import { advanceDeviceTrust } from "./device-trust-advance.js";
import { resolveEnrollmentTimeSigningKeyReference } from "./enrollment-time-signer.js";
import { handleRequest } from "./http.js";
import { createLapseWorkerLoop } from "./lapse-worker-runtime.js";
import { TerminalProvisioningComposition } from "./provisioning-composition.js";
import {
  createTerminalProvisioningRouter,
  TERMINAL_PROVISIONING_PREFIX,
} from "./provisioning-routes.js";
import { createEd25519SnapshotSigner } from "./snapshot-signer.js";
import { terminalSeatDerivation } from "./terminal-seat-derivation.js";
import { SERVICE_NAME, SERVICE_VERSION } from "./index.js";

const log = createLogger(SERVICE_NAME);
const environment = requireEnvironment(process.env);
const port = requirePort(process.env, "PORT");

// Startup-time refusal, before anything is listening.
const revocation = resolveDeviceRevocationService(process.env);

/**
 * THE CLOUD BOOTSTRAP SURFACE (WS-11-T004-P04A). Same pool, and each
 * composition operation enters the NOLOGIN `kitluy_provisioning_service`
 * composer for exactly one transaction (0172/0173) — the connecting identity
 * itself holds no effective privilege on any provisioning door.
 */
const provisioningRouter = createTerminalProvisioningRouter({
  composition: new TerminalProvisioningComposition(revocation.pool, {
    info: (fields) => log.info("terminal-provisioning", fields),
  }),
  logger: { info: (fields) => log.info("terminal-provisioning-route", fields) },
});

/**
 * DEPLOYMENT ENVIRONMENT → TRUST ENVIRONMENT.
 *
 * `KITLUY_ENV` has six values; device trust has three. The mapping is explicit
 * and fail-closed rather than defaulted, because the enrollment router's
 * environment is what a redeemed challenge is judged against: silently falling
 * back to `development` would let a staging or disaster-recovery deployment
 * mint development-trust enrollments, which is precisely the direction that
 * must never be guessed.
 *
 * `local` maps to `development` deliberately — the local stack carries the
 * development `pki_trust_configuration` row (0122 §5), so they are the same
 * trust environment wearing two deployment names.
 */
type DeploymentEnvironment = ReturnType<typeof requireEnvironment>;

const TRUST_ENVIRONMENT_BY_DEPLOYMENT: Readonly<
  Partial<Record<DeploymentEnvironment, TrustEnvironment>>
> = {
  local: "development",
  development: "development",
  pilot: "pilot",
  production: "production",
};

const trustEnvironment = TRUST_ENVIRONMENT_BY_DEPLOYMENT[environment];
if (trustEnvironment === undefined) {
  // `staging` and `disaster_recovery` have no ruled device-trust equivalent.
  // That is an owner decision, not a default this process may invent.
  throw new ConfigError(
    "KITLUY_ENV",
    `KITLUY_ENV="${environment}" has no ruled device-trust environment; ` +
      "device enrollment cannot be served from this deployment.",
  );
}

/**
 * THE FACTORY-ENROLLMENT SURFACE (DEC-2,
 * KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001).
 *
 * This is the first network step a factory-fresh device takes. It runs on the
 * same pool as the bootstrap surface and, like it, holds no effective privilege
 * of its own — every door call enters a governed NOLOGIN identity for exactly
 * one transaction.
 *
 * The time-signing key is resolved HERE, at startup: a nonsense key version is
 * refused before the socket opens. An ABSENT key is not a startup failure,
 * because challenges remain serviceable without it — redemption then fails
 * closed with `TIME_TOKEN_UNAVAILABLE`, and there is deliberately no unsigned
 * fallback (`enrollment-time-signer.ts`).
 */
const enrollmentTimeKeyReference = resolveEnrollmentTimeSigningKeyReference(process.env);

/**
 * DEVELOPMENT OPEN ENROLLMENT (KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001).
 *
 * OFF unless explicitly enabled, and REFUSED at startup outside `development` —
 * a deployment cannot drift into it, and a misconfigured one does not start.
 * The profile keys are resolved to ids here, before the socket opens, so a
 * typo is a boot failure rather than a device that enrolls into nothing.
 */
const openEnrollmentRequested = (process.env.KITLUY_DEV_OPEN_ENROLLMENT ?? "") === "true";
if (openEnrollmentRequested && trustEnvironment !== "development") {
  throw new ConfigError(
    "KITLUY_DEV_OPEN_ENROLLMENT",
    "open enrollment is a DEVELOPMENT-only path and cannot be enabled in " +
      `${trustEnvironment} (KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001 §5).`,
  );
}

async function resolveOpenEnrollment(): Promise<DevelopmentOpenEnrollment | undefined> {
  if (!openEnrollmentRequested) return undefined;

  const stationKey = process.env.KITLUY_DEV_ENROLLMENT_STATION ?? "";
  const terminalProfile = process.env.KITLUY_DEV_ENROLLMENT_PROFILE_TERMINAL ?? "";
  const hubProfile = process.env.KITLUY_DEV_ENROLLMENT_PROFILE_STORE_HUB ?? "";
  if (stationKey === "" || terminalProfile === "") {
    throw new ConfigError(
      "KITLUY_DEV_ENROLLMENT_STATION",
      "open enrollment needs KITLUY_DEV_ENROLLMENT_STATION and " +
        "KITLUY_DEV_ENROLLMENT_PROFILE_TERMINAL. An unregistered station quarantines every device.",
    );
  }

  // Read as the CONNECTING identity, before any governed role is assumed —
  // `kitluy_fleet_service` holds no SELECT on the profile catalogue and must
  // not be granted one to save a lookup.
  const client = await revocation.pool.connect();
  try {
    const profileIdByDeviceClass: Record<string, string> = {};
    for (const [deviceClass, key] of [
      ["terminal", terminalProfile],
      ["store_hub", hubProfile],
    ] as const) {
      if (key === "") continue;
      const { rows } = await client.query<{ id: string }>(
        `select id from kitluy_devices.hardware_profiles where profile_key = $1 and is_active`,
        [key],
      );
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new ConfigError(
          "KITLUY_DEV_ENROLLMENT_PROFILE",
          `no active hardware profile with key ${key}`,
        );
      }
      profileIdByDeviceClass[deviceClass] = id;
    }
    return { stationKey, operatorRef: "operator/dev-open-enrollment", profileIdByDeviceClass };
  } finally {
    client.release();
  }
}

const openEnrollment = await resolveOpenEnrollment();

const enrollmentRouter = createEnrollmentRouter({
  composition: new EnrollmentComposition({
    source: revocation.pool,
    signer: createEd25519SnapshotSigner({}),
    timeKeyReference: enrollmentTimeKeyReference,
    logger: { info: (fields) => log.info("device-enrollment", fields) },
    ...(openEnrollment === undefined ? {} : { openEnrollment }),
  }),
  logger: { info: (fields) => log.info("device-enrollment-route", fields) },
  environment: trustEnvironment,
});

/**
 * THE STORE HUB PAIRING SURFACE (KLD-2026-08-13-HUB-CLAIM-PRESENTATION-001).
 *
 * Composed unconditionally, unlike open enrollment: pairing needs no development
 * concession and no environment opt-in. Its authority is a code an operator
 * typed, and the governed doors behind it hold the same line in every
 * environment — 0191 counts attempts and locks, 0121 enforces single use, and
 * activation stays fail-closed under BLK-005 regardless of deployment.
 *
 * It reaches the database as `kitluy_hub_pairing_service` (group 0192), NOT as
 * the connecting `service_role`, so this pre-credential surface cannot touch a
 * table even if every check above it were bypassed.
 */
// The governed operational-certificate route. It owns no policy: every decision
// is made behind `issueFirstOperationalCertificate` and its doors.
const operationalCertificateRouter = createOperationalCertificateRouter({
  pool: revocation.pool,
  logger: { info: (fields) => log.info("operational-certificate", fields) },
});

const hubPairingRouter = createHubPairingRouter({
  composition: new HubPairingComposition({
    source: revocation.pool,
    logger: { info: (fields) => log.info("hub-pairing", fields) },
  }),
  // AFTER a Hub pairs, try to advance it toward `active` (group 0198).
  //
  // Nothing in the product called `attempt_activate_device_v1` before this line
  // existed, so every paired Hub rested at `awaiting_trust` for ever. It is a
  // separate step, in its own transaction and its own identity, because group
  // 0121's redemption deliberately stops where it does.
  advanceTrust: (deviceRecordId) =>
    advanceDeviceTrust(revocation.pool, {
      deviceRecordId,
      environment: trustEnvironment,
      actorRef: "device/hub-pairing",
    }),
  logger: { info: (fields) => log.info("hub-pairing-route", fields) },
});

// Boot classification (group 0227). Pre-credential and read-only: it reaches the
// database as `kitluy_device_boot_service`, which holds exactly one read. The
// decision itself is `@kitluy/device-boot-classification`, never this file.
const deviceBootRouter = createDeviceBootRouter({
  classify: (request) => classifyDeviceBoot(revocation.pool, trustEnvironment, request),
  logger: { info: (fields) => log.info("device-boot-route", fields) },
});

// Device runtime status (group 0229): a Terminal's own signed report of its Hub
// link, POS release and POS runtime. The signature is verified in the route; the
// door binds the key to the current sealed enrollment.
const deviceRuntimeRouter = createDeviceRuntimeRouter({
  record: (input) => recordDeviceRuntimeReport(revocation.pool, input),
  logger: { info: (fields) => log.info("device-runtime-route", fields) },
});

// Pi Terminal pairing (group 0213): the same two-door shape as Hub pairing,
// with the assignment performed inside the consume door, then the same
// separate trust advance so a paired terminal can reach `active`.
const terminalPairingRouter = createTerminalPairingRouter({
  composition: new TerminalPairingComposition({
    source: revocation.pool,
    logger: { info: (fields) => log.info("terminal-pairing", fields) },
    seatDerivation: terminalSeatDerivation,
  }),
  advanceTrust: (deviceRecordId) =>
    advanceDeviceTrust(revocation.pool, {
      deviceRecordId,
      environment: trustEnvironment,
      actorRef: "device/terminal-pairing",
    }),
  logger: { info: (fields) => log.info("terminal-pairing-route", fields) },
});

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

async function readRawBody(req: IncomingMessage): Promise<{ ok: boolean; text: string }> {
  if (req.method === "GET" || req.method === "HEAD") return { ok: true, text: "" };
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    // Refused rather than truncated: a half-read governed request is a request
    // whose meaning nobody knows.
    if (total > MAX_BODY_BYTES) return { ok: false, text: "" };
    chunks.push(buf);
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

const server = createServer((req, res) => {
  void (async () => {
    const raw = await readRawBody(req);
    if (!raw.ok) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "VALIDATION_FAILED", detail: "malformed or oversized body" }));
      return;
    }
    // The bootstrap surface owns its raw text (its 16 KiB gate and JSON-shape
    // refusals must COUNT toward its rate limit), so only the other routes
    // are parsed here at the transport. Enrollment borrows those same
    // conventions verbatim, so it owns its raw text for the same reason: a
    // malformed body refused at the transport would never reach the limiter,
    // and an attacker could probe indefinitely with garbage JSON.
    const url = req.url ?? "";
    const isBootstrap =
      url.startsWith(TERMINAL_PROVISIONING_PREFIX) ||
      url.startsWith(DEVICE_ENROLLMENT_PREFIX) ||
      // Hub pairing owns its raw text for the same reason, and needs it more:
      // its rate limiter is the only thing standing between an eight-character
      // code and unlimited guessing volume. A malformed body rejected here would
      // never reach that limiter, so garbage JSON would be free.
      url.startsWith(HUB_PAIRING_PREFIX) ||
      url.startsWith(TERMINAL_PAIRING_PREFIX) ||
      // Boot classification is pre-credential too, and its limiter must see
      // every attempt, malformed ones included.
      url.startsWith(DEVICE_BOOT_PREFIX) ||
      // The runtime report's limiter must see every attempt too.
      url.startsWith(DEVICE_RUNTIME_PREFIX);
    let parsed: unknown;
    if (!isBootstrap && raw.text.length > 0) {
      try {
        parsed = JSON.parse(raw.text);
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ code: "VALIDATION_FAILED", detail: "malformed or oversized body" }),
        );
        return;
      }
    }
    // THE RUNTIME INVOCATION. `handleRequest` delegates `/v1/` to the governed
    // routers: terminal-provisioning bootstrap first, then revocation, each of
    // which establishes its own request authority before calling a real door.
    const {
      status,
      body: payload,
      headers,
    } = await handleRequest(
      {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body: parsed,
        rawBody: raw.text,
        // The transport-observed peer address — never a forwarded-for header
        // (KLD-2026-08-05-TERMINAL-TRANSPORT-001 §2).
        sourceIp: req.socket.remoteAddress ?? "",
      },
      {
        ready,
        revocationRouter: revocation.revocationRouter,
        provisioningRouter,
        enrollmentRouter,
        hubPairingRouter,
        terminalPairingRouter,
        operationalCertificateRouter,
        deviceBootRouter,
        deviceRuntimeRouter,
      },
    );
    res.writeHead(status, { "content-type": "application/json", ...(headers ?? {}) });
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
    // `/v1/hub-pairing` is wired above but was missing from this line, so the
    // startup log reported a smaller surface than the service actually answers —
    // and this log is the one place an operator checks what a deployment serves.
    governedRoutes: `/v1/device-credentials/*, /v1/terminal-provisioning/*, /v1/device-enrollment/*, ${HUB_PAIRING_PREFIX}, ${DEVICE_BOOT_PREFIX}/classification, ${DEVICE_RUNTIME_PREFIX}/report`,
    trustEnvironment,
    // Whether this deployment can complete an enrollment, not merely start one.
    // A key REFERENCE is a name, never key material — nothing secret is logged.
    enrollmentTimeSigning: enrollmentTimeKeyReference === null ? "unconfigured" : "configured",
    // Announced, per KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001 §5.3: nobody
    // may mistake an open deployment for a governed one.
    openEnrollment: openEnrollment === undefined ? "off" : "ON (development only)",
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
