/**
 * The PRODUCTION composition root. One function, no branches, no fakes.
 *
 * Authority: WS-11-T003 Step 4 final remediation §2 ("production code must select
 * the real implementation; test fakes must remain test-only; no production
 * fallback may select a fake"); infrastructure spec v1.0.0 §9.1.
 *
 * ===========================================================================
 * HOW "NO FAKE IN PRODUCTION" IS ENFORCED HERE
 * ===========================================================================
 * Not by a comment, and not by a code review convention. By three structural
 * facts, each of which a composition test asserts:
 *
 * 1. THERE IS NO SEAM. `resolveDeviceRevocationService` accepts an environment
 *    and returns a service. It takes no gateway, no client, no factory and no
 *    implementation name, so there is no argument through which a double could
 *    be passed. The only way to get a service out of this module is for it to
 *    build one over a real `pg.Pool`.
 *
 * 2. NO DOUBLE IS IMPORTABLE FROM PRODUCTION CODE. The test doubles live under
 *    `test/`, which `tsconfig.json` excludes from the build, so `dist/` cannot
 *    contain them and a deployed process cannot reach them even by name.
 *
 * 3. AN ATTEMPT TO OVERRIDE IS A REFUSAL, NOT A FALLBACK. Because the tempting
 *    future change is an env var — `..._IMPL=fake` for a demo — this module
 *    refuses to start if one is present. A hook that does not exist cannot be
 *    abused, but a hook that fails loudly also cannot be added quietly later.
 *
 * The wider rule this serves: the database is the thing that actually enforces
 * governance, so a fake gateway in production would not merely weaken a test —
 * it would be a revocation path that never revoked while reporting that it had.
 */
import type { Pool } from "pg";
import { createLogger } from "@kitluy/observability";
import { ConfigError, requireEnvironment, type Env } from "@kitluy/shared-config";

import { createPooledPgDurableJobGateway, type DurableJobGateway } from "@kitluy/job-contracts";

import { createRegistryPool, deviceRegistryDatabaseUrl } from "./database.js";
import { refuseAllRequests, type RequestAuthenticator } from "./authentication.js";
import { createEmergencyLapseScheduler, type EmergencyLapseScheduler } from "./lapse-scheduling.js";
import { createRevocationRouter, type RevocationRouter } from "./revocation-routes.js";
import {
  createDeviceRevocationService,
  type DeviceRevocationService,
} from "./revocation-service.js";
import { SERVICE_NAME } from "./index.js";

/**
 * Environment names that would select an implementation. None is supported; each
 * is refused on sight so the absence stays deliberate and visible.
 */
export const FORBIDDEN_IMPLEMENTATION_OVERRIDES: readonly string[] = [
  "DEVICE_REVOCATION_GATEWAY_IMPL",
  "DEVICE_REVOCATION_GATEWAY_FAKE",
  "DEVICE_REVOCATION_USE_FAKE",
  "DEVICE_REVOCATION_STUB",
];

export interface DeviceRevocationRuntime {
  readonly service: DeviceRevocationService;
  /** The governed durable-job queue, used to schedule the lapse obligation. */
  readonly jobGateway: DurableJobGateway;
  readonly lapseScheduler: EmergencyLapseScheduler;
  /** The HTTP surface `main.ts` serves. THIS is the runtime caller. */
  readonly revocationRouter: RevocationRouter;
  /** Exposed for readiness probes and shutdown only — not for issuing queries. */
  readonly pool: Pool;
  shutdown(): Promise<void>;
}

export interface ResolveOptions {
  /**
   * How a request's subject is established.
   *
   * Defaults to {@link refuseAllRequests}, which refuses everything: the token
   * issuer and edge mutual-auth design are [REQUIRED] owner values (BLK-005 item
   * 8 / BLK-006). A deployment supplies a real one here; there is deliberately no
   * environment variable that turns trust on, and no header this service will
   * accept as identity on its own.
   */
  readonly authenticator?: RequestAuthenticator;
}

/**
 * Builds the production runtime, or refuses to start.
 *
 * Fails closed at startup on a MISSING DSN and on any attempt to select an
 * implementation.
 *
 * A DSN that is present but WRONG is not caught here, and saying otherwise would
 * be the failure this function exists to prevent: `new pg.Pool` does not connect
 * eagerly, so a bad host or credential surfaces on first use — during the
 * incident. Closing that needs a startup connectivity probe, which is recorded as
 * an open condition.
 */
export function resolveDeviceRevocationService(
  env: Env = process.env,
  options: ResolveOptions = {},
): DeviceRevocationRuntime {
  for (const name of FORBIDDEN_IMPLEMENTATION_OVERRIDES) {
    const value = env[name];
    if (value !== undefined && value.trim() !== "") {
      throw new ConfigError(
        name,
        `${name} is set. This service has no alternate revocation implementation: ` +
          "the governed doors are enforced by the database and a substitute would be a " +
          "revocation path that does not revoke. Remove the variable.",
      );
    }
  }

  // Validated here so a bad DSN or environment is a startup failure rather than
  // a first-incident failure. The value is never logged.
  deviceRegistryDatabaseUrl(env);
  requireEnvironment(env);

  const pool = createRegistryPool(env);
  const service = createDeviceRevocationService(pool);

  // The governed queue, over the SAME pool. Each call opens its own transaction
  // as `kitluy_worker_service`, so the job identity never leaks onto a pooled
  // connection the revocation doors then borrow.
  const jobGateway = createPooledPgDurableJobGateway(pool);
  const lapseScheduler = createEmergencyLapseScheduler(jobGateway);

  const revocationRouter = createRevocationRouter({
    service,
    // FAIL CLOSED by default. See `ResolveOptions.authenticator`.
    authenticator: options.authenticator ?? refuseAllRequests(),
    lapseScheduler,
  });

  const log = createLogger(SERVICE_NAME);
  pool.on("error", (error: Error) => {
    // Pool-level faults arrive on idle clients with no request to attribute them
    // to. Only the error NAME is logged: a `pg` error carries the failing query
    // and governed-table names on its `message`/`detail`, and this service
    // redacts those (see `revocation-failures.ts`).
    log.warn("revocation pool client error", { error: error.name });
  });

  return {
    service,
    jobGateway,
    lapseScheduler,
    revocationRouter,
    pool,
    async shutdown(): Promise<void> {
      await pool.end();
    },
  };
}
