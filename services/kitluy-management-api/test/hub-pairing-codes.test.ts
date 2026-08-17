/**
 * `POST /management/v1/hub-pairing-codes` — the Partner issuance surface.
 *
 * ===========================================================================
 * THE ASSERTION THAT MATTERS MOST
 * ===========================================================================
 * A Partner may issue a pairing code for a Hub in THEIR Store and must be refused
 * for anyone else's. That is not a detail — a pairing code is the sole authority
 * to attach a Store Hub to a Digital Store, so a scope hole here would let one
 * Partner take over another Partner's Hub.
 *
 * It needs its own test because `kitluy_auth.has_permission` does NOT enforce it.
 * Its signature takes `(key, resource_type, resource_id, environment)` and its
 * body uses only `environment` — `scope_type` and `scope_id` appear nowhere. So
 * the scope is enforced by `authorizePartnerRequest` asking a second question
 * (`= any (current_digital_store_ids())`), and this suite is what proves the
 * question is actually asked.
 *
 * ===========================================================================
 * WHAT ELSE IS PROTECTED
 * ===========================================================================
 *   * The caller cannot name the Tenant or the TTL. Both are server-decided, and
 *     a caller-supplied Tenant is how a cross-Tenant attach would be attempted.
 *   * Unknown fields are refused, not ignored.
 *   * An unconfigured deployment answers 503, never 404 — a Partner seeing 404
 *     would conclude the feature does not exist.
 *   * The code is returned ONCE, with `showOnce` stated in the body, because only
 *     its digest is stored and no endpoint can ever return it again.
 */
import { describe, expect, it } from "vitest";

import { handleManagementRequest, type ManagementRouterDependencies } from "../src/http.js";
import type { DatabaseHandle, TokenVerifier } from "../src/authorization.js";

const STORE = "44444444-4444-4444-8444-444444444444";
const OTHER_STORE = "99999999-9999-4999-8999-999999999999";
const LOCATION = "55555555-5555-4555-8555-555555555555";
const DEVICE = "11111111-1111-4111-8111-111111111111";
const USER = "77777777-7777-4777-8777-777777777777";

const verifier: TokenVerifier = { verify: () => Promise.resolve({ userId: USER }) };

/**
 * A database stub that answers the authorization query the way a real actor
 * would, given a set of Stores they are assigned to.
 *
 * It matches on the SQL's shape rather than replaying a script, so a change to
 * which questions the authorizer asks shows up here as a failure rather than a
 * silently-passing stub.
 */
function db(assignedStores: readonly string[], permitted = true): DatabaseHandle {
  return {
    query: <R>(sql: string, params?: readonly unknown[]) => {
      if (sql.includes("has_permission")) {
        const requestedStore = params?.[2];
        return Promise.resolve({
          rows: [
            {
              permitted,
              digital_store_ids: assignedStores,
              // The real check. A stub that returned `true` unconditionally would
              // make the scope test vacuous.
              in_scope: assignedStores.includes(String(requestedStore)),
            },
          ] as unknown as R[],
        });
      }
      return Promise.resolve({ rows: [] as R[] });
    },
  };
}

/** Records what the issuance layer was asked to do, so the route's inputs are visible. */
function issuance(overrides: { fail?: string } = {}) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    deps: {
      pool: {
        connect: () =>
          Promise.resolve({
            query: (sql: string) => {
              if (sql.includes("hub_claim_code_alphabet_v1")) {
                return Promise.resolve({
                  rows: [{ alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ" }],
                });
              }
              if (sql.includes("open_hub_pairing_session_v1")) {
                if (overrides.fail !== undefined) throw new Error(overrides.fail);
                return Promise.resolve({
                  rows: [{ session_id: "22222222-2222-4222-8222-222222222222" }],
                });
              }
              if (sql.includes("expires_at")) {
                return Promise.resolve({
                  rows: [{ expires_at: new Date("2026-08-13T10:15:00Z") }],
                });
              }
              return Promise.resolve({ rows: [] });
            },
            release: () => undefined,
          }),
        // `resolveStoreScope` goes through the pool directly.
        query: (_sql: string, params?: readonly unknown[]) => {
          calls.push({ scopeLookup: params });
          return Promise.resolve({
            rows: [{ tenant_id: "33333333-3333-4333-8333-333333333333" }],
          });
        },
      },
    },
  };
}

function deps(
  handle: DatabaseHandle,
  iss?: ReturnType<typeof issuance>,
): ManagementRouterDependencies {
  return {
    db: handle,
    verifier,
    environment: "development",
    ...(iss === undefined
      ? {}
      : { issuance: iss.deps as unknown as ManagementRouterDependencies["issuance"] }),
  };
}

// No `deviceRecordId`: a session belongs to the STORE
// (KLD-2026-08-13-HUB-PAIRING-SESSION-001).
const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    digitalStoreId: STORE,
    storeLocationId: LOCATION,
    ...over,
  });

const post = (b: string, d: ManagementRouterDependencies) =>
  handleManagementRequest(d, {
    method: "POST",
    url: "/management/v1/hub-pairing-codes",
    authorization: "Bearer t",
    body: b,
  });

describe("a Partner issues a code for their OWN Store", () => {
  it("issues, and says the code is shown once", async () => {
    const iss = issuance();
    const response = await post(body(), deps(db([STORE]), iss));

    expect(response.status).toBe(201);
    const out = response.body as Record<string, unknown>;
    expect(String(out.code)).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    expect(out.showOnce).toBe(true);
    expect(out.ttlSeconds).toBe(900);
  });

  it("resolves the Tenant from the Store rather than the request", async () => {
    const iss = issuance();
    await post(body(), deps(db([STORE]), iss));

    // The route looked the Store up. A caller-supplied tenant would let someone
    // attempt a cross-Tenant attach.
    expect(iss.calls[0]?.scopeLookup).toEqual([STORE, LOCATION]);
  });
});

describe("the scope binding is real", () => {
  it("REFUSES a Store the actor is not assigned to", async () => {
    const iss = issuance();
    // Holds the permission, assigned only to STORE, asks for OTHER_STORE.
    const response = await post(body({ digitalStoreId: OTHER_STORE }), deps(db([STORE]), iss));

    expect(response.status).toBe(403);
    // And it never reached issuance at all.
    expect(iss.calls).toHaveLength(0);
  });

  it("refuses when the permission is absent even for the right Store", async () => {
    const response = await post(body(), deps(db([STORE], false), issuance()));
    expect(response.status).toBe(403);
  });

  it("gives the same answer for 'wrong Store' and 'no permission'", async () => {
    // Distinguishing them would tell an actor which Stores exist and which
    // permission they are one grant away from.
    const wrongStore = await post(body({ digitalStoreId: OTHER_STORE }), deps(db([STORE])));
    const noPermission = await post(body(), deps(db([STORE], false)));
    expect(wrongStore.status).toBe(noPermission.status);
    expect(wrongStore.body).toEqual(noPermission.body);
  });
});

describe("what the caller may not name", () => {
  it("refuses a caller-supplied tenantId", async () => {
    const response = await post(body({ tenantId: "t" }), deps(db([STORE]), issuance()));
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("tenantId");
  });

  it("refuses a caller-supplied ttl", async () => {
    const response = await post(body({ ttlSeconds: 86400 }), deps(db([STORE]), issuance()));
    expect(response.status).toBe(422);
  });

  it("refuses a malformed uuid", async () => {
    const response = await post(body({ digitalStoreId: "nope" }), deps(db([STORE]), issuance()));
    expect(response.status).toBe(422);
  });

  it("refuses a deviceRecordId outright, so the old per-device shape fails LOUDLY", async () => {
    // Ignoring it would let an integration built against the pre-session contract
    // keep issuing codes that silently mean something else.
    const response = await post(body({ deviceRecordId: DEVICE }), deps(db([STORE]), issuance()));
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain("deviceRecordId");
  });

  it("refuses a non-object body", async () => {
    const response = await post("[]", deps(db([STORE]), issuance()));
    expect(response.status).toBe(422);
  });
});

describe("configuration and method", () => {
  it("fails CLOSED with 503 when issuance is not wired, not 404", async () => {
    const response = await post(body(), deps(db([STORE])));
    expect(response.status).toBe(503);
  });

  it("refuses GET on the issuance route", async () => {
    const response = await handleManagementRequest(deps(db([STORE]), issuance()), {
      method: "GET",
      url: "/management/v1/hub-pairing-codes",
      authorization: "Bearer t",
    });
    expect(response.status).toBe(405);
  });

  it("still refuses POST on the read routes", async () => {
    const response = await handleManagementRequest(deps(db([STORE]), issuance()), {
      method: "POST",
      url: "/management/v1/devices",
      authorization: "Bearer t",
      body: "{}",
    });
    expect(response.status).toBe(405);
  });
});

describe("governed refusals reach the caller as guidance", () => {
  it("reports a mismatched Store and Location in terms the operator can act on", async () => {
    const iss = issuance({
      fail: "KLUY-HUBSESSION-SCOPE-UNKNOWN: that Location does not belong to that Digital Store",
    });
    const response = await post(body(), deps(db([STORE]), iss));

    expect(response.status).toBe(422);
    // Safe to be specific here: the caller is an authenticated human who already
    // holds this Store, so this is guidance, not enumeration.
    expect(JSON.stringify(response.body)).toContain("do not match");
  });

  it("never leaks a SQLSTATE or function name", async () => {
    const iss = issuance({
      fail: "ERROR: 42883 function kitluy_devices.secret_thing() does not exist",
    });
    const response = await post(body(), deps(db([STORE]), iss));

    const text = JSON.stringify(response.body);
    expect(text).not.toContain("42883");
    expect(text).not.toContain("secret_thing");
  });
});
