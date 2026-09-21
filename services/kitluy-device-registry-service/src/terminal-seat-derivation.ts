/**
 * Composition root for Terminal Seat derivation — TERMINAL-APPLICATION-ASSIGNMENT-001.
 *
 * This is the ONE file in the device registry service that names a vertical.
 * The service is otherwise Neutral Fleet; `TerminalPairingComposition` takes
 * these registries by injection and never imports a vertical itself. The
 * pattern is the POS shell's `REGISTERED_VERTICAL_MODULES`: registration is
 * explicit and compiled in, never discovered.
 *
 * Phase 1: the Laundry application is registered. Phase 2 (café/restaurant)
 * registers nothing — its terminal definitions are a product-definition
 * dependency (mission requirement 14), and declaring anything here would let
 * a café seat derive an application that does not exist.
 *
 * Surfaces: the vocabulary is an owner decision not yet made (requirement 7,
 * CLAUDE.md hard rule 9). The registry is EMPTY, so any allowed surface a
 * Partner sets is refused at pairing until the owner registers it — fail
 * closed, and visible, rather than silently exposing an unknown surface.
 */
import { LAUNDRY_APPLICATIONS } from "@kitluy-verticals/phase1-laundry";
import {
  ApplicationRegistry,
  SurfaceRegistry,
  type DerivationRegistries,
} from "@kitluy/terminal-seat-contracts";

const applications = ApplicationRegistry.create(LAUNDRY_APPLICATIONS);
if (!applications.ok) {
  // A malformed compiled-in declaration is a build defect, not a runtime
  // condition: refuse to start rather than pair against a broken registry.
  throw new Error(`terminal seat derivation: ${applications.error.code} — ${applications.error.message}`);
}

/** Owner-registered surfaces. None yet: `[REQUIRED: owner surface vocabulary]`. */
const surfaces = SurfaceRegistry.empty();

export const terminalSeatDerivation: DerivationRegistries = {
  applications: applications.value,
  surfaces,
};
