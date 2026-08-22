/**
 * The two canonicalizers must agree, byte for byte.
 *
 * ===========================================================================
 * WHY THIS SUITE IS THE POINT OF THE COPY
 * ===========================================================================
 * `supabase/functions/_shared/device-registration-canonical.ts` is a hand copy of
 * this package's canonical form, because an Edge Function runs on Deno and cannot
 * import a pnpm workspace package. A copy is only defensible if drift is
 * detectable — otherwise the day they diverge, every device silently fails to
 * register and the cause is invisible on both sides of the wire.
 *
 * So this suite imports BOTH implementations and asserts they produce identical
 * bytes, identical fingerprints and identical verdicts. The two use different
 * primitives on purpose — `node:crypto` here, WebCrypto there — which is exactly
 * the kind of difference that could quietly change a digest.
 */
import { generateKeyPairSync, sign as nodeSign, webcrypto } from "node:crypto";

import { describe, expect, it } from "vitest";

// Deno exposes `crypto` as a global; this vitest environment does not. Supplied
// here rather than by softening the shared file, because that file must keep
// using the API it will actually run against — a Node-flavoured fallback inside
// it would mean the copy under test is not the copy that gets deployed.
if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

import {
  DEVICE_REGISTRATION_REQUEST_KIND,
  type DeviceRegistrationRequest,
  canonicalInstallationEvidence,
  canonicalSignals,
  deviceRegistrationRequestBytes,
  validateDeviceRegistrationRequest,
  verifyDeviceRegistrationRequest,
} from "../src/device-registration-request.js";
import * as deno from "../../../supabase/functions/_shared/device-registration-canonical.ts";

const request: DeviceRegistrationRequest = {
  assetTag: "KL-PI5-9F2C41A8",
  hardwareProfileKey: "KL-PI5-STORE-HUB-DEV",
  hostname: "pi5-zjjtir",
  registrationPublicKeyFingerprint: "a".repeat(64),
  signals: [
    { signalType: "soc_serial", signalValue: "1f00e4c9d1a2b3c4" },
    { signalType: "board_serial", signalValue: "10000000abcdef12" },
    { signalType: "mac_address", signalValue: "d8:3a:dd:11:22:33" },
  ],
  installationEvidence: {
    storageSerial: "0x1a2b3c4d",
    imageRelease: "kitluy-storehub-os-arm64-2026.08.17-dev",
    storageModel: "sc32g",
  },
};

describe("the Node and Deno canonicalizers agree", () => {
  it("uses the same domain separator", () => {
    expect(deno.DEVICE_REGISTRATION_REQUEST_KIND).toBe(DEVICE_REGISTRATION_REQUEST_KIND);
  });

  it("produces identical canonical bytes", () => {
    expect(deno.deviceRegistrationRequestBytes(request)).toEqual(
      deviceRegistrationRequestBytes(request),
    );
  });

  it("sorts signals identically, whatever order they arrive in", () => {
    const shuffled: DeviceRegistrationRequest = {
      ...request,
      signals: [...request.signals].reverse(),
    };
    // Order-independence is a property of the canonical form, not an accident of
    // how the device happened to enumerate its hardware.
    expect(canonicalSignals(shuffled.signals)).toBe(canonicalSignals(request.signals));
    expect(deno.canonicalSignals(shuffled.signals)).toBe(canonicalSignals(request.signals));
    expect(deviceRegistrationRequestBytes(shuffled)).toEqual(
      deviceRegistrationRequestBytes(request),
    );
  });

  it("sorts installation evidence by key identically", () => {
    const reordered: DeviceRegistrationRequest = {
      ...request,
      installationEvidence: {
        storageModel: "sc32g",
        storageSerial: "0x1a2b3c4d",
        imageRelease: "kitluy-storehub-os-arm64-2026.08.17-dev",
      },
    };
    expect(canonicalInstallationEvidence(reordered.installationEvidence)).toBe(
      canonicalInstallationEvidence(request.installationEvidence),
    );
    expect(deno.canonicalInstallationEvidence(reordered.installationEvidence)).toBe(
      canonicalInstallationEvidence(request.installationEvidence),
    );
  });

  it("agrees on the canonical rendering itself", () => {
    // Pinned literally, so a change to the format is a change to this test and
    // therefore a deliberate act. Both implementations are checked against the
    // same literal rather than against each other, which would let them drift
    // together.
    expect(canonicalSignals(request.signals)).toBe(
      "board_serial=10000000abcdef12;mac_address=d8:3a:dd:11:22:33;soc_serial=1f00e4c9d1a2b3c4",
    );
    expect(canonicalInstallationEvidence(request.installationEvidence)).toBe(
      "imageRelease=kitluy-storehub-os-arm64-2026.08.17-dev;storageModel=sc32g;storageSerial=0x1a2b3c4d",
    );
    expect(new TextDecoder().decode(deviceRegistrationRequestBytes(request))).toBe(
      [
        "kitluy.device-registration-request.v1",
        "KL-PI5-9F2C41A8",
        "KL-PI5-STORE-HUB-DEV",
        "pi5-zjjtir",
        "a".repeat(64),
        "board_serial=10000000abcdef12;mac_address=d8:3a:dd:11:22:33;soc_serial=1f00e4c9d1a2b3c4",
        "imageRelease=kitluy-storehub-os-arm64-2026.08.17-dev;storageModel=sc32g;storageSerial=0x1a2b3c4d",
      ].join("\n"),
    );
  });

  it("refuses the same malformed requests, with the same reason", () => {
    const cases: ReadonlyArray<[string, DeviceRegistrationRequest]> = [
      ["no signals", { ...request, signals: [] }],
      [
        "unnormalised signal",
        { ...request, signals: [{ signalType: "board_serial", signalValue: "ABC123" }] },
      ],
      [
        "reserved character in a value",
        { ...request, signals: [{ signalType: "board_serial", signalValue: "abc;123" }] },
      ],
      [
        "reserved character in evidence",
        { ...request, installationEvidence: { storageSerial: "a=b" } },
      ],
      ["short fingerprint", { ...request, registrationPublicKeyFingerprint: "abc" }],
      ["empty hostname", { ...request, hostname: "" }],
    ];
    for (const [label, candidate] of cases) {
      const node = validateDeviceRegistrationRequest(candidate);
      expect(node, `${label} must be refused`).not.toBeNull();
      expect(deno.validateDeviceRegistrationRequest(candidate), label).toBe(node);
    }
  });
});

describe("proof of possession, in both implementations", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  /** The request as a device would actually send it: fingerprint of its own key. */
  async function realRequest(): Promise<DeviceRegistrationRequest> {
    return {
      ...request,
      registrationPublicKeyFingerprint: await deno.publicKeyFingerprint(publicKeyPem),
    };
  }

  it("derives the same fingerprint from node:crypto and WebCrypto", async () => {
    const { publicKeyFingerprint } = await import("../src/dev-crypto.js");
    expect(await deno.publicKeyFingerprint(publicKeyPem)).toBe(publicKeyFingerprint(publicKeyPem));
  });

  it("accepts a genuine signature in both", async () => {
    const candidate = await realRequest();
    const signature = nodeSign(null, deviceRegistrationRequestBytes(candidate), privateKey);

    expect(verifyDeviceRegistrationRequest(candidate, publicKeyPem, signature)).toEqual({
      verified: true,
      rejection: null,
    });
    expect(await deno.verifyDeviceRegistrationRequest(candidate, publicKeyPem, signature)).toEqual({
      verified: true,
      rejection: null,
    });
  });

  it("refuses a signature made over different content in both", async () => {
    const candidate = await realRequest();
    const signature = nodeSign(null, deviceRegistrationRequestBytes(candidate), privateKey);
    // The board serial is changed AFTER signing — the exact move a captured
    // request would need to make to claim different hardware.
    const tampered: DeviceRegistrationRequest = {
      ...candidate,
      signals: [{ signalType: "board_serial", signalValue: "deadbeefdeadbeef" }],
    };

    expect(verifyDeviceRegistrationRequest(tampered, publicKeyPem, signature).verified).toBe(false);
    expect(
      (await deno.verifyDeviceRegistrationRequest(tampered, publicKeyPem, signature)).verified,
    ).toBe(false);
  });

  it("refuses a request whose claimed fingerprint is not its key, in both", async () => {
    const candidate: DeviceRegistrationRequest = {
      ...(await realRequest()),
      registrationPublicKeyFingerprint: "b".repeat(64),
    };
    const signature = nodeSign(null, deviceRegistrationRequestBytes(candidate), privateKey);

    // The signature is genuine over these bytes. It is still refused, because the
    // fingerprint is what the database stores and what an operator compares.
    expect(verifyDeviceRegistrationRequest(candidate, publicKeyPem, signature)).toEqual({
      verified: false,
      rejection: "REGISTRATION_FINGERPRINT_MISMATCH",
    });
    expect(await deno.verifyDeviceRegistrationRequest(candidate, publicKeyPem, signature)).toEqual({
      verified: false,
      rejection: "REGISTRATION_FINGERPRINT_MISMATCH",
    });
  });

  it("refuses a signature from a different key in both", async () => {
    const candidate = await realRequest();
    const other = generateKeyPairSync("ed25519");
    const signature = nodeSign(null, deviceRegistrationRequestBytes(candidate), other.privateKey);

    expect(verifyDeviceRegistrationRequest(candidate, publicKeyPem, signature).rejection).toBe(
      "REGISTRATION_BAD_SIGNATURE",
    );
    expect(
      (await deno.verifyDeviceRegistrationRequest(candidate, publicKeyPem, signature)).rejection,
    ).toBe("REGISTRATION_BAD_SIGNATURE");
  });
});
