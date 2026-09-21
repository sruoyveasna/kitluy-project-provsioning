/**
 * Composition root for Terminal Seat derivation in the Management API —
 * TERMINAL-APPLICATION-ASSIGNMENT-001.
 *
 * The ONE place this service names a vertical. `terminal-provisioning.ts`
 * takes these registries by injection and stays neutral. Same pattern as the
 * device registry service's `terminal-seat-derivation.ts` and the POS shell's
 * `REGISTERED_VERTICAL_MODULES`: explicit, compiled in, never discovered.
 *
 * Both services MUST derive the same answer for the same seat — the Partner
 * Portal shows what the Pi will be told. They do, because both register the
 * same declaration (`LAUNDRY_APPLICATIONS`) from the same package.
 *
 * Surfaces: the vocabulary is an owner decision not yet made. The registry is
 * EMPTY, so `setPhysicalTerminalAllowedSurfaces` refuses every surface with
 * its identifier until the owner registers it — fail closed and visible.
 */
import { LAUNDRY_APPLICATIONS, LAUNDRY_POS_PRODUCT_BINDING } from "@kitluy-verticals/phase1-laundry";
import { ApplicationRegistry, SurfaceRegistry } from "@kitluy/terminal-seat-contracts";

import type { TerminalProvisioningDeps } from "./terminal-provisioning.js";

const applications = ApplicationRegistry.create(LAUNDRY_APPLICATIONS);
if (!applications.ok) {
  throw new Error(`terminal seat derivation: ${applications.error.code} — ${applications.error.message}`);
}

export const terminalSeatDerivation: TerminalProvisioningDeps["seatDerivation"] = {
  applications: applications.value,
  /** `[REQUIRED: owner surface vocabulary]` — none registered yet. */
  surfaces: SurfaceRegistry.empty(),
  productBindings: [LAUNDRY_POS_PRODUCT_BINDING],
};
