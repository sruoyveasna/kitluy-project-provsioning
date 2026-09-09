/**
 * Which screen the Device Shell shows, derived purely from a snapshot of the
 * device's own state files.
 *
 * ===========================================================================
 * DISPLAY STATE. THE CLOUD IS THE TRUTH.
 * ===========================================================================
 * These phases are copied from the firstboot agent's `registration-state.ts` and
 * `pairing-state.ts`, which are themselves display state, not a database enum.
 * The shell renders the same registration state the Store Hub console renders and
 * must never disagree with it — so the phase unions and the label/headline
 * wording are mirrored here, and `test/drift.test.ts` imports the agent and
 * fails if the two ever diverge.
 *
 * Nothing here authorises anything. `APPROVED` means the cloud answered "known,
 * approved" for this board — NOT that it holds an operational certificate. There
 * is deliberately NO screen that offers a business app: a Pi reaches
 * `approved_unassigned`, takes a pairing code, and that is the end of what this
 * slice can do (owner decision v2.0.0 §5).
 */

/** Mirror of the agent's `RegistrationPhase` (registration-state.ts). */
export type RegistrationPhase =
  | "NOT_REGISTERED"
  | "REGISTERING"
  | "AWAITING_APPROVAL"
  | "TRUST_REVIEW_REQUIRED"
  | "APPROVED"
  | "CONTAINED"
  | "UNREACHABLE";

/** Mirror of the agent's `PairingPhase` (pairing-state.ts). */
export type PairingPhase =
  "UNPAIRED" | "AWAITING_CODE" | "SUBMITTING" | "PAIRED" | "LOCKED" | "ALREADY_ASSIGNED";

/** The registration fields the shell reads. A subset of the agent's shape. */
export interface RegistrationView {
  readonly phase: RegistrationPhase;
  readonly deviceId?: string;
  readonly detail?: string;
  /** The registration key this state belongs to (see `registrationBelongsTo`). */
  readonly keyFingerprint?: string;
}

/** The pairing fields the shell reads. A subset of the agent's shape. */
export interface PairingView {
  readonly phase: PairingPhase;
  readonly detail?: string;
  /** The device this pairing belongs to (see `pairingBelongsTo`). */
  readonly deviceRecordId?: string;
}

/**
 * The seat a paired terminal holds, as the shell reads it back.
 *
 * Mirrors `electron/terminal-assignment.ts`. This is the TERMINAL's own record,
 * written into the kiosk user's directory, and it is a different file from the
 * Store Hub's `pairing-state.json` for the reason recorded there: the Hub's
 * console runs as root and this shell deliberately does not.
 */
export interface AssignmentView {
  readonly deviceRecordId: string;
  /** False until trust is advanced. Pairing alone never makes this true. */
  readonly activated: boolean;
  readonly digitalStoreReference: string;
  readonly storeLocationReference: string;
  readonly physicalTerminalLabel: string;
}

export interface NetworkState {
  /** A cable or associated Wi-Fi — a physical link exists. */
  readonly hasLink: boolean;
  /** A default route exists — the device can actually reach off-LAN. */
  readonly hasRoute: boolean;
}

/**
 * Everything the renderer needs, gathered by the Electron main process from the
 * device's state files and sysfs. `null` on a field means "the file was absent
 * or unreadable", which the agent treats as the safe/earliest state, and so do
 * we.
 */
export interface ShellSnapshot {
  readonly registration: RegistrationView | null;
  readonly pairing: PairingView | null;
  /** The terminal's own seat, absent until it pairs. */
  readonly assignment?: AssignmentView | null;
  readonly network: NetworkState;
  /** This device's identity key fingerprint, to test `registrationBelongsTo`. */
  readonly keyFingerprint?: string;
  /** This device's server record id, to test `pairingBelongsTo`. */
  readonly deviceRecordId?: string;
}

export type WaitingSub = "NOT_REGISTERED" | "REGISTERING" | "AWAITING_APPROVAL" | "UNREACHABLE";

export type ShellScreen =
  | { readonly kind: "booting" }
  | {
      readonly kind: "waiting_for_approval";
      readonly sub: WaitingSub;
      readonly deviceLabel: string | null;
      readonly noNetwork: boolean;
    }
  | {
      readonly kind: "halted";
      readonly reason: "trust_review" | "contained";
      readonly deviceLabel: string | null;
    }
  | { readonly kind: "approved_unassigned"; readonly deviceLabel: string | null }
  | { readonly kind: "assigned"; readonly deviceLabel: string | null };

/**
 * THE ASSET TAG, DERIVED ONCE — mirror of the agent's `assetTagFromFingerprint`.
 *
 * `KL-` + the first twelve hex digits of the registration key fingerprint. This
 * is the string the registration client sends and the Admin Portal lists, so the
 * person at the Pi and the person at the portal name the board the same way. A
 * label, not an identity: it authorises nothing.
 */
export function assetTagFromFingerprint(fingerprint: string): string {
  return `KL-${fingerprint.slice(0, 12).toUpperCase()}`;
}

/** Mirror of the agent's `registrationBelongsTo`. */
export function registrationBelongsTo(
  registration: RegistrationView | null,
  keyFingerprint: string | undefined,
): boolean {
  if (registration === null || keyFingerprint === undefined) return false;
  return registration.keyFingerprint === keyFingerprint;
}

/** Mirror of `assignmentBelongsTo` in electron/terminal-assignment.ts. */
export function assignmentBelongsTo(
  assignment: AssignmentView | null | undefined,
  deviceRecordId: string | undefined,
): boolean {
  if (assignment === null || assignment === undefined || deviceRecordId === undefined) return false;
  return assignment.deviceRecordId === deviceRecordId;
}

/** Mirror of the agent's `pairingBelongsTo`. */
export function pairingBelongsTo(
  pairing: PairingView | null,
  deviceRecordId: string | undefined,
): boolean {
  if (pairing === null || deviceRecordId === undefined) return false;
  return pairing.deviceRecordId === deviceRecordId;
}

/**
 * The human-readable board label for the screen.
 *
 * Derived from the registration key fingerprint the state file persists — the
 * SAME `KL-` + 12-hex asset tag the registration client sent and the Admin
 * Portal lists, so the person at the Pi and the person at the portal name the
 * board identically (the fix made in Slice 1A's `bootstrap-ui`). Falls back to
 * the opaque cloud device id, then to nothing.
 *
 * The stale-card guard (`registrationBelongsTo` against the device's live
 * identity fingerprint) is deferred to the sealed-identity work in Phase 3,
 * where the shell can read that fingerprint without touching the private key;
 * the function is kept and exported here as the agreed mirror the drift test
 * checks.
 */
export function deviceLabelOf(snapshot: ShellSnapshot): string | null {
  const reg = snapshot.registration;
  if (reg === null) return null;
  if (reg.keyFingerprint !== undefined && reg.keyFingerprint.length >= 12) {
    return assetTagFromFingerprint(reg.keyFingerprint);
  }
  return reg.deviceId ?? null;
}

/**
 * Which screen to show, given a snapshot.
 *
 * `null` snapshot is the pre-IPC first paint → `booting`. Order of precedence:
 * a halted board is halted whatever else is true; an approved board that holds a
 * live pairing for ITSELF is `assigned`; an approved board otherwise takes a
 * code; everything else is a flavour of waiting. "No network" is a flag on the
 * waiting screen, not a screen of its own — a board with no link is still
 * waiting, it just also needs a cable.
 */
export function deriveScreen(snapshot: ShellSnapshot | null): ShellScreen {
  if (snapshot === null) return { kind: "booting" };

  const phase = snapshot.registration?.phase ?? "NOT_REGISTERED";
  const deviceLabel = deviceLabelOf(snapshot);
  const noNetwork = !snapshot.network.hasRoute;

  switch (phase) {
    case "CONTAINED":
      return { kind: "halted", reason: "contained", deviceLabel };
    case "TRUST_REVIEW_REQUIRED":
      return { kind: "halted", reason: "trust_review", deviceLabel };
    case "APPROVED": {
      // TWO WAYS TO BE ASSIGNED, because two devices record it differently.
      //
      // A Store Hub's root console writes `pairing-state.json`; this terminal's
      // unprivileged shell writes its own `assignment.json`. Both mean the cloud
      // created an assignment for THIS board, and either is enough. Both are
      // checked against the device record id, so a card copied from another
      // board shows the keypad rather than someone else's Store.
      const paired =
        (snapshot.pairing?.phase === "PAIRED" &&
          pairingBelongsTo(snapshot.pairing, snapshot.deviceRecordId)) ||
        assignmentBelongsTo(snapshot.assignment, snapshot.deviceRecordId);
      return paired
        ? { kind: "assigned", deviceLabel }
        : { kind: "approved_unassigned", deviceLabel };
    }
    case "REGISTERING":
      return { kind: "waiting_for_approval", sub: "REGISTERING", deviceLabel, noNetwork };
    case "AWAITING_APPROVAL":
      return { kind: "waiting_for_approval", sub: "AWAITING_APPROVAL", deviceLabel, noNetwork };
    case "UNREACHABLE":
      return { kind: "waiting_for_approval", sub: "UNREACHABLE", deviceLabel, noNetwork: true };
    case "NOT_REGISTERED":
      return { kind: "waiting_for_approval", sub: "NOT_REGISTERED", deviceLabel, noNetwork };
  }
}

/**
 * The message key for a pairing outcome.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * `App.tsx` used to DISCARD the transport's answer and always render
 * "Pairing is not available in this build yet" — correct while Slice 1B had no
 * transport, and wrong from the moment one shipped. The result was a terminal
 * that paired successfully and told the person standing at it that the feature
 * did not exist. Observed on hardware 2026-09-09.
 *
 * Every branch is a key, never a sentence: the server's own prose is not shown
 * because it is written for an operator reading a log, not for a shop.
 */
export type PairingMessageKey =
  | "pairingPaired"
  | "pairingRefused"
  | "pairingLocked"
  | "pairingAlreadyAssigned"
  | "pairingNotRegistered"
  | "pairingUnreachable"
  | "pairingNotAvailable"
  | "pairingFailed";

export function pairingMessageKey(status: string): PairingMessageKey {
  switch (status) {
    case "PAIRED":
      return "pairingPaired";
    case "CODE_REFUSED":
    case "CODE_MALFORMED":
      return "pairingRefused";
    case "LOCKED":
      return "pairingLocked";
    case "ALREADY_ASSIGNED":
      return "pairingAlreadyAssigned";
    case "NO_DEVICE_RECORD":
      return "pairingNotRegistered";
    case "PAIRING_UNREACHABLE":
      return "pairingUnreachable";
    // The build genuinely has no transport — an image packaged without the
    // agent's pairing client. Distinct from every refusal above, because the
    // answer is "reflash", not "try again".
    case "PAIRING_TRANSPORT_UNAVAILABLE":
      return "pairingNotAvailable";
    default:
      // Anything the registry adds later reads as a plain failure rather than
      // as success. Failing closed matters more here than covering every code.
      return "pairingFailed";
  }
}
