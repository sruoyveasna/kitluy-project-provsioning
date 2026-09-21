/**
 * Composition root for the governed Management API.
 *
 * Authority: infrastructure spec v1.0.0 §9.1 (configuration through environment
 * variables; services validate configuration at startup and refuse to run with
 * invalid values); CLAUDE.md hard rule 4 (no credential in code, config, logs
 * or docs).
 *
 * ===========================================================================
 * WHAT IS ASSEMBLED HERE, AND WHY IT IS ONE PLACE
 * ===========================================================================
 * Two credentials meet in this service and they must never be confused:
 *
 *   the PUBLISHABLE key   used ONLY as the `apikey` header when asking the auth
 *                         server to identify a caller's token. It grants nothing.
 *   the DATABASE DSN      the trusted server identity. Authority to CONNECT.
 *                         It decides nothing about who may do what — every
 *                         authorization answer still comes from
 *                         `kitluy_auth.has_permission` evaluated for the caller.
 *
 * Both are read from the environment and neither is ever logged. `describe()`
 * exists so startup can prove what it wired without printing a secret: it emits
 * the project host and the database host, never a key, never a password.
 */
import { terminalSeatDerivation } from "./terminal-seat-derivation.js";
import pg from "pg";
import { optionalString, requireEnvironment, requireString, type Env } from "@kitluy/shared-config";
import { createSupabaseTokenVerifier, type TokenVerifier } from "./authorization.js";
import type { FreshnessPolicy } from "./fleet.js";
import type { ManagementRouterDependencies } from "./http.js";

/**
 * Environment variable names, service-prefixed so a deployment cannot hand this
 * service another component's connection string by accident.
 */
export const MANAGEMENT_API_DATABASE_URL = "MANAGEMENT_API_DATABASE_URL" as const;
export const MANAGEMENT_API_AUTH_URL = "MANAGEMENT_API_AUTH_URL" as const;
export const MANAGEMENT_API_AUTH_PUBLISHABLE_KEY = "MANAGEMENT_API_AUTH_PUBLISHABLE_KEY" as const;
export const MANAGEMENT_API_ALLOWED_ORIGINS = "MANAGEMENT_API_ALLOWED_ORIGINS" as const;
export const MANAGEMENT_API_STALE_AFTER_SECONDS = "MANAGEMENT_API_STALE_AFTER_SECONDS" as const;
export const MANAGEMENT_API_OFFLINE_AFTER_SECONDS = "MANAGEMENT_API_OFFLINE_AFTER_SECONDS" as const;

/**
 * Device liveness thresholds — OWNER-APPROVED DEVELOPMENT DEFAULT (2026-08-10).
 *
 * These are CONFIGURATION, deliberately not database truth and not a product
 * constant. A threshold baked into an enum or a migration becomes a fact the
 * fleet cannot re-tune without a schema change, and the right number is a
 * property of heartbeat cadence and site network behaviour — neither of which
 * is known until real devices run on real Store networks.
 *
 * Before Pilot these MUST be reviewed against observed heartbeat cadence.
 * Until then the portal reports states derived from these values and says so.
 */
export const DEVELOPMENT_STALE_AFTER_SECONDS = 90;
export const DEVELOPMENT_OFFLINE_AFTER_SECONDS = 300;

export class ManagementConfigError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = "ManagementConfigError";
  }
}

export interface ManagementConfig {
  readonly databaseUrl: string;
  readonly authUrl: string;
  readonly authPublishableKey: string;
  readonly allowedOrigins: readonly string[];
  readonly freshness: FreshnessPolicy;
}

/**
 * Parse one threshold.
 *
 * An unparseable or non-positive value is a REFUSAL, not a silent fallback to
 * the default: a deployment that meant to set 600 and typed `600s` would
 * otherwise report devices offline five minutes early and nobody would know a
 * value had been ignored.
 */
function readThreshold(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ManagementConfigError(name, `${name} must be a positive whole number of seconds`);
  }
  return value;
}

/**
 * A publishable/anon credential and nothing else.
 *
 * This mirrors the browser client's refusal for the same reason: a service-role
 * key placed here would still be a service-role key, and it would be attached
 * to every identity lookup. The check is cheap; the mistake it prevents is not.
 */
function assertPublishableKey(key: string): void {
  const looksLikeJwt = key.split(".").length === 3 && key.startsWith("eyJ");
  if (key.startsWith("sb_secret_") || key.startsWith("sbp_")) {
    throw new ManagementConfigError(
      MANAGEMENT_API_AUTH_PUBLISHABLE_KEY,
      `${MANAGEMENT_API_AUTH_PUBLISHABLE_KEY} holds a privileged credential; only a publishable key belongs here`,
    );
  }
  if (looksLikeJwt) {
    const payload = key.split(".")[1] ?? "";
    try {
      const claims = JSON.parse(
        Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      ) as { role?: unknown };
      if (typeof claims.role === "string" && claims.role !== "anon") {
        throw new ManagementConfigError(
          MANAGEMENT_API_AUTH_PUBLISHABLE_KEY,
          `${MANAGEMENT_API_AUTH_PUBLISHABLE_KEY} holds a '${claims.role}' JWT; only a publishable key belongs here`,
        );
      }
    } catch (error) {
      if (error instanceof ManagementConfigError) throw error;
      // An undecodable payload is not proof of privilege; the shape check below
      // still applies.
    }
    return;
  }
  if (!key.startsWith("sb_publishable_")) {
    throw new ManagementConfigError(
      MANAGEMENT_API_AUTH_PUBLISHABLE_KEY,
      `${MANAGEMENT_API_AUTH_PUBLISHABLE_KEY} is not a recognised publishable key; refusing an unidentified credential`,
    );
  }
}

/**
 * Whether an http auth endpoint is the LOCAL Supabase stack on this machine.
 *
 * https is mandatory for the auth endpoint, and stays mandatory for every host
 * that is not loopback. The one exemption exists because a local Supabase
 * stack serves GoTrue over http on 127.0.0.1, so without it this service
 * cannot be run against a developer's own database at all — which is exactly
 * where a device enrolled on a workstation can be seen.
 *
 * Two conditions, both required, and neither reachable from a deployment:
 *
 *   1. the host is loopback, so the traffic never touches a network and there
 *      is no transport for anyone to intercept;
 *   2. KITLUY_ENV is `local`, which the hosted deployment path never sets.
 *
 * A remote http URL is still refused in every environment, including `local`.
 */
function isLoopbackDevelopmentAuthUrl(authUrl: string, env: Env): boolean {
  if ((env.KITLUY_ENV ?? "") !== "local") return false;
  return /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i.test(authUrl);
}

export function loadManagementConfig(env: Env = process.env): ManagementConfig {
  const databaseUrl = requireString(env, MANAGEMENT_API_DATABASE_URL);
  const authUrl = requireString(env, MANAGEMENT_API_AUTH_URL);
  const authPublishableKey = requireString(env, MANAGEMENT_API_AUTH_PUBLISHABLE_KEY);
  assertPublishableKey(authPublishableKey);

  if (!/^https:\/\/[^\s/]+$/i.test(authUrl) && !isLoopbackDevelopmentAuthUrl(authUrl, env)) {
    throw new ManagementConfigError(
      MANAGEMENT_API_AUTH_URL,
      `${MANAGEMENT_API_AUTH_URL} must be an https base URL with no path`,
    );
  }

  const allowedOrigins = optionalString(env, MANAGEMENT_API_ALLOWED_ORIGINS, "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  const staleAfterSeconds = readThreshold(
    env,
    MANAGEMENT_API_STALE_AFTER_SECONDS,
    DEVELOPMENT_STALE_AFTER_SECONDS,
  );
  const offlineAfterSeconds = readThreshold(
    env,
    MANAGEMENT_API_OFFLINE_AFTER_SECONDS,
    DEVELOPMENT_OFFLINE_AFTER_SECONDS,
  );

  // OFFLINE must be the weaker signal. Inverted thresholds would make STALE
  // unreachable and quietly convert a degraded device into a fully offline one.
  if (offlineAfterSeconds <= staleAfterSeconds) {
    throw new ManagementConfigError(
      MANAGEMENT_API_OFFLINE_AFTER_SECONDS,
      `${MANAGEMENT_API_OFFLINE_AFTER_SECONDS} (${offlineAfterSeconds}s) must be greater than ${MANAGEMENT_API_STALE_AFTER_SECONDS} (${staleAfterSeconds}s)`,
    );
  }

  return {
    databaseUrl,
    authUrl,
    authPublishableKey,
    allowedOrigins,
    freshness: { staleAfterSeconds, offlineAfterSeconds },
  };
}

export interface ManagementRuntime {
  readonly pool: pg.Pool;
  readonly verifier: TokenVerifier;
  readonly dependencies: ManagementRouterDependencies;
  readonly allowedOrigins: readonly string[];
  /** Startup-safe description: hosts only, never a credential. */
  describe(): Readonly<Record<string, string | number>>;
}

/**
 * Build the runtime.
 *
 * The pool is deliberately small. This service opens a transaction per request
 * to assume the `authenticated` role and rolls it back; the pooler upstream is
 * in SESSION mode, so connections are a scarce shared resource rather than a
 * free local one.
 */
export function createManagementRuntime(env: Env = process.env, max = 8): ManagementRuntime {
  const config = loadManagementConfig(env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max });
  const verifier = createSupabaseTokenVerifier({
    url: config.authUrl,
    publishableKey: config.authPublishableKey,
  });

  return {
    pool,
    verifier,
    allowedOrigins: config.allowedOrigins,
    dependencies: {
      db: pool,
      verifier,
      freshnessPolicy: config.freshness,
      // The Hub pairing-code route MUTATES, so it needs a handle it can open a
      // transaction on and enter `kitluy_hub_issuance_service` inside. `db` above
      // is a bare query handle and cannot do that.
      issuance: { pool },
      // Device-enrollment approval likewise MUTATES through a governed door and
      // needs a transaction it can enter `service_role` inside.
      approval: { pool },
      // Terminal pairing (group 0213): Partner routes enter
      // `kitluy_terminal_issuance_service` inside a transaction.
      terminals: { pool, seatDerivation: terminalSeatDerivation },
      // The device recovery view (group 0227) reads as
      // `kitluy_device_boot_service` inside a transaction.
      recovery: { pool },
      // Digital Store creation (group 0215) enters `service_role` inside a
      // transaction, as device approval does.
      stores: { pool },
      // Asserted to `has_permission`; RLS-022 fails closed without it.
      environment: requireEnvironment(env),
    },
    describe() {
      return {
        authHost: safeHost(config.authUrl),
        databaseHost: safeDatabaseHost(config.databaseUrl),
        allowedOrigins: config.allowedOrigins.length,
        // Named as what it is. These are development defaults pending a Pilot
        // review against real heartbeat cadence, not settled product truth.
        freshnessPolicy: "owner-approved-development-default",
        staleAfterSeconds: config.freshness.staleAfterSeconds ?? 0,
        offlineAfterSeconds: config.freshness.offlineAfterSeconds ?? 0,
      };
    },
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unparseable";
  }
}

/**
 * Host and port of the DSN, with any embedded password discarded.
 *
 * A connection string is a credential. Logging it "for diagnostics" is the
 * standard way a database password reaches a log aggregator, so the parse keeps
 * host and port and drops everything else — including on failure.
 */
function safeDatabaseHost(dsn: string): string {
  try {
    const parsed = new URL(dsn);
    return parsed.port === "" ? parsed.hostname : `${parsed.hostname}:${parsed.port}`;
  } catch {
    return "unparseable";
  }
}
