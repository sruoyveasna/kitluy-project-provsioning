/**
 * Digital Store creation and listing (group 0215).
 *
 * Protected here: authority is decided FIRST and for the right key; the actor
 * is the token's subject and never the body; unknown top-level or nested
 * fields are 422; the door's parameters are exactly what the route validated;
 * a governed refusal is 422 with its code, an unknown Tenant 404, an unwired
 * deployment 503; and the options route tells the client whether four-eyes
 * applies instead of the client guessing.
 */
import { describe, expect, it } from "vitest";

import type { DatabaseHandle, TokenVerifier } from "../src/authorization.js";
import {
  handleManagementRequest,
  MANAGEMENT_PREFIX,
  type ManagementRouterDependencies,
} from "../src/http.js";

const USER = "11111111-1111-4111-8111-111111111111";
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "d33b560e-c233-4a04-b5d6-973085ca6612";
const AUDIT = "c7d2dbd4-64d3-4a34-964e-6f42c587e216";

const verifier: TokenVerifier = {
  verify: (token) => Promise.resolve(token === "bad" ? null : { userId: USER }),
};

function db(
  permitted = true,
  permissions: string[] = ["store.digital_store.create", "partners.read"],
): DatabaseHandle & { sql: string[] } {
  const sql: string[] = [];
  return {
    sql,
    query: <R>(text: string) => {
      sql.push(text.trim().split("\n")[0]!.trim());
      if (text.includes("admin_user_profiles")) {
        return Promise.resolve({
          rows: [
            { profile_status: "ACTIVE", disabled_at: null, permitted, permissions },
          ] as unknown as R[],
        });
      }
      if (text.includes("from kitluy_core.digital_stores ds")) {
        return Promise.resolve({
          rows: [
            {
              id: STORE,
              store_code: "DEMO-LAUNDRY-001",
              name: "Demo Laundry",
              primary_vertical_code: "LAUNDRY",
              status: "DRAFT",
              tenant_id: TENANT,
              tenant_reference: "DEMO-KH-001 — Demo Partner",
              created_at: new Date("2026-09-04T09:00:00Z"),
              locations: [],
            },
          ] as unknown as R[],
        });
      }
      if (text.includes("from kitluy_core.tenants t")) {
        return Promise.resolve({
          rows: [
            {
              id: TENANT,
              tenant_code: "DEMO-KH-001",
              display_name: "Demo Partner",
              status: "ACTIVE",
              verification_status: "APPROVED",
              partner_staff_count: 1,
            },
          ] as unknown as R[],
        });
      }
      if (text.includes("from kitluy_core.reference_values rv")) {
        return Promise.resolve({
          rows: [
            { value_code: "LAUNDRY", status: "ACTIVE", label_km: "បោកអ៊ុត", label_en: "Laundry" },
            { value_code: "GROCERY", status: "ROADMAP", label_km: null, label_en: "Grocery" },
          ] as unknown as R[],
        });
      }
      return Promise.resolve({ rows: [] as unknown as R[] });
    },
  };
}

function stores(fail?: string) {
  const calls: unknown[][] = [];
  return {
    calls,
    deps: {
      pool: {
        connect: () =>
          Promise.resolve({
            query: (sql: string, params?: unknown[]) => {
              if (sql.includes("create_digital_store_v1")) {
                calls.push(params ?? []);
                if (fail !== undefined) return Promise.reject(new Error(fail));
                return Promise.resolve({
                  rows: [
                    {
                      result: {
                        outcome: "CREATED",
                        digital_store_id: STORE,
                        store_code: "NEW-STORE",
                        name: "New Store",
                        primary_vertical_code: "LAUNDRY",
                        status: "DRAFT",
                        store_location_id: null,
                        location_code: null,
                        partner_staff_granted: 1,
                        audit_event_id: AUDIT,
                      },
                    },
                  ],
                });
              }
              return Promise.resolve({ rows: [] });
            },
            release: () => undefined,
          }),
      },
    },
  };
}

function deps(handle: DatabaseHandle, s?: ReturnType<typeof stores>): ManagementRouterDependencies {
  return {
    db: handle,
    verifier,
    environment: "development",
    now: () => new Date("2026-09-04T10:00:00Z"),
    ...(s === undefined
      ? {}
      : { stores: s.deps as unknown as ManagementRouterDependencies["stores"] }),
  };
}

const post = (body: unknown, d: ManagementRouterDependencies, token = "tok") =>
  handleManagementRequest(d, {
    method: "POST",
    url: `${MANAGEMENT_PREFIX}/digital-stores`,
    authorization: token === "" ? undefined : `Bearer ${token}`,
    body: JSON.stringify(body),
  });
const get = (path: string, d: ManagementRouterDependencies) =>
  handleManagementRequest(d, {
    method: "GET",
    url: `${MANAGEMENT_PREFIX}${path}`,
    authorization: "Bearer tok",
  });

const create = {
  tenantId: TENANT,
  storeCode: "new-store",
  name: "New Store",
  primaryVerticalCode: "laundry",
  reason: "onboarding the demo partner",
};

describe("POST /management/v1/digital-stores", () => {
  it("201 with the audit id; the actor is the token's subject; booleans and blanks normalised", async () => {
    const s = stores();
    const res = await post({ ...create, grantExistingPartnerStaff: true }, deps(db(), s));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      digitalStoreId: STORE,
      auditEventId: AUDIT,
      status: "DRAFT",
      partnerStaffGranted: 1,
    });
    expect(String((res.body as { detail: string }).detail)).toContain("DRAFT");
    expect(s.calls[0]).toEqual([
      TENANT,
      "new-store",
      "New Store",
      "laundry",
      null,
      USER,
      "onboarding the demo partner",
      "development",
      true,
      null,
    ]);
  });

  it("passes the first Location as the door's jsonb, without blank optional fields", async () => {
    const s = stores();
    await post(
      { ...create, firstLocation: { locationCode: "bkk1", name: "BKK1", city: "  " } },
      deps(db(), s),
    );
    expect(JSON.parse(String(s.calls[0]?.[4]))).toEqual({ location_code: "bkk1", name: "BKK1" });
  });

  it("401 / 403 before any argument is read, and the door is never called", async () => {
    const s = stores();
    expect((await post(create, deps(db(), s), "")).status).toBe(401);
    expect((await post(create, deps(db(), s), "bad")).status).toBe(401);
    expect((await post(create, deps(db(false), s))).status).toBe(403);
    expect((await post({ nonsense: 1 }, deps(db(false), s))).status).toBe(403);
    expect(s.calls).toHaveLength(0);
  });

  it("422 for an unknown field, a nested unknown field, a bad tenant id, a blank reason, a non-boolean flag", async () => {
    const s = stores();
    const d = deps(db(), s);
    for (const body of [
      { ...create, actorUserId: USER },
      { ...create, firstLocation: { locationCode: "A1", name: "x", postalCode: "1" } },
      { ...create, tenantId: "nope" },
      { ...create, reason: "  " },
      { ...create, grantExistingPartnerStaff: "yes" },
      { ...create, storeCode: "a" },
    ]) {
      expect((await post(body, d)).status).toBe(422);
    }
    expect(s.calls).toHaveLength(0);
  });

  it("maps a governed refusal to 422 with its code, and an unknown Tenant to 404", async () => {
    const taken = await post(
      create,
      deps(
        db(),
        stores("KLUY-STORE-CODE-TAKEN: this Tenant already has a Store with code NEW-STORE"),
      ),
    );
    expect(taken.status).toBe(422);
    expect(JSON.stringify(taken.body)).toContain("KLUY-STORE-CODE-TAKEN");
    expect(JSON.stringify(taken.body)).not.toContain("NEW-STORE");
    const noTenant = await post(create, deps(db(), stores("KLUY-STORE-NO-TENANT: no such Tenant")));
    expect(noTenant.status).toBe(404);
  });

  it("503, never 404, when Store creation is not wired", async () => {
    expect((await post(create, deps(db()))).status).toBe(503);
  });
});

describe("GET /management/v1/digital-stores and /options", () => {
  it("lists Stores with the Tenant in words for partners.read", async () => {
    const res = await get("/digital-stores", deps(db()));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      count: 1,
      stores: [{ storeCode: "DEMO-LAUNDRY-001", tenantReference: "DEMO-KH-001 — Demo Partner" }],
    });
  });

  it("refuses the list without partners.read", async () => {
    expect((await get("/digital-stores", deps(db(false)))).status).toBe(403);
  });

  it("options carry tenants, the vertical registry verbatim, and the four-eyes switch from the server", async () => {
    const res = await get("/digital-stores/options", deps(db()));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fourEyesRequired: false,
      tenants: [
        { tenantCode: "DEMO-KH-001", partnerStaffCount: 1, partnerVerificationStatus: "APPROVED" },
      ],
      verticals: [
        { code: "LAUNDRY", status: "ACTIVE" },
        { code: "GROCERY", status: "ROADMAP" },
      ],
    });
    const pilot = await get("/digital-stores/options", { ...deps(db()), environment: "pilot" });
    expect((pilot.body as { fourEyesRequired: boolean }).fourEyesRequired).toBe(true);
  });
});
