/**
 * What the DEVICE knows about its own cloud registration.
 *
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001; plan v1.0.0 §3.3.
 *
 * ===========================================================================
 * WHY A THIRD STATE FILE
 * ===========================================================================
 * `bootstrap-state.json` answers "has enrolment succeeded"; `pairing-state.json`
 * answers "is this Hub assigned to a Store". Registration is a third axis and
 * not a point on either line: a board can be registered and unapproved, or
 * approved and unpaired, and a device that folded these together would either
 * re-register every thirty seconds or claim a trust it does not hold. That
 * collision already happened once between enrolment and pairing — see the header
 * of `pairing-state.ts` and the defect fixed in `70a339d`.
 *
 * ===========================================================================
 * THIS IS DISPLAY STATE. THE CLOUD IS THE TRUTH.
 * ===========================================================================
 * These names exist so a console can say something truthful between refreshes.
 * They are NOT a database enum and they authorize nothing. In particular
 * `APPROVED` here means "the cloud answered KNOWN_DEVICE_INSTALLATION_REGISTERED
 * for an approved board" — it does NOT mean the device holds an operational
 * certificate. Certificates are gated on BLK-005 and nothing here issues one, so
 * a screen that rendered "ready to serve terminals" off this file would be
 * lying.
 *
 * ===========================================================================
 * PENDING IS A HEALTHY STATE, NOT A FAILURE
 * ===========================================================================
 * Plan §3.3: "Pending approval is a healthy waiting condition, not a boot
 * failure." A generic image is SUPPOSED to reach `AWAITING_APPROVAL` and stop
 * there until a human at HET decides. The console must not render that as an
 * error, and the firstboot unit must not fail because of it — an appliance that
 * showed a red screen for its designed resting state would send every installer
 * looking for a fault that does not exist.
 */
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

export const REGISTRATION_STATE_PATH = "/var/lib/kitluy/registration-state.json";

/**
 * Ordered for rendering only. Nothing advances a device except a cloud answer.
 *
 * `TRUST_REVIEW_REQUIRED` and `CONTAINED` are separate phases rather than detail
 * strings because the operator action differs in kind. Trust review means "HET
 * must look at this board" and waiting is correct; contained means the fleet has
 * deliberately stopped this device and waiting will never resolve it.
 */
export type RegistrationPhase =
  | "NOT_REGISTERED"
  | "REGISTERING"
  | "AWAITING_APPROVAL"
  | "TRUST_REVIEW_REQUIRED"
  | "APPROVED"
  | "CONTAINED"
  | "UNREACHABLE";

export interface RegistrationState {
  readonly phase: RegistrationPhase;
  /** Shown to an operator. Never a secret. */
  readonly detail?: string;
  /**
   * The opaque server-side device id. Safe to display: the contract (§9) makes
   * it the one identifier a pending device receives, precisely so an admin can
   * be quoted it over the phone.
   */
  readonly deviceId?: string;
  /** This root installation, as the cloud recorded it. */
  readonly installationId?: string;
  /** From the cloud's `conflictReason`, when it gave one. */
  readonly conflictReason?: string;
  /** The registration key this state belongs to — see `registrationBelongsTo`. */
  readonly keyFingerprint?: string;
  readonly updatedAt: string;
}

/** Same atomic discipline as the identity store: temp -> fsync -> rename -> fsync dir. */
export function writeRegistrationState(
  state: RegistrationState,
  path = REGISTRATION_STATE_PATH,
): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o750 });
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
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

/**
 * Returns null when the file is absent or unparseable.
 *
 * An unreadable file reads as "not registered" rather than as an error, because
 * the recovery is identical — register again, which is idempotent by contract
 * §10 — and a device that refused to show its console over a corrupt display
 * file would be unusable for a reason unrelated to registration.
 */
export function readRegistrationState(path = REGISTRATION_STATE_PATH): RegistrationState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const candidate = parsed as { phase?: unknown };
    return typeof candidate.phase === "string" ? (parsed as RegistrationState) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the recorded registration belongs to the key in front of us.
 *
 * A state file naming a DIFFERENT registration key is stale — the device
 * re-keyed, or a card was copied — and must not be rendered as this
 * installation's registration. Same discipline as `pairingBelongsTo()`.
 */
export function registrationBelongsTo(
  state: RegistrationState | null,
  keyFingerprint: string | undefined,
): boolean {
  if (state === null || keyFingerprint === undefined) return false;
  return state.keyFingerprint === keyFingerprint;
}

/**
 * One operator-facing line per phase.
 *
 * Kept beside the phases rather than in the console so the two cannot drift, and
 * worded for someone standing in a shop with no context: it says what is true,
 * and whether they should wait or act.
 */
export function registrationHeadline(phase: RegistrationPhase): string {
  switch (phase) {
    case "NOT_REGISTERED":
      return "NOT REGISTERED — this device has not yet contacted KitLuy.";
    case "REGISTERING":
      return "REGISTERING — contacting KitLuy.";
    case "AWAITING_APPROVAL":
      return "WAITING FOR HET APPROVAL — this device is visible to KitLuy but is not yet authorized for Store use. No action is needed here.";
    case "TRUST_REVIEW_REQUIRED":
      return "TRUST REVIEW REQUIRED — KitLuy must check this device by hand before it can continue. Contact HET support.";
    case "APPROVED":
      return "APPROVED — this device is authorized. It is not yet provisioned for Store use.";
    case "CONTAINED":
      return "STOPPED BY KITLUY — this device has been quarantined, retired or replaced and cannot be used. Contact HET support.";
    case "UNREACHABLE":
      return "NO CONNECTION — this device cannot reach KitLuy. Check the network; it will keep trying.";
  }
}
