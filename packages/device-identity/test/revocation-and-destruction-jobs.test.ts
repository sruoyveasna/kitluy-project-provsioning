/**
 * Revocation, recovery-disposition and key-destruction jobs — unit tests.
 *
 * Authority: KLREQ-031 / KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001;
 * KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002; migration groups 0136-0141.
 *
 * WHAT THESE TESTS ARE FOR. Not coverage. Each block below is one of the rules
 * that stops an automated executor doing an irreversible thing on nobody's
 * authority, and each is written so that removing the guard makes a test fail
 * rather than makes a number go down:
 *
 *   1. a worker never bypasses human approval
 *   2. a worker never destroys a key the database did not clear
 *   3. an ambiguous provider outcome is never a blind retry
 *   4. attempts are bounded, and exhausting them is never a success
 *   5. replaying a job produces no second business effect
 *   6. discovery changes nothing
 *   7. outcome translation is a table, and an unmapped code is never a success
 *
 * WHAT THEY DO NOT PROVE. Retention windows, holds, four-eyes and the attempt
 * budget are enforced in the DATABASE. A stub gateway asserting them here would
 * prove only that the stub agrees with itself, so it does not try.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  RETRYABLE_FAILURE_CODES,
  classifyFailureCode,
  type DurableJob,
  type WorkerIdentity,
} from "@kitluy/job-contracts";

import {
  DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND,
  DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND,
  DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS,
  DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND,
  DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND,
  DEVICE_REVOCATION_AND_DESTRUCTION_JOB_KINDS,
  DEVICE_REVOCATION_JOB_FAILURE_CODES,
  KEY_DESTRUCTION_REQUEST_STATUSES,
  RECOVERY_DISPOSITION_BASES,
  credentialRecoveryDispositionDedupeKey,
  credentialRecoveryDispositionHandler,
  credentialRevocationExecuteDedupeKey,
  credentialRevocationExecuteHandler,
  destructionExecutionAttemptPermitted,
  destructionExecutionAttemptsSpent,
  discoverLapsedEmergencyPostApprovals,
  discoverRevocationAndDestructionWork,
  providerKeyDestructionExecuteDedupeKey,
  providerKeyDestructionExecuteHandler,
  providerKeyDestructionReconcileDedupeKey,
  providerKeyDestructionReconcileHandler,
  routeDestructionRequestStatus,
  routeKeyDestructionOutcome,
  routeRecoveryDisposition,
  routeRevocationOutcome,
  type DestructionReconciliationProposer,
  type EmergencyPostApprovalCandidate,
  type KeyDestructionExecuteCandidate,
  type KeyDestructionReconcileCandidate,
  type KeyDestructionRequestStatus,
  type RecoveryDispositionCandidate,
  type RevocationAndDestructionDiscovery,
  type RevocationExecuteCandidate,
} from "../src/revocation-and-destruction-jobs.js";
import {
  DEVICE_JOB_MAX_ATTEMPTS,
  DEVICE_JOB_SCHEMA_VERSION,
  type DiscoveredJobRequest,
} from "../src/credential-lifecycle-jobs.js";
import {
  CREDENTIAL_RECOVERY_DISPOSITIONS,
  CREDENTIAL_REVOCATION_REASONS,
  COMPROMISE_REASONS,
  recoveryDispositionFor,
  type GovernedRevocationCall,
  type RevocationGateway,
  type RevocationOutcome,
  type RevocationOutcomeCode,
} from "../src/credential-revocation.js";
import {
  MAX_DESTRUCTION_EXECUTION_ATTEMPTS,
  type KeyDestructionGateway,
  type KeyDestructionOutcome,
  type KeyDestructionOutcomeCode,
  type ProviderKeyDestroyer,
} from "../src/key-destruction.js";
import {
  ProviderDestructionAmbiguousError,
  ReplacementKeyError,
  type ProviderDestructionReceipt,
} from "../src/replacement-key-provider.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DEVICE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_DEVICE_ID = "33333333-3333-4333-8333-333333333333";
const REVOCATION_REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const DESTRUCTION_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const WORKER: WorkerIdentity = {
  workerInstanceId: "worker-instance-1",
  serviceIdentity: "service:device-credential-worker",
  environment: "development",
  softwareVersion: "0.1.0",
};

function durableJob(payload: Record<string, unknown>, over: Partial<DurableJob> = {}): DurableJob {
  return {
    jobId: "job-1",
    jobKind: "kitluy.devices.test",
    jobVersion: DEVICE_JOB_SCHEMA_VERSION,
    dedupeKey: "dedupe-1",
    environment: "development",
    subjectId: DEVICE_ID,
    payload,
    status: "running",
    attemptCount: 1,
    deferralCount: 0,
    maxAttempts: DEVICE_JOB_MAX_ATTEMPTS,
    nextAttemptAt: null,
    leaseId: "lease-1",
    leaseOwner: WORKER.workerInstanceId,
    leaseExpiresAt: null,
    ...over,
  };
}

/** A well-formed, fully approved revocation payload. Tests remove one field. */
function revocationPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    revocationRequestId: REVOCATION_REQUEST_ID,
    deviceRecordId: DEVICE_ID,
    purpose: "device_identity",
    credentialGeneration: 3,
    reasonCode: "DEVICE_STOLEN",
    reason: "reported stolen at the depot",
    requestedBy: "person:fleet-lead",
    source: "console:security",
    approvalRequestId: "approval-9001",
    approvedBy: "person:security-officer",
    recoveryDisposition: null,
    incidentReference: "INC-7788",
    ...over,
  };
}

function destructionPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    destructionRequestId: DESTRUCTION_REQUEST_ID,
    deviceRecordId: DEVICE_ID,
    purpose: "device_identity",
    providerKeyReference: "ref-approved",
    publicKeyFingerprint: "fp-approved",
    keyGeneration: 2,
    ...over,
  };
}

// --- revocation gateway ----------------------------------------------------

interface RecordingRevocationGateway extends RevocationGateway {
  readonly calls: GovernedRevocationCall[];
  /** How many DISTINCT credentials this fake actually repudiated. */
  effects(): number;
}

/**
 * Behaves the way group 0136 does about replays: a second call carrying the
 * same revocation request id is `ALREADY_REVOKED`, not a second revocation.
 */
function revocationGateway(
  answer?: (call: GovernedRevocationCall) => RevocationOutcome,
): RecordingRevocationGateway {
  const calls: GovernedRevocationCall[] = [];
  const revoked = new Set<string>();
  return {
    calls,
    effects: () => revoked.size,
    revokeDeviceCredential(call: GovernedRevocationCall): Promise<RevocationOutcome> {
      calls.push(call);
      if (answer !== undefined) return Promise.resolve(answer(call));
      if (revoked.has(call.revocationRequestId)) {
        return Promise.resolve({
          outcome: "ALREADY_REVOKED",
          revocationId: `rev-${call.revocationRequestId}`,
        });
      }
      revoked.add(call.revocationRequestId);
      return Promise.resolve({
        outcome: "REVOKED",
        revocationId: `rev-${call.revocationRequestId}`,
        recoveryDisposition: call.recoveryDisposition,
      });
    },
  };
}

// --- destruction gateway and provider --------------------------------------

interface DestructionStep {
  readonly step: string;
}

function destructionGateway(
  answers: Partial<Record<string, Record<string, unknown>>>,
  log: DestructionStep[],
): KeyDestructionGateway {
  const answer = (step: string): Promise<Record<string, unknown>> => {
    log.push({ step });
    return Promise.resolve(answers[step] ?? { outcome: "EXECUTION_REFUSED" });
  };
  return {
    evaluateEligibility: () => answer("evaluate"),
    requestKeyDestruction: () => answer("request"),
    approveKeyDestruction: () => answer("approve"),
    beginKeyDestructionExecution: () => answer("begin"),
    confirmKeyDestruction: () => answer("confirm"),
  };
}

function receipt(over: Partial<ProviderDestructionReceipt> = {}): ProviderDestructionReceipt {
  return {
    destructionRequestId: DESTRUCTION_REQUEST_ID,
    providerKeyReference: "ref-approved",
    publicKeyFingerprint: "fp-approved",
    keyGeneration: 2,
    result: "DESTROYED",
    receiptDigest: "a".repeat(64),
    responseReference: "dev-destruction:1",
    requestedAt: new Date("2026-07-29T10:00:00.000Z"),
    completedAt: new Date("2026-07-29T10:00:01.000Z"),
    attestationKind: "development_simulated",
    ...over,
  };
}

function destroyer(
  behaviour: { readonly receipt?: ProviderDestructionReceipt; readonly error?: Error },
  calls: { n: number },
): ProviderKeyDestroyer {
  return {
    destroyProviderKey: () => {
      calls.n += 1;
      if (behaviour.error !== undefined) return Promise.reject(behaviour.error);
      return Promise.resolve(behaviour.receipt ?? receipt());
    },
  };
}

function recordingProposer(): DestructionReconciliationProposer & {
  readonly proposed: DiscoveredJobRequest[];
} {
  const proposed: DiscoveredJobRequest[] = [];
  return {
    proposed,
    propose(request: DiscoveredJobRequest): Promise<void> {
      proposed.push(request);
      return Promise.resolve();
    },
  };
}

// --- lapse fixtures --------------------------------------------------------

const EMERGENCY_ID = "55555555-5555-4555-8555-555555555555";
const DUE_AT = new Date("2026-07-29T12:00:00.000Z");

function emergencyCandidate(
  over: Partial<EmergencyPostApprovalCandidate> = {},
): EmergencyPostApprovalCandidate {
  return {
    emergencyRevocationId: EMERGENCY_ID,
    deviceRecordId: DEVICE_ID,
    environment: "development",
    purpose: "device_identity",
    reasonCode: "DEVICE_STOLEN",
    postApprovalDueAt: DUE_AT,
    postApprovalDecision: "PENDING",
    incidentReference: "INC-7788",
    ...over,
  };
}

// ---------------------------------------------------------------------------

describe("job kinds and budgets are data, not folklore", () => {
  it("names four versioned kinds in the repository's device namespace", () => {
    for (const kind of DEVICE_REVOCATION_AND_DESTRUCTION_JOB_KINDS) {
      expect(kind.startsWith("kitluy.devices.")).toBe(true);
      expect(kind.endsWith(".v1")).toBe(true);
    }
    expect(new Set(DEVICE_REVOCATION_AND_DESTRUCTION_JOB_KINDS).size).toBe(4);
  });

  it("lists exactly the four kinds this module handles", () => {
    expect([...DEVICE_REVOCATION_AND_DESTRUCTION_JOB_KINDS]).toEqual([
      DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND,
      DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND,
      DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND,
      DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND,
    ]);
  });

  it("registers each handler under the kind it claims", () => {
    expect(
      credentialRevocationExecuteHandler({ gateway: revocationGateway(), identity: WORKER })
        .jobKind,
    ).toBe(DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND);
    expect(credentialRecoveryDispositionHandler().jobKind).toBe(
      DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND,
    );
    expect(
      providerKeyDestructionExecuteHandler({
        gateway: destructionGateway({}, []),
        provider: destroyer({}, { n: 0 }),
        identity: WORKER,
      }).jobKind,
    ).toBe(DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND);
    expect(
      providerKeyDestructionReconcileHandler({
        reader: { readDestructionRequestStatus: () => Promise.resolve(null) },
      }).jobKind,
    ).toBe(DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND);
  });

  it("takes the TIGHTER of the runtime bound and the KLREQ-031 budget", () => {
    expect(DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS).toBe(
      Math.min(DEVICE_JOB_MAX_ATTEMPTS, MAX_DESTRUCTION_EXECUTION_ATTEMPTS),
    );
    expect(DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS).toBe(5);
  });

  it("keeps the two recovery-obligation id spaces apart", () => {
    expect([...RECOVERY_DISPOSITION_BASES]).toEqual([
      "REVOCATION",
      "EMERGENCY_POST_APPROVAL_LAPSE",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — deterministic identity
// ---------------------------------------------------------------------------

describe("rule 5: dedupe keys are built from authoritative facts and never a clock", () => {
  const revocationInput = {
    revocationRequestId: REVOCATION_REQUEST_ID,
    deviceRecordId: DEVICE_ID,
    environment: "development",
    purpose: "device_identity",
    credentialGeneration: 3,
  };
  const destructionInput = {
    destructionRequestId: DESTRUCTION_REQUEST_ID,
    deviceRecordId: DEVICE_ID,
    environment: "development",
    providerKeyReference: "ref-approved",
    keyGeneration: 2,
  };
  const reconcileInput = {
    destructionRequestId: DESTRUCTION_REQUEST_ID,
    deviceRecordId: DEVICE_ID,
    environment: "development",
    providerKeyReference: "ref-approved",
  };
  const recoveryInput = {
    basis: "REVOCATION" as const,
    revocationRecordId: REVOCATION_REQUEST_ID,
    deviceRecordId: DEVICE_ID,
    environment: "development",
    purpose: "device_identity",
  };

  it("returns the same revocation key for the same authoritative facts", () => {
    expect(credentialRevocationExecuteDedupeKey(revocationInput)).toBe(
      credentialRevocationExecuteDedupeKey(revocationInput),
    );
  });

  it("changes the revocation key when the revocation REQUEST changes", () => {
    expect(
      credentialRevocationExecuteDedupeKey({
        ...revocationInput,
        revocationRequestId: "another-request",
      }),
    ).not.toBe(credentialRevocationExecuteDedupeKey(revocationInput));
  });

  it("changes the revocation key when the credential generation changes", () => {
    expect(
      credentialRevocationExecuteDedupeKey({ ...revocationInput, credentialGeneration: 4 }),
    ).not.toBe(credentialRevocationExecuteDedupeKey(revocationInput));
  });

  it("separates the two recovery-obligation id spaces by basis", () => {
    expect(credentialRecoveryDispositionDedupeKey(recoveryInput)).not.toBe(
      credentialRecoveryDispositionDedupeKey({
        ...recoveryInput,
        basis: "EMERGENCY_POST_APPROVAL_LAPSE",
      }),
    );
  });

  it("returns the same destruction key for the same request", () => {
    expect(providerKeyDestructionExecuteDedupeKey(destructionInput)).toBe(
      providerKeyDestructionExecuteDedupeKey(destructionInput),
    );
    expect(
      providerKeyDestructionExecuteDedupeKey({
        ...destructionInput,
        destructionRequestId: "another-request",
      }),
    ).not.toBe(providerKeyDestructionExecuteDedupeKey(destructionInput));
  });

  it("gives one reconcile key per destruction request", () => {
    expect(providerKeyDestructionReconcileDedupeKey(reconcileInput)).toBe(
      providerKeyDestructionReconcileDedupeKey(reconcileInput),
    );
    expect(
      providerKeyDestructionReconcileDedupeKey({
        ...reconcileInput,
        destructionRequestId: "another-request",
      }),
    ).not.toBe(providerKeyDestructionReconcileDedupeKey(reconcileInput));
  });

  it("puts no instant of any kind in any key", () => {
    const keys = [
      credentialRevocationExecuteDedupeKey(revocationInput),
      credentialRecoveryDispositionDedupeKey(recoveryInput),
      providerKeyDestructionExecuteDedupeKey(destructionInput),
      providerKeyDestructionReconcileDedupeKey(reconcileInput),
    ];
    for (const key of keys) {
      // No ISO instant, no epoch-millisecond stamp.
      expect(key).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(key).not.toMatch(/\b1[6-9]\d{11}\b/);
    }
    // And each key names its own kind, so two kinds cannot collide.
    expect(new Set(keys).size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Rule 1 — a worker never bypasses human approval
// ---------------------------------------------------------------------------

describe("rule 1: a worker executes an approval and never creates one", () => {
  it("REFUSES a revocation whose payload carries no approval reference", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    const result = await handler.handle(durableJob(revocationPayload({ approvalRequestId: null })));

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.APPROVAL_REFERENCE_ABSENT,
    });
    // The governed function consumes an approval single-use; the refusal has to
    // happen before it is reached, not after.
    expect(gateway.calls).toHaveLength(0);
    expect(result.evidence.calledOperation).toBe("none");
  });

  it("REFUSES a revocation whose approval reference names no approver", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    const result = await handler.handle(durableJob(revocationPayload({ approvedBy: "" })));

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.APPROVER_ABSENT,
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it("REFUSES to be its own approver", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    const result = await handler.handle(
      durableJob(revocationPayload({ approvedBy: WORKER.serviceIdentity })),
    );

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.WORKER_SELF_APPROVED,
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it("passes the approval reference through EXACTLY as it was given", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    const result = await handler.handle(durableJob(revocationPayload()));

    expect(result.disposition).toEqual({ kind: "completed", resultCode: "REVOKED" });
    expect(gateway.calls).toHaveLength(1);
    const call = gateway.calls[0];
    expect(call?.approvalRequestId).toBe("approval-9001");
    expect(call?.approvedBy).toBe("person:security-officer");
    expect(call?.requestedBy).toBe("person:fleet-lead");
    expect(call?.source).toBe("console:security");
  });

  it("contributes NOTHING of its own to the governed call", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    await handler.handle(durableJob(revocationPayload()));

    // Every accountability field came from the payload. If the worker's own
    // identity appeared anywhere in the governed call, it would be standing in
    // for a person somewhere.
    expect(JSON.stringify(gateway.calls[0])).not.toContain(WORKER.serviceIdentity);
    expect(JSON.stringify(gateway.calls[0])).not.toContain(WORKER.workerInstanceId);
  });

  it("defaults the recovery disposition from the REASON, never from the worker", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    await handler.handle(durableJob(revocationPayload({ recoveryDisposition: null })));

    expect(gateway.calls[0]?.recoveryDisposition).toBe(recoveryDispositionFor("DEVICE_STOLEN"));
  });

  it("classifies every approval-gate refusal towards a human", () => {
    for (const code of [
      DEVICE_REVOCATION_JOB_FAILURE_CODES.APPROVAL_REFERENCE_ABSENT,
      DEVICE_REVOCATION_JOB_FAILURE_CODES.APPROVER_ABSENT,
      DEVICE_REVOCATION_JOB_FAILURE_CODES.WORKER_SELF_APPROVED,
    ]) {
      expect(classifyFailureCode(code)).toBe("manual_review");
      expect(RETRYABLE_FAILURE_CODES.has(code)).toBe(false);
    }
  });

  it("does not propose revocation work that has no approval behind it", async () => {
    const unapproved: RevocationExecuteCandidate = {
      revocationRequestId: REVOCATION_REQUEST_ID,
      deviceRecordId: DEVICE_ID,
      environment: "development",
      purpose: "device_identity",
      credentialGeneration: 3,
      reasonCode: "DEVICE_STOLEN",
      reason: "reported stolen",
      requestedBy: "person:fleet-lead",
      source: "console:security",
      approvalRequestId: null,
      approvedBy: null,
      recoveryDisposition: null,
      incidentReference: null,
    };
    const requests = await discoverRevocationAndDestructionWork(
      "development",
      discovery({ revocations: [unapproved] }),
      "worker",
    );
    expect(requests).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Rule 5 — replaying a job produces no second business effect
// ---------------------------------------------------------------------------

describe("rule 5: replaying a revocation job repudiates one credential, once", () => {
  it("sends the same revocation intent and lands one effect", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });
    const job = durableJob(revocationPayload());

    const first = await handler.handle(job);
    const second = await handler.handle({ ...job, attemptCount: 2 });

    expect(gateway.calls).toHaveLength(2);
    expect(gateway.calls[0]?.revocationRequestId).toBe(gateway.calls[1]?.revocationRequestId);
    // Two calls, ONE repudiated credential.
    expect(gateway.effects()).toBe(1);
    expect(first.disposition).toEqual({ kind: "completed", resultCode: "REVOKED" });
    expect(second.disposition).toEqual({ kind: "completed", resultCode: "JOB_RESULT_REPLAYED" });
  });

  it("proposes the same dedupe key on every discovery sweep", async () => {
    const disco = discovery({ revocations: [approvedCandidate()] });
    const first = await discoverRevocationAndDestructionWork("development", disco, "worker");
    const second = await discoverRevocationAndDestructionWork("development", disco, "worker");
    expect(first[0]?.dedupeKey).toBe(second[0]?.dedupeKey);
  });
});

// ---------------------------------------------------------------------------
// Rule 7 — outcome translation is a table
// ---------------------------------------------------------------------------

describe("rule 7: outcome translation is a table, and unknown never means success", () => {
  it("routes every governed revocation outcome, completing only the two that are done", () => {
    const routed = new Map<RevocationOutcomeCode, string>();
    for (const code of [
      "REVOKED",
      "ALREADY_REVOKED",
      "REVOCATION_REFUSED",
      "MANUAL_REVIEW_REQUIRED",
    ] as const) {
      routed.set(code, routeRevocationOutcome({ outcome: code }).kind);
    }
    expect(routed.get("REVOKED")).toBe("completed");
    expect(routed.get("ALREADY_REVOKED")).toBe("completed");
    expect(routed.get("REVOCATION_REFUSED")).toBe("failed");
    expect(routed.get("MANUAL_REVIEW_REQUIRED")).toBe("failed");
  });

  it("fails on a revocation outcome no table names", () => {
    const routing = routeRevocationOutcome({
      outcome: "A_WORD_THIS_REPOSITORY_HAS_NEVER_HEARD" as RevocationOutcomeCode,
    });
    expect(routing.kind).toBe("failed");
  });

  it("retries only the refusal that decided nothing", () => {
    const gatewayFailed = routeRevocationOutcome({
      outcome: "REVOCATION_REFUSED",
      refusalCode: "REVOCATION_GATEWAY_FAILED",
    });
    expect(gatewayFailed).toEqual({ kind: "failed", failureCode: "DATABASE_UNAVAILABLE" });
    expect(classifyFailureCode("DATABASE_UNAVAILABLE")).toBe("retryable");

    // A refusal word that belongs to the database is NOT in this repository's
    // table, and falls to a human rather than to a guess.
    const databaseRefusal = routeRevocationOutcome({
      outcome: "REVOCATION_REFUSED",
      refusalCode: "KLUY-CRED-REVOCATION-RISK-CLASS",
    });
    expect(databaseRefusal.kind).toBe("failed");
    expect(classifyFailureCode(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_REFUSED)).toBe(
      "manual_review",
    );
  });

  it("does not report success when the service returns an outcome nobody mapped", async () => {
    const gateway = revocationGateway(() => ({
      outcome: "SOMETHING_NEW_FROM_GROUP_0142" as RevocationOutcomeCode,
    }));
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    const result = await handler.handle(durableJob(revocationPayload()));

    expect(result.disposition.kind).toBe("failed");
    expect(classifyFailureCode(DEVICE_REVOCATION_JOB_FAILURE_CODES.REVOCATION_MANUAL_REVIEW)).toBe(
      "manual_review",
    );
  });

  it("routes every recovery disposition, and refuses one it does not know", () => {
    for (const disposition of CREDENTIAL_RECOVERY_DISPOSITIONS) {
      const routing = routeRecoveryDisposition(disposition);
      expect(routing.kind).toBe(disposition === "MANUAL_SECURITY_REVIEW" ? "failed" : "completed");
    }
    expect(routeRecoveryDisposition("SOMETHING_ELSE")).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_UNKNOWN_DISPOSITION,
    });
  });

  it("routes every governed destruction outcome, completing only the resolved ones", () => {
    const expected: Record<KeyDestructionOutcomeCode, "completed" | "failed"> = {
      DESTROYED: "completed",
      ALREADY_DESTROYED: "completed",
      ALREADY_CONFIRMED: "completed",
      DESTRUCTION_REFUSED: "failed",
      RECONCILIATION_REQUIRED: "failed",
      MANUAL_REVIEW_REQUIRED: "failed",
    };
    for (const [code, kind] of Object.entries(expected)) {
      expect(routeKeyDestructionOutcome({ outcome: code as KeyDestructionOutcomeCode }).kind).toBe(
        kind,
      );
    }
    expect(
      routeKeyDestructionOutcome({ outcome: "PROBABLY_FINE" as KeyDestructionOutcomeCode }).kind,
    ).toBe("failed");
  });

  it("closes a reconciliation only on the status the database can prove", () => {
    for (const status of KEY_DESTRUCTION_REQUEST_STATUSES) {
      const routing = routeDestructionRequestStatus(status);
      expect(routing.kind).toBe(status === "executed" ? "completed" : "failed");
    }
    expect(routeDestructionRequestStatus("half_executed")).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_UNKNOWN_REQUEST_STATE,
    });
  });

  it("never lets one of its own failure codes read as a success or a retry", () => {
    for (const code of Object.values(DEVICE_REVOCATION_JOB_FAILURE_CODES)) {
      expect(classifyFailureCode(code)).toBe("manual_review");
      expect(RETRYABLE_FAILURE_CODES.has(code)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Rule 2 — a worker never destroys a key the database did not clear
// ---------------------------------------------------------------------------

describe("rule 2: destruction goes through the governed service and nowhere else", () => {
  it("does not call the provider when the database refuses the attempt", async () => {
    const log: DestructionStep[] = [];
    const calls = { n: 0 };
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway({ begin: { outcome: "EXECUTION_REFUSED" } }, log),
      provider: destroyer({}, calls),
      identity: WORKER,
    });

    const result = await handler.handle(durableJob(destructionPayload()));

    expect(calls.n).toBe(0);
    expect(log.map((entry) => entry.step)).toEqual(["begin"]);
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_REFUSED,
    });
  });

  it("has no provider-destroy call of its own anywhere in its source", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/revocation-and-destruction-jobs.ts", import.meta.url)),
      "utf8",
    );
    // Not a stylistic check. `executeProviderKeyDestruction` owns the only safe
    // ordering — database clears, provider erases, receipt is verified, database
    // confirms — and a second call site here would erase a key outside it.
    expect(source).not.toMatch(/destroyProviderKey/);
    expect(source).not.toMatch(/from "\.\/replacement-key-provider\.js"/);
    expect(source).toMatch(/executeProviderKeyDestruction\(/);
    // Nor may it confirm a destruction itself.
    expect(source).not.toMatch(/confirmKeyDestruction/);
  });

  it("confirms only after the provider produced a receipt, in that order", async () => {
    const log: DestructionStep[] = [];
    const calls = { n: 0 };
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        {
          begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 },
          confirm: { outcome: "DESTROYED" },
        },
        log,
      ),
      provider: destroyer({ receipt: receipt() }, calls),
      identity: WORKER,
    });

    const result = await handler.handle(durableJob(destructionPayload()));

    expect(log.map((entry) => entry.step)).toEqual(["begin", "confirm"]);
    expect(calls.n).toBe(1);
    expect(result.disposition).toEqual({ kind: "completed", resultCode: "DESTROYED" });
  });

  it("does not confirm when the provider refused a changed binding", async () => {
    const log: DestructionStep[] = [];
    const calls = { n: 0 };
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        { begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } },
        log,
      ),
      provider: destroyer(
        { error: new ReplacementKeyError("PROVIDER_KEY_MISSING", "the key is not there") },
        calls,
      ),
      identity: WORKER,
    });

    const result = await handler.handle(durableJob(destructionPayload()));

    expect(log.map((entry) => entry.step)).toEqual(["begin"]);
    expect(result.disposition.kind).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Rule 3 — ambiguity is never a blind retry
// ---------------------------------------------------------------------------

describe("rule 3: a provider that did not answer is a question for a person", () => {
  const ambiguous = () =>
    new ProviderDestructionAmbiguousError("ref-approved", "TIMEOUT", "no answer");

  it("routes an ambiguous outcome to manual review and never confirms", async () => {
    const log: DestructionStep[] = [];
    const calls = { n: 0 };
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        { begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } },
        log,
      ),
      provider: destroyer({ error: ambiguous() }, calls),
      identity: WORKER,
    });

    const result = await handler.handle(durableJob(destructionPayload()));

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED,
    });
    expect(calls.n).toBe(1);
    expect(log.map((entry) => entry.step)).toEqual(["begin"]);
  });

  it("keeps that code out of the retry set so the provider is not asked again", () => {
    const code = DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED;
    expect(RETRYABLE_FAILURE_CODES.has(code)).toBe(false);
    expect(classifyFailureCode(code)).toBe("manual_review");
  });

  it("proposes one reconcile job, of the reconcile kind, that runs once", async () => {
    const proposer = recordingProposer();
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        { begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } },
        [],
      ),
      provider: destroyer({ error: ambiguous() }, { n: 0 }),
      identity: WORKER,
      reconciliation: proposer,
    });

    await handler.handle(durableJob(destructionPayload()));

    expect(proposer.proposed).toHaveLength(1);
    const proposed = proposer.proposed[0];
    expect(proposed?.jobKind).toBe(DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND);
    expect(proposed?.dedupeKey).toBe(
      providerKeyDestructionReconcileDedupeKey({
        destructionRequestId: DESTRUCTION_REQUEST_ID,
        deviceRecordId: DEVICE_ID,
        environment: "development",
        providerKeyReference: "ref-approved",
      }),
    );
    // Reconciliation is a question for a person; an automatic ladder of re-asks
    // would only delay them.
    expect(proposed?.maxAttempts).toBe(1);
  });

  it("proposes the SAME reconcile key when a second attempt is also ambiguous", async () => {
    const proposer = recordingProposer();
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        { begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } },
        [],
      ),
      provider: destroyer({ error: ambiguous() }, { n: 0 }),
      identity: WORKER,
      reconciliation: proposer,
    });
    const job = durableJob(destructionPayload());

    await handler.handle(job);
    await handler.handle({ ...job, attemptCount: 2 });

    expect(proposer.proposed).toHaveLength(2);
    expect(proposer.proposed[0]?.dedupeKey).toBe(proposer.proposed[1]?.dedupeKey);
  });

  it("keeps the manual-review disposition when the proposal itself fails to queue", async () => {
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        { begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } },
        [],
      ),
      provider: destroyer({ error: ambiguous() }, { n: 0 }),
      identity: WORKER,
      reconciliation: { propose: () => Promise.reject(new Error("queue unavailable")) },
    });

    const result = await handler.handle(durableJob(destructionPayload()));

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED,
    });
  });

  it("routes to manual review even with no proposer configured at all", async () => {
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        { begin: { outcome: "EXECUTION_CLEARED", attempt_number: 1 } },
        [],
      ),
      provider: destroyer({ error: ambiguous() }, { n: 0 }),
      identity: WORKER,
    });

    const result = await handler.handle(durableJob(destructionPayload()));

    expect(result.disposition.kind).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Rule 4 — bounded retries
// ---------------------------------------------------------------------------

describe("rule 4: the attempt budget is bounded and running out is never a success", () => {
  it("refuses before calling anything once the budget is spent", async () => {
    const log: DestructionStep[] = [];
    const calls = { n: 0 };
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        { begin: { outcome: "EXECUTION_CLEARED", attempt_number: 6 } },
        log,
      ),
      provider: destroyer({}, calls),
      identity: WORKER,
    });

    const result = await handler.handle(
      durableJob(destructionPayload(), { attemptCount: DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS + 1 }),
    );

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_ATTEMPTS_EXHAUSTED,
    });
    expect(log).toHaveLength(0);
    expect(calls.n).toBe(0);
    expect(result.evidence.calledOperation).toBe("none");
    // Exhausting the budget is a manual-review disposition. Never a success,
    // and never a retry that would ask a provider a sixth time.
    expect(
      classifyFailureCode(DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_ATTEMPTS_EXHAUSTED),
    ).toBe("manual_review");
  });

  it("still runs on the last permitted attempt, and not one later", () => {
    const last = durableJob(destructionPayload(), {
      attemptCount: DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS,
    });
    const past = durableJob(destructionPayload(), {
      attemptCount: DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS + 1,
    });
    expect(destructionExecutionAttemptsSpent(last)).toBe(DEVICE_DESTRUCTION_JOB_MAX_ATTEMPTS - 1);
    expect(destructionExecutionAttemptPermitted(last)).toBe(true);
    expect(destructionExecutionAttemptPermitted(past)).toBe(false);
  });

  it("does not charge a deferral against the budget", () => {
    // A claim that ended in "not due yet" is not a failed attempt, and counting
    // it as one would exhaust a healthy request's budget on nothing.
    const deferredOften = durableJob(destructionPayload(), {
      attemptCount: 8,
      deferralCount: 4,
    });
    expect(destructionExecutionAttemptsSpent(deferredOften)).toBe(3);
    expect(destructionExecutionAttemptPermitted(deferredOften)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 6 — discovery changes nothing
// ---------------------------------------------------------------------------

function approvedCandidate(
  over: Partial<RevocationExecuteCandidate> = {},
): RevocationExecuteCandidate {
  return {
    revocationRequestId: REVOCATION_REQUEST_ID,
    deviceRecordId: DEVICE_ID,
    environment: "development",
    purpose: "device_identity",
    credentialGeneration: 3,
    reasonCode: "DEVICE_STOLEN",
    reason: "reported stolen at the depot",
    requestedBy: "person:fleet-lead",
    source: "console:security",
    approvalRequestId: "approval-9001",
    approvedBy: "person:security-officer",
    recoveryDisposition: null,
    incidentReference: "INC-7788",
    ...over,
  };
}

function destructionCandidate(status: string): KeyDestructionExecuteCandidate {
  return {
    destructionRequestId: DESTRUCTION_REQUEST_ID,
    deviceRecordId: DEVICE_ID,
    environment: "development",
    purpose: "device_identity",
    providerKeyReference: "ref-approved",
    publicKeyFingerprint: "fp-approved",
    keyGeneration: 2,
    requestStatus: status,
  };
}

interface DiscoveryFixture {
  readonly revocations?: readonly RevocationExecuteCandidate[];
  readonly recoveries?: readonly RecoveryDispositionCandidate[];
  readonly destructions?: readonly KeyDestructionExecuteCandidate[];
  readonly reconciliations?: readonly KeyDestructionReconcileCandidate[];
}

function discovery(fixture: DiscoveryFixture): RevocationAndDestructionDiscovery {
  return {
    findApprovedRevocations: () => Promise.resolve(fixture.revocations ?? []),
    findRevocationsAwaitingRecoveryDisposition: () => Promise.resolve(fixture.recoveries ?? []),
    findClearedKeyDestructions: () => Promise.resolve(fixture.destructions ?? []),
    findUnreconciledKeyDestructions: () => Promise.resolve(fixture.reconciliations ?? []),
  };
}

describe("rule 6: discovery proposes work and changes nothing", () => {
  it("proposes one job per kind from the state it observed", async () => {
    const requests = await discoverRevocationAndDestructionWork(
      "development",
      discovery({
        revocations: [approvedCandidate()],
        recoveries: [
          {
            revocationRecordId: "rev-1",
            deviceRecordId: DEVICE_ID,
            environment: "development",
            purpose: "device_identity",
            reasonCode: "ADMINISTRATIVE_REPLACEMENT",
            recoveryDisposition: null,
            incidentReference: null,
          },
        ],
        destructions: [destructionCandidate("approved")],
        reconciliations: [
          {
            destructionRequestId: DESTRUCTION_REQUEST_ID,
            deviceRecordId: DEVICE_ID,
            environment: "development",
            providerKeyReference: "ref-approved",
            requestStatus: "pending_execution",
            providerOutcomeAmbiguous: true,
          },
        ],
      }),
      "worker",
    );

    expect(requests.map((r) => r.jobKind)).toEqual([
      DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND,
      DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND,
      DEVICE_PROVIDER_KEY_DESTRUCTION_EXECUTE_JOB_KIND,
      DEVICE_PROVIDER_KEY_DESTRUCTION_RECONCILE_JOB_KIND,
    ]);
    for (const request of requests) {
      expect(request.jobVersion).toBe(DEVICE_JOB_SCHEMA_VERSION);
      expect(request.subjectId).toBe(DEVICE_ID);
    }
  });

  it("proposes destruction work only for the statuses the database has cleared", async () => {
    const proposedFor: string[] = [];
    for (const status of KEY_DESTRUCTION_REQUEST_STATUSES) {
      const requests = await discoverRevocationAndDestructionWork(
        "development",
        discovery({ destructions: [destructionCandidate(status)] }),
        "worker",
      );
      if (requests.length > 0) proposedFor.push(status);
    }
    // `requested` is deliberately absent: four eyes has not happened yet.
    expect(proposedFor).toEqual(["approved", "pending_execution"]);
  });

  it("proposes nothing for a destruction status it does not recognise", async () => {
    const requests = await discoverRevocationAndDestructionWork(
      "development",
      discovery({ destructions: [destructionCandidate("nearly_approved")] }),
      "worker",
    );
    expect(requests).toHaveLength(0);
  });

  it("proposes reconciliation only for an OBSERVED ambiguity", async () => {
    const base: KeyDestructionReconcileCandidate = {
      destructionRequestId: DESTRUCTION_REQUEST_ID,
      deviceRecordId: DEVICE_ID,
      environment: "development",
      providerKeyReference: "ref-approved",
      requestStatus: "failed",
      providerOutcomeAmbiguous: false,
    };
    const notAmbiguous = await discoverRevocationAndDestructionWork(
      "development",
      discovery({ reconciliations: [base] }),
      "worker",
    );
    const alreadyExecuted = await discoverRevocationAndDestructionWork(
      "development",
      discovery({
        reconciliations: [{ ...base, providerOutcomeAmbiguous: true, requestStatus: "executed" }],
      }),
      "worker",
    );
    expect(notAmbiguous).toHaveLength(0);
    expect(alreadyExecuted).toHaveLength(0);
  });

  it("returns identical proposals for identical state, sweep after sweep", async () => {
    const fixture: DiscoveryFixture = {
      revocations: [approvedCandidate()],
      destructions: [destructionCandidate("approved")],
    };
    const first = await discoverRevocationAndDestructionWork(
      "development",
      discovery(fixture),
      "worker",
    );
    const second = await discoverRevocationAndDestructionWork(
      "development",
      discovery(fixture),
      "worker",
    );
    expect(first).toEqual(second);
  });

  it("does not mutate the candidates it was given", async () => {
    const candidates = [approvedCandidate()];
    const before = structuredClone(candidates);
    await discoverRevocationAndDestructionWork(
      "development",
      discovery({ revocations: candidates }),
      "worker",
    );
    expect(candidates).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Lapse discovery — KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 4
// ---------------------------------------------------------------------------

const LATER = new Date("2026-07-29T12:00:01.000Z");
const EARLIER = new Date("2026-07-29T11:59:59.000Z");

describe("emergency post-approval lapse: escalates, never reverses, never re-deadlines", () => {
  it("proposes an escalation for a PENDING obligation that is past due", () => {
    const requests = discoverLapsedEmergencyPostApprovals([emergencyCandidate()], LATER, "worker");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.jobKind).toBe(DEVICE_CREDENTIAL_RECOVERY_DISPOSITION_JOB_KIND);
    expect(requests[0]?.payload.recoveryDisposition).toBe("MANUAL_SECURITY_REVIEW");
    expect(requests[0]?.payload.escalationTrigger).toBe("EMERGENCY_POST_APPROVAL_LAPSED");
    expect(requests[0]?.payload.basis).toBe("EMERGENCY_POST_APPROVAL_LAPSE");
  });

  it("proposes nothing before the deadline", () => {
    expect(
      discoverLapsedEmergencyPostApprovals([emergencyCandidate()], EARLIER, "worker"),
    ).toHaveLength(0);
  });

  it("proposes nothing for an obligation somebody already answered", () => {
    for (const decision of ["APPROVED", "REFUSED", "LAPSED"]) {
      expect(
        discoverLapsedEmergencyPostApprovals(
          [emergencyCandidate({ postApprovalDecision: decision })],
          LATER,
          "worker",
        ),
      ).toHaveLength(0);
    }
  });

  it("puts NO deadline, and nothing deadline-shaped, in the proposed payload", () => {
    const [request] = discoverLapsedEmergencyPostApprovals([emergencyCandidate()], LATER, "worker");
    const payload = request?.payload ?? {};

    // Ruling 4: the deadline may be shortened but never extended, reset or
    // renewed. There is nothing here a downstream handler could write back as a
    // new post_approval_due_at, because the field does not exist.
    expect(Object.keys(payload)).toEqual([
      "basis",
      "revocationRecordId",
      "deviceRecordId",
      "purpose",
      "reasonCode",
      "recoveryDisposition",
      "escalationTrigger",
      "incidentReference",
    ]);
    for (const key of Object.keys(payload)) {
      expect(key).not.toMatch(/due|deadline|expir|extend|renew|reset|window/i);
    }
    expect(Object.values(payload).some((value) => value instanceof Date)).toBe(false);
    expect(JSON.stringify(payload)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("proposes nothing that would reverse a revocation", () => {
    const [request] = discoverLapsedEmergencyPostApprovals([emergencyCandidate()], LATER, "worker");
    // Ruling 3: every revocation is irreversible; recovery is governed
    // replacement issuance only. An escalation that carried an un-revoke would
    // be a scheduled reversal wearing an incident label.
    expect(JSON.stringify(request?.payload)).not.toMatch(
      /unrevoke|un_revoke|restore|reinstate|revert|reverse|reactivate|rollback/i,
    );
    expect(request?.jobKind).not.toBe(DEVICE_CREDENTIAL_REVOCATION_EXECUTE_JOB_KIND);
  });

  it("escalates ONCE however the deadline moves forward", () => {
    // Ruling 4 permits shortening. A shortened deadline must escalate earlier,
    // not open a second obligation for the same emergency.
    const shortened = emergencyCandidate({
      postApprovalDueAt: new Date("2026-07-29T11:00:00.000Z"),
    });
    const original = discoverLapsedEmergencyPostApprovals([emergencyCandidate()], LATER, "worker");
    const brought = discoverLapsedEmergencyPostApprovals([shortened], LATER, "worker");
    expect(brought[0]?.dedupeKey).toBe(original[0]?.dedupeKey);
  });

  it("is pure: same input, same answer, and the input is untouched", () => {
    const candidates = [emergencyCandidate()];
    const before = structuredClone(candidates);
    const first = discoverLapsedEmergencyPostApprovals(candidates, LATER, "worker");
    const second = discoverLapsedEmergencyPostApprovals(candidates, LATER, "worker");
    expect(first).toEqual(second);
    expect(candidates).toEqual(before);
  });

  it("does not complete when the escalation reaches its handler", async () => {
    const [request] = discoverLapsedEmergencyPostApprovals([emergencyCandidate()], LATER, "worker");
    const result = await credentialRecoveryDispositionHandler().handle(
      durableJob(request?.payload ?? {}),
    );
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_MANUAL_REVIEW,
    });
  });
});

// ---------------------------------------------------------------------------
// Recovery disposition handler
// ---------------------------------------------------------------------------

function recoveryPayload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    basis: "REVOCATION",
    revocationRecordId: "rev-1",
    deviceRecordId: DEVICE_ID,
    purpose: "device_identity",
    reasonCode: "ADMINISTRATIVE_REPLACEMENT",
    recoveryDisposition: null,
    escalationTrigger: null,
    incidentReference: null,
    ...over,
  };
}

describe("recovery disposition: what a revocation leaves owed", () => {
  it("defaults from the REASON for every reason the enum carries", async () => {
    for (const reason of CREDENTIAL_REVOCATION_REASONS) {
      const result = await credentialRecoveryDispositionHandler().handle(
        durableJob(recoveryPayload({ reasonCode: reason })),
      );
      const expected = recoveryDispositionFor(reason);
      expect(result.evidence.observedBusinessState).toBe(
        `reason=${reason} disposition=${expected}`,
      );
      expect(result.disposition.kind).toBe(
        expected === "MANUAL_SECURITY_REVIEW" ? "failed" : "completed",
      );
    }
  });

  it("refuses NO_RECOVERY for every reason that says a key may be out of custody", async () => {
    for (const reason of COMPROMISE_REASONS) {
      const result = await credentialRecoveryDispositionHandler().handle(
        durableJob(recoveryPayload({ reasonCode: reason, recoveryDisposition: "NO_RECOVERY" })),
      );
      expect(result.disposition).toEqual({
        kind: "failed",
        failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_DOWNGRADED,
      });
    }
  });

  it("accepts an override UPWARD, and lands the escalated case with a person", async () => {
    const result = await credentialRecoveryDispositionHandler().handle(
      durableJob(
        recoveryPayload({
          reasonCode: "ADMINISTRATIVE_REPLACEMENT",
          recoveryDisposition: "MANUAL_SECURITY_REVIEW",
        }),
      ),
    );
    expect(result.disposition.kind).toBe("failed");
    expect(result.evidence.failureCode).toBe(
      DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_MANUAL_REVIEW,
    );
  });

  it("refuses a revocation reason it does not know rather than guessing one", async () => {
    const result = await credentialRecoveryDispositionHandler().handle(
      durableJob(recoveryPayload({ reasonCode: "SEEMED_SENSIBLE" })),
    );
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.RECOVERY_UNKNOWN_REASON,
    });
  });

  it("refuses a job that names a different device from its subject", async () => {
    const result = await credentialRecoveryDispositionHandler().handle(
      durableJob(recoveryPayload({ deviceRecordId: OTHER_DEVICE_ID })),
    );
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.SCOPE_MISMATCH,
    });
  });

  it("refuses an incomplete payload instead of throwing", async () => {
    const result = await credentialRecoveryDispositionHandler().handle(
      durableJob({ deviceRecordId: DEVICE_ID }),
    );
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE,
    });
  });
});

// ---------------------------------------------------------------------------
// Reconciliation handler
// ---------------------------------------------------------------------------

function reconcileHandlerFor(status: string | null, throws = false) {
  const reads: unknown[] = [];
  const handler = providerKeyDestructionReconcileHandler({
    reader: {
      readDestructionRequestStatus: (input) => {
        reads.push(input);
        return throws ? Promise.reject(new Error("unreachable")) : Promise.resolve(status);
      },
    },
  });
  return { handler, reads };
}

const RECONCILE_PAYLOAD = {
  destructionRequestId: DESTRUCTION_REQUEST_ID,
  deviceRecordId: DEVICE_ID,
  providerKeyReference: "ref-approved",
};

describe("reconciliation: one read, and no way to act", () => {
  it("closes the question only when the database holds the evidence", async () => {
    const { handler, reads } = reconcileHandlerFor("executed");
    const result = await handler.handle(durableJob(RECONCILE_PAYLOAD));
    expect(result.disposition).toEqual({
      kind: "completed",
      resultCode: "JOB_RESULT_REPLAYED",
    });
    expect(reads).toHaveLength(1);
  });

  it("leaves every other governed status with a person", async () => {
    for (const status of KEY_DESTRUCTION_REQUEST_STATUSES.filter((s) => s !== "executed")) {
      const { handler } = reconcileHandlerFor(status);
      const result = await handler.handle(durableJob(RECONCILE_PAYLOAD));
      expect(result.disposition).toEqual({
        kind: "failed",
        failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED,
      });
    }
  });

  it("does not close a request that merely ended", async () => {
    // `cancelled` and `expired` say the REQUEST ended. They say nothing about
    // whether the provider erased the key before it did.
    for (const status of ["cancelled", "expired"] satisfies KeyDestructionRequestStatus[]) {
      const { handler } = reconcileHandlerFor(status);
      const result = await handler.handle(durableJob(RECONCILE_PAYLOAD));
      expect(result.disposition.kind).toBe("failed");
    }
  });

  it("refuses a status it has never heard of", async () => {
    const { handler } = reconcileHandlerFor("mostly_executed");
    const result = await handler.handle(durableJob(RECONCILE_PAYLOAD));
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_UNKNOWN_REQUEST_STATE,
    });
  });

  it("does not close the item when the read found nothing", async () => {
    const { handler } = reconcileHandlerFor(null);
    const result = await handler.handle(durableJob(RECONCILE_PAYLOAD));
    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_REQUEST_NOT_FOUND,
    });
  });

  it("does not close the item when the read itself failed", async () => {
    const { handler } = reconcileHandlerFor("executed", true);
    const result = await handler.handle(durableJob(RECONCILE_PAYLOAD));
    expect(result.disposition.kind).toBe("failed");
  });
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

describe("scope: a job may only act on its own subject", () => {
  it("refuses a revocation naming another device, before the gateway", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    const result = await handler.handle(
      durableJob(revocationPayload({ deviceRecordId: OTHER_DEVICE_ID })),
    );

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.SCOPE_MISMATCH,
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it("refuses a destruction naming another device, before the provider", async () => {
    const log: DestructionStep[] = [];
    const calls = { n: 0 };
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway({ begin: { outcome: "EXECUTION_CLEARED" } }, log),
      provider: destroyer({}, calls),
      identity: WORKER,
    });

    const result = await handler.handle(
      durableJob(destructionPayload({ deviceRecordId: OTHER_DEVICE_ID })),
    );

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.SCOPE_MISMATCH,
    });
    expect(log).toHaveLength(0);
    expect(calls.n).toBe(0);
  });

  it("refuses a trust environment this package does not recognise", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    const result = await handler.handle(
      durableJob(revocationPayload(), { environment: "staging" }),
    );

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.ENVIRONMENT_UNRECOGNISED,
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it("refuses an incomplete revocation payload instead of throwing", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });

    const result = await handler.handle(
      durableJob(revocationPayload({ reason: "", credentialGeneration: "three" })),
    );

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE,
    });
    expect(gateway.calls).toHaveLength(0);
  });

  it("refuses an incomplete destruction payload instead of throwing", async () => {
    const log: DestructionStep[] = [];
    const calls = { n: 0 };
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway({}, log),
      provider: destroyer({}, calls),
      identity: WORKER,
    });

    const result = await handler.handle(
      durableJob(destructionPayload({ publicKeyFingerprint: null })),
    );

    expect(result.disposition).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.PAYLOAD_INCOMPLETE,
    });
    expect(log).toHaveLength(0);
    expect(calls.n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

describe("evidence says what was called, so a reader a year later can tell", () => {
  it("records `none` on every refusal that happened before a governed call", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });
    for (const payload of [
      revocationPayload({ approvalRequestId: null }),
      revocationPayload({ approvedBy: null }),
      revocationPayload({ deviceRecordId: OTHER_DEVICE_ID }),
    ]) {
      const result = await handler.handle(durableJob(payload));
      expect(result.evidence.calledOperation).toBe("none");
      expect(result.evidence.failureCode).not.toBeNull();
    }
    expect(gateway.calls).toHaveLength(0);
  });

  it("names the governed operation when one was actually made", async () => {
    const gateway = revocationGateway();
    const handler = credentialRevocationExecuteHandler({ gateway, identity: WORKER });
    const result = await handler.handle(durableJob(revocationPayload()));
    expect(result.evidence.calledOperation).toBe("revokeDeviceCredential");
    expect(result.evidence.failureCode).toBeNull();
    expect(result.evidence.correlationId).toBe(`rev-${REVOCATION_REQUEST_ID}`);
  });

  it("carries the destruction outcome and attempt number without a provider payload", async () => {
    const handler = providerKeyDestructionExecuteHandler({
      gateway: destructionGateway(
        {
          begin: { outcome: "EXECUTION_CLEARED", attempt_number: 2 },
          confirm: { outcome: "DESTROYED" },
        },
        [],
      ),
      provider: destroyer({ receipt: receipt() }, { n: 0 }),
      identity: WORKER,
    });
    const result = await handler.handle(durableJob(destructionPayload()));
    expect(result.evidence.observedBusinessState).toBe("outcome=DESTROYED attempt=2");
    expect(result.evidence.calledOperation).toBe("executeProviderKeyDestruction");
    expect(result.evidence.correlationId).toBe(DESTRUCTION_REQUEST_ID);
  });

  it("keeps a destruction outcome's shape intact for the routing table", () => {
    // Guards against the routing tables being fed something other than the
    // service's own outcome object.
    const outcome: KeyDestructionOutcome = {
      outcome: "RECONCILIATION_REQUIRED",
      refusalCode: "DESTRUCTION_PROVIDER_AMBIGUOUS",
      errorClassification: "TIMEOUT",
    };
    expect(routeKeyDestructionOutcome(outcome)).toEqual({
      kind: "failed",
      failureCode: DEVICE_REVOCATION_JOB_FAILURE_CODES.DESTRUCTION_RECONCILIATION_REQUIRED,
    });
  });

  it("routes a reason-driven disposition for every reason without a hole", () => {
    for (const reason of CREDENTIAL_REVOCATION_REASONS) {
      const routing = routeRecoveryDisposition(recoveryDispositionFor(reason));
      expect(["completed", "failed"]).toContain(routing.kind);
    }
  });
});
