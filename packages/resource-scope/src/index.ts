/**
 * @kitluy/resource-scope — the canonical resource-scope model.
 *
 * Source authority: rebuild bible v4.0.0 §8.5 — scope levels verbatim; §8.6 —
 * environment scopes are independent grants.
 *
 * STATUS: BUILT (types + ordering helper). Enforcement lives in API policy and
 * PostgreSQL RLS, never in frontend visibility (RB v4 §8.2).
 */
import type { KitluyEnvironment } from "@kitluy/shared-types";

/** Scope levels, broadest to narrowest (RB v4 §8.5). */
export const SCOPE_LEVELS = [
  "platform",
  "region",
  "tenant_or_partner",
  "digital_store",
  "store_location",
  "device_group",
  "individual_device",
  "connector",
  "service",
] as const;
export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

export interface ResourceScope {
  readonly level: ScopeLevel;
  /** Identifier of the scoped resource (branded IDs at call sites). */
  readonly resourceId: string;
  /** Grants are per-environment; no implicit inheritance (RB v4 §8.6). */
  readonly environment: KitluyEnvironment;
}

/**
 * True when `granted` is at least as broad as `requested` in the same
 * environment. This is a structural helper only — the authoritative decision
 * combines identity, role, explicit permission, approval state and RLS
 * (RB v4 §8.2). Containment between different resource IDs at different levels
 * requires the hierarchy data and is resolved server-side.
 */
export function sameScope(granted: ResourceScope, requested: ResourceScope): boolean {
  return (
    granted.environment === requested.environment &&
    granted.level === requested.level &&
    granted.resourceId === requested.resourceId
  );
}

export function scopeBreadth(level: ScopeLevel): number {
  return SCOPE_LEVELS.indexOf(level);
}
