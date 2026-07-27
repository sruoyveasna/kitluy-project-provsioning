/**
 * @kitluy-verticals/phase1-laundry-persistence — WS-07 persistence adapters
 * (Cycle-6). Layering (§17): canonical engines (@kitluy-verticals/
 * phase1-laundry) -> command services (this package) -> local Supabase dev
 * database. Internal services/test adapters only — Edge/Hub T3/T4 mutation
 * routes remain fenced (KL-DEC-001, BLK-003). LOCAL ONLY (KL-INF-P1-037).
 */
export const PACKAGE_NAME = "@kitluy-verticals/phase1-laundry-persistence" as const;

export {
  BookingPersistenceError,
  createVerifiedBooking,
  transitionBookingLifecycle,
  type CreateVerifiedBookingCommand,
  type CreateVerifiedBookingResult,
  type LifecycleTransitionCommand,
  type LifecycleTransitionResult,
  type VerifiedBookingLineInput,
} from "./booking-command-service.js";
export {
  CustodyPersistenceError,
  commitReady,
  completePickupRelease,
  recordCustodyScan,
  transitionProductionStage,
  type CustodyScanCommand,
  type CustodyScanResult,
  type PickupReleaseCommand,
  type PickupReleaseResult,
  type ProductionTransitionCommand,
  type ProductionTransitionResult,
  type ReadyCommitCommand,
} from "./custody-command-service.js";
