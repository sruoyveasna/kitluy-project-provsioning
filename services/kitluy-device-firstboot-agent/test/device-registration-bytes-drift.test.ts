/**
 * The device's registration canonicalizer must produce EXACTLY the bytes the
 * Edge Function verifies.
 *
 * There are three implementations on purpose: the authoritative one in
 * `@kitluy/device-identity`, a Deno copy inside the Edge Function (Deno cannot
 * import a pnpm workspace package), and the device's own copy (the firstboot
 * agent ships with zero runtime dependencies and `package-bootstrap-runtime.sh`
 * refuses the build if it ever gains one).
 *
 * A duplicated canonicalizer is precisely the thing that drifts silently: a
 * reordered field or a changed separator would still sign, still verify against
 * itself, and fail only in the field against a real server — after an image had
 * been flashed to hardware. This test is what makes the third copy allowed to
 * exist. `packages/device-identity/test/device-registration-canonical-parity.test.ts`
 * does the same job for the Deno copy.
 *
 * Test-only imports: nothing here reaches the image.
 */
import {
  DEVICE_REGISTRATION_REQUEST_KIND as AUTHORITATIVE_KIND,
  canonicalInstallationEvidence as authoritativeEvidence,
  canonicalSignals as authoritativeSignals,
  deviceRegistrationRequestBytes as authoritativeBytes,
} from "@kitluy/device-identity";
import { describe, expect, it } from "vitest";

import {
  DEVICE_REGISTRATION_REQUEST_KIND,
  canonicalInstallationEvidence,
  canonicalSignals,
  deviceRegistrationRequestBytes,
  validateDeviceRegistrationRequest,
} from "../src/device-registration-bytes.js";

/**
 * Deliberately awkward input. Signals are given OUT of sorted order and the
 * evidence keys are unsorted, because sorting is the part most likely to drift
 * between two hand-maintained copies — an input already in order would pass
 * even if one side did not sort at all.
 */
const FIELDS = {
  assetTag: "KL-PI5-9F2C41A8",
  hardwareProfileKey: "CLOUD-HUB-PI5",
  hostname: "pi5-zjjtir",
  registrationPublicKeyFingerprint: "3f".repeat(32),
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
} as const;

describe("device registration canonical bytes: device copy vs authoritative", () => {
  it("uses the identical domain separator", () => {
    expect(DEVICE_REGISTRATION_REQUEST_KIND).toBe(AUTHORITATIVE_KIND);
  });

  it("produces byte-identical signing input", () => {
    const device = deviceRegistrationRequestBytes(FIELDS);
    const authoritative = authoritativeBytes(FIELDS);
    // Compared as bytes, not as strings: a string comparison would hide a
    // difference in unicode normalisation, which is exactly the class of drift
    // that only shows up against real hardware-reported values.
    expect(Array.from(device)).toEqual(Array.from(authoritative));
  });

  it("sorts signals identically", () => {
    expect(canonicalSignals(FIELDS.signals)).toBe(authoritativeSignals(FIELDS.signals));
  });

  it("sorts installation evidence identically", () => {
    expect(canonicalInstallationEvidence(FIELDS.installationEvidence)).toBe(
      authoritativeEvidence(FIELDS.installationEvidence),
    );
  });

  it("still agrees when a signal value contains a colon and digits", () => {
    // MAC addresses are the one real signal carrying a separator character that
    // is NOT reserved. Proving it survives both implementations stops a future
    // "escape the separators" change from being made on one side only.
    const signals = [
      { signalType: "mac_address", signalValue: "d8:3a:dd:ff:00:99" },
      { signalType: "board_serial", signalValue: "0000000012345678" },
    ];
    expect(canonicalSignals(signals)).toBe(authoritativeSignals(signals));
  });
});

describe("device-side validation refuses before spending a round trip", () => {
  it("accepts the well-formed request", () => {
    expect(validateDeviceRegistrationRequest(FIELDS)).toBeNull();
  });

  it("refuses an unnormalised signal value", () => {
    expect(
      validateDeviceRegistrationRequest({
        ...FIELDS,
        signals: [{ signalType: "board_serial", signalValue: "ABCDEF12" }],
      }),
    ).toBe("REGISTRATION_SIGNAL_NOT_NORMALISED");
  });

  it("refuses a reserved character rather than escaping it", () => {
    expect(
      validateDeviceRegistrationRequest({
        ...FIELDS,
        signals: [{ signalType: "board_serial", signalValue: "abc=def" }],
      }),
    ).toBe("REGISTRATION_RESERVED_CHARACTER");
  });

  it("refuses a reserved character in installation evidence too", () => {
    expect(
      validateDeviceRegistrationRequest({
        ...FIELDS,
        installationEvidence: { storageModel: "sc;32g" },
      }),
    ).toBe("REGISTRATION_RESERVED_CHARACTER");
  });

  it("refuses a fingerprint that is not 64 lowercase hex characters", () => {
    expect(
      validateDeviceRegistrationRequest({
        ...FIELDS,
        registrationPublicKeyFingerprint: "3F".repeat(32),
      }),
    ).toBe("REGISTRATION_FINGERPRINT_FORMAT");
  });

  it("refuses a request carrying no signals at all", () => {
    expect(validateDeviceRegistrationRequest({ ...FIELDS, signals: [] })).toBe(
      "REGISTRATION_NO_SIGNALS",
    );
  });
});
