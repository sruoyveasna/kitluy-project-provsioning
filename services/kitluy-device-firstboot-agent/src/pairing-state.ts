/**
 * What the DEVICE knows about its own Store pairing.
 *
 * ===========================================================================
 * WHY THIS IS A SECOND FILE AND NOT A PHASE IN bootstrap-state.json
 * ===========================================================================
 * `alreadyEnrolled()` in `bin/enrollment-bootstrap.ts` decides whether the
 * enrolment agent has already succeeded. Until this file existed, the only place
 * to record "pairing is in progress" was `bootstrap-state.json`'s single `phase`
 * — and writing any phase other than `ENROLLED_UNASSIGNED` there makes that
 * predicate answer false, so the agent re-presents a ticket the server already
 * consumed, every thirty seconds, for ever.
 *
 * That is not hypothetical: it is the defect fixed in `70a339d`, which produced
 * `ENROLLMENT_REDEMPTION_422` twice a minute on the first real device and made it
 * report itself UNENROLLED while the fleet held it as `enrolled`.
 *
 * Enrolment and pairing are also two different axes, not two points on one line.
 * A device is enrolled or not; separately, it is assigned to a Store or not.
 * Modelling them as one ordered phase is what made the collision possible.
 *
 * So enrolment keeps sole ownership of `bootstrap-state.json`, whose phase stays
 * `ENROLLED_UNASSIGNED` until the SERVER says otherwise, and pairing gets this.
 *
 * ===========================================================================
 * THIS IS DISPLAY STATE. THE SERVER IS THE TRUTH.
 * ===========================================================================
 * Exactly as `bootstrap-state.ts` records for its own values: these names exist
 * so a console can say something truthful between refreshes. They are NOT a
 * database enum and they never authorize anything. `kitluy_devices.device_assignments`
 * is the authority on whether a Hub is assigned, and it wins on every refresh.
 *
 * In particular `PAIRED` here means "the cloud told us it created an assignment",
 * which is `pending_trust` — NOT active. Activation is certificate-backed and
 * gated on BLK-005, and a device that rendered "ready" off this file would be
 * lying about a Hub that cannot yet serve a terminal.
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

export const PAIRING_STATE_PATH = "/var/lib/kitluy/pairing-state.json";

/**
 * Ordered for rendering only. Nothing advances a device except a server answer.
 *
 * `LOCKED` is a phase rather than a detail string because the operator action it
 * implies is different in kind: stop typing, go back to the Partner Portal and
 * generate a new code. A screen that showed it as just another failure would send
 * someone on retyping a code that can no longer work.
 *
 * `ALREADY_ASSIGNED` is a phase for the same reason, one step further out: the
 * required action is not on this device or in this room at all. The cloud holds
 * a live assignment for this board, so no code — however freshly issued — can
 * redeem. It is recorded rather than merely printed so that the screen still
 * explains itself after a reboot, instead of showing a plain unpaired Hub and
 * inviting the same futile attempt again.
 */
export type PairingPhase =
  "UNPAIRED" | "AWAITING_CODE" | "SUBMITTING" | "PAIRED" | "LOCKED" | "ALREADY_ASSIGNED";

export interface PairingState {
  readonly phase: PairingPhase;
  /** Shown to an operator. Never a secret, and never the presented code. */
  readonly detail?: string;
  /** Server-issued. Absent until the cloud has actually created an assignment. */
  readonly assignmentId?: string;
  /**
   * The generation of that assignment, as the cloud stated it (group 0226). The
   * operational certificate is requested against it. Files written before it
   * existed lack it; `paired-identity.ts` then falls back to 1 and says so. A
   * re-paired Hub is at generation > 1, and requesting at 1 is refused
   * KLUY-CRED-STALE-ASSIGNMENT (hardware, 2026-09-15).
   */
  readonly assignmentGeneration?: number;
  readonly tenantId?: string;
  readonly digitalStoreId?: string;
  readonly storeLocationId?: string;
  /**
   * The device this pairing belongs to. Recorded so a state file left behind by
   * a re-keyed or re-enrolled device cannot be read as this device's pairing —
   * the same discipline `alreadyEnrolled()` applies to enrolment.
   */
  readonly deviceRecordId?: string;
  /** Remaining attempts, when the cloud reported them. Display only. */
  readonly attemptsRemaining?: number;
  readonly updatedAt: string;
}

/** Same atomic discipline as the identity store: temp -> fsync -> rename -> fsync dir. */
export function writePairingState(state: PairingState, path = PAIRING_STATE_PATH): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o750 });
  const temp = `${path}.tmp`;
  // 0644, NOT 0640 — THE UNPRIVILEGED SHELL HAS TO READ THIS.
  //
  // The Device Shell renders this file and runs as `kitluy-terminal`
  // (kitluy-terminal-session.service), not as root. At 0640 root:root it is
  // unreadable to that user: `readObject` catches the EACCES, the view reads as
  // null, and `deriveScreen` falls back to NOT_REGISTERED — so an approved board
  // would sit on "waiting for approval" for ever while the cloud held it
  // approved. `/var/lib/kitluy` is 0751, so traversal already works; only the
  // file mode was in the way.
  //
  // This is display state by construction — the header above says so, and the
  // fields are a phase, a public asset tag and an operator sentence. No secret,
  // no credential, and never the presented pairing code. `bootstrap-state.json`
  // has been 0644 for exactly this reason since it was written.
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
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
 * An unreadable pairing file is treated as "not paired" rather than as an error,
 * because the recovery is identical — present a code — and a Hub that refused to
 * show its prompt over a corrupt display file would be unpairable for a reason
 * that has nothing to do with pairing.
 */
export function readPairingState(path = PAIRING_STATE_PATH): PairingState | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const candidate = parsed as { phase?: unknown };
    return typeof candidate.phase === "string" ? (parsed as PairingState) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the recorded pairing belongs to the device in front of us.
 *
 * A pairing file naming a DIFFERENT device record is stale — the card was copied,
 * or the device re-keyed and re-enrolled — and must not be rendered as this
 * device's Store. Same reasoning as `alreadyEnrolled()`.
 */
export function pairingBelongsTo(
  state: PairingState | null,
  deviceRecordId: string | undefined,
): boolean {
  if (state === null || deviceRecordId === undefined) return false;
  return state.deviceRecordId === deviceRecordId;
}
