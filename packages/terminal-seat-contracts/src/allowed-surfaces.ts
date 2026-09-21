/**
 * Allowed Surfaces contract — TERMINAL-APPLICATION-ASSIGNMENT-001 requirement 7.
 *
 * A SURFACE is a capability area the terminal's shell may expose to whoever is
 * standing at it (a settings page, a diagnostics page, a kiosk-exit control).
 * It is Partner-configurable per Terminal Seat, and it is deliberately a
 * separate dimension from both:
 *
 *   - the APPLICATION the seat runs (server-derived, never Partner-chosen), and
 *   - the TERMINAL PROFILE authorising what the application may DO.
 *
 * Allowing a surface grants no application and no profile permission. Refusing
 * one removes no authorisation from the application. The two must never be
 * conflated: a Partner hiding the diagnostics page has not revoked anything,
 * and a terminal holding a profile has not thereby earned a settings page.
 *
 * VOCABULARY IS AN OWNER DECISION. This module defines the SHAPE, the registry
 * and the fail-closed validation. It registers NO product surfaces: which
 * surfaces exist is a product definition the owner has not yet made
 * (CLAUDE.md hard rule 9 — unknown owner values are never guessed). A seat
 * with no allowed surfaces exposes nothing beyond its application's own
 * experience.
 *
 * DELIVERY. Allowed surfaces travel in the signed CONFIGURATION payload and are
 * versioned by `configuration_versions`, not by the assignment generation:
 * changing them publishes a newer configuration, which the terminal accepts
 * only if newer (device-side acceptance rule, WS-12-T001). They never change
 * on the Pi locally.
 */
import type { KitluyErrorLike, Result } from "@kitluy/shared-types";
import { err, ok } from "@kitluy/shared-types";

/** `<area>.<surface>` — lowercase, dot-separated, two or more segments. */
export const SURFACE_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export type SurfaceIdentifier = string & { readonly __brand: "SurfaceIdentifier" };

export const SURFACE_REFUSALS = {
  MALFORMED_IDENTIFIER: "terminal_seat.surface.malformed",
  UNKNOWN_SURFACE: "terminal_seat.surface.unknown",
  DUPLICATE_REGISTRATION: "terminal_seat.surface.duplicate_registration",
  DUPLICATE_IN_SET: "terminal_seat.surface.duplicate_in_set",
} as const;

export type SurfaceRefusalCode = (typeof SURFACE_REFUSALS)[keyof typeof SURFACE_REFUSALS];

const refuse = (code: SurfaceRefusalCode, message: string): KitluyErrorLike => ({ code, message });

export function parseSurfaceIdentifier(value: string): Result<SurfaceIdentifier> {
  if (!SURFACE_IDENTIFIER_PATTERN.test(value)) {
    return err(
      refuse(
        SURFACE_REFUSALS.MALFORMED_IDENTIFIER,
        `Surface identifier must be '<area>.<surface>' (lowercase, dotted); received '${value}'.`,
      ),
    );
  }
  return ok(value as SurfaceIdentifier);
}

export interface SurfaceDescriptor {
  readonly id: SurfaceIdentifier;
  readonly displayName: string;
  /** Authority reference for the registration — a decision id, never prose. */
  readonly provenance: string;
}

/** Explicit registry of the surfaces the owner has defined. Empty until then. */
export class SurfaceRegistry {
  private readonly byId: ReadonlyMap<SurfaceIdentifier, SurfaceDescriptor>;

  private constructor(byId: ReadonlyMap<SurfaceIdentifier, SurfaceDescriptor>) {
    this.byId = byId;
  }

  static create(descriptors: readonly SurfaceDescriptor[]): Result<SurfaceRegistry> {
    const map = new Map<SurfaceIdentifier, SurfaceDescriptor>();
    for (const d of descriptors) {
      const parsed = parseSurfaceIdentifier(d.id);
      if (!parsed.ok) return parsed;
      if (map.has(parsed.value)) {
        return err(
          refuse(
            SURFACE_REFUSALS.DUPLICATE_REGISTRATION,
            `Surface '${d.id}' is registered twice.`,
          ),
        );
      }
      map.set(parsed.value, d);
    }
    return ok(new SurfaceRegistry(map));
  }

  /** A registry with nothing in it — the honest state until the owner defines surfaces. */
  static empty(): SurfaceRegistry {
    return new SurfaceRegistry(new Map());
  }

  registered(): readonly SurfaceDescriptor[] {
    return [...this.byId.values()];
  }

  has(id: string): boolean {
    return this.byId.has(id as SurfaceIdentifier);
  }

  /**
   * Validate a Partner-supplied allowed-surface set. Every entry must parse and
   * be registered; duplicates refuse rather than being silently collapsed, so a
   * malformed submission is visible instead of quietly "fixed".
   */
  requireAll(ids: readonly string[]): Result<readonly SurfaceIdentifier[]> {
    const seen = new Set<string>();
    const out: SurfaceIdentifier[] = [];
    for (const id of ids) {
      const parsed = parseSurfaceIdentifier(id);
      if (!parsed.ok) return parsed;
      if (seen.has(parsed.value)) {
        return err(
          refuse(SURFACE_REFUSALS.DUPLICATE_IN_SET, `Surface '${id}' appears more than once in the allowed set.`),
        );
      }
      if (!this.byId.has(parsed.value)) {
        return err(
          refuse(
            SURFACE_REFUSALS.UNKNOWN_SURFACE,
            `Surface '${id}' is not a registered surface. Unknown surfaces are refused, never exposed.`,
          ),
        );
      }
      seen.add(parsed.value);
      out.push(parsed.value);
    }
    return ok(out);
  }
}
