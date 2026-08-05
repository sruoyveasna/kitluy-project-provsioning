/**
 * The terminal's OS-protected key custody port — WS-11-T004-P04C2.
 *
 * Authority: POS spec §16 storage table — "Local database: Encrypted
 * SQLite-compatible store or approved equivalent" and "Secure credential:
 * device key, certificate reference, refresh material — OS-protected secure
 * storage; NEVER PLAIN SQLITE"; BLK-005 (hardware trust and key custody).
 *
 * ===========================================================================
 * WHAT THIS PORT IS FOR, AND WHAT IT IS NOT FOR
 * ===========================================================================
 * It yields ONE value: the symmetric key that seals the terminal-local
 * database. That key lives in the operating system's protected store
 * (Electron `safeStorage`, which is DPAPI on Windows, Keychain on macOS and
 * the platform secret service on Linux) and is unwrapped into memory only for
 * as long as the store is open.
 *
 * It is NOT the terminal's identity key. The terminal's private signing key
 * stays in the OS-protected or hardware-backed key store and is never handled
 * by this package at all — no function here accepts, returns, wraps or
 * persists one. That separation is why a compromised database file cannot
 * impersonate the terminal: the file holds sealed evidence, not identity.
 *
 * ===========================================================================
 * THE DEFAULT FAILS CLOSED
 * ===========================================================================
 * There is no "if the OS store is unavailable, fall back to a file" branch,
 * because that branch is exactly how an encrypted store quietly becomes a
 * plaintext one. {@link unavailableSecureKeyStore} refuses and names BLK-005;
 * a runtime that has no OS custody does not get a degraded store, it gets no
 * store.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Bytes of the database sealing key. AES-256-GCM. */
export const DATABASE_KEY_BYTES = 32;

/**
 * A source of the terminal-local database sealing key.
 *
 * Implementations MUST hold the key in OS-protected or hardware-backed
 * custody. `id` names the custody facility so evidence records WHICH one was
 * used — "encrypted" without naming the custodian is not a security claim.
 */
export interface SecureKeyStore {
  readonly id: string;
  /** True only when the platform facility is actually usable right now. */
  isAvailable(): boolean;
  /**
   * The sealing key, unwrapped from OS custody. Created on first use and
   * stable afterwards: a key that changed would orphan every sealed row.
   */
  getOrCreateDatabaseKey(): Uint8Array;
}

export class TerminalKeyCustodyError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "TerminalKeyCustodyError";
  }
}

/** The shipped default. Every method refuses, naming the blocker. */
export function unavailableSecureKeyStore(): SecureKeyStore {
  return {
    id: "unavailable",
    isAvailable: () => false,
    getOrCreateDatabaseKey(): never {
      throw new TerminalKeyCustodyError(
        "KLUY-TERMINAL-STORE-NO-KEY-CUSTODY: no OS-protected key custody is configured for this " +
          "terminal runtime. The " +
          "terminal-local store refuses to open rather than seal its evidence under a key it " +
          "cannot protect (POS spec §16; BLK-005). Provide an OS-backed SecureKeyStore.",
        "KLUY-TERMINAL-STORE-NO-KEY-CUSTODY",
      );
    },
  };
}

/**
 * The minimal surface this package needs from Electron's `safeStorage`.
 *
 * Declared structurally rather than imported, so this package does not depend
 * on Electron and can be exercised — and later reused by another runtime —
 * without one.
 */
export interface OsEncryptionFacility {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Where the WRAPPED key sits. The plaintext key is never written anywhere. */
export interface WrappedKeyFile {
  read(): Buffer | null;
  write(wrapped: Buffer): void;
}

/**
 * The Electron T1-T4 runtime adapter (Phase 1's implemented runtime).
 *
 * The key is generated once with the platform CSPRNG, WRAPPED by the OS
 * facility, and only the wrapped form touches disk. `safeStorage` ties the
 * unwrap to the OS user/account, so copying the terminal's files to another
 * machine yields a wrapped blob that will not open.
 */
export function osProtectedSecureKeyStore(
  facility: OsEncryptionFacility,
  file: WrappedKeyFile,
  id = "electron.safeStorage",
): SecureKeyStore {
  let cached: Uint8Array | null = null;
  return {
    id,
    isAvailable: () => facility.isEncryptionAvailable(),
    getOrCreateDatabaseKey(): Uint8Array {
      if (cached !== null) return cached;
      if (!facility.isEncryptionAvailable()) {
        throw new TerminalKeyCustodyError(
          `KLUY-TERMINAL-STORE-NO-KEY-CUSTODY: OS key custody '${id}' reports encryption ` +
            "unavailable; the terminal-local store " +
            "refuses to open rather than seal evidence under an unprotected key (BLK-005).",
          "KLUY-TERMINAL-STORE-NO-KEY-CUSTODY",
        );
      }
      const existing = file.read();
      if (existing !== null) {
        const unwrapped = Buffer.from(facility.decryptString(existing), "base64");
        if (unwrapped.length !== DATABASE_KEY_BYTES) {
          throw new TerminalKeyCustodyError(
            "KLUY-TERMINAL-STORE-KEY-CORRUPT: the wrapped terminal-local database key did not unwrap " +
              "to a valid key. The store " +
              "fails closed; recovery is governed re-pairing, never a regenerated key over " +
              "existing rows.",
            "KLUY-TERMINAL-STORE-KEY-CORRUPT",
          );
        }
        cached = unwrapped;
        return cached;
      }
      const fresh = randomBytes(DATABASE_KEY_BYTES);
      file.write(facility.encryptString(fresh.toString("base64")));
      cached = fresh;
      return cached;
    },
  };
}

/**
 * DEVELOPMENT AND TEST ONLY, and it says so in its `id`.
 *
 * Holds the key in process memory. It exists so the store's behaviour can be
 * proven without a desktop session, and it is named so that any evidence
 * record produced under it is self-evidently not a production claim.
 */
export function inMemorySecureKeyStore(seed?: Uint8Array): SecureKeyStore {
  const key =
    seed === undefined
      ? randomBytes(DATABASE_KEY_BYTES)
      : Buffer.from(createHash("sha256").update(Buffer.from(seed)).digest());
  return {
    id: "in-memory.development-only",
    isAvailable: () => true,
    getOrCreateDatabaseKey: () => key,
  };
}

/** Constant-time comparison for key-derived material. */
export function sameKeyMaterial(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
