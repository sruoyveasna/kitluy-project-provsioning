/**
 * T1-FIRST-BOOT-PIN-001 — the first-boot device PIN: sealed under the device's
 * identity key, public posture only, registered with the Hub once, then gone.
 */
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseRequest, serve, VERBS } from "../src/device-config.js";
import {
  markDevicePinRegistered,
  readDevicePinPosture,
  sealDevicePin,
  unsealDevicePin,
  type DevicePinPaths,
} from "../src/device-pin.js";

function paths(): DevicePinPaths {
  const dir = mkdtempSync(join(tmpdir(), "kitluy-device-pin-"));
  return {
    sealed: join(dir, "identity", "device-pin.sealed.json"),
    posture: join(dir, "terminal", "device-pin.json"),
    identityKey: join(dir, "identity", "device-identity.key.pem"),
  };
}

/** A board with its own identity key, as firstboot leaves it (root 0600). */
function withIdentity(p: DevicePinPaths): DevicePinPaths {
  const { privateKey } = generateKeyPairSync("ed25519");
  mkdirSync(dirname(p.identityKey), { recursive: true, mode: 0o700 });
  writeFileSync(p.identityKey, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });
  return p;
}

describe("the first-boot device PIN", () => {
  it("is absent on a fresh card, sealed after creation, and the seal reveals nothing", () => {
    const p = withIdentity(paths());
    expect(readDevicePinPosture(p).state).toBe("absent");
    const sealed = sealDevicePin(
      { pin: "4812", pinConfirmation: "4812" },
      p,
      new Date("2026-09-18T10:00:00Z"),
    );
    expect(sealed.ok).toBe(true);
    expect(readDevicePinPosture(p)).toEqual({
      schema: "kitluy.device-pin-posture.v1",
      state: "sealed",
      sealedAt: "2026-09-18T10:00:00.000Z",
      registeredAt: null,
    });
    const raw = readFileSync(p.sealed, "utf8");
    expect(raw).not.toContain("4812");
    expect(JSON.parse(raw).schema).toBe("kitluy.device-pin.sealed.v1");
    expect(statSync(p.sealed).mode & 0o777).toBe(0o600);
    expect(statSync(p.posture).mode & 0o777).toBe(0o644);
    // Root unseals the same digits; another board's identity cannot.
    expect(unsealDevicePin(p)).toBe("4812");
    const other = withIdentity(paths());
    expect(unsealDevicePin({ ...p, identityKey: other.identityKey })).toBeNull();
  });

  it("refuses a malformed or mismatched entry, a second seal, and a seal after registration", () => {
    const p = withIdentity(paths());
    expect(sealDevicePin({ pin: "12a4", pinConfirmation: "12a4" }, p)).toEqual({
      ok: false,
      code: "PIN_MALFORMED",
    });
    expect(sealDevicePin({ pin: "1234", pinConfirmation: "1243" }, p)).toEqual({
      ok: false,
      code: "PIN_CONFIRMATION_MISMATCH",
    });
    expect(readDevicePinPosture(p).state).toBe("absent");
    expect(sealDevicePin({ pin: "1234", pinConfirmation: "1234" }, p).ok).toBe(true);
    expect(sealDevicePin({ pin: "9999", pinConfirmation: "9999" }, p)).toEqual({
      ok: false,
      code: "PIN_ALREADY_SEALED",
    });
    markDevicePinRegistered(p, new Date("2026-09-18T11:00:00Z"));
    expect(existsSync(p.sealed)).toBe(false);
    expect(unsealDevicePin(p)).toBeNull();
    expect(readDevicePinPosture(p)).toMatchObject({
      state: "registered",
      registeredAt: "2026-09-18T11:00:00.000Z",
    });
    expect(sealDevicePin({ pin: "9999", pinConfirmation: "9999" }, p)).toEqual({
      ok: false,
      code: "PIN_ALREADY_REGISTERED",
    });
  });

  it("cannot be sealed before the board has an identity", () => {
    const p = paths();
    expect(sealDevicePin({ pin: "1234", pinConfirmation: "1234" }, p)).toEqual({
      ok: false,
      code: "IDENTITY_KEY_UNAVAILABLE",
    });
    expect(readDevicePinPosture(p).state).toBe("absent");
  });
});

describe("the broker verbs", () => {
  it("declares pin.status and pin.setup, shape-checks the digits, and never echoes them", async () => {
    expect(VERBS).toContain("pin.status");
    expect(VERBS).toContain("pin.setup");
    const bad = parseRequest(
      JSON.stringify({ verb: "pin.setup", pin: "12345", pinConfirmation: "12345" }),
    );
    expect(bad).toEqual({
      ok: false,
      code: "PIN_MALFORMED",
      message: "A device PIN is exactly four digits.",
    });
    const mismatch = await serve(
      JSON.stringify({ verb: "pin.setup", pin: "1234", pinConfirmation: "4321" }),
      {
        pinSetup: () => ({ ok: false, code: "PIN_CONFIRMATION_MISMATCH" }),
      },
    );
    expect(mismatch).toEqual({
      ok: false,
      code: "PIN_CONFIRMATION_MISMATCH",
      message: "The two entries differ. Try again.",
    });
    expect(JSON.stringify(mismatch)).not.toMatch(/1234|4321/u);
    const ok = await serve(
      JSON.stringify({ verb: "pin.setup", pin: "1234", pinConfirmation: "1234" }),
      {
        pinSetup: () => ({
          ok: true,
          posture: {
            schema: "kitluy.device-pin-posture.v1",
            state: "sealed",
            sealedAt: "x",
            registeredAt: null,
          },
        }),
      },
    );
    expect(ok).toMatchObject({ ok: true, data: { state: "sealed" } });
    const status = await serve(JSON.stringify({ verb: "pin.status" }), {
      pinStatus: () => ({
        schema: "kitluy.device-pin-posture.v1",
        state: "absent",
        sealedAt: null,
        registeredAt: null,
      }),
    });
    expect(status).toMatchObject({ ok: true, data: { state: "absent" } });
    let checked = 0;
    const check = await serve(JSON.stringify({ verb: "update.check" }), {
      checkForUpdates: async () => {
        checked += 1;
      },
    });
    expect(check).toEqual({ ok: true, data: { checking: true } });
    expect(checked).toBe(1);
  });
});
