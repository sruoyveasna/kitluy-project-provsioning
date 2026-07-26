import { describe, expect, it } from "vitest";
import { asId } from "@kitluy/shared-types";
import { AppendOnlyAuditLog, HUB_SECURITY_EVENT_TYPES } from "../src/index.js";

const baseEvent = {
  auditEventId: "ae-1",
  eventType: "device_quarantined",
  occurredAt: "2026-07-26T09:00:00+07:00",
  businessDate: "2026-07-26",
  tenantId: asId.tenantId("t-1"),
  payload: { deviceId: "dev-9" },
};

describe("@kitluy/audit", () => {
  it("registers the Hub security event names from Store Hub spec §15.4", () => {
    expect(HUB_SECURITY_EVENT_TYPES).toContain("unknown_device_provisioning_attempted");
    expect(HUB_SECURITY_EVENT_TYPES).toContain("cloned_installation_identity_detected");
    expect(HUB_SECURITY_EVENT_TYPES).toHaveLength(10);
  });

  it("appends events and returns frozen records", () => {
    const log = new AppendOnlyAuditLog();
    log.append(baseEvent);
    const stored = log.all()[0]!;
    expect(Object.isFrozen(stored)).toBe(true);
    expect(stored.eventType).toBe("device_quarantined");
  });

  it("rejects duplicate event IDs — history is append-only", () => {
    const log = new AppendOnlyAuditLog();
    log.append(baseEvent);
    expect(() => log.append(baseEvent)).toThrow(/append-only/);
    expect(log.all()).toHaveLength(1);
  });

  it("exposes no mutation API beyond append", () => {
    const log = new AppendOnlyAuditLog() as unknown as Record<string, unknown>;
    expect(log["update"]).toBeUndefined();
    expect(log["delete"]).toBeUndefined();
  });
});
