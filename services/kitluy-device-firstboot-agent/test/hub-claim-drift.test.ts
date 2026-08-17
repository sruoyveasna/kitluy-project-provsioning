/**
 * The device's claim canonicalizer must produce EXACTLY the bytes the issuer does.
 *
 * There are two implementations on purpose. The authoritative one lives in
 * `@kitluy/device-identity`; the device carries its own copy because this agent
 * ships inside the golden image with zero runtime dependencies, and
 * `package-bootstrap-runtime.sh` refuses the build if it ever gains one.
 *
 * A duplicated canonicalizer is precisely the thing that drifts silently: a
 * reordered field would still hash, still match itself, and fail only in a shop
 * against a real claim — as `KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED` on every
 * legitimate pairing. This test is what makes the duplication safe.
 *
 * It also pins the SCOPE binding, which is the column's actual promise:
 * "a captured token cannot be replayed against a different Tenant, Digital
 * Store or Location". A payload that ignored a scope field would still pair
 * happily — and silently protect nothing.
 *
 * This test imports BOTH. It is a test-only import: nothing here reaches the image.
 */
import { createHash } from "node:crypto";

import { hubClaimPayloadBytes as authoritativeBytes } from "@kitluy/device-identity";
import { describe, expect, it } from "vitest";

import {
  HUB_CLAIM_KIND,
  findHubClaimSeparatorInjection,
  hubClaimPayloadBytes,
} from "../src/hub-claim-bytes.js";

const FIELDS = {
  deviceRecordId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  digitalStoreId: "33333333-3333-4333-8333-333333333333",
  storeLocationId: "44444444-4444-4444-8444-444444444444",
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("hub claim payload: the two implementations must not drift", () => {
  it("produces byte-identical output", () => {
    expect(Buffer.from(hubClaimPayloadBytes(FIELDS))).toEqual(
      Buffer.from(authoritativeBytes(FIELDS)),
    );
  });

  it("produces the same digest — what actually reaches payload_sha256", () => {
    expect(sha256(hubClaimPayloadBytes(FIELDS))).toBe(sha256(authoritativeBytes(FIELDS)));
  });

  it("leads with the domain separator, so a hash cannot be replayed as another record type", () => {
    const text = Buffer.from(hubClaimPayloadBytes(FIELDS)).toString("utf8");
    expect(text.startsWith(`${HUB_CLAIM_KIND}\n`)).toBe(true);
    expect(HUB_CLAIM_KIND).toBe("kitluy.hub-claim-payload.v1");
  });
});

describe("the scope binding is real, not decorative", () => {
  it("changing ANY scope field changes the digest", () => {
    const base = sha256(hubClaimPayloadBytes(FIELDS));
    const variants = [
      { ...FIELDS, tenantId: "99999999-9999-4999-8999-999999999999" },
      { ...FIELDS, digitalStoreId: "99999999-9999-4999-8999-999999999999" },
      { ...FIELDS, storeLocationId: "99999999-9999-4999-8999-999999999999" },
      { ...FIELDS, deviceRecordId: "99999999-9999-4999-8999-999999999999" },
    ];
    for (const v of variants) {
      // If any of these collided, a captured token WOULD be replayable against
      // another Tenant, Store or Location — the exact thing the column promises
      // it cannot be.
      expect(sha256(hubClaimPayloadBytes(v))).not.toBe(base);
      expect(sha256(authoritativeBytes(v))).not.toBe(base);
    }
  });

  it("carries NO server-derived field — the issuer must be able to compute it", () => {
    // The expiry was removed for exactly this reason: `create_device_claim_v1`
    // derives `expires_at` from the database clock and the row is immutable, so
    // an issuer could never hash it. Anything server-derived appearing here
    // again would make every legitimate pairing fail with
    // KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED.
    const text = Buffer.from(hubClaimPayloadBytes(FIELDS)).toString("utf8");
    expect(text.split("\n")).toHaveLength(5);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("separator injection", () => {
  it("REFUSES to build bytes from a field containing a separator", () => {
    // Without this, "a\nb" in one field could forge the bytes of a different
    // set of fields — the classic canonicalisation break.
    for (const bad of [
      { ...FIELDS, tenantId: "aaa\nbbb" },
      { ...FIELDS, digitalStoreId: "aaa\rbbb" },
      { ...FIELDS, deviceRecordId: "aaa\nbbb" },
      { ...FIELDS, storeLocationId: "aaa\nbbb" },
    ]) {
      expect(() => hubClaimPayloadBytes(bad)).toThrow();
      expect(() => authoritativeBytes(bad)).toThrow();
    }
  });

  it("names the offending field identically in both implementations", () => {
    const bad = { ...FIELDS, digitalStoreId: "x\ny" };
    expect(findHubClaimSeparatorInjection(bad)).toBe("digitalStoreId");
  });

  it("accepts ordinary values", () => {
    expect(findHubClaimSeparatorInjection(FIELDS)).toBeNull();
  });
});
