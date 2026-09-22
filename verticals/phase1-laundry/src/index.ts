/**
 * @kitluy-verticals/phase1-laundry — Phase 1 Laundry vertical boundary.
 *
 * The ONLY active vertical (RB v4 §2.1). Laundry terminology (Booking,
 * garment, Pressing, T1–T4) lives here — never in neutral Core packages.
 *
 * STATUS: contracts BUILT + TESTED where a canonical spec defines them
 * (terminal profiles, T2 display state machine, custody event names, pricing
 * line arithmetic, Booking lifecycle, pre-intake + production state
 * machines). Everything listed in REQUIRED_LAUNDRY_DECISIONS remains an
 * explicit owner/spec decision — not guessed.
 */
export * from "./terminal-profiles.js";
export * from "./applications.js";
export * from "./t2-display-state-machine.js";
export * from "./custody-events.js";
export * from "./pricing.js";
export * from "./booking-lifecycle.js";
export * from "./production-state-machine.js";
export * from "./catalog-section.js";
export * from "./intake-quote.js";

/**
 * The former PRODUCTION_STAGE_VOCABULARY placeholder is replaced by the
 * canonical machines in ./booking-lifecycle.ts and
 * ./production-state-machine.ts, implemented from the owner-canonical
 * contracts.
 *
 * Open decisions that still block deeper Laundry implementation (do not
 * guess). The two former [REQUIRED] entries for the exact Booking lifecycle
 * state machine and the exact garment/production state machine names and
 * transitions are now SATISFIED by the canonical contracts
 * `docs/source/business-rules/kitluy-transaction-and-booking-lifecycle-v1.0.0.md`
 * and `docs/source/business-rules/kitluy-laundry-state-machines-v1.0.0.md`
 * and have been removed from this list.
 */
export const REQUIRED_LAUNDRY_DECISIONS = [
  "[REQUIRED: receipt and tag numbering policy incl. offline sequence/collision rules (POS spec Part 25)]",
  "[REQUIRED: KHQR provider contracts and degraded/offline behavior]",
  "[REQUIRED: whether T4 collects payment by default vs T1 handoff (POS spec Part 25 item 3)]",
  "[REQUIRED: partial Ready and partial pickup/release policy]",
  "[REQUIRED: collector identity-verification/OTP and privacy policy]",
  "[REQUIRED: per-weight rounding rule selection per Store configuration]",
  "[REQUIRED: deposit policy depth and cash blind-count variance thresholds]",
] as const;
