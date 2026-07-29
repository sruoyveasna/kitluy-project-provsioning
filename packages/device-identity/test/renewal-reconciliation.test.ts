/**
 * Interrupted-renewal reconciliation — focused unit tests.
 *
 * The decision table is exercised directly, state pair by state pair, and the
 * service is driven through each classification with a recording executor. What
 * is under test is that ONE action is chosen, that it is the right one, and
 * that anything unrecognised fails closed.
 */
import { describe, it, expect } from "vitest";

import {
  RECONCILIATION_RULES,
  classifyReconciliation,
  describeDatabase,
  describeProvider,
  reconcileDeviceCredentialRenewal,
  requiresHumanReview,
  type ObservedDatabaseState,
  type ObservedProviderState,
  type ReconciliationAuditGateway,
  type ReconciliationClassification,
  type ReconciliationExecutor,
  type ReconciliationInput,
  type ReconciliationProviderProbe,
  type ReconciliationReader,
} from "../src/renewal-reconciliation.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const ATTEMPT = "55555555-5555-4555-8555-555555555555";
const DEVICE = "11111111-1111-4111-8111-111111111111";
const OTHER_DEVICE = "22222222-2222-4222-8222-222222222222";
const CURRENT_CREDENTIAL = "33333333-3333-4333-8333-333333333333";
const NEXT_CREDENTIAL = "77777777-7777-4777-8777-777777777777";
const REPLACEMENT_FP = "b".repeat(64);
const REPLACEMENT_REF = "dev-replacement:one";

function trustedNow(): TrustedTimeEvaluation {
  return {
    status: "trusted",
    trustedTime: new Date("2026-07-22T00:00:00.000Z"),
    source: "authenticated_network",
    floorAdvanced: true,
    anomalyType: null,
    detail: "unit fixture",
  };
}

// ---------------------------------------------------------------------------
// State builders
// ---------------------------------------------------------------------------

function db(overrides: Partial<ObservedDatabaseState> = {}): ObservedDatabaseState {
  return {
    renewalAttemptId: ATTEMPT,
    renewalMode: "rotate_key",
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    reservationStatus: "key_generation_pending",
    currentCredentialId: CURRENT_CREDENTIAL,
    currentCredentialGeneration: 1,
    nextCredentialGeneration: 2,
    assignmentGeneration: 1,
    credentialHeadVersion: 1,
    headVersion: 1,
    headGeneration: 1,
    replacementKey: null,
    issuanceAttempt: null,
    credentialPersisted: false,
    persistedCredentialId: null,
    deviceAssignmentGeneration: 1,
    ...overrides,
  };
}

function provider(overrides: Partial<ObservedProviderState> = {}): ObservedProviderState {
  return { replacementKey: null, incumbentAvailable: true, ...overrides };
}

const providerKey = (state: string, overrides: Record<string, unknown> = {}) => ({
  providerKeyReference: REPLACEMENT_REF,
  publicKeyFingerprint: REPLACEMENT_FP,
  keyGeneration: 2,
  state,
  ...overrides,
});

const dbKey = (state: string, overrides: Record<string, unknown> = {}) => ({
  state,
  keyGeneration: 2,
  publicKeyFingerprint: REPLACEMENT_FP,
  providerKeyReference: REPLACEMENT_REF,
  ...overrides,
});

const attempt = (state: string, hasSignature: boolean) => ({
  state,
  credentialId: NEXT_CREDENTIAL,
  serialNumber: "DEV-REC-GEN2",
  certificateGeneration: 2,
  canonicalTbsHash: "c".repeat(64),
  issuerKeyId: "ica-key",
  signatureSha256: hasSignature ? "d".repeat(64) : null,
  hasSignature,
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  readonly reader: ReconciliationReader;
  readonly probe: ReconciliationProviderProbe;
  readonly executor: ReconciliationExecutor;
  readonly audit: ReconciliationAuditGateway;
  readonly calls: string[];
  readonly audited: Parameters<ReconciliationAuditGateway["record"]>[0][];
}

function harness(
  states: ObservedDatabaseState[],
  providerStates: ObservedProviderState[],
  options: { readonly failOn?: string; readonly auditThrows?: boolean } = {},
): Harness {
  const calls: string[] = [];
  const audited: Parameters<ReconciliationAuditGateway["record"]>[0][] = [];
  let dbIndex = 0;
  let providerIndex = 0;

  const act = (name: string) => async () => {
    calls.push(name);
    if (options.failOn === name) throw new Error(`${name} failed`);
    return `${name} ok`;
  };

  return {
    calls,
    audited,
    reader: {
      async loadDatabaseState() {
        const state = states[Math.min(dbIndex, states.length - 1)]!;
        dbIndex += 1;
        return state;
      },
    },
    probe: {
      async observe() {
        const state = providerStates[Math.min(providerIndex, providerStates.length - 1)]!;
        providerIndex += 1;
        return state;
      },
    },
    executor: {
      generateReplacementKey: act("generate"),
      registerReplacementKey: act("register"),
      proveReplacementPossession: act("pop"),
      prepareIssuance: act("prepare"),
      signAndRecord: act("signAndRecord"),
      finalizeIssuance: act("finalize"),
      activateProviderKey: act("activate"),
      confirmActivation: act("confirm"),
      abandonReplacementKey: act("abandon"),
    },
    audit: {
      async record(input) {
        if (options.auditThrows === true) throw new Error("audit unavailable");
        audited.push(input);
        return { reconciliationId: `rec-${audited.length}` };
      },
    },
  };
}

function input(overrides: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    renewalAttemptId: ATTEMPT,
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    actorRef: "UNIT-RECONCILER",
    trustedTime: trustedNow(),
    ...overrides,
  };
}

// ===========================================================================
// Classification
// ===========================================================================
describe("reconciliation classification", () => {
  const cases: ReadonlyArray<
    readonly [string, ObservedDatabaseState, ObservedProviderState, ReconciliationClassification]
  > = [
    [
      "a completed rotation with an active key",
      db({
        reservationStatus: "completed",
        replacementKey: dbKey("active"),
        credentialPersisted: true,
      }),
      provider({ replacementKey: providerKey("active") }),
      "RESPONSE_REPLAY",
    ],
    ["a rotation reservation with no key anywhere", db(), provider(), "KEY_GENERATION_REQUIRED"],
    [
      "a provider key the database never registered",
      db(),
      provider({ replacementKey: providerKey("generated") }),
      "KEY_METADATA_REGISTRATION_REQUIRED",
    ],
    [
      "a registered key with no issuance attempt",
      db({ replacementKey: dbKey("generated") }),
      provider({ replacementKey: providerKey("generated") }),
      "POP_REQUIRED",
    ],
    [
      "a prepared issuance with no signature",
      db({
        replacementKey: dbKey("generated"),
        reservationStatus: "issuance_pending",
        issuanceAttempt: attempt("reserved", false),
      }),
      provider({ replacementKey: providerKey("generated") }),
      "SIGNATURE_REQUIRED",
    ],
    [
      "a signature against a reservation still unsigned",
      db({
        replacementKey: dbKey("generated"),
        reservationStatus: "issuance_pending",
        issuanceAttempt: attempt("reserved", true),
      }),
      provider({ replacementKey: providerKey("generated") }),
      "SIGNATURE_RECORDING_REQUIRED",
    ],
    [
      "a recorded signature with no credential",
      db({
        replacementKey: dbKey("generated"),
        issuanceAttempt: attempt("signed", true),
      }),
      provider({ replacementKey: providerKey("generated") }),
      "FINALIZATION_REQUIRED",
    ],
    [
      "a finalized credential with an unactivated provider key",
      db({
        replacementKey: dbKey("credential_issued_pending_activation"),
        issuanceAttempt: attempt("finalized", true),
        credentialPersisted: true,
        persistedCredentialId: NEXT_CREDENTIAL,
        reservationStatus: "activation_pending",
      }),
      provider({ replacementKey: providerKey("generated") }),
      "PROVIDER_ACTIVATION_REQUIRED",
    ],
    [
      "a provider that already activated, with the database still pending",
      db({
        replacementKey: dbKey("credential_issued_pending_activation"),
        issuanceAttempt: attempt("finalized", true),
        credentialPersisted: true,
        reservationStatus: "activation_pending",
      }),
      provider({ replacementKey: providerKey("active") }),
      "ACTIVATION_CONFIRMATION_REQUIRED",
    ],
    [
      "a database-active key the provider does not have",
      db({
        replacementKey: dbKey("active"),
        credentialPersisted: true,
        reservationStatus: "completed",
      }),
      provider({ replacementKey: null }),
      "INCONSISTENT_STATE",
    ],
    [
      "a database-active key the provider says is only generated",
      db({ replacementKey: dbKey("active"), credentialPersisted: true }),
      provider({ replacementKey: providerKey("generated") }),
      "INCONSISTENT_STATE",
    ],
    [
      "a terminal reservation with a live provider key",
      db({ reservationStatus: "abandoned" }),
      provider({ replacementKey: providerKey("generated") }),
      "ABANDONMENT_REQUIRED",
    ],
    [
      "a terminal reservation with nothing outstanding",
      db({ reservationStatus: "refused" }),
      provider(),
      "NO_ACTION_COMPLETED",
    ],
    [
      "a provider key active before any credential exists",
      db({ replacementKey: dbKey("generated"), credentialPersisted: false }),
      provider({ replacementKey: providerKey("active") }),
      "INCONSISTENT_STATE",
    ],
    [
      "a same-key renewal whose incumbent is gone",
      db({ renewalMode: "reuse_current_key" }),
      provider({ incumbentAvailable: false }),
      "MANUAL_REVIEW_REQUIRED",
    ],
    [
      "a same-key reservation with nothing prepared",
      db({ renewalMode: "reuse_current_key", reservationStatus: "issuance_pending" }),
      provider(),
      "RESERVATION_PENDING",
    ],
    [
      "a same-key renewal whose credential exists",
      db({
        renewalMode: "reuse_current_key",
        reservationStatus: "completed",
        credentialPersisted: true,
      }),
      provider(),
      "RESPONSE_REPLAY",
    ],
  ];

  for (const [name, database, providerState, expected] of cases) {
    it(`classifies ${name} as ${expected}`, () => {
      expect(classifyReconciliation(database, providerState).classification).toBe(expected);
    });
  }

  it("fails closed on a combination no rule describes", () => {
    // A rotation whose database key is `destroyed` — a state no rule covers.
    const decision = classifyReconciliation(
      db({ replacementKey: dbKey("destroyed"), reservationStatus: "issuance_pending" }),
      provider({ replacementKey: providerKey("destroyed") }),
    );
    expect(decision.classification).toBe("INCONSISTENT_STATE");
    expect(decision.automatic).toBe(false);
    expect(decision.reason).toContain("Failing closed");
  });

  it("names the renewal attempt, mode, both states, the action and the reason", () => {
    const database = db();
    const providerState = provider();
    const decision = classifyReconciliation(database, providerState);

    expect(decision.renewalAttemptId).toBe(ATTEMPT);
    expect(decision.renewalMode).toBe("rotate_key");
    expect(decision.action).not.toBe("");
    expect(decision.reason.length).toBeGreaterThan(40);
    expect(describeDatabase(database)).toContain("reservation=key_generation_pending");
    expect(describeProvider(providerState)).toContain("key=missing");
  });

  it("marks only the two human-only classifications as non-automatic", () => {
    expect(requiresHumanReview("MANUAL_REVIEW_REQUIRED")).toBe(true);
    expect(requiresHumanReview("INCONSISTENT_STATE")).toBe(true);
    expect(requiresHumanReview("FINALIZATION_REQUIRED")).toBe(false);
    expect(requiresHumanReview("RESPONSE_REPLAY")).toBe(false);
  });

  it("keeps every rule identified, scoped and explained", () => {
    for (const rule of RECONCILIATION_RULES) {
      expect(rule.id).toMatch(/^R\d\d$/);
      expect(["both", "rotate_key", "reuse_current_key"]).toContain(rule.appliesTo);
      expect(rule.reason.length).toBeGreaterThan(40);
      expect(rule.databaseCondition).not.toBe("");
      expect(rule.providerCondition).not.toBe("");
    }
    // Rule ids are unique, so an audit row naming R21 means exactly one rule.
    const ids = RECONCILIATION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ===========================================================================
// Same-key recovery
// ===========================================================================
describe("same-key recovery", () => {
  it("resumes the ORIGINAL attempt after a lost reservation response", async () => {
    const state = db({ renewalMode: "reuse_current_key", reservationStatus: "issuance_pending" });
    const h = harness(
      [state, { ...state, issuanceAttempt: attempt("reserved", false) }],
      [provider()],
    );
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.outcome).toBe("RECONCILED");
    expect(outcome.decision?.classification).toBe("RESERVATION_PENDING");
    expect(h.calls).toEqual(["prepare"]);
    // No key was generated: a same-key renewal has nothing to generate.
    expect(h.calls).not.toContain("generate");
  });

  it("reuses the issuance identifiers after a lost preparation response", async () => {
    const state = db({
      renewalMode: "reuse_current_key",
      reservationStatus: "issuance_pending",
      issuanceAttempt: attempt("reserved", false),
    });
    const h = harness([state], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.decision?.classification).toBe("SIGNATURE_REQUIRED");
    // The credential id and serial the database froze travel through unchanged.
    expect(outcome.databaseState?.issuanceAttempt?.credentialId).toBe(NEXT_CREDENTIAL);
    expect(outcome.databaseState?.issuanceAttempt?.serialNumber).toBe("DEV-REC-GEN2");
  });

  it("reuses an existing signature instead of asking for another", async () => {
    const state = db({
      renewalMode: "reuse_current_key",
      issuanceAttempt: attempt("reserved", true),
    });
    const h = harness([state], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.decision?.classification).toBe("SIGNATURE_RECORDING_REQUIRED");
    expect(outcome.decision?.reason).toContain("RECORDED, not replaced");
  });

  it("replays a completed renewal WITHOUT re-running eligibility", async () => {
    const state = db({
      renewalMode: "reuse_current_key",
      reservationStatus: "completed",
      credentialPersisted: true,
      persistedCredentialId: NEXT_CREDENTIAL,
    });
    const h = harness([state], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.outcome).toBe("REPLAYED");
    expect(outcome.decision?.classification).toBe("RESPONSE_REPLAY");
    expect(outcome.remainingAction).toBeNull();
    // Nothing was executed at all — no eligibility, no preparation, no signing.
    expect(h.calls).toEqual([]);
    // And the reason says WHY re-running eligibility would be wrong.
    expect(outcome.decision?.reason).toContain("NOT_IN_RENEWAL_WINDOW");
  });

  it("refuses when the incumbent key the renewal reuses is gone", async () => {
    const state = db({ renewalMode: "reuse_current_key" });
    const h = harness([state], [provider({ incumbentAvailable: false })]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.refusalCode).toBe("RECONCILE_MANUAL_REVIEW");
    expect(h.calls).toEqual([]);
  });
});

// ===========================================================================
// Rotation recovery
// ===========================================================================
describe("rotation recovery", () => {
  it("registers the provider's existing key rather than generating another", async () => {
    const state = db();
    const h = harness(
      [state, db({ replacementKey: dbKey("generated") })],
      [provider({ replacementKey: providerKey("generated") })],
    );
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.decision?.classification).toBe("KEY_METADATA_REGISTRATION_REQUIRED");
    expect(h.calls).toEqual(["register"]);
    expect(h.calls).not.toContain("generate");
  });

  it("generates only when neither system has a key", async () => {
    const h = harness(
      [db(), db({ replacementKey: dbKey("generated") })],
      [provider(), provider({ replacementKey: providerKey("generated") })],
    );
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.decision?.classification).toBe("KEY_GENERATION_REQUIRED");
    expect(h.calls).toEqual(["generate"]);
  });

  it("repairs a lost activation acknowledgment by confirming, not reactivating", async () => {
    const pending = db({
      replacementKey: dbKey("credential_issued_pending_activation"),
      issuanceAttempt: attempt("finalized", true),
      credentialPersisted: true,
      reservationStatus: "activation_pending",
    });
    const after = db({
      replacementKey: dbKey("active"),
      issuanceAttempt: attempt("finalized", true),
      credentialPersisted: true,
      reservationStatus: "completed",
    });
    const h = harness([pending, after], [provider({ replacementKey: providerKey("active") })]);

    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.decision?.classification).toBe("ACTIVATION_CONFIRMATION_REQUIRED");
    expect(h.calls).toEqual(["confirm"]);
    // Never a second activation, and never another key.
    expect(h.calls).not.toContain("activate");
    expect(h.calls).not.toContain("generate");
    expect(outcome.remainingAction).toBeNull();
  });

  it("activates when the provider has not yet been asked", async () => {
    const pending = db({
      replacementKey: dbKey("credential_issued_pending_activation"),
      credentialPersisted: true,
      reservationStatus: "activation_pending",
    });
    const h = harness([pending], [provider({ replacementKey: providerKey("generated") })]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.decision?.classification).toBe("PROVIDER_ACTIVATION_REQUIRED");
    expect(h.calls).toEqual(["activate"]);
  });

  it("replays a completed rotation", async () => {
    const state = db({
      reservationStatus: "completed",
      replacementKey: dbKey("active"),
      credentialPersisted: true,
    });
    const h = harness([state], [provider({ replacementKey: providerKey("active") })]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.outcome).toBe("REPLAYED");
    expect(h.calls).toEqual([]);
  });

  it("finalizes after a recorded signature", async () => {
    const state = db({
      replacementKey: dbKey("generated"),
      issuanceAttempt: attempt("signed", true),
    });
    const h = harness([state], [provider({ replacementKey: providerKey("generated") })]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.decision?.classification).toBe("FINALIZATION_REQUIRED");
    expect(h.calls).toEqual(["finalize"]);
  });
});

// ===========================================================================
// Conflicts and containment
// ===========================================================================
describe("conflicts and containment", () => {
  const divergences: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ["provider reference", { providerKeyReference: "dev-replacement:other" }],
    ["fingerprint", { publicKeyFingerprint: "e".repeat(64) }],
    ["key generation", { keyGeneration: 7 }],
  ];

  for (const [what, override] of divergences) {
    it(`fails closed when the ${what} differs between the systems`, async () => {
      const state = db({ replacementKey: dbKey("generated") });
      const h = harness(
        [state],
        [provider({ replacementKey: providerKey("generated", override) })],
      );
      const outcome = await reconcileDeviceCredentialRenewal(
        input(),
        h.reader,
        h.probe,
        h.executor,
        h.audit,
      );

      expect(outcome.refusalCode).toBe("RECONCILE_MANUAL_REVIEW");
      expect(outcome.decision?.classification).toBe("MANUAL_REVIEW_REQUIRED");
      expect(h.calls).toEqual([]);
      // The divergence is still RECORDED — that is the evidence a human needs.
      expect(h.audited).toHaveLength(1);
      expect(h.audited[0]?.classification).toBe("MANUAL_REVIEW_REQUIRED");
    });
  }

  it("refuses to recover an abandoned key to active, and contains it instead", async () => {
    const state = db({ replacementKey: dbKey("abandoned") });
    const h = harness([state], [provider({ replacementKey: providerKey("generated") })]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.decision?.classification).toBe("ABANDONMENT_REQUIRED");
    expect(h.calls).toEqual(["abandon"]);
    expect(h.calls).not.toContain("activate");
  });

  it("refuses a reconciler pointed at the wrong device or scope", async () => {
    const h = harness([db()], [provider()]);
    const wrongDevice = await reconcileDeviceCredentialRenewal(
      input({ deviceRecordId: OTHER_DEVICE }),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(wrongDevice.refusalCode).toBe("RECONCILE_WRONG_DEVICE");

    const h2 = harness([db()], [provider()]);
    const wrongScope = await reconcileDeviceCredentialRenewal(
      input({ purpose: "transport_signing" }),
      h2.reader,
      h2.probe,
      h2.executor,
      h2.audit,
    );
    expect(wrongScope.refusalCode).toBe("RECONCILE_WRONG_SCOPE");
    expect(h2.calls).toEqual([]);
  });

  it("refuses to keep issuing once the head has moved", async () => {
    const state = db({ headVersion: 4, credentialHeadVersion: 1 });
    const h = harness([state], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.refusalCode).toBe("RECONCILE_STALE_HEAD");
    expect(h.calls).toEqual([]);
  });

  it("refuses to keep issuing once the device has been reassigned", async () => {
    const state = db({ deviceAssignmentGeneration: 3, assignmentGeneration: 1 });
    const h = harness([state], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.refusalCode).toBe("RECONCILE_STALE_ASSIGNMENT");
    expect(h.calls).toEqual([]);
  });

  it("still replays a COMPLETED renewal even though the head has moved past it", async () => {
    // The frozen values already did their job. Reporting a head conflict here
    // would hide a renewal that succeeded.
    const state = db({
      renewalMode: "reuse_current_key",
      reservationStatus: "completed",
      credentialPersisted: true,
      headVersion: 9,
      credentialHeadVersion: 1,
    });
    const h = harness([state], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.outcome).toBe("REPLAYED");
  });

  it("refuses when trusted time is not established", async () => {
    const h = harness([db()], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input({
        trustedTime: {
          status: "restricted_clock_rollback",
          trustedTime: null,
          source: "none",
          floorAdvanced: false,
          anomalyType: "rollback",
          detail: "unit",
        },
      }),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.refusalCode).toBe("RECONCILE_NO_TRUSTED_TIME");
  });

  it("refuses when no reservation exists", async () => {
    const h = harness([db()], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      {
        async loadDatabaseState() {
          return null;
        },
      },
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.refusalCode).toBe("RECONCILE_NO_RESERVATION");
  });
});

// ===========================================================================
// Execution discipline and audit
// ===========================================================================
describe("execution discipline and audit", () => {
  it("performs exactly ONE action per call", async () => {
    const h = harness(
      [db(), db({ replacementKey: dbKey("generated") })],
      [provider(), provider({ replacementKey: providerKey("generated") })],
    );
    await reconcileDeviceCredentialRenewal(input(), h.reader, h.probe, h.executor, h.audit);
    expect(h.calls).toHaveLength(1);
  });

  it("reloads both systems and reports what remains", async () => {
    const before = db();
    const after = db({ replacementKey: dbKey("generated") });
    const h = harness(
      [before, after],
      [provider(), provider({ replacementKey: providerKey("generated") })],
    );
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.outcome).toBe("RECONCILED");
    // The state returned is the state AFTER the action, not before it.
    expect(outcome.databaseState?.replacementKey?.state).toBe("generated");
    expect(outcome.providerState?.replacementKey?.state).toBe("generated");
    expect(outcome.remainingAction).toBe("POP_REQUIRED");
  });

  it("executes nothing on a dry run, and still records what it would do", async () => {
    const h = harness([db()], [provider()]);
    const outcome = await reconcileDeviceCredentialRenewal(
      input({ execute: false }),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.outcome).toBe("NO_ACTION");
    expect(outcome.remainingAction).toBe("KEY_GENERATION_REQUIRED");
    expect(h.calls).toEqual([]);
    expect(h.audited[0]?.replayOutcome).toBe("dry-run");
  });

  it("records both observed states, the classification, the action and the actor", async () => {
    const h = harness([db()], [provider()]);
    await reconcileDeviceCredentialRenewal(input(), h.reader, h.probe, h.executor, h.audit);

    const record = h.audited[0]!;
    expect(record.renewalAttemptId).toBe(ATTEMPT);
    expect(record.observedDatabaseState).toContain("reservation=");
    expect(record.observedProviderState).toContain("key=");
    expect(record.classification).toBe("KEY_GENERATION_REQUIRED");
    expect(record.actionAttempted).not.toBe("");
    expect(record.actorRef).toBe("UNIT-RECONCILER");
    // Lifecycle names only — no key material, no connection strings, no nonce.
    const flattened = JSON.stringify(record);
    expect(flattened).not.toContain("PRIVATE KEY");
    expect(flattened).not.toContain("postgresql://");
  });

  it("reports a failed action rather than claiming progress", async () => {
    const h = harness([db()], [provider()], { failOn: "generate" });
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );

    expect(outcome.refusalCode).toBe("RECONCILE_ACTION_FAILED");
    expect(outcome.remainingAction).toBe("KEY_GENERATION_REQUIRED");
    expect(h.audited[0]?.failureCode).toContain("generate failed");
  });

  it("refuses when the reconciliation itself cannot be recorded", async () => {
    // The audit is durable evidence, not decoration. A reconciliation nobody
    // can explain afterwards is not a success.
    const h = harness([db()], [provider()], { auditThrows: true });
    const outcome = await reconcileDeviceCredentialRenewal(
      input(),
      h.reader,
      h.probe,
      h.executor,
      h.audit,
    );
    expect(outcome.outcome).toBe("REFUSED");
    expect(outcome.detail).toContain("could not be recorded");
  });

  it("produces one business effect when two reconcilers race", async () => {
    // Both observe the SAME pre-state. The executor is shared and idempotent —
    // exactly as the governed database functions and the provider are.
    const shared: string[] = [];
    const idempotent = (name: string) => async () => {
      shared.push(name);
      return `${name} ok`;
    };
    const executor: ReconciliationExecutor = {
      generateReplacementKey: idempotent("generate"),
      registerReplacementKey: idempotent("register"),
      proveReplacementPossession: idempotent("pop"),
      prepareIssuance: idempotent("prepare"),
      signAndRecord: idempotent("signAndRecord"),
      finalizeIssuance: idempotent("finalize"),
      activateProviderKey: idempotent("activate"),
      confirmActivation: idempotent("confirm"),
      abandonReplacementKey: idempotent("abandon"),
    };

    const a = harness([db(), db({ replacementKey: dbKey("generated") })], [provider()]);
    const b = harness(
      [db({ replacementKey: dbKey("generated") })],
      [provider({ replacementKey: providerKey("generated") })],
    );

    const [first, second] = await Promise.all([
      reconcileDeviceCredentialRenewal(input(), a.reader, a.probe, executor, a.audit),
      reconcileDeviceCredentialRenewal(input(), b.reader, b.probe, executor, b.audit),
    ]);

    expect(first.outcome).toBe("RECONCILED");
    expect(second.outcome).toBe("RECONCILED");
    // Two reconcilers, two DIFFERENT next steps — never two of the same effect.
    expect(shared).toHaveLength(2);
    expect(new Set(shared).size).toBe(2);
    expect(shared).toContain("generate");
    expect(shared).toContain("pop");
  });
});
