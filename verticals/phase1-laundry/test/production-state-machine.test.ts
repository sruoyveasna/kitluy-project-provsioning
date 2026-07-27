import { describe, expect, it } from "vitest";
import {
  EXCEPTION_BRANCH_SOURCES,
  PRE_INTAKE_STATES,
  PRE_INTAKE_TRANSITIONS,
  PRODUCTION_EXCEPTION_BRANCHES,
  PRODUCTION_STATES,
  PRODUCTION_TRANSITIONS,
  PreIntakeTransitionError,
  ProductionExceptionError,
  ProductionTransitionError,
  T3ReadyCommitError,
  T4ReleaseError,
  branchToException,
  canBranchToException,
  canPreIntakeTransition,
  canProductionTransition,
  completePickup,
  markReady,
  releaseCustody,
  transitionPreIntake,
  transitionProduction,
  type ProductionState,
  type T3ReadyCommitInput,
  type T4ReleaseInput,
} from "../src/index.js";

const VALID_T3_COMMIT: T3ReadyCommitInput = {
  profile: "laundry.t3.ready_scan_in",
  qaPassed: true,
  countVerified: true,
  storageAssigned: true,
};

const VALID_T4_RELEASE: T4ReleaseInput = {
  profile: "laundry.t4.pickup_scan_out",
  collectorVerified: true,
  balanceSettled: true,
  releaseCompletenessVerified: true,
};

describe("pre-intake machine (kitluy-laundry-state-machines-v1.0.0.md §4, KBR-LND-002)", () => {
  it("declares exactly the drawn states, verbatim", () => {
    expect(PRE_INTAKE_STATES).toEqual(["PRE_INTAKE_DRAFT", "QUEUED", "T1_VERIFICATION"]);
  });

  it("follows PRE_INTAKE_DRAFT → QUEUED → T1_VERIFICATION", () => {
    let s = transitionPreIntake("PRE_INTAKE_DRAFT", "QUEUED");
    s = transitionPreIntake(s, "T1_VERIFICATION");
    expect(s).toBe("T1_VERIFICATION");
  });

  it("rejects skipping the queue and every backward transition", () => {
    expect(() => transitionPreIntake("PRE_INTAKE_DRAFT", "T1_VERIFICATION")).toThrow(
      PreIntakeTransitionError,
    );
    expect(() => transitionPreIntake("QUEUED", "PRE_INTAKE_DRAFT")).toThrow(
      PreIntakeTransitionError,
    );
    expect(() => transitionPreIntake("T1_VERIFICATION", "QUEUED")).toThrow(
      PreIntakeTransitionError,
    );
  });

  it("T1_VERIFICATION is terminal within this machine (Booking creation is a new aggregate, KBR-LND-001)", () => {
    expect(PRE_INTAKE_TRANSITIONS.T1_VERIFICATION).toEqual([]);
    for (const to of PRE_INTAKE_STATES) {
      expect(canPreIntakeTransition("T1_VERIFICATION", to)).toBe(false);
    }
  });
});

describe("production machine forward-only chain (KBR-LND-003)", () => {
  it("declares exactly the drawn states, verbatim", () => {
    expect(PRODUCTION_STATES).toEqual([
      "RECEIVED",
      "WASHING",
      "DRYING",
      "PRESSING",
      "QA_PACKAGING",
      "READY",
      "PICKED_UP",
    ]);
  });

  it("walks the full happy path RECEIVED → … → PICKED_UP with guarded commits", () => {
    let s: ProductionState = "RECEIVED";
    s = transitionProduction(s, "WASHING"); // KBR-LND-003 TV1
    s = transitionProduction(s, "DRYING");
    s = transitionProduction(s, "PRESSING");
    s = transitionProduction(s, "QA_PACKAGING");
    s = markReady(s, VALID_T3_COMMIT); // KBR-LND-003 TV3 / KBR-LND-004 TV1
    expect(s).toBe("READY");
    s = completePickup(s, VALID_T4_RELEASE); // KBR-LND-005 TV1
    expect(s).toBe("PICKED_UP");
  });

  it("denies the WASHING → READY shortcut (KBR-LND-003 TV2)", () => {
    expect(canProductionTransition("WASHING", "READY")).toBe(false);
    expect(() => transitionProduction("WASHING", "READY")).toThrow(ProductionTransitionError);
    expect(() => markReady("WASHING", VALID_T3_COMMIT)).toThrow(ProductionTransitionError);
  });

  it("denies every other skip-ahead shortcut", () => {
    expect(() => transitionProduction("RECEIVED", "DRYING")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("RECEIVED", "PICKED_UP")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("WASHING", "PRESSING")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("DRYING", "READY")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("PRESSING", "READY")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("QA_PACKAGING", "PICKED_UP")).toThrow(
      ProductionTransitionError,
    );
  });

  it("denies every backward transition (forward-only)", () => {
    expect(() => transitionProduction("WASHING", "RECEIVED")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("DRYING", "WASHING")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("PRESSING", "DRYING")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("QA_PACKAGING", "PRESSING")).toThrow(
      ProductionTransitionError,
    );
    expect(() => transitionProduction("READY", "QA_PACKAGING")).toThrow(ProductionTransitionError);
    expect(() => transitionProduction("PICKED_UP", "READY")).toThrow(ProductionTransitionError);
  });

  it("PICKED_UP is terminal", () => {
    expect(PRODUCTION_TRANSITIONS.PICKED_UP).toEqual([]);
  });

  it("unguarded transition() can never commit READY or PICKED_UP", () => {
    // The edges exist, but the atomic guarded commits are the only way in.
    expect(canProductionTransition("QA_PACKAGING", "READY")).toBe(true);
    expect(canProductionTransition("READY", "PICKED_UP")).toBe(true);
    expect(() => transitionProduction("QA_PACKAGING", "READY")).toThrow(T3ReadyCommitError);
    expect(() => transitionProduction("READY", "PICKED_UP")).toThrow(T4ReleaseError);
  });

  it("error message cites KBR-LND-003", () => {
    expect(() => transitionProduction("WASHING", "READY")).toThrow(/KBR-LND-003/);
  });
});

describe("T3-only atomic READY commit (KBR-LND-004)", () => {
  it("commits READY from QA_PACKAGING when T3 has QA, count and storage verified", () => {
    expect(markReady("QA_PACKAGING", VALID_T3_COMMIT)).toBe("READY");
  });

  it("denies T1, T2 and T4 attempting the ready commit (T3 is the only Ready scan-in role)", () => {
    for (const profile of [
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
      "laundry.t4.pickup_scan_out",
    ] as const) {
      expect(() => markReady("QA_PACKAGING", { ...VALID_T3_COMMIT, profile })).toThrow(
        T3ReadyCommitError,
      );
      expect(() => markReady("QA_PACKAGING", { ...VALID_T3_COMMIT, profile })).toThrow(
        /only laundry\.t3\.ready_scan_in/,
      );
    }
  });

  it("denies READY without QA pass (failed QA → rework, KBR-LND-004)", () => {
    expect(() => markReady("QA_PACKAGING", { ...VALID_T3_COMMIT, qaPassed: false })).toThrow(
      T3ReadyCommitError,
    );
  });

  it("denies READY without verified count (KBR-LND-004 TV2: one tag missing → blocked)", () => {
    expect(() => markReady("QA_PACKAGING", { ...VALID_T3_COMMIT, countVerified: false })).toThrow(
      T3ReadyCommitError,
    );
  });

  it("denies READY without storage assignment", () => {
    expect(() => markReady("QA_PACKAGING", { ...VALID_T3_COMMIT, storageAssigned: false })).toThrow(
      T3ReadyCommitError,
    );
  });

  it("denies the commit from any state other than QA_PACKAGING", () => {
    for (const from of ["RECEIVED", "WASHING", "DRYING", "PRESSING", "READY"] as const) {
      expect(() => markReady(from, VALID_T3_COMMIT)).toThrow(ProductionTransitionError);
    }
  });

  it("error message cites KBR-LND-004", () => {
    expect(() =>
      markReady("QA_PACKAGING", { ...VALID_T3_COMMIT, profile: "laundry.t1.intake_cashier" }),
    ).toThrow(/KBR-LND-004/);
  });
});

describe("T4-only release and pickup completion (KBR-LND-005)", () => {
  it("completes pickup from READY when T4 has collector verified and balance settled", () => {
    expect(completePickup("READY", VALID_T4_RELEASE)).toBe("PICKED_UP");
    expect(() => releaseCustody(VALID_T4_RELEASE)).not.toThrow();
  });

  it("denies T1, T2 and T3 attempting release (T4 is the only release profile)", () => {
    for (const profile of [
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
      "laundry.t3.ready_scan_in",
    ] as const) {
      expect(() => releaseCustody({ ...VALID_T4_RELEASE, profile })).toThrow(T4ReleaseError);
      expect(() => completePickup("READY", { ...VALID_T4_RELEASE, profile })).toThrow(
        /only laundry\.t4\.pickup_scan_out/,
      );
    }
  });

  it("denies release without collector verification (identity failure blocks release)", () => {
    expect(() => releaseCustody({ ...VALID_T4_RELEASE, collectorVerified: false })).toThrow(
      T4ReleaseError,
    );
    expect(() =>
      completePickup("READY", { ...VALID_T4_RELEASE, collectorVerified: false }),
    ).toThrow(T4ReleaseError);
  });

  it("denies release with unsettled balance (unresolved balance blocks release)", () => {
    expect(() => releaseCustody({ ...VALID_T4_RELEASE, balanceSettled: false })).toThrow(
      T4ReleaseError,
    );
    expect(() => completePickup("READY", { ...VALID_T4_RELEASE, balanceSettled: false })).toThrow(
      T4ReleaseError,
    );
  });

  it("denies pickup completion from any state other than READY", () => {
    for (const from of [
      "RECEIVED",
      "WASHING",
      "DRYING",
      "PRESSING",
      "QA_PACKAGING",
      "PICKED_UP",
    ] as const) {
      expect(() => completePickup(from, VALID_T4_RELEASE)).toThrow(ProductionTransitionError);
    }
  });

  it("error message cites KBR-LND-005", () => {
    expect(() =>
      completePickup("READY", { ...VALID_T4_RELEASE, profile: "laundry.t3.ready_scan_in" }),
    ).toThrow(/KBR-LND-005/);
  });
});

describe("governed exception branches (§4 band; KBR-LND-003/KBR-LND-006)", () => {
  it("declares the branch labels exactly as written in the diagram band", () => {
    expect(PRODUCTION_EXCEPTION_BRANCHES).toEqual([
      "issue hold",
      "rewash",
      "approved cancellation",
    ]);
  });

  it("permits branching from every state with a drawn connector", () => {
    expect(EXCEPTION_BRANCH_SOURCES).toEqual([
      "RECEIVED",
      "WASHING",
      "DRYING",
      "PRESSING",
      "QA_PACKAGING",
    ]);
    for (const from of EXCEPTION_BRANCH_SOURCES) {
      for (const branch of PRODUCTION_EXCEPTION_BRANCHES) {
        expect(canBranchToException(from)).toBe(true);
        expect(branchToException(from, branch)).toBe(branch);
      }
    }
  });

  it("stain persists at QA → rewash, Booking not READY (KBR-LND-006 TV1)", () => {
    expect(branchToException("QA_PACKAGING", "rewash")).toBe("rewash");
    expect(() => markReady("QA_PACKAGING", { ...VALID_T3_COMMIT, qaPassed: false })).toThrow(
      T3ReadyCommitError,
    );
  });

  it("denies exception branches from READY and PICKED_UP (no drawn connector)", () => {
    for (const from of ["READY", "PICKED_UP"] as const) {
      expect(canBranchToException(from)).toBe(false);
      for (const branch of PRODUCTION_EXCEPTION_BRANCHES) {
        expect(() => branchToException(from, branch)).toThrow(ProductionExceptionError);
      }
    }
  });
});

describe("RV-001 — release completeness precondition (KBR-LND-005 TV3)", () => {
  it("blocks release when release completeness has not passed", () => {
    expect(() =>
      completePickup("READY", { ...VALID_T4_RELEASE, releaseCompletenessVerified: false }),
    ).toThrow(/release completeness/);
  });
});

// ---------------------------------------------------------------------------
// KLD-2026-07-26-002 Group 2: "Shared T3/T4 hardware continues to use separate,
// audited application modes and actor sessions." The rename must not merge the
// two roles — each guard is asserted against the canonical dotted identifiers.
// ---------------------------------------------------------------------------
describe("T3/T4 role separation under the canonical identifiers (KLD-2026-07-26-002 Group 2)", () => {
  it("T3 cannot execute the T4 pickup completion", () => {
    const t3AtPickup: T4ReleaseInput = { ...VALID_T4_RELEASE, profile: "laundry.t3.ready_scan_in" };
    expect(() => completePickup("READY", t3AtPickup)).toThrow(T4ReleaseError);
    expect(() => completePickup("READY", t3AtPickup)).toThrow(/only laundry\.t4\.pickup_scan_out/);
    expect(() => releaseCustody(t3AtPickup)).toThrow(T4ReleaseError);
  });

  it("T4 cannot execute the T3 Ready commit", () => {
    const t4AtReady: T3ReadyCommitInput = {
      ...VALID_T3_COMMIT,
      profile: "laundry.t4.pickup_scan_out",
    };
    expect(() => markReady("QA_PACKAGING", t4AtReady)).toThrow(T3ReadyCommitError);
    expect(() => markReady("QA_PACKAGING", t4AtReady)).toThrow(/only laundry\.t3\.ready_scan_in/);
  });

  it("neither retired nor pre-rename spellings satisfy a role guard", () => {
    for (const stale of [
      "t2_scan_in",
      "t3_scan_out",
      "t1_intake_cashier",
      "t2_customer_display",
      "t3_ready_scan_in",
      "t4_pickup_scan_out",
    ]) {
      // Cast: these identifiers are deliberately outside the canonical union —
      // the guards must still fail closed if one reaches the boundary.
      const profile = stale as T3ReadyCommitInput["profile"];
      expect(() => markReady("QA_PACKAGING", { ...VALID_T3_COMMIT, profile })).toThrow(
        T3ReadyCommitError,
      );
      expect(() => releaseCustody({ ...VALID_T4_RELEASE, profile })).toThrow(T4ReleaseError);
    }
  });

  it("the canonical T3 and T4 profiles each satisfy exactly their own guard", () => {
    expect(markReady("QA_PACKAGING", VALID_T3_COMMIT)).toBe("READY");
    expect(completePickup("READY", VALID_T4_RELEASE)).toBe("PICKED_UP");
  });
});
