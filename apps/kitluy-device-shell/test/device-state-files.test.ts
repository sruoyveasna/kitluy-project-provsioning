import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readNetwork, readSnapshot, type DeviceRoots } from "../electron/device-state-files.js";

let root = "";
let roots: DeviceRoots;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kt-shell-"));
  mkdirSync(join(root, "state"), { recursive: true });
  mkdirSync(join(root, "net"), { recursive: true });
  roots = {
    stateDir: join(root, "state"),
    netDir: join(root, "net"),
    routePath: join(root, "route"),
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function writeState(name: string, value: unknown): void {
  writeFileSync(join(roots.stateDir, name), JSON.stringify(value));
}
function online(): void {
  mkdirSync(join(roots.netDir, "eth0"), { recursive: true });
  writeFileSync(join(roots.netDir, "eth0", "operstate"), "up\n");
  writeFileSync(
    roots.routePath,
    "Iface\tDestination\tGateway\neth0\t00000000\t0102A8C0\neth0\t0002A8C0\t00000000\n",
  );
}

describe("readSnapshot", () => {
  it("reads an approved, unassigned terminal that is online", () => {
    writeState("registration-state.json", {
      phase: "APPROVED",
      deviceId: "cloud-1",
      keyFingerprint: "abcdef0123456789",
      updatedAt: "now",
    });
    online();
    const snap = readSnapshot(roots);
    expect(snap.registration?.phase).toBe("APPROVED");
    expect(snap.keyFingerprint).toBe("abcdef0123456789");
    expect(snap.network).toEqual({ hasLink: true, hasRoute: true });
    expect(snap.pairing).toBeNull();
  });

  it("treats a missing registration file as not-registered (null), not an error", () => {
    const snap = readSnapshot(roots);
    expect(snap.registration).toBeNull();
    expect(snap.network).toEqual({ hasLink: false, hasRoute: false });
  });

  it("treats a corrupt registration file as null", () => {
    writeFileSync(join(roots.stateDir, "registration-state.json"), "{ not json");
    expect(readSnapshot(roots).registration).toBeNull();
  });

  it("rejects an unknown phase string rather than passing it through", () => {
    writeState("registration-state.json", { phase: "WAT", updatedAt: "now" });
    expect(readSnapshot(roots).registration).toBeNull();
  });

  it("carries the device record id from bootstrap-state for the pairing check", () => {
    writeState("registration-state.json", { phase: "APPROVED", updatedAt: "now" });
    writeState("bootstrap-state.json", {
      phase: "ENROLLED_UNASSIGNED",
      deviceRecordId: "dev-9",
      agentVersion: "x",
      identityReady: true,
      networkReady: true,
      updatedAt: "now",
    });
    writeState("pairing-state.json", {
      phase: "PAIRED",
      deviceRecordId: "dev-9",
      updatedAt: "now",
    });
    const snap = readSnapshot(roots);
    expect(snap.deviceRecordId).toBe("dev-9");
    expect(snap.pairing?.phase).toBe("PAIRED");
  });
});

describe("readNetwork", () => {
  it("reports no link and no route on a bare tree", () => {
    expect(readNetwork(roots)).toEqual({ hasLink: false, hasRoute: false });
  });

  it("ignores loopback and needs a real interface up", () => {
    mkdirSync(join(roots.netDir, "lo"), { recursive: true });
    writeFileSync(join(roots.netDir, "lo", "operstate"), "up\n");
    expect(readNetwork(roots).hasLink).toBe(false);
  });

  it("detects a default route from /proc/net/route", () => {
    online();
    expect(readNetwork(roots)).toEqual({ hasLink: true, hasRoute: true });
  });
});
