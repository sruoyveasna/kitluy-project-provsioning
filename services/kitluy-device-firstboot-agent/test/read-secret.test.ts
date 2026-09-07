/**
 * `readSecret` — the function that leaked the shop's Wi-Fi password.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * There was no test for `readSecret`. The UI suite injects a fake `secret()`
 * and never runs it, so the real function shipped with a defect an independent
 * reviewer found in minutes: it attached a raw `data` listener while the pairing
 * console's long-lived `readline` interface was still on the same stdin. readline
 * echoes in terminal mode, so the console printed
 *
 *     Password: S3cretPass
 *     **********
 *
 * — the passphrase in cleartext on a wall-mounted screen, directly beneath the
 * asterisks that were supposed to hide it, in a file whose own header claimed
 * the opposite.
 *
 * The lesson is not "add a test for the echo". It is that a mocked boundary
 * proves nothing about the thing it replaces. This file drives the real
 * function against a real duplex stream.
 */
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { assertStdinIsFree, readSecret } from "../src/bin/hub-pairing-ui.js";

/** Stand in for `process.stdin`/`process.stdout` without a pty. */
function fakeConsole(options: { isTTY?: boolean } = {}) {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  Object.defineProperty(input, "isTTY", { value: options.isTTY ?? true, configurable: true });
  Object.defineProperty(input, "isRaw", { value: false, writable: true, configurable: true });
  (input as unknown as { setRawMode: (v: boolean) => void }).setRawMode = () => undefined;

  const written: string[] = [];
  const stdin = vi.spyOn(process, "stdin", "get").mockReturnValue(input);
  const stdout = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  return {
    input,
    written,
    output: (): string => written.join(""),
    restore: (): void => {
      stdin.mockRestore();
      stdout.mockRestore();
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("the secret never reaches the screen", () => {
  it("echoes one asterisk per character and never the character", async () => {
    const c = fakeConsole();
    const promise = readSecret("  Password: ");
    c.input.push(Buffer.from("S3cretPass\r"));
    const value = await promise;
    c.restore();

    expect(value).toBe("S3cretPass");
    const text = c.output();
    // THE REGRESSION. Nothing typed may appear in what was written.
    expect(text).not.toContain("S3cretPass");
    expect(text).not.toContain("S3cret");
    expect(text).toContain("**********");
  });

  it("REFUSES to prompt while another reader owns stdin", async () => {
    const c = fakeConsole();
    // Exactly the condition that caused the leak: something else is listening,
    // so it will echo whatever is typed no matter what this function does.
    c.input.on("data", () => undefined);
    expect(() => readSecret("  Password: ")).toThrow(/KLUY-CONSOLE-STDIN-BUSY/);
    c.restore();
  });

  it("assertStdinIsFree accepts a stream nobody is reading", () => {
    const c = fakeConsole();
    expect(() => assertStdinIsFree(c.input)).not.toThrow();
    c.restore();
  });
});

describe("what the installer actually types", () => {
  it("decodes UTF-8 rather than one character per byte", async () => {
    const c = fakeConsole();
    const promise = readSecret("  Password: ");
    // 9 characters, 11 bytes. Decoded per byte this became mojibake, produced
    // the WRONG derived key, and the console blamed the installer.
    c.input.push(Buffer.from("pässwörd1\r", "utf8"));
    const value = await promise;
    c.restore();

    expect(value).toBe("pässwörd1");
    expect(value.length).toBe(9);
    // One asterisk per CHARACTER, not per byte.
    expect(c.output().match(/\*/g)).toHaveLength(9);
  });

  it("swallows an arrow key instead of appending it to the secret", async () => {
    const c = fakeConsole();
    const promise = readSecret("  Password: ");
    // ESC [ A. The first version dropped only the ESC and kept `[` and `A`.
    c.input.push(Buffer.from("abc[Adef\r"));
    const value = await promise;
    c.restore();
    expect(value).toBe("abcdef");
  });

  it("backspace removes a whole character, not one byte of it", async () => {
    const c = fakeConsole();
    const promise = readSecret("  Password: ");
    c.input.push(Buffer.from("paßx\r", "utf8"));
    const value = await promise;
    c.restore();
    // `ß` is two bytes; popping one would leave a broken sequence.
    expect(value).toBe("px");
  });

  it("settles instead of hanging when stdin closes", async () => {
    const c = fakeConsole();
    const promise = readSecret("  Password: ");
    // A unit started with stdin from /dev/null, or Ctrl-D. Without an `end`
    // handler the pairing console waited on this promise for ever.
    c.input.push(Buffer.from("partial"));
    (c.input as unknown as PassThrough).end();
    await expect(promise).resolves.toBe("");
    c.restore();
  });

  it("accepts a bare newline as the end of input", async () => {
    const c = fakeConsole();
    const promise = readSecret("  Password: ");
    c.input.push(Buffer.from("shop-secret\n"));
    await expect(promise).resolves.toBe("shop-secret");
    c.restore();
  });
});
