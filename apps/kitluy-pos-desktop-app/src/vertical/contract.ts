/**
 * Vertical module contract — the ONE registration boundary for the single
 * KitLuy POS Desktop application.
 *
 * Source authority: owner decision 2026-08-07 (POS unification) §2, §18 —
 * KitLuy has ONE POS Desktop application; business-specific experiences load
 * through vertical modules registered against a stable contract rather than
 * hard-coded branching throughout the shell.
 *
 * STATUS: MIGRATED-NOT-YET-ACCEPTED. New canonical shell architecture. It does
 * not mark any locked WS-12 task complete and creates no Booking, pricing,
 * payment, receipt or printing behaviour.
 *
 * This is an INTERNAL modular architecture. It is deliberately NOT an
 * externally installable plugin system (owner decision §18).
 */
import type { ApplicationDescriptor } from "@kitluy/terminal-seat-contracts";
import type { VerticalKey } from "@kitluy/shared-types";

/**
 * Lifecycle state of a registered vertical module, distinct from the phase gate.
 *
 * A module may be present and structurally loadable in development while its
 * vertical's phase gate is `REGISTERED_INACTIVE` — that is exactly how Phase 2
 * café/restaurant implementation is preserved without becoming Phase 1
 * functionality (owner decision §7).
 */
export type VerticalModuleState =
  /** Active Phase 1 experience; may be loaded in production. */
  | "ACTIVE_PHASE1"
  /** Present and registered; must NOT load as production Phase 1. */
  | "REGISTERED_INACTIVE_PHASE2"
  /** Reserved boundary only; no implementation yet. */
  | "RESERVED";

/** A terminal experience within a vertical, keyed by terminal segment. */
export interface VerticalTerminalExperience {
  /** Terminal segment of the canonical profile code, e.g. `t1`. */
  readonly terminalSegment: string;
  /** Full canonical logical profile code this experience serves. */
  readonly terminalProfileCode: string;
  readonly displayName: string;
  /**
   * Permission keys the experience requires. Presentation is never
   * authorization — the Hub session's effective permissions decide.
   */
  readonly requiredPermissions: readonly string[];
  /** Hardware the experience expects; absence is a degraded-mode concern. */
  readonly requiredHardware: readonly string[];
}

/** A registered vertical experience module. */
export interface VerticalModule {
  readonly key: VerticalKey;
  readonly displayName: string;
  readonly state: VerticalModuleState;
  readonly terminals: readonly VerticalTerminalExperience[];
  /**
   * The applications this vertical declares (TERMINAL-APPLICATION-ASSIGNMENT-001).
   * Registered into an `ApplicationRegistry` by the composing shell; derived
   * per seat by `@kitluy/terminal-seat-contracts`, never selected. Empty for a
   * vertical whose applications are not yet defined — declaring one would
   * overstate what exists.
   */
  readonly applications: readonly ApplicationDescriptor[];
  /**
   * Source provenance — which implementation this experience derives from.
   * Required because the donor repositories will eventually be retired
   * (owner decision §24).
   */
  readonly provenance: string;
}

/** Refusals from the shell's vertical host. All are fail-closed. */
export const VERTICAL_HOST_REFUSALS = {
  /** No module is registered for the resolved vertical. */
  NO_MODULE_REGISTERED: "pos.vertical_host.no_module",
  /** The module exists but is not an active Phase 1 experience. */
  MODULE_NOT_ACTIVE: "pos.vertical_host.module_not_active",
  /** The module has no experience for the assigned terminal profile. */
  NO_TERMINAL_EXPERIENCE: "pos.vertical_host.no_terminal_experience",
} as const;

export type VerticalHostRefusalCode =
  (typeof VERTICAL_HOST_REFUSALS)[keyof typeof VERTICAL_HOST_REFUSALS];
