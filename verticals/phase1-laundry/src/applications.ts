/**
 * Laundry application declaration — TERMINAL-APPLICATION-ASSIGNMENT-001 (req. 5).
 *
 * The ONE application a Phase 1 Laundry Terminal Seat runs. It is DERIVED by
 * `@kitluy/terminal-seat-contracts` from the Store's explicit primary vertical
 * (`laundry`) and the seat's assigned profiles; nobody selects it — not the
 * Partner, not the pairing code, not the terminal.
 *
 * Every one of the four owner-locked profiles derives this application:
 *   - T1 intake/cashier and T2 customer display share the front-counter
 *     hardware and are two experiences of the same POS shell;
 *   - T3 ready scan-in and T4 pickup scan-out share the ready/pickup hardware
 *     and are likewise experiences of the same shell (owner decision
 *     2026-08-07 §3: ONE POS Desktop application resolves its experience).
 *
 * The identifier `laundry.pos` is the vertical-scoped application id; it is
 * NOT a permission, not a profile, and not a release artifact name. Release
 * artifacts are governed by `@kitluy/release-manifests` and are out of scope
 * here (mission requirement 15).
 */
import type {
  ApplicationDescriptor,
  ApplicationIdentifier,
  ProductApplicationBinding,
} from "@kitluy/terminal-seat-contracts";

import { LAUNDRY_TERMINAL_PROFILES } from "./terminal-profiles.js";

export const LAUNDRY_POS_APPLICATION_ID = "laundry.pos" as ApplicationIdentifier;

export const LAUNDRY_POS_APPLICATION: ApplicationDescriptor = {
  id: LAUNDRY_POS_APPLICATION_ID,
  vertical: "laundry",
  displayName: "KitLuy Laundry POS",
  appliesToProfileCodes: LAUNDRY_TERMINAL_PROFILES,
  provenance: "TERMINAL-APPLICATION-ASSIGNMENT-001; owner decision 2026-08-07 §3 (POS unification)",
};

/** The applications this vertical declares. Exactly one in Phase 1. */
export const LAUNDRY_APPLICATIONS: readonly ApplicationDescriptor[] = [LAUNDRY_POS_APPLICATION];

/**
 * The release PRODUCT that carries the Laundry POS application on a Pi
 * Terminal: `kitluy-terminal` (T1-STORE-OPERATIONS-001, group 0228). This is
 * the only place the product name and the application identifier meet;
 * `adaptDeviceRuntimeReport` uses it to read the device runtime report as
 * evidence for `laundry.pos`. Release artifacts themselves stay governed by
 * `@kitluy/release-manifests` (mission requirement 15 — not implemented here).
 */
export const LAUNDRY_POS_PRODUCT_BINDING: ProductApplicationBinding = {
  product: "kitluy-terminal",
  applicationId: LAUNDRY_POS_APPLICATION_ID,
};
