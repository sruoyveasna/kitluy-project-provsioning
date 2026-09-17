/**
 * Boundaries the Pi Terminal composition must keep (T1-STORE-OPERATIONS-001):
 *
 *   - the staff IPC takes a staff id and a passcode and NOTHING else — never a
 *     profile, a scope or a Hub;
 *   - the POS has no path to Supabase or any cloud for normal Store operations
 *     (PROJECT_HOME §3.5, CLAUDE.md hard rule 6): no client, no URL, no key;
 *   - the Pi composition's only transport is the edge bridge socket.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { registerStaffIpc, STAFF_CHANNELS, validateSignIn } from "../electron/staff-ipc.js";

const ACTOR = "e0000000-0000-4000-8000-0000000000aa";

describe("the staff sign-in IPC boundary", () => {
  it("accepts exactly a staff id and a 4-128 character passcode", () => {
    expect(validateSignIn({ actorId: ACTOR, passcode: "1234" })).toEqual({
      actorId: ACTOR,
      passcode: "1234",
    });
  });

  it.each([
    [{ actorId: ACTOR, passcode: "1234", profileCode: "laundry.t2.customer_display" }],
    [{ actorId: ACTOR, passcode: "1234", tenantId: "x" }],
    [{ actorId: "not-a-uuid", passcode: "1234" }],
    [{ actorId: ACTOR, passcode: "123" }],
    [{ actorId: ACTOR, passcode: "x".repeat(129) }],
    [{ actorId: ACTOR, passcode: "12\n34" }],
    [{ actorId: ACTOR }],
    [[ACTOR, "1234"]],
    [null],
  ])("refuses %j", (payload) => {
    expect(validateSignIn(payload)).toBeNull();
  });

  it("returns only a verdict, never a session", async () => {
    const handlers = new Map<string, (e: unknown, p: unknown) => unknown>();
    registerStaffIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        signIn: () =>
          Promise.resolve({ ok: true as const, report: { sessionId: "secret" } } as never),
        signOut: () => Promise.resolve(undefined),
      },
    );
    const answer = await handlers.get(STAFF_CHANNELS.signIn)?.(null, {
      actorId: ACTOR,
      passcode: "1234",
    });
    expect(answer).toEqual({ ok: true });
    const invalid = await handlers.get(STAFF_CHANNELS.signIn)?.(null, { actorId: ACTOR });
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
