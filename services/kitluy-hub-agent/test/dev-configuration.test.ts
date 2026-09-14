/**
 * The development configuration publisher, judged on its guards.
 *
 * This is the narrowest possible answer to a real hardware failure: a genuine,
 * activated, recognised Pi Terminal was refused PAIR_PROFILE_FORBIDDEN because
 * a Hub grants a profile only from an ACTIVE configuration snapshot, and no
 * unsigned snapshot may become active. The cloud publisher that would sign one
 * is BLK-006.
 *
 * Everything here exists to keep that answer narrow: development only, the
 * sanctioned development signer, a key that never leaves the board, and a route
 * through the real verifier rather than around it.
 */
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEV_CONFIGURATION_KEY_ID,
  DevelopmentConfigurationRefused,
  loadOrCreateDevelopmentSigner,
  publishDevelopmentConfiguration,
} from "../src/hub/dev-configuration.js";
import { DevelopmentHmacBatchSigner } from "../src/hub/sync/signing.js";

const SCOPE = {
  tenantId: "00000000-0000-4000-8000-000000000011",
  digitalStoreId: "00000000-0000-4000-8000-000000000015",
  locationId: "00000000-0000-4000-8000-000000000018",
};
const GRANTS = [
  { terminalDeviceId: "82519491-f584-4a19-9a44-495eef1c10fe", profileCodes: ["laundry.t1.intake_cashier"] },
];

/** A pool that must never be reached: every case here refuses before the DB. */
const unreachablePool = {
  connect: () => {
    throw new Error("the publisher reached the database on a request it should have refused");
  },
} as never;

describe("the development configuration publisher refuses before it reaches a database", () => {
  it("refuses outside development", async () => {
    await expect(
      publishDevelopmentConfiguration(unreachablePool, {
        ...SCOPE,
        grants: GRANTS,
        environment: "production",
      }),
    ).rejects.toThrow(/KLUY-HUB-DEV-CONFIG-ENVIRONMENT/);
  });

  it("refuses pilot too — the guard is an allow-list, not a production block", async () => {
    await expect(
      publishDevelopmentConfiguration(unreachablePool, {
        ...SCOPE,
        grants: GRANTS,
        environment: "pilot",
      }),
    ).rejects.toThrow(/KLUY-HUB-DEV-CONFIG-ENVIRONMENT/);
  });

  it("refuses an unknown environment rather than assuming development", async () => {
    await expect(
      publishDevelopmentConfiguration(unreachablePool, {
        ...SCOPE,
        grants: GRANTS,
        environment: "unknown",
      }),
    ).rejects.toThrow(DevelopmentConfigurationRefused);
  });

  it("refuses an empty grant set", async () => {
    // An empty configuration would ACTIVATE and permit nothing, so every pairing
    // would still be refused — with the Hub now claiming to be configured.
    await expect(
      publishDevelopmentConfiguration(unreachablePool, {
        ...SCOPE,
        grants: [],
        environment: "development",
      }),
    ).rejects.toThrow(/KLUY-HUB-DEV-CONFIG-EMPTY/);
  });
});

describe("the signing key", () => {
  it("is generated on first use and reused afterwards", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kitluy-devcfg-")), "signing.key");
    const first = loadOrCreateDevelopmentSigner(path);
    const second = loadOrCreateDevelopmentSigner(path);
    const manifest = "manifest-under-test";
    // Same key, so the second signer verifies what the first signed.
    expect(second.verify(manifest, first.sign(manifest))).toBe(true);
  });

  it("is written owner-only", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kitluy-devcfg-")), "signing.key");
    loadOrCreateDevelopmentSigner(path);
    expect(statSync(path).mode & 0o077).toBe(0);
  });

  it("carries at least the 32 bytes the development signer demands", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kitluy-devcfg-")), "signing.key");
    loadOrCreateDevelopmentSigner(path);
    expect(Buffer.from(readFileSync(path, "utf8").trim(), "base64").length).toBeGreaterThanOrEqual(32);
  });

  it("names itself, so a row never has to be guessed at later", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kitluy-devcfg-")), "signing.key");
    expect(loadOrCreateDevelopmentSigner(path).keyId).toBe(DEV_CONFIGURATION_KEY_ID);
    expect(DEV_CONFIGURATION_KEY_ID).toContain("development");
  });

  it("is the sanctioned development signer, not a new scheme", () => {
    const path = join(mkdtempSync(join(tmpdir(), "kitluy-devcfg-")), "signing.key");
    expect(loadOrCreateDevelopmentSigner(path)).toBeInstanceOf(DevelopmentHmacBatchSigner);
  });

  it("refuses a signature from a DIFFERENT key", () => {
    const a = loadOrCreateDevelopmentSigner(join(mkdtempSync(join(tmpdir(), "kitluy-a-")), "k"));
    const b = loadOrCreateDevelopmentSigner(join(mkdtempSync(join(tmpdir(), "kitluy-b-")), "k"));
    expect(b.verify("manifest", a.sign("manifest"))).toBe(false);
  });
});
