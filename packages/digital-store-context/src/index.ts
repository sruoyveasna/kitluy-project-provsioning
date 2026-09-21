/**
 * @kitluy/digital-store-context — Digital Store control-plane context:
 * one primary vertical per Digital Store.
 *
 * Source authority:
 *   - rebuild bible v4.0.0 §2.1 — the eight locked vertical phases
 *     (registry: `VERTICAL_PHASES` / `VerticalKey` in `@kitluy/shared-types`).
 *   - rebuild bible v4.0.0 §3.2 — a Digital Store is the authoritative store
 *     control plane with exactly ONE primary vertical.
 *   - PROJECT_HOME.md §3.3 — vertical isolation: a Partner operating different
 *     business types creates separate Digital Stores.
 *   - Owner decision 2026-08-07 (POS unification) — ONE POS Desktop application
 *     resolves its experience from authoritative Digital Store assignment; the
 *     local user may never turn a terminal into another business vertical.
 *   - KLD-2026-07-26-002 Group 2 — canonical dot-separated logical terminal
 *     profile vocabulary `<vertical>.<terminal>.<role>`.
 *
 * STATUS: MIGRATED-NOT-YET-ACCEPTED (owner decision 2026-08-07 §23). This
 * module is new canonical implementation, not a ported legacy unit. It does not
 * mark any locked WS-12 task complete.
 *
 * NEUTRAL CORE. This package contains no vertical-specific terminology or
 * behavior. `VerticalKey` values are registry identifiers, not domain logic;
 * nothing here knows what a garment or a table is.
 *
 * FAIL CLOSED. Every ambiguity, mismatch or unknown value refuses. A terminal
 * that cannot prove which vertical it is authorised for does not guess.
 */
import { isVerticalActive } from "@kitluy/feature-flags";
import type { KitluyErrorLike, Result, VerticalKey } from "@kitluy/shared-types";
import { VERTICAL_PHASES, err, ok } from "@kitluy/shared-types";

export const PACKAGE_NAME = "@kitluy/digital-store-context" as const;

/** Registry lookup — the eight locked keys, no local extension. */
const VERTICAL_KEYS: ReadonlySet<string> = new Set(VERTICAL_PHASES.map((v) => v.key));

/** Narrow an untrusted string to a registry `VerticalKey`. */
export function isVerticalKey(value: string): value is VerticalKey {
  return VERTICAL_KEYS.has(value);
}

/**
 * Refusal codes. Every one is a fail-closed outcome: the shell must NOT load a
 * vertical experience when a refusal is returned.
 */
export const VERTICAL_RESOLUTION_REFUSALS = {
  /** The signed configuration carried no usable vertical evidence. */
  NO_VERTICAL_EVIDENCE: "digital_store.vertical.no_evidence",
  /** A value was present but is not one of the eight registry keys. */
  UNKNOWN_VERTICAL: "digital_store.vertical.unknown",
  /** The terminal profile code is not the canonical dotted vocabulary. */
  MALFORMED_PROFILE_CODE: "digital_store.terminal_profile.malformed",
  /** Explicit vertical and profile-code prefix disagree — never reconciled. */
  VERTICAL_PROFILE_MISMATCH: "digital_store.vertical.profile_mismatch",
  /** The vertical is registered but its phase gate is not ACTIVE. */
  VERTICAL_NOT_ACTIVE: "digital_store.vertical.not_active",
  /** Required authoritative scope identifiers were absent. */
  INCOMPLETE_ASSIGNMENT: "digital_store.assignment.incomplete",
} as const;

export type VerticalResolutionRefusalCode =
  (typeof VERTICAL_RESOLUTION_REFUSALS)[keyof typeof VERTICAL_RESOLUTION_REFUSALS];

/**
 * The authoritative inputs for vertical resolution.
 *
 * These fields come from the Hub-attested signed configuration envelope
 * (`ConfigurationDeliveryEnvelopeWire`) and the Hub staff session. They are
 * NEVER read from a local dropdown, `localStorage`, a hand-edited file, the
 * hostname, the IP address or the screen size (owner decision 2026-08-07 §17).
 */
export interface AuthoritativeStoreAssignment {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly terminalDeviceId: string;
  /** Canonical dotted logical profile, e.g. `<vertical>.<terminal>.<role>`. */
  readonly terminalProfileCode: string;
  /** Monotonic assignment generation from the signed envelope. */
  readonly assignmentGeneration: number;
  /** Configuration version the decision was taken against. */
  readonly configurationVersion: number;
  /**
   * The Digital Store's EXPLICIT primary vertical, from the Hub-signed
   * configuration delivery (`TerminalConfigurationDelivery.primaryVertical`,
   * v2). REQUIRED since TERMINAL-APPLICATION-ASSIGNMENT-001 resolved
   * `KLREQ-VERTICAL-ENVELOPE-001`: an assignment with no declared vertical is
   * refused, never derived.
   */
  readonly declaredVertical: string;
}

/** The resolved, authorised context the POS shell may act on. */
export interface ResolvedStoreContext {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly terminalDeviceId: string;
  readonly vertical: VerticalKey;
  readonly terminalProfileCode: string;
  /** Terminal segment of the profile code, e.g. the `t1` in `x.t1.y`. */
  readonly terminalSegment: string;
  readonly assignmentGeneration: number;
  readonly configurationVersion: number;
  /**
   * How the vertical was established. Always `"declared"` since v2; the
   * literal union is kept so consumers written against the transitional
   * contract still type-check, but `"derived_from_profile_code"` is no longer
   * produced by this function.
   */
  readonly verticalSource: "declared" | "derived_from_profile_code";
}

/**
 * EXPLICIT-VERTICAL-WITH-PREFIX-CROSS-CHECK — the state after
 * TERMINAL-APPLICATION-ASSIGNMENT-001 resolved `KLREQ-VERTICAL-ENVELOPE-001`.
 *
 * Canonical truth for the business vertical is `Digital Store.primary_vertical`.
 * Since delivery v2 the Hub signs it into `TerminalConfigurationDelivery.
 * primaryVertical`, and it arrives here as `declaredVertical`. The terminal
 * profile describes the terminal's ROLE INSIDE that Store; its prefix is
 * retained ONLY as a cross-check. The previous TEMPORARY-COMPATIBILITY-
 * DERIVATION (KLD-2026-08-07-BOOKING-SEMANTICS-001 §5) is retired: an
 * assignment without a declared vertical now REFUSES instead of deriving one.
 *
 * The fail-closed protection is unchanged and must NOT be weakened:
 *
 *     explicit vertical + profile prefix + disagreement -> REFUSE
 *     no explicit vertical                              -> REFUSE
 */
export const VERTICAL_DERIVATION_STATUS = "EXPLICIT-VERTICAL-WITH-PREFIX-CROSS-CHECK" as const;

/** The item this contract change resolved. Kept as a stable reference. */
export const VERTICAL_ENVELOPE_FOLLOW_UP = "KLREQ-VERTICAL-ENVELOPE-001" as const;

export const VERTICAL_EVIDENCE_NOTE: string =
  "EXPLICIT-VERTICAL-WITH-PREFIX-CROSS-CHECK (TERMINAL-APPLICATION-ASSIGNMENT-001, " +
  "resolving KLREQ-VERTICAL-ENVELOPE-001). Canonical vertical truth is " +
  "Digital Store.primary_vertical, signed by the Hub into the v2 configuration " +
  "delivery. The terminalProfileCode prefix is a cross-check only; disagreement " +
  "refuses, and a missing declared vertical refuses.";

const refuse = (code: VerticalResolutionRefusalCode, message: string): KitluyErrorLike => ({
  code,
  message,
});

/**
 * Parse the canonical dotted logical terminal profile `<vertical>.<terminal>.<role>`.
 *
 * Neutral: no vertical is privileged and no terminal vocabulary is hardcoded.
 */
export function parseTerminalProfileCode(
  code: string,
): Result<{ readonly verticalSegment: string; readonly terminalSegment: string }> {
  const segments = code.split(".");
  if (segments.length < 3 || segments.some((s) => s.length === 0)) {
    return err(
      refuse(
        VERTICAL_RESOLUTION_REFUSALS.MALFORMED_PROFILE_CODE,
        `Terminal profile code must be '<vertical>.<terminal>.<role>'; received '${code}'.`,
      ),
    );
  }
  return ok({ verticalSegment: segments[0]!, terminalSegment: segments[1]! });
}

/**
 * Resolve the vertical experience this terminal is authorised to load.
 *
 * Refuses — never guesses — when evidence is missing, unknown, contradictory,
 * or when the resolved vertical's phase gate is not ACTIVE. A registered but
 * inactive vertical (Phases 2-8) is a refusal at runtime even though its module
 * may be present in the repository.
 */
export function resolveStoreContext(
  assignment: AuthoritativeStoreAssignment,
): Result<ResolvedStoreContext> {
  const { tenantId, digitalStoreId, storeLocationId, terminalDeviceId } = assignment;
  if (!tenantId || !digitalStoreId || !storeLocationId || !terminalDeviceId) {
    return err(
      refuse(
        VERTICAL_RESOLUTION_REFUSALS.INCOMPLETE_ASSIGNMENT,
        "Tenant, Digital Store, Store Location and terminal device identifiers are all required.",
      ),
    );
  }

  const parsed = parseTerminalProfileCode(assignment.terminalProfileCode);
  if (!parsed.ok) return parsed;
  const { verticalSegment, terminalSegment } = parsed.value;

  const declared = assignment.declaredVertical;

  // The explicit vertical is REQUIRED. Absence is refused, never derived.
  if (typeof declared !== "string" || declared.length === 0) {
    return err(
      refuse(
        VERTICAL_RESOLUTION_REFUSALS.NO_VERTICAL_EVIDENCE,
        "The signed configuration carries no explicit primary vertical.",
      ),
    );
  }

  // Cross-check: the profile prefix must agree. Never used to "correct" it.
  if (declared !== verticalSegment) {
    return err(
      refuse(
        VERTICAL_RESOLUTION_REFUSALS.VERTICAL_PROFILE_MISMATCH,
        `Declared vertical '${declared}' contradicts terminal profile prefix '${verticalSegment}'.`,
      ),
    );
  }

  const candidate = declared;
  if (!isVerticalKey(candidate)) {
    return err(
      refuse(
        VERTICAL_RESOLUTION_REFUSALS.UNKNOWN_VERTICAL,
        `'${candidate}' is not one of the eight locked vertical phases.`,
      ),
    );
  }
  if (!isVerticalActive(candidate)) {
    return err(
      refuse(
        VERTICAL_RESOLUTION_REFUSALS.VERTICAL_NOT_ACTIVE,
        `Vertical '${candidate}' is registered but its phase gate is not ACTIVE.`,
      ),
    );
  }

  return ok({
    tenantId,
    digitalStoreId,
    storeLocationId,
    terminalDeviceId,
    vertical: candidate,
    terminalProfileCode: assignment.terminalProfileCode,
    terminalSegment,
    assignmentGeneration: assignment.assignmentGeneration,
    configurationVersion: assignment.configurationVersion,
    verticalSource: "declared",
  });
}
