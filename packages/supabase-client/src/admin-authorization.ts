/**
 * Admin authorization resolution over the CANONICAL chain.
 *
 * Verified against the deployed schema (2026-08-10):
 *
 *   auth.users.id
 *     -> kitluy_auth.admin_user_profiles.user_id   (status, disabled_at)
 *     -> kitluy_auth.team_memberships.user_id      -> teams
 *     -> kitluy_auth.role_assignments              (status, valid_from, valid_to)
 *     -> kitluy_auth.role_permission_grants        -> kitluy_auth.permissions
 *     -> kitluy_auth.assignment_scopes             (resource scope)
 *
 * ===========================================================================
 * AUTHENTICATION IS NOT AUTHORIZATION
 * ===========================================================================
 * A valid Supabase session proves only that someone signed in. It says nothing
 * about whether they may enter the KitLuy control plane. This module turns
 * canonical facts into a decision, and it FAILS CLOSED: any fact it cannot
 * read is a denial, never a default-allow.
 *
 * NO TABLE IS CREATED HERE. This reads the authorization model that migration
 * groups 0010–0035 already own.
 *
 * ===========================================================================
 * THIS IS NOT THE SECURITY BOUNDARY
 * ===========================================================================
 * RLS is. This exists so the UI can show "access denied" instead of an empty
 * screen, and so a route guard has something to consult. A user who defeats
 * this still reads nothing, because every query runs under their own JWT.
 * Frontend visibility is not authorization (CLAUDE.md hard rule 7).
 */

/** Minimal query port — satisfied by a Supabase client or a fake. */
export interface AdminAuthorizationSource {
  /**
   * Resolve the signed-in user's canonical Admin facts, or null when the user
   * has no Admin profile at all.
   */
  loadAdminFacts(userId: string): Promise<AdminFacts | null>;
}

export interface AdminFacts {
  readonly userId: string;
  /** `kitluy_auth.admin_user_profiles.status` */
  readonly profileStatus: string;
  /** `kitluy_auth.admin_user_profiles.disabled_at` — non-null means disabled. */
  readonly disabledAt: string | null;
  readonly roleAssignments: readonly RoleAssignmentFact[];
  /** Permission keys reachable through active assignments. */
  readonly permissionKeys: readonly string[];
}

export interface RoleAssignmentFact {
  readonly roleTemplateKey: string;
  /** `kitluy_auth.role_assignments.status` */
  readonly status: string;
  readonly validFrom: string | null;
  readonly validTo: string | null;
}

export type AdminAuthorization =
  | {
      readonly kind: "authorized";
      readonly userId: string;
      readonly permissionKeys: readonly string[];
    }
  | { readonly kind: "denied"; readonly reason: AdminDenialReason; readonly detail: string };

export type AdminDenialReason =
  | "no_session"
  | "no_admin_profile"
  | "profile_disabled"
  | "profile_inactive"
  | "no_active_role_assignment"
  | "missing_permission";

// Canonical status vocabulary is UPPERCASE, verified against the deployed
// schema and against `kitluy_auth.has_permission`, which tests `status = 'ACTIVE'`.
// `team_memberships` constrains it explicitly:
//   CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','EXPIRED','REVOKED'))
// Comparison is case-sensitive on purpose: silently accepting 'active' would
// let a row that canonical SQL treats as inactive read as authorized here.
const ACTIVE_PROFILE_STATUSES: ReadonlySet<string> = new Set(["ACTIVE"]);
const ACTIVE_ASSIGNMENT_STATUSES: ReadonlySet<string> = new Set(["ACTIVE"]);

/**
 * Is this assignment in force at `now`?
 *
 * An assignment can be `active` and still not apply — `valid_from` in the
 * future or `valid_to` in the past. Checking status alone is the mistake this
 * function exists to avoid, because a revoked-by-expiry role reads as active.
 */
export function assignmentInForce(a: RoleAssignmentFact, now: Date): boolean {
  if (!ACTIVE_ASSIGNMENT_STATUSES.has(a.status)) return false;
  if (a.validFrom !== null && new Date(a.validFrom) > now) return false;
  if (a.validTo !== null && new Date(a.validTo) <= now) return false;
  return true;
}

export interface ResolveAdminInput {
  /** null when there is no Supabase session at all. */
  readonly userId: string | null;
  readonly source: AdminAuthorizationSource;
  /** Permission keys the requested surface requires. Empty = login only. */
  readonly requiredPermissions?: readonly string[];
  readonly now?: Date;
}

/**
 * Resolve whether this user may enter the Admin control plane.
 *
 * Every branch is an explicit denial with a reason, so a route guard can
 * distinguish "sign in" from "you are signed in but not an Admin" — which are
 * very different messages to show a person.
 */
export async function resolveAdminAuthorization(
  input: ResolveAdminInput,
): Promise<AdminAuthorization> {
  const now = input.now ?? new Date();

  if (input.userId === null || input.userId === "") {
    return { kind: "denied", reason: "no_session", detail: "no authenticated session" };
  }

  const facts = await input.source.loadAdminFacts(input.userId);
  if (facts === null) {
    return {
      kind: "denied",
      reason: "no_admin_profile",
      detail: "authenticated user has no Admin profile",
    };
  }

  if (facts.disabledAt !== null) {
    return { kind: "denied", reason: "profile_disabled", detail: "Admin profile is disabled" };
  }
  if (!ACTIVE_PROFILE_STATUSES.has(facts.profileStatus)) {
    return {
      kind: "denied",
      reason: "profile_inactive",
      detail: `Admin profile status is '${facts.profileStatus}'`,
    };
  }

  const inForce = facts.roleAssignments.filter((a) => assignmentInForce(a, now));
  if (inForce.length === 0) {
    return {
      kind: "denied",
      reason: "no_active_role_assignment",
      detail: "no role assignment is currently in force",
    };
  }

  const required = input.requiredPermissions ?? [];
  const held = new Set(facts.permissionKeys);
  const missing = required.filter((p) => !held.has(p));
  if (missing.length > 0) {
    return {
      kind: "denied",
      reason: "missing_permission",
      detail: `missing permission(s): ${missing.join(", ")}`,
    };
  }

  return { kind: "authorized", userId: facts.userId, permissionKeys: facts.permissionKeys };
}

// ---------------------------------------------------------------------------
// Device fleet freshness
// ---------------------------------------------------------------------------

/**
 * Presentation states for a device's liveness.
 *
 * `UNKNOWN` exists because the freshness threshold is an owner value the
 * repository has not ruled. Inventing a number here would turn a policy gap
 * into a number a person trusts — so an unset threshold reports UNKNOWN
 * rather than guessing that, say, five minutes means offline.
 */
export type FleetFreshness = "ONLINE" | "STALE" | "OFFLINE" | "NEVER_SEEN" | "UNKNOWN";

export interface FreshnessPolicy {
  /** Seconds after which a device is STALE. null = policy not ruled. */
  readonly staleAfterSeconds: number | null;
  /** Seconds after which a device is OFFLINE. null = policy not ruled. */
  readonly offlineAfterSeconds: number | null;
}

/**
 * Derive liveness from the last heartbeat.
 *
 * A device row existing is NOT evidence it is online — that is precisely the
 * false reassurance this function refuses to produce.
 */
export function deriveFleetFreshness(
  lastSeenAt: string | null,
  policy: FreshnessPolicy,
  now: Date = new Date(),
): FleetFreshness {
  if (lastSeenAt === null) return "NEVER_SEEN";
  if (policy.staleAfterSeconds === null || policy.offlineAfterSeconds === null) return "UNKNOWN";

  const ageSeconds = (now.getTime() - new Date(lastSeenAt).getTime()) / 1000;
  if (Number.isNaN(ageSeconds)) return "UNKNOWN";
  if (ageSeconds >= policy.offlineAfterSeconds) return "OFFLINE";
  if (ageSeconds >= policy.staleAfterSeconds) return "STALE";
  return "ONLINE";
}
