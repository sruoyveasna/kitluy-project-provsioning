/**
 * The Partner Portal's pairing logic, tested without a browser or a server.
 *
 * Everything here is a place the screen could LIE to the person holding a code:
 * telling them a dead code is live, showing them a separator they must not type,
 * offering a button that cannot work, or presenting a refusal as data.
 */
import { describe, expect, it } from "vitest";

import {
  classifyPairingResponse,
  createPairingClient,
  type IssuedCode,
} from "../src/pairing-client.js";
import { canIssueFor, codeLife, groupCode } from "../src/pairing-presentation.js";

describe("the countdown tells the truth about the SERVER's deadline", () => {
  const expiry = "2026-08-13T10:15:00.000Z";

  it("counts down in minutes and seconds", () => {
    const life = codeLife(expiry, new Date("2026-08-13T10:03:20.000Z"));
    expect(life.kind).toBe("live");
    if (life.kind !== "live") return;
    expect(life.label).toBe("11:40");
    expect(life.secondsRemaining).toBe(700);
  });

  it("pads the seconds, so 10:05 never reads as 10:5", () => {
    const life = codeLife(expiry, new Date("2026-08-13T10:09:55.000Z"));
    expect(life.kind === "live" && life.label).toBe("5:05");
  });

  it("rounds DOWN, so it never claims more time than remains", () => {
    // 90.9 seconds left must read 1:30, not 1:31.
    const life = codeLife(expiry, new Date("2026-08-13T10:13:29.100Z"));
    expect(life.kind === "live" && life.label).toBe("1:30");
  });

  it("is EXPIRED exactly at the deadline, not a second after", () => {
    expect(codeLife(expiry, new Date(expiry)).kind).toBe("expired");
  });

  it("treats an unparseable expiry as expired, never as live", () => {
    // Failing closed matters here: a code shown as live when the portal cannot
    // tell sends someone to type it and be refused at the Hub.
    expect(codeLife("not a date", new Date()).kind).toBe("expired");
  });
});

describe("the code is displayed as something a person can read aloud", () => {
  it("groups eight characters into two fours", () => {
    expect(groupCode("ABCD8291")).toBe("ABCD 8291");
  });

  it("separates with a SPACE, never a hyphen", () => {
    // `normalize_hub_claim_code_v1` upper-cases and nothing else — it does not
    // strip a hyphen — so a Hub operator who typed one would be refused.
    expect(groupCode("ABCD8291")).not.toContain("-");
  });

  it("leaves anything that is not eight characters alone", () => {
    expect(groupCode("ABC")).toBe("ABC");
    expect(groupCode("")).toBe("");
  });
});

describe("a Store with no Location cannot be paired", () => {
  it("refuses to offer the button", () => {
    // The door would refuse with KLUY-HUBSESSION-SCOPE-UNKNOWN; deciding it here
    // lets the screen explain instead of failing on every press.
    expect(canIssueFor({ locations: [] })).toBe(false);
    expect(canIssueFor({ locations: [{}] })).toBe(true);
  });
});

describe("responses are classified, never assumed", () => {
  it("accepts 201 as the issuance success", () => {
    expect(classifyPairingResponse(201, { code: "ABCD8291" }).kind).toBe("ok");
  });

  it("distinguishes the four failures a Partner must act on differently", () => {
    expect(classifyPairingResponse(401, {}).kind).toBe("unauthenticated");
    expect(classifyPairingResponse(403, {}).kind).toBe("denied");
    expect(classifyPairingResponse(422, {}).kind).toBe("refused");
    expect(classifyPairingResponse(503, {}).kind).toBe("unavailable");
  });

  it("surfaces the governed guidance from a 422 rather than a generic message", () => {
    const outcome = classifyPairingResponse(422, {
      error: { message: "that Store or Location does not exist, or they do not match" },
    });
    expect(outcome.kind === "refused" && outcome.message).toContain("do not match");
  });

  it("treats ANY unrecognised status as unavailable, never as ok", () => {
    for (const status of [204, 302, 418, 500]) {
      expect(classifyPairingResponse(status, {}).kind).toBe("unavailable");
    }
  });
});

describe("the client refuses to act without a session", () => {
  it("makes no request at all when there is no token", async () => {
    let called = false;
    const client = createPairingClient({
      baseUrl: "http://localhost:8787",
      accessToken: async () => null,
      fetchImpl: (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });

    const outcome = await client.issuePairingCode({
      digitalStoreId: "s",
      storeLocationId: "l",
    });

    expect(outcome.kind).toBe("unauthenticated");
    expect(called).toBe(false);
  });

  it("sends the token, the store and the location — and NO device", async () => {
    let seenUrl = "";
    let seenBody: Record<string, unknown> = {};
    let seenAuth = "";
    const client = createPairingClient({
      baseUrl: "http://localhost:8787",
      accessToken: async () => "token-abc",
      fetchImpl: (async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenAuth = String((init.headers as Record<string, string>).Authorization);
        seenBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            code: "ABCD8291",
            sessionId: "sess",
            expiresAt: "2026-08-13T10:15:00.000Z",
            ttlSeconds: 900,
            detail: "…",
          } satisfies IssuedCode),
          { status: 201 },
        );
      }) as unknown as typeof fetch,
    });

    const outcome = await client.issuePairingCode({
      digitalStoreId: "store-1",
      storeLocationId: "loc-1",
    });

    expect(outcome.kind).toBe("ok");
    expect(seenUrl).toBe("http://localhost:8787/management/v1/hub-pairing-codes");
    expect(seenAuth).toBe("Bearer token-abc");
    expect(seenBody).toEqual({ digitalStoreId: "store-1", storeLocationId: "loc-1" });
    // The route refuses unknown fields, and a device has no place in a
    // store-scoped session (KLD-2026-08-13-HUB-PAIRING-SESSION-001).
    expect(seenBody).not.toHaveProperty("deviceRecordId");
  });

  it("does not present a 200 with the wrong shape as an empty Store list", async () => {
    const client = createPairingClient({
      baseUrl: "http://localhost:8787",
      accessToken: async () => "t",
      fetchImpl: (async () =>
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
        })) as unknown as typeof fetch,
    });

    // "You hold no shops" and "the service answered something unusable" are
    // different facts, and only one of them is a reason to call support.
    const outcome = await client.listStores();
    expect(outcome.kind).toBe("unavailable");
  });

  it("reports a network failure as unavailable rather than throwing", async () => {
    const client = createPairingClient({
      baseUrl: "http://localhost:8787",
      accessToken: async () => "t",
      fetchImpl: (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch,
    });

    const outcome = await client.listStores();
    expect(outcome.kind).toBe("unavailable");
  });
});
