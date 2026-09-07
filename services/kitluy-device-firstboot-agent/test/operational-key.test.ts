/**
 * The operational key is generated once, reused for ever, and never silently
 * replaced.
 *
 * Authority: owner instruction 2026-08-28, "FIRSTBOOT KEY REQUIREMENTS";
 * finding C-3 — a Hub that re-keyed on every boot would burn its one
 * generation-1 slot and become permanently unissuable.
 */
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ensureOperationalKey,
  operationalKeyFingerprint,
  withOperationalPrivateKey,
  OperationalKeyError,
  OPERATIONAL_KEY_BITS,
} from "../src/operational-key.js";

let dir: string;
let keyPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-opkey-"));
  keyPath = join(dir, "operational-tls.key.pem");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the operational key", () => {
  it("generates exactly one key and REUSES it on every later boot", () => {
    const first = ensureOperationalKey(keyPath);
    expect(first.generated).toBe(true);

    // Ten more "boots". A Hub that re-keyed here would spend generation 1 on a
    // key it then threw away — the brick finding C-3 describes.
    for (let boot = 0; boot < 10; boot += 1) {
      const again = ensureOperationalKey(keyPath);
      expect(again.generated, `boot ${boot} regenerated the key`).toBe(false);
      expect(again.publicKeyFingerprint).toBe(first.publicKeyFingerprint);
      expect(again.publicKeyPem).toBe(first.publicKeyPem);
    }
  });

  it("creates an RSA-2048 key, owner-readable only", () => {
    ensureOperationalKey(keyPath);
    const key = createPrivateKey(readFileSync(keyPath, "utf8"));
    expect(key.asymmetricKeyType).toBe("rsa");
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(OPERATIONAL_KEY_BITS);
    // A key that was ever group-readable has already leaked; `writeFileSync`'s
    // mode is subject to the umask, so the mode is enforced explicitly.
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  it("REFUSES a widened key file rather than using it", () => {
    ensureOperationalKey(keyPath);
    chmodSync(keyPath, 0o644);
    expect(() => ensureOperationalKey(keyPath)).toThrow(/owner-only/);
  });

  it("FAILS CLOSED on a corrupt key instead of replacing the identity", () => {
    ensureOperationalKey(keyPath);
    const before = readFileSync(keyPath, "utf8");
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nnot base64 at all\n-----END PRIVATE KEY-----\n", {
      mode: 0o600,
    });

    expect(() => ensureOperationalKey(keyPath)).toThrow(OperationalKeyError);
    expect(() => ensureOperationalKey(keyPath)).toThrow(/Refusing to replace it/);

    // THE LOAD-BEARING PART: it did not quietly write a new key over the old
    // one. "Malformed means regenerate" would turn one bad write into a silent
    // identity change that the governed doors refuse for an unrelated reason.
    expect(readFileSync(keyPath, "utf8")).not.toBe(before);
    expect(readFileSync(keyPath, "utf8")).toContain("not base64 at all");
  });

  it("FAILS CLOSED on a partial write", () => {
    // What a power cut during a naive (non-atomic) write would leave.
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkq", { mode: 0o600 });
    expect(() => ensureOperationalKey(keyPath)).toThrow(/partial write|could not be parsed/);
  });

  it("FAILS CLOSED on a key of the wrong algorithm", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), {
      mode: 0o600,
    });
    expect(() => ensureOperationalKey(keyPath)).toThrow(/requires rsa-2048/);
  });

  it("FAILS CLOSED on RSA of the wrong size", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), {
      mode: 0o600,
    });
    expect(() => ensureOperationalKey(keyPath)).toThrow(/RSA-1024/);
  });

  it("leaves no temporary file behind, so a later boot sees no half-state", () => {
    ensureOperationalKey(keyPath);
    expect(() => statSync(`${keyPath}.tmp`)).toThrow();
  });

  it("hands the private key to a signer and never returns it", () => {
    ensureOperationalKey(keyPath);
    const signature = withOperationalPrivateKey(
      (privateKey) => {
        expect(privateKey.type).toBe("private");
        return "signed";
      },
      keyPath,
    );
    expect(signature).toBe("signed");
  });

  it("never puts key material in an error message", () => {
    ensureOperationalKey(keyPath);
    let message = "";
    try {
      withOperationalPrivateKey(() => {
        throw new Error("-----BEGIN PRIVATE KEY-----leaked-----END PRIVATE KEY-----");
      }, keyPath);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // The underlying error is SWALLOWED AND REPLACED, never wrapped: a PEM parse
    // failure can carry key fragments in its own message.
    expect(message).not.toContain("BEGIN PRIVATE KEY");
    expect(message).toContain("withheld");
  });

  it("computes the same fingerprint spelling the server uses", () => {
    const handle = ensureOperationalKey(keyPath);
    expect(handle.publicKeyFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(operationalKeyFingerprint(handle.publicKeyPem)).toBe(handle.publicKeyFingerprint);
  });
});
