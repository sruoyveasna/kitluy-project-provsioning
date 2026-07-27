/**
 * Canonical LOGICAL terminal-profile identifiers for the Edge Operations API.
 *
 * Source authority: KLD-2026-07-26-002 Group 2 (APPROVED, 2026-07-27) — the
 * canonical logical profile identifiers are `laundry.t1.intake_cashier`,
 * `laundry.t2.customer_display`, `laundry.t3.ready_scan_in` and
 * `laundry.t4.pickup_scan_out`. The retired identifiers `t2_scan_in` and
 * `t3_scan_out` must never be reused.
 *
 * COUPLING NOTE (deliberate duplication, do not "fix" by importing):
 * `verticals/phase1-laundry` and `services/kitluy-hub-agent` carry their own
 * profile identifiers and are being renamed under a separate governed change.
 * Neutral Core (`packages/`) must never depend on a vertical package
 * (CLAUDE.md hard rule 2), so these strings are declared HERE as contract data.
 * When the vertical rename lands, both sides must resolve to the identical
 * strings below; `test/edge-routes.test.ts` locks the values on this side.
 *
 * A logical profile identifier is NOT a permission grant, a device assignment,
 * a resource scope, an environment scope, an approval or a physical hardware
 * profile (KLD-2026-07-26-002 Group 2). Physical device-profile codes such as
 * `laundry_front_counter` are a separate dimension and are intentionally absent.
 */

/** T1 — POS Cashier / Intake. */
export const TERMINAL_PROFILE_T1_INTAKE_CASHIER = "laundry.t1.intake_cashier";

/** T2 — Customer Display Screen. No independent operational authority. */
export const TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY = "laundry.t2.customer_display";

/** T3 — Clean & Ready Scan-In. */
export const TERMINAL_PROFILE_T3_READY_SCAN_IN = "laundry.t3.ready_scan_in";

/** T4 — Customer Pickup Scan-Out. */
export const TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT = "laundry.t4.pickup_scan_out";

/** The owner-locked T1–T4 model, in order (CLAUDE.md hard rule 10). */
export const LOGICAL_TERMINAL_PROFILES = [
  TERMINAL_PROFILE_T1_INTAKE_CASHIER,
  TERMINAL_PROFILE_T2_CUSTOMER_DISPLAY,
  TERMINAL_PROFILE_T3_READY_SCAN_IN,
  TERMINAL_PROFILE_T4_PICKUP_SCAN_OUT,
] as const;

export type TerminalProfileId = (typeof LOGICAL_TERMINAL_PROFILES)[number];

/**
 * Identifiers retired by KLD-2026-07-26-002 Group 2. They must never appear in
 * any registry entry, alias table or runtime mapping.
 */
export const RETIRED_TERMINAL_PROFILE_IDS = ["t2_scan_in", "t3_scan_out"] as const;

/** Canonical dotted grammar for a logical profile: `<vertical>.<terminal>.<role>`. */
export const TERMINAL_PROFILE_PATTERN = /^[a-z][a-z0-9_]*\.t[1-9][0-9]*\.[a-z][a-z0-9_]*$/;
