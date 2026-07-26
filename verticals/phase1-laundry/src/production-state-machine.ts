/**
 * Canonical Laundry pre-intake and production state machines.
 *
 * Source authority: `docs/source/business-rules/`
 * `kitluy-laundry-state-machines-v1.0.0.md` §4 "Canonical Laundry state
 * model" (owner-canonical, SPECIFIED), rules KBR-LND-001..006:
 *
 * ```text
 * PRE_INTAKE_DRAFT -> QUEUED -> T1_VERIFICATION
 *                                |
 *                                v
 * RECEIVED -> WASHING -> DRYING -> PRESSING -> QA_PACKAGING -> READY -> PICKED_UP
 *     |           |          |          |              |
 *     +---------- issue hold / rewash / approved cancellation ----------+
 * ```
 *
 * - T2 is the Customer Display Screen and never owns a production transition.
 * - T3 owns Clean & Ready scan-in (KBR-LND-004).
 * - T4 owns customer Pickup scan-out and completion (KBR-LND-005).
 */

import type { LaundryTerminalProfile } from "./terminal-profiles.js";

// ---------------------------------------------------------------------------
// Pre-intake machine (KBR-LND-002 — pre-intake and queue are non-authoritative)
// ---------------------------------------------------------------------------

/** Pre-intake states verbatim from the §4 diagram. */
export const PRE_INTAKE_STATES = ["PRE_INTAKE_DRAFT", "QUEUED", "T1_VERIFICATION"] as const;
export type PreIntakeState = (typeof PRE_INTAKE_STATES)[number];

/**
 * PRE_INTAKE_DRAFT → QUEUED → T1_VERIFICATION (§4). T1_VERIFICATION has no
 * outgoing edge inside this machine: successful T1 verification creates the
 * authoritative Booking aggregate in RECEIVED (KBR-LND-001: "State becomes
 * RECEIVED after successful commit"); pre-intake itself never becomes
 * authoritative (KBR-LND-002).
 */
export const PRE_INTAKE_TRANSITIONS: Readonly<Record<PreIntakeState, readonly PreIntakeState[]>> = {
  PRE_INTAKE_DRAFT: ["QUEUED"],
  QUEUED: ["T1_VERIFICATION"],
  T1_VERIFICATION: [],
};

export class PreIntakeTransitionError extends Error {
  constructor(from: PreIntakeState, to: PreIntakeState) {
    super(
      `Illegal pre-intake transition ${from} → ${to} ` +
        `(kitluy-laundry-state-machines-v1.0.0.md §4, KBR-LND-002).`,
    );
    this.name = "PreIntakeTransitionError";
  }
}

export function canPreIntakeTransition(from: PreIntakeState, to: PreIntakeState): boolean {
  return PRE_INTAKE_TRANSITIONS[from].includes(to);
}

export function transitionPreIntake(from: PreIntakeState, to: PreIntakeState): PreIntakeState {
  if (!canPreIntakeTransition(from, to)) throw new PreIntakeTransitionError(from, to);
  return to;
}

// ---------------------------------------------------------------------------
// Production machine (KBR-LND-003 — production state progression)
// ---------------------------------------------------------------------------

/** Production states verbatim from the §4 diagram. */
export const PRODUCTION_STATES = [
  "RECEIVED",
  "WASHING",
  "DRYING",
  "PRESSING",
  "QA_PACKAGING",
  "READY",
  "PICKED_UP",
] as const;
export type ProductionState = (typeof PRODUCTION_STATES)[number];

/**
 * Forward-only chain (KBR-LND-003: "Apply only allowed forward transition or
 * explicit governed exception transition"). Every skip (e.g. WASHING → READY,
 * KBR-LND-003 TV2) and every backward edge is illegal. The final two edges
 * exist in the table but can only be COMMITTED through their guarded
 * functions: QA_PACKAGING → READY via {@link markReady} (KBR-LND-004) and
 * READY → PICKED_UP via {@link completePickup} (KBR-LND-005).
 */
export const PRODUCTION_TRANSITIONS: Readonly<Record<ProductionState, readonly ProductionState[]>> =
  {
    RECEIVED: ["WASHING"],
    WASHING: ["DRYING"],
    DRYING: ["PRESSING"],
    PRESSING: ["QA_PACKAGING"],
    QA_PACKAGING: ["READY"],
    READY: ["PICKED_UP"],
    PICKED_UP: [],
  };

export class ProductionTransitionError extends Error {
  constructor(from: ProductionState, to: ProductionState) {
    super(
      `Illegal production transition ${from} → ${to}: only forward ` +
        `transitions or explicit governed exception transitions are allowed ` +
        `(kitluy-laundry-state-machines-v1.0.0.md §4, KBR-LND-003).`,
    );
    this.name = "ProductionTransitionError";
  }
}

export function canProductionTransition(from: ProductionState, to: ProductionState): boolean {
  return PRODUCTION_TRANSITIONS[from].includes(to);
}

/**
 * Apply an unguarded forward edge. READY and PICKED_UP are never reachable
 * through this function: "READY requires QA and count verification"
 * (KBR-LND-003) with commit restricted to T3 (KBR-LND-004), and completion
 * is restricted to T4 (KBR-LND-005) — use {@link markReady} /
 * {@link completePickup} so the role guards cannot be bypassed.
 */
export function transitionProduction(from: ProductionState, to: ProductionState): ProductionState {
  if (!canProductionTransition(from, to)) throw new ProductionTransitionError(from, to);
  if (to === "READY") {
    throw new T3ReadyCommitError(
      "READY may only be committed through markReady() with the atomic T3 " +
        "count/QA/storage custody commit (KBR-LND-004).",
    );
  }
  if (to === "PICKED_UP") {
    throw new T4ReleaseError(
      "PICKED_UP may only be committed through completePickup() by the T4 " +
        "pickup scan-out profile (KBR-LND-005).",
    );
  }
  return to;
}

// ---------------------------------------------------------------------------
// KBR-LND-004 — T3 ready scan-in guard (atomic READY commit)
// ---------------------------------------------------------------------------

export class T3ReadyCommitError extends Error {
  constructor(reason: string) {
    super(`READY commit denied: ${reason} (kitluy-laundry-state-machines-v1.0.0.md KBR-LND-004).`);
    this.name = "T3ReadyCommitError";
  }
}

/**
 * Atomic READY-commit input (KBR-LND-004: "Scan each required custody unit,
 * verify count/QA, assign storage location, post custody_scanned_in. When
 * completeness policy passes, transition Booking to READY.").
 */
export interface T3ReadyCommitInput {
  /** Committing terminal profile — "Device assigned T3" (KBR-LND-004). */
  readonly profile: LaundryTerminalProfile;
  /** QA verified — "READY requires QA and count verification" (KBR-LND-003). */
  readonly qaPassed: boolean;
  /** Custody count verified against required units (KBR-LND-004). */
  readonly countVerified: boolean;
  /** Storage location assigned for Ready custody (KBR-LND-004). */
  readonly storageAssigned: boolean;
}

/**
 * Commit QA_PACKAGING → READY. T3 is "the only canonical Clean & Ready
 * scan-in role" (KBR-LND-004); "READY confirmation restricted to T3 profile"
 * (KBR-LND-003 permissions). Throws unless the caller is
 * `t3_ready_scan_in` AND QA, count and storage preconditions all hold.
 */
export function markReady(from: ProductionState, input: T3ReadyCommitInput): ProductionState {
  if (!canProductionTransition(from, "READY")) {
    // e.g. WASHING → READY denied (KBR-LND-003 TV2).
    throw new ProductionTransitionError(from, "READY");
  }
  if (input.profile !== "t3_ready_scan_in") {
    throw new T3ReadyCommitError(
      `terminal profile ${input.profile} may not commit READY; only t3_ready_scan_in may`,
    );
  }
  if (!input.qaPassed) {
    throw new T3ReadyCommitError("QA verification has not passed (failed QA goes to rework)");
  }
  if (!input.countVerified) {
    throw new T3ReadyCommitError(
      "custody count is not verified (count mismatch blocks completion)",
    );
  }
  if (!input.storageAssigned) {
    throw new T3ReadyCommitError("no storage location assigned for Ready custody");
  }
  return "READY";
}

// ---------------------------------------------------------------------------
// KBR-LND-005 — T4 pickup scan-out guard (release + completion)
// ---------------------------------------------------------------------------

export class T4ReleaseError extends Error {
  constructor(reason: string) {
    super(
      `Custody release denied: ${reason} (kitluy-laundry-state-machines-v1.0.0.md KBR-LND-005).`,
    );
    this.name = "T4ReleaseError";
  }
}

/** Release/completion input (KBR-LND-005 inputs and preconditions). */
export interface T4ReleaseInput {
  /** Releasing terminal profile — "Device assigned T4" (KBR-LND-005). */
  readonly profile: LaundryTerminalProfile;
  /** Collector identity verified (KBR-LND-005: "collector verified"). */
  readonly collectorVerified: boolean;
  /**
   * Outstanding balance settled — "required payment settled or approved
   * exception" (KBR-LND-005 preconditions).
   */
  readonly balanceSettled: boolean;
  /**
   * Release completeness verified — "Booking becomes PICKED_UP only when
   * release completeness passes" (KBR-LND-005; TV3: one package unscanned
   * blocks release). Added per independent review finding RV-001.
   */
  readonly releaseCompletenessVerified: boolean;
}

/**
 * Guard for releasing garments to a customer. "T4 [is] the only terminal
 * profile authorized to release garments and complete customer pickup"
 * (KBR-LND-005 purpose). Throws unless the caller is `t4_pickup_scan_out`
 * with the collector verified and the balance settled.
 */
export function releaseCustody(input: T4ReleaseInput): void {
  if (input.profile !== "t4_pickup_scan_out") {
    throw new T4ReleaseError(
      `terminal profile ${input.profile} may not release garments; only t4_pickup_scan_out may`,
    );
  }
  if (!input.collectorVerified) {
    throw new T4ReleaseError("collector is not verified (identity failure blocks release)");
  }
  if (!input.balanceSettled) {
    throw new T4ReleaseError(
      "outstanding balance is not settled (unresolved balance blocks release)",
    );
  }
  if (!input.releaseCompletenessVerified) {
    throw new T4ReleaseError(
      "release completeness has not passed — all release units must be scanned out (KBR-LND-005 TV3; review RV-001)",
    );
  }
}

/**
 * Commit READY → PICKED_UP. "Verify collector and balance, scan all release
 * units, post custody_scanned_out and pickup completion atomically. Booking
 * becomes PICKED_UP/COMPLETED only when release completeness passes."
 * (KBR-LND-005)
 */
export function completePickup(from: ProductionState, input: T4ReleaseInput): ProductionState {
  if (!canProductionTransition(from, "PICKED_UP")) {
    throw new ProductionTransitionError(from, "PICKED_UP");
  }
  releaseCustody(input);
  return "PICKED_UP";
}

// ---------------------------------------------------------------------------
// Governed exception branches (§4 diagram band; KBR-LND-006)
// ---------------------------------------------------------------------------

/**
 * Exception branches exactly as written in the §4 diagram band:
 * "issue hold / rewash / approved cancellation". The doc gives these as
 * lowercase phrases, not uppercase state tokens — no uppercase names are
 * invented here.
 */
export const PRODUCTION_EXCEPTION_BRANCHES = [
  "issue hold",
  "rewash",
  "approved cancellation",
] as const;
export type ProductionExceptionBranch = (typeof PRODUCTION_EXCEPTION_BRANCHES)[number];

/**
 * States with a drawn connector into the exception band (§4): RECEIVED,
 * WASHING, DRYING, PRESSING and QA_PACKAGING. READY and PICKED_UP have no
 * drawn connector — a cancellation request against a READY Booking is
 * blocked into the manager issue process (KBR-TXN-005 TV2), and incorrect
 * release after PICKED_UP is a custody incident, not a branch (KBR-LND-005).
 */
export const EXCEPTION_BRANCH_SOURCES = [
  "RECEIVED",
  "WASHING",
  "DRYING",
  "PRESSING",
  "QA_PACKAGING",
] as const satisfies readonly ProductionState[];

export function canBranchToException(from: ProductionState): boolean {
  return (EXCEPTION_BRANCH_SOURCES as readonly ProductionState[]).includes(from);
}

export class ProductionExceptionError extends Error {
  constructor(from: ProductionState, branch: ProductionExceptionBranch) {
    super(
      `Exception branch "${branch}" denied from ${from}: only RECEIVED, ` +
        `WASHING, DRYING, PRESSING and QA_PACKAGING carry a governed ` +
        `exception connector (kitluy-laundry-state-machines-v1.0.0.md §4, ` +
        `KBR-LND-003/KBR-LND-006).`,
    );
    this.name = "ProductionExceptionError";
  }
}

/**
 * Enter a governed exception branch ("explicit governed exception
 * transition", KBR-LND-003). Governance evidence (reason, supervisor
 * approval, issue case, linked rework cycle per KBR-LND-006) is enforced by
 * the owning Laundry Issue Service; this machine only validates the source
 * state. History is never rewritten (KBR-LND-003 compensating action).
 */
export function branchToException(
  from: ProductionState,
  branch: ProductionExceptionBranch,
): ProductionExceptionBranch {
  if (!canBranchToException(from)) throw new ProductionExceptionError(from, branch);
  return branch;
}
