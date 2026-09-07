/**
 * The bootstrap health reporter.
 *
 * ===========================================================================
 * WHAT THESE TESTS ARE PROTECTING
 * ===========================================================================
 *   1. The device class comes from the IMAGE, never from a constant in this
 *      file. It reported `terminal` on every Store Hub that ran it.
 *   2. Health is derived from cloud registration when the retired ticket
 *      agent's `bootstrap-state.json` is absent — which is every terminal
 *      built after KLD-2026-09-03-FACTORY-ENROLLMENT-001. Without this, such a
 *      terminal reported `degraded` for ever while doing exactly the right
 *      thing.
 *   3. A device KitLuy has stopped is degraded; one that cannot reach KitLuy is
 *      still bootstrapping; one waiting on a human is healthy.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeBootstrapState } from "../src/bootstrap-state.js";
import { writeRegistrationState, type RegistrationPhase } from "../src/registration-state.js";
import { buildHealthSummary } from "../src/bin/health-reporter.js";

const AT = "2026-09-03T00:00:00.000Z";

let root: string;
let etcRoot: string;
let bootstrapPath: string;
let registrationPath: string;

function bakeImageEnv(lines: readonly string[]): void {
  mkdirSync(join(etcRoot, "kitluy"), { recursive: true });
  writeFileSync(join(etcRoot, "kitluy", "image.env"), `${lines.join("\n")}\n`);
}

function registered(phase: RegistrationPhase, deviceId?: string): void {
  writeRegistrationState(
    { phase, updatedAt: AT, ...(deviceId === undefined ? {} : { deviceId }) },
    registrationPath,
  );
}

function summary() {
  return buildHealthSummary({ etcRoot, bootstrapPath, registrationPath, now: new Date(AT) });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kitluy-health-"));
  etcRoot = join(root, "etc");
  bootstrapPath = join(root, "state", "bootstrap-state.json");
  registrationPath = join(root, "state", "registration-state.json");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("the device class comes from the image", () => {
  it("reports the class the builder baked", () => {
    bakeImageEnv(["KITLUY_DEVICE_CLASS=terminal", "KITLUY_IMAGE_VERSION=0.2.0-dev"]);
    registered("AWAITING_APPROVAL", "KL-6EFCC7C6CC2A");
    const s = summary();
    expect(s.deviceClass).toBe("terminal");
    expect(s.imageVersion).toBe("0.2.0-dev");
  });

  it("reports a Store Hub as a Store Hub (the constant used to lie)", () => {
    bakeImageEnv(["KITLUY_DEVICE_CLASS=store_hub"]);
    registered("APPROVED", "KL-6C4917D5C6DA");
    expect(summary().deviceClass).toBe("store_hub");
  });

  it("reports `unknown` rather than guessing when the image stated no class", () => {
    registered("APPROVED", "KL-X");
    expect(summary().deviceClass).toBe("unknown");
  });
});

describe("health without bootstrap-state.json (the ticket agent is retired)", () => {
  beforeEach(() => bakeImageEnv(["KITLUY_DEVICE_CLASS=terminal"]));

  it("is bootstrapping when nothing has been recorded yet", () => {
    const s = summary();
    expect(s.health).toBe("bootstrapping");
    expect(s.registrationPhase).toBeUndefined();
    expect(s.deviceRecordId).toBeUndefined();
  });

  it("is healthy while waiting for a human decision — pending is not a fault", () => {
    registered("AWAITING_APPROVAL", "KL-6EFCC7C6CC2A");
    const s = summary();
    expect(s.health).toBe("healthy");
    expect(s.registrationPhase).toBe("AWAITING_APPROVAL");
    expect(s.deviceRecordId).toBe("KL-6EFCC7C6CC2A");
    expect(s.assignmentState).toBe("unassigned");
  });

  it("is healthy once approved, and still unassigned", () => {
    registered("APPROVED", "KL-6EFCC7C6CC2A");
    const s = summary();
    expect(s.health).toBe("healthy");
    expect(s.assignmentState).toBe("unassigned");
  });

  it("is still bootstrapping when KitLuy cannot be reached", () => {
    registered("UNREACHABLE");
    expect(summary().health).toBe("bootstrapping");
  });

  it("is degraded when KitLuy has stopped the device", () => {
    registered("CONTAINED", "KL-6EFCC7C6CC2A");
    expect(summary().health).toBe("degraded");
  });
});

describe("the retired ticket path's file still wins when a device holds one", () => {
  it("derives health from bootstrap state, as before", () => {
    bakeImageEnv(["KITLUY_DEVICE_CLASS=terminal"]);
    writeBootstrapState(
      {
        phase: "HALTED",
        identityReady: true,
        networkReady: true,
        agentVersion: "test",
        updatedAt: AT,
        deviceRecordId: "dev-1",
        deviceLabel: "KL-1A2B3C4D",
        imageVersion: "0.1.0",
      },
      bootstrapPath,
    );
    registered("APPROVED", "KL-6EFCC7C6CC2A");
    const s = summary();
    expect(s.health).toBe("degraded");
    expect(s.deviceLabel).toBe("KL-1A2B3C4D");
    // The ticket-path record id is the older identity; it stays authoritative.
    expect(s.deviceRecordId).toBe("dev-1");
    expect(s.imageVersion).toBe("0.1.0");
  });
});
