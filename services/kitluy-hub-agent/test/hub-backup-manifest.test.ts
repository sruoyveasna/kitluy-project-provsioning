/**
 * WS-11-T006-P02 — backup manifest v1 + KLBK1 encrypted container (pure
 * logic; no database). The destructive round trip lives in
 * hub-backup-restore.test.ts (opt-in) and the CLI failure injections are in
 * the P02 handoff evidence.
 */
import { describe, expect, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain .mjs tooling module, typed at the boundary here.
import * as bm from "../../../scripts/hub/backup-manifest.mjs";

const KEY = bm.resolveDevBackupKey({ KITLUY_HUB_DEV_BACKUP_KEY: "x".repeat(40) });

describe("hub backup manifest v1 and KLBK1 container (WS-11-T006-P02)", () => {
  it("encrypts and decrypts a payload byte-for-byte", () => {
    const plain = Buffer.from("kitluy backup payload " + "y".repeat(500));
    const container = bm.encryptBackup(plain, KEY);
    expect(container.subarray(0, 5).toString()).toBe("KLBK1");
    expect(Buffer.compare(bm.decryptBackup(container, KEY), plain)).toBe(0);
  });

  it("fails AUTHENTICATION on a corrupted or truncated container", () => {
    const container = bm.encryptBackup(Buffer.from("payload"), KEY);
    const tampered = Buffer.from(container);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => bm.decryptBackup(tampered, KEY)).toThrow(/KLUY-BACKUP-AUTH-FAILED/);
    expect(() => bm.decryptBackup(container.subarray(0, 10), KEY)).toThrow(
      /KLUY-BACKUP-CONTAINER-TRUNCATED/,
    );
    expect(() => bm.decryptBackup(Buffer.from("NOTKLBK" + "0".repeat(64)), KEY)).toThrow(
      /KLUY-BACKUP-CONTAINER-MAGIC/,
    );
  });

  it("refuses a short key and a non-local environment (BLK-005 custody)", () => {
    expect(() => bm.resolveDevBackupKey({ KITLUY_HUB_DEV_BACKUP_KEY: "short" })).toThrow(
      /at least 32/,
    );
    expect(() => bm.resolveDevBackupKey({ KITLUY_ENV: "production" })).toThrow(/non-local/);
  });

  it("builds a complete v1 manifest and fails closed on shape violations", () => {
    const manifest = bm.buildManifestV1({
      database: "kitluy_hub_local",
      schemaHead: "0037_hub_replacement_local_state.sql",
      fingerprintSha256: "a".repeat(64),
      sha256Plain: "b".repeat(64),
      sha256Encrypted: "c".repeat(64),
      bytesPlain: 10,
      bytesEncrypted: 43,
      createdAt: "2026-08-06T00:00:00Z",
      completedAt: "2026-08-06T00:00:01Z",
    });
    expect(bm.manifestRefusal(manifest)).toBeNull();
    expect(bm.manifestRefusal({ ...manifest, manifest_version: 2 })).toBe(
      "KLUY-BACKUP-MANIFEST-VERSION",
    );
    expect(bm.manifestRefusal({ ...manifest, status: "pending" })).toBe("KLUY-BACKUP-NOT-VERIFIED");
    expect(bm.manifestRefusal({ ...manifest, sha256_plain: "" })).toMatch(/INCOMPLETE/);
    expect(bm.manifestRefusal({ ...manifest, scope: { note: "postgres://user:pw@host/db" } })).toBe(
      "KLUY-BACKUP-MANIFEST-SECRET-SHAPED",
    );
  });
});
