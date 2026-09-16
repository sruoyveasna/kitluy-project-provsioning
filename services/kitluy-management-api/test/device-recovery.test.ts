/**
 * The device recovery view: what a device needs in order to come back.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slice D.
 *
 * What must hold:
 *   1. The read runs INSIDE a transaction as `kitluy_device_boot_service`, and a
 *      failure rolls back and releases the client.
 *   2. The decision is the contract's, over the door's facts, with a freshly
 *      flashed card — so the portal says what the device would say.
 *   3. A next action this API cannot perform is marked, never implied.
 *   4. The device detail still answers when the view is not configured, and it
 *      is only reached after the human was authorized.
 */
import { describe, expect, it } from "vitest";

import type { DatabaseHandle, TokenVerifier } from "../src/authorization.js";
import { readDeviceRecovery, type RecoveryClient } from "../src/device-recovery.js";
import { handleManagementRequest, MANAGEMENT_PREFIX } from "../src/http.js";

const DEVICE = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const STORE = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";
const ENROLLMENT = "66666666-6666-4666-8666-666666666666";

function facts(device: Record<string, unknown>, boardResolution = "resolved") {
  return {
    board_resolution: boardResolution,
    resolution_detail: null,
    device: {
      device_record_id: DEVICE,
      device_class: "store_hub",
      lifecycle: "active",
      open_trust_incident_count: 0,
      current_enrollment_id: ENROLLMENT,
      current_identity_key_fingerprint: "ab".repeat(32),
      assignment_generation: 3,
      assignment: { state: "active", digital_store_id: STORE, store_location_id: LOCATION },
      credential_head_generation: 2,
      honoured_previous_generation: null,
      active_certificate: { generation: 2, enrollment_id: ENROLLMENT },
      seat: null,
      ...device,
    },
  };
}

function pool(answer: unknown, options: { fail?: boolean } = {}) {
  const sql: string[] = [];
  let released = 0;
  const client: RecoveryClient = {
    async query<R>(text: string): Promise<{ rows: R[] }> {
      sql.push(text);
      if (text.includes("describe_device_recovery_facts_v1")) {
        if (options.fail) throw new Error('permission denied for function "x"');
        return { rows: [{ facts: answer }] as unknown as R[] };
      }
      return { rows: [] };
    },
    release() {
      released += 1;
    },
  };
  return {
    sql,
    released: () => released,
    deps: { pool: { connect: () => Promise.resolve(client) } },
  };
}

describe("reading the recovery view", () => {
  it("reads as the narrow boot identity, inside one transaction", async () => {
    const p = pool(facts({}));
    await readDeviceRecovery(p.deps, DEVICE, "development");
    expect(p.sql[0]).toBe("begin");
    expect(p.sql[1]).toBe("set local role kitluy_device_boot_service");
    expect(p.sql[2]).toContain("describe_device_recovery_facts_v1");
    expect(p.sql[3]).toBe("commit");
    expect(p.released()).toBe(1);
  });

  it("rolls back and releases on failure, and does not swallow it", async () => {
    const p = pool(null, { fail: true });
    await expect(readDeviceRecovery(p.deps, DEVICE, "development")).rejects.toThrow();
    expect(p.sql).toContain("rollback");
    expect(p.released()).toBe(1);
  });

  it("a Hub still assigned: release it, then pair — and this API cannot release yet", async () => {
    const view = await readDeviceRecovery(pool(facts({})).deps, DEVICE, "development");
    expect(view).toMatchObject({
      classification: "RECOVERING_DEVICE",
      nextAction: "RELEASE_DEVICE_THEN_PAIR",
      userMessageKey: "boot.recovering.needsRelease",
      basis: "freshly_flashed_card",
      nextActionGap: "RELEASE_ROUTE_NOT_AVAILABLE",
    });
    expect(view?.message).not.toMatch(/KLUY-/);
  });

  it("a released Hub: enter a pairing code, which this API can issue — no gap", async () => {
    const view = await readDeviceRecovery(
      pool(facts({ lifecycle: "enrolled", assignment_generation: 0, assignment: null })).deps,
      DEVICE,
      "development",
    );
    expect(view?.nextAction).toBe("ENTER_PAIRING_CODE");
    expect(view && "nextActionGap" in view).toBe(false);
  });

  it("a quarantined device is locked, whatever else is true", async () => {
    const view = await readDeviceRecovery(
      pool(facts({ lifecycle: "quarantined", open_trust_incident_count: 1 })).deps,
      DEVICE,
      "development",
    );
    expect(view?.classification).toBe("SECURITY_LOCK");
  });

  it("a Terminal whose seat a replacement took: replace it — and this API cannot yet", async () => {
    const view = await readDeviceRecovery(
      pool(
        facts({
          device_class: "terminal",
          lifecycle: "enrolled",
          assignment_generation: 0,
          assignment: null,
          seat: { physical_terminal_id: LOCATION, occupied_by_other_device: true },
        }),
      ).deps,
      DEVICE,
      "development",
    );
    expect(view).toMatchObject({
      classification: "REPLACE_HARDWARE",
      nextActionGap: "REPLACE_ROUTE_NOT_AVAILABLE",
    });
  });

  it("nothing for an unknown device, a class no boot image exists for, or an unruled environment", async () => {
    expect(await readDeviceRecovery(pool(null).deps, DEVICE, "development")).toBeNull();
    expect(
      await readDeviceRecovery(
        pool(facts({ device_class: "peripheral" })).deps,
        DEVICE,
        "development",
      ),
    ).toBeNull();
    const untouched = pool(facts({}));
    expect(await readDeviceRecovery(untouched.deps, DEVICE, "staging")).toBeNull();
    expect(untouched.sql).toEqual([]);
  });

  it("a malformed facts row is refused, never guessed into a branch", async () => {
    await expect(
      readDeviceRecovery(pool(facts({ lifecycle: "hibernating" })).deps, DEVICE, "development"),
    ).rejects.toThrow(/not understood/);
  });
});

describe("GET /management/v1/devices/:id carries the recovery view", () => {
  const verifier: TokenVerifier = { verify: () => Promise.resolve({ userId: DEVICE }) };
  const FLEET_ROW = {
    device_record_id: DEVICE,
    asset_tag: "KL-CLOUD-HUB-0001",
    device_class: "store_hub",
    lifecycle_state: "active",
    hardware_trust_level: "development_software",
    certificate_status: "active",
    profile_key: "CLOUD-HUB-PI5",
    assignment_state: "active",
    tenant_id: null,
    digital_store_id: STORE,
    store_location_id: LOCATION,
    digital_store_label: null,
    location_label: null,
    terminal_assignment_count: 0,
    open_incident_count: 0,
    last_observed_at: null,
    fleet_status: "active",
  };
  function db(permitted: boolean): DatabaseHandle {
    return {
      async query<R>(text: string): Promise<{ rows: R[] }> {
        if (text.includes("admin_user_profiles")) {
          return {
            rows: [
              {
                profile_status: "ACTIVE",
                disabled_at: null,
                permitted,
                permissions: ["fleet.read"],
              },
            ] as unknown as R[],
          };
        }
        if (text.includes("device_fleet_status")) return { rows: [FLEET_ROW] as unknown as R[] };
        if (text.includes("evaluate_provisioning_eligibility_v1")) {
          return { rows: [{ eligible: false, reasons: [] }] as unknown as R[] };
        }
        return { rows: [] };
      },
    };
  }
  const request = {
    method: "GET",
    url: `${MANAGEMENT_PREFIX}/devices/${DEVICE}`,
    authorization: "Bearer ok",
  };

  it("includes the view when configured", async () => {
    const res = await handleManagementRequest(
      { db: db(true), verifier, recovery: pool(facts({})).deps, environment: "development" },
      request,
    );
    expect(res.status).toBe(200);
    expect((res.body as { recovery: { nextAction: string } }).recovery.nextAction).toBe(
      "RELEASE_DEVICE_THEN_PAIR",
    );
  });

  it("still answers with recovery: null when the view is not configured", async () => {
    const res = await handleManagementRequest({ db: db(true), verifier }, request);
    expect(res.status).toBe(200);
    expect((res.body as { recovery: unknown }).recovery).toBeNull();
  });

  it("never reads recovery facts for a caller the database refused", async () => {
    const p = pool(facts({}));
    const res = await handleManagementRequest(
      { db: db(false), verifier, recovery: p.deps, environment: "development" },
      request,
    );
    expect(res.status).toBe(403);
    expect(p.sql).toEqual([]);
  });
});
