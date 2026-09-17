/**
 * The device runtime report contract (T1-STORE-OPERATIONS-001, group 0229;
 * v2 TERMINAL-PIN-AND-REAL-POS-AUTH-001, group 0230).
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  deviceRuntimeReportBytes,
  parseDeviceRuntimeReport,
  publicKeyFingerprint,
  verifyDeviceRuntimeReport,
  type DeviceRuntimeReport,
  type DeviceRuntimeReportV1,
  type DeviceRuntimeReportV2,
} from "../src/index.js";

const DEVICE = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const RELEASE = "0b6f3f58-8d5a-4f52-9f59-6d2f8d7f0a11";

const REPORT: DeviceRuntimeReportV2 = {
  schema: "kitluy.device-runtime-report.v2",
  deviceClass: "terminal",
  imageVersion: "0.2.0-dev",
  agentVersion: "0.1.0",
  hubLink: {
    phase: "SERVING",
    hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
    checkedAt: "2026-09-17T03:00:00.000Z",
    reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
    terminalPin: { state: "set", setAt: "2026-09-17T02:58:00.000Z", lockedUntil: null },
  },
  application: {
    product: "kitluy-terminal",
    installedReleaseId: RELEASE,
    installedVersion: "0.1.0-t1a",
    journalPhase: "COMMITTED",
    lastOutcome: "INSTALLED",
    lastReason: null,
    runningReleaseId: RELEASE,
    runningSince: "2026-09-17T02:59:00+07:00",
    unitActive: true,
  },
  pos: {
    state: "ready",
    refusalCode: null,
    applicationVersion: "0.1.0",
    configurationVersion: 7,
    configurationFreshness: "current",
    terminalUnlocked: true,
    observedAt: "2026-09-17T03:00:01.000Z",
  },
};

/** A report from a terminal in the field before v2: still accepted. */
const REPORT_V1: DeviceRuntimeReportV1 = {
  schema: "kitluy.device-runtime-report.v1",
  deviceClass: "terminal",
  imageVersion: REPORT.imageVersion,
  agentVersion: REPORT.agentVersion,
  hubLink: {
    phase: "SERVING",
    hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
    checkedAt: "2026-09-17T03:00:00.000Z",
    reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
  },
  application: REPORT.application,
  pos: {
    state: "ready",
    refusalCode: null,
    applicationVersion: "0.1.0",
    configurationVersion: 7,
    configurationFreshness: "current",
    staffSignedIn: true,
    observedAt: "2026-09-17T03:00:01.000Z",
  },
};

function signed(report: DeviceRuntimeReport, sequence = 1_726_540_800_000) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const observedAt = "2026-09-17T03:00:02.000Z";
  const bytes = deviceRuntimeReportBytes({
    identityPublicKeyFingerprint: publicKeyFingerprint(publicKeyPem),
    deviceId: DEVICE,
    reportSequence: sequence,
    observedAt,
    report,
  });
  return {
    publicKeyPem,
    observedAt,
    sequence,
    signature: sign(null, Buffer.from(bytes), privateKey),
  };
}

describe("the closed report shape", () => {
  it("accepts a complete v2 report, and the minimal one", () => {
    expect(parseDeviceRuntimeReport(REPORT).ok).toBe(true);
    expect(
      parseDeviceRuntimeReport({ ...REPORT, hubLink: null, application: null, pos: null }).ok,
    ).toBe(true);
    // A Hub that has not answered the PIN read (an older Store Hub image).
    expect(
      parseDeviceRuntimeReport({ ...REPORT, hubLink: { ...REPORT.hubLink, terminalPin: null } }).ok,
    ).toBe(true);
  });

  it("still accepts a v1 report from a terminal in the field", () => {
    expect(parseDeviceRuntimeReport(REPORT_V1).ok).toBe(true);
  });

  it.each([
    ["a v1 body labelled v2", { ...REPORT_V1, schema: "kitluy.device-runtime-report.v2" }],
    ["a v2 body labelled v1", { ...REPORT, schema: "kitluy.device-runtime-report.v1" }],
    ["an unknown kind", { ...REPORT, schema: "kitluy.device-runtime-report.v3" }],
    [
      "a PIN travelling in the PIN evidence",
      {
        ...REPORT,
        hubLink: {
          ...REPORT.hubLink,
          terminalPin: { ...REPORT.hubLink!.terminalPin, pin: "1234" },
        },
      },
    ],
    [
      "a verifier travelling in the PIN evidence",
      {
        ...REPORT,
        hubLink: {
          ...REPORT.hubLink,
          terminalPin: { ...REPORT.hubLink!.terminalPin, verifier: "$argon2id$v=19$x" },
        },
      },
    ],
    [
      "an invented PIN state",
      {
        ...REPORT,
        hubLink: {
          ...REPORT.hubLink,
          terminalPin: { ...REPORT.hubLink!.terminalPin, state: "configured" },
        },
      },
    ],
    [
      "a PIN lock instant that is not an instant",
      {
        ...REPORT,
        hubLink: {
          ...REPORT.hubLink,
          terminalPin: { ...REPORT.hubLink!.terminalPin, lockedUntil: "soon" },
        },
      },
    ],
    ["a staff flag in a v2 report", { ...REPORT, pos: { ...REPORT.pos, staffSignedIn: true } }],
  ])("refuses %s", (_name, value) => {
    expect(parseDeviceRuntimeReport(value).ok).toBe(false);
  });

  it.each([
    ["an unknown top-level field", { ...REPORT, customerName: "x" }],
    ["an unknown nested field", { ...REPORT, pos: { ...REPORT.pos, staffName: "Sokha" } }],
    ["a missing field", (({ agentVersion: _a, ...rest }) => rest)(REPORT)],
    ["a Store Hub class", { ...REPORT, deviceClass: "store_hub" }],
    [
      "another product",
      { ...REPORT, application: { ...REPORT.application, product: "device-shell" } },
    ],
    ["an invented edge phase", { ...REPORT, hubLink: { ...REPORT.hubLink, phase: "CONNECTED" } }],
    ["an invented POS state", { ...REPORT, pos: { ...REPORT.pos, state: "operational" } }],
    [
      "a free-text refusal code",
      { ...REPORT, pos: { ...REPORT.pos, refusalCode: "call 012 345" } },
    ],
    [
      "an over-long reason",
      { ...REPORT, application: { ...REPORT.application, lastReason: "x".repeat(161) } },
    ],
    ["a control character", { ...REPORT, agentVersion: "0.1\n0" }],
    [
      "a non-uuid release id",
      { ...REPORT, application: { ...REPORT.application, installedReleaseId: "../x" } },
    ],
  ])("refuses %s", (_name, value) => {
    expect(parseDeviceRuntimeReport(value).ok).toBe(false);
  });
});

describe("the signature binds every field", () => {
  it("canonical JSON ignores key order", () => {
    const reordered = JSON.parse(JSON.stringify({ pos: REPORT.pos, ...REPORT })) as unknown;
    expect(canonicalJson(reordered)).toBe(canonicalJson(REPORT));
  });

  it("verifies a genuine report and names the key", () => {
    const s = signed(REPORT);
    const verdict = verifyDeviceRuntimeReport({
      identityPublicKeyPem: s.publicKeyPem,
      deviceId: DEVICE,
      reportSequence: s.sequence,
      observedAt: s.observedAt,
      report: REPORT,
      signature: s.signature,
    });
    expect(verdict).toEqual({
      verified: true,
      identityPublicKeyFingerprint: publicKeyFingerprint(s.publicKeyPem),
    });
  });

  it.each([
    [
      "a report changed after signing",
      {
        report: {
          ...REPORT,
          pos: { ...REPORT.pos!, state: "ready" as const, terminalUnlocked: false },
        },
      },
    ],
    [
      "PIN evidence changed after signing",
      {
        report: {
          ...REPORT,
          hubLink: {
            ...REPORT.hubLink!,
            terminalPin: { state: "reset_required" as const, setAt: null, lockedUntil: null },
          },
        },
      },
    ],
    ["another device id", { deviceId: "00000000-0000-4000-8000-000000000001" }],
    ["a replayed sequence", { reportSequence: 1 }],
    ["another observation instant", { observedAt: "2026-09-17T03:00:03.000Z" }],
  ])("refuses %s", (_name, change) => {
    const s = signed(REPORT);
    const verdict = verifyDeviceRuntimeReport({
      identityPublicKeyPem: s.publicKeyPem,
      deviceId: DEVICE,
      reportSequence: s.sequence,
      observedAt: s.observedAt,
      report: REPORT,
      signature: s.signature,
      ...change,
    });
    expect(verdict.verified).toBe(false);
  });

  it("binds the kind: a v1 report verifies under v1, and the same signature never under another kind", () => {
    const s = signed(REPORT_V1);
    const base = {
      identityPublicKeyPem: s.publicKeyPem,
      deviceId: DEVICE,
      reportSequence: s.sequence,
      observedAt: s.observedAt,
      signature: s.signature,
    };
    expect(verifyDeviceRuntimeReport({ ...base, report: REPORT_V1 }).verified).toBe(true);
    const relabelled = { ...REPORT_V1, schema: "kitluy.device-runtime-report.v2" } as unknown;
    expect(
      verifyDeviceRuntimeReport({ ...base, report: relabelled as DeviceRuntimeReport }).verified,
    ).toBe(false);
  });

  it("refuses a non-Ed25519 identity key", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const verdict = verifyDeviceRuntimeReport({
      identityPublicKeyPem: rsa.publicKey.export({ type: "spki", format: "pem" }).toString(),
      deviceId: DEVICE,
      reportSequence: 1,
      observedAt: "2026-09-17T03:00:02.000Z",
      report: REPORT,
      signature: new Uint8Array(64),
    });
    expect(verdict).toMatchObject({ verified: false });
  });
});
