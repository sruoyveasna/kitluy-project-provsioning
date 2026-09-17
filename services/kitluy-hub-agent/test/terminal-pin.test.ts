/**
 * The Terminal PIN verifier, without a database
 * (KLD-2026-09-03-TERMINAL-PROVISIONING-001 §12: the raw PIN is never stored;
 * the Hub keeps a strong salted Argon2id verifier).
 */
import { describe, expect, it } from "vitest";

import {
  TERMINAL_PIN_ARGON2,
  TERMINAL_PIN_PATTERN,
  terminalPinVerifier,
  verifyTerminalPin,
} from "../src/hub/edge/terminal-pin.js";

describe("the Terminal PIN verifier", () => {
  it("is an Argon2id PHC string with the recorded cost profile, never the PIN", async () => {
    const verifier = await terminalPinVerifier("4826");
    const parts = verifier.split("$");
    expect(parts.slice(0, 4)).toEqual([
      "",
      "argon2id",
      "v=19",
      `m=${String(TERMINAL_PIN_ARGON2.memorySize)},t=${String(TERMINAL_PIN_ARGON2.iterations)},p=${String(TERMINAL_PIN_ARGON2.parallelism)}`,
    ]);
    // 16-byte salt and 32-byte hash, unpadded base64.
    expect(Buffer.from(parts[4] ?? "", "base64")).toHaveLength(16);
    expect(Buffer.from(parts[5] ?? "", "base64")).toHaveLength(32);
    expect(parts.slice(4)).not.toContain("4826");
  });

  it("salts every verifier freshly: the same PIN twice gives two different verifiers", async () => {
    const [a, b] = await Promise.all([terminalPinVerifier("4826"), terminalPinVerifier("4826")]);
    expect(a).not.toBe(b);
    expect(await verifyTerminalPin("4826", a)).toBe(true);
    expect(await verifyTerminalPin("4826", b)).toBe(true);
  });

  it("verifies only the exact PIN", async () => {
    const verifier = await terminalPinVerifier("0070");
    expect(await verifyTerminalPin("0070", verifier)).toBe(true);
    for (const wrong of ["0071", "7000", "070", "00700", "0O70", ""]) {
      expect(await verifyTerminalPin(wrong, verifier)).toBe(false);
    }
  });

  it("refuses to hash anything but four digits, and a malformed verifier never verifies", async () => {
    for (const bad of ["123", "12345", "12a4", " 1234", "١٢٣٤"]) {
      expect(TERMINAL_PIN_PATTERN.test(bad)).toBe(false);
      await expect(terminalPinVerifier(bad)).rejects.toThrow(/KLUY-TERMINAL-PIN-FORMAT/);
    }
    expect(await verifyTerminalPin("1234", "1234")).toBe(false);
    expect(await verifyTerminalPin("1234", "$argon2i$v=19$m=19456,t=2,p=1$AAAA$BBBB")).toBe(false);
    expect(await verifyTerminalPin("1234", "")).toBe(false);
  });
});
