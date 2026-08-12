/**
 * Registered vertical modules for the single KitLuy POS Desktop application.
 *
 * Source authority:
 *   - owner decision 2026-08-07 (POS unification) §2 — ONE POS Desktop app.
 *   - owner decision 2026-08-07 §7 — Phase 2 café/restaurant implementation may
 *     be preserved in the canonical repository but must remain REGISTERED and
 *     INACTIVE; it must not become active Phase 1 functionality.
 *   - KLD-2026-07-26-002 Group 2 — canonical `laundry.t{1..4}.*` profile codes.
 *   - KLV4-DEC-005 — owner-locked T1-T4 Laundry terminal model.
 *
 * The eight phases live in `@kitluy/shared-types`; phase gates in
 * `@kitluy/feature-flags`. Only verticals with an implementation appear here —
 * the remaining six are reserved boundaries, not registrations.
 */
import { LAUNDRY_TERMINAL_PROFILES } from "@kitluy-verticals/phase1-laundry";

import type { VerticalModule } from "./contract.js";

/**
 * Phase 1 — Laundry. ACTIVE.
 *
 * Terminal experiences mirror the owner-locked T1-T4 model. Permission keys are
 * the canonical registry keys; listing one here is presentation intent only —
 * the Hub staff session's effective permissions remain the authorization.
 *
 * T3/T4 are registered because the model is owner-locked, but the donor
 * `kitluy-laundry-pos-desk-app` contained only scaffold-level implementations
 * (2 and 1 files respectively), so no experience was migrated for them.
 */
export const LAUNDRY_MODULE: VerticalModule = {
  key: "laundry",
  displayName: "Laundry",
  state: "ACTIVE_PHASE1",
  provenance:
    "Canonical verticals/phase1-laundry (booking-lifecycle, custody-events, " +
    "production-state-machine, t2-display-state-machine, terminal-profiles). " +
    "Donor kitluy-laundry-pos-desk-app@d5d1a26 classified per " +
    "00_AI_HANDOFF/migrations/pos-unification/10_POS_FEATURE_DISPOSITION_REGISTER.md.",
  terminals: [
    {
      terminalSegment: "t1",
      terminalProfileCode: LAUNDRY_TERMINAL_PROFILES[0],
      displayName: "POS Cashier / Intake",
      requiredPermissions: [],
      requiredHardware: [],
    },
    {
      terminalSegment: "t2",
      terminalProfileCode: LAUNDRY_TERMINAL_PROFILES[1],
      displayName: "Customer Display Screen",
      requiredPermissions: [],
      requiredHardware: [],
    },
    {
      terminalSegment: "t3",
      terminalProfileCode: LAUNDRY_TERMINAL_PROFILES[2],
      displayName: "Clean & Ready Scan-In",
      requiredPermissions: [],
      requiredHardware: [],
    },
    {
      terminalSegment: "t4",
      terminalProfileCode: LAUNDRY_TERMINAL_PROFILES[3],
      displayName: "Customer Pickup Scan-Out",
      requiredPermissions: [],
      requiredHardware: [],
    },
  ],
};

/**
 * Phase 2 — Café / Restaurant. REGISTERED, INACTIVE.
 *
 * Registered so the boundary exists and donor implementation has a canonical
 * home, allowing `kitluy-suite-pos-desk-app` to be retired eventually. The
 * registry refuses to load it as Phase 1, and `PHASE_GATES` independently marks
 * `cafe_restaurant` as `REGISTERED_INACTIVE`.
 *
 * Tables, floor plans, checks, tabs, course firing, KDS, tips and service
 * charges must never be enabled for Laundry (owner decision §7, §15).
 *
 * No terminal experiences are declared: the donor café implementation has not
 * been migrated, so declaring experiences would overstate what exists.
 */
export const CAFE_RESTAURANT_MODULE: VerticalModule = {
  key: "cafe_restaurant",
  displayName: "Café / Restaurant",
  state: "REGISTERED_INACTIVE_PHASE2",
  provenance:
    "Boundary registration only. Donor kitluy-suite-pos-desk-app@3f66249 holds " +
    "café/restaurant implementation (tabs, tables, floor plans, KDS) classified " +
    "REGISTER-INACTIVE; not yet migrated.",
  terminals: [],
};

/** Modules compiled into the shell. Registration is explicit, never discovered. */
export const REGISTERED_VERTICAL_MODULES: readonly VerticalModule[] = [
  LAUNDRY_MODULE,
  CAFE_RESTAURANT_MODULE,
];
