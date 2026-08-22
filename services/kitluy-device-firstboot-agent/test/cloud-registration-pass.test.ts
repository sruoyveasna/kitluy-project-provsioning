/**
 * One boot-time registration pass, end to end on a fake device.
 *
 * ===========================================================================
 * WHAT THIS COVERS THAT THE TRANSPORT TESTS DO NOT
 * ===========================================================================
 * `http-registration-client.test.ts` proves the request is correct once someone
 * calls it with the right arguments. This proves the AGENT assembles those
 * arguments from a real identity on disk, a real image.env, and a real
 * installation file — the wiring that decides whether a flashed Pi does anything
 * at all. Every defect this project has recorded on the device side lived here,
 * in the wiring, not in the transport: a unit mounted by nothing, a config
 * variable no build wrote, a signal vocabulary the server refused.
 *
 * Nothing here opens a socket: `fetch` is injected.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FileIdentityStore } from "../src/adapters/device-identity-store.js";
import { FileKeyProvider } from "../src/adapters/device-key-provider.js";
import { runRegistrationPass } from "../src/bin/cloud-registration.js";

const roots: string[] = [];

function makeDevice(options: { readonly imageEnv: string; readonly withIdentity?: boolean }): {
  identityDir: string;
  etcRoot: string;
  statePath: string;
  installationPath: string;
} {
  const root = mkdtempSync(join(tmpdir(), "kitluy-reg-"));
  roots.push(root);

  const etcRoot = join(root, "etc");
  mkdirSync(join(etcRoot, "kitluy"), { recursive: true });
  writeFileSync(join(etcRoot, "kitluy", "image.env"), options.imageEnv);

  const identityDir = join(root, "var", "lib", "kitluy", "identity");
  mkdirSync(identityDir, { recursive: true });

  return {
    identityDir,
    etcRoot,
    statePath: join(root, "var", "lib", "kitluy", "registration-state.json"),
    installationPath: join(root, "var", "lib", "kitluy", "installation.json"),
  };
}

/** Seeds a complete identity exactly as firstboot would leave one. */
async function seedIdentity(identityDir: string): Promise<void> {
  const keys = new FileKeyProvider({ directory: identityDir });
  const { publicKeyPem, privateKeyHandle } = await keys.generateKeyPair();
  await new FileIdentityStore({ directory: identityDir }).write({
    publicKeyPem,
    privateKeyHandle,
    hardwareSignals: {},
    createdAt: new Date().toISOString(),
    complete: true,
  });
}

const CONFIGURED_ENV = [
  "KITLUY_REGISTRATION_URL=https://example.invalid/functions/v1/device-registration",
  "KITLUY_HARDWARE_PROFILE_KEY=CLOUD-HUB-PI5",
  "KITLUY_IMAGE_VERSION=0.2.0-dev",
  "",
].join("\n");

function answering(status: number, body: unknown): typeof fetch {
  return ((..._args: unknown[]) =>
    Promise.resolve({
      status,
      json: () => Promise.resolve(body),
    } as Response)) as unknown as typeof fetch;
}

const PENDING = {
  status: "PENDING_APPROVAL",
  deviceId: "22222222-2222-4222-8222-222222222222",
  installationId: "33333333-3333-4333-8333-333333333333",
  installationCreated: true,
};

afterEach(() => {
  // Temp roots are left for the OS to reap; nothing here writes outside tmpdir.
  roots.length = 0;
});

describe("a configured device with an identity", () => {
  it("registers and records WAITING FOR APPROVAL as a healthy state", async () => {
    const device = makeDevice({ imageEnv: CONFIGURED_ENV });
    await seedIdentity(device.identityDir);

    const state = await runRegistrationPass({
      ...device,
      fetchImpl: answering(200, PENDING),
    });

    expect(state.phase).toBe("AWAITING_APPROVAL");
    expect(state.deviceId).toBe(PENDING.deviceId);
    expect(state.installationId).toBe(PENDING.installationId);
    // Persisted, not merely returned: the console reads the file, and a pass
    // that only returned its result would leave a blank screen.
    expect(JSON.parse(readFileSync(device.statePath, "utf8")).phase).toBe("AWAITING_APPROVAL");
  });

  it("creates an installation id once and reuses it on the next pass", async () => {
    const device = makeDevice({ imageEnv: CONFIGURED_ENV });
    await seedIdentity(device.identityDir);

    await runRegistrationPass({ ...device, fetchImpl: answering(200, PENDING) });
    const first = JSON.parse(readFileSync(device.installationPath, "utf8")).installationId;

    await runRegistrationPass({ ...device, fetchImpl: answering(200, PENDING) });
    const second = JSON.parse(readFileSync(device.installationPath, "utf8")).installationId;

    // A pass that minted a new id per wake would register a new installation
    // every sixty seconds and fill the fleet with generations of one device.
    expect(second).toBe(first);
  });

  it("records the image release it was flashed from", async () => {
    const device = makeDevice({ imageEnv: CONFIGURED_ENV });
    await seedIdentity(device.identityDir);
    await runRegistrationPass({ ...device, fetchImpl: answering(200, PENDING) });

    expect(JSON.parse(readFileSync(device.installationPath, "utf8")).imageRelease).toBe(
      "0.2.0-dev",
    );
  });

  it("reports an approved board as APPROVED, without claiming it is provisioned", async () => {
    const device = makeDevice({ imageEnv: CONFIGURED_ENV });
    await seedIdentity(device.identityDir);

    const state = await runRegistrationPass({
      ...device,
      fetchImpl: answering(200, {
        ...PENDING,
        status: "KNOWN_DEVICE_INSTALLATION_REGISTERED",
        installationCreated: false,
      }),
    });

    expect(state.phase).toBe("APPROVED");
    expect(state.detail).toContain("provisioning is a separate step");
  });

  it("separates containment from trust review, because waiting only helps one of them", async () => {
    const device = makeDevice({ imageEnv: CONFIGURED_ENV });
    await seedIdentity(device.identityDir);

    const review = await runRegistrationPass({
      ...device,
      fetchImpl: answering(200, {
        status: "TRUST_REVIEW_REQUIRED",
        deviceId: null,
        conflictReason: "KLUY-BOARD-EVIDENCE-AMBIGUOUS",
      }),
    });
    expect(review.phase).toBe("TRUST_REVIEW_REQUIRED");

    const contained = await runRegistrationPass({
      ...device,
      fetchImpl: answering(200, {
        status: "TRUST_REVIEW_REQUIRED",
        deviceId: PENDING.deviceId,
        conflictReason: "KLUY-DEVICE-CONTAINED-QUARANTINED",
      }),
    });
    expect(contained.phase).toBe("CONTAINED");
    expect(contained.conflictReason).toBe("KLUY-DEVICE-CONTAINED-QUARANTINED");
  });

  it("reports an unreachable cloud as NO CONNECTION, not as a refusal", async () => {
    const device = makeDevice({ imageEnv: CONFIGURED_ENV });
    await seedIdentity(device.identityDir);

    const state = await runRegistrationPass({
      ...device,
      fetchImpl: (() => Promise.reject(new Error("ENETUNREACH"))) as unknown as typeof fetch,
    });

    // A Store network that is still coming up must not read as "KitLuy refused
    // this device" — the fleet has said nothing about it at all.
    expect(state.phase).toBe("UNREACHABLE");
  });
});

describe("a device that cannot register yet says so plainly", () => {
  it("refuses when the image baked no registration URL", async () => {
    const device = makeDevice({ imageEnv: "KITLUY_HARDWARE_PROFILE_KEY=CLOUD-HUB-PI5\n" });
    await seedIdentity(device.identityDir);

    const state = await runRegistrationPass({ ...device, fetchImpl: answering(200, PENDING) });

    expect(state.phase).toBe("NOT_REGISTERED");
    // Names the cause as a BUILD decision. The rootfs is read-only, so an
    // operator needs to know a rebuild is required, not that the network failed.
    expect(state.detail).toContain("KITLUY_REGISTRATION_URL");
    expect(existsSync(device.installationPath)).toBe(false);
  });

  it("refuses when the image baked no hardware profile key", async () => {
    const device = makeDevice({
      imageEnv: "KITLUY_REGISTRATION_URL=https://example.invalid/x\n",
    });
    await seedIdentity(device.identityDir);

    const state = await runRegistrationPass({ ...device, fetchImpl: answering(200, PENDING) });
    expect(state.phase).toBe("NOT_REGISTERED");
    expect(state.detail).toContain("KITLUY_HARDWARE_PROFILE_KEY");
  });

  it("waits for firstboot rather than minting its own identity", async () => {
    const device = makeDevice({ imageEnv: CONFIGURED_ENV });
    // No identity seeded: firstboot has not run.
    const state = await runRegistrationPass({ ...device, fetchImpl: answering(200, PENDING) });

    expect(state.phase).toBe("NOT_REGISTERED");
    expect(state.detail).toContain("kitluy-firstboot.service");
    // A registration agent that created a key here would race firstboot and the
    // device could end up with two identities, only one of which is recorded.
    expect(existsSync(join(device.identityDir, "identity.json"))).toBe(false);
  });
});
