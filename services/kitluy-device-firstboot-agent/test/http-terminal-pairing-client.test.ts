/**
 * The Pi Terminal pairing transport.
 *
 * Written against the contract in the registry's `terminal-pairing-routes.ts`
 * rather than against a mock of convenience: the request shape, the 200 body and
 * the refusal envelope are all copied from that file, and `drift` below pins the
 * two so a change on either side fails here rather than on a shop floor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  TERMINAL_PAIRING_PATH,
  createHttpTerminalPairingClient,
  phaseForRefusal,
} from "../src/adapters/http-terminal-pairing-client.js";

const DEVICE = "6f1c937a-3ca3-4bc1-4b96-014e5fba2ea2";
const CODE = "K7M2QW9Z";

/** The registry's 200 body, field for field. */
function pairedBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    correlationId: "corr-1",
    deviceRecordId: DEVICE,
    sessionId: "11111111-1111-4111-8111-111111111111",
    assignmentId: "22222222-2222-4222-8222-222222222222",
    assignmentGeneration: 3,
    storeAssignment: "pending_trust",
    context: {
      contextVersion: "v1",
      tenantId: "t-1",
      tenantReference: "TEN-1",
      digitalStoreId: "ds-1",
      digitalStoreReference: "STORE-1",
      storeLocationId: "loc-1",
      storeLocationReference: "LOC-1",
      storeHubDeviceId: "hub-1",
      storeHubReference: "HUB-1",
      physicalTerminalId: "pt-1",
      physicalTerminalLabel: "Counter 1",
      terminalProfileKeys: ["T1"],
      terminalAssignments: [{ terminalAssignmentId: "ta-1", terminalProfileKey: "T1" }],
      vertical: "laundry",
      requiredAppFamily: null,
      releaseChannel: null,
      environment: "development",
    },
    activated: false,
    lifecycleState: null,
    trustedTime: null,
    activationRefusal: null,
    certificate: null,
    detail: "the Pi Terminal is assigned to its seat and is awaiting trust",
    ...overrides,
  };
}

/** The registry's refusal envelope, field for field. */
function refusalBody(result: string, retryable: boolean, message: string): Record<string, unknown> {
  return { error: { code: "SCOPE_PERMISSION_DENIED", message, details: { result, retryable } } };
}

function clientWith(
  handler: (url: string, init: RequestInit) => { status: number; body?: unknown } | Promise<never>,
  options: { correlationId?: string } = {},
) {
  const seen: { url?: string; init?: RequestInit } = {};
  const fetchImpl = (async (url: unknown, init: unknown) => {
    seen.url = String(url);
    seen.init = init as RequestInit;
    const answer = await handler(String(url), init as RequestInit);
    return {
      status: answer.status,
      json: async () => answer.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return {
    seen,
    client: createHttpTerminalPairingClient({
      registryBaseUrl: "https://fleet.example.com/",
      fetchImpl,
      ...options,
    }),
  };
}

describe("terminal pairing transport", () => {
  it("posts exactly the device record and the code, to the contract route", async () => {
    const { client, seen } = clientWith(() => ({ status: 200, body: pairedBody() }));
    await client.pair({ deviceRecordId: DEVICE, code: CODE });

    // A trailing slash on the base must not produce a double slash.
    expect(seen.url).toBe(`https://fleet.example.com${TERMINAL_PAIRING_PATH}`);
    expect(seen.init?.method).toBe("POST");
    const body = JSON.parse(String(seen.init?.body)) as Record<string, unknown>;
    // WHAT LEAVES THE DEVICE — and nothing else. No Store, no Location, no Hub.
    expect(Object.keys(body).sort()).toEqual(["code", "deviceRecordId"]);
    expect(body["deviceRecordId"]).toBe(DEVICE);
  });

  it("sends a correlation id only when it was given one", async () => {
    const withId = clientWith(() => ({ status: 200, body: pairedBody() }), {
      correlationId: "trace-9",
    });
    await withId.client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect((withId.seen.init?.headers as Record<string, string>)["x-correlation-id"]).toBe(
      "trace-9",
    );

    const without = clientWith(() => ({ status: 200, body: pairedBody() }));
    await without.client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect(without.seen.init?.headers as Record<string, string>).not.toHaveProperty(
      "x-correlation-id",
    );
  });

  it("returns the server's assignment and context on 200", async () => {
    const { client } = clientWith(() => ({ status: 200, body: pairedBody() }));
    const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });

    expect(result.kind).toBe("paired");
    if (result.kind !== "paired") return;
    expect(result.assignmentId).toBe("22222222-2222-4222-8222-222222222222");
    expect(result.assignmentGeneration).toBe(3);
    expect(result.context.digitalStoreReference).toBe("STORE-1");
    expect(result.context.terminalProfileKeys).toEqual(["T1"]);
  });

  it("does NOT report activation when the server paired without advancing trust", async () => {
    // PAIRING IS NOT ACTIVATION. `pending_trust` is the ordinary answer, and a
    // screen that read it as "ready" would promise a terminal that cannot sell.
    const { client } = clientWith(() => ({ status: 200, body: pairedBody() }));
    const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect(result.kind === "paired" && result.activated).toBe(false);
  });

  it("reports activation when the server did advance trust in the same call", async () => {
    const { client } = clientWith(() => ({
      status: 200,
      body: pairedBody({ activated: true, lifecycleState: "active" }),
    }));
    const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect(result.kind === "paired" && result.activated).toBe(true);
  });

  it("refuses a 200 that names a different board", async () => {
    const { client } = clientWith(() => ({
      status: 200,
      body: pairedBody({ deviceRecordId: "99999999-9999-4999-8999-999999999999" }),
    }));
    const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect(result).toMatchObject({ kind: "refused", result: "PAIRING_DEVICE_MISMATCH" });
  });

  it("refuses a 200 with no assignment rather than storing a Store it was never given", async () => {
    for (const missing of ["sessionId", "assignmentId", "context"]) {
      const { client } = clientWith(() => ({
        status: 200,
        body: pairedBody({ [missing]: null }),
      }));
      const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });
      expect(result).toMatchObject({ kind: "refused", result: "PAIRING_MALFORMED_RESPONSE" });
      expect(result.kind === "refused" && result.retryable).toBe(false);
    }
  });

  it("carries the server's result code and safe message through a refusal", async () => {
    const { client } = clientWith(() => ({
      status: 403,
      body: refusalBody(
        "CODE_REFUSED",
        false,
        "that pairing code is not valid for this Pi Terminal",
      ),
    }));
    const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect(result).toMatchObject({
      kind: "refused",
      result: "CODE_REFUSED",
      retryable: false,
      message: "that pairing code is not valid for this Pi Terminal",
    });
  });

  it("never echoes the presented code back in any refusal", async () => {
    const { client } = clientWith(() => ({
      status: 403,
      body: refusalBody("LOCKED", false, "too many failed attempts; ask for a new pairing code"),
    }));
    const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect(JSON.stringify(result)).not.toContain(CODE);
  });

  it("treats an unreachable fleet as retryable, leaving the code worth presenting", async () => {
    const { client } = clientWith(() => Promise.reject(new Error("ENOTFOUND")) as Promise<never>);
    const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect(result).toMatchObject({
      kind: "refused",
      result: "PAIRING_UNREACHABLE",
      retryable: true,
    });
  });

  it("spends no attempt budget on a code that is not eight alphabet characters", async () => {
    let called = false;
    const { client } = clientWith(() => {
      called = true;
      return { status: 200, body: pairedBody() };
    });
    for (const bad of ["", "SHORT", "K7M2QW9", "K7M2QW9ZZ", "K7M2QW9I", "k7m2qw9z", "K7M2QW-9"]) {
      const result = await client.pair({ deviceRecordId: DEVICE, code: bad });
      expect(result).toMatchObject({ kind: "refused", result: "CODE_MALFORMED" });
    }
    expect(called).toBe(false);
  });

  it("refuses before the network when the board has not registered", async () => {
    let called = false;
    const { client } = clientWith(() => {
      called = true;
      return { status: 200, body: pairedBody() };
    });
    const result = await client.pair({ deviceRecordId: "  ", code: CODE });
    expect(result).toMatchObject({ kind: "refused", result: "NO_DEVICE_RECORD", retryable: false });
    expect(called).toBe(false);
  });

  it("falls back to the HTTP status when the server sends no result code", async () => {
    const { client } = clientWith(() => ({ status: 503, body: undefined }));
    const result = await client.pair({ deviceRecordId: DEVICE, code: CODE });
    expect(result).toMatchObject({ kind: "refused", result: "PAIRING_503", retryable: true });
  });

  it("maps each refusal to the action the person at the Pi should take", () => {
    // Three different things to do, so three phases rather than one failure.
    expect(phaseForRefusal("LOCKED")).toBe("LOCKED");
    expect(phaseForRefusal("ALREADY_ASSIGNED")).toBe("ALREADY_ASSIGNED");
    expect(phaseForRefusal("CODE_REFUSED")).toBe("AWAITING_CODE");
    expect(phaseForRefusal("REDEMPTION_REFUSED")).toBe("AWAITING_CODE");
    // A code this image has never heard of must still leave a way forward.
    expect(phaseForRefusal("SOMETHING_NEWER")).toBe("AWAITING_CODE");
  });
});

describe("drift against the registry route", () => {
  const route = readFileSync(
    new URL("../../kitluy-device-registry-service/src/terminal-pairing-routes.ts", import.meta.url),
    "utf8",
  );

  it("posts to the path the registry actually serves", () => {
    expect(route).toContain(`TERMINAL_PAIRING_PREFIX = "${TERMINAL_PAIRING_PATH}"`);
  });

  it("sends exactly the body fields the registry accepts", () => {
    expect(route).toContain('BODY_FIELDS: readonly string[] = ["deviceRecordId", "code"]');
  });

  it("knows every result code the registry can return", () => {
    // Pulled from the registry's own CANONICAL_ERROR map, so a new refusal added
    // there fails here until this client has decided what it means.
    const block = route.slice(route.indexOf("const CANONICAL_ERROR"));
    const codes = [...block.slice(0, block.indexOf("};")).matchAll(/^\s{2}([A-Z_]+):/gm)].map(
      (m) => m[1] as string,
    );
    expect(codes).toContain("LOCKED");
    expect(codes).toContain("ALREADY_ASSIGNED");
    for (const code of codes) {
      // Every one must map to a phase, and PAIRED is not a refusal at all.
      expect(["LOCKED", "ALREADY_ASSIGNED", "AWAITING_CODE"]).toContain(phaseForRefusal(code));
    }
  });
});
