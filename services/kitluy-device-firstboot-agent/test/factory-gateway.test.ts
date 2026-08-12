/**
 * Factory enrollment gateway — contract tests.
 *
 * These need no database: they pin the request/response contract, the
 * idempotency rule and the refusal vocabulary using a fake query port. The
 * database-backed proof lives in `factory-enrollment.db.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  CANONICAL_FINGERPRINT_PATTERN,
  enrollDeviceAtFactory,
  type DatabaseHandle,
  type FactoryEnrollmentRequest,
} from "../src/factory-gateway.js";

const VALID_FINGERPRINT = "a".repeat(64);

function request(overrides: Partial<FactoryEnrollmentRequest> = {}): FactoryEnrollmentRequest {
  return {
    assetTag: "KL-0001",
    hardwareProfileKey: "PROFILE-HUB",
    devicePublicKeyFingerprint: VALID_FINGERPRINT,
    publicKeyAlgorithm: "ed25519",
    keyStorageClass: "software",
    enrollmentStationKey: "STATION-1",
    enrollmentOperatorRef: "OP-1",
    signals: [{ signal_type: "mac_address", signal_value: "b8:27:eb:00:00:01" }],
    ...overrides,
  };
}

/** A scripted query port: responds by matching the SQL it is given. */
function fakeDb(script: {
  existing?: string | null;
  enrolled?: string;
  state?: { lifecycle: string; deviceClass: string; assignments: number };
  throws?: Error;
}): DatabaseHandle & { queries: string[] } {
  const queries: string[] = [];
  return {
    queries,
    async query<R>(sql: string): Promise<{ rows: R[] }> {
      queries.push(sql);
      if (script.throws && sql.includes("enroll_device_v1")) throw script.throws;
      if (sql.includes("manufacturing_enrollments")) {
        return {
          rows: (script.existing ? [{ device_id: script.existing }] : []) as unknown as R[],
        };
      }
      if (sql.includes("enroll_device_v1")) {
        return { rows: [{ device_id: script.enrolled ?? "dev-1" }] as unknown as R[] };
      }
      const s = script.state ?? { lifecycle: "enrolled", deviceClass: "store_hub", assignments: 0 };
      return {
        rows: [
          {
            id: script.enrolled ?? script.existing ?? "dev-1",
            device_class: s.deviceClass,
            lifecycle_state: s.lifecycle,
            active_assignments: String(s.assignments),
          },
        ] as unknown as R[],
      };
    },
  };
}

describe("factory enrollment gateway contract", () => {
  it("mirrors the canonical fingerprint format", () => {
    expect(CANONICAL_FINGERPRINT_PATTERN.test("a".repeat(64))).toBe(true);
    expect(CANONICAL_FINGERPRINT_PATTERN.test("A".repeat(64))).toBe(false); // uppercase refused
    expect(CANONICAL_FINGERPRINT_PATTERN.test("a".repeat(63))).toBe(false);
    expect(CANONICAL_FINGERPRINT_PATTERN.test(`${"a".repeat(63)}z`)).toBe(false);
  });

  it("refuses a malformed fingerprint locally, before contacting the database", async () => {
    const db = fakeDb({});
    const result = await enrollDeviceAtFactory(
      db,
      request({ devicePublicKeyFingerprint: "not-a-digest" }),
    );

    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    expect(result.code).toBe("KLUY-DEVICE-FINGERPRINT-MALFORMED");
    expect(result.retryable).toBe(false);
    // The point: nothing was sent.
    expect(db.queries).toEqual([]);
  });

  it("enrolls and reports server-derived class and lifecycle", async () => {
    const result = await enrollDeviceAtFactory(
      fakeDb({
        enrolled: "dev-9",
        state: { lifecycle: "enrolled", deviceClass: "terminal", assignments: 0 },
      }),
      request(),
    );

    expect(result.kind).toBe("enrolled");
    if (result.kind !== "enrolled") return;
    expect(result.deviceRecordId).toBe("dev-9");
    expect(result.deviceClass).toBe("terminal");
    expect(result.lifecycleState).toBe("enrolled");
    expect(result.hasActiveAssignment).toBe(false);
    expect(result.created).toBe(true);
  });

  it("never sends a device-asserted device_class", async () => {
    // The caller cannot state what it is; the hardware profile decides.
    const db = fakeDb({ enrolled: "dev-1" });
    await enrollDeviceAtFactory(db, request());
    const enrollCall = db.queries.find((q) => q.includes("enroll_device_v1")) ?? "";
    expect(enrollCall).not.toContain("device_class");
  });

  it("is idempotent: a replay finds the existing device and does not re-enroll", async () => {
    const db = fakeDb({ existing: "dev-existing" });
    const result = await enrollDeviceAtFactory(db, request());

    expect(result.kind).toBe("enrolled");
    if (result.kind !== "enrolled") return;
    expect(result.deviceRecordId).toBe("dev-existing");
    expect(result.created).toBe(false);
    expect(db.queries.some((q) => q.includes("enroll_device_v1"))).toBe(false);
  });

  it("reports an existing device as assigned when it holds an assignment", async () => {
    const result = await enrollDeviceAtFactory(
      fakeDb({
        existing: "dev-2",
        state: { lifecycle: "active", deviceClass: "terminal", assignments: 1 },
      }),
      request(),
    );
    if (result.kind !== "enrolled") throw new Error("expected enrolled");
    expect(result.hasActiveAssignment).toBe(true);
  });

  const refusals: ReadonlyArray<readonly [string, string, boolean]> = [
    ["KLUY-DEVICE-EVIDENCE-MISSING: no evidence", "KLUY-DEVICE-EVIDENCE-MISSING", false],
    ["KLUY-DEVICE-EVIDENCE-DUPLICATE: seen before", "KLUY-DEVICE-EVIDENCE-DUPLICATE", false],
    ["KLUY-DEVICE-PKI-UNCONFIGURED: BLK-005 open", "KLUY-DEVICE-PKI-UNCONFIGURED", false],
    ["connection terminated unexpectedly", "KLUY-ENROLLMENT-UNAVAILABLE", true],
  ];

  for (const [raw, code, retryable] of refusals) {
    it(`maps '${code}' with retryable=${retryable}`, async () => {
      const result = await enrollDeviceAtFactory(fakeDb({ throws: new Error(raw) }), request());
      expect(result.kind).toBe("refused");
      if (result.kind !== "refused") return;
      expect(result.code).toBe(code);
      expect(result.retryable).toBe(retryable);
    });
  }

  it("does not leak SQLSTATE, schema or function names in a refusal", async () => {
    const result = await enrollDeviceAtFactory(
      fakeDb({
        throws: new Error('ERROR: 42P01 relation "kitluy_devices.devices" does not exist'),
      }),
      request(),
    );
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") return;
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("42P01");
    expect(serialised).not.toContain("kitluy_devices");
    expect(serialised).not.toContain("relation");
  });

  it("treats a transport failure as retryable and a rule violation as not", async () => {
    const transport = await enrollDeviceAtFactory(
      fakeDb({ throws: new Error("ECONNREFUSED") }),
      request(),
    );
    const rule = await enrollDeviceAtFactory(
      fakeDb({ throws: new Error("KLUY-DEVICE-EVIDENCE-MISSING") }),
      request(),
    );
    if (transport.kind !== "refused" || rule.kind !== "refused")
      throw new Error("expected refusals");
    expect(transport.retryable).toBe(true);
    expect(rule.retryable).toBe(false);
  });
});
