/**
 * The device's runtime report bytes must equal the authoritative contract's,
 * and a report this agent collects and signs must pass the registry's own parser
 * and verifier (T1-STORE-OPERATIONS-001; group 0229). The same discipline as
 * `operational-recovery-identity-drift.test.ts`.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEVICE_RUNTIME_REPORT_KIND as AUTHORITATIVE_KIND,
  canonicalJson as authoritativeCanonicalJson,
  deviceRuntimeReportBytes as authoritativeBytes,
  parseDeviceRuntimeReport,
  publicKeyFingerprint,
  verifyDeviceRuntimeReport,
  type DeviceRuntimeReport,
} from "@kitluy/device-identity";

import {
  DEVICE_RUNTIME_REPORT_KIND,
  canonicalJson,
  deviceRuntimeReportBytes,
} from "../src/runtime-report-bytes.js";
import { collectRuntimeReport, signRuntimeReport } from "../src/runtime-report.js";

const DEVICE = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-runtime-drift-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("device copy == authoritative contract", () => {
  it("uses the same domain separator", () => {
    expect(DEVICE_RUNTIME_REPORT_KIND).toBe(AUTHORITATIVE_KIND);
  });

  it("canonicalises identically, including nested key order and arrays", () => {
    const value = { z: [3, { b: 1, a: [null, "x"] }], a: { d: true, c: "é—" }, m: 1.5 };
    expect(canonicalJson(value)).toBe(authoritativeCanonicalJson(value));
  });

  it("builds byte-identical preimages", () => {
    const report = collectRuntimeReport({
      etcRoot: dir,
      edgeStatusPath: join(dir, "absent.json"),
      storeRoot: join(dir, "releases"),
      terminalClientWitnessPath: join(dir, "absent-witness.json"),
      posRuntimePath: join(dir, "absent-pos.json"),
      unitState: () => "inactive",
    });
    const input = {
      identityPublicKeyFingerprint: "a".repeat(64),
      deviceId: DEVICE,
      reportSequence: 1_726_540_800_123,
      observedAt: "2026-09-17T03:00:02.000Z",
    };
    expect(Buffer.from(deviceRuntimeReportBytes({ ...input, report }))).toEqual(
      Buffer.from(
        authoritativeBytes({ ...input, report: report as unknown as DeviceRuntimeReport }),
      ),
    );
  });

  it("a report this agent collects and signs passes the registry's parser and verifier", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const keyPath = join(dir, "device-identity.key.pem");
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    writeFileSync(
      join(dir, "edge-status.json"),
      JSON.stringify({
        phase: "SERVING",
        detail: "connected",
        checkedAt: "2026-09-17T03:00:00.000Z",
        hub: { hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290", host: "h", port: 7443 },
        reads: { authorityTime: "ok", eligibility: "ok", configuration: "ok" },
      }),
    );
    writeFileSync(
      join(dir, "pos-runtime.json"),
      JSON.stringify({
        schema: "kitluy.pos-runtime-status.v1",
        product: "kitluy-terminal",
        applicationVersion: "0.1.0",
        state: "ready",
        refusalCode: null,
        hubDeviceId: "549a41c6-21e9-4838-8b48-34a3878ba290",
        configuration: {
          configurationVersion: 7,
          freshness: "current",
          validUntil: "2026-09-18T00:00:00Z",
        },
        staffSignedIn: true,
        link: "edge_bridge",
        observedAt: "2026-09-17T03:00:01.000Z",
      }),
    );
    const report = collectRuntimeReport({
      etcRoot: dir,
      edgeStatusPath: join(dir, "edge-status.json"),
      storeRoot: join(dir, "releases"),
      terminalClientWitnessPath: join(dir, "absent-witness.json"),
      posRuntimePath: join(dir, "pos-runtime.json"),
      unitState: () => "inactive",
    });
    const parsed = parseDeviceRuntimeReport(report);
    expect(parsed.ok, parsed.ok ? "" : parsed.detail).toBe(true);
    if (!parsed.ok) return;

    const signed = signRuntimeReport({
      deviceId: DEVICE,
      reportSequence: 42,
      observedAt: "2026-09-17T03:00:02.000Z",
      report,
      keyPath,
    });
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(signed.identityPublicKeyPem).toBe(publicKeyPem);
    const verdict = verifyDeviceRuntimeReport({
      identityPublicKeyPem: signed.identityPublicKeyPem,
      deviceId: signed.deviceId,
      reportSequence: signed.reportSequence,
      observedAt: signed.observedAt,
      // What crossed the wire: JSON round-trip, possibly re-ordered.
      report: JSON.parse(JSON.stringify(parsed.value)) as DeviceRuntimeReport,
      signature: Buffer.from(signed.signature, "base64url"),
    });
    expect(verdict).toEqual({
      verified: true,
      identityPublicKeyFingerprint: publicKeyFingerprint(publicKeyPem),
    });
  });
});
