/**
 * The Partner's terminal provisioning routes (group 0213).
 *
 * What this suite protects, in the order it was easiest to get wrong:
 *   1. Authority is decided per request with a SEPARATE Store-scope conjunct;
 *      missing permission and wrong Store are the same 403.
 *   2. A seat or session belonging to another Partner's Store is reported as
 *      absent (404), never as forbidden.
 *   3. Unknown body fields, malformed ids and malformed role keys are 422 —
 *      and the Tenant is never accepted from the body.
 *   4. The code is generated from the database's alphabet, returned once,
 *      with `showOnce` and the fifteen-minute TTL, and never appears in a
 *      door parameter (only its digest does).
 *   5. An unwired deployment answers 503, never 404.
 */
import { describe, expect, it } from "vitest";

import type { DatabaseHandle, TokenVerifier } from "../src/authorization.js";
import {
  handleManagementRequest,
  MANAGEMENT_PREFIX,
  type ManagementRouterDependencies,
} from "../src/http.js";

const USER = "11111111-1111-4111-8111-111111111111";
const STORE = "22222222-2222-4222-8222-222222222222";
const OTHER_STORE = "33333333-3333-4333-8333-333333333333";
const LOCATION = "44444444-4444-4444-8444-444444444444";
const TERMINAL = "55555555-5555-4555-8555-555555555555";
const FOREIGN_TERMINAL = "66666666-6666-4666-8666-666666666666";
const SESSION = "77777777-7777-4777-8777-777777777777";
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEYS = ["laundry.t1.intake_cashier", "laundry.t2.customer_display"];

const verifier: TokenVerifier = { verify: () => Promise.resolve({ userId: USER }) };

function db(assignedStores: readonly string[], permitted = true): DatabaseHandle {
  return {
    query: <Row>(sql: string, params?: readonly unknown[]) => {
      if (sql.includes("has_permission")) {
        const requestedStore = params?.[2];
        return Promise.resolve({
          rows: [
            {
              permitted,
              digital_store_ids: assignedStores,
              in_scope: requestedStore === null || assignedStores.includes(String(requestedStore)),
            },
          ] as unknown as Row[],
        });
      }
      return Promise.resolve({ rows: [] as Row[] });
    },
  };
}

const terminalRow = (id: string, storeId: string) => ({
  id,
  digital_store_id: storeId,
  store_location_id: LOCATION,
  location_reference: "BKK1 — Boeung Keng Kang 1",
  label: "Front Counter 01",
  terminal_profile_keys: KEYS,
  created_at: new Date("2026-09-04T09:00:00Z"),
  bound_device_id: null,
  bound_device_reference: null,
  bound_lifecycle: null,
  bound_assignment_state: null,
  session_id: null,
  session_state: null,
  session_expires_at: null,
  session_paired_at: null,
  session_failed: null,
  session_locked_at: null,
});

/** Records every door call so the route's inputs are visible. */
function terminals() {
  const doorCalls: { sql: string; params: readonly unknown[] }[] = [];
  const deps = {
    pool: {
      connect: () =>
        Promise.resolve({
          query: (sql: string, params?: readonly unknown[]) => {
            if (sql.includes("hub_claim_code_alphabet_v1")) {
              return Promise.resolve({ rows: [{ alphabet: ALPHABET }] });
            }
            if (sql.includes("define_physical_terminal_v1")) {
              doorCalls.push({ sql, params: params ?? [] });
              return Promise.resolve({
                rows: [{ result: { outcome: "DEFINED", physical_terminal_id: TERMINAL } }],
              });
            }
            if (sql.includes("open_terminal_pairing_session_v1")) {
              doorCalls.push({ sql, params: params ?? [] });
              return Promise.resolve({
                rows: [
                  {
                    result: {
                      outcome: "OPENED",
                      session_id: SESSION,
                      expires_at: new Date("2026-09-04T09:15:00Z"),
                      label: "Front Counter 01",
                      terminal_profile_keys: KEYS,
                      store_hub_reference: "KL-6C4917D5C6DA",
                      environment: "development",
                    },
                  },
                ],
              });
            }
            if (sql.includes("cancel_terminal_pairing_session_v1")) {
              doorCalls.push({ sql, params: params ?? [] });
              return Promise.resolve({
                rows: [{ result: { outcome: "CANCELLED", state: "revoked" } }],
              });
            }
            if (sql.includes("set_physical_terminal_roles_v1")) {
              doorCalls.push({ sql, params: params ?? [] });
              return Promise.resolve({ rows: [{ result: { outcome: "ROLES_SET" } }] });
            }
            return Promise.resolve({ rows: [] });
          },
          release: () => undefined,
        }),
      // Reads with the trusted identity.
      query: (sql: string, params?: readonly unknown[]) => {
        if (sql.includes("from kitluy_devices.physical_terminals pt")) {
          const wanted = String(params?.[0]);
          if (wanted === TERMINAL) return Promise.resolve({ rows: [terminalRow(TERMINAL, STORE)] });
          if (wanted === FOREIGN_TERMINAL) {
            return Promise.resolve({ rows: [terminalRow(FOREIGN_TERMINAL, OTHER_STORE)] });
          }
          if (wanted === STORE) return Promise.resolve({ rows: [terminalRow(TERMINAL, STORE)] });
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("select digital_store_id from kitluy_devices.physical_terminals")) {
          const wanted = String(params?.[0]);
          if (wanted === TERMINAL) return Promise.resolve({ rows: [{ digital_store_id: STORE }] });
          if (wanted === FOREIGN_TERMINAL) {
            return Promise.resolve({ rows: [{ digital_store_id: OTHER_STORE }] });
          }
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("from kitluy_devices.terminal_pairing_sessions s")) {
          if (String(params?.[0]) !== SESSION) return Promise.resolve({ rows: [] });
          return Promise.resolve({
            rows: [
              {
                id: SESSION,
                physical_terminal_id: TERMINAL,
                digital_store_id: STORE,
                state: "open",
                paired_at: null,
                paired_device_id: null,
                asset_tag: null,
                failed_attempt_count: 0,
                locked_at: null,
                expires_at: new Date("2026-09-04T09:15:00Z"),
                terminal_profile_keys: KEYS,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    },
  };
  return { doorCalls, deps };
}

function deps(
  handle: DatabaseHandle,
  t?: ReturnType<typeof terminals>,
): ManagementRouterDependencies {
  return {
    db: handle,
    verifier,
    environment: "development",
    now: () => new Date("2026-09-04T09:01:00Z"),
    ...(t === undefined
      ? {}
      : { terminals: t.deps as unknown as ManagementRouterDependencies["terminals"] }),
  };
}

const post = (path: string, body: unknown, d: ManagementRouterDependencies, token = "tok") =>
  handleManagementRequest(d, {
    method: "POST",
    url: `${MANAGEMENT_PREFIX}${path}`,
    authorization: token === "" ? undefined : `Bearer ${token}`,
    body: JSON.stringify(body),
  });

const get = (path: string, d: ManagementRouterDependencies) =>
  handleManagementRequest(d, {
    method: "GET",
    url: `${MANAGEMENT_PREFIX}${path}`,
    authorization: "Bearer tok",
  });

const define = {
  digitalStoreId: STORE,
  storeLocationId: LOCATION,
  label: "Front Counter 01",
  terminalProfileKeys: KEYS,
};

describe("defining a seat", () => {
  it("201 with the seat, for a Partner who holds the Store", async () => {
    const t = terminals();
    const res = await post("/partner/terminals", define, deps(db([STORE]), t));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      terminal: {
        physicalTerminalId: TERMINAL,
        label: "Front Counter 01",
        terminalProfileKeys: KEYS,
      },
    });
    // The Tenant never travels: the door derives it from the Store.
    const call = t.doorCalls.find((c) => c.sql.includes("define_physical_terminal_v1"));
    expect(call?.params).toEqual([STORE, LOCATION, "Front Counter 01", KEYS, `partner/${USER}`]);
  });

  it("a blank name is passed as null so the door generates one", async () => {
    const t = terminals();
    await post("/partner/terminals", { ...define, label: "  " }, deps(db([STORE]), t));
    const call = t.doorCalls.find((c) => c.sql.includes("define_physical_terminal_v1"));
    expect(call?.params[2]).toBeNull();
  });

  it("401 without a token, 403 without the permission, 403 for another Store — the two 403s identical", async () => {
    const t = terminals();
    expect((await post("/partner/terminals", define, deps(db([STORE]), t), "")).status).toBe(401);
    const noPermission = await post("/partner/terminals", define, deps(db([STORE], false), t));
    const wrongStore = await post("/partner/terminals", define, deps(db([OTHER_STORE]), t));
    expect(noPermission.status).toBe(403);
    expect(wrongStore.status).toBe(403);
    expect(wrongStore.body).toEqual(noPermission.body);
    expect(t.doorCalls).toHaveLength(0);
  });

  it("422 for an unknown field, a bad key shape, a repeated key, nine keys, or a tenant id", async () => {
    const t = terminals();
    const d = deps(db([STORE]), t);
    const cases: Record<string, unknown>[] = [
      { ...define, tenantId: STORE },
      { ...define, terminalProfileKeys: ["t1"] },
      { ...define, terminalProfileKeys: [KEYS[0], KEYS[0]] },
      {
        ...define,
        terminalProfileKeys: Array.from({ length: 9 }, (_, i) => `laundry.t${i + 1}.r`),
      },
      { ...define, digitalStoreId: "nope" },
    ];
    for (const body of cases) {
      expect((await post("/partner/terminals", body, d)).status).toBe(422);
    }
    expect(t.doorCalls).toHaveLength(0);
  });

  it("503, never 404, when terminal provisioning is not wired", async () => {
    const res = await post("/partner/terminals", define, deps(db([STORE])));
    expect(res.status).toBe(503);
  });
});

describe("opening a session", () => {
  it("201 with a code from the database's alphabet, shown once, digest to the door", async () => {
    const t = terminals();
    const res = await post(
      "/terminal-pairing-sessions",
      { physicalTerminalId: TERMINAL },
      deps(db([STORE]), t),
    );
    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(String(body.code)).toMatch(new RegExp(`^[${ALPHABET}]{8}$`));
    expect(body).toMatchObject({
      sessionId: SESSION,
      ttlSeconds: 900,
      showOnce: true,
      label: "Front Counter 01",
      terminalProfileKeys: KEYS,
      storeHubReference: "KL-6C4917D5C6DA",
    });
    expect(body).not.toHaveProperty("qrPayload");
    const call = t.doorCalls.find((c) => c.sql.includes("open_terminal_pairing_session_v1"));
    expect(call?.params[0]).toBe(TERMINAL);
    expect(String(call?.params[1])).toMatch(/^[0-9a-f]{64}$/);
    expect(call?.params[1]).not.toBe(body.code);
    expect(call?.params[2]).toBe(900);
  });

  it("a seat in another Partner's Store is absent, not forbidden", async () => {
    const t = terminals();
    const res = await post(
      "/terminal-pairing-sessions",
      { physicalTerminalId: FOREIGN_TERMINAL },
      deps(db([STORE]), t),
    );
    expect(res.status).toBe(404);
    expect(t.doorCalls).toHaveLength(0);
  });

  it("refuses an unknown field and a malformed id", async () => {
    const t = terminals();
    const d = deps(db([STORE]), t);
    expect(
      (await post("/terminal-pairing-sessions", { physicalTerminalId: TERMINAL, ttl: 1 }, d))
        .status,
    ).toBe(422);
    expect((await post("/terminal-pairing-sessions", { physicalTerminalId: "x" }, d)).status).toBe(
      422,
    );
  });
});

describe("watching and cancelling a session", () => {
  it("reports the session to its own Partner, with paired/expired derived", async () => {
    const t = terminals();
    const res = await get(`/terminal-pairing-sessions/${SESSION}`, deps(db([STORE]), t));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sessionId: SESSION,
      state: "open",
      paired: false,
      expired: false,
      locked: false,
      terminalProfileKeys: KEYS,
    });
  });

  it("hides the session from a Partner who does not hold its Store", async () => {
    const t = terminals();
    const res = await get(`/terminal-pairing-sessions/${SESSION}`, deps(db([OTHER_STORE]), t));
    expect(res.status).toBe(404);
  });

  it("cancels an open session and names the actor", async () => {
    const t = terminals();
    const res = await post(
      `/terminal-pairing-sessions/${SESSION}/cancel`,
      {},
      deps(db([STORE]), t),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ sessionId: SESSION, outcome: "cancelled", state: "revoked" });
    const call = t.doorCalls.find((c) => c.sql.includes("cancel_terminal_pairing_session_v1"));
    expect(call?.params[1]).toBe(`partner/${USER}`);
  });

  it("refuses a cancel body with fields", async () => {
    const t = terminals();
    const res = await post(
      `/terminal-pairing-sessions/${SESSION}/cancel`,
      { reason: "x" },
      deps(db([STORE]), t),
    );
    expect(res.status).toBe(422);
  });
});

describe("listing a Store's seats and setting roles", () => {
  it("lists the seats of a Store the Partner holds", async () => {
    const t = terminals();
    const res = await get(`/partner/stores/${STORE}/terminals`, deps(db([STORE]), t));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 1, terminals: [{ physicalTerminalId: TERMINAL }] });
  });

  it("refuses the list for a Store the Partner does not hold", async () => {
    const t = terminals();
    const res = await get(`/partner/stores/${OTHER_STORE}/terminals`, deps(db([STORE]), t));
    expect(res.status).toBe(403);
  });

  it("sets roles on an owned seat and hides a foreign one", async () => {
    const t = terminals();
    const d = deps(db([STORE]), t);
    const ok = await post(
      `/partner/terminals/${TERMINAL}/roles`,
      { terminalProfileKeys: [KEYS[0]] },
      d,
    );
    expect(ok.status).toBe(200);
    const foreign = await post(
      `/partner/terminals/${FOREIGN_TERMINAL}/roles`,
      { terminalProfileKeys: [KEYS[0]] },
      d,
    );
    expect(foreign.status).toBe(404);
  });
});
