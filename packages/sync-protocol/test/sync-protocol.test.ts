import { describe, expect, it } from "vitest";
import {
  allowsLastWriteWins,
  buildIdempotencyKey,
  CONFLICT_POLICIES,
  isValidIdempotencyKey,
  validateBatchOrdering,
  type OutboxEvent,
} from "../src/index.js";

function event(seq: number): OutboxEvent {
  return {
    eventId: `ev-${seq}`,
    tenantId: "t-1",
    digitalStoreId: "ds-1",
    storeLocationId: "loc-1",
    hubId: "hub-1",
    aggregateType: "transaction",
    aggregateId: "tx-1",
    eventType: "example.recorded",
    aggregateVersion: seq,
    localSequence: seq,
    idempotencyKey: buildIdempotencyKey("loc-1", "hub-1", seq),
    schemaVersion: "1",
    payloadSha256: "0".repeat(64),
    occurredAt: "2026-07-26T09:00:00+07:00",
  };
}

describe("@kitluy/sync-protocol", () => {
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

  it("builds and validates the canonical idempotency key format", () => {
    const key = buildIdempotencyKey("loc-1", "hub-1", 42);
    expect(key).toBe("location:loc-1:hub:hub-1:seq:42");
    expect(isValidIdempotencyKey(key)).toBe(true);
    expect(isValidIdempotencyKey("loc-1:42")).toBe(false);
    expect(() => buildIdempotencyKey("loc-1", "hub-1", -1)).toThrow();
    expect(() => buildIdempotencyKey("loc-1", "hub-1", 1.5)).toThrow();
  });

  it("enforces strictly increasing local sequence in a push batch", () => {
    expect(() => validateBatchOrdering([event(1), event(2), event(3)])).not.toThrow();
    expect(() => validateBatchOrdering([event(1), event(1)])).toThrow(/ordering violation/);
    expect(() => validateBatchOrdering([event(2), event(1)])).toThrow(/ordering violation/);
  });
});
