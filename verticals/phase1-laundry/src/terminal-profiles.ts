/**
 * Owner-locked T1–T4 Laundry terminal model (KLV4-DEC-005, effective
 * 2026-07-21; POS Desktop spec v4.0.0 §13.5 profile identifiers, SPECIFIED).
 *
 * Any older three-terminal mapping (T2 scan-in / T3 scan-out) is superseded
 * and must be rejected. The legacy identifiers `t2_scan_in` and `t3_scan_out`
 * are permanently retired and never reused.
 */

export const LAUNDRY_TERMINAL_PROFILES = [
  "t1_intake_cashier",
  "t2_customer_display",
  "t3_ready_scan_in",
  "t4_pickup_scan_out",
] as const;
export type LaundryTerminalProfile = (typeof LAUNDRY_TERMINAL_PROFILES)[number];

/** Retired identifiers from the superseded three-terminal model. */
export const RETIRED_TERMINAL_IDENTIFIERS = ["t2_scan_in", "t3_scan_out"] as const;

/**
 * Hardware pairing profiles (Hub spec §7.6): T1+T2 share front-counter
 * hardware; T3+T4 may share ready/pickup hardware but remain separate modes,
 * permissions, sessions, state machines and audit events.
 */
export const HARDWARE_PROFILES = [
  "laundry_front_counter",
  "laundry_ready_pickup",
  "laundry_t3_dedicated",
  "laundry_t4_dedicated",
] as const;
export type LaundryHardwareProfile = (typeof HARDWARE_PROFILES)[number];

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
    t1_intake_cashier: {
      createsBookings: true,
      customerFacingOnly: false,
      recordsReadyCustody: false,
      releasesCustody: false,
    },
    t2_customer_display: {
      createsBookings: false,
      customerFacingOnly: true,
      recordsReadyCustody: false,
      releasesCustody: false,
    },
    t3_ready_scan_in: {
      createsBookings: false,
      customerFacingOnly: false,
      recordsReadyCustody: true,
      // "T3 never releases garments to a customer" (RB v4 §5.4).
      releasesCustody: false,
    },
    t4_pickup_scan_out: {
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
