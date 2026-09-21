/**
 * Terminal Seat -> desired applications — TERMINAL-APPLICATION-ASSIGNMENT-001.
 *
 * The chain this formalises (mission target model):
 *
 *   Partner -> Digital Store -> PRIMARY VERTICAL -> Terminal Seat
 *     -> Location
 *     -> Terminal Profiles[]            (Partner-selected at seat definition)
 *     -> Desired Applications[]         (SERVER-DERIVED, this module)
 *     -> Allowed Surfaces[]             (Partner-configurable, separate)
 *   -> Pairing Session -> Physical Pi -> Device Identity -> Store Hub
 *   -> signed assignment/configuration -> installation/runtime -> runtime report
 *
 * WHO DECIDES WHAT.
 *   - The Store's primary vertical is AUTHORITATIVE and EXPLICIT. It is read
 *     from `digital_stores.primary_vertical_code`, carried on the seat, and
 *     (after this task) signed into the terminal's configuration delivery. It
 *     is never derived from a profile prefix as the source of truth — the
 *     prefix is only cross-checked, and disagreement refuses
 *     (resolves `KLREQ-VERTICAL-ENVELOPE-001`).
 *   - Profiles are Partner-selected but validated against that vertical.
 *   - Applications are DERIVED here from vertical + profiles. Nobody selects
 *     them: not the Partner (requirement 6), not the terminal (requirement 2),
 *     not the pairing code (requirement 10).
 *   - Surfaces are Partner-selected, validated separately, and grant nothing.
 *
 * FAIL CLOSED (requirement 12): unknown vertical, malformed profile, a profile
 * from another vertical, an application from another vertical, an unknown
 * surface — every one refuses. A seat that cannot be derived is not installed.
 *
 * NEUTRAL CORE. No vertical is named here. Laundry's descriptor lives in
 * `@kitluy-verticals/phase1-laundry` and is registered by the composing
 * app/service.
 */
import type { KitluyErrorLike, Result, VerticalKey } from "@kitluy/shared-types";
import { VERTICAL_PHASES, err, ok } from "@kitluy/shared-types";

import type { ApplicationDescriptor, ApplicationIdentifier } from "./application-identifier.js";
import { ApplicationRegistry } from "./application-identifier.js";
import type { SurfaceIdentifier } from "./allowed-surfaces.js";
import { SurfaceRegistry } from "./allowed-surfaces.js";

/** `<vertical>.t<n>.<role>` — mirrors group 0213's structural shape rule. */
export const TERMINAL_PROFILE_CODE_PATTERN = /^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$/;

export const TERMINAL_SEAT_REFUSALS = {
  INCOMPLETE_SEAT: "terminal_seat.incomplete",
  UNKNOWN_VERTICAL: "terminal_seat.vertical.unknown",
  NO_PROFILES: "terminal_seat.profiles.none",
  MALFORMED_PROFILE_CODE: "terminal_seat.profile.malformed",
  /** A profile's vertical prefix is not the seat's explicit vertical. */
  PROFILE_VERTICAL_MISMATCH: "terminal_seat.profile.vertical_mismatch",
  DUPLICATE_PROFILE: "terminal_seat.profile.duplicate",
  /** Vertical and profiles are valid, but no registered application applies. */
  NO_APPLICATION_FOR_SEAT: "terminal_seat.application.none_derivable",
} as const;

export type TerminalSeatRefusalCode = (typeof TERMINAL_SEAT_REFUSALS)[keyof typeof TERMINAL_SEAT_REFUSALS];

const VERTICAL_KEYS: ReadonlySet<string> = new Set(VERTICAL_PHASES.map((v) => v.key));

const refuse = (code: TerminalSeatRefusalCode, message: string): KitluyErrorLike => ({ code, message });

/**
 * The seat as the Partner defined it, plus the Store facts it inherits.
 *
 * `primaryVertical` is untrusted here (string) because a seat row is read from
 * storage or from a request; it is narrowed during derivation.
 */
export interface TerminalSeatDefinition {
  readonly seatId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly label: string;
  /** Explicit, from the Digital Store. Never from a profile prefix. */
  readonly primaryVertical: string;
  readonly terminalProfileCodes: readonly string[];
  /** Partner-configurable. Validated against the surface registry. */
  readonly allowedSurfaces: readonly string[];
}

/** What the server derives and what the Partner Portal shows BEFORE pairing. */
export interface TerminalSeatDesiredState {
  readonly seatId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly label: string;
  readonly primaryVertical: VerticalKey;
  readonly terminalProfileCodes: readonly string[];
  readonly desiredApplications: readonly ApplicationIdentifier[];
  readonly allowedSurfaces: readonly SurfaceIdentifier[];
  /** How each application was arrived at — shown to the Partner, never hidden. */
  readonly derivation: readonly ApplicationDerivation[];
}

export interface ApplicationDerivation {
  readonly applicationId: ApplicationIdentifier;
  /** The seat profiles that caused this application to be desired. */
  readonly byProfileCodes: readonly string[];
  readonly provenance: string;
}

export interface DerivationRegistries {
  readonly applications: ApplicationRegistry;
  readonly surfaces: SurfaceRegistry;
}

/** Narrow the explicit vertical, refusing anything outside the registry. */
export function requireVerticalKey(value: string): Result<VerticalKey> {
  if (!VERTICAL_KEYS.has(value)) {
    return err(
      refuse(
        TERMINAL_SEAT_REFUSALS.UNKNOWN_VERTICAL,
        `Vertical '${value}' is not a registered vertical. A seat in an unknown vertical is refused.`,
      ),
    );
  }
  return ok(value as VerticalKey);
}

/**
 * Validate the seat's profile set against its EXPLICIT vertical.
 *
 * The prefix check is a cross-check, not a source of truth: the vertical was
 * given explicitly, and a profile that disagrees with it is refused rather than
 * used to "correct" the vertical.
 */
export function requireProfilesForVertical(
  codes: readonly string[],
  vertical: VerticalKey,
): Result<readonly string[]> {
  if (codes.length === 0) {
    return err(refuse(TERMINAL_SEAT_REFUSALS.NO_PROFILES, "A seat carries at least one terminal profile."));
  }
  const seen = new Set<string>();
  for (const code of codes) {
    if (!TERMINAL_PROFILE_CODE_PATTERN.test(code)) {
      return err(
        refuse(
          TERMINAL_SEAT_REFUSALS.MALFORMED_PROFILE_CODE,
          `Terminal profile code must be '<vertical>.t<n>.<role>'; received '${code}'.`,
        ),
      );
    }
    const prefix = code.split(".")[0];
    if (prefix !== vertical) {
      return err(
        refuse(
          TERMINAL_SEAT_REFUSALS.PROFILE_VERTICAL_MISMATCH,
          `Profile '${code}' belongs to vertical '${prefix}', but the Store's vertical is '${vertical}'. Never reconciled.`,
        ),
      );
    }
    if (seen.has(code)) {
      return err(refuse(TERMINAL_SEAT_REFUSALS.DUPLICATE_PROFILE, `Profile '${code}' appears more than once.`));
    }
    seen.add(code);
  }
  return ok(codes);
}

/**
 * Derive the seat's desired applications. SERVER-SIDE ONLY.
 *
 * Order is deterministic (registry order, then first matching profile) so the
 * same seat always derives the same list — the Partner Portal, the pairing
 * context and the Hub must agree byte-for-byte.
 */
export function deriveTerminalSeatDesiredState(
  seat: TerminalSeatDefinition,
  registries: DerivationRegistries,
): Result<TerminalSeatDesiredState> {
  if (!seat.seatId || !seat.tenantId || !seat.digitalStoreId || !seat.storeLocationId) {
    return err(
      refuse(
        TERMINAL_SEAT_REFUSALS.INCOMPLETE_SEAT,
        "Seat, Tenant, Digital Store and Store Location identifiers are all required.",
      ),
    );
  }

  const vertical = requireVerticalKey(seat.primaryVertical);
  if (!vertical.ok) return vertical;

  const profiles = requireProfilesForVertical(seat.terminalProfileCodes, vertical.value);
  if (!profiles.ok) return profiles;

  const surfaces = registries.surfaces.requireAll(seat.allowedSurfaces);
  if (!surfaces.ok) return surfaces;

  const profileSet = new Set(profiles.value);
  const derivation: ApplicationDerivation[] = [];
  for (const descriptor of registries.applications.registered()) {
    if (descriptor.vertical !== vertical.value) continue;
    const by = descriptor.appliesToProfileCodes.filter((p) => profileSet.has(p));
    if (by.length === 0) continue;
    derivation.push({ applicationId: descriptor.id, byProfileCodes: by, provenance: descriptor.provenance });
  }

  if (derivation.length === 0) {
    return err(
      refuse(
        TERMINAL_SEAT_REFUSALS.NO_APPLICATION_FOR_SEAT,
        `No registered application applies to a '${vertical.value}' seat with profiles [${profiles.value.join(", ")}]. ` +
          "A seat that derives no application is not installable.",
      ),
    );
  }

  return ok({
    seatId: seat.seatId,
    tenantId: seat.tenantId,
    digitalStoreId: seat.digitalStoreId,
    storeLocationId: seat.storeLocationId,
    label: seat.label,
    primaryVertical: vertical.value,
    terminalProfileCodes: profiles.value,
    desiredApplications: derivation.map((d) => d.applicationId),
    allowedSurfaces: surfaces.value,
    derivation,
  });
}

/**
 * Guard for any path that RECEIVES an application list rather than deriving
 * it (a pairing context, a Hub row, a runtime report): every listed
 * application must be registered and belong to the given vertical. This is
 * what makes "Café POS on a Laundry Store" unrepresentable end to end, not
 * merely un-derivable.
 */
export function requireApplicationsForVertical(
  ids: readonly string[],
  vertical: VerticalKey,
  applications: ApplicationRegistry,
): Result<readonly ApplicationDescriptor[]> {
  return applications.requireAllForVertical(ids, vertical);
}
