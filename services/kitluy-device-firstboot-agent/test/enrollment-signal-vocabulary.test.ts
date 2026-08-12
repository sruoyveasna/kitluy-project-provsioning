/**
 * The device's signal names must be ones the governed enum accepts.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * `HardwareSignals` is camelCase (a TypeScript interface);
 * `kitluy_devices.hardware_signal_type` is snake_case (a PostgreSQL enum). The
 * transport sent the interface's key names verbatim, so a real device put
 * `"macAddress"` on the wire and the governed door refused the ENTIRE
 * redemption with `invalid input value for enum hardware_signal_type`.
 *
 * No test caught it. `enrollment.integration.test.ts` drives the real router
 * against the real database, but it hand-writes `mac_address`/`board_serial`/
 * `storage_serial` in its request body — so it proved the SERVER and never the
 * device's own vocabulary. The gap was exactly the join between them.
 *
 * These assertions are therefore written against the enum's canonical values as
 * a literal, so that if either side is renamed this fails here rather than on a
 * device in a shop.
 */
import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createHttpEnrollmentClient } from "../src/adapters/http-enrollment-client.js";
import { LinuxHardwareProbe } from "../src/adapters/linux-hardware-probe.js";
import type { HardwareSignals } from "../src/identity.js";

/**
 * `select enumlabel from pg_enum … where typname = 'hardware_signal_type'`,
 * as defined by migration 0120. Duplicated deliberately: a copy that must be
 * kept in step is the point — it is what makes a rename fail loudly.
 */
const HARDWARE_SIGNAL_TYPE = [
  "mac_address",
  "board_serial",
  "soc_serial",
  "tpm_ek_public",
  "secure_element_id",
  "storage_serial",
  "storage_model",
  "boot_measurement",
  "os_image_digest",
] as const;

/** A real key: `fingerprintFromPem` parses it, so a placeholder will not do. */
const DEVICE_PUBLIC_KEY_PEM = generateKeyPairSync("ed25519")
  .publicKey.export({ type: "spki", format: "pem" })
  .toString();

/** Every key the probe can possibly emit, with a non-empty value. */
const EVERY_SIGNAL: Required<HardwareSignals> = {
  macAddress: "dc:a6:32:11:22:33",
  boardSerial: "BRD-0001",
  socSerial: "SOC-0001",
  storageSerial: "NVM-0001",
  storageModel: "Samsung 980",
};

/** Captures the redemption body without a socket. */
function captureRedemption(hardwareSignals: Readonly<Record<string, string | undefined>>) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = ((url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    bodies.push({ url, ...body });
    if (String(url).endsWith("/challenges")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            challenge: {
              challengeId: "3fa463da-9536-4b44-8fbc-9672473aa13a",
              purpose: "kitluy.manufacturing-enrollment-pop.v1",
              environment: "development",
              presentedKeyFingerprint: String(body.publicKeyFingerprint),
              nonce: "a".repeat(64),
              issuedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
            },
          }),
          { status: 201 },
        ),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ deviceRecordId: "dev-1" }), { status: 201 }),
    );
  }) as unknown as typeof fetch;

  const client = createHttpEnrollmentClient({
    baseUrl: "http://localhost",
    privateKeyHandle: "handle",
    signer: { signPayload: () => Promise.resolve(new Uint8Array(64)) },
    ticketReference: "KL-TKT-0001",
    ticketSecret: "not-a-real-secret",
    environment: "development",
    fetchImpl,
  });

  return { client, bodies, hardwareSignals };
}

describe("device hardware-signal vocabulary", () => {
  it("sends ONLY names the governed enum accepts", async () => {
    const { client, bodies } = captureRedemption(EVERY_SIGNAL);
    await client.enroll({
      publicKeyPem: DEVICE_PUBLIC_KEY_PEM,
      deviceClass: "terminal",
      hardwareSignals: EVERY_SIGNAL,
    });

    const redemption = bodies.find((b) => String(b.url).endsWith("/redemptions"));
    const signals = redemption?.signals as { signal_type: string }[];
    expect(signals.length).toBe(Object.keys(EVERY_SIGNAL).length);
    for (const { signal_type } of signals) {
      expect(HARDWARE_SIGNAL_TYPE).toContain(signal_type);
    }
  });

  it("never puts a camelCase interface key on the wire", async () => {
    const { client, bodies } = captureRedemption(EVERY_SIGNAL);
    await client.enroll({
      publicKeyPem: DEVICE_PUBLIC_KEY_PEM,
      deviceClass: "terminal",
      hardwareSignals: EVERY_SIGNAL,
    });
    const redemption = bodies.find((b) => String(b.url).endsWith("/redemptions"));
    const wire = JSON.stringify(redemption?.signals);
    for (const key of Object.keys(EVERY_SIGNAL)) {
      expect(wire).not.toContain(key);
    }
  });

  it("drops an unrepresentable signal rather than refusing the whole enrollment", async () => {
    const { client, bodies } = captureRedemption({});
    const result = await client.enroll({
      publicKeyPem: DEVICE_PUBLIC_KEY_PEM,
      deviceClass: "terminal",
      // A signal a future probe might add before the enum learns about it.
      hardwareSignals: { macAddress: "dc:a6:32:11:22:33", inventedSignal: "x" },
    });
    const redemption = bodies.find((b) => String(b.url).endsWith("/redemptions"));
    const signals = redemption?.signals as { signal_type: string }[];
    // Sufficiency is the hardware profile's decision, not this transport's.
    expect(signals).toEqual([{ signal_type: "mac_address", signal_value: "dc:a6:32:11:22:33" }]);
    expect(result.kind).toBe("enrolled");
  });

  it("the REAL probe's own output is fully representable", async () => {
    // Not a hand-written fixture: whatever the probe emits on this machine must
    // map, and on a machine where it emits nothing the assertion is vacuous but
    // still correct.
    const probe = new LinuxHardwareProbe({});
    const collected = await probe.collect();
    const { client, bodies } = captureRedemption(collected);
    await client.enroll({
      publicKeyPem: DEVICE_PUBLIC_KEY_PEM,
      deviceClass: "terminal",
      hardwareSignals: collected,
    });
    const redemption = bodies.find((b) => String(b.url).endsWith("/redemptions"));
    const signals = (redemption?.signals ?? []) as { signal_type: string }[];
    expect(signals.length).toBe(Object.values(collected).filter(Boolean).length);
    for (const { signal_type } of signals) {
      expect(HARDWARE_SIGNAL_TYPE).toContain(signal_type);
    }
  });
});
