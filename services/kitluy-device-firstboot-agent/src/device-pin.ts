/**
 * The device PIN, created at FIRST BOOT and registered with the Store Hub at
 * the first Hub link — T1-FIRST-BOOT-PIN-001 (owner decision 2026-09-18,
 * amending KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10 "after the application
 * installs" → "at first boot, registered to the Hub at pairing").
 *
 * KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001 STANDS: the Store Hub is
 * the verifier (Argon2id on the Hub, attempts and lock on the Hub, "PIN set" a
 * Hub fact). A fresh board has no Hub yet, so the PIN a person creates at first
 * boot must wait somewhere until the link exists. It waits here, SEALED:
 *
 *   - the four digits are encrypted with AES-256-GCM under a key derived (HKDF)
 *     from the device's own identity private key — the one secret the board
 *     already holds, root-only, generated on this board and never exported;
 *   - the sealed file is root 0600 under `/var/lib/kitluy/identity`; the Shell
 *     (an unprivileged user) sends the digits through the root broker and can
 *     never read them back;
 *   - terminal-edge unseals it exactly once, when the Hub answers
 *     `setup_required`, performs the Hub's own setup (twice, as the Hub route
 *     demands), and DELETES the sealed file. From then on the PIN exists only
 *     as the Hub's verifier.
 *
 * What is public — readable by the Shell and the POS — is the POSTURE only:
 * `absent` (a fresh board must create its PIN), `sealed` (created, waiting for
 * the Hub), `registered` (the Hub holds it). Never the digits, never the seal.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { writeDurable } from "./durable-write.js";

export const DEVICE_PIN_SEALED_PATH = "/var/lib/kitluy/identity/device-pin.sealed.json";
export const DEVICE_PIN_POSTURE_PATH = "/var/lib/kitluy/terminal/device-pin.json";
export const DEVICE_IDENTITY_KEY_PATH = "/var/lib/kitluy/identity/device-identity.key.pem";

/** Four digits — the same shape the Hub's `TERMINAL_PIN_PATTERN` accepts. */
export const DEVICE_PIN_PATTERN = /^[0-9]{4}$/u;

const SEAL_VERSION = "kitluy.device-pin.sealed.v1" as const;
const HKDF_INFO = "kitluy-device-pin-seal-v1";

export type DevicePinState = "absent" | "sealed" | "registered";

export interface DevicePinPosture {
  readonly schema: "kitluy.device-pin-posture.v1";
  readonly state: DevicePinState;
  readonly sealedAt: string | null;
  readonly registeredAt: string | null;
}

export type DevicePinRefusal =
  | "PIN_MALFORMED"
  | "PIN_CONFIRMATION_MISMATCH"
  | "PIN_ALREADY_SEALED"
  | "PIN_ALREADY_REGISTERED"
  | "IDENTITY_KEY_UNAVAILABLE";

export interface DevicePinPaths {
  readonly sealed: string;
  readonly posture: string;
  readonly identityKey: string;
}

export const DEFAULT_DEVICE_PIN_PATHS: DevicePinPaths = {
  sealed: DEVICE_PIN_SEALED_PATH,
  posture: DEVICE_PIN_POSTURE_PATH,
  identityKey: DEVICE_IDENTITY_KEY_PATH,
};

interface SealedRecord {
  readonly schema: typeof SEAL_VERSION;
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
  readonly sealedAt: string;
}

/** The public posture. A missing file on a fresh card is `absent`. */
export function readDevicePinPosture(
  paths: DevicePinPaths = DEFAULT_DEVICE_PIN_PATHS,
): DevicePinPosture {
  const absent: DevicePinPosture = {
    schema: "kitluy.device-pin-posture.v1",
    state: "absent",
    sealedAt: null,
    registeredAt: null,
  };
  if (!existsSync(paths.posture)) return absent;
  try {
    const parsed = JSON.parse(readFileSync(paths.posture, "utf8")) as Partial<DevicePinPosture>;
    if (parsed.state !== "sealed" && parsed.state !== "registered") return absent;
    return {
      schema: "kitluy.device-pin-posture.v1",
      state: parsed.state,
      sealedAt: typeof parsed.sealedAt === "string" ? parsed.sealedAt : null,
      registeredAt: typeof parsed.registeredAt === "string" ? parsed.registeredAt : null,
    };
  } catch {
    return absent;
  }
}

function writePosture(paths: DevicePinPaths, posture: DevicePinPosture): void {
  mkdirSync(dirname(paths.posture), { recursive: true });
  // World-readable: the Shell and the POS read it; it carries no secret.
  writeDurable(paths.posture, JSON.stringify(posture, null, 2) + "\n", 0o644);
}

function sealKey(paths: DevicePinPaths, salt: Buffer): Buffer {
  if (!existsSync(paths.identityKey)) {
    throw new Error("IDENTITY_KEY_UNAVAILABLE");
  }
  // The PEM bytes are the input keying material; HKDF makes an independent
  // 256-bit key that says nothing about the signing key it came from.
  const ikm = readFileSync(paths.identityKey);
  return Buffer.from(hkdfSync("sha256", ikm, salt, HKDF_INFO, 32));
}

/**
 * Seal the PIN a person created at first boot. Refuses a malformed or
 * mismatched entry, a second seal while one is waiting, and any seal after the
 * Hub holds the PIN (a change then is the Hub's `change` route, from the POS).
 */
export function sealDevicePin(
  input: { readonly pin: string; readonly pinConfirmation: string },
  paths: DevicePinPaths = DEFAULT_DEVICE_PIN_PATHS,
  now: Date = new Date(),
):
  | { readonly ok: true; readonly posture: DevicePinPosture }
  | { readonly ok: false; readonly code: DevicePinRefusal } {
  if (!DEVICE_PIN_PATTERN.test(input.pin)) return { ok: false, code: "PIN_MALFORMED" };
  if (input.pin !== input.pinConfirmation) return { ok: false, code: "PIN_CONFIRMATION_MISMATCH" };
  const current = readDevicePinPosture(paths);
  if (current.state === "registered") return { ok: false, code: "PIN_ALREADY_REGISTERED" };
  if (current.state === "sealed" && existsSync(paths.sealed)) {
    return { ok: false, code: "PIN_ALREADY_SEALED" };
  }
  const salt = randomBytes(16);
  let key: Buffer;
  try {
    key = sealKey(paths, salt);
  } catch {
    return { ok: false, code: "IDENTITY_KEY_UNAVAILABLE" };
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(input.pin, "utf8"), cipher.final()]);
  const record: SealedRecord = {
    schema: SEAL_VERSION,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    sealedAt: now.toISOString(),
  };
  mkdirSync(dirname(paths.sealed), { recursive: true, mode: 0o700 });
  writeDurable(paths.sealed, JSON.stringify(record) + "\n", 0o600);
  const posture: DevicePinPosture = {
    schema: "kitluy.device-pin-posture.v1",
    state: "sealed",
    sealedAt: record.sealedAt,
    registeredAt: null,
  };
  writePosture(paths, posture);
  return { ok: true, posture };
}

/** Root only. The digits, for the one Hub setup call; null when nothing is sealed. */
export function unsealDevicePin(paths: DevicePinPaths = DEFAULT_DEVICE_PIN_PATHS): string | null {
  if (!existsSync(paths.sealed)) return null;
  try {
    const record = JSON.parse(readFileSync(paths.sealed, "utf8")) as SealedRecord;
    if (record.schema !== SEAL_VERSION) return null;
    const key = sealKey(paths, Buffer.from(record.salt, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "base64"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    const pin = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return DEVICE_PIN_PATTERN.test(pin) ? pin : null;
  } catch {
    return null;
  }
}

/** The Hub holds the PIN now: the seal is destroyed and the posture says so. */
export function markDevicePinRegistered(
  paths: DevicePinPaths = DEFAULT_DEVICE_PIN_PATHS,
  now: Date = new Date(),
): DevicePinPosture {
  const current = readDevicePinPosture(paths);
  if (existsSync(paths.sealed)) unlinkSync(paths.sealed);
  const posture: DevicePinPosture = {
    schema: "kitluy.device-pin-posture.v1",
    state: "registered",
    sealedAt: current.sealedAt,
    registeredAt: now.toISOString(),
  };
  writePosture(paths, posture);
  return posture;
}
