/**
 * Canonical browser client + Admin authorization resolution.
 *
 * The credential tests are the important ones: they encode the rule that a
 * browser may hold only a publishable key, so a privileged credential in the
 * wrong environment variable fails at construction instead of shipping.
 *
 * NOTE ON `device.fleet.read`: that string is a TEST FIXTURE, not a canonical
 * permission key. The deployed `kitluy_auth.permissions` set holds 12 keys, all
 * `fleet.*` ACTION permissions (issue/revoke/emergency-approve) — there is no
 * fleet READ permission yet. `resolveAdminAuthorization` takes required keys as
 * input and hardcodes none, so it is unaffected; the real key must be an owner
 * decision before the fleet route enforces one. Recorded, not invented.
 */
import { describe, expect, it } from "vitest";

import {
  assertBrowserSafeCredential,
  assignmentInForce,
  createKitluyBrowserClient,
  deriveFleetFreshness,
  resolveAdminAuthorization,
  SupabaseClientConfigError,
  type AdminAuthorizationSource,
  type AdminFacts,
  type RoleAssignmentFact,
} from "../src/index.js";

const URL_OK = "https://gjgbnkhuwlwhngbtrgts.supabase.co";
const PUBLISHABLE = "sb_publishable_EXAMPLEexampleEXAMPLEexample";

/** Build a JWT-shaped token with the given role claim. No signature validity implied. */
function jwtWithRole(role: string): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ iss: "supabase", role })}.sIgNaTuRe`;
}

describe("browser credential guard", () => {
  it("accepts a publishable key", () => {
    expect(() =>
      assertBrowserSafeCredential(PUBLISHABLE, "SUPABASE_PUBLISHABLE_KEY"),
    ).not.toThrow();
  });

  it("accepts an anon JWT", () => {
    expect(() =>
      assertBrowserSafeCredential(jwtWithRole("anon"), "SUPABASE_PUBLISHABLE_KEY"),
    ).not.toThrow();
  });

  it("REFUSES a service_role JWT", () => {
    // The exact mistake that would put an RLS-bypassing credential in a bundle.
    expect(() =>
      assertBrowserSafeCredential(jwtWithRole("service_role"), "SUPABASE_PUBLISHABLE_KEY"),
    ).toThrow(SupabaseClientConfigError);
  });

  it("detects service_role in the DECODED payload, not by substring", () => {
    const token = jwtWithRole("service_role");
    // The literal text never appears in the raw token; only decoding finds it.
    expect(token).not.toContain("service_role");
    expect(() => assertBrowserSafeCredential(token, "K")).toThrow(/service_role/);
  });

  it("REFUSES an sb_secret_ server key", () => {
    expect(() => assertBrowserSafeCredential("sb_secret_abc123", "K")).toThrow(/privileged/);
  });

  it("REFUSES a Supabase personal access token", () => {
    expect(() => assertBrowserSafeCredential("sbp_0123456789abcdef", "K")).toThrow(/privileged/);
  });

  it("REFUSES a database password", () => {
    // Neither a JWT nor a publishable key — an unidentified credential.
    expect(() => assertBrowserSafeCredential("reeaAOStk8NnvuWF", "K")).toThrow(/unidentified/);
  });

  it("REFUSES an empty value", () => {
    expect(() => assertBrowserSafeCredential("", "K")).toThrow(/empty/);
  });
});

describe("client construction", () => {
  it("builds with a valid URL and publishable key", () => {
    expect(createKitluyBrowserClient({ url: URL_OK, publishableKey: PUBLISHABLE })).toBeDefined();
  });

  it("refuses a non-Supabase URL", () => {
    expect(() =>
      createKitluyBrowserClient({ url: "https://evil.example.com", publishableKey: PUBLISHABLE }),
    ).toThrow(/SUPABASE_URL/);
  });

  it("refuses plain http", () => {
    expect(() =>
      createKitluyBrowserClient({ url: "http://x.supabase.co", publishableKey: PUBLISHABLE }),
    ).toThrow(/SUPABASE_URL/);
  });

  it("refuses to build with a privileged credential", () => {
    expect(() =>
      createKitluyBrowserClient({ url: URL_OK, publishableKey: jwtWithRole("service_role") }),
    ).toThrow(SupabaseClientConfigError);
  });
});

// ---------------------------------------------------------------------------
// Admin authorization
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-10T12:00:00.000Z");

function assignment(o: Partial<RoleAssignmentFact> = {}): RoleAssignmentFact {
  return {
    roleTemplateKey: "het.platform.admin",
    status: "ACTIVE",
    validFrom: null,
    validTo: null,
    ...o,
  };
}

function source(facts: AdminFacts | null): AdminAuthorizationSource {
  return {
    async loadAdminFacts() {
      return facts;
    },
  };
}

function adminFacts(o: Partial<AdminFacts> = {}): AdminFacts {
  return {
    userId: "user-1",
    profileStatus: "ACTIVE",
    disabledAt: null,
    roleAssignments: [assignment()],
    permissionKeys: ["device.fleet.read"],
    ...o,
  };
}

describe("admin authorization", () => {
  it("authorizes an active Admin with an in-force assignment", async () => {
    const r = await resolveAdminAuthorization({
      userId: "user-1",
      source: source(adminFacts()),
      requiredPermissions: ["device.fleet.read"],
      now: NOW,
    });
    expect(r.kind).toBe("authorized");
  });

  const denials: ReadonlyArray<
    readonly [string, Parameters<typeof resolveAdminAuthorization>[0], string]
  > = [
    ["no session", { userId: null, source: source(adminFacts()), now: NOW }, "no_session"],
    ["empty user id", { userId: "", source: source(adminFacts()), now: NOW }, "no_session"],
    [
      "ordinary authenticated user",
      { userId: "u", source: source(null), now: NOW },
      "no_admin_profile",
    ],
    [
      "disabled Admin",
      { userId: "u", source: source(adminFacts({ disabledAt: "2026-08-01T00:00:00Z" })), now: NOW },
      "profile_disabled",
    ],
    [
      "inactive profile",
      { userId: "u", source: source(adminFacts({ profileStatus: "SUSPENDED" })), now: NOW },
      "profile_inactive",
    ],
    [
      "revoked assignment",
      {
        userId: "u",
        source: source(adminFacts({ roleAssignments: [assignment({ status: "REVOKED" })] })),
        now: NOW,
      },
      "no_active_role_assignment",
    ],
    [
      "expired assignment",
      {
        userId: "u",
        source: source(
          adminFacts({ roleAssignments: [assignment({ validTo: "2026-08-09T00:00:00Z" })] }),
        ),
        now: NOW,
      },
      "no_active_role_assignment",
    ],
    [
      "not-yet-valid assignment",
      {
        userId: "u",
        source: source(
          adminFacts({ roleAssignments: [assignment({ validFrom: "2026-08-11T00:00:00Z" })] }),
        ),
        now: NOW,
      },
      "no_active_role_assignment",
    ],
    [
      "no assignments at all",
      { userId: "u", source: source(adminFacts({ roleAssignments: [] })), now: NOW },
      "no_active_role_assignment",
    ],
    [
      "Admin lacking fleet permission",
      {
        userId: "u",
        source: source(adminFacts({ permissionKeys: ["something.else"] })),
        requiredPermissions: ["device.fleet.read"],
        now: NOW,
      },
      "missing_permission",
    ],
  ];

  for (const [label, input, reason] of denials) {
    it(`denies: ${label}`, async () => {
      const r = await resolveAdminAuthorization(input);
      expect(r.kind).toBe("denied");
      if (r.kind !== "denied") return;
      expect(r.reason).toBe(reason);
    });
  }

  it("rejects a lowercase status — canonical vocabulary is UPPERCASE", async () => {
    const r = await resolveAdminAuthorization({
      userId: "u",
      source: source(adminFacts({ profileStatus: "active" })),
      now: NOW,
    });
    expect(r.kind).toBe("denied");
    if (r.kind !== "denied") return;
    expect(r.reason).toBe("profile_inactive");
  });

  it("an expired-but-'ACTIVE' assignment is not in force", () => {
    // Status alone is not enough — this is the check that catches expiry.
    expect(assignmentInForce(assignment({ validTo: "2026-08-09T00:00:00Z" }), NOW)).toBe(false);
    expect(assignmentInForce(assignment(), NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fleet freshness
// ---------------------------------------------------------------------------

describe("fleet freshness", () => {
  const POLICY = { staleAfterSeconds: 120, offlineAfterSeconds: 600 };

  it("NEVER_SEEN when there is no heartbeat", () => {
    expect(deriveFleetFreshness(null, POLICY, NOW)).toBe("NEVER_SEEN");
  });

  it("a device row alone is never ONLINE", () => {
    // The false reassurance this function exists to refuse.
    expect(deriveFleetFreshness(null, POLICY, NOW)).not.toBe("ONLINE");
  });

  it("ONLINE / STALE / OFFLINE by heartbeat age", () => {
    expect(deriveFleetFreshness("2026-08-10T11:59:30Z", POLICY, NOW)).toBe("ONLINE");
    expect(deriveFleetFreshness("2026-08-10T11:55:00Z", POLICY, NOW)).toBe("STALE");
    expect(deriveFleetFreshness("2026-08-10T11:00:00Z", POLICY, NOW)).toBe("OFFLINE");
  });

  it("UNKNOWN when the threshold policy is not ruled", () => {
    // An unset owner value must not be replaced by an invented number.
    expect(
      deriveFleetFreshness(
        "2026-08-10T11:59:30Z",
        { staleAfterSeconds: null, offlineAfterSeconds: null },
        NOW,
      ),
    ).toBe("UNKNOWN");
  });

  it("UNKNOWN on an unparseable timestamp", () => {
    expect(deriveFleetFreshness("not-a-date", POLICY, NOW)).toBe("UNKNOWN");
  });
});

/**
 * The loopback exemption exists so a developer can point the portal at their
 * OWN Supabase stack. These tests are mostly about what it still refuses —
 * the exemption is safe because the traffic never leaves the machine, not
 * because the caller asked nicely.
 */
describe("loopback http Supabase url", () => {
  const key = "sb_publishable_local";

  it("is accepted only when the caller opts in", () => {
    expect(() =>
      createKitluyBrowserClient({
        url: "http://127.0.0.1:54391",
        publishableKey: key,
        allowLoopbackHttp: true,
      }),
    ).not.toThrow();
  });

  it("is REFUSED without the opt-in — a built bundle passes false", () => {
    expect(() =>
      createKitluyBrowserClient({ url: "http://127.0.0.1:54391", publishableKey: key }),
    ).toThrow();
    expect(() =>
      createKitluyBrowserClient({
        url: "http://127.0.0.1:54391",
        publishableKey: key,
        allowLoopbackHttp: false,
      }),
    ).toThrow();
  });

  it("REFUSES any host that is not loopback, even with the opt-in", () => {
    for (const url of [
      "http://supabase.example.com",
      "http://10.0.0.5:54391",
      "http://127.0.0.1.evil.test",
      "http://localhost.evil.test",
      "http://[::1].evil.test",
      "https://not-supabase.example.com",
    ]) {
      expect(() =>
        createKitluyBrowserClient({ url, publishableKey: key, allowLoopbackHttp: true }),
      ).toThrow();
    }
  });

  it("still refuses a privileged credential on a loopback url", () => {
    // The transport exemption must not become a credential exemption.
    expect(() =>
      createKitluyBrowserClient({
        url: "http://127.0.0.1:54391",
        publishableKey: "sb_secret_nope",
        allowLoopbackHttp: true,
      }),
    ).toThrow();
  });
});
