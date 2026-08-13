/**
 * Composition root.
 *
 * These tests are about REFUSAL. A service that starts with a service-role key
 * in the identity-lookup slot works perfectly and is catastrophically wrong, so
 * the value of this file is that such a configuration cannot reach `listen()`.
 */
import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_OFFLINE_AFTER_SECONDS,
  DEVELOPMENT_STALE_AFTER_SECONDS,
  loadManagementConfig,
  MANAGEMENT_API_ALLOWED_ORIGINS,
  MANAGEMENT_API_AUTH_PUBLISHABLE_KEY,
  MANAGEMENT_API_AUTH_URL,
  MANAGEMENT_API_DATABASE_URL,
  MANAGEMENT_API_OFFLINE_AFTER_SECONDS,
  MANAGEMENT_API_STALE_AFTER_SECONDS,
} from "../src/composition.js";
import { deriveFreshness } from "../src/fleet.js";

/** A syntactically valid, entirely fictitious pooler DSN. */
const DSN = "postgresql://postgres.projectref@pooler.example.com:5432/postgres";

const BASE = {
  [MANAGEMENT_API_DATABASE_URL]: DSN,
  [MANAGEMENT_API_AUTH_URL]: "https://projectref.example.co",
  [MANAGEMENT_API_AUTH_PUBLISHABLE_KEY]: "sb_publishable_fictitious_value",
} as const;

/** Builds a JWT-shaped string with the given role claim. Not a real token. */
function jwtWithRole(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.notasignature`;
}

describe("management configuration", () => {
  it("loads a complete configuration", () => {
    const config = loadManagementConfig({ ...BASE });
    expect(config.databaseUrl).toBe(DSN);
    expect(config.allowedOrigins).toEqual([]);
  });

  it("fails closed on every missing variable", () => {
    for (const key of [
      MANAGEMENT_API_DATABASE_URL,
      MANAGEMENT_API_AUTH_URL,
      MANAGEMENT_API_AUTH_PUBLISHABLE_KEY,
    ]) {
      const env: Record<string, string | undefined> = { ...BASE };
      delete env[key];
      expect(() => loadManagementConfig(env), `${key} must be required`).toThrow();
    }
  });

  it("refuses a service-role JWT where a publishable key belongs", () => {
    expect(() =>
      loadManagementConfig({
        ...BASE,
        [MANAGEMENT_API_AUTH_PUBLISHABLE_KEY]: jwtWithRole("service_role"),
      }),
    ).toThrow(/service_role/);
  });

  it("accepts an anon JWT — that is what a publishable credential looks like", () => {
    expect(() =>
      loadManagementConfig({
        ...BASE,
        [MANAGEMENT_API_AUTH_PUBLISHABLE_KEY]: jwtWithRole("anon"),
      }),
    ).not.toThrow();
  });

  it("refuses secret-prefixed credentials", () => {
    for (const key of ["sb_secret_abc", "sbp_abc"]) {
      expect(() =>
        loadManagementConfig({ ...BASE, [MANAGEMENT_API_AUTH_PUBLISHABLE_KEY]: key }),
      ).toThrow(/privileged/);
    }
  });

  it("refuses an unidentified credential rather than trusting the variable name", () => {
    // The paste-the-database-password mistake: neither a JWT nor a publishable key.
    expect(() =>
      loadManagementConfig({
        ...BASE,
        [MANAGEMENT_API_AUTH_PUBLISHABLE_KEY]: "hunter2-not-a-key-at-all",
      }),
    ).toThrow(/unidentified/);
  });

  it("refuses a non-https or path-bearing auth URL", () => {
    for (const url of ["http://projectref.example.co", "https://projectref.example.co/auth/v1"]) {
      expect(() => loadManagementConfig({ ...BASE, [MANAGEMENT_API_AUTH_URL]: url })).toThrow();
    }
  });

  it("applies the owner-approved development liveness defaults", () => {
    const { freshness } = loadManagementConfig({ ...BASE });
    expect(freshness.staleAfterSeconds).toBe(DEVELOPMENT_STALE_AFTER_SECONDS);
    expect(freshness.offlineAfterSeconds).toBe(DEVELOPMENT_OFFLINE_AFTER_SECONDS);
    expect(freshness.staleAfterSeconds).toBe(90);
    expect(freshness.offlineAfterSeconds).toBe(300);
  });

  it("lets a deployment override both thresholds", () => {
    const { freshness } = loadManagementConfig({
      ...BASE,
      [MANAGEMENT_API_STALE_AFTER_SECONDS]: "30",
      [MANAGEMENT_API_OFFLINE_AFTER_SECONDS]: "120",
    });
    expect(freshness).toEqual({ staleAfterSeconds: 30, offlineAfterSeconds: 120 });
  });

  it("refuses an unparseable threshold rather than silently using the default", () => {
    // A deployment that meant 600 and typed "600s" must not quietly report
    // devices offline five minutes early with nobody aware a value was ignored.
    for (const bad of ["600s", "0", "-1", "9.5", "many"]) {
      expect(() =>
        loadManagementConfig({ ...BASE, [MANAGEMENT_API_STALE_AFTER_SECONDS]: bad }),
      ).toThrow();
    }
  });

  it("refuses inverted thresholds, which would make STALE unreachable", () => {
    expect(() =>
      loadManagementConfig({
        ...BASE,
        [MANAGEMENT_API_STALE_AFTER_SECONDS]: "300",
        [MANAGEMENT_API_OFFLINE_AFTER_SECONDS]: "90",
      }),
    ).toThrow(/must be greater than/);
  });

  it("drives the full NEVER_SEEN -> ONLINE -> STALE -> OFFLINE progression", () => {
    const { freshness } = loadManagementConfig({ ...BASE });
    const now = new Date("2026-08-10T12:00:00Z");
    const ago = (seconds: number): string => new Date(now.getTime() - seconds * 1000).toISOString();

    expect(deriveFreshness(null, freshness, now)).toBe("NEVER_SEEN");
    expect(deriveFreshness(ago(5), freshness, now)).toBe("ONLINE");
    expect(deriveFreshness(ago(89), freshness, now)).toBe("ONLINE");
    // Boundaries are inclusive on the threshold itself.
    expect(deriveFreshness(ago(90), freshness, now)).toBe("STALE");
    expect(deriveFreshness(ago(299), freshness, now)).toBe("STALE");
    expect(deriveFreshness(ago(300), freshness, now)).toBe("OFFLINE");
    expect(deriveFreshness(ago(86_400), freshness, now)).toBe("OFFLINE");
  });

  it("parses an explicit origin allowlist", () => {
    const config = loadManagementConfig({
      ...BASE,
      [MANAGEMENT_API_ALLOWED_ORIGINS]: "http://localhost:5173, http://127.0.0.1:5173 ,",
    });
    expect(config.allowedOrigins).toEqual(["http://localhost:5173", "http://127.0.0.1:5173"]);
  });
});

/**
 * The auth endpoint stays https everywhere except the developer's own machine.
 *
 * The exemption exists so this service can run against a LOCAL Supabase stack,
 * which serves GoTrue over http on loopback — without it a device enrolled on a
 * workstation could never be seen in the Admin portal. It is deliberately
 * narrow, and these tests are mostly about what it still REFUSES.
 */
describe("loopback development auth endpoint", () => {
  const base = {
    MANAGEMENT_API_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54392/postgres",
    MANAGEMENT_API_AUTH_PUBLISHABLE_KEY: "sb_publishable_local",
    MANAGEMENT_API_ALLOWED_ORIGINS: "http://localhost:5173",
  };

  it("accepts http on loopback when the environment is local", () => {
    expect(() =>
      loadManagementConfig({
        ...base,
        KITLUY_ENV: "local",
        MANAGEMENT_API_AUTH_URL: "http://127.0.0.1:54391",
      }),
    ).not.toThrow();
  });

  it("REFUSES http on loopback when the environment is not local", () => {
    for (const environment of ["development", "staging", "pilot", "production"]) {
      expect(() =>
        loadManagementConfig({
          ...base,
          KITLUY_ENV: environment,
          MANAGEMENT_API_AUTH_URL: "http://127.0.0.1:54391",
        }),
      ).toThrow();
    }
  });

  it("REFUSES a remote http endpoint even in local", () => {
    // The exemption is about there being no network, not about convenience.
    for (const url of [
      "http://auth.example.com",
      "http://10.0.0.5:54391",
      "http://127.0.0.1.example.com",
      "http://evil.test/127.0.0.1",
    ]) {
      expect(() =>
        loadManagementConfig({ ...base, KITLUY_ENV: "local", MANAGEMENT_API_AUTH_URL: url }),
      ).toThrow();
    }
  });

  it("still requires https with no path for every hosted endpoint", () => {
    expect(() =>
      loadManagementConfig({
        ...base,
        KITLUY_ENV: "production",
        MANAGEMENT_API_AUTH_URL: "https://project.supabase.co/auth",
      }),
    ).toThrow();
  });
});
