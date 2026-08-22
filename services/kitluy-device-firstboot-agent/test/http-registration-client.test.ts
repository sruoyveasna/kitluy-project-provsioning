/**
 * The registration transport, proven against the AUTHORITATIVE verifier.
 *
 * ===========================================================================
 * WHY THIS TEST VERIFIES RATHER THAN ASSERTS A SHAPE
 * ===========================================================================
 * A test that only checked "the body has a signature field" would have passed
 * for every historical way this has gone wrong: camelCase signal names the
 * governed enum refuses, an unnormalised value the server rejects, a signature
 * over the wrong field order. Each of those still produces a well-shaped body.
 *
 * So the request the client builds is handed to
 * `verifyDeviceRegistrationRequest` from `@kitluy/device-identity` — the same
 * function the Edge Function calls through its Deno copy. If the client signs
 * anything other than what the server will verify, this fails here rather than
 * on a Raspberry Pi in a shop.
 */
import { verifyDeviceRegistrationRequest } from "@kitluy/device-identity";
import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  createHttpRegistrationClient,
  fingerprintFromPem,
} from "../src/adapters/http-registration-client.js";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

/** Stands in for the on-device key provider: signs, and cannot return a key. */
const signer = {
  signPayload: (_handle: string, payload: Uint8Array): Promise<Uint8Array> =>
    Promise.resolve(new Uint8Array(sign(null, payload, privateKey))),
};

const URL_UNDER_TEST = "https://example.invalid/functions/v1/device-registration";

const INPUT = {
  publicKeyPem: PUBLIC_PEM,
  hostname: "PI5-ZJJTIR",
  hardwareSignals: {
    boardSerial: "10000000ABCDEF12",
    socSerial: "1f00e4c9d1a2b3c4",
    macAddress: "D8:3A:DD:11:22:33",
    storageSerial: "0x1A2B3C4D",
    storageModel: "SC32G",
  },
  installationId: "11111111-1111-4111-8111-111111111111",
  installationEvidence: { imageRelease: "kitluy-storehub-os-arm64-0.2.0-dev" },
};

/** Captures the outgoing request and answers with whatever the test wants. */
function stubFetch(response: { status: number; body: unknown }): {
  fetchImpl: typeof fetch;
  sent: () => Record<string, unknown>;
} {
  let captured: Record<string, unknown> = {};
  const fetchImpl = ((_url: string, init: RequestInit) => {
    captured = JSON.parse(String(init.body)) as Record<string, unknown>;
    return Promise.resolve({
      status: response.status,
      json: () => Promise.resolve(response.body),
    } as Response);
  }) as unknown as typeof fetch;
  return { fetchImpl, sent: () => captured };
}

function clientFor(response: { status: number; body: unknown }) {
  const { fetchImpl, sent } = stubFetch(response);
  return {
    sent,
    client: createHttpRegistrationClient({
      registrationUrl: URL_UNDER_TEST,
      privateKeyHandle: "handle",
      signer,
      hardwareProfileKey: "CLOUD-HUB-PI5",
      fetchImpl,
    }),
  };
}

const PENDING_BODY = {
  status: "PENDING_APPROVAL",
  deviceId: "22222222-2222-4222-8222-222222222222",
  installationId: "33333333-3333-4333-8333-333333333333",
  installationCreated: true,
};

describe("the request the device puts on the wire", () => {
  it("is a signature the authoritative verifier accepts", async () => {
    const { client, sent } = clientFor({ status: 200, body: PENDING_BODY });
    await client.register(INPUT);
    const body = sent();

    const verdict = verifyDeviceRegistrationRequest(
      {
        assetTag: body["assetTag"] as string,
        hardwareProfileKey: body["hardwareProfileKey"] as string,
        hostname: body["hostname"] as string,
        registrationPublicKeyFingerprint: body["registrationPublicKeyFingerprint"] as string,
        signals: body["signals"] as { signalType: string; signalValue: string }[],
        installationEvidence: body["installationEvidence"] as Record<string, string>,
      },
      body["registrationPublicKeyPem"] as string,
      Buffer.from(body["signature"] as string, "base64"),
    );

    expect(verdict).toEqual({ verified: true, rejection: null });
  });

  it("carries the contract's kind, so the server does not refuse it unparsed", async () => {
    const { client, sent } = clientFor({ status: 200, body: PENDING_BODY });
    await client.register(INPUT);
    expect(sent()["kind"]).toBe("kitluy.device-registration-request.v1");
  });

  it("sends board evidence under the governed snake_case enum names", async () => {
    const { client, sent } = clientFor({ status: 200, body: PENDING_BODY });
    await client.register(INPUT);
    const types = (sent()["signals"] as { signalType: string }[]).map((s) => s.signalType).sort();
    expect(types).toEqual(["board_serial", "mac_address", "soc_serial"]);
  });

  it("normalises every signal value, so the server does not refuse a real serial", async () => {
    const { client, sent } = clientFor({ status: 200, body: PENDING_BODY });
    await client.register(INPUT);
    const signals = sent()["signals"] as { signalValue: string }[];
    for (const signal of signals) {
      expect(signal.signalValue).toBe(signal.signalValue.trim().toLowerCase());
    }
    expect(sent()["hostname"]).toBe("pi5-zjjtir");
  });

  it("puts storage in installation evidence and NEVER in board signals", async () => {
    // Plan §1.4: storage is excluded from board resolution entirely, because a
    // card moved to another board must make a NEW device. If storage ever
    // appears as a board signal, a cloned card starts resolving to the board it
    // was copied from — the exact inversion the identity model forbids.
    const { client, sent } = clientFor({ status: 200, body: PENDING_BODY });
    await client.register(INPUT);
    const types = (sent()["signals"] as { signalType: string }[]).map((s) => s.signalType);
    expect(types).not.toContain("storage_serial");
    expect(types).not.toContain("storage_model");

    const evidence = sent()["installationEvidence"] as Record<string, string>;
    expect(evidence["storageSerial"]).toBe("0x1a2b3c4d");
    expect(evidence["storageModel"]).toBe("sc32g");
    expect(evidence["installationId"]).toBe(INPUT.installationId);
  });

  it("never transmits anything the contract forbids", async () => {
    const { client, sent } = clientFor({ status: 200, body: PENDING_BODY });
    await client.register(INPUT);
    const body = sent();
    for (const forbidden of ["tenantId", "digitalStoreId", "storeLocationId", "lifecycleState"]) {
      expect(body[forbidden]).toBeUndefined();
    }
    expect(JSON.stringify(body)).not.toContain("PRIVATE KEY");
  });

  it("omits a board signal the hardware could not read, rather than sending an empty one", async () => {
    const { client, sent } = clientFor({ status: 200, body: PENDING_BODY });
    await client.register({
      ...INPUT,
      hardwareSignals: { boardSerial: "abc123", macAddress: "" },
    });
    const types = (sent()["signals"] as { signalType: string }[]).map((s) => s.signalType);
    expect(types).toEqual(["board_serial"]);
  });
});

describe("the answers that are not errors", () => {
  it("reads PENDING_APPROVAL as a successful pending result", async () => {
    const { client } = clientFor({ status: 200, body: PENDING_BODY });
    await expect(client.register(INPUT)).resolves.toEqual({
      kind: "pending",
      deviceId: PENDING_BODY.deviceId,
      installationId: PENDING_BODY.installationId,
      installationCreated: true,
    });
  });

  it("reads KNOWN_DEVICE_INSTALLATION_REGISTERED as a known board", async () => {
    const { client } = clientFor({
      status: 200,
      body: {
        ...PENDING_BODY,
        status: "KNOWN_DEVICE_INSTALLATION_REGISTERED",
        installationCreated: false,
      },
    });
    await expect(client.register(INPUT)).resolves.toMatchObject({
      kind: "known",
      installationCreated: false,
    });
  });

  it("reads TRUST_REVIEW_REQUIRED as a result, not a failure, and keeps the reason", async () => {
    const { client } = clientFor({
      status: 200,
      body: {
        status: "TRUST_REVIEW_REQUIRED",
        deviceId: null,
        conflictReason: "KLUY-BOARD-EVIDENCE-AMBIGUOUS",
      },
    });
    await expect(client.register(INPUT)).resolves.toEqual({
      kind: "trust_review",
      deviceId: null,
      conflictReason: "KLUY-BOARD-EVIDENCE-AMBIGUOUS",
    });
  });
});

describe("refusals are reported, never thrown", () => {
  it("treats a 401 bad signature as a decision, not something to retry", async () => {
    const { client } = clientFor({
      status: 401,
      body: { status: "REFUSED", code: "KLUY-REG-BAD-SIGNATURE", detail: null },
    });
    await expect(client.register(INPUT)).resolves.toEqual({
      kind: "refused",
      code: "KLUY-REG-BAD-SIGNATURE",
      retryable: false,
    });
  });

  it("treats a 404 unknown profile as not retryable", async () => {
    const { client } = clientFor({
      status: 404,
      body: { status: "REFUSED", code: "KLUY-REG-UNKNOWN-PROFILE", detail: null },
    });
    await expect(client.register(INPUT)).resolves.toMatchObject({ retryable: false });
  });

  it("treats a 500 as retryable, because a later boot may find the cloud healthy", async () => {
    const { client } = clientFor({
      status: 500,
      body: { status: "REFUSED", code: "KLUY-REG-UPSTREAM", detail: null },
    });
    await expect(client.register(INPUT)).resolves.toMatchObject({
      code: "KLUY-REG-UPSTREAM",
      retryable: true,
    });
  });

  it("reports an unreachable cloud as retryable rather than throwing", async () => {
    const fetchImpl = (() => Promise.reject(new Error("ENOTFOUND"))) as unknown as typeof fetch;
    const client = createHttpRegistrationClient({
      registrationUrl: URL_UNDER_TEST,
      privateKeyHandle: "handle",
      signer,
      hardwareProfileKey: "CLOUD-HUB-PI5",
      fetchImpl,
    });
    await expect(client.register(INPUT)).resolves.toEqual({
      kind: "refused",
      code: "REGISTRATION_UNREACHABLE",
      retryable: true,
    });
  });

  it("refuses a 200 carrying a status this image does not know", async () => {
    // A newer cloud reaching an older image must be visible, not quietly read as
    // pending — an image that guessed would show "waiting for approval" for a
    // state that means something else entirely.
    const { client } = clientFor({ status: 200, body: { status: "SOMETHING_NEWER" } });
    await expect(client.register(INPUT)).resolves.toEqual({
      kind: "refused",
      code: "REGISTRATION_UNKNOWN_STATUS",
      retryable: false,
    });
  });

  it("refuses before the network when a board signal cannot be represented", async () => {
    // A reserved character is refused rather than escaped (contract §5). Caught
    // on the device, this costs no round trip and names the offending field.
    const { client } = clientFor({ status: 200, body: PENDING_BODY });
    await expect(
      client.register({ ...INPUT, hardwareSignals: { boardSerial: "abc=def" } }),
    ).resolves.toEqual({
      kind: "refused",
      code: "REGISTRATION_RESERVED_CHARACTER",
      retryable: false,
    });
  });

  it("refuses when the board reported no usable evidence at all", async () => {
    const { client } = clientFor({ status: 200, body: PENDING_BODY });
    await expect(client.register({ ...INPUT, hardwareSignals: {} })).resolves.toEqual({
      kind: "refused",
      code: "REGISTRATION_NO_SIGNALS",
      retryable: false,
    });
  });
});

describe("the fingerprint the device claims", () => {
  it("is the SHA-256 of its own SPKI DER, so the server's recomputation agrees", async () => {
    const { client, sent } = clientFor({ status: 200, body: PENDING_BODY });
    await client.register(INPUT);
    expect(sent()["registrationPublicKeyFingerprint"]).toBe(fingerprintFromPem(PUBLIC_PEM));
    expect(sent()["registrationPublicKeyFingerprint"]).toMatch(/^[0-9a-f]{64}$/);
  });
});
