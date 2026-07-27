/**
 * Owner-locked T1–T4 Laundry terminal model (KLV4-DEC-005, effective
 * 2026-07-21; POS Desktop spec v4.0.0 §13.5 profile identifiers, SPECIFIED).
 *
 * Canonical LOGICAL terminal-profile identifiers are the dot-separated
 * `laundry.t{1..4}.*` vocabulary approved by KLD-2026-07-26-002 Group 2
 * (APPROVED, 2026-07-27; closes KLREC-2026-07-26-009). The earlier scaffold
 * spellings (`t1_intake_cashier`, `t2_customer_display`, `t3_ready_scan_in`,
 * `t4_pickup_scan_out`) were never deployed, so Group 2 authorizes one
 * mechanical rename with NO runtime alias layer.
 *
 * A logical profile identifier is not, by itself, a permission grant, a device
 * assignment, a resource scope, an environment scope, an approval, or a
 * physical hardware profile (KLD-2026-07-26-002 Group 2). Capability flags
 * below describe the workflow role only; authorization is enforced elsewhere.
 *
 * Any older three-terminal mapping (T2 scan-in / T3 scan-out) is superseded
 * and must be rejected. The legacy identifiers `t2_scan_in` and `t3_scan_out`
 * are permanently retired and never reused.
 */

export const LAUNDRY_TERMINAL_PROFILES = [
  "laundry.t1.intake_cashier",
  "laundry.t2.customer_display",
  "laundry.t3.ready_scan_in",
  "laundry.t4.pickup_scan_out",
] as const;
export type LaundryTerminalProfile = (typeof LAUNDRY_TERMINAL_PROFILES)[number];

/**
 * Retired identifiers from the superseded three-terminal model. "The retired
 * identifiers `t2_scan_in` and `t3_scan_out` must never be reused"
 * (KLD-2026-07-26-002 Group 2; KLV4-DEC-005).
 */
export const RETIRED_TERMINAL_IDENTIFIERS = ["t2_scan_in", "t3_scan_out"] as const;

/**
 * Pre-rename scaffold spellings of the four logical profiles, replaced by the
 * canonical `laundry.t{1..4}.*` vocabulary (KLD-2026-07-26-002 Group 2;
 * KLREC-2026-07-26-009 RESOLVED). None was ever deployed, so no runtime alias
 * layer exists and none may be accepted as input.
 */
export const PRE_RENAME_TERMINAL_IDENTIFIERS = [
  "t1_intake_cashier",
  "t2_customer_display",
  "t3_ready_scan_in",
  "t4_pickup_scan_out",
] as const;

/**
 * Every logical identifier the system must refuse: the superseded
 * three-terminal names and the pre-rename scaffold spellings. Fail closed —
 * unknown identifiers are never coerced onto a canonical profile.
 */
export const REJECTED_TERMINAL_IDENTIFIERS = [
  ...RETIRED_TERMINAL_IDENTIFIERS,
  ...PRE_RENAME_TERMINAL_IDENTIFIERS,
] as const;

/**
 * Fail-closed membership test for the canonical logical profile vocabulary.
 * Returning `true` states only that the identifier is a known workflow
 * profile — never that the caller is authorized (KLD-2026-07-26-002 Group 2:
 * "A logical profile identifier is not, by itself, a permission grant").
 */
export function isLaundryTerminalProfile(value: string): value is LaundryTerminalProfile {
  return (LAUNDRY_TERMINAL_PROFILES as readonly string[]).includes(value);
}

/**
 * PHYSICAL device/hardware pairing profile codes (Hub spec §7.6): T1+T2 share
 * front-counter hardware; T3+T4 may share ready/pickup hardware but remain
 * separate modes, permissions, sessions, state machines and audit events.
 *
 * These codes are a SEPARATE vocabulary from the logical
 * `laundry.t{1..4}.*` profiles and are explicitly NOT renamed by
 * KLD-2026-07-26-002 Group 2 ("They do not replace physical device-profile
 * codes such as: laundry_front_counter, laundry_ready_pickup,
 * laundry_t*_dedicated").
 */
export const HARDWARE_PROFILES = [
  "laundry_front_counter",
  "laundry_ready_pickup",
  "laundry_t3_dedicated",
  "laundry_t4_dedicated",
] as const;
export type LaundryHardwareProfile = (typeof HARDWARE_PROFILES)[number];

/**
 * Workflow capability flags for a logical profile. These describe what the
 * profile's WORKFLOW ROLE is, not what an actor is permitted to do: permission
 * key, API scope, resource scope, environment scope, device/profile
 * authorization and approval policy remain separate authorization dimensions
 * (KLD-2026-07-26-002 Groups 2 and 3). No flag here is a permission grant.
 */
export interface TerminalCapabilities {
  /** May create authoritative Bookings and take intake payments. */
  readonly createsBookings: boolean;
  /** Customer-facing display only — never a production terminal. */
  readonly customerFacingOnly: boolean;
  /** May record Ready custody entry (scan-in to Ready storage). */
  readonly recordsReadyCustody: boolean;
  /** May complete final customer pickup scan-out and custody release. */
  readonly releasesCustody: boolean;
}

/** Capability matrix from RB v4 §5.2–5.5 (verbatim responsibilities). */
export const TERMINAL_CAPABILITIES: Readonly<Record<LaundryTerminalProfile, TerminalCapabilities>> =
  {
    "laundry.t1.intake_cashier": {
      createsBookings: true,
      customerFacingOnly: false,
      recordsReadyCustody: false,
      releasesCustody: false,
    },
    "laundry.t2.customer_display": {
      createsBookings: false,
      customerFacingOnly: true,
      recordsReadyCustody: false,
      releasesCustody: false,
    },
    "laundry.t3.ready_scan_in": {
      createsBookings: false,
      customerFacingOnly: false,
      recordsReadyCustody: true,
      // "T3 never releases garments to a customer" (RB v4 §5.4).
      releasesCustody: false,
    },
    "laundry.t4.pickup_scan_out": {
      createsBookings: false,
      customerFacingOnly: false,
      recordsReadyCustody: false,
      // "T4 is the only terminal profile authorized to perform the final
      // customer pickup scan-out" (RB v4 §5.5).
      releasesCustody: true,
    },
  };

export function canReleaseCustody(profile: LaundryTerminalProfile): boolean {
  return TERMINAL_CAPABILITIES[profile].releasesCustody;
}
