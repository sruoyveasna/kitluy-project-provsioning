/**
 * @kitluy/rbac — explicit permission keys and evaluation contract.
 *
 * Source authority: rebuild bible v4.0.0 §8.2 — authorization combines
 * identity, team, role-template version, EXPLICIT permission grant, resource
 * scope, environment scope, approval state and more. "Team membership alone
 * never grants permission" (Admin spec v3.1.0). Frontend controls are
 * convenience only; API policy and RLS are authoritative.
 *
 * The full permission-key registry belongs to
 * docs/security/rbac-permission-registry (pending). Keys here are the ones
 * named verbatim in canonical specs (infrastructure spec v1.0.0 §16.5).
 *
 * STATUS: BUILT + TESTED (test/rbac.test.ts).
 */
import type { ResourceScope } from "@kitluy/resource-scope";
import { sameScope } from "@kitluy/resource-scope";

/** A permission key is a dot-separated, lowercase, stable identifier. */
export type PermissionKey = string;

const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function isValidPermissionKey(key: string): boolean {
  return PERMISSION_KEY_PATTERN.test(key);
}

/** Permission keys named in infrastructure spec v1.0.0 §16.5 (seed set). */
export const KNOWN_PERMISSION_KEYS: readonly PermissionKey[] = [
  "platform.jobs.retry",
  "infrastructure.backup.restore",
  "releases.promote.stable",
  "security.certificates.rotate",
];

/** An explicit grant: permission + scope. Broad "admin" roles are rejected. */
export interface PermissionGrant {
  readonly permission: PermissionKey;
  readonly scope: ResourceScope;
}

/**
 * Structural permission check: an actor holds the exact permission at the
 * exact scope. Hierarchy expansion (e.g. tenant grant covering its stores) is
 * resolved server-side with hierarchy data before calling this. This helper is
 * deliberately deny-by-default and never wildcard-matches.
 */
export function hasPermission(
  grants: readonly PermissionGrant[],
  permission: PermissionKey,
  scope: ResourceScope,
): boolean {
  return grants.some((g) => g.permission === permission && sameScope(g.scope, scope));
}
