/**
 * THE TEST THAT WAS MISSING.
 *
 * Every U1 suite drove `runInstallPass` directly, so all of them passed against
 * an agent whose `main()` loop only reported status and never installed
 * anything. The engine was tested and the ignition was not.
 *
 * These assert the composition itself: that the device's own state is what
 * configures the install pass, and that a board which cannot yet update says
 * exactly why.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acceptanceFromImage,
  composeInstallDependencies,
  DEVICE_SHELL_UNIT,
} from "../src/release-runtime.js";

let root: string;
let etcRoot: string;
let trustDir: string;
let statePath: string;

const FINGERPRINT = "1054dd1ccc8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef01";
const DEVICE_ID = "050f9ea4-4478-48f3-8061-b30fdea04b9b";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "kt-runtime-"));
  etcRoot = join(root, "etc");
  trustDir = join(etcRoot, "kitluy", "trust");
  mkdirSync(trustDir, { recursive: true });
  statePath = join(root, "registration-state.json");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function imageEnv(overrides: Record<string, string> = {}): void {
  const values = {
    KITLUY_ENVIRONMENT: "development",
    KITLUY_HARDWARE_PROFILE_KEY: "KL-PI5-TERMINAL-DEV",
    KITLUY_RELEASE_CHANNEL: "internal",
    KITLUY_IMAGE_SCHEMA_VERSION: "1",
    ...overrides,
  };
  writeFileSync(
    join(etcRoot, "kitluy", "image.env"),
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
  );
}

function anchor(environment = "development"): void {
  const { publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(
    join(trustDir, "release-signing.json"),
    JSON.stringify({
      kind: "kitluy.release-trust-key.v1",
      keyId: "dev-release-signing",
      keyVersion: 1,
      algorithm: "ed25519",
      purpose: "release_signing",
      environment,
      productionEligible: false,
      state: "current",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }),
  );
}

function registered(extra: Record<string, unknown> = {}): void {
  writeFileSync(
    statePath,
    JSON.stringify({
      phase: "APPROVED",
      deviceId: DEVICE_ID,
      keyFingerprint: FINGERPRINT,
      updatedAt: new Date().toISOString(),
      ...extra,
    }),
  );
}

function compose() {
  return composeInstallDependencies({
    baseUrl: "http://172.16.21.17:8790",
    etcRoot,
    trustDir,
    storeRoot: join(root, "releases"),
    registrationStatePath: statePath,
  });
}

describe("the composition an installing agent needs", () => {
  it("assembles every dependency when the device is ready", () => {
    imageEnv();
    anchor();
    registered();

    const result = compose();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The device names ITSELF — a transport cannot choose which board it is.
    expect(result.deps.deviceId).toBe(DEVICE_ID);
    expect(result.deps.assignments.describe()).toBe("http://172.16.21.17:8790");
    expect(result.deps.trustedKeys).toHaveLength(1);
    expect(result.deps.unit).toBeDefined();
    expect(result.deps.health).toBeDefined();
  });

  it("derives the acceptance context from the IMAGE, not from the source", () => {
    imageEnv({ KITLUY_HARDWARE_PROFILE_KEY: "KL-PI5-TERMINAL-DEV" });
    anchor();
    registered();

    const result = compose();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deps.acceptance).toMatchObject({
      productKey: "device-shell",
      architecture: "arm64",
      hardwareProfile: "KL-PI5-TERMINAL-DEV",
      environment: "development",
      eligibleChannels: ["internal"],
      schemaVersion: 1,
    });
  });

  /**
   * THE DEVICE MUST NAME ITSELF BY THE CLOUD'S IDENTIFIER, NOT A DERIVED ONE.
   *
   * This shipped wrong and cost a hardware run. The composition passed
   * `assetTagFromFingerprint(keyFingerprint)`. Registration contract §9 says the
   * server never renames a board it already knows, so after a re-flash the board
   * holds a NEW key while the cloud keeps the ORIGINAL tag — the derived name
   * stops matching, the authority answers 404, and the agent reports "no release
   * is assigned to this device" on every poll, for ever.
   *
   * The whole suite passed against the broken code, because nothing exercised a
   * device whose cloud id and local derivation disagree. So this test watches
   * the REQUEST: the fixture's fingerprint derives a tag that is deliberately
   * not the device id, and a return to the old behaviour cannot pass.
   */
  it("addresses the authority by the cloud-issued device id, never a derived tag", async () => {
    imageEnv();
    anchor();
    registered();

    const asked: string[] = [];
    const server = createServer((request, response) => {
      asked.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ assignment: null }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const result = composeInstallDependencies({
        baseUrl: `http://127.0.0.1:${String(port)}`,
        etcRoot,
        trustDir,
        storeRoot: join(root, "releases"),
        registrationStatePath: statePath,
      });
      if (!result.ok) throw new Error(`expected ok, got ${result.refusal}`);
      await result.deps.assignments.fetchAssignment();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(encodeURIComponent(DEVICE_ID));
    // The derived tag must not appear — and the two must genuinely differ, so
    // the assertion above has teeth.
    const derived = `KL-${FINGERPRINT.slice(0, 12).toUpperCase()}`;
    expect(derived).not.toBe(DEVICE_ID);
    expect(asked[0]).not.toContain(derived);
  });


  it("targets the Device Shell unit and nothing else", () => {
    expect(DEVICE_SHELL_UNIT).toBe("kitluy-device-shell.service");
  });
});

describe("a board that cannot update says exactly why", () => {
  it("refuses with NO_TRUST_ANCHOR when the registry is empty", () => {
    imageEnv();
    registered();
    expect(compose()).toMatchObject({ ok: false, refusal: "NO_TRUST_ANCHOR" });
  });

  it("refuses with NO_TRUST_ANCHOR when every record was rejected, and names them", () => {
    imageEnv();
    anchor("pilot"); // a pilot anchor on a development device
    registered();
    const result = compose();
    expect(result).toMatchObject({ ok: false, refusal: "NO_TRUST_ANCHOR" });
    if (!result.ok) expect(result.detail).toContain("TRUST_RECORD_WRONG_ENVIRONMENT");
  });

  it("refuses with NOT_REGISTERED before the board has registered", () => {
    imageEnv();
    anchor();
    expect(compose()).toMatchObject({ ok: false, refusal: "NOT_REGISTERED" });
  });

  it("refuses with NO_DEVICE_IDENTITY while registration is still pending", () => {
    imageEnv();
    anchor();
    // Registered but not yet approved: no server-side device id, so nothing can
    // bind an assignment to this board.
    writeFileSync(
      statePath,
      JSON.stringify({ phase: "AWAITING_APPROVAL", keyFingerprint: FINGERPRINT, updatedAt: "x" }),
    );
    expect(compose()).toMatchObject({ ok: false, refusal: "NO_DEVICE_IDENTITY" });
  });

  it("refuses when the image states no environment", () => {
    imageEnv({ KITLUY_ENVIRONMENT: "" });
    anchor();
    registered();
    expect(compose()).toMatchObject({ ok: false, refusal: "IMAGE_STATES_NO_ENVIRONMENT" });
  });

  it("refuses when the image states no hardware profile", () => {
    imageEnv({ KITLUY_HARDWARE_PROFILE_KEY: "" });
    anchor();
    registered();
    expect(compose()).toMatchObject({ ok: false, refusal: "IMAGE_STATES_NO_HARDWARE_PROFILE" });
  });
});

describe("acceptanceFromImage", () => {
  it("returns null when the image is silent about what it is", () => {
    imageEnv({ KITLUY_ENVIRONMENT: "", KITLUY_HARDWARE_PROFILE_KEY: "" });
    expect(acceptanceFromImage(etcRoot)).toBeNull();
  });

  it("defaults the channel to internal rather than guessing wider", () => {
    imageEnv({ KITLUY_RELEASE_CHANNEL: "" });
    expect(acceptanceFromImage(etcRoot)?.eligibleChannels).toEqual(["internal"]);
  });
});

/**
 * THE GATE AGAINST THIS EXACT CLASS OF GAP.
 *
 * Reading the shipped entrypoint rather than mocking it, because the defect was
 * that `main()` never called the installer — a fact no behavioural test noticed,
 * since every test called `runInstallPass` itself. This asserts the wiring
 * exists in the file that actually runs on the device.
 */
describe("the entrypoint reaches the installer", () => {
  const entrypoint = readFileSync(
    new URL("../src/bin/update-bootstrap.ts", import.meta.url),
    "utf8",
  );

  it("imports the install pass", () => {
    expect(entrypoint).toContain('from "../release-install.js"');
    expect(entrypoint).toContain("runInstallPass");
  });

  it("imports the composition", () => {
    expect(entrypoint).toContain("composeInstallDependencies");
  });

  it("the poll loop calls runOnce, not merely reportOnce", () => {
    const loop = entrypoint.slice(entrypoint.indexOf("export async function main"));
    expect(loop).toContain("await runOnce()");
    // The regression, named: a loop that only reports is the bug this catches.
    expect(loop).not.toMatch(/for \(;;\) \{\s*try \{\s*reportOnce\(\);/u);
  });

  it("runOnce actually invokes the install pass", () => {
    const body = entrypoint.slice(
      entrypoint.indexOf("export async function runOnce"),
      entrypoint.indexOf("export async function main"),
    );
    expect(body).toContain("composeInstallDependencies(");
    expect(body).toContain("await runInstallPass(");
  });
});
