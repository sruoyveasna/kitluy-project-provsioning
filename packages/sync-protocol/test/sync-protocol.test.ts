import { describe, expect, it } from "vitest";
import * as protocol from "../src/index.js";
import {
  CONFLICT_POLICIES,
  DELIVERY_STATES,
  EXTERNAL_SYNC_STATUSES,
  MAX_CLIENT_SEQUENCE,
  RECONCILIATION_STATES,
  allowsLastWriteWins,
  assertRegisteredEffectOrdinal,
  buildHubEffectKey,
  buildTerminalIdempotencyKey,
  isValidHubEffectKey,
  isValidTerminalIdempotencyKey,
  keyNamespace,
  missingSequences,
  projectExternalSyncStatus,
  validateBatchOrdering,
  type DeliveryState,
  type OutboxEvent,
  type ReconciliationState,
} from "../src/index.js";

const TERMINAL = "0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c1";
const COMMAND_RESULT = "0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c2";

function event(sequence: bigint, generation = 1): OutboxEvent {
  return {
    eventId: `ev-${generation}-${sequence}`,
    tenantId: "t-1",
    digitalStoreId: "ds-1",
    storeLocationId: "loc-1",
    hubId: "hub-1",
    terminalDeviceId: TERMINAL,
    aggregateType: "transaction",
    aggregateId: "tx-1",
    eventType: "example.recorded",
    aggregateVersion: 1,
    hubSequence: sequence,
    assignmentGeneration: generation,
    idempotencyKey: buildTerminalIdempotencyKey(TERMINAL, sequence),
    schemaVersion: 1,
    payloadSha256: "0".repeat(64),
    occurredAt: "2026-07-26T09:00:00+07:00",
  };
}

describe("conflict policy (Hub spec §11.4)", () => {
  it("never allows last-write-wins for financial, custody, inventory, config or audit-relevant classes", () => {
    expect(allowsLastWriteWins("finance_payment")).toBe(false);
    expect(allowsLastWriteWins("custody_pickup")).toBe(false);
    expect(allowsLastWriteWins("inventory_movement")).toBe(false);
    expect(allowsLastWriteWins("configuration")).toBe(false);
    expect(allowsLastWriteWins("device_status")).toBe(false);
    expect(allowsLastWriteWins("safe_profile_metadata")).toBe(true);
  });

  it("covers all six data classes from Hub spec §11.4", () => {
    expect(Object.keys(CONFLICT_POLICIES)).toHaveLength(6);
  });
});

describe("canonical terminal idempotency key (KLREQ-020 correction)", () => {
  it("builds the canonical kl1 shape from the TERMINAL device id", () => {
    expect(buildTerminalIdempotencyKey(TERMINAL, 8821n)).toBe(`kl1.${TERMINAL}.8821`);
    expect(isValidTerminalIdempotencyKey(`kl1.${TERMINAL}.8821`)).toBe(true);
  });

  it("carries the full unsigned 64-bit range without precision loss", () => {
    const key = buildTerminalIdempotencyKey(TERMINAL, MAX_CLIENT_SEQUENCE);
    expect(key.endsWith("18446744073709551615")).toBe(true);
    expect(isValidTerminalIdempotencyKey(key)).toBe(true);
    expect(() => buildTerminalIdempotencyKey(TERMINAL, MAX_CLIENT_SEQUENCE + 1n)).toThrow(
      /unsigned 64-bit/,
    );
    expect(() => buildTerminalIdempotencyKey(TERMINAL, -1n)).toThrow(/unsigned 64-bit/);
  });

  it("rejects the retired location:...:hub:...:seq:N shape outright, with no alias", () => {
    const retired = "location:loc-1:hub:hub-1:seq:42";
    expect(isValidTerminalIdempotencyKey(retired)).toBe(false);
    expect(keyNamespace(retired)).toBe("unknown");
    // The module must no longer be ABLE to produce the retired shape: the old
    // Hub-issued builder and the third state vocabulary are both gone.
    expect(Object.keys(protocol)).not.toContain("buildIdempotencyKey");
    expect(Object.keys(protocol)).not.toContain("OutboxItemState");
  });

  it("requires a real UUID terminal id", () => {
    expect(() => buildTerminalIdempotencyKey("hub-1", 1n)).toThrow(/must be a UUID/);
    expect(isValidTerminalIdempotencyKey("kl1.not-a-uuid.1")).toBe(false);
    expect(isValidTerminalIdempotencyKey(`kl2.${TERMINAL}.1`)).toBe(false);
    expect(isValidTerminalIdempotencyKey(`kl1.${TERMINAL}.`)).toBe(false);
  });
});

describe("Hub-issued effect key (KLREQ-026)", () => {
  it("builds kh1.{command_result_uuid}.{event_ordinal}", () => {
    expect(buildHubEffectKey(COMMAND_RESULT, 0)).toBe(`kh1.${COMMAND_RESULT}.0`);
    expect(buildHubEffectKey(COMMAND_RESULT, 3)).toBe(`kh1.${COMMAND_RESULT}.3`);
    expect(isValidHubEffectKey(`kh1.${COMMAND_RESULT}.3`)).toBe(true);
  });

  it("is deterministic across replay for the same effect", () => {
    expect(buildHubEffectKey(COMMAND_RESULT, 2)).toBe(buildHubEffectKey(COMMAND_RESULT, 2));
  });

  it("keeps the two namespaces disjoint so a Hub effect cannot pose as a terminal command", () => {
    expect(keyNamespace(buildHubEffectKey(COMMAND_RESULT, 1))).toBe("hub_effect");
    expect(keyNamespace(buildTerminalIdempotencyKey(TERMINAL, 1n))).toBe("terminal");
    expect(isValidTerminalIdempotencyKey(buildHubEffectKey(COMMAND_RESULT, 1))).toBe(false);
    expect(isValidHubEffectKey(buildTerminalIdempotencyKey(TERMINAL, 1n))).toBe(false);
  });

  it("fails rather than emits for an ordinal the command contract never registered", () => {
    expect(() =>
      assertRegisteredEffectOrdinal("laundry.confirm_intake", 1, [0, 1, 2]),
    ).not.toThrow();
    expect(() => assertRegisteredEffectOrdinal("laundry.confirm_intake", 7, [0, 1, 2])).toThrow(
      /not registered/,
    );
    expect(() => assertRegisteredEffectOrdinal("laundry.confirm_intake", 0, [])).toThrow(
      /registered: none/,
    );
  });

  it("rejects a malformed command result id or ordinal", () => {
    expect(() => buildHubEffectKey("not-a-uuid", 0)).toThrow(/must be a UUID/);
    expect(() => buildHubEffectKey(COMMAND_RESULT, -1)).toThrow(/non-negative/);
    expect(() => buildHubEffectKey(COMMAND_RESULT, 1.5)).toThrow(/non-negative/);
  });
});

describe("state vocabularies (amendment KLD-2026-07-28-001-A01)", () => {
  it("uses the ALIGNED delivery states and retires the old labels", () => {
    expect([...DELIVERY_STATES]).toEqual([
      "pending",
      "in_flight",
      "retry_wait",
      "acknowledged",
      "rejected",
      "dead_letter",
    ]);
    expect(DELIVERY_STATES as readonly string[]).not.toContain("sending");
    expect(DELIVERY_STATES as readonly string[]).not.toContain("blocked");
    // `OutboxItemState` was a third vocabulary for the same subject (Group 2).
    expect(DELIVERY_STATES as readonly string[]).not.toContain("dispatching");
    expect(DELIVERY_STATES as readonly string[]).not.toContain("retrying");
  });

  it("keeps reconciliation_required OUT of the delivery dimension (§3)", () => {
    expect(DELIVERY_STATES as readonly string[]).not.toContain("reconciliation_required");
    expect([...RECONCILIATION_STATES]).toEqual(["none", "required", "cleared"]);
  });

  it("puts conflict override FIRST for every delivery state (§4)", () => {
    for (const delivery of DELIVERY_STATES) {
      expect(projectExternalSyncStatus(delivery, "required")).toBe("reconciliation_required");
    }
  });

  it("maps every combination inside the approved vocabulary, inventing no sixth value", () => {
    for (const delivery of DELIVERY_STATES) {
      for (const reconciliation of RECONCILIATION_STATES) {
        expect(EXTERNAL_SYNC_STATUSES as readonly string[]).toContain(
          projectExternalSyncStatus(delivery, reconciliation),
        );
      }
    }
  });

  it("reports the truth for each delivery state when no conflict is raised", () => {
    const cases: ReadonlyArray<[DeliveryState, string]> = [
      ["pending", "pending_cloud_sync"],
      ["in_flight", "pending_cloud_sync"],
      ["retry_wait", "pending_cloud_sync"],
      ["acknowledged", "cloud_acknowledged"],
      ["rejected", "cloud_rejected"],
      // Not "pending": a dead letter will not progress without governed repair.
      ["dead_letter", "reconciliation_required"],
    ];
    for (const [delivery, expected] of cases) {
      for (const reconciliation of ["none", "cleared"] as ReconciliationState[]) {
        expect(projectExternalSyncStatus(delivery, reconciliation)).toBe(expected);
      }
    }
  });
});

describe("batch ordering and declared sequence gaps", () => {
  it("enforces strictly increasing hub_sequence in a push batch", () => {
    expect(() => validateBatchOrdering([event(1n), event(2n), event(3n)])).not.toThrow();
    expect(() => validateBatchOrdering([event(1n), event(1n)])).toThrow(/ordering violation/);
    expect(() => validateBatchOrdering([event(2n), event(1n)])).toThrow(/ordering violation/);
  });

  it("orders by the FULL namespace so a replacement Hub never interleaves", () => {
    expect(() => validateBatchOrdering([event(9n, 1), event(1n, 2)])).not.toThrow();
    expect(() => validateBatchOrdering([event(1n, 2), event(9n, 1)])).toThrow(/generation/);
  });

  it("treats a journalled burnt sequence as a KNOWN gap, not a missing event", () => {
    const range = {
      assignmentGeneration: 1,
      firstHubSequence: 1n,
      lastHubSequence: 5n,
      knownGaps: [3n],
    };
    expect(missingSequences(range, [1n, 2n, 4n, 5n])).toEqual([]);
  });

  it("still reports a genuinely missing sequence", () => {
    const range = {
      assignmentGeneration: 1,
      firstHubSequence: 1n,
      lastHubSequence: 5n,
      knownGaps: [3n],
    };
    expect(missingSequences(range, [1n, 2n, 5n])).toEqual([4n]);
  });
});
