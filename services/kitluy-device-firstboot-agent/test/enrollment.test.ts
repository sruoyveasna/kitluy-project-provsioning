/**
 * Cloud enrollment agent — the first vertical slice, and its refusals.
 *
 * Covers the OS/agent test requirements: enrollment retry, offline/reconnect,
 * invalid server identity, revoked identity, assignment polling and
 * configuration version behaviour.
 */
import { describe, expect, it } from "vitest";

import {
  acceptsConfigurationVersion,
  isTerminalState,
  runEnrollmentStep,
  type AssignmentPollResult,
  type DeviceLifecycleState,
  type EnrollmentAgentDeps,
  type EnrollmentClient,
  type EnrollmentResult,
  type FleetPosition,
  type HeartbeatResult,
  type ServerIdentityVerifier,
} from "../src/enrollment.js";

const IDENTITY = {
  publicKeyPem: "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
  hardwareSignals: { macAddress: "b8:27:eb:00:00:01", boardSerial: "board-0001" },
};

const TRUSTED: ServerIdentityVerifier = {
  async verify() {
    return { trusted: true };
  },
};

function client(overrides: Partial<EnrollmentClient> = {}): EnrollmentClient {
  return {
    async enroll(): Promise<EnrollmentResult> {
      return { kind: "enrolled", deviceRecordId: "dev-0001" };
    },
    async heartbeat(): Promise<HeartbeatResult> {
      return { kind: "accepted" };
    },
    async pollAssignment(): Promise<AssignmentPollResult> {
      return { kind: "unassigned" };
    },
    ...overrides,
  };
}

function deps(overrides: Partial<EnrollmentAgentDeps> = {}): EnrollmentAgentDeps {
  return {
    client: client(),
    serverIdentity: TRUSTED,
    deviceClass: "terminal",
    osImageVersion: "kitluy-os-0.1.0",
    releaseChannel: "internal",
    ...overrides,
  };
}

const FRESH: FleetPosition = { lifecycleState: "manufactured" };

describe("enrollment: the first vertical slice", () => {
  it("a factory-fresh device enrolls and becomes 'enrolled' with no assignment", async () => {
    const outcome = await runEnrollmentStep(deps(), IDENTITY, FRESH);

    expect(outcome.kind).toBe("enrolled");
    if (outcome.kind !== "enrolled") return;
    expect(outcome.position.lifecycleState).toBe("enrolled");
    expect(outcome.position.deviceRecordId).toBe("dev-0001");
    // ENROLLED_UNASSIGNED is 'enrolled' with no assignment — not a new state.
    expect(outcome.position.assignmentId).toBeUndefined();
    expect(outcome.position.terminalProfileKey).toBeUndefined();
  });

  it("an enrolled unassigned device heartbeats and stays unassigned", async () => {
    const enrolled: FleetPosition = { lifecycleState: "enrolled", deviceRecordId: "dev-0001" };
    const outcome = await runEnrollmentStep(deps(), IDENTITY, enrolled);

    expect(outcome.kind).toBe("heartbeat");
    if (outcome.kind !== "heartbeat") return;
    expect(outcome.position.assignmentId).toBeUndefined();
  });

  it("an unassigned device never receives Store scope from enrollment or heartbeat", async () => {
    const enrolled: FleetPosition = { lifecycleState: "enrolled", deviceRecordId: "dev-0001" };
    const outcome = await runEnrollmentStep(deps(), IDENTITY, enrolled);

    const serialised = JSON.stringify(outcome);
    expect(serialised).not.toContain("tenant");
    expect(serialised).not.toContain("digitalStore");
    expect(serialised).not.toContain("location");
  });

  it("sends the device class and hardware evidence, never a derived identity", async () => {
    let captured: unknown;
    const outcome = await runEnrollmentStep(
      deps({
        client: client({
          async enroll(input) {
            captured = input;
            return { kind: "enrolled", deviceRecordId: "dev-0001" };
          },
        }),
        deviceClass: "store_hub",
      }),
      IDENTITY,
      FRESH,
    );

    expect(outcome.kind).toBe("enrolled");
    expect(captured).toMatchObject({
      deviceClass: "store_hub",
      publicKeyPem: IDENTITY.publicKeyPem,
      hardwareSignals: { macAddress: "b8:27:eb:00:00:01" },
    });
  });
});

describe("enrollment: refusals and retries", () => {
  it("retries a retryable enrollment refusal without changing state", async () => {
    const outcome = await runEnrollmentStep(
      deps({
        client: client({
          async enroll() {
            return { kind: "refused", code: "KLUY-NETWORK-UNAVAILABLE", retryable: true };
          },
        }),
      }),
      IDENTITY,
      FRESH,
    );

    expect(outcome.kind).toBe("retry");
    if (outcome.kind !== "retry") return;
    expect(outcome.code).toBe("KLUY-NETWORK-UNAVAILABLE");
    expect(outcome.position.lifecycleState).toBe("manufactured");
    expect(outcome.position.deviceRecordId).toBeUndefined();
  });

  it("halts on a non-retryable enrollment refusal instead of looping", async () => {
    const outcome = await runEnrollmentStep(
      deps({
        client: client({
          async enroll() {
            return { kind: "refused", code: "KLUY-DEVICE-NOT-ENROLLED", retryable: false };
          },
        }),
      }),
      IDENTITY,
      FRESH,
    );

    expect(outcome.kind).toBe("halted");
  });

  it("reconnects after an offline period and completes enrollment", async () => {
    let attempt = 0;
    const flaky = client({
      async enroll() {
        attempt += 1;
        return attempt < 3
          ? { kind: "refused", code: "KLUY-NETWORK-UNAVAILABLE", retryable: true }
          : { kind: "enrolled", deviceRecordId: "dev-0001" };
      },
    });

    let position: FleetPosition = FRESH;
    let last = await runEnrollmentStep(deps({ client: flaky }), IDENTITY, position);
    expect(last.kind).toBe("retry");

    last = await runEnrollmentStep(deps({ client: flaky }), IDENTITY, position);
    expect(last.kind).toBe("retry");

    last = await runEnrollmentStep(deps({ client: flaky }), IDENTITY, position);
    expect(last.kind).toBe("enrolled");
    if (last.kind !== "enrolled") return;
    position = last.position;
    expect(position.deviceRecordId).toBe("dev-0001");
  });

  it("refuses to transmit anything when server identity is not verified", async () => {
    let enrollCalled = false;
    const outcome = await runEnrollmentStep(
      deps({
        serverIdentity: {
          async verify() {
            return { trusted: false, reason: "certificate pin mismatch" };
          },
        },
        client: client({
          async enroll() {
            enrollCalled = true;
            return { kind: "enrolled", deviceRecordId: "dev-0001" };
          },
        }),
      }),
      IDENTITY,
      FRESH,
    );

    expect(outcome.kind).toBe("server_untrusted");
    if (outcome.kind !== "server_untrusted") return;
    expect(outcome.reason).toContain("certificate pin mismatch");
    // The point of the check: nothing was sent.
    expect(enrollCalled).toBe(false);
  });

  it("re-verifies server identity on every step, not once per boot", async () => {
    let calls = 0;
    const verifier: ServerIdentityVerifier = {
      async verify() {
        calls += 1;
        return { trusted: true };
      },
    };
    const enrolled: FleetPosition = { lifecycleState: "enrolled", deviceRecordId: "dev-0001" };

    await runEnrollmentStep(deps({ serverIdentity: verifier }), IDENTITY, enrolled);
    await runEnrollmentStep(deps({ serverIdentity: verifier }), IDENTITY, enrolled);

    expect(calls).toBe(2);
  });

  const revokedStates: readonly DeviceLifecycleState[] = [
    "retired",
    "replaced",
    "quarantined",
    "restricted_investigation",
    "suspended",
  ];

  for (const state of revokedStates) {
    it(`halts and sends nothing when the device is '${state}'`, async () => {
      let touched = false;
      const outcome = await runEnrollmentStep(
        deps({
          client: client({
            async heartbeat() {
              touched = true;
              return { kind: "accepted" };
            },
            async enroll() {
              touched = true;
              return { kind: "enrolled", deviceRecordId: "dev-0001" };
            },
          }),
        }),
        IDENTITY,
        { lifecycleState: state, deviceRecordId: "dev-0001" },
      );

      expect(outcome.kind).toBe("halted");
      expect(touched).toBe(false);
      expect(isTerminalState(state)).toBe(true);
    });
  }

  it("halts when heartbeat is refused non-retryably (revoked mid-session)", async () => {
    const outcome = await runEnrollmentStep(
      deps({
        client: client({
          async heartbeat() {
            return { kind: "refused", code: "KLUY-DEVICE-REVOKED", retryable: false };
          },
        }),
      }),
      IDENTITY,
      { lifecycleState: "enrolled", deviceRecordId: "dev-0001" },
    );

    expect(outcome.kind).toBe("halted");
    if (outcome.kind !== "halted") return;
    expect(outcome.reason).toContain("KLUY-DEVICE-REVOKED");
  });
});

describe("assignment polling", () => {
  it("moves to awaiting_trust — never straight to active — when assigned", async () => {
    const outcome = await runEnrollmentStep(
      deps({
        client: client({
          async pollAssignment() {
            return {
              kind: "assigned",
              assignmentId: "asg-0001",
              terminalProfileKey: "laundry.t1.intake_cashier",
              configurationVersion: 1,
            };
          },
        }),
      }),
      IDENTITY,
      { lifecycleState: "enrolled", deviceRecordId: "dev-0001" },
    );

    expect(outcome.kind).toBe("assigned");
    if (outcome.kind !== "assigned") return;
    // enrolled -> active was REMOVED from the transition matrix (group 0121).
    expect(outcome.position.lifecycleState).toBe("awaiting_trust");
    expect(outcome.position.lifecycleState).not.toBe("active");
    expect(outcome.position.terminalProfileKey).toBe("laundry.t1.intake_cashier");
  });

  it("takes the terminal profile from the server and never chooses one", async () => {
    const outcome = await runEnrollmentStep(
      deps({
        client: client({
          async pollAssignment() {
            return {
              kind: "assigned",
              assignmentId: "asg-0002",
              terminalProfileKey: "laundry.t3.ready_scan_in",
              configurationVersion: 7,
            };
          },
        }),
      }),
      IDENTITY,
      { lifecycleState: "enrolled", deviceRecordId: "dev-0001" },
    );

    if (outcome.kind !== "assigned") throw new Error("expected assignment");
    expect(outcome.position.terminalProfileKey).toBe("laundry.t3.ready_scan_in");
    expect(outcome.position.configurationVersion).toBe(7);
  });

  it("does not re-poll once assigned", async () => {
    let polled = false;
    const outcome = await runEnrollmentStep(
      deps({
        client: client({
          async pollAssignment() {
            polled = true;
            return { kind: "unassigned" };
          },
        }),
      }),
      IDENTITY,
      { lifecycleState: "awaiting_trust", deviceRecordId: "dev-0001", assignmentId: "asg-0001" },
    );

    expect(outcome.kind).toBe("heartbeat");
    expect(polled).toBe(false);
  });
});

describe("configuration version behaviour", () => {
  it("accepts the first version", () => {
    expect(acceptsConfigurationVersion(undefined, 1)).toBe(true);
  });

  it("accepts a newer version", () => {
    expect(acceptsConfigurationVersion(4, 5)).toBe(true);
  });

  it("refuses the same version (no-op, not a re-apply)", () => {
    expect(acceptsConfigurationVersion(5, 5)).toBe(false);
  });

  it("refuses an older version — a replayed delivery must not downgrade a device", () => {
    expect(acceptsConfigurationVersion(5, 4)).toBe(false);
    expect(acceptsConfigurationVersion(5, 0)).toBe(false);
  });

  it("refuses malformed versions", () => {
    expect(acceptsConfigurationVersion(1, -1)).toBe(false);
    expect(acceptsConfigurationVersion(1, 1.5)).toBe(false);
    expect(acceptsConfigurationVersion(undefined, Number.NaN)).toBe(false);
  });
});
