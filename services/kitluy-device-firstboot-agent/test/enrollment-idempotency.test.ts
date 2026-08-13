/**
 * The agent must not enrol twice.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * `evaluateBootstrap` is called on a 30-second loop. It wrote its result and
 * never read it back, so every wake began from nothing, re-presented a
 * single-use ticket the server had already consumed, and reported the device
 * UNENROLLED. On the first real Raspberry Pi that produced
 * `ENROLLMENT_REDEMPTION_422` twice a minute indefinitely while the fleet held
 * the same device as `enrolled`.
 *
 * The tests below are therefore mostly about the SECOND pass. A single
 * successful enrolment proves very little about a loop.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IDENTITY_FILE_NAME } from "../src/adapters/device-identity-store.js";
import { deviceLabelFromPublicKey, writeBootstrapState } from "../src/bootstrap-state.js";
import { evaluateBootstrap } from "../src/bin/enrollment-bootstrap.js";
import type { EnrollmentClient } from "../src/enrollment.js";

const PUBLIC_KEY_A =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAaaaaaaaaaaaaaaaa\n-----END PUBLIC KEY-----\n";
const PUBLIC_KEY_B =
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAbbbbbbbbbbbbbbbb\n-----END PUBLIC KEY-----\n";

let root: string;
let identityDir: string;
let etcRoot: string;
let statePath: string;
let ticketPath: string;
let procRoot: string;
/** Counts network attempts. The point of the fix is that this stays at 0. */
let enrollCalls: number;

function client(): EnrollmentClient {
  return {
    enroll: () => {
      enrollCalls += 1;
      return Promise.resolve({ kind: "enrolled", deviceRecordId: "dev-from-network" });
    },
    heartbeat: () => Promise.resolve({ kind: "refused", code: "X", retryable: true }),
    pollAssignment: () => Promise.resolve({ kind: "unassigned" }),
  };
}

function writeIdentity(publicKeyPem: string): void {
  mkdirSync(identityDir, { recursive: true });
  writeFileSync(
    join(identityDir, IDENTITY_FILE_NAME),
    JSON.stringify({
      publicKeyPem,
      privateKeyHandle: join(identityDir, "device-key.pem"),
      createdAt: "2026-01-01T00:00:00.000Z",
      hardwareSignals: {},
      complete: true,
    }),
  );
}

/** What a previous successful pass would have left behind. */
function recordEnrolled(publicKeyPem: string, deviceRecordId = "dev-recorded"): void {
  writeBootstrapState(
    {
      phase: "ENROLLED_UNASSIGNED",
      detail: "enrolled",
      identityReady: true,
      networkReady: true,
      agentVersion: "test",
      updatedAt: new Date().toISOString(),
      deviceRecordId,
      deviceLabel: deviceLabelFromPublicKey(publicKeyPem),
    },
    statePath,
  );
}

beforeEach(() => {
  enrollCalls = 0;
  root = mkdtempSync(join(tmpdir(), "kitluy-idem-"));
  identityDir = join(root, "identity");
  etcRoot = join(root, "etc");
  statePath = join(root, "bootstrap-state.json");
  ticketPath = join(root, "ticket");
  procRoot = join(root, "proc");

  mkdirSync(join(etcRoot, "kitluy"), { recursive: true });
  writeFileSync(
    join(etcRoot, "kitluy", "image.env"),
    "KITLUY_ENROLLMENT_BASE_URL=http://fleet.invalid\nKITLUY_DEVICE_CLASS=terminal\n",
  );
  mkdirSync(join(procRoot, "net"), { recursive: true });
  writeFileSync(
    join(procRoot, "net", "route"),
    "Iface\tDestination\tGateway\tFlags\neth0\t00000000\t0102A8C0\t0003\n",
  );
  writeFileSync(ticketPath, "reference=KL-TKT-0001\nsecret=not-a-real-value\n");
  writeIdentity(PUBLIC_KEY_A);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = () =>
  evaluateBootstrap({ identityDir, ticketPath, procRoot, etcRoot, statePath, client: client() });

describe("a device that has already enrolled", () => {
  it("does not contact the fleet again", async () => {
    recordEnrolled(PUBLIC_KEY_A);
    const { result } = await run();

    expect(result.phase).toBe("ENROLLED_UNASSIGNED");
    // The whole point: no request, so no 422, so no twice-a-minute noise.
    expect(enrollCalls).toBe(0);
  });

  it("keeps reporting the device record it was given", async () => {
    recordEnrolled(PUBLIC_KEY_A, "dev-abc123");
    const { state } = await run();
    expect(state.deviceRecordId).toBe("dev-abc123");
  });

  it("stays enrolled across many wakes, contacting nobody", async () => {
    recordEnrolled(PUBLIC_KEY_A);
    for (let i = 0; i < 20; i += 1) {
      const { result } = await run();
      expect(result.phase).toBe("ENROLLED_UNASSIGNED");
    }
    expect(enrollCalls).toBe(0);
  });
});

describe("when the recorded enrolment does not apply", () => {
  it("enrols when there is no recorded state at all", async () => {
    const { result } = await run();
    expect(result.phase).toBe("ENROLLED_UNASSIGNED");
    expect(enrollCalls).toBe(1);
  });

  it("RE-ENROLS when the device re-keyed — a stale file cannot speak for a new identity", async () => {
    // firstboot reported `recreated`: same hardware, different key pair.
    recordEnrolled(PUBLIC_KEY_B);
    const { result } = await run();

    expect(result.phase).toBe("ENROLLED_UNASSIGNED");
    // It went to the network, because the recorded enrolment belongs to a key
    // this device no longer holds.
    expect(enrollCalls).toBe(1);
  });

  it("enrols when the recorded state names no device record", async () => {
    writeBootstrapState(
      {
        phase: "ENROLLED_UNASSIGNED",
        detail: "enrolled, allegedly",
        identityReady: true,
        networkReady: true,
        agentVersion: "test",
        updatedAt: new Date().toISOString(),
        deviceLabel: deviceLabelFromPublicKey(PUBLIC_KEY_A),
      },
      statePath,
    );
    await run();
    // A claim of enrolment with nothing to show for it is not evidence.
    expect(enrollCalls).toBe(1);
  });

  it("enrols when the previous pass ended UNENROLLED", async () => {
    writeBootstrapState(
      {
        phase: "UNENROLLED",
        detail: "refused last time",
        identityReady: true,
        networkReady: true,
        agentVersion: "test",
        updatedAt: new Date().toISOString(),
        deviceRecordId: "dev-should-be-ignored",
        deviceLabel: deviceLabelFromPublicKey(PUBLIC_KEY_A),
      },
      statePath,
    );
    await run();
    expect(enrollCalls).toBe(1);
  });
});

describe("the earlier states still win", () => {
  it("a missing network is reported even when enrolment was recorded", async () => {
    recordEnrolled(PUBLIC_KEY_A);
    const { result } = await evaluateBootstrap({
      identityDir,
      ticketPath,
      etcRoot,
      statePath,
      procRoot: join(root, "no-proc"),
      client: client(),
    });
    // Being enrolled does not make a device online, and the surface must not
    // imply it does.
    expect(result.phase).toBe("NETWORK_WAIT");
  });
});
