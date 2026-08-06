/**
 * @kitluy/rbac — canonical permission keys and the evaluation contract.
 *
 * Source authority:
 *   - Suite RBAC Permission Registry v1.0.0
 *     (docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv)
 *     — the 107-key canonical baseline reproduced verbatim below, plus the
 *     2 keys of Amendment 001 (docs/security/kitluy-suite-rbac-permission-
 *     registry-amendment-001-device-containment-v1.0.0.md) = 109.
 *   - Owner decision KLD-2026-07-26-002 Group 3 (APPROVED, KL-DEC-001):
 *     lowercase dot-separated grammar, immutable released keys, unknown or
 *     deprecated keys fail closed, production wildcards prohibited.
 *   - RB v4 §8.2 — authorization combines identity, team, role-template
 *     version, EXPLICIT permission grant, resource scope, environment scope and
 *     approval state. "Team membership alone never grants permission"
 *     (Admin spec v3.1.0). Frontend controls are convenience only; API policy
 *     and RLS are authoritative.
 *
 * SEPARATE AUTHORIZATION DIMENSIONS (KLD-2026-07-26-002 Group 3). These six
 * dimensions are evaluated independently and MUST NEVER be collapsed into one
 * string, nor may one of them be used to bypass another:
 *
 *     permission key | API scope | resource scope | environment scope |
 *     device/profile authorization | approval policy
 *
 * Concretely, a permission key carries NO resource identifier (that is the
 * `ResourceScope.resourceId` dimension) and NO environment name as a segment
 * (that is the `ResourceScope.environment` dimension) — both are rejected by
 * `isValidPermissionKey` and asserted by the tests. `platform.backup.
 * restore_production` is not a counter-example: `restore_production` is a
 * single capability verb naming a distinct, separately-registered capability
 * (registry rows `platform.backup.restore_test` / `restore_production`), and
 * the actor still needs an independent production environment grant to use it.
 *
 * STATUS: BUILT + TESTED (test/rbac.test.ts).
 */
import { KITLUY_ENVIRONMENTS } from "@kitluy/shared-types";
import type { ResourceScope } from "@kitluy/resource-scope";
import { sameScope } from "@kitluy/resource-scope";

/** A permission key is a dot-separated, lowercase, stable identifier. */
export type PermissionKey = string;

/** The registry version this package reproduces. Released keys are immutable. */
export const PERMISSION_REGISTRY_VERSION = "1.0.0";

/**
 * Structural grammar for a permission key.
 *
 * KLD-2026-07-26-002 Group 3 states the grammar as
 * `<domain>.<resource_or_capability>.<verb>` AND states that "the existing
 * 107-key registry is the canonical baseline".
 *
 * CONFLICT RECORDED (KL-DEC-001-T003, not silently resolved — CLAUDE.md hard
 * rule 8): those two statements disagree on segment count. 60 of the 107
 * canonical keys have exactly TWO segments because the resource/capability and
 * the verb are fused into one snake_case token — including all three release
 * keys the same decision names as canonical (`releases.promote_internal`,
 * `releases.promote_pilot`, `releases.promote_stable`) and, for example,
 * `rbac.read`, `laundry.ready_scan_in`, `webhooks.replay`. The remaining 47
 * have exactly three. Enforcing "exactly three segments" would invalidate 56%
 * of the canonical baseline and the very keys this task is required to make
 * valid, so the grammar admits 2-or-3 segments and the registry membership
 * check below is the authoritative gate. Escalated for owner ruling: either the
 * grammar sentence or 60 registry rows must move.
 *
 * Regardless of that count, the grammar is tightened against the previous
 * `(\.[a-z][a-z0-9_]*)+` form: single-segment keys (broad "admin"-style roles),
 * four-or-more-segment keys, uppercase, wildcards and hyphens are all rejected.
 */
const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$/;

/** Minimum and maximum segment counts admitted by the canonical registry. */
export const PERMISSION_KEY_MIN_SEGMENTS = 2;
export const PERMISSION_KEY_MAX_SEGMENTS = 3;

/**
 * Environment names may never appear as a permission-key segment: environment
 * is an independent grant dimension (RB v4 §8.6, Resource Scope Model §4).
 */
const ENVIRONMENT_SEGMENTS: ReadonlySet<string> = new Set<string>(KITLUY_ENVIRONMENTS);

/**
 * A resource identifier may never appear inside a permission key: the target
 * resource is derived server-side and carried by `ResourceScope.resourceId`
 * (Resource Scope Model §7 step 4). Hyphenated UUIDs, ULIDs and nanoids are
 * already rejected by the character class; this catches the un-hyphenated hex
 * and numeric-suffix forms that would otherwise slip through. No canonical
 * registry key contains a digit.
 */
function segmentLooksLikeResourceId(segment: string): boolean {
  return /^[0-9a-f]{12,}$/.test(segment) || /[0-9]{3,}/.test(segment);
}

/**
 * Structural validation only. It is NOT an authorization check and NOT proof
 * the key exists — use `isCanonicalPermissionKey` for that.
 */
export function isValidPermissionKey(key: string): boolean {
  if (!PERMISSION_KEY_PATTERN.test(key)) {
    return false;
  }
  const segments = key.split(".");
  if (
    segments.length < PERMISSION_KEY_MIN_SEGMENTS ||
    segments.length > PERMISSION_KEY_MAX_SEGMENTS
  ) {
    return false;
  }
  return !segments.some(
    (segment) => ENVIRONMENT_SEGMENTS.has(segment) || segmentLooksLikeResourceId(segment),
  );
}

/**
 * The canonical permission registry — 107 keys from the Suite RBAC Permission
 * Registry v1.0.0 (column `permission`, verbatim and in registry order) plus
 * the 2 keys of Amendment 001 (device containment, WS-11-T005-P02 owner
 * package 2026-08-06) = 109. Released keys are immutable; additions and
 * deprecations go through `rbac.permission_registry_manage`
 * (A4_OWNER_SECURITY) — Amendment 001 is exactly such an owner ruling.
 *
 * NEUTRAL-CORE BOUNDARY (CLAUDE.md hard rule 2). Six registry rows are
 * vertical-namespaced (`laundry.*`, marked inline below). Only the canonical
 * key STRINGS live here — no Laundry state machine, workflow, terminology or
 * behavior — matching the existing precedent for canonical contract
 * identifiers in neutral Core (`packages/edge-contracts/src/terminal-
 * profiles.ts`, `packages/shared-types` VERTICAL_PHASES). Recorded as an
 * open question for the owner: whether vertical rows should instead be
 * contributed by the owning vertical package at registration time.
 */
export const CANONICAL_PERMISSION_KEYS: readonly PermissionKey[] = [
  "identity.admin_profiles.read",
  "identity.admin_profiles.manage",
  "identity.sessions.revoke",
  "identity.mfa.policy_manage",
  "identity.break_glass.activate",
  "rbac.read",
  "rbac.team_manage",
  "rbac.role_manage",
  "rbac.permission_registry_manage",
  "rbac.assignment_manage",
  "rbac.owner_access_manage",
  "rbac.approval_policy_manage",
  "rbac.separation_of_duties_manage",
  "rbac.access_review",
  "rbac.effective_access.explain",
  "partners.read",
  "partners.verify",
  "partners.suspend",
  "partners.close",
  "digital_stores.read",
  "digital_stores.create",
  "digital_stores.vertical_lock",
  "digital_stores.activate",
  "digital_stores.suspend",
  "locations.read",
  "locations.create",
  "locations.go_live_request",
  "locations.go_live_approve",
  "locations.maintenance_toggle",
  "locations.decommission",
  "onboarding.readiness.evaluate",
  "onboarding.migration.validate",
  "onboarding.migration.execute",
  "onboarding.migration.rollback",
  "devices.read",
  "devices.register",
  "devices.assign",
  "devices.certificate.issue",
  "devices.certificate.rotate",
  "devices.revoke",
  "devices.identity_replace",
  "devices.remote_action.standard",
  "devices.remote_action.high_risk",
  // Amendment 001 (WS-11-T005-P02 owner package, 2026-08-06): governed device
  // containment. Owner identifiers recorded VERBATIM — singular `device.`
  // prefix noted in the amendment record, not harmonized silently.
  "device.containment.apply",
  "device.containment.clear",
  "fleet.diagnostics.read",
  "fleet.logs.request",
  "fleet.sync.trigger",
  "releases.read",
  "releases.artifact_register",
  "releases.rollout_create",
  "releases.promote_internal",
  "releases.promote_pilot",
  "releases.promote_stable",
  "releases.pause",
  "releases.rollback",
  "configuration.read",
  "configuration.publish",
  "configuration.rollback",
  "platform.health.read",
  "platform.jobs.retry",
  "platform.jobs.dead_letter_manage",
  "platform.incident.declare",
  "platform.safety_switch.toggle",
  "platform.backup.restore_test",
  "platform.backup.restore_production",
  "billing.read",
  "billing.invoice_adjust",
  "billing.invoice_mark_paid",
  "billing.grace_change",
  "billing.policy_manage",
  "support.ticket.manage",
  "support.evidence.read",
  "support.consent_session.start",
  "support.impersonation.start",
  "support.intervention.execute",
  "support.session.revoke",
  "integrations.read",
  "integrations.test",
  "integrations.credentials_rotate",
  "integrations.production_enable",
  "integrations.suspend",
  "webhooks.replay",
  "audit.read",
  "audit.export",
  "audit.security_review",
  "files.read",
  "files.security_export",
  "reports.export",
  "ai.policies.read",
  "ai.policies.manage",
  "ai.rag_sources.manage",
  "ai.mcp_tools.enable_read",
  "ai.mcp_tools.enable_write",
  // Vertical-namespaced registry rows — canonical key strings only (see the
  // neutral-Core boundary note above).
  "laundry.bookings.read",
  "laundry.bookings.create",
  "laundry.bookings.price_override",
  "laundry.ready_scan_in",
  "laundry.pickup_scan_out",
  "laundry.booking.complete",
  // End of vertical-namespaced rows.
  "payments.read",
  "payments.capture.cash",
  "payments.khqr.create",
  "payments.refund.request",
  "payments.refund.approve",
  "payments.void.request",
  "inventory.movements.read",
  "inventory.adjustment.request",
  "inventory.adjustment.approve",
];

/**
 * @deprecated Retained as the historical export name; identical to
 * `CANONICAL_PERMISSION_KEYS`. The former four-key seed set was drawn from
 * infrastructure spec v1.0.0 §16.5 and drifted from the registry
 * (KLREC-2026-07-26-013); the registry is now the single source.
 */
export const KNOWN_PERMISSION_KEYS: readonly PermissionKey[] = CANONICAL_PERMISSION_KEYS;

/**
 * Retired repository seed keys and their approved canonical replacements
 * (KLD-2026-07-26-002 Group 3). This map is DOCUMENTATION AND TEST DATA ONLY —
 * there is no runtime alias layer, because no affected key was ever deployed.
 * Every left-hand key is permanently invalid and must fail closed.
 */
export const RETIRED_PERMISSION_KEYS: Readonly<Record<string, readonly PermissionKey[]>> = {
  "releases.promote.stable": ["releases.promote_stable"],
  "infrastructure.backup.restore": [
    "platform.backup.restore_production",
    "platform.backup.restore_test",
  ],
  "security.certificates.rotate": ["devices.certificate.rotate"],
};

const CANONICAL_PERMISSION_KEY_SET: ReadonlySet<string> = new Set<string>(
  CANONICAL_PERMISSION_KEYS,
);

/** Thrown when an unregistered or retired permission key reaches an evaluator. */
export class UnknownPermissionKeyError extends Error {
  public readonly permission: string;

  constructor(permission: string) {
    const replacements = RETIRED_PERMISSION_KEYS[permission];
    super(
      replacements === undefined
        ? `Unknown permission key: ${JSON.stringify(permission)}`
        : `Retired permission key: ${JSON.stringify(permission)} (replaced by ${replacements
            .map((k) => JSON.stringify(k))
            .join(", ")})`,
    );
    this.name = "UnknownPermissionKeyError";
    this.permission = permission;
  }
}

/**
 * Authoritative membership check against the canonical registry. Unknown,
 * retired and deprecated keys fail closed (KLD-2026-07-26-002 Group 3).
 */
export function isCanonicalPermissionKey(key: string): boolean {
  return CANONICAL_PERMISSION_KEY_SET.has(key);
}

/** Fail-closed narrowing for untrusted input (tokens, database rows, config). */
export function assertCanonicalPermissionKey(key: string): void {
  if (!isCanonicalPermissionKey(key)) {
    throw new UnknownPermissionKeyError(key);
  }
}

/** An explicit grant: permission + scope. Broad "admin" roles are rejected. */
export interface PermissionGrant {
  readonly permission: PermissionKey;
  readonly scope: ResourceScope;
}

/**
 * Structural permission check: an actor holds the exact registered permission
 * at the exact scope. Hierarchy expansion (e.g. a tenant grant covering its
 * stores) is resolved server-side with hierarchy data before calling this.
 *
 * Deliberately deny-by-default. It NEVER wildcard-matches — production
 * wildcards are prohibited outright (KLD-2026-07-26-002 Group 3) — and it fails
 * closed on any permission key outside the canonical registry, on both the
 * requested key and each stored grant, so a forged or stale grant row cannot
 * authorize anything.
 *
 * Holding the permission is necessary, never sufficient: API scope, environment
 * grant, device/profile authorization and approval policy are checked
 * separately (see the header note on separate authorization dimensions).
 */
export function hasPermission(
  grants: readonly PermissionGrant[],
  permission: PermissionKey,
  scope: ResourceScope,
): boolean {
  if (!isCanonicalPermissionKey(permission)) {
    return false;
  }
  return grants.some(
    (g) =>
      isCanonicalPermissionKey(g.permission) &&
      g.permission === permission &&
      sameScope(g.scope, scope),
  );
}
