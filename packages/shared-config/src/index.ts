/**
 * @kitluy/shared-config — environment configuration parsing, fail closed.
 *
 * Source authority: infrastructure spec v1.0.0 §9.1 (configuration through
 * environment variables or mounted configuration; no authoritative local
 * filesystem state) and §4.2 (production credentials never in local/dev
 * clients). Services validate configuration at startup and refuse to run with
 * invalid values.
 *
 * STATUS: BUILT + TESTED (test/shared-config.test.ts).
 */
import { KITLUY_ENVIRONMENTS, type KitluyEnvironment } from "@kitluy/shared-types";

export class ConfigError extends Error {
  constructor(
    readonly variable: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

export function requireString(env: Env, name: string): string {
  const v = env[name];
  if (v === undefined || v.trim() === "") {
    throw new ConfigError(name, `Missing required environment variable ${name}. Fail closed.`);
  }
  return v;
}

export function optionalString(env: Env, name: string, fallback: string): string {
  const v = env[name];
  return v === undefined || v.trim() === "" ? fallback : v;
}

export function requirePort(env: Env, name: string): number {
  const raw = requireString(env, name);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(name, `${name} must be a TCP port (1-65535), got "${raw}".`);
  }
  return port;
}

export function requireEnvironment(env: Env, name = "KITLUY_ENV"): KitluyEnvironment {
  const raw = requireString(env, name);
  if (!(KITLUY_ENVIRONMENTS as readonly string[]).includes(raw)) {
    throw new ConfigError(
      name,
      `${name} must be one of ${KITLUY_ENVIRONMENTS.join(", ")}, got "${raw}".`,
    );
  }
  return raw as KitluyEnvironment;
}

/**
 * Guard for local/destructive tooling: refuses to proceed when the target
 * environment is production-like or a connection string is not local.
 */
export function assertLocalTarget(env: Env): void {
  const environment = optionalString(env, "KITLUY_ENV", "local");
  if (
    environment === "production" ||
    environment === "pilot" ||
    environment === "disaster_recovery"
  ) {
    throw new ConfigError(
      "KITLUY_ENV",
      `Refusing destructive local operation while KITLUY_ENV=${environment}.`,
    );
  }
  const dsn = env["HUB_LOCAL_DATABASE_URL"] ?? env["DATABASE_URL"] ?? "";
  if (dsn !== "" && !/localhost|127\.0\.0\.1|::1/.test(dsn)) {
    throw new ConfigError(
      "DATABASE_URL",
      "Refusing destructive local operation against a non-local database URL.",
    );
  }
}
