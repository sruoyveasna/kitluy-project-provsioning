/**
 * Production `IdentityStore` — the device's on-disk identity record.
 *
 * Authority: 00_AI_HANDOFF/000_ACTIVE_PHASE.md §10 (identity model);
 *   DEC-1 bootstrap-hybrid owner decision (2026-08-10);
 *   infra/edge/raspberry-pi/pi-terminal-image `kitluy-base` layer, which creates
 *   /var/lib/kitluy/identity empty at 0700 and places NO key material there.
 *
 * ===========================================================================
 * WHY THE WRITE IS DONE THIS WAY
 * ===========================================================================
 * `IdentityStore.write` is documented as "must be atomic: a torn write is the
 * failure mode this whole module guards". On a Pi that loses power during
 * first boot — the single most likely moment for it, because first boot is
 * when an installer is still handling the device — a partially written record
 * must not be mistaken for a complete one.
 *
 * So the write is: temp file in the SAME directory (rename is only atomic
 * within a filesystem) -> fsync the file -> rename -> fsync the DIRECTORY.
 * The last step is the one most often omitted: without it the rename itself
 * can be lost, leaving the old inode and a stale identity after reboot.
 *
 * The `complete` flag in the record is a second, independent guard owned by
 * `bootstrapIdentity`. Both exist on purpose: this one prevents a torn file,
 * that one detects a torn SEQUENCE (record written, key generation failed).
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { IdentityStore, StoredIdentity } from "../identity.js";

/** Owner-only, per the image layer's 0700 on the identity directory. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export const DEFAULT_IDENTITY_DIR = "/var/lib/kitluy/identity";
export const IDENTITY_FILE_NAME = "identity.json";

export interface FileIdentityStoreOptions {
  /** Overridable so tests need no real device path. */
  readonly directory?: string;
}

/**
 * A corrupt identity file is NOT silently discarded here.
 *
 * Returning `null` would make `bootstrapIdentity` mint a brand-new identity,
 * which for an already-enrolled device means it silently becomes a different
 * device and its fleet record is orphaned. Refusing loudly is the safe
 * failure: an operator can then decide between governed re-enrollment and
 * restoring the file.
 */
export class CorruptIdentityRecordError extends Error {
  constructor(readonly path: string, cause: unknown) {
    super(`identity record at ${path} is unreadable or malformed`);
    this.name = "CorruptIdentityRecordError";
    this.cause = cause;
  }
}

export class FileIdentityStore implements IdentityStore {
  readonly #path: string;

  constructor(options: FileIdentityStoreOptions = {}) {
    this.#path = join(options.directory ?? DEFAULT_IDENTITY_DIR, IDENTITY_FILE_NAME);
  }

  get path(): string {
    return this.#path;
  }

  async read(): Promise<StoredIdentity | null> {
    let raw: string;
    try {
      raw = readFileSync(this.#path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new CorruptIdentityRecordError(this.#path, error);
    }
    if (!isStoredIdentity(parsed)) {
      throw new CorruptIdentityRecordError(this.#path, new Error("shape mismatch"));
    }
    return parsed;
  }

  async write(identity: StoredIdentity): Promise<void> {
    const dir = dirname(this.#path);
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });

    // Same directory: rename() is atomic only within one filesystem, and
    // /tmp is frequently a different one on a Pi image.
    const temp = `${this.#path}.tmp-${process.pid}`;
    try {
      writeFileSync(temp, `${JSON.stringify(identity, null, 2)}\n`, { mode: FILE_MODE });
      syncPath(temp);
      renameSync(temp, this.#path);
      // Durability of the rename itself, not of the file contents.
      syncPath(dir);
    } catch (error) {
      try {
        unlinkSync(temp);
      } catch {
        // The temp file may never have been created; the original error wins.
      }
      throw error;
    }
  }
}

function syncPath(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Explicit field checking rather than a cast. A record missing `complete` must
 * reach `bootstrapIdentity` as a torn write, and a cast would hand it through
 * as valid.
 */
function isStoredIdentity(value: unknown): value is StoredIdentity {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.publicKeyPem === "string" &&
    typeof v.privateKeyHandle === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.complete === "boolean" &&
    typeof v.hardwareSignals === "object" &&
    v.hardwareSignals !== null &&
    (v.deviceRecordId === undefined || typeof v.deviceRecordId === "string")
  );
}
