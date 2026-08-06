import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADDITIVE_EDGE_SCOPES,
  APPROVED_EDGE_ROUTE_COUNT,
  AUDIT_EVENT_RECONCILIATION,
  EDGE_API_SCOPES,
  EDGE_INFRASTRUCTURE_READ_PATHS,
  EDGE_PERMISSION_GAPS,
  EDGE_REGISTERED_PERMISSIONS,
  EDGE_ROUTES,
  EDGE_V1_BASE_PATH,
  EDGE_V1_LAUNDRY_BASE_PATH,
  GENERIC_EDGE_ROUTES,
  LAUNDRY_EDGE_ROUTES,
  LOGICAL_TERMINAL_PROFILES,
  PERMISSION_KEY_PATTERN,
  REGISTERED_EDGE_SCOPES,
  REJECTED_ROUTE_SHAPES,
  RUNTIME_BOOTSTRAP_READ_SCOPES,
  RETIRED_TERMINAL_PROFILE_IDS,
  SCOPE_NAME_RECONCILIATION,
  TERMINAL_PROFILE_PATTERN,
  TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
  edgeRouteKey,
  edgeScopeStatus,
  findEdgeRoute,
  isRequiredPermissionMarker,
  isStaffMutation,
  permissionRegistryStatus,
} from "../src/index.js";

/**
 * Canonical domain/audit event pattern, declared LOCALLY on purpose.
 * KLD-2026-07-26-002 Group 4 fixes this regex; `@kitluy/event-contracts` is
 * being changed concurrently and must not be imported here.
 */
const CANONICAL_EVENT_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/**
 * The 22 approved route decisions, quoted verbatim from
 * `docs/decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md`
 * Group 1. This is the independent expectation the registry is checked against.
 */
const APPROVED_ROUTE_DECISIONS = [
  "POST /edge/v1/sessions/open",
  "POST /edge/v1/sessions/refresh",
  "POST /edge/v1/sessions/switch",
  "POST /edge/v1/sessions/close",
  "POST /edge/v1/laundry/bookings/drafts",
  "POST /edge/v1/laundry/bookings/{id}/confirm-intake",
  "POST /edge/v1/laundry/ready-sessions",
  "POST /edge/v1/laundry/ready-sessions/{id}/scans",
  "POST /edge/v1/laundry/ready-sessions/{id}/qa",
  "POST /edge/v1/laundry/ready-sessions/{id}/exceptions",
  "POST /edge/v1/laundry/ready-sessions/{id}/storage",
  "POST /edge/v1/laundry/ready-sessions/{id}/complete",
  "POST /edge/v1/display-sessions",
  "PATCH /edge/v1/display-sessions/{id}",
  "GET /edge/v1/display-sessions/{id}",
  "POST /edge/v1/display-sessions/{id}/customer-actions",
  "POST /edge/v1/display-sessions/{id}/close",
  "POST /edge/v1/laundry/pickup-sessions",
  "POST /edge/v1/laundry/pickup-sessions/{id}/collector-verification",
  "POST /edge/v1/laundry/pickup-sessions/{id}/scans",
  "POST /edge/v1/laundry/pickup-sessions/{id}/payments",
  "POST /edge/v1/laundry/pickup-sessions/{id}/complete",
] as const;

const MUTATIONS = EDGE_ROUTES.filter((route) => route.kind === "mutation");
const READS = EDGE_ROUTES.filter((route) => route.kind === "read");

/** The 107-key RBAC baseline, read from the canonical CSV — never mirrored blindly. */
function rbacRegistryKeys(): ReadonlySet<string> {
  const csvUrl = new URL(
    "../../../docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv",
    import.meta.url,
  );
  const lines = readFileSync(csvUrl, "utf8").split(/\r?\n/).slice(1);
  return new Set(lines.map((line) => line.split(",")[0]?.trim() ?? "").filter((key) => key !== ""));
}

/**
 * Keys added by additive registry AMENDMENTS under docs/security/ (the
 * imported v1.0.0 CSV is never edited — Amendment-001 pattern). Each
 * amendment's §1 table carries the same nine columns as the CSV; the first
 * column of each data row is the key.
 */
function rbacAmendmentKeys(): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const amendment of [
    "kitluy-suite-rbac-permission-registry-amendment-001-device-containment-v1.0.0.md",
    "kitluy-suite-rbac-permission-registry-amendment-002-t1-staff-sessions-v1.0.0.md",
  ]) {
    const url = new URL(`../../../docs/security/${amendment}`, import.meta.url);
    // Only §1 "New keys" registers keys; later sections are reconciliations.
    const newKeysSection = readFileSync(url, "utf8")
      .split(/^## /m)
      .find((s) => s.startsWith("1."));
    for (const line of (newKeysSection ?? "").split(/\r?\n/)) {
      const match = /^\|\s*`?([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)`?\s*\|/.exec(line);
      if (match?.[1] !== undefined) keys.add(match[1]);
    }
  }
  return keys;
}

/** The full canonical key set: the CSV baseline plus every amendment. */
function canonicalKeys(): ReadonlySet<string> {
  return new Set([...rbacRegistryKeys(), ...rbacAmendmentKeys()]);
}

// ---------------------------------------------------------------------------
// 1. Every approved route resolves to exactly one canonical constant.
// ---------------------------------------------------------------------------

describe("1. canonical route resolution", () => {
  it("registers exactly the 22 route decisions approved by KLD-2026-07-26-002 Group 1", () => {
    expect(EDGE_ROUTES).toHaveLength(APPROVED_EDGE_ROUTE_COUNT);
    expect(APPROVED_ROUTE_DECISIONS).toHaveLength(APPROVED_EDGE_ROUTE_COUNT);
    expect([...EDGE_ROUTES.map((r) => edgeRouteKey(r.method, r.path))].sort()).toEqual(
      [...APPROVED_ROUTE_DECISIONS].sort(),
    );
  });

  it("resolves every approved decision to exactly one registry entry", () => {
    for (const decision of APPROVED_ROUTE_DECISIONS) {
      const matches = EDGE_ROUTES.filter((r) => edgeRouteKey(r.method, r.path) === decision);
      expect(matches, decision).toHaveLength(1);
    }
  });

  it("has no duplicate method+path keys and no duplicate route ids", () => {
    const keys = EDGE_ROUTES.map((r) => edgeRouteKey(r.method, r.path));
    expect(new Set(keys).size).toBe(EDGE_ROUTES.length);
    const ids = EDGE_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(EDGE_ROUTES.length);
  });

  it("splits into 9 generic and 13 laundry routes with no overlap", () => {
    expect(GENERIC_EDGE_ROUTES).toHaveLength(9);
    expect(LAUNDRY_EDGE_ROUTES).toHaveLength(13);
    expect(GENERIC_EDGE_ROUTES.length + LAUNDRY_EDGE_ROUTES.length).toBe(EDGE_ROUTES.length);
  });

  it("keeps the Hub infrastructure reads outside the approved-route count", () => {
    const paths = new Set(EDGE_ROUTES.map((r) => r.path));
    for (const infrastructurePath of EDGE_INFRASTRUCTURE_READ_PATHS) {
      expect(paths.has(infrastructurePath)).toBe(false);
      expect(infrastructurePath.startsWith(`${EDGE_V1_BASE_PATH}/`)).toBe(true);
    }
  });

  it("looks a route up by method and path", () => {
    expect(findEdgeRoute("POST", "/edge/v1/laundry/ready-sessions/{id}/scans")?.id).toBe(
      "laundry-ready-session-scan",
    );
    expect(findEdgeRoute("GET", "/edge/v1/display-sessions/{id}")?.id).toBe(
      "display-sessions-read",
    );
    expect(findEdgeRoute("POST", "/edge/v1/display-sessions/{id}")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. No rejected / losing route shape appears anywhere in the registry.
// ---------------------------------------------------------------------------

describe("2. rejected route shapes are absent", () => {
  const registryPaths = EDGE_ROUTES.map((r) => r.path);

  it("declares the rejected shapes it defends against", () => {
    expect(REJECTED_ROUTE_SHAPES.length).toBeGreaterThanOrEqual(20);
  });

  it("contains none of the REJECTED-BEFORE-IMPLEMENTATION shapes", () => {
    for (const rejected of REJECTED_ROUTE_SHAPES) {
      expect(registryPaths, rejected.shape).not.toContain(rejected.shape);
    }
  });

  it("points every rejected shape at an approved replacement or an explicit null", () => {
    const approved = new Set(registryPaths);
    for (const rejected of REJECTED_ROUTE_SHAPES) {
      if (rejected.replacedBy !== null) {
        expect(approved.has(rejected.replacedBy), rejected.shape).toBe(true);
      }
      expect(rejected.reason.length).toBeGreaterThan(10);
      expect(rejected.source.length).toBeGreaterThan(0);
    }
  });

  it("prefixes every route with /edge/v1 — no unversioned or unprefixed shape survives", () => {
    for (const route of EDGE_ROUTES) {
      expect(route.path.startsWith(`${EDGE_V1_BASE_PATH}/`), route.path).toBe(true);
    }
  });

  it("never vertical-prefixes a generic capability (sessions, display-sessions)", () => {
    for (const route of EDGE_ROUTES) {
      expect(route.path.startsWith(`${EDGE_V1_LAUNDRY_BASE_PATH}/sessions`), route.path).toBe(
        false,
      );
      expect(
        route.path.startsWith(`${EDGE_V1_LAUNDRY_BASE_PATH}/display-sessions`),
        route.path,
      ).toBe(false);
    }
  });

  it("contains no POS-fork or LAN-fork path segment", () => {
    const forkSegments = [
      "/ready-scan/",
      "/pickup-scan/",
      "/displays/",
      "/finalize",
      "/release",
      "/receipt-choice",
      "{session_id}",
    ];
    for (const route of EDGE_ROUTES) {
      for (const segment of forkSegments) {
        expect(route.path.includes(segment), `${route.path} contains ${segment}`).toBe(false);
      }
    }
  });

  it("never reuses a retired terminal-profile identifier", () => {
    const serialized = JSON.stringify(EDGE_ROUTES);
    for (const retired of RETIRED_TERMINAL_PROFILE_IDS) {
      expect(serialized).not.toContain(retired);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Every mutation declares a scope, a permission and idempotency.
// ---------------------------------------------------------------------------

describe("3. mutation metadata completeness", () => {
  it("finds 21 mutations and 1 read", () => {
    expect(MUTATIONS).toHaveLength(21);
    expect(READS).toHaveLength(1);
  });

  it("declares a registered or explicitly additive scope on every mutation", () => {
    for (const route of MUTATIONS) {
      expect(EDGE_API_SCOPES, route.id).toContain(route.scope);
      expect(route.scopeStatus, route.id).toBe(edgeScopeStatus(route.scope));
    }
  });

  it("declares a permission on every mutation", () => {
    for (const route of MUTATIONS) {
      expect(route.permission.length, route.id).toBeGreaterThan(0);
      expect(route.permissionStatus, route.id).toBe(permissionRegistryStatus(route.permission));
    }
  });

  it("requires idempotency on every mutation and on no read", () => {
    for (const route of MUTATIONS) {
      expect(route.idempotencyRequired, route.id).toBe(true);
    }
    for (const route of READS) {
      expect(route.idempotencyRequired, route.id).toBe(false);
      expect(route.mutatesExistingAggregate, route.id).toBe(false);
      expect(route.expectedVersionRequired, route.id).toBe(false);
    }
  });

  it("uses a permission that is either in the canonical RBAC registry (CSV + amendments) or an explicit gap marker", () => {
    expect(rbacRegistryKeys().size).toBe(107);
    // Amendment 001 (device containment, 2 keys) + Amendment 002 (T1 staff
    // sessions, 5 keys) — read from the amendment documents themselves.
    expect(rbacAmendmentKeys().size).toBe(7);
    const registryKeys = canonicalKeys();
    for (const route of EDGE_ROUTES) {
      const permissions = [route.permission, ...route.conditionalPermissions];
      for (const permission of permissions) {
        if (isRequiredPermissionMarker(permission)) {
          expect(EDGE_PERMISSION_GAPS as readonly string[], route.id).toContain(permission);
          continue;
        }
        expect(PERMISSION_KEY_PATTERN.test(permission), permission).toBe(true);
        expect(registryKeys.has(permission), `${route.id} -> ${permission}`).toBe(true);
      }
    }
  });

  it("keeps every mirrored registered permission verbatim in the canonical registry", () => {
    const registryKeys = canonicalKeys();
    for (const permission of EDGE_REGISTERED_PERMISSIONS) {
      expect(registryKeys.has(permission), permission).toBe(true);
    }
  });

  it("declares approvalRequired explicitly and marks no Group 1 route as four-eyes", () => {
    for (const route of EDGE_ROUTES) {
      expect(typeof route.approvalRequired, route.id).toBe("boolean");
      expect(route.approvalRequired, route.id).toBe(false);
      expect(route.riskClass, route.id).not.toBe("A3_FOUR_EYES");
    }
  });

  it("carries the A2 re-auth obligation on every pickup route", () => {
    const pickupRoutes = EDGE_ROUTES.filter((r) => r.scope.startsWith("edge.pickup."));
    expect(pickupRoutes).toHaveLength(5);
    for (const route of pickupRoutes) {
      expect(route.riskClass, route.id).toBe("A2_REAUTH_MUTATION");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Mutations that change an existing aggregate declare expectedVersion.
// ---------------------------------------------------------------------------

describe("4. expected-version requirements", () => {
  it("requires an expected version exactly when an existing aggregate changes", () => {
    for (const route of EDGE_ROUTES) {
      expect(route.expectedVersionRequired, route.id).toBe(route.mutatesExistingAggregate);
    }
  });

  it("requires an expected version on every sub-resource mutation of an addressed aggregate", () => {
    for (const route of MUTATIONS) {
      if (!route.path.includes("{id}/")) continue;
      expect(route.mutatesExistingAggregate, route.id).toBe(true);
      expect(route.expectedVersionRequired, route.id).toBe(true);
    }
  });

  it("never requires an expected version on a collection-create route", () => {
    const creates = MUTATIONS.filter((r) => !r.path.includes("{id}"));
    expect(creates.length).toBeGreaterThan(0);
    for (const route of creates) {
      expect(route.expectedVersionRequired, route.id).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Terminal-profile restrictions are explicit; T2 is never a staff mutator.
// ---------------------------------------------------------------------------

describe("5. terminal-profile restrictions", () => {
  it("locks the four canonical dotted profile identifiers", () => {
    expect(LOGICAL_TERMINAL_PROFILES).toEqual([
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
      "laundry.t3.ready_scan_in",
      "laundry.t4.pickup_scan_out",
    ]);
    for (const profile of LOGICAL_TERMINAL_PROFILES) {
      expect(TERMINAL_PROFILE_PATTERN.test(profile), profile).toBe(true);
    }
    expect(LOGICAL_TERMINAL_PROFILES).not.toContain("t2_scan_in");
    expect(LOGICAL_TERMINAL_PROFILES).not.toContain("t3_scan_out");
  });

  it("declares a non-empty allow-list of known profiles on every laundry route", () => {
    for (const route of LAUNDRY_EDGE_ROUTES) {
      expect(route.allowedTerminalProfiles.length, route.id).toBeGreaterThan(0);
      for (const profile of route.allowedTerminalProfiles) {
        expect(LOGICAL_TERMINAL_PROFILES, route.id).toContain(profile);
      }
      expect(new Set(route.allowedTerminalProfiles).size, route.id).toBe(
        route.allowedTerminalProfiles.length,
      );
    }
  });

  it("declares a non-empty allow-list on every generic route too (deny by default)", () => {
    for (const route of GENERIC_EDGE_ROUTES) {
      expect(route.allowedTerminalProfiles.length, route.id).toBeGreaterThan(0);
    }
  });

  it("never allows T2 (customer display) on a staff mutation", () => {
    const staffMutations = EDGE_ROUTES.filter(isStaffMutation);
    expect(staffMutations.length).toBeGreaterThan(0);
    for (const route of staffMutations) {
      expect(route.allowedTerminalProfiles, route.id).not.toContain(
        TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
      );
    }
  });

  it("keeps T3 out of T4 release/payment routes and T4 out of T3 Ready routes", () => {
    for (const route of EDGE_ROUTES) {
      if (route.scope.startsWith("edge.ready.")) {
        expect(route.allowedTerminalProfiles, route.id).toEqual(["laundry.t3.ready_scan_in"]);
      }
      if (route.scope.startsWith("edge.pickup.")) {
        expect(route.allowedTerminalProfiles, route.id).toEqual(["laundry.t4.pickup_scan_out"]);
      }
    }
  });

  it("restricts booking intake to T1", () => {
    for (const route of EDGE_ROUTES) {
      if (route.scope.startsWith("edge.bookings.")) {
        expect(route.allowedTerminalProfiles, route.id).toEqual(["laundry.t1.intake_cashier"]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Scope and permission are separate authorisation dimensions.
// ---------------------------------------------------------------------------

describe("6. scope and permission separation", () => {
  it("never uses the same string for scope and permission", () => {
    for (const route of EDGE_ROUTES) {
      expect(route.permission, route.id).not.toBe(route.scope as string);
      for (const conditional of route.conditionalPermissions) {
        expect(conditional, route.id).not.toBe(route.scope as string);
      }
    }
  });

  it("keeps the scope namespace and the permission namespace disjoint", () => {
    const scopes = new Set<string>(EDGE_API_SCOPES);
    for (const route of EDGE_ROUTES) {
      for (const permission of [route.permission, ...route.conditionalPermissions]) {
        expect(scopes.has(permission), `${route.id} -> ${permission}`).toBe(false);
      }
    }
    for (const scope of EDGE_API_SCOPES) {
      expect(EDGE_REGISTERED_PERMISSIONS as readonly string[], scope).not.toContain(scope);
    }
  });

  it("never lets a scope alone imply a permission: one scope maps to many permissions and back", () => {
    // edge.bookings.create and edge.bookings.finalize share one permission —
    // the mapping is not a bijection, so a scope cannot stand in for a permission.
    const byScope = new Map<string, Set<string>>();
    for (const route of EDGE_ROUTES) {
      const set = byScope.get(route.scope) ?? new Set<string>();
      set.add(route.permission);
      byScope.set(route.scope, set);
    }
    const permissionsUsedByManyScopes = new Map<string, Set<string>>();
    for (const route of EDGE_ROUTES) {
      const set = permissionsUsedByManyScopes.get(route.permission) ?? new Set<string>();
      set.add(route.scope);
      permissionsUsedByManyScopes.set(route.permission, set);
    }
    const shared = [...permissionsUsedByManyScopes.values()].filter((set) => set.size > 1);
    expect(shared.length).toBeGreaterThan(0);
  });

  it("marks every additive scope as additive and every registered scope as registered", () => {
    for (const scope of REGISTERED_EDGE_SCOPES) {
      expect(edgeScopeStatus(scope), scope).toBe("registered");
    }
    for (const scope of ADDITIVE_EDGE_SCOPES) {
      expect(edgeScopeStatus(scope), scope).toBe("additive");
    }
    expect(new Set(EDGE_API_SCOPES).size).toBe(EDGE_API_SCOPES.length);
  });

  it("reconciles every instruction scope name onto a canonical registry name", () => {
    expect(SCOPE_NAME_RECONCILIATION.length).toBeGreaterThanOrEqual(20);
    for (const entry of SCOPE_NAME_RECONCILIATION) {
      expect(EDGE_API_SCOPES, entry.instructionName).toContain(entry.canonicalName);
      expect(entry.canonicalStatus, entry.canonicalName).toBe(edgeScopeStatus(entry.canonicalName));
      expect(entry.note.length).toBeGreaterThan(10);
    }
  });

  it("uses only scopes that are reachable from a route or a bootstrap read", () => {
    // The three T1 bootstrap reads (KLD-2026-08-06-WS12-T001-EDGE-
    // BOOTSTRAP-001) are held OUTSIDE the Group 1 registry like the
    // infrastructure reads; their scopes are consumed there.
    const used = new Set<string>([
      ...EDGE_ROUTES.map((r) => r.scope),
      ...RUNTIME_BOOTSTRAP_READ_SCOPES,
    ]);
    for (const scope of ADDITIVE_EDGE_SCOPES) {
      expect(
        used.has(scope),
        `additive scope ${scope} must be consumed by an approved surface`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Audit event names match the canonical event grammar.
// ---------------------------------------------------------------------------

describe("7. audit event naming", () => {
  it("matches the canonical two-segment pattern on every route", () => {
    for (const route of EDGE_ROUTES) {
      expect(CANONICAL_EVENT_PATTERN.test(route.auditEvent), route.auditEvent).toBe(true);
    }
  });

  it("never embeds a schema version in the event name", () => {
    for (const route of EDGE_ROUTES) {
      expect(route.auditEvent.endsWith(".v1"), route.auditEvent).toBe(false);
      expect(route.auditEvent).not.toMatch(/\.v\d+$/);
      expect(route.auditEvent.split(".")).toHaveLength(2);
    }
  });

  it("labels each event as registered in the Domain Event Registry or proposed", () => {
    const registered = EDGE_ROUTES.filter((r) => r.auditEventStatus === "registered");
    expect(registered.map((r) => r.auditEvent).sort()).toEqual([
      "garment.custody_scanned_in",
      "garment.custody_scanned_out",
      "laundry_booking.created",
      "laundry_booking.ready",
      "payment.recorded",
    ]);
  });

  it("keeps the RBAC/Domain-Event divergence recorded rather than silently resolved", () => {
    expect(AUDIT_EVENT_RECONCILIATION.length).toBeGreaterThanOrEqual(5);
    for (const entry of AUDIT_EVENT_RECONCILIATION) {
      expect(CANONICAL_EVENT_PATTERN.test(entry.rbacPrimaryAuditEvent)).toBe(true);
      expect(CANONICAL_EVENT_PATTERN.test(entry.canonicalEventName)).toBe(true);
      expect(entry.rbacPrimaryAuditEvent).not.toBe(entry.canonicalEventName);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Route families are correctly classified.
// ---------------------------------------------------------------------------

describe("8. route family classification", () => {
  it("never starts a generic route with the laundry prefix", () => {
    for (const route of EDGE_ROUTES.filter((r) => r.family === "generic")) {
      expect(route.path.startsWith(EDGE_V1_LAUNDRY_BASE_PATH), route.path).toBe(false);
      expect(route.path.startsWith(`${EDGE_V1_BASE_PATH}/`), route.path).toBe(true);
    }
  });

  it("always starts a laundry route with the laundry prefix", () => {
    for (const route of EDGE_ROUTES.filter((r) => r.family === "laundry")) {
      expect(route.path.startsWith(`${EDGE_V1_LAUNDRY_BASE_PATH}/`), route.path).toBe(true);
    }
  });

  it("derives family purely from the path prefix — no misclassification is possible", () => {
    for (const route of EDGE_ROUTES) {
      const expected = route.path.startsWith(`${EDGE_V1_LAUNDRY_BASE_PATH}/`)
        ? "laundry"
        : "generic";
      expect(route.family, route.path).toBe(expected);
    }
  });

  it("keeps every generic-route module entry generic and every laundry-route module entry laundry", () => {
    for (const route of GENERIC_EDGE_ROUTES) expect(route.family, route.id).toBe("generic");
    for (const route of LAUNDRY_EDGE_ROUTES) expect(route.family, route.id).toBe("laundry");
  });

  it("carries no vertical vocabulary in any generic route path", () => {
    for (const route of EDGE_ROUTES.filter((r) => r.family === "generic")) {
      expect(route.path.toLowerCase()).not.toContain("laundry");
    }
  });
});
