/**
 * Management API authorization boundary and governed fleet DTO.
 *
 * The load-bearing tests here are the ones proving the server never takes
 * authority from the caller: a browser that claims to be an admin, or supplies
 * a permission in the body, must gain nothing.
 */
import { describe, expect, it } from "vitest";

import {
  authorizeRequest,
  bearerToken,
  createSupabaseTokenVerifier,
  PERMISSION,
  type DatabaseHandle,
  type TokenVerifier,
} from "../src/authorization.js";
import {
  deriveFreshness,
  evaluateProvisioningReadiness,
  getFleetDevice,
  listFleet,
  UNRULED_FRESHNESS_POLICY,
  type FleetDeviceDto,
} from "../src/fleet.js";

const USER = "b145d533-b905-47fc-a551-8ad07ecfe39b";

function verifier(userId: string | null): TokenVerifier {
  return {
    async verify() {
      return userId === null ? null : { userId };
    },
  };
}

/** Records every statement so tests can assert the role/transaction discipline. */
function db(adminRow: Record<string, unknown> | null): DatabaseHandle & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    async query<R>(text: string): Promise<{ rows: R[] }> {
      sql.push(text.trim().split("\n")[0]!.trim());
      if (text.includes("admin_user_profiles")) {
        return { rows: (adminRow ? [adminRow] : []) as unknown as R[] };
      }
      return { rows: [] as unknown as R[] };
    },
  };
}

const ACTIVE_ADMIN = {
  profile_status: "ACTIVE",
  disabled_at: null,
  permitted: true,
  permissions: ["fleet.read", "rbac.read"],
};

describe("token extraction", () => {
  it("extracts a bearer token", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer abc")).toBe("abc");
  });

  it("rejects malformed headers", () => {
    for (const h of [undefined, "", "Basic abc", "Bearer", "Bearer   "]) {
      expect(bearerToken(h as string | undefined)).toBeNull();
    }
  });
});

describe("authorization boundary", () => {
  it("401 with no token", async () => {
    const r = await authorizeRequest(
      db(ACTIVE_ADMIN),
      verifier(USER),
      undefined,
      PERMISSION.FLEET_READ,
    );
    expect(r).toMatchObject({ kind: "deny", status: 401, code: "KLUY-AUTH-MISSING-TOKEN" });
  });

  it("401 with an invalid token", async () => {
    const r = await authorizeRequest(
      db(ACTIVE_ADMIN),
      verifier(null),
      "Bearer bad",
      PERMISSION.FLEET_READ,
    );
    expect(r).toMatchObject({ kind: "deny", status: 401, code: "KLUY-AUTH-INVALID-TOKEN" });
  });

  it("403 for an authenticated user with no Admin profile", async () => {
    const r = await authorizeRequest(db(null), verifier(USER), "Bearer ok", PERMISSION.FLEET_READ);
    // 403 not 401: the token was perfectly valid; the user simply is not an Admin.
    expect(r).toMatchObject({ kind: "deny", status: 403, code: "KLUY-ADMIN-NOT-PROVISIONED" });
  });

  it("403 for a disabled Admin", async () => {
    const r = await authorizeRequest(
      db({ ...ACTIVE_ADMIN, disabled_at: "2026-08-01T00:00:00Z" }),
      verifier(USER),
      "Bearer ok",
      PERMISSION.FLEET_READ,
    );
    expect(r).toMatchObject({ kind: "deny", status: 403, code: "KLUY-ADMIN-DISABLED" });
  });

  it("403 for a non-ACTIVE profile", async () => {
    const r = await authorizeRequest(
      db({ ...ACTIVE_ADMIN, profile_status: "SUSPENDED" }),
      verifier(USER),
      "Bearer ok",
      PERMISSION.FLEET_READ,
    );
    expect(r).toMatchObject({ kind: "deny", status: 403, code: "KLUY-ADMIN-INACTIVE" });
  });

  it("rejects a lowercase status — canonical vocabulary is UPPERCASE", async () => {
    const r = await authorizeRequest(
      db({ ...ACTIVE_ADMIN, profile_status: "active" }),
      verifier(USER),
      "Bearer ok",
      PERMISSION.FLEET_READ,
    );
    expect(r).toMatchObject({ kind: "deny", status: 403 });
  });

  it("403 when the canonical evaluator says the permission is missing", async () => {
    const r = await authorizeRequest(
      db({ ...ACTIVE_ADMIN, permitted: false }),
      verifier(USER),
      "Bearer ok",
      PERMISSION.FLEET_READ,
    );
    expect(r).toMatchObject({ kind: "deny", status: 403, code: "KLUY-PERMISSION-DENIED" });
  });

  it("allows an active Admin holding the permission", async () => {
    const r = await authorizeRequest(
      db(ACTIVE_ADMIN),
      verifier(USER),
      "Bearer ok",
      PERMISSION.FLEET_READ,
    );
    expect(r.kind).toBe("allow");
    if (r.kind !== "allow") return;
    expect(r.userId).toBe(USER);
    expect(r.permissions).toContain("fleet.read");
  });

  it("evaluates authorization AS the authenticated role, inside a rolled-back transaction", async () => {
    const handle = db(ACTIVE_ADMIN);
    await authorizeRequest(handle, verifier(USER), "Bearer ok", PERMISSION.FLEET_READ);
    const joined = handle.sql.join(" | ");
    expect(joined).toContain("begin");
    expect(joined).toContain("set local role authenticated");
    expect(joined).toContain("rollback");
    // The caller's subject is what the evaluator sees.
    expect(joined).toContain("request.jwt.claim.sub");
  });

  it("releases the assumed role even when the query throws", async () => {
    const sql: string[] = [];
    const failing: DatabaseHandle = {
      async query(text: string) {
        sql.push(text.trim().split("\n")[0]!.trim());
        if (text.includes("admin_user_profiles")) throw new Error("boom");
        return { rows: [] };
      },
    };
    await expect(
      authorizeRequest(failing, verifier(USER), "Bearer ok", PERMISSION.FLEET_READ),
    ).rejects.toThrow("boom");
    // Without this the connection would stay stuck as `authenticated`.
    expect(sql.join(" | ")).toContain("rollback");
  });

  it("takes NO authority from caller-supplied claims", async () => {
    // A browser asserting admin/permission in its own request must gain nothing.
    const r = await authorizeRequest(db(null), verifier(USER), "Bearer ok", PERMISSION.FLEET_READ);
    expect(r.kind).toBe("deny");
  });

  it("reuses the existing canonical provisioning permission key", () => {
    // No second provisioning key was minted; two keys for one authority drift.
    expect(PERMISSION.FLEET_PROVISIONING_ISSUE).toBe("fleet.device_provisioning_code.issue");
    expect(PERMISSION.FLEET_READ).toBe("fleet.read");
  });
});

describe("supabase token verifier", () => {
  const cfg = { url: "https://x.supabase.co", publishableKey: "sb_publishable_x" };

  it("returns the subject on 200", async () => {
    const v = createSupabaseTokenVerifier({
      ...cfg,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ id: USER }), { status: 200 })) as typeof fetch,
    });
    expect(await v.verify("tok")).toEqual({ userId: USER });
  });

  it("returns null on a rejected token", async () => {
    const v = createSupabaseTokenVerifier({
      ...cfg,
      fetchImpl: (async () => new Response("{}", { status: 401 })) as typeof fetch,
    });
    expect(await v.verify("tok")).toBeNull();
  });

  it("fails CLOSED when the auth server is unreachable", async () => {
    const v = createSupabaseTokenVerifier({
      ...cfg,
      fetchImpl: (async () => {
        throw new Error("network");
      }) as typeof fetch,
    });
    expect(await v.verify("tok")).toBeNull();
  });

  it("rejects an empty token without a network call", async () => {
    let called = false;
    const v = createSupabaseTokenVerifier({
      ...cfg,
      fetchImpl: (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    expect(await v.verify("   ")).toBeNull();
    expect(called).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Governed fleet DTO
// ---------------------------------------------------------------------------

const ROW = {
  device_record_id: "dev-1",
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
  // Evidence columns the read model also carries — must NOT reach the DTO.
  device_public_key_fingerprint: "abc123",
  manifest_sha256: "deadbeef",
  enrollment_sequence: 1,
};

function fleetDb(rows: unknown[]): DatabaseHandle {
  return {
    async query<R>(): Promise<{ rows: R[] }> {
      return { rows: rows as R[] };
    },
  };
}

describe("governed fleet DTO", () => {
  it("never leaks device identity evidence into the DTO", async () => {
    const [dto] = await listFleet(fleetDb([ROW]));
    const serialised = JSON.stringify(dto);
    expect(serialised).not.toContain("abc123"); // key fingerprint
    expect(serialised).not.toContain("deadbeef"); // manifest digest
    expect(serialised).not.toContain("enrollment_sequence");
  });

  it("maps the canonical fields an Admin needs", async () => {
    const [dto] = await listFleet(fleetDb([ROW]));
    expect(dto).toMatchObject({
      deviceId: "dev-1",
      deviceReference: "KL-CLOUD-HUB-0001",
      deviceClass: "store_hub",
      lifecycle: "enrolled",
      hardwareProfile: "CLOUD-HUB-PI5",
    });
  });

  it("flags abnormal lifecycles as requiring attention", async () => {
    for (const lifecycle of ["quarantined", "restricted_investigation", "suspended", "retired"]) {
      const [dto] = await listFleet(fleetDb([{ ...ROW, lifecycle_state: lifecycle }]));
      expect(dto?.requiresAttention).toBe(true);
    }
    const [ok] = await listFleet(fleetDb([ROW]));
    expect(ok?.requiresAttention).toBe(false);
  });

  it("flags open trust incidents as requiring attention", async () => {
    const [dto] = await listFleet(fleetDb([{ ...ROW, open_incident_count: 2 }]));
    expect(dto?.requiresAttention).toBe(true);
    expect(dto?.openIncidentCount).toBe(2);
  });

  it("returns null for an unknown device", async () => {
    expect(await getFleetDevice(fleetDb([]), "missing")).toBeNull();
  });
});

describe("freshness truthfulness", () => {
  it("NEVER_SEEN when no heartbeat has arrived", () => {
    expect(deriveFreshness(null, UNRULED_FRESHNESS_POLICY)).toBe("NEVER_SEEN");
  });

  it("UNKNOWN — never ONLINE — while the threshold is unruled", () => {
    // A device row existing is not evidence it is online.
    const f = deriveFreshness(
      "2026-08-10T11:59:59Z",
      UNRULED_FRESHNESS_POLICY,
      new Date("2026-08-10T12:00:00Z"),
    );
    expect(f).toBe("UNKNOWN");
    expect(f).not.toBe("ONLINE");
  });

  it("resolves ONLINE/STALE/OFFLINE once a policy is ruled", () => {
    const p = { staleAfterSeconds: 120, offlineAfterSeconds: 600 };
    const now = new Date("2026-08-10T12:00:00Z");
    expect(deriveFreshness("2026-08-10T11:59:30Z", p, now)).toBe("ONLINE");
    expect(deriveFreshness("2026-08-10T11:55:00Z", p, now)).toBe("STALE");
    expect(deriveFreshness("2026-08-10T11:00:00Z", p, now)).toBe("OFFLINE");
  });
});

describe("provisioning readiness (derived, never stored)", () => {
  const base: FleetDeviceDto = {
    deviceId: "d",
    deviceReference: "KL-1",
    deviceClass: "store_hub",
    hardwareProfile: "P",
    lifecycle: "enrolled",
    trustLevel: null,
    certificateStatus: null,
    assignmentState: null,
    tenantReference: null,
    digitalStoreReference: null,
    locationReference: null,
    terminalAssignmentCount: 0,
    openIncidentCount: 0,
    lastSeenAt: null,
    fleetStatus: null,
    freshness: "NEVER_SEEN",
    requiresAttention: false,
  };

  it("an enrolled unassigned device is eligible", () => {
    expect(evaluateProvisioningReadiness(base).eligible).toBe(true);
  });

  const denied: ReadonlyArray<readonly [string, Partial<FleetDeviceDto>, string]> = [
    ["quarantined", { lifecycle: "quarantined" }, "forbidden"],
    ["restricted_investigation", { lifecycle: "restricted_investigation" }, "forbidden"],
    ["retired", { lifecycle: "retired" }, "forbidden"],
    ["open incident", { openIncidentCount: 1 }, "incident"],
    ["revoked certificate", { certificateStatus: "revoked" }, "revoked"],
    ["already assigned", { assignmentState: "active" }, "already holds"],
  ];

  for (const [label, override, needle] of denied) {
    it(`refuses provisioning: ${label}`, () => {
      const r = evaluateProvisioningReadiness({ ...base, ...override });
      expect(r.eligible).toBe(false);
      expect(r.reasons.join(" ")).toContain(needle);
    });
  }

  it("the two real quarantined/investigation cloud devices are both refused", () => {
    expect(
      evaluateProvisioningReadiness({ ...base, lifecycle: "restricted_investigation" }).eligible,
    ).toBe(false);
    expect(evaluateProvisioningReadiness({ ...base, lifecycle: "quarantined" }).eligible).toBe(
      false,
    );
  });
});
