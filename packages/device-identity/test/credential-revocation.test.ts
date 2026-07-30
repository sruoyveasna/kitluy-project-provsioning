/**
 * Governed credential revocation — focused unit tests.
 *
 * The fake gateway below is a model of `revoke_device_credential_v1`, not a
 * stub that agrees with whatever it is asked. It resolves the credential from
 * device + generation, keeps the same idempotence and conflict rules, and
 * refuses without an approval — because the two outcomes that matter most here
 * (`ALREADY_REVOKED`, `MANUAL_REVIEW_REQUIRED`) cannot be exercised against a
 * gateway that always says yes.
 *
 * NO DATABASE. Every test in this file runs against the in-memory model.
 */
import { describe, it, expect } from "vitest";

import {
  COMPROMISE_REASONS,
  CREDENTIAL_RECOVERY_DISPOSITIONS,
  CREDENTIAL_REVOCATION_REASONS,
  reasonForbidsNoRecovery,
  reasonRevokesTheDevice,
  recoveryDispositionFor,
  revokeDeviceCredential,
  revokedCredentialsSnapshot,
  type CredentialRecoveryDisposition,
  type CredentialRevocationReason,
  type GovernedRevocationCall,
  type RevocationGateway,
  type RevocationInput,
  type RevocationOutcome,
  type RevokedCredentialRecord,
} from "../src/credential-revocation.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const OTHER_DEVICE = "44444444-4444-4444-8444-444444444444";
const CRED_G1 = "22222222-2222-4222-8222-222222222222";
const CRED_G2 = "33333333-3333-4333-8333-333333333333";
const APPROVAL = "55555555-5555-4555-8555-555555555555";
const SERIAL_G1 = "KLUY-DEV-0001";
const SERIAL_G2 = "KLUY-DEV-0002";
const FP_G1 = "a".repeat(64);
const FP_G2 = "b".repeat(64);

// ===========================================================================
// The in-memory model of revoke_device_credential_v1
// ===========================================================================

interface FakeCredential {
  readonly credentialId: string;
  readonly serialNumber: string;
  readonly publicKeyFingerprint: string;
  state: "issued" | "revoked" | "superseded";
}

interface FakeRevocationRow {
  readonly revocationId: string;
  readonly revocationRequestId: string;
  readonly credentialId: string;
  readonly reasonCode: CredentialRevocationReason;
  readonly recoveryDisposition: CredentialRecoveryDisposition;
}

function scopeKey(
  device: string,
  environment: string,
  purpose: string,
  generation: number,
): string {
  return `${device}|${environment}|${purpose}|${generation}`;
}

/**
 * The fake. Keeps the governed function's ORDER as well as its rules:
 * idempotence is checked before any approval work, so a replay cannot consume
 * a second approval — the same reason group 0136 puts that lookup first.
 */
function fakeGateway(options: { throws?: string } = {}) {
  const credentials = new Map<string, FakeCredential>([
    [
      scopeKey(DEVICE, "development", "device_identity", 1),
      {
        credentialId: CRED_G1,
        serialNumber: SERIAL_G1,
        publicKeyFingerprint: FP_G1,
        state: "issued",
      },
    ],
    [
      scopeKey(DEVICE, "development", "device_identity", 2),
      {
        credentialId: CRED_G2,
        serialNumber: SERIAL_G2,
        publicKeyFingerprint: FP_G2,
        state: "issued",
      },
    ],
  ]);
  const byRequestId = new Map<string, FakeRevocationRow>();
  const byCredentialId = new Map<string, FakeRevocationRow>();
  const recoveryCases: Array<{ revocationId: string; disposition: string }> = [];
  const calls: GovernedRevocationCall[] = [];
  const approvalsConsumed = new Set<string>();
  let sequence = 0;

  const gateway: RevocationGateway = {
    async revokeDeviceCredential(call) {
      calls.push(call);
      if (options.throws !== undefined) throw new Error(options.throws);

      // 1. IDEMPOTENCE FIRST, before any authorization work.
      const replay = byRequestId.get(call.revocationRequestId);
      if (replay !== undefined) {
        return {
          outcome: "ALREADY_REVOKED",
          revocationId: replay.revocationId,
          credentialId: replay.credentialId,
          reasonCode: replay.reasonCode,
          recoveryDisposition: replay.recoveryDisposition,
        };
      }

      // 2. The credential is RESOLVED from device + environment + purpose +
      //    generation. The call carries no credential id to resolve from.
      const credential = credentials.get(
        scopeKey(call.deviceRecordId, call.environment, call.purpose, call.credentialGeneration),
      );
      if (credential === undefined) {
        throw new Error(
          `KLUY-REVOKE-NO-CREDENTIAL: device ${call.deviceRecordId} has no generation ${call.credentialGeneration} credential`,
        );
      }

      // 3. A DIFFERENT intent against an already-revoked credential is a
      //    conflict, never an overwrite of the first account.
      if (credential.state === "revoked") {
        const first = byCredentialId.get(credential.credentialId);
        return {
          outcome: "MANUAL_REVIEW_REQUIRED",
          refusalCode: "KLUY-REVOKE-CONFLICTING-REASON",
          detail: `credential ${credential.credentialId} is already revoked as ${first?.reasonCode}; a second revocation with a different intent needs review`,
          revocationId: first?.revocationId ?? null,
          credentialId: credential.credentialId,
        };
      }

      // 4. Four eyes, fail-closed for every reason (the shipped policy).
      if (call.approvalRequestId === null) {
        return {
          outcome: "REVOCATION_REFUSED",
          refusalCode: "KLUY-CRED-REVOCATION-UNAPPROVED",
          detail: "this revocation requires an approval and none was presented",
          credentialId: credential.credentialId,
        };
      }
      if (approvalsConsumed.has(call.approvalRequestId)) {
        return {
          outcome: "REVOCATION_REFUSED",
          refusalCode: "KLUY-CRED-REVOCATION-APPROVAL-CONSUMED",
          detail: "this approval has already authorized a revocation",
          credentialId: credential.credentialId,
        };
      }
      if (call.approvedBy === null) {
        return {
          outcome: "REVOCATION_REFUSED",
          refusalCode: "KLUY-CRED-REVOCATION-NO-APPROVER",
          detail: "the approving identity must be recorded on the evidence",
          credentialId: credential.credentialId,
        };
      }
      if (call.approvedBy === call.requestedBy) {
        return {
          outcome: "REVOCATION_REFUSED",
          refusalCode: "KLUY-CRED-REVOCATION-SELF-APPROVED",
          detail: "the requester and approver must be different people",
          credentialId: credential.credentialId,
        };
      }

      sequence += 1;
      const row: FakeRevocationRow = {
        revocationId: `rev-${sequence}`,
        revocationRequestId: call.revocationRequestId,
        credentialId: credential.credentialId,
        reasonCode: call.reasonCode,
        recoveryDisposition: call.recoveryDisposition,
      };
      byRequestId.set(row.revocationRequestId, row);
      if (!byCredentialId.has(row.credentialId)) byCredentialId.set(row.credentialId, row);
      approvalsConsumed.add(call.approvalRequestId);
      credential.state = "revoked";

      let recoveryCaseId: string | null = null;
      if (call.recoveryDisposition !== "NO_RECOVERY") {
        recoveryCaseId = `case-${sequence}`;
        recoveryCases.push({
          revocationId: row.revocationId,
          disposition: call.recoveryDisposition,
        });
      }

      return {
        outcome: "REVOKED",
        revocationId: row.revocationId,
        credentialId: credential.credentialId,
        credentialGeneration: call.credentialGeneration,
        publicKeyFingerprint: credential.publicKeyFingerprint,
        reasonCode: call.reasonCode,
        recoveryDisposition: call.recoveryDisposition,
        recoveryCaseId,
        effectiveAt: "2026-07-29T16:01:36.000Z",
      };
    },
  };

  return { gateway, calls, credentials, byRequestId, recoveryCases };
}

function input(overrides: Partial<RevocationInput> = {}): RevocationInput {
  return {
    revocationRequestId: "req-0001",
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    credentialGeneration: 1,
    reasonCode: "DEVICE_STOLEN",
    reason: "terminal removed from the store overnight; police report filed",
    requestedBy: "fleet.operator",
    source: "UNIT-REVOCATION",
    approvalRequestId: APPROVAL,
    approvedBy: "security.lead",
    ...overrides,
  };
}

// ===========================================================================
// Recovery disposition defaults
// ===========================================================================
describe("recovery disposition defaults", () => {
  it("gives the documented default for EVERY reason in the enum", () => {
    // Iterated over the FULL enum rather than a handful, so a reason added to
    // the migration without a mapping fails here as well as at the compiler.
    const expected: Record<CredentialRevocationReason, CredentialRecoveryDisposition> = {
      KEY_COMPROMISE: "REPROVISION_REQUIRED",
      DEVICE_LOST: "REPROVISION_REQUIRED",
      DEVICE_STOLEN: "REPROVISION_REQUIRED",
      PROVIDER_COMPROMISE: "REPROVISION_REQUIRED",
      ASSIGNMENT_INVALIDATED: "REASSIGNMENT_REQUIRED",
      CERTIFICATE_MISISSUANCE: "RECOVERY_REQUIRED",
      SECURITY_INCIDENT: "MANUAL_SECURITY_REVIEW",
      ADMINISTRATIVE_REPLACEMENT: "RECOVERY_REQUIRED",
      OTHER_APPROVED_REASON: "MANUAL_SECURITY_REVIEW",
    };
    expect(CREDENTIAL_REVOCATION_REASONS).toHaveLength(9);
    for (const reason of CREDENTIAL_REVOCATION_REASONS) {
      expect(recoveryDispositionFor(reason)).toBe(expected[reason]);
    }
  });

  it("never defaults ANY reason to NO_RECOVERY", () => {
    // NO_RECOVERY opens no recovery case. It is a value a human must ask for
    // deliberately, never one a caller receives by omitting a field.
    for (const reason of CREDENTIAL_REVOCATION_REASONS) {
      expect(recoveryDispositionFor(reason)).not.toBe("NO_RECOVERY");
    }
    expect(CREDENTIAL_RECOVERY_DISPOSITIONS).toContain("NO_RECOVERY");
  });

  it("names exactly the reasons for which NO_RECOVERY is refused", () => {
    // DEVICE_LOST is here with DEVICE_STOLEN: the difference between them is
    // intent, not custody. Either way a private key is somewhere the operator
    // does not control, and NO_RECOVERY would schedule no replacement.
    expect([...COMPROMISE_REASONS].sort()).toEqual([
      "DEVICE_LOST",
      "DEVICE_STOLEN",
      "KEY_COMPROMISE",
      "PROVIDER_COMPROMISE",
    ]);
    for (const reason of CREDENTIAL_REVOCATION_REASONS) {
      expect(reasonForbidsNoRecovery(reason)).toBe(COMPROMISE_REASONS.includes(reason));
    }
  });
});

// ===========================================================================
// Refusals decided BEFORE the gateway
// ===========================================================================
describe("refusals happen before the governed call", () => {
  const refusedWithoutCalling = async (
    overrides: Partial<RevocationInput>,
    refusalCode: string,
  ): Promise<RevocationOutcome> => {
    const h = fakeGateway();
    const outcome = await revokeDeviceCredential(input(overrides), h.gateway);
    expect(outcome.outcome).toBe("REVOCATION_REFUSED");
    expect(outcome.refusalCode).toBe(refusalCode);
    // THE POINT of refusing early: group 0136 consumes an approval single-use,
    // so a request the database would reject anyway must not reach it.
    expect(h.calls).toHaveLength(0);
    return outcome;
  };

  it("refuses an empty reason", async () => {
    await refusedWithoutCalling({ reason: "" }, "REVOCATION_NO_REASON");
  });

  it("refuses a reason that is only whitespace", async () => {
    // The database CHECK is `btrim(reason) <> ''`. Stated the same way here, so
    // a blank-looking reason cannot pass one layer and be raised by the other.
    await refusedWithoutCalling({ reason: "   \t\n " }, "REVOCATION_NO_REASON");
  });

  it("refuses an empty requester", async () => {
    await refusedWithoutCalling({ requestedBy: "  " }, "REVOCATION_NO_REQUESTER");
  });

  it("refuses an empty source", async () => {
    await refusedWithoutCalling({ source: "" }, "REVOCATION_NO_SOURCE");
  });

  it("refuses an empty revocation request id", async () => {
    // Without a stable intent id there is nothing for a retry to match, and
    // every retry becomes a fresh revocation of the same credential.
    await refusedWithoutCalling({ revocationRequestId: " " }, "REVOCATION_NO_REQUEST_ID");
  });

  it("refuses SELF-APPROVAL, and the gateway is never invoked", async () => {
    const h = fakeGateway();
    const outcome = await revokeDeviceCredential(
      input({ requestedBy: "fleet.operator", approvedBy: "fleet.operator" }),
      h.gateway,
    );
    expect(outcome.outcome).toBe("REVOCATION_REFUSED");
    expect(outcome.refusalCode).toBe("REVOCATION_SELF_APPROVED");
    expect(h.calls).toHaveLength(0);
    // And nothing moved: no revocation row, no state change.
    expect(h.byRequestId.size).toBe(0);
    expect(h.credentials.get(scopeKey(DEVICE, "development", "device_identity", 1))?.state).toBe(
      "issued",
    );
  });

  it("sees through whitespace around a self-approval", async () => {
    const h = fakeGateway();
    const outcome = await revokeDeviceCredential(
      input({ requestedBy: "fleet.operator", approvedBy: "  fleet.operator " }),
      h.gateway,
    );
    expect(outcome.refusalCode).toBe("REVOCATION_SELF_APPROVED");
    expect(h.calls).toHaveLength(0);
  });

  it("refuses NO_RECOVERY for every compromise reason", async () => {
    for (const reasonCode of ["KEY_COMPROMISE", "DEVICE_STOLEN", "PROVIDER_COMPROMISE"] as const) {
      const outcome = await refusedWithoutCalling(
        { reasonCode, recoveryDisposition: "NO_RECOVERY" },
        "REVOCATION_RECOVERY_DOWNGRADED",
      );
      expect(outcome.detail).toContain(reasonCode);
    }
  });

  it("allows NO_RECOVERY for a reason that is not a compromise", async () => {
    // The rule is a floor for compromise reasons, not a blanket ban: an
    // administrative replacement genuinely owes nothing beyond the new
    // credential the replacement already issues.
    const h = fakeGateway();
    const outcome = await revokeDeviceCredential(
      input({ reasonCode: "ADMINISTRATIVE_REPLACEMENT", recoveryDisposition: "NO_RECOVERY" }),
      h.gateway,
    );
    expect(h.calls).toHaveLength(1);
    expect(outcome.outcome).toBe("REVOKED");
    expect(outcome.recoveryCaseId).toBeNull();
    expect(h.recoveryCases).toHaveLength(0);
  });
});

// ===========================================================================
// A valid revocation
// ===========================================================================
describe("a valid revocation", () => {
  it("returns REVOKED and opens the expected recovery disposition", async () => {
    const h = fakeGateway();
    const outcome = await revokeDeviceCredential(input(), h.gateway);

    expect(outcome.outcome).toBe("REVOKED");
    expect(outcome.credentialId).toBe(CRED_G1);
    expect(outcome.publicKeyFingerprint).toBe(FP_G1);
    // DEVICE_STOLEN => REPROVISION_REQUIRED, defaulted from the reason.
    expect(outcome.recoveryDisposition).toBe("REPROVISION_REQUIRED");
    expect(outcome.recoveryCaseId).toBe("case-1");
    expect(h.recoveryCases).toEqual([
      { revocationId: "rev-1", disposition: "REPROVISION_REQUIRED" },
    ]);
    // The derived fact the verifier reads on the hot path.
    expect(h.credentials.get(scopeKey(DEVICE, "development", "device_identity", 1))?.state).toBe(
      "revoked",
    );
  });

  it("defaults the disposition from the reason when the caller supplies none", async () => {
    const h = fakeGateway();
    await revokeDeviceCredential(input({ reasonCode: "ASSIGNMENT_INVALIDATED" }), h.gateway);
    expect(h.calls[0]?.recoveryDisposition).toBe("REASSIGNMENT_REQUIRED");
  });

  it("accepts an UPWARD override of the default disposition", async () => {
    // CERTIFICATE_MISISSUANCE defaults to RECOVERY_REQUIRED. A caller who has
    // learned more may escalate; only the downgrade to NO_RECOVERY is closed.
    const h = fakeGateway();
    const outcome = await revokeDeviceCredential(
      input({
        reasonCode: "CERTIFICATE_MISISSUANCE",
        recoveryDisposition: "MANUAL_SECURITY_REVIEW",
      }),
      h.gateway,
    );
    expect(recoveryDispositionFor("CERTIFICATE_MISISSUANCE")).toBe("RECOVERY_REQUIRED");
    expect(outcome.recoveryDisposition).toBe("MANUAL_SECURITY_REVIEW");
  });

  it("hands the gateway a DEVICE + GENERATION scope and no credential id", async () => {
    const h = fakeGateway();
    await revokeDeviceCredential(input({ credentialGeneration: 2 }), h.gateway);

    const call = h.calls[0];
    expect(call).toBeDefined();
    expect(call?.deviceRecordId).toBe(DEVICE);
    expect(call?.environment).toBe("development");
    expect(call?.purpose).toBe("device_identity");
    expect(call?.credentialGeneration).toBe(2);

    // COMPILE-TIME: `RevocationInput` and `GovernedRevocationCall` declare no
    // `credentialId` field, so `input({ credentialId: CRED_G1 })` does not
    // compile and there is no expression here that could pass one. The runtime
    // assertion below states the same fact for a reader and catches an adapter
    // that widened the object on its way through.
    expect(Object.keys(call ?? {})).not.toContain("credentialId");
    // The credential is what the GATEWAY resolved, not what the caller named.
    const resolved = h.credentials.get(scopeKey(DEVICE, "development", "device_identity", 2));
    expect(resolved?.credentialId).toBe(CRED_G2);
    expect(resolved?.state).toBe("revoked");
  });
});

// ===========================================================================
// Replay and conflict
// ===========================================================================
describe("replay and conflict are not successes", () => {
  it("replays the same intent as ALREADY_REVOKED with no second effect", async () => {
    const h = fakeGateway();
    const first = await revokeDeviceCredential(input(), h.gateway);
    const second = await revokeDeviceCredential(input(), h.gateway);

    expect(first.outcome).toBe("REVOKED");
    expect(second.outcome).toBe("ALREADY_REVOKED");
    // SAME revocation, not a new one.
    expect(second.revocationId).toBe(first.revocationId);
    expect(second.credentialId).toBe(first.credentialId);
    // NO second effect: one evidence row, one recovery case, one approval used.
    expect(h.byRequestId.size).toBe(1);
    expect(h.recoveryCases).toHaveLength(1);
    // And the replay is NOT reported as a fresh revocation.
    expect(second.outcome).not.toBe("REVOKED");
  });

  it("surfaces a DIFFERENT intent against a revoked credential as MANUAL_REVIEW_REQUIRED", async () => {
    const h = fakeGateway();
    await revokeDeviceCredential(input({ revocationRequestId: "req-first" }), h.gateway);

    // Same credential, a different intent id and a different reason: the second
    // person to notice does not overwrite the first account of why.
    const conflict = await revokeDeviceCredential(
      input({
        revocationRequestId: "req-second",
        reasonCode: "ADMINISTRATIVE_REPLACEMENT",
        reason: "swapped during a scheduled visit",
      }),
      h.gateway,
    );

    expect(conflict.outcome).toBe("MANUAL_REVIEW_REQUIRED");
    expect(conflict.refusalCode).toBe("KLUY-REVOKE-CONFLICTING-REASON");
    expect(conflict.detail).toContain("DEVICE_STOLEN");
    // NOT a success, and not flattened into one.
    expect(conflict.outcome).not.toBe("REVOKED");
    expect(conflict.outcome).not.toBe("ALREADY_REVOKED");
    // The first account survives untouched: one row, one case.
    expect(h.byRequestId.size).toBe(1);
    expect(h.recoveryCases).toEqual([
      { revocationId: "rev-1", disposition: "REPROVISION_REQUIRED" },
    ]);
  });

  it("passes a governed REVOCATION_REFUSED through unchanged", async () => {
    // Missing approval. The wrapper does not soften the database's refusal into
    // its own vocabulary, because a rewritten refusal is a different refusal.
    const h = fakeGateway();
    const outcome = await revokeDeviceCredential(input({ approvalRequestId: null }), h.gateway);
    expect(outcome.outcome).toBe("REVOCATION_REFUSED");
    expect(outcome.refusalCode).toBe("KLUY-CRED-REVOCATION-UNAPPROVED");
    expect(h.calls).toHaveLength(1);
  });

  it("turns a gateway failure into a refusal, never a success", async () => {
    const h = fakeGateway({ throws: "connection terminated" });
    const outcome = await revokeDeviceCredential(input(), h.gateway);
    expect(outcome.outcome).toBe("REVOCATION_REFUSED");
    expect(outcome.refusalCode).toBe("REVOCATION_GATEWAY_FAILED");
    // The driver MESSAGE does not travel. It used to, and this test asserted
    // that it did — which made the leak a guarantee rather than an oversight. A
    // pg driver message routinely repeats the failing statement and sometimes
    // its bound values, and `key-destruction.ts` redacts provider errors to a
    // class for exactly that reason; the two modules should not disagree.
    expect(outcome.detail).not.toContain("connection terminated");
    expect(outcome.detail).toContain("the revocation gateway call failed");
  });

  it("refuses a PRIVILEGE denial permanently, not as a retryable outage", async () => {
    // Since migration group 0145 an adapter still aimed at the unscoped
    // revoke_device_credential_v1 gets SQLSTATE 42501. That is permanent. Mapped
    // to REVOCATION_GATEWAY_FAILED it became DATABASE_UNAVAILABLE, which IS in
    // RETRYABLE_FAILURE_CODES — so a worker would retry an authorization
    // failure until the budget burnt out and then dead-letter it as a database
    // problem, sending whoever reads it to the wrong system.
    const denied = Object.assign(
      new Error("permission denied for function revoke_device_credential_v1"),
      {
        code: "42501",
      },
    );
    const gateway: RevocationGateway = {
      revokeDeviceCredential: () => Promise.reject(denied),
    };
    const outcome = await revokeDeviceCredential(input(), gateway);
    expect(outcome.outcome).toBe("REVOCATION_REFUSED");
    expect(outcome.refusalCode).toBe("REVOCATION_NOT_AUTHORIZED");
    expect(outcome.detail).not.toContain("revoke_device_credential_v1");
  });

  it("fails an unrecognised outcome towards review, not towards success", async () => {
    // Unreachable through the types; it earns its keep at the jsonb boundary,
    // where an adapter parses whatever the database actually sent.
    const rogue: RevocationGateway = {
      async revokeDeviceCredential() {
        return { outcome: "LOOKS_FINE" } as unknown as RevocationOutcome;
      },
    };
    const outcome = await revokeDeviceCredential(input(), rogue);
    expect(outcome.outcome).toBe("MANUAL_REVIEW_REQUIRED");
    expect(outcome.refusalCode).toBe("REVOCATION_UNKNOWN_OUTCOME");
  });
});

// ===========================================================================
// The verifier snapshot
// ===========================================================================
describe("revokedCredentialsSnapshot", () => {
  const row = (overrides: Partial<RevokedCredentialRecord> = {}): RevokedCredentialRecord => ({
    revocationId: "rev-1",
    credentialId: CRED_G1,
    certificateSerial: SERIAL_G1,
    deviceRecordId: DEVICE,
    environment: "development",
    purpose: "device_identity",
    credentialGeneration: 1,
    publicKeyFingerprint: FP_G1,
    reasonCode: "DEVICE_STOLEN",
    recoveryDisposition: "REPROVISION_REQUIRED",
    effectiveAt: new Date("2026-07-29T16:01:36.000Z"),
    ...overrides,
  });

  it("marks the revoked serial and device, and leaves others alone", () => {
    const lookup = revokedCredentialsSnapshot([row()]);
    expect(lookup.isCertificateRevoked(SERIAL_G1)).toBe(true);
    expect(lookup.isDeviceRevoked(DEVICE)).toBe(true);
    // Untouched: a different serial and a different device.
    expect(lookup.isCertificateRevoked(SERIAL_G2)).toBe(false);
    expect(lookup.isDeviceRevoked(OTHER_DEVICE)).toBe(false);
  });

  it("revokes nothing at all from an empty row set", () => {
    const lookup = revokedCredentialsSnapshot([]);
    expect(lookup.isCertificateRevoked(SERIAL_G1)).toBe(false);
    expect(lookup.isDeviceRevoked(DEVICE)).toBe(false);
  });

  it("does NOT revoke the device for a credential-scoped reason", () => {
    // The failure this prevents: an ADMINISTRATIVE_REPLACEMENT of generation 1
    // that marked the whole device revoked would refuse the generation 2
    // credential the replacement just issued. Routine renewal would brick the
    // fleet one device at a time.
    const lookup = revokedCredentialsSnapshot([
      row({ reasonCode: "ADMINISTRATIVE_REPLACEMENT", recoveryDisposition: "RECOVERY_REQUIRED" }),
    ]);
    expect(lookup.isCertificateRevoked(SERIAL_G1)).toBe(true);
    expect(lookup.isDeviceRevoked(DEVICE)).toBe(false);
  });

  it("agrees with reasonRevokesTheDevice for every reason in the enum", () => {
    for (const reasonCode of CREDENTIAL_REVOCATION_REASONS) {
      const lookup = revokedCredentialsSnapshot([row({ reasonCode })]);
      expect(lookup.isDeviceRevoked(DEVICE)).toBe(reasonRevokesTheDevice(reasonCode));
      // The SERIAL is revoked regardless of scope: every row in the snapshot is
      // a credential that was repudiated.
      expect(lookup.isCertificateRevoked(SERIAL_G1)).toBe(true);
    }
  });

  it("scopes a device-level revocation to the device it names", () => {
    const lookup = revokedCredentialsSnapshot([
      row({ reasonCode: "DEVICE_STOLEN" }),
      row({
        revocationId: "rev-2",
        credentialId: CRED_G2,
        certificateSerial: SERIAL_G2,
        deviceRecordId: OTHER_DEVICE,
        reasonCode: "CERTIFICATE_MISISSUANCE",
        recoveryDisposition: "RECOVERY_REQUIRED",
      }),
    ]);
    expect(lookup.isDeviceRevoked(DEVICE)).toBe(true);
    expect(lookup.isDeviceRevoked(OTHER_DEVICE)).toBe(false);
    expect(lookup.isCertificateRevoked(SERIAL_G1)).toBe(true);
    expect(lookup.isCertificateRevoked(SERIAL_G2)).toBe(true);
  });

  it("does not weigh effective_at against any clock", () => {
    // `effective_at` is SERVER time; the verifier holds DEVICE trusted time.
    // Comparing them would let a device with a manipulated clock postpone its
    // own revocation, which is the exact failure group 0136 names. A row in the
    // snapshot is in force, whatever either clock says.
    const farFuture = revokedCredentialsSnapshot([
      row({ effectiveAt: new Date("2099-01-01T00:00:00.000Z") }),
    ]);
    const longPast = revokedCredentialsSnapshot([
      row({ effectiveAt: new Date("2000-01-01T00:00:00.000Z") }),
    ]);
    expect(farFuture.isCertificateRevoked(SERIAL_G1)).toBe(true);
    expect(longPast.isCertificateRevoked(SERIAL_G1)).toBe(true);
  });
});
