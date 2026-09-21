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
/**
 * What software the shell is actually running (U1 requirement 4).
 *
 * Composed on the Electron side from the launcher's own witness and the release
 * journal, and rendered so that a board running the IMAGE FALLBACK can never be
 * mistaken for one running the assigned release. That mistake costs an
 * afternoon: the screen looks right, the board is healthy, and the change the
 * developer published is simply not there.
 */
export interface ReleaseView {
  /** What the launcher exec'd. UNKNOWN before it has written its witness. */
  readonly source: "RELEASE" | "IMAGE_FALLBACK" | "UNKNOWN";
  /** The version running, when a release is running. Null for the image copy. */
  readonly runningVersion: string | null;
  /** What the store would run on the next restart, when it differs. */
  readonly installedVersion: string | null;
  /** True when a restart would change what is running. */
  readonly stale: boolean;
  /** Why the image copy is running, when it is. */
  readonly fallbackReason: string | null;
  /** The last install outcome, for the operator line. */
  readonly lastOutcome: "INSTALLED" | "ROLLED_BACK" | "REFUSED" | "INTERRUPTED" | null;
  readonly lastReason: string | null;
}

/**
 * The Terminal PIN's public posture, as the root agent publishes it: `absent`
 * (no Hub has confirmed one for this board) or `registered` (the Store Hub
 * holds it). Never digits. `sealed` is accepted from an older agent and read
 * as `absent` (KLD-2026-09-19-PIN-AFTER-PAIRING-001: nothing waits on the
 * board any more).
 */
export interface DevicePinView {
  readonly state: "absent" | "registered";
}

/**
 * The Store Hub link as terminal-edge publishes it (`terminal/edge-status.json`):
 * the phase and the Hub's own answer about the Terminal PIN. `setup_required`
 * from a SERVING Hub is what opens the PIN screen — the Hub is the verifier,
 * so only the Hub's word starts the setup.
 */
export interface EdgeLinkView {
  readonly phase: string;
  readonly terminalPinState: "setup_required" | "set" | "reset_required" | null;
}

/**
 * What the update runtime is doing with the POS application, from its journal.
 * `IDLE` with nothing installed is the wait before the first check; the phases
 * follow the install pass; `COMMITTED` means the application is installed.
 */
export interface ApplicationInstallView {
  readonly phase: "IDLE" | "ACTIVATING" | "HEALTH_PENDING" | "COMMITTED" | "ROLLED_BACK" | "FAILED";
  readonly installedVersion: string | null;
  readonly lastOutcome: "INSTALLED" | "ROLLED_BACK" | "REFUSED" | "INTERRUPTED" | null;
  readonly lastReason: string | null;
}

export interface ShellSnapshot {
  readonly registration: RegistrationView | null;
  readonly pairing: PairingView | null;
  /** Absent on an image whose agent predates the device PIN; reads as `absent`. */
  readonly devicePin?: DevicePinView | null;
  /** The Store Hub link, once terminal-edge has written its status. */
  readonly edge?: EdgeLinkView | null;
  /** The POS application's install journal, when the image carries a release runtime. */
  readonly application?: ApplicationInstallView | null;
  /** The terminal's own seat, absent until it pairs. */
  readonly assignment?: AssignmentView | null;
  readonly network: NetworkState;
  /** This device's identity key fingerprint, to test `registrationBelongsTo`. */
  readonly keyFingerprint?: string;
  /** This device's server record id, to test `pairingBelongsTo`. */
  readonly deviceRecordId?: string;
  /** Absent on an image with no release runtime; the screen then says nothing. */
  readonly release?: ReleaseView | null;
}

/**
 * The one line the screen shows about software. Deliberately short — it sits
 * under the device label, not in place of the state the shell exists to render.
 *
 * Returns null when there is nothing worth saying: a board that has never had a
 * release and is running the image it was flashed with is the normal case and
 * does not need a caption.
 */
export function releaseCaption(snapshot: ShellSnapshot): {
  readonly text: string;
  readonly tone: "normal" | "attention";
} | null {
  const release = snapshot.release ?? null;
  if (release === null) return null;

  if (release.source === "IMAGE_FALLBACK") {
    // A device with a release installed but the image copy running is the case
    // that must never look normal.
    if (release.installedVersion !== null || release.stale) {
      return {
        text: `Image software · ${release.installedVersion ?? "an update"} is installed and starts on restart`,
        tone: "attention",
      };
    }
    if (release.lastOutcome === "ROLLED_BACK" || release.lastOutcome === "REFUSED") {
      return {
        text: `Image software · last update ${release.lastOutcome.toLowerCase().replace("_", " ")}`,
        tone: "attention",
      };
    }
    return null; // never updated, running what it was flashed with
  }

  if (release.source === "RELEASE") {
    // A release IS running but not the one that is installed. The version of
    // the running one is not recorded — only the committed one is — so this
    // says what is true rather than guessing a number. Found by a test that
    // expected a caption here and got none, which is the silent case this
    // whole function exists to prevent.
    if (release.runningVersion === null) {
      return {
        text: `Older release running · ${release.installedVersion ?? "a newer version"} starts on restart`,
        tone: "attention",
      };
    }
    if (release.stale) {
      return {
        text: `${release.runningVersion} · ${release.installedVersion ?? "a newer version"} starts on restart`,
        tone: "attention",
      };
    }
    return { text: release.runningVersion, tone: "normal" };
  }
  return null;
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
  | { readonly kind: "assigned"; readonly deviceLabel: string | null }
  /** T1-FIRST-BOOT-PIN-001: a fresh board creates its device PIN before anything else. */
  | { readonly kind: "pin_setup"; readonly deviceLabel: string | null }
  /** Paired; the application is being fetched, activated or health-checked. */
  | {
      readonly kind: "installing";
      readonly deviceLabel: string | null;
      readonly phase: ApplicationInstallView["phase"];
      readonly failed: boolean;
    };

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

  // A halted board is halted whatever else is true — including before its PIN.
  if (phase === "CONTAINED") return { kind: "halted", reason: "contained", deviceLabel };
  if (phase === "TRUST_REVIEW_REQUIRED") {
    return { kind: "halted", reason: "trust_review", deviceLabel };
  }
  switch (phase) {
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
      if (!paired) return { kind: "approved_unassigned", deviceLabel };
      // PAIRED AND CONNECTED: the Terminal PIN is created NOW, on the Store Hub
      // (owner ruling 2026-09-19 — "right after we paired and successfully
      // activated"). The Hub says whether one is missing; the board's posture
      // only bridges the seconds until the Hub's status is re-read.
      const edge = snapshot.edge ?? null;
      if (
        edge !== null &&
        edge.phase === "SERVING" &&
        edge.terminalPinState === "setup_required" &&
        (snapshot.devicePin?.state ?? "absent") !== "registered"
      ) {
        return { kind: "pin_setup", deviceLabel };
      }
      // Then the application is on its way. The shell shows the install (it is
      // stopped the moment the POS unit takes the seat, so this is what a person
      // sees between the PIN and the counter).
      const app = snapshot.application ?? null;
      if (app !== null && app.phase !== "COMMITTED") {
        return {
          kind: "installing",
          deviceLabel,
          phase: app.phase,
          failed: app.phase === "ROLLED_BACK" || app.phase === "FAILED",
        };
      }
      return { kind: "assigned", deviceLabel };
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
