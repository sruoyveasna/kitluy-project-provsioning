/**
 * The device's INSTALLATION identity — one generation per root installation.
 *
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001; plan v1.0.0
 *   §1.2, §3.2; `docs/api/device-registration-edge-function-v1.md` §4.
 *
 * ===========================================================================
 * THIS IS NOT THE DEVICE IDENTITY, AND MUST NEVER BE USED AS ONE
 * ===========================================================================
 * Four lifecycles are deliberately separate, and collapsing any two of them is
 * the defect this whole design exists to prevent:
 *
 *     device_record_id ................ per BOARD, permanent, server-generated
 *     installation_id ................. per root installation  <- THIS FILE
 *     manufacturing_enrollment sequence  per registration key
 *     certificate_generation .......... per operational credential
 *
 * A reflash produces a new installation and the SAME device. The owner rule is
 * "one hardware device has its unique id no matter it boot with any os version
 * or sd card" — so this id is reported as EVIDENCE about the current install,
 * never as the thing that identifies the board. The server resolves the board
 * from hardware evidence and tells the device which `deviceId` it is.
 *
 * ===========================================================================
 * WHY /var, WHEN /var IS PER-SLOT
 * ===========================================================================
 * On the A/B layout `/var` is bind-mounted from `/persistent/slots/<slot>/var`,
 * so it is per-slot by construction (upstream `image/gpt/ab_userdata`). For an
 * installation generation that is not a limitation, it is the DEFINITION: a new
 * system slot is a new root installation and should carry a new installation
 * id, exactly as a reflashed card does. Storing this beside the identity is
 * therefore correct for this value specifically.
 *
 * (The device KEY living under the same per-slot path is a separate matter and
 * is recorded as a finding, not silently changed here — see the handoff.)
 *
 * ===========================================================================
 * WHY THE ID IS GENERATED, NOT DERIVED
 * ===========================================================================
 * Deriving it from storage serials would make two identical cards produce the
 * same installation id, which is precisely the clone case the server must be
 * able to see as two installations. A random UUID has no such collision.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const INSTALLATION_STATE_PATH = "/var/lib/kitluy/installation.json";

export interface InstallationRecord {
  readonly installationId: string;
  /** When this root installation first booted. Reported as evidence. */
  readonly createdAt: string;
  /** The image this installation was flashed from, when the image declared it. */
  readonly imageRelease?: string;
}

/** UUID v4, as the database column expects. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same atomic discipline as the identity store: temp -> fsync -> rename -> fsync dir. */
function writeInstallation(record: InstallationRecord, path: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o750 });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o640 });
  const fd = openSync(temp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  const dirFd = openSync(dir, "r");
  try {
    fsyncSync(dirFd);
  } finally {
    closeSync(dirFd);
  }
}

/** Returns null when absent, unparseable, or carrying an id that is not a UUID. */
export function readInstallation(path = INSTALLATION_STATE_PATH): InstallationRecord | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const candidate = parsed as { installationId?: unknown };
    if (typeof candidate.installationId !== "string") return null;
    // A malformed id is treated as absent rather than repaired. Sending a value
    // the server's uuid column will refuse turns every registration attempt into
    // a 400 that no operator can act on; regenerating produces a new generation,
    // which is honest — this installation cannot prove it was the earlier one.
    if (!UUID_PATTERN.test(candidate.installationId)) return null;
    return parsed as InstallationRecord;
  } catch {
    return null;
  }
}

/**
 * The installation id for this root installation, creating it on first call.
 *
 * Idempotent by design: firstboot, the registration client and the console all
 * call this, and every caller must get the SAME id. A function that minted a new
 * one per caller would register three installations for one boot.
 */
export function loadOrCreateInstallation(
  options: {
    readonly path?: string;
    readonly imageRelease?: string;
  } = {},
): InstallationRecord {
  const path = options.path ?? INSTALLATION_STATE_PATH;
  const existing = readInstallation(path);
  if (existing !== null) return existing;

  const record: InstallationRecord = {
    installationId: randomUUID(),
    createdAt: new Date().toISOString(),
    ...(options.imageRelease !== undefined && options.imageRelease.length > 0
      ? { imageRelease: options.imageRelease }
      : {}),
  };
  writeInstallation(record, path);
  return record;
}
