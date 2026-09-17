/**
 * The Partner terminals read carries the Terminal's DEVICE-REPORTED runtime
 * (T1-STORE-OPERATIONS-001; cloud group 0229) — copied, never derived.
 */
import { describe, expect, it } from "vitest";

import { listPhysicalTerminals } from "../src/terminal-provisioning.js";

const STORE = "11111111-1111-4111-8111-111111111111";
const DEVICE = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const RELEASE = "0b6f3f58-8d5a-4f52-9f59-6d2f8d7f0a11";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    digital_store_id: STORE,
    store_location_id: "22222222-2222-4222-8222-222222222222",
    location_reference: "DEMO-PP-01 — Demo",
    label: "Pi HEllo",
    terminal_profile_keys: ["laundry.t1.intake_cashier"],
    created_at: new Date("2026-09-16T08:00:00Z"),
    bound_device_id: DEVICE,
    bound_device_reference: "KL-1CB3577C26A7",
    bound_lifecycle: "active",
    bound_assignment_state: "active",
    session_id: null,
    session_state: null,
    session_expires_at: null,
    session_paired_at: null,
    session_failed: null,
    session_locked_at: null,
    runtime_report: {
      schema: "kitluy.device-runtime-report.v1",
      deviceClass: "terminal",
      imageVersion: "0.2.0-dev",
      agentVersion: "0.1.0",
      hubLink: {
        phase: "SERVING",
        hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
        checkedAt: "2026-09-17T03:00:00.000Z",
        reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
      },
      application: {
        product: "kitluy-terminal",
        installedReleaseId: RELEASE,
        installedVersion: "0.1.0-t1a",
        journalPhase: "COMMITTED",
        lastOutcome: "INSTALLED",
        lastReason: "ASSIGNMENT_STALE: internal detail a Partner must not see",
        runningReleaseId: RELEASE,
        runningSince: "2026-09-17T02:59:00.000Z",
        unitActive: true,
      },
      pos: {
        state: "ready",
        refusalCode: null,
        applicationVersion: "0.1.0",
        configurationVersion: 7,
        configurationFreshness: "current",
        staffSignedIn: true,
        observedAt: "2026-09-17T03:00:01.000Z",
      },
    },
    runtime_received_at: new Date("2026-09-17T03:00:05Z"),
    runtime_age_seconds: "42",
    ...overrides,
  };
}

function pool(rows: unknown[]) {
  const seen: string[] = [];
  return {
    seen,
    deps: {
      pool: {
        query: (sql: string) => {
          seen.push(sql);
          return Promise.resolve({ rows });
        },
      },
    } as never,
  };
}

describe("the runtime a Partner sees", () => {
  it("is read from the runtime status view, joined by the BOUND device", async () => {
    const p = pool([row()]);
    await listPhysicalTerminals(p.deps, STORE);
    expect(p.seen[0]).toMatch(
      /left join kitluy_devices\.device_runtime_status_read rs on rs\.device_id = d\.id/u,
    );
  });

  it("copies the facts, labels them device-reported, ages them by the cloud clock", async () => {
    const p = pool([row()]);
    const [terminal] = await listPhysicalTerminals(p.deps, STORE);
    expect(terminal?.runtime).toEqual({
      source: "device_reported",
      receivedAt: "2026-09-17T03:00:05.000Z",
      ageSeconds: 42,
      hubLink: {
        phase: "SERVING",
        hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
        checkedAt: "2026-09-17T03:00:00.000Z",
      },
      application: {
        product: "kitluy-terminal",
        installedReleaseId: RELEASE,
        installedVersion: "0.1.0-t1a",
        journalPhase: "COMMITTED",
        lastOutcome: "INSTALLED",
        runningReleaseId: RELEASE,
        unitActive: true,
      },
      pos: {
        state: "ready",
        refusalCode: null,
        applicationVersion: "0.1.0",
        configurationVersion: 7,
        configurationFreshness: "current",
        staffSignedIn: true,
      },
    });
  });

  it("never carries the internal reason text", async () => {
    const p = pool([row()]);
    const [terminal] = await listPhysicalTerminals(p.deps, STORE);
    expect(JSON.stringify(terminal)).not.toContain("internal detail");
  });

  it("is null for a seat with no bound device, even if a row were joined", async () => {
    const p = pool([row({ bound_device_id: null, bound_device_reference: null })]);
    const [terminal] = await listPhysicalTerminals(p.deps, STORE);
    expect(terminal?.runtime).toBeNull();
  });

  it("is null when the device has never reported", async () => {
    const p = pool([
      row({ runtime_report: null, runtime_received_at: null, runtime_age_seconds: null }),
    ]);
    const [terminal] = await listPhysicalTerminals(p.deps, STORE);
    expect(terminal?.runtime).toBeNull();
  });
});
