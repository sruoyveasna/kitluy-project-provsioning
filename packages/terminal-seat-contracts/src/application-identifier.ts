/**
 * Generic application identifier contract — TERMINAL-APPLICATION-ASSIGNMENT-001.
 *
 * An APPLICATION is the installable/runnable unit a Terminal Seat is expected
 * to carry (for the active Phase 1 vertical that is one POS application). It is
 * a third dimension, distinct from:
 *
 *   - the TERMINAL PROFILE, which names the terminal's ROLE inside a Store
 *     (`<vertical>.t<n>.<role>`, KLD-2026-07-26-002 Group 2), and
 *   - the ALLOWED SURFACES, which the Partner configures per seat
 *     (`./allowed-surfaces.ts`).
 *
 * Applications are SERVER-DERIVED from the Store's authoritative primary
 * vertical and the seat's assigned profiles (`./terminal-seat.ts`). The Partner
 * never picks an application directly, and a terminal never chooses one for
 * itself — a Café POS cannot be attached to a Laundry Store because no
 * derivation path produces it, and an explicit attempt is refused.
 *
 * NEUTRAL CORE (CLAUDE.md hard rule 2). Nothing here knows any vertical. The
 * only vertical-bound value is the registry's `VerticalKey`, which is a
 * registry identifier, not domain behaviour. Concrete descriptors are declared
 * by vertical packages and REGISTERED explicitly; there is no discovery.
 *
 * FAIL CLOSED. An identifier that does not parse, is not registered, or names a
 * vertical other than the one it is being used for, refuses.
 */
import type { KitluyErrorLike, Result, VerticalKey } from "@kitluy/shared-types";
import { VERTICAL_PHASES, err, ok } from "@kitluy/shared-types";

/**
 * `<vertical>.<application>` — lowercase, dot-separated, exactly two segments.
 *
 * Two segments, not three: an application is scoped to a vertical, not to a
 * terminal. The same application may run on several seats with different
 * profiles; which seats is the derivation's job, not the identifier's.
 */
export const APPLICATION_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export type ApplicationIdentifier = string & { readonly __brand: "ApplicationIdentifier" };

export const APPLICATION_REFUSALS = {
  MALFORMED_IDENTIFIER: "terminal_seat.application.malformed",
  UNKNOWN_VERTICAL: "terminal_seat.application.unknown_vertical",
  UNKNOWN_APPLICATION: "terminal_seat.application.unknown",
  DUPLICATE_REGISTRATION: "terminal_seat.application.duplicate_registration",
  /** The application's vertical is not the Store's vertical. Never reconciled. */
  CROSS_VERTICAL: "terminal_seat.application.cross_vertical",
} as const;

export type ApplicationRefusalCode = (typeof APPLICATION_REFUSALS)[keyof typeof APPLICATION_REFUSALS];

const VERTICAL_KEYS: ReadonlySet<string> = new Set(VERTICAL_PHASES.map((v) => v.key));

const refuse = (code: ApplicationRefusalCode, message: string): KitluyErrorLike => ({
  code,
  message,
});

export interface ParsedApplicationIdentifier {
  readonly id: ApplicationIdentifier;
  readonly vertical: VerticalKey;
  readonly application: string;
}

/** Parse and narrow an untrusted string. The vertical segment must be a registry key. */
export function parseApplicationIdentifier(value: string): Result<ParsedApplicationIdentifier> {
  if (!APPLICATION_IDENTIFIER_PATTERN.test(value)) {
    return err(
      refuse(
        APPLICATION_REFUSALS.MALFORMED_IDENTIFIER,
        `Application identifier must be '<vertical>.<application>'; received '${value}'.`,
      ),
    );
  }
  const [vertical, application] = value.split(".") as [string, string];
  if (!VERTICAL_KEYS.has(vertical)) {
    return err(
      refuse(
        APPLICATION_REFUSALS.UNKNOWN_VERTICAL,
        `Application '${value}' names vertical '${vertical}', which is not a registered vertical.`,
      ),
    );
  }
  return ok({ id: value as ApplicationIdentifier, vertical: vertical as VerticalKey, application });
}

/**
 * What a vertical package declares about one application.
 *
 * `appliesToProfileCodes` is the derivation rule: the application is desired on
 * a seat when the seat's vertical matches AND at least one assigned profile is
 * in this list. An empty list means the application is never derived — a
 * registered-but-not-yet-defined application (a Phase 2 placeholder) declares
 * nothing rather than guessing.
 */
export interface ApplicationDescriptor {
  readonly id: ApplicationIdentifier;
  readonly vertical: VerticalKey;
  readonly displayName: string;
  readonly appliesToProfileCodes: readonly string[];
  /** Authority reference for the declaration — a decision id, never prose. */
  readonly provenance: string;
}

/**
 * Explicit registry. Modules are compiled in and registered by the composing
 * app or service; a rogue file cannot introduce an application at runtime.
 */
export class ApplicationRegistry {
  private readonly byId: ReadonlyMap<ApplicationIdentifier, ApplicationDescriptor>;

  private constructor(byId: ReadonlyMap<ApplicationIdentifier, ApplicationDescriptor>) {
    this.byId = byId;
  }

  static create(descriptors: readonly ApplicationDescriptor[]): Result<ApplicationRegistry> {
    const map = new Map<ApplicationIdentifier, ApplicationDescriptor>();
    for (const d of descriptors) {
      const parsed = parseApplicationIdentifier(d.id);
      if (!parsed.ok) return parsed;
      if (parsed.value.vertical !== d.vertical) {
        return err(
          refuse(
            APPLICATION_REFUSALS.CROSS_VERTICAL,
            `Application '${d.id}' is declared for vertical '${d.vertical}' but its identifier names '${parsed.value.vertical}'.`,
          ),
        );
      }
      if (map.has(d.id)) {
        return err(
          refuse(
            APPLICATION_REFUSALS.DUPLICATE_REGISTRATION,
            `Application '${d.id}' is registered twice. Each application has exactly one descriptor.`,
          ),
        );
      }
      map.set(d.id, d);
    }
    return ok(new ApplicationRegistry(map));
  }

  /** Every registered descriptor, including ones that derive nothing. */
  registered(): readonly ApplicationDescriptor[] {
    return [...this.byId.values()];
  }

  get(id: string): ApplicationDescriptor | undefined {
    return this.byId.get(id as ApplicationIdentifier);
  }

  /** Narrow an untrusted identifier to a registered one, or refuse. */
  require(id: string): Result<ApplicationDescriptor> {
    const parsed = parseApplicationIdentifier(id);
    if (!parsed.ok) return parsed;
    const found = this.byId.get(parsed.value.id);
    if (found === undefined) {
      return err(
        refuse(
          APPLICATION_REFUSALS.UNKNOWN_APPLICATION,
          `Application '${id}' is not registered. Unknown applications are refused, never installed.`,
        ),
      );
    }
    return ok(found);
  }

  /**
   * Refuse any application whose vertical is not `vertical`.
   *
   * This is the guard behind "the Partner cannot select Café POS on a Laundry
   * Store" (mission requirement 6): even a caller that bypasses derivation and
   * names an application explicitly cannot cross verticals.
   */
  requireAllForVertical(ids: readonly string[], vertical: VerticalKey): Result<readonly ApplicationDescriptor[]> {
    const out: ApplicationDescriptor[] = [];
    for (const id of ids) {
      const required = this.require(id);
      if (!required.ok) return required;
      if (required.value.vertical !== vertical) {
        return err(
          refuse(
            APPLICATION_REFUSALS.CROSS_VERTICAL,
            `Application '${id}' belongs to vertical '${required.value.vertical}' and cannot be assigned in a '${vertical}' Store.`,
          ),
        );
      }
      out.push(required.value);
    }
    return ok(out);
  }
}
