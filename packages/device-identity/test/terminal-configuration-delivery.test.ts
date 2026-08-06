/**
 * Signed per-terminal configuration DELIVERY — WS-12-T001-P02.
 * Bindings first, payload digest next, signature last; every refusal named.
 */
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  TERMINAL_CONFIGURATION_DELIVERY_KIND,
  terminalConfigurationDeliveryBytes,
  verifyTerminalConfigurationDelivery,
  type DeviceRecordId,
  type TerminalConfigurationDelivery,
} from "../src/index.js";

const keys = new DevelopmentDeviceKeyProvider();
const hubRef = `delivery-hub-${randomUUID().slice(0, 8)}` as DeviceRecordId;
await keys.generateDeviceKey(hubRef, "development");
const hubPem = keys.publicKeyPem(hubRef) ?? "";

const PAYLOAD = JSON.stringify({ pricing: { currency: "KHR" } });
const PAYLOAD_SHA = createHash("sha256").update(Buffer.from(PAYLOAD, "utf8")).digest("hex");

function delivery(
  over: Partial<TerminalConfigurationDelivery> = {},
): TerminalConfigurationDelivery {
  return {
    snapshotId: "b0000000-0000-4000-8000-000000000001",
    configurationVersion: 7,
    schemaVersion: 1,
    tenantId: "b0000000-0000-4000-8000-000000000002",
    digitalStoreId: "b0000000-0000-4000-8000-000000000003",
    storeLocationId: "b0000000-0000-4000-8000-000000000004",
    environment: "development",
    hubDeviceId: "b0000000-0000-4000-8000-000000000005",
    terminalDeviceId: "b0000000-0000-4000-8000-000000000006",
    assignmentGeneration: 1,
    terminalProfileCode: "laundry.t1.intake_cashier",
    minimumApplicationVersion: "0.1.0",
    maximumApplicationVersion: null,
    issuedAt: new Date("2026-08-06T08:00:00.000Z"),
    effectiveAt: new Date("2026-08-06T09:00:00.000Z"),
    validUntil: new Date("2026-08-07T09:00:00.000Z"),
    manifestSha256: "1".repeat(64),
    payloadSha256: PAYLOAD_SHA,
    signingKeyId: "demo-signing-key-1",
    correlationId: "b0000000-0000-4000-8000-000000000007",
    ...over,
  };
}

function sign(d: TerminalConfigurationDelivery): Uint8Array {
  return keys.provePossession(hubRef, terminalConfigurationDeliveryBytes(d));
}

function expectation(d: TerminalConfigurationDelivery) {
  return {
    tenantId: d.tenantId,
    digitalStoreId: d.digitalStoreId,
    storeLocationId: d.storeLocationId,
    environment: d.environment,
    hubDeviceId: d.hubDeviceId,
    terminalDeviceId: d.terminalDeviceId,
    assignmentGeneration: d.assignmentGeneration,
    terminalProfileCode: d.terminalProfileCode,
  };
}

describe("terminal configuration delivery (WS-12-T001-P02 §3)", () => {
  it("verifies a well-bound Hub-signed delivery", () => {
    const d = delivery();
    const verdict = verifyTerminalConfigurationDelivery(
      d,
      sign(d),
      hubPem,
      expectation(d),
      PAYLOAD_SHA,
    );
    expect(verdict.verified).toBe(true);
  });

  it("checks bindings BEFORE the signature and names each refusal", () => {
    const d = delivery();
    const signature = sign(d);
    const cases: Array<[Partial<TerminalConfigurationDelivery>, string]> = [
      [{ tenantId: randomUUID() }, "DELIVERY_WRONG_SCOPE"],
      [{ environment: "pilot" }, "DELIVERY_WRONG_ENVIRONMENT"],
      [{ hubDeviceId: randomUUID() }, "DELIVERY_WRONG_HUB"],
      [{ terminalDeviceId: randomUUID() }, "DELIVERY_WRONG_TERMINAL"],
      [{ assignmentGeneration: 2 }, "DELIVERY_WRONG_ASSIGNMENT"],
      [{ terminalProfileCode: "laundry.t2.customer_display" }, "DELIVERY_WRONG_PROFILE"],
    ];
    for (const [over, refusal] of cases) {
      const tampered = delivery(over);
      const verdict = verifyTerminalConfigurationDelivery(
        tampered,
        signature,
        hubPem,
        expectation(d),
        PAYLOAD_SHA,
      );
      expect(verdict.verified, refusal).toBe(false);
      expect(verdict.refusalCode).toBe(refusal);
    }
  });

  it("refuses a payload that does not hash to the attested digest", () => {
    const d = delivery();
    const verdict = verifyTerminalConfigurationDelivery(
      d,
      sign(d),
      hubPem,
      expectation(d),
      createHash("sha256").update("tampered payload").digest("hex"),
    );
    expect(verdict.refusalCode).toBe("DELIVERY_PAYLOAD_MISMATCH");
  });

  it("refuses a signature over DIFFERENT canonical bytes", () => {
    const d = delivery();
    const other = delivery({ configurationVersion: 8 });
    const verdict = verifyTerminalConfigurationDelivery(
      d,
      sign(other),
      hubPem,
      expectation(d),
      PAYLOAD_SHA,
    );
    expect(verdict.refusalCode).toBe("DELIVERY_SIGNATURE_INVALID");
  });

  it("fixes the canonical byte layout under its own domain separator", () => {
    const bytes = Buffer.from(terminalConfigurationDeliveryBytes(delivery())).toString("utf8");
    expect(bytes.startsWith(`${TERMINAL_CONFIGURATION_DELIVERY_KIND}\n`)).toBe(true);
    // null maximum serializes as "-" — the house null sentinel.
    expect(bytes.split("\n")).toContain("-");
  });
});
