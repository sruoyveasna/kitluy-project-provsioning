/**
 * @kitluy/resource-scope — the canonical resource-scope model.
 *
 * Source authority:
 *   - Resource Scope Model v1.0.0 §3 "Scope types" — canonical taxonomy.
 *   - Owner decision KLD-2026-07-26-002 Group 3 (APPROVED, KL-DEC-001):
 *       tenant_or_partner -> tenant
 *       individual_device -> device
 *     plus the additive types `chain`, `file_object`, `support_session`,
 *     `release_cohort`.
 *   - RB v4 §8.5 (scope levels), §8.6 (environment grants are independent).
 *
 * SEPARATE AUTHORIZATION DIMENSIONS (KLD-2026-07-26-002 Group 3). A resource
 * scope is ONE of six independent dimensions:
 *
 *     permission key | API scope | resource scope | environment scope |
 *     device/profile authorization | approval policy
 *
 * No identifier in this package may collapse those dimensions into one string,
 * and holding a resource scope alone never grants authority. The `environment`
 * field below is carried alongside the level/resourceId pair precisely so the
 * environment dimension is never encoded inside the level or the resource ID.
 *
 * FAIL-CLOSED CONTRACT (KLD-2026-07-26-002 Group 3, "Unknown or deprecated
 * keys fail closed"): unknown, retired or misspelled scope levels are never
 * treated as a usable scope. `scopeBreadth` THROWS rather than returning a
 * sentinel, and `sameScope` returns false when either side carries a level
 * outside `SCOPE_LEVELS`.
 *
 * STATUS: BUILT + TESTED (test/resource-scope.test.ts). Enforcement lives in
 * API policy and PostgreSQL RLS, never in frontend visibility (RB v4 §8.2).
 */
import type { KitluyEnvironment } from "@kitluy/shared-types";

/**
 * The hierarchical spine, broadest to narrowest (Resource Scope Model §2, §3).
 *
 * `chain` sits between `tenant` and `digital_store`: a chain is an approved
 * multi-store governance boundary owned inside a Tenant that projects onto
 * participating Digital Stores (Resource Scope Model §3 and §6 rule 10). It is
 * therefore narrower than the Tenant and broader than a single Digital Store.
 *
 * Containment along this spine is NEVER implicit: inheritance is denied by
 * default and is resolved server-side with `resource_relationships` data
 * (Resource Scope Model §6 rules 1-4). Position here expresses breadth only.
 */
export const HIERARCHICAL_SCOPE_LEVELS = [
  "platform",
  "region",
  "tenant",
  "chain",
  "digital_store",
  "store_location",
  "device_group",
  "device",
] as const;

/**
 * Narrow, non-hierarchical resource kinds (Resource Scope Model §3).
 *
 * PLACEMENT DECISION (KL-DEC-001-T003): these levels bind to a single governed
 * object or to an explicitly enumerated snapshot; they are not parents or
 * children of the spine above, so they are appended after it rather than
 * interleaved. They are ordered by the size of the object set they may cover —
 * `release_cohort` (a snapshot of many devices) through `file_object` (exactly
 * one object) — purely so `scopeBreadth` is total and deterministic. A lower
 * index across this group is NOT containment: a `connector` scope grants
 * nothing over a `service`, a `support_session` grants only the resources
 * listed in the consent record, and a `release_cohort` grants only snapshot
 * members (Resource Scope Model §3, §6 rule 5). Use `isHierarchicalScopeLevel`
 * before reasoning about breadth as containment.
 */
export const NON_HIERARCHICAL_SCOPE_LEVELS = [
  "connector",
  "service",
  "release_cohort",
  "support_session",
  "file_object",
] as const;

/** Canonical scope levels (Resource Scope Model v1.0.0 §3). */
export const SCOPE_LEVELS = [
  ...HIERARCHICAL_SCOPE_LEVELS,
  ...NON_HIERARCHICAL_SCOPE_LEVELS,
] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

/**
 * Retired scope-level spellings (KLD-2026-07-26-002 Group 3). Kept only so the
 * reconciliation mapping is legible in code review and so tests can assert the
 * old spellings are rejected. They are never valid input and there is
 * deliberately no runtime alias layer — no affected identifier was deployed.
 */
export const RETIRED_SCOPE_LEVELS: Readonly<Record<string, ScopeLevel>> = {
  tenant_or_partner: "tenant",
  individual_device: "device",
};

const SCOPE_LEVEL_SET: ReadonlySet<string> = new Set<string>(SCOPE_LEVELS);
const HIERARCHICAL_SCOPE_LEVEL_SET: ReadonlySet<string> = new Set<string>(
  HIERARCHICAL_SCOPE_LEVELS,
);

/** Thrown when an unknown or retired scope level reaches a scope helper. */
export class UnknownScopeLevelError extends Error {
  public readonly level: string;

  constructor(level: string) {
    const replacement = RETIRED_SCOPE_LEVELS[level];
    super(
      replacement === undefined
        ? `Unknown resource scope level: ${JSON.stringify(level)}`
        : `Retired resource scope level: ${JSON.stringify(level)} (replaced by ${JSON.stringify(replacement)})`,
    );
    this.name = "UnknownScopeLevelError";
    this.level = level;
  }
}

/** Type guard: `value` is one of the canonical scope levels. */
export function isScopeLevel(value: string): value is ScopeLevel {
  return SCOPE_LEVEL_SET.has(value);
}

/** True when the level participates in the hierarchical containment spine. */
export function isHierarchicalScopeLevel(level: ScopeLevel): boolean {
  return HIERARCHICAL_SCOPE_LEVEL_SET.has(level);
}

/** Fail-closed narrowing for untrusted input (config, database rows, tokens). */
export function assertScopeLevel(value: string): asserts value is ScopeLevel {
  if (!isScopeLevel(value)) {
    throw new UnknownScopeLevelError(value);
  }
}

export interface ResourceScope {
  readonly level: ScopeLevel;
  /** Identifier of the scoped resource (branded IDs at call sites). */
  readonly resourceId: string;
  /** Grants are per-environment; no implicit inheritance (RB v4 §8.6). */
  readonly environment: KitluyEnvironment;
}

/**
 * Exact-match scope comparison: same environment, same level, same resource ID.
 *
 * There is NO hierarchy expansion here. Containment between different resource
 * IDs at different levels requires `resource_relationships` data and is
 * resolved server-side (Resource Scope Model §6, §7). The authoritative
 * decision additionally combines identity, role, explicit permission, approval
 * state and RLS (RB v4 §8.2).
 *
 * Fails closed: a scope carrying a level outside `SCOPE_LEVELS` — a retired
 * spelling, a typo, or a value smuggled past the type system from JSON — never
 * matches, even against an identical unknown level.
 */
export function sameScope(granted: ResourceScope, requested: ResourceScope): boolean {
  if (!isScopeLevel(granted.level) || !isScopeLevel(requested.level)) {
    return false;
  }
  return (
    granted.environment === requested.environment &&
    granted.level === requested.level &&
    granted.resourceId === requested.resourceId
  );
}

/**
 * Breadth rank of a scope level: 0 is the broadest (`platform`), higher is
 * narrower. Ordering is only containment-relevant within the hierarchical
 * spine (see `isHierarchicalScopeLevel`).
 *
 * FAIL-CLOSED: throws `UnknownScopeLevelError` for unknown or retired levels.
 * The previous implementation returned `-1`, which sorts as BROADER than
 * `platform` under any naive numeric comparison — an unknown level would have
 * silently outranked every real scope. Throwing forces the caller to deny.
 */
export function scopeBreadth(level: ScopeLevel): number {
  const index = SCOPE_LEVELS.indexOf(level);
  if (index === -1) {
    throw new UnknownScopeLevelError(level);
  }
  return index;
}
