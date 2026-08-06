/**
 * Hub backup manifest v1 + encrypted container (WS-11-T006-P02).
 *
 * Authority: KLD-2026-08-06-WS11-T006-001 §4 — every backup carries id,
 * scope, schema/configuration/release versions, timestamps, SHA-256 digest,
 * encryption metadata, manifest version, status and verification result;
 * private operational keys are never exported in plaintext or stored in the
 * payload.
 *
 * Container: "KLBK1" magic + 12-byte IV + 16-byte GCM tag + ciphertext.
 * AES-256-GCM, so a truncated or bit-flipped backup FAILS AUTHENTICATION
 * instead of restoring garbage.
 *
 * Key custody: DEVELOPMENT ONLY. The key comes from
 * KITLUY_HUB_DEV_BACKUP_KEY (>= 32 chars) or the fixed local development
 * key below. Production key custody is BLK-005 material and is recorded,
 * not invented — hub-db.mjs already refuses to run against anything that is
 * not the local development database (KL-INF-P1-037).
 */
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";

export const BACKUP_MANIFEST_VERSION = 1;
export const BACKUP_MAGIC = Buffer.from("KLBK1");
export const DEV_BACKUP_KEY_ENV = "KITLUY_HUB_DEV_BACKUP_KEY";
/** Deterministic LOCAL-DEVELOPMENT key; never a production secret. */
const FIXED_DEV_KEY = "kitluy-local-dev-backup-key-not-for-production-use";

export function resolveDevBackupKey(env = process.env) {
  const raw = env[DEV_BACKUP_KEY_ENV] ?? FIXED_DEV_KEY;
  if (typeof raw !== "string" || raw.length < 32) {
    throw new Error(`${DEV_BACKUP_KEY_ENV} must be at least 32 characters`);
  }
  if (/prod|staging|live/i.test(env.KITLUY_ENV ?? "")) {
    throw new Error("backup encryption refuses a non-local KITLUY_ENV (BLK-005 custody)");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptBackup(plainBytes, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plainBytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([BACKUP_MAGIC, iv, tag, ct]);
}

export function decryptBackup(containerBytes, key) {
  const buf = Buffer.from(containerBytes);
  if (buf.length < BACKUP_MAGIC.length + 12 + 16 + 1) {
    throw new Error("KLUY-BACKUP-CONTAINER-TRUNCATED: too short to be a KLBK1 container");
  }
  if (!buf.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error("KLUY-BACKUP-CONTAINER-MAGIC: not a KLBK1 encrypted backup");
  }
  const iv = buf.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + 12);
  const tag = buf.subarray(BACKUP_MAGIC.length + 12, BACKUP_MAGIC.length + 28);
  const ct = buf.subarray(BACKUP_MAGIC.length + 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error("KLUY-BACKUP-AUTH-FAILED: the backup is corrupt or the key is wrong");
  }
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildManifestV1(input) {
  const required = [
    "database",
    "schemaHead",
    "fingerprintSha256",
    "sha256Plain",
    "sha256Encrypted",
    "bytesPlain",
    "bytesEncrypted",
  ];
  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      throw new Error(`KLUY-BACKUP-MANIFEST-INCOMPLETE: ${key} is required`);
    }
  }
  return {
    manifest_version: BACKUP_MANIFEST_VERSION,
    backup_id: input.backupId ?? randomUUID(),
    database: input.database,
    scope: input.scope ?? null, // { tenant_id, digital_store_id, location_id, hub_device_id } | null
    schema_head: input.schemaHead,
    configuration_version: input.configurationVersion ?? null,
    release_version: input.releaseVersion ?? null,
    created_at: input.createdAt,
    completed_at: input.completedAt,
    sha256_plain: input.sha256Plain,
    sha256_encrypted: input.sha256Encrypted,
    bytes_plain: input.bytesPlain,
    bytes_encrypted: input.bytesEncrypted,
    fingerprint_sha256: input.fingerprintSha256,
    encryption: {
      algorithm: "aes-256-gcm",
      container: "KLBK1",
      key_env: DEV_BACKUP_KEY_ENV,
      dev_only: true,
    },
    status: input.status ?? "verified",
    verification: input.verification ?? null,
  };
}

/** Fail-closed shape check for a parsed manifest. Returns a refusal string or null. */
export function manifestRefusal(manifest) {
  if (manifest === null || typeof manifest !== "object") return "KLUY-BACKUP-MANIFEST-SHAPE";
  if (manifest.manifest_version !== BACKUP_MANIFEST_VERSION) return "KLUY-BACKUP-MANIFEST-VERSION";
  for (const key of [
    "backup_id",
    "database",
    "schema_head",
    "sha256_plain",
    "sha256_encrypted",
    "fingerprint_sha256",
    "created_at",
    "completed_at",
  ]) {
    if (typeof manifest[key] !== "string" || manifest[key] === "")
      return `KLUY-BACKUP-MANIFEST-INCOMPLETE:${key}`;
  }
  if (manifest.status !== "verified") return "KLUY-BACKUP-NOT-VERIFIED";
  if (manifest.encryption?.algorithm !== "aes-256-gcm") return "KLUY-BACKUP-MANIFEST-ENCRYPTION";
  // The payload and manifest must never carry key material.
  const flat = JSON.stringify(manifest);
  if (/PRIVATE KEY|postgres(ql)?:\/\/|password|provisioning_code/i.test(flat)) {
    return "KLUY-BACKUP-MANIFEST-SECRET-SHAPED";
  }
  return null;
}
