import { describe, expect, it } from "vitest";
import { InMemoryLocalDatabase } from "../src/local-db.js";
import { runSyncCycle, SimulatedCloud } from "../src/sync-engine.js";

function recordOperation(db: InMemoryLocalDatabase, n: number): void {
  db.transaction((tx) => {
    tx.put({ aggregateType: "operational_record", aggregateId: `agg-${n}`, data: { n } });
    tx.appendOutbox(
      {
        eventId: `ev-${n}`,
        tenantId: "t-1",
        digitalStoreId: "ds-1",
        storeLocationId: "loc-1",
        hubId: "hub-1",
        aggregateType: "operational_record",
        aggregateId: `agg-${n}`,
        eventType: "operational_record.created",
        aggregateVersion: 1,
        schemaVersion: "1",
        occurredAt: "2026-07-26T10:00:00+07:00",
      },
      { n },
    );
  });
}

describe("Store Hub offline/reconnect harness (Hub spec §11)", () => {
  it("persists mutations and outbox atomically in one transaction", () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    recordOperation(db, 1);
    expect(db.getRecord("operational_record", "agg-1")).toBeDefined();
    expect(db.pendingOutbox()).toHaveLength(1);
    expect(db.pendingOutbox()[0]!.idempotencyKey).toBe("location:loc-1:hub:hub-1:seq:1");
  });

  it("a failed transaction commits neither the record nor the outbox item", () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    expect(() =>
      db.transaction((tx) => {
        tx.put({ aggregateType: "operational_record", aggregateId: "agg-x", data: {} });
        tx.appendOutbox(
          {
            eventId: "ev-x",
            tenantId: "t-1",
            digitalStoreId: "ds-1",
            storeLocationId: "loc-1",
            hubId: "hub-1",
            aggregateType: "operational_record",
            aggregateId: "agg-x",
            eventType: "operational_record.created",
            aggregateVersion: 1,
            schemaVersion: "1",
            occurredAt: "2026-07-26T10:00:00+07:00",
          },
          {},
        );
        throw new Error("business rule rejected");
      }),
    ).toThrow("business rule rejected");
    expect(db.getRecord("operational_record", "agg-x")).toBeUndefined();
    expect(db.pendingOutbox()).toHaveLength(0);
  });

  it("operations continue while offline; events stay pending", async () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    const cloud = new SimulatedCloud();
    cloud.online = false;

    recordOperation(db, 1);
    recordOperation(db, 2);
    const outcome = await runSyncCycle(db, cloud);

    expect(outcome.offline).toBe(true);
    expect(db.pendingOutbox()).toHaveLength(2);
    // Local operation was never blocked by WAN failure (RB v4 §1.3.9).
    expect(db.getRecord("operational_record", "agg-2")).toBeDefined();
  });

  it("reconnect drains the outbox oldest-first, deterministically", async () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    const cloud = new SimulatedCloud();
    cloud.online = false;
    for (let n = 1; n <= 5; n++) recordOperation(db, n);
    await runSyncCycle(db, cloud);

    cloud.online = true;
    const outcome = await runSyncCycle(db, cloud);
    expect(outcome).toMatchObject({ pushed: 5, applied: 5, duplicates: 0, rejected: 0 });
    expect(db.pendingOutbox()).toHaveLength(0);
    expect(cloud.appliedEvents.map((e) => e.localSequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it("replay after a lost acknowledgement is idempotent — never double-applied", async () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    const cloud = new SimulatedCloud();
    recordOperation(db, 1);

    // First push applies on the cloud, but pretend the ack was lost locally:
    const pending = db.pendingOutbox();
    await cloud.push(pending);
    expect(db.pendingOutbox()).toHaveLength(1); // still pending locally

    // Reconnect cycle replays the same event; cloud dedupes by idempotency key.
    const outcome = await runSyncCycle(db, cloud);
    expect(outcome.duplicates).toBe(1);
    expect(outcome.applied).toBe(0);
    expect(cloud.appliedEvents).toHaveLength(1);
    expect(db.pendingOutbox()).toHaveLength(0);
  });
});
