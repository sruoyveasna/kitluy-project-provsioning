/**
 * Boundaries the Pi Terminal composition must keep (T1-STORE-OPERATIONS-001;
 * TERMINAL-PIN-AND-REAL-POS-AUTH-001):
 *
 *   - the PIN IPC takes four-digit PINs and NOTHING else — never a profile, a
 *     scope, a Hub, an actor, an email or a password;
 *   - no staff sign-in, email or password path exists on the Pi at all;
 *   - the POS has no path to Supabase or any cloud for normal Store operations
 *     (PROJECT_HOME §3.5, CLAUDE.md hard rule 6): no client, no URL, no key;
 *   - the Pi composition's only transport is the edge bridge socket.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PIN_CHANNELS,
  registerPinIpc,
  validateChange,
  validateSetup,
  validateUnlock,
} from "../electron/pin-ipc.js";

describe("the Terminal PIN IPC boundary", () => {
  it("accepts exactly four-digit PINs in the named fields", () => {
    expect(validateSetup({ pin: "1234", pinConfirmation: "1234" })).toEqual({
      pin: "1234",
      pinConfirmation: "1234",
    });
    expect(validateUnlock({ pin: "0000" })).toEqual({ pin: "0000" });
    expect(
      validateChange({ currentPin: "1234", newPin: "5678", newPinConfirmation: "5678" }),
    ).toEqual({
      currentPin: "1234",
      newPin: "5678",
      newPinConfirmation: "5678",
    });
  });

  it.each([
    [{ pin: "123" }],
    [{ pin: "12345" }],
    [{ pin: "12a4" }],
    [{ pin: " 1234" }],
    [{ pin: "12\n34" }],
    [{ pin: 1234 }],
    [{ pin: "1234", actorId: "e0000000-0000-4000-8000-0000000000aa" }],
    [{ pin: "1234", email: "cashier@shop.com", password: "x" }],
    [{ pin: "1234", profileCode: "laundry.t2.customer_display" }],
    [{ pin: "1234", tenantId: "x" }],
    [{}],
    [["1234"]],
    [null],
  ])("unlock refuses %j", (payload) => {
    expect(validateUnlock(payload)).toBeNull();
  });

  it("setup and change refuse a missing or extra field", () => {
    expect(validateSetup({ pin: "1234" })).toBeNull();
    expect(validateSetup({ pin: "1234", pinConfirmation: "1234", staffId: "x" })).toBeNull();
    expect(validateChange({ currentPin: "1234", newPin: "5678" })).toBeNull();
  });

  it("returns only a verdict and the public PIN posture, never a session or a PIN", async () => {
    const handlers = new Map<string, (e: unknown, p: unknown) => unknown>();
    registerPinIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        setupPin: () =>
          Promise.resolve({ ok: true as const, report: { sessionId: "secret" } } as never),
        unlock: () =>
          Promise.resolve({
            ok: false as const,
            code: "PIN_INCORRECT",
            detail: "no",
            pin: { state: "set" as const, lockedUntil: null, attemptsBeforeLock: 4 },
          }),
        changePin: () => Promise.resolve({ ok: true as const }),
        lock: () => Promise.resolve(undefined),
      },
    );
    const established = await handlers.get(PIN_CHANNELS.setup)?.(null, {
      pin: "1234",
      pinConfirmation: "1234",
    });
    expect(established).toEqual({ ok: true });
    const wrong = await handlers.get(PIN_CHANNELS.unlock)?.(null, { pin: "1234" });
    expect(wrong).toEqual({
      ok: false,
      code: "PIN_INCORRECT",
      detail: "no",
      pin: { state: "set", lockedUntil: null, attemptsBeforeLock: 4 },
    });
    expect(JSON.stringify(wrong)).not.toContain("1234");
    const invalid = await handlers.get(PIN_CHANNELS.unlock)?.(null, { pin: "123" });
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|cts)$/u.test(name) ? [path] : [];
  });
}

describe("no cloud path for Store operations", () => {
  const root = new URL("..", import.meta.url).pathname;
  const files = [...sources(join(root, "electron")), ...sources(join(root, "src"))];

  it("scans the whole application", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("the Pi path has no staff sign-in, no email and no password", () => {
    const pi = [
      "electron/main.ts",
      "electron/pi-runtime.ts",
      "electron/pin-ipc.ts",
      "electron/terminal-pin-client.ts",
      "electron/preload.cts",
      "src/App.tsx",
      "src/pin-screen.tsx",
      "src/terminal-launcher.tsx",
      // The ported Laundry T1 face (T1-FACE-PORT-001): the donor's staff login
      // did not come with it.
      "src/vertical/laundry/face/index.tsx",
      "src/vertical/laundry/face/ports.ts",
      "src/vertical/laundry/face/features/t1-pos/T1POS.tsx",
      "src/vertical/laundry/face/features/t1-pos/laundry-savor/LaundryTopBar.tsx",
      "src/vertical/laundry/face/features/t1-pos/new-order/Step0Customer.tsx",
      "src/vertical/laundry/face/features/t1-pos/new-order/Step3Review.tsx",
    ].map((file) =>
      // Code, not comments: the comments SAY there is no such thing.
      readFileSync(join(root, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//gu, "")
        .replace(/^\s*\/\/.*$/gmu, ""),
    );
    for (const source of pi) {
      expect(source).not.toMatch(
        /signInWithPassword|signInWithOtp|type="password"|\bpassword\b|\bemail\b|sessions\/open|kitluyT1Staff|staff:sign-in/u,
      );
    }
    expect(files.map((f) => f.split("/").pop())).not.toContain("staff-sign-in.tsx");
  });

  it.each([
    ["a Supabase client", /@supabase\/|createClient\(/u],
    ["a Supabase URL", /supabase\.co|\/rest\/v1|\/functions\/v1/u],
    ["a service-role key", /service_role|SUPABASE_SERVICE_ROLE/u],
    ["the cloud management or registry APIs", /management\/v1|:8787|:8790|:8791/u],
  ])("contains no %s", (_name, pattern) => {
    const hits = files.filter((file) => pattern.test(readFileSync(file, "utf8")));
    expect(hits).toEqual([]);
  });

  it("the Pi composition reaches the Hub only through the edge bridge socket", () => {
    const pi = readFileSync(join(root, "electron", "pi-runtime.ts"), "utf8");
    expect(pi).toContain("bridgeCall(options.socketPath)");
    expect(pi).not.toMatch(/node:https|node:tls|pinnedHubRequest|keyPem|certificatePem/u);
    const client = readFileSync(join(root, "electron", "edge-bridge-client.ts"), "utf8");
    expect(client).toContain("socketPath");
    expect(client).not.toMatch(/node:https|node:tls|hostname:/u);
  });
});
