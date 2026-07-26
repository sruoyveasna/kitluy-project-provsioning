import { describe, expect, it } from "vitest";
import { TERMINAL_PROFILES } from "../src/index.js";
import { handleLanRequest } from "../src/lan-api.js";
import { InMemoryLocalDatabase } from "../src/local-db.js";

const identity = {
  hubId: "hub-1",
  storeLocationId: "loc-1",
  certificateFingerprint: "SIMULATED-DEV-MODE",
};

describe("Store Hub LAN API kernel (/edge/v1)", () => {
  it("locks the four terminal profiles; legacy identifiers are retired", () => {
    expect(TERMINAL_PROFILES).toEqual([
      "t1_intake_cashier",
      "t2_customer_display",
      "t3_ready_scan_in",
      "t4_pickup_scan_out",
    ]);
    expect(TERMINAL_PROFILES).not.toContain("t2_scan_in");
    expect(TERMINAL_PROFILES).not.toContain("t3_scan_out");
  });

  it("serves health and identity", () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    expect(handleLanRequest("GET", "/edge/v1/health", identity, db).status).toBe(200);
    const id = handleLanRequest("GET", "/edge/v1/identity", identity, db);
    expect((id.body as { hubId: string }).hubId).toBe("hub-1");
  });

  it("reports sync state as pending_cloud_sync while the outbox is non-empty", () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    db.transaction((tx) => {
      tx.put({ aggregateType: "operational_record", aggregateId: "a", data: {} });
      tx.appendOutbox(
        {
          eventId: "ev-1",
          tenantId: "t-1",
          digitalStoreId: "ds-1",
          storeLocationId: "loc-1",
          hubId: "hub-1",
          aggregateType: "operational_record",
          aggregateId: "a",
          eventType: "operational_record.created",
          aggregateVersion: 1,
          schemaVersion: "1",
          occurredAt: "2026-07-26T10:00:00+07:00",
        },
        {},
      );
    });
    const res = handleLanRequest("GET", "/edge/v1/sync/status", identity, db);
    expect(res.body).toEqual({ pendingOutbox: 1, syncState: "pending_cloud_sync" });
  });

  it("blocks mutating routes pending contract reconciliation (KLREC-2026-07-26-001)", () => {
    const db = new InMemoryLocalDatabase("loc-1", "hub-1");
    const res = handleLanRequest("POST", "/edge/v1/bookings", identity, db);
    expect(res.status).toBe(405);
    expect(JSON.stringify(res.body)).toContain("KLREC-2026-07-26-001");
  });
});
