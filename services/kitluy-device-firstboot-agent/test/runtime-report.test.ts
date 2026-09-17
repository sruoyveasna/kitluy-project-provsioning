/**
 * The runtime report COPIES facts; it never infers them (T1-STORE-OPERATIONS-001).
 *
 *   - an installed release is not a running one;
 *   - a running witness for another release is not this release running;
 *   - an edge phase or POS state outside the closed vocabulary is dropped, not
 *     forwarded;
 *   - the sequence always advances, across a wiped /var and a clock step back;
 *   - a Store Hub, an unregistered board, or a board with no registry sends nothing.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EDGE_STATUS_PATH as EDGE_OWNER_PATH } from "../src/edge-session.js";
import { DEVICE_IDENTITY_KEY_PATH as PAIRING_OWNER_PATH } from "../src/edge-pairing.js";
import { activate, commit, releaseDir, storePaths } from "../src/release-store.js";
import {
  DEVICE_IDENTITY_KEY_PATH,
  EDGE_STATUS_PATH,
  collectRuntimeReport,
  nextReportSequence,
  reportRuntimeOnce,
} from "../src/runtime-report.js";

const RELEASE_A = "0b6f3f58-8d5a-4f52-9f59-6d2f8d7f0a11";
const RELEASE_B = "1c7e4f69-9e6b-4a63-8a6a-7e3a9e8a1b22";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-runtime-report-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function install(releaseId: string, version: string): void {
  const paths = storePaths("kitluy-terminal", join(dir, "releases"));
  const payload = join(releaseDir(paths, releaseId), "payload");
  mkdirSync(payload, { recursive: true });
  writeFileSync(join(payload, "package.json"), JSON.stringify({ main: "main.js" }));
  writeFileSync(
    join(releaseDir(paths, releaseId), "manifest.json"),
    JSON.stringify({ manifest: { version } }),
  );
  activate(paths, releaseId);
  commit(paths, releaseId, version);
}

function witness(releaseId: string): string {
  const path = join(dir, "witness.json");
  writeFileSync(
    path,
    JSON.stringify({
      source: "RELEASE",
      product: "kitluy-terminal",
      app: `${join(dir, "releases", "kitluy-terminal", `rel-${releaseId}`)}/payload`,
      at: "2026-09-17T10:00:00+07:00",
    }),
  );
  return path;
}

function collect(overrides: Record<string, unknown> = {}) {
  return collectRuntimeReport({
    etcRoot: dir,
    edgeStatusPath: join(dir, "edge-status.json"),
    storeRoot: join(dir, "releases"),
    terminalClientWitnessPath: join(dir, "witness.json"),
    posRuntimePath: join(dir, "pos.json"),
    unitState: () => "active",
    ...overrides,
  });
}

describe("the constants the report names are the owners' constants", () => {
  it("edge status and identity key paths", () => {
    expect(EDGE_STATUS_PATH).toBe(EDGE_OWNER_PATH);
    expect(DEVICE_IDENTITY_KEY_PATH).toBe(PAIRING_OWNER_PATH);
  });
});

describe("application: installed, running and up are three facts", () => {
  it("nothing installed: IDLE, no release, not running", () => {
    const report = collect({ unitState: () => "inactive" });
    expect(report["application"]).toMatchObject({
      installedReleaseId: null,
      journalPhase: "IDLE",
      runningReleaseId: null,
      unitActive: false,
    });
  });

  it("installed and committed but the launcher has not run it: installed, NOT running", () => {
    install(RELEASE_A, "0.1.0-t1a");
    const report = collect({ unitState: () => "inactive" });
    expect(report["application"]).toMatchObject({
      installedReleaseId: RELEASE_A,
      installedVersion: "0.1.0-t1a",
      journalPhase: "COMMITTED",
      lastOutcome: "INSTALLED",
      runningReleaseId: null,
      unitActive: false,
    });
  });

  it("the launcher's witness names what runs, even when the store has moved on", () => {
    install(RELEASE_A, "0.1.0-t1a");
    witness(RELEASE_A);
    install(RELEASE_B, "0.1.0-t1b");
    const report = collect();
    expect(report["application"]).toMatchObject({
      installedReleaseId: RELEASE_B,
      runningReleaseId: RELEASE_A,
      runningSince: "2026-09-17T10:00:00+07:00",
      unitActive: true,
    });
  });
});

describe("hubLink and pos copy the owners, and drop what is not in the vocabulary", () => {
  it("copies a SERVING edge status", () => {
    writeFileSync(
      join(dir, "edge-status.json"),
      JSON.stringify({
        phase: "SERVING",
        checkedAt: "2026-09-17T03:00:00.000Z",
        hub: { hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290" },
        reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
      }),
    );
    expect(collect()["hubLink"]).toEqual({
      phase: "SERVING",
      hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
      checkedAt: "2026-09-17T03:00:00.000Z",
      reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
      // No PIN read recorded (an older Hub, or not reached): null, never guessed.
      terminalPin: null,
    });
  });

  it("carries the Store Hub's Terminal PIN answer, and nothing else about the PIN", () => {
    writeFileSync(
      join(dir, "edge-status.json"),
      JSON.stringify({
        phase: "SERVING",
        checkedAt: "2026-09-17T03:00:00.000Z",
        hub: { hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290" },
        reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
        terminalPin: {
          state: "set",
          setAt: "2026-09-17T02:58:00.000Z",
          lockedUntil: null,
          pin: "4826",
          verifier: "$argon2id$v=19$m=19456,t=2,p=1$x$y",
        },
      }),
    );
    const hubLink = collect()["hubLink"] as Record<string, unknown>;
    expect(hubLink["terminalPin"]).toEqual({
      state: "set",
      setAt: "2026-09-17T02:58:00.000Z",
      lockedUntil: null,
    });
    expect(JSON.stringify(hubLink)).not.toContain("4826");
    expect(JSON.stringify(hubLink)).not.toContain("argon2id");
  });

  it("an invented PIN state is dropped to null — 'PIN set' is only ever the Hub's word", () => {
    writeFileSync(
      join(dir, "edge-status.json"),
      JSON.stringify({
        phase: "SERVING",
        checkedAt: "2026-09-17T03:00:00.000Z",
        terminalPin: { state: "configured", setAt: null, lockedUntil: null },
      }),
    );
    expect((collect()["hubLink"] as Record<string, unknown>)["terminalPin"]).toBeNull();
  });

  it("an invented edge phase is dropped to null, never forwarded", () => {
    writeFileSync(
      join(dir, "edge-status.json"),
      JSON.stringify({ phase: "CONNECTED", checkedAt: "2026-09-17T03:00:00.000Z" }),
    );
    expect(collect()["hubLink"]).toBeNull();
  });

  it("copies the POS runtime state, but never an identity or a PIN", () => {
    writeFileSync(
      join(dir, "pos.json"),
      JSON.stringify({
        schema: "kitluy.pos-runtime-status.v2",
        applicationVersion: "0.1.0",
        state: "staff_authentication_required",
        refusalCode: null,
        configuration: { configurationVersion: 7, freshness: "current" },
        terminalUnlocked: false,
        staffName: "should never be read",
        pin: "4826",
        observedAt: "2026-09-17T03:00:01.000Z",
      }),
    );
    const pos = collect()["pos"];
    expect(pos).toEqual({
      state: "staff_authentication_required",
      refusalCode: null,
      applicationVersion: "0.1.0",
      configurationVersion: 7,
      configurationFreshness: "current",
      terminalUnlocked: false,
      observedAt: "2026-09-17T03:00:01.000Z",
    });
    expect(JSON.stringify(pos)).not.toContain("should never be read");
    expect(JSON.stringify(pos)).not.toContain("4826");
  });

  it("a v1 POS file (before the Terminal PIN) still reports its unlock flag", () => {
    writeFileSync(
      join(dir, "pos.json"),
      JSON.stringify({
        schema: "kitluy.pos-runtime-status.v1",
        applicationVersion: "0.1.0",
        state: "ready",
        refusalCode: null,
        configuration: { configurationVersion: 7, freshness: "current" },
        staffSignedIn: true,
        observedAt: "2026-09-17T03:00:01.000Z",
      }),
    );
    expect(collect()["pos"]).toMatchObject({ state: "ready", terminalUnlocked: true });
  });

  it("an unknown POS state is dropped to null", () => {
    writeFileSync(
      join(dir, "pos.json"),
      JSON.stringify({
        schema: "kitluy.pos-runtime-status.v1",
        state: "operational",
        observedAt: "2026-09-17T03:00:01.000Z",
      }),
    );
    expect(collect()["pos"]).toBeNull();
  });
});

describe("the sequence always advances", () => {
  it("uses the clock when it is ahead, the last value + 1 when it is not", () => {
    const path = join(dir, "health", "seq");
    expect(nextReportSequence(path, 1_000)).toBe(1_000);
    expect(nextReportSequence(path, 900)).toBe(1_001);
    expect(nextReportSequence(path, 5_000)).toBe(5_000);
    expect(readFileSync(path, "utf8").trim()).toBe("5000");
  });

  it("survives a wiped /var because the clock carries it", () => {
    const path = join(dir, "health", "seq");
    nextReportSequence(path, 10_000);
    rmSync(path);
    expect(nextReportSequence(path, 20_000)).toBeGreaterThan(10_000);
  });
});

describe("who sends nothing", () => {
  function env(lines: string[]): void {
    mkdirSync(join(dir, "kitluy"), { recursive: true });
    writeFileSync(join(dir, "kitluy", "image.env"), `${lines.join("\n")}\n`);
  }
  const post = () => Promise.reject(new Error("must not be called"));

  it("a Store Hub", async () => {
    env(["KITLUY_DEVICE_CLASS=store_hub", "KITLUY_ENROLLMENT_BASE_URL=http://127.0.0.1:1"]);
    expect(await reportRuntimeOnce({ etcRoot: dir, post })).toEqual({
      sent: false,
      reason: "not a Pi Terminal",
    });
  });

  it("a Terminal with no registry configured", async () => {
    env(["KITLUY_DEVICE_CLASS=terminal"]);
    expect(await reportRuntimeOnce({ etcRoot: dir, post })).toMatchObject({ sent: false });
  });

  it("a Terminal the cloud has not issued an id to", async () => {
    env(["KITLUY_DEVICE_CLASS=terminal", "KITLUY_ENROLLMENT_BASE_URL=http://127.0.0.1:1"]);
    expect(
      await reportRuntimeOnce({
        etcRoot: dir,
        registrationStatePath: join(dir, "none.json"),
        post,
      }),
    ).toEqual({ sent: false, reason: "no cloud-issued device id yet" });
  });
});
