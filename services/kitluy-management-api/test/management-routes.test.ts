/**
 * Governed management routes.
 *
 * The load-bearing tests here are the ones proving a route cannot be reached
 * without the database having decided the caller may reach it, and that a
 * denial never becomes a data leak — not the happy-path shapes.
 */
import { describe, expect, it } from "vitest";

import type { DatabaseHandle, TokenVerifier } from "../src/authorization.js";
import {
  handleManagementRequest,
  isManagementPath,
  MANAGEMENT_PREFIX,
  resolveCorsHeaders,
  type ManagementRouterDependencies,
} from "../src/http.js";

const USER = "b145d533-b905-47fc-a551-8ad07ecfe39b";
const DEVICE_ID = "11111111-2222-3333-4444-555555555555";

function verifier(userId: string | null): TokenVerifier {
  return {
    async verify() {
      return userId === null ? null : { userId };
    },
  };
}

const ACTIVE_ADMIN = {
  profile_status: "ACTIVE",
  disabled_at: null,
  permitted: true,
  permissions: ["fleet.read", "fleet.device_provisioning_code.issue"],
};

const ROW = {
  device_record_id: DEVICE_ID,
  asset_tag: "KL-CLOUD-HUB-0001",
  device_class: "store_hub",
  lifecycle_state: "enrolled",
  hardware_trust_level: "development_software",
  certificate_status: null,
  profile_key: "CLOUD-HUB-PI5",
  assignment_state: null,
  tenant_id: null,
  digital_store_id: null,
  store_location_id: null,
  terminal_assignment_count: 0,
  open_incident_count: 0,
  last_observed_at: null,
  fleet_status: "enrolled",
  // Evidence columns the read model carries — must never reach a browser.
  device_public_key_fingerprint: "abc123",
  manifest_sha256: "deadbeef",
  enrollment_sequence: 7,
};

/** Records every statement, so a test can prove what was (not) read. */
function db(
  adminRow: Record<string, unknown> | null,
  fleetRows: readonly Record<string, unknown>[] = [ROW],
): DatabaseHandle & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async query<R>(text: string): Promise<{ rows: R[] }> {
      sql.push(text.trim().split("\n")[0]!.trim());
      if (text.includes("admin_user_profiles")) {
        return { rows: (adminRow ? [adminRow] : []) as unknown as R[] };
      }
      if (text.includes("device_fleet_status")) {
        return { rows: fleetRows as unknown as R[] };
      }
      return { rows: [] as unknown as R[] };
    },
  };
}

function deps(handle: DatabaseHandle, userId: string | null = USER): ManagementRouterDependencies {
  return { db: handle, verifier: verifier(userId), now: () => new Date("2026-08-10T12:00:00Z") };
}

const GET = (url: string) => ({ method: "GET", url, authorization: "Bearer ok" });

/**
 * A request with NO Authorization header.
 *
 * Separate from `GET` on purpose: a default parameter is re-applied when the
 * caller passes `undefined` explicitly, so `GET(url, undefined)` would quietly
 * send a token and every "401 without a token" test would assert nothing.
 */
const ANONYMOUS_GET = (url: string) => ({ method: "GET", url, authorization: undefined });

describe("management path matching", () => {
  it("claims only its own versioned prefix", () => {
    expect(isManagementPath("/management/v1/me")).toBe(true);
    expect(isManagementPath("/management/v1/devices?limit=5")).toBe(true);
    expect(isManagementPath("/health/live")).toBe(false);
    // A near-miss prefix must not be captured — /management/v2 is not this API.
    expect(isManagementPath("/management/v2/me")).toBe(false);
    expect(isManagementPath("/management/v1x/me")).toBe(false);
  });

  it("names the canonical versioned prefix", () => {
    expect(MANAGEMENT_PREFIX).toBe("/management/v1");
  });
});

describe("GET /management/v1/me", () => {
  it("401 without a token", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      ANONYMOUS_GET(`${MANAGEMENT_PREFIX}/me`),
    );
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED", details: { reason: "KLUY-AUTH-MISSING-TOKEN" } },
    });
  });

  it("401 with a token the auth server rejects", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN), null),
      GET(`${MANAGEMENT_PREFIX}/me`),
    );
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: { details: { reason: "KLUY-AUTH-INVALID-TOKEN" } },
    });
  });

  it("403 for an authenticated non-Admin, with a reason the portal can act on", async () => {
    const res = await handleManagementRequest(deps(db(null)), GET(`${MANAGEMENT_PREFIX}/me`));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: {
        code: "SCOPE_PERMISSION_DENIED",
        details: { reason: "KLUY-ADMIN-NOT-PROVISIONED" },
      },
    });
  });

  it("403 for a disabled Admin", async () => {
    const res = await handleManagementRequest(
      deps(db({ ...ACTIVE_ADMIN, disabled_at: "2026-08-01T00:00:00Z" })),
      GET(`${MANAGEMENT_PREFIX}/me`),
    );
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { details: { reason: "KLUY-ADMIN-DISABLED" } } });
  });

  it("200 with the caller's canonical permissions", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/me`),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: USER });
    expect((res.body as { permissions: string[] }).permissions).toContain("fleet.read");
  });

  it("requires no specific permission — an Admin with none is still a usable session", async () => {
    // `permitted` is true because the route asks for no permission at all.
    const res = await handleManagementRequest(
      deps(db({ ...ACTIVE_ADMIN, permissions: [] })),
      GET(`${MANAGEMENT_PREFIX}/me`),
    );
    expect(res.status).toBe(200);
    expect((res.body as { permissions: string[] }).permissions).toEqual([]);
  });
});

describe("GET /management/v1/devices", () => {
  it("403 when the canonical evaluator withholds fleet.read", async () => {
    const handle = db({ ...ACTIVE_ADMIN, permitted: false });
    const res = await handleManagementRequest(deps(handle), GET(`${MANAGEMENT_PREFIX}/devices`));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { details: { reason: "KLUY-PERMISSION-DENIED" } } });
    // The denial must be a denial, not a slow leak: no fleet row was read.
    expect(handle.sql.join(" | ")).not.toContain("device_fleet_status");
  });

  it("never names the permission that was missing", async () => {
    const res = await handleManagementRequest(
      deps(db({ ...ACTIVE_ADMIN, permitted: false })),
      GET(`${MANAGEMENT_PREFIX}/devices`),
    );
    // Registry §4 collapses absent scope and absent permission into one code so
    // responses cannot be used to map the permission model.
    expect(JSON.stringify(res.body)).not.toContain("fleet.read");
  });

  it("401 without a token, and reads nothing", async () => {
    const handle = db(ACTIVE_ADMIN);
    const res = await handleManagementRequest(
      deps(handle),
      ANONYMOUS_GET(`${MANAGEMENT_PREFIX}/devices`),
    );
    expect(res.status).toBe(401);
    expect(handle.sql.join(" | ")).not.toContain("device_fleet_status");
  });

  it("200 returns the governed DTO and leaks no identity evidence", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/devices`),
    );
    expect(res.status).toBe(200);
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain("abc123");
    expect(serialised).not.toContain("deadbeef");
    expect(serialised).not.toContain("enrollment_sequence");
  });

  it("reports the page cap honestly instead of implying the page is the fleet", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/devices`),
    );
    expect(res.body).toMatchObject({ count: 1, limit: 200, truncated: false });
  });

  it("declares that the freshness policy is unruled", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/devices`),
    );
    expect(res.body).toMatchObject({ freshnessPolicyRuled: false });
  });

  it("reports real liveness once a policy is configured", async () => {
    const now = new Date("2026-08-10T12:00:00Z");
    const ago = (s: number): string => new Date(now.getTime() - s * 1000).toISOString();
    const ruled = { staleAfterSeconds: 90, offlineAfterSeconds: 300 };

    for (const [seconds, expected] of [
      [10, "ONLINE"],
      [120, "STALE"],
      [600, "OFFLINE"],
    ] as const) {
      const res = await handleManagementRequest(
        {
          db: db(ACTIVE_ADMIN, [{ ...ROW, last_observed_at: ago(seconds) }]),
          verifier: verifier(USER),
          now: () => now,
          freshnessPolicy: ruled,
        },
        GET(`${MANAGEMENT_PREFIX}/devices`),
      );
      const body = res.body as { devices: { freshness: string }[]; freshnessPolicyRuled: boolean };
      expect(body.devices[0]?.freshness).toBe(expected);
      expect(body.freshnessPolicyRuled).toBe(true);
    }
  });

  it("never reports ONLINE while the threshold is unruled", async () => {
    const seen = { ...ROW, last_observed_at: "2026-08-10T11:59:59Z" };
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN, [seen])),
      GET(`${MANAGEMENT_PREFIX}/devices`),
    );
    const [device] = (res.body as { devices: { freshness: string }[] }).devices;
    expect(device?.freshness).toBe("UNKNOWN");
  });

  it("ignores a query string rather than treating it as a route", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/devices?anything=1`),
    );
    expect(res.status).toBe(200);
  });
});

describe("GET /management/v1/devices/:id", () => {
  it("authorizes BEFORE validating the identifier", async () => {
    // Otherwise an unauthenticated caller learns which identifiers are
    // well-formed — a free oracle over the identifier space.
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      ANONYMOUS_GET(`${MANAGEMENT_PREFIX}/devices/not-a-uuid`),
    );
    expect(res.status).toBe(401);
  });

  it("404 for a malformed identifier from an authorized caller", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/devices/not-a-uuid`),
    );
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: "RESOURCE_NOT_FOUND" } });
  });

  it("404 for an unknown device", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN, [])),
      GET(`${MANAGEMENT_PREFIX}/devices/${DEVICE_ID}`),
    );
    expect(res.status).toBe(404);
  });

  it("200 with derived provisioning readiness", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/devices/${DEVICE_ID}`),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      device: { deviceId: DEVICE_ID, lifecycle: "enrolled" },
      provisioning: { eligible: true },
    });
  });

  it("refuses provisioning for the real quarantined and investigated devices", async () => {
    for (const lifecycle of ["quarantined", "restricted_investigation"]) {
      const res = await handleManagementRequest(
        deps(db(ACTIVE_ADMIN, [{ ...ROW, lifecycle_state: lifecycle }])),
        GET(`${MANAGEMENT_PREFIX}/devices/${DEVICE_ID}`),
      );
      const body = res.body as {
        device: { requiresAttention: boolean };
        provisioning: { eligible: boolean; reasons: string[] };
      };
      expect(body.provisioning.eligible).toBe(false);
      expect(body.device.requiresAttention).toBe(true);
      expect(body.provisioning.reasons.join(" ")).toContain(lifecycle);
    }
  });

  it("403 without fleet.read, and reads no device", async () => {
    const handle = db({ ...ACTIVE_ADMIN, permitted: false });
    const res = await handleManagementRequest(
      deps(handle),
      GET(`${MANAGEMENT_PREFIX}/devices/${DEVICE_ID}`),
    );
    expect(res.status).toBe(403);
    expect(handle.sql.join(" | ")).not.toContain("device_fleet_status");
  });
});

describe("route surface", () => {
  it("404 for an unknown management route", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/nothing-here`),
    );
    expect(res.status).toBe(404);
  });

  it("405 for any non-GET — this slice issues no provisioning code", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await handleManagementRequest(deps(db(ACTIVE_ADMIN)), {
        method,
        url: `${MANAGEMENT_PREFIX}/devices`,
        authorization: "Bearer ok",
      });
      expect(res.status).toBe(405);
    }
  });

  it("tolerates a trailing slash", async () => {
    const res = await handleManagementRequest(
      deps(db(ACTIVE_ADMIN)),
      GET(`${MANAGEMENT_PREFIX}/devices/`),
    );
    expect(res.status).toBe(200);
  });
});

describe("cross-origin policy", () => {
  const allowed = ["http://localhost:5173"];

  it("echoes only an allowlisted origin", () => {
    const headers = resolveCorsHeaders("http://localhost:5173", allowed);
    expect(headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(headers["access-control-allow-headers"]).toContain("authorization");
  });

  it("gives an unknown origin nothing — never a wildcard", () => {
    expect(resolveCorsHeaders("https://evil.example", allowed)).toEqual({});
    expect(resolveCorsHeaders(undefined, allowed)).toEqual({});
    // A wildcard would let any page a signed-in Admin visits script this API.
    expect(Object.values(resolveCorsHeaders("http://localhost:5173", allowed))).not.toContain("*");
  });

  it("allows nothing when no origin is configured", () => {
    expect(resolveCorsHeaders("http://localhost:5173", [])).toEqual({});
  });
});
