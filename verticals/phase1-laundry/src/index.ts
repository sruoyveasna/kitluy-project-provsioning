/**
 * @kitluy-verticals/phase1-laundry — Phase 1 Laundry vertical boundary.
 *
 * The ONLY active vertical (RB v4 §2.1). Laundry terminology (Booking,
 * garment, Pressing, T1–T4) lives here — never in neutral Core packages.
 *
 * STATUS: contracts BUILT + TESTED where a canonical spec defines them
 * (terminal profiles, T2 display state machine, custody event names, pricing
 * line arithmetic). Everything listed in REQUIRED_LAUNDRY_DECISIONS remains an
 * explicit owner/spec decision — not guessed.
 */
export * from "./terminal-profiles.js";
export * from "./t2-display-state-machine.js";
export * from "./custody-events.js";
export * from "./pricing.js";

/**
 * Production stages named in RB v4 §5.7 ("wash, dry, press, QA, issue,
 * rewash, damage"). The EXACT state-machine names and transitions belong to
 * the approved Laundry schema/API pack, which does not exist yet — so no
 * transition function is provided here. Do not invent one.
 */
export const PRODUCTION_STAGE_VOCABULARY = [
  "wash",
  "dry",
  "press",
  "qa",
  "issue",
  "rewash",
  "damage",
] as const;

/** Open decisions that block deeper Laundry implementation (do not guess). */
export const REQUIRED_LAUNDRY_DECISIONS = [
  "[REQUIRED: exact Laundry Booking lifecycle state machine — Supabase schema/API pack (RB v4 §5.7, §13.3)]",
  "[REQUIRED: exact garment/production state machine names and transitions]",
  "[REQUIRED: receipt and tag numbering policy incl. offline sequence/collision rules (POS spec Part 25)]",
  "[REQUIRED: KHQR provider contracts and degraded/offline behavior]",
  "[REQUIRED: whether T4 collects payment by default vs T1 handoff (POS spec Part 25 item 3)]",
  "[REQUIRED: partial Ready and partial pickup/release policy]",
  "[REQUIRED: collector identity-verification/OTP and privacy policy]",
  "[REQUIRED: per-weight rounding rule selection per Store configuration]",
  "[REQUIRED: deposit policy depth and cash blind-count variance thresholds]",
] as const;
