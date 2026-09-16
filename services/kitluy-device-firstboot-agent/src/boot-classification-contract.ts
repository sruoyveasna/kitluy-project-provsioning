/**
 * The Boot & Recovery Classification Contract.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 (2026-09-16). It sits
 * on top of decisions that are already locked and re-decides none of them:
 * KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001 (a re-flashed known board
 * recovers its credential), KLD-2026-08-06-WS11-T006-001 (a Hub identity may
 * never be cloned; replacement is four-eyes and HET-run), KLV4-DEC-007 (Store
 * staff do not replace or reimage Hub NVMe storage), and the register's
 * "storage evidence never resolves identity".
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 * A board boots. Something about it may have changed: a new SD card, somebody
 * else's SD card, a different Pi, a card from two recoveries ago, a quarantined
 * device, no network. Today each layer answers a fragment of that question —
 * `registration-state.json` says one thing, `pairing-state.json` another, the
 * certificate manifest a third, and the cloud's doors hold the truth — and
 * nothing puts the fragments together. So the board cannot say the one sentence
 * a shop needs: what happened, and what to do about it.
 *
 * This module is that sentence, computed once, from evidence, as a pure
 * function. It decides nothing about authorisation: every governed door
 * (`register_device_v1`, `redeem_device_claim_v1`, `activate_device_v1`,
 * `reserve_device_credential_recovery_v2`, the pairing sessions) keeps its own
 * refusals. A classification is a DESCRIPTION plus ONE next action.
 *
 * ===========================================================================
 * THE RULE THAT SHAPES EVERY BRANCH
 * ===========================================================================
 * The permanent physical device identity is authoritative; the SD card is
 * replaceable local state. The card may therefore never redefine which device
 * this is, which Store it belongs to, or what class of device it is. Where the
 * card and the hardware disagree, the hardware wins and the card is refused.
 *
 * ===========================================================================
 * WHY IT IS PURE, AND WHERE IT RUNS
 * ===========================================================================
 * Assembling evidence needs the cloud (only the cloud can say which device a
 * board serial is, and whether it is quarantined). Deciding needs no I/O. So
 * the decision is a pure function with an explicit evidence record: the
 * registry service builds the evidence from the governed reads and calls this;
 * tests build the evidence directly and cover situations no fixture could reach
 * otherwise. One vocabulary, one decision table, one set of reason codes,
 * shared by the service, the API, the portals and the board runtime.
 */

/** The classes a KitLuy boot IMAGE is built for. */
export type DeviceClass = "store_hub" | "terminal";

/**
 * The classes the cloud records. Mirrors `kitluy_devices.device_class` in full:
 * a Store image booted on a factory station or a peripheral is wrong media, and
 * the type must be able to say so.
 */
export type CloudDeviceClass = DeviceClass | "manufacturing_station" | "peripheral";

/**
 * How the cloud resolved this physical board from the hardware evidence it
 * presented. Mirrors `resolve_device_by_board_evidence_v1` (group 0197):
 * `board_serial` is the anchor, `soc_serial` corroborates, MAC alone is never
 * enough to resolve, and storage evidence is deliberately never consulted.
 */
export type BoardResolution =
  /** A live device record is anchored to this board's serial. */
  | "resolved"
  /** No device record matches this board. A genuinely new (or re-serialled) Pi. */
  | "unknown"
  /** MAC matched but no board serial did: the cloud refuses to guess. */
  | "review_mac_only"
  /** More than one live device claims this board. */
  | "conflict"
  /**
   * The cloud was NOT consulted on this boot — no network, or the
   * classification call failed. Nothing about identity may be concluded from
   * it: an unresolved board is never "new" and never "replaced", it waits.
   * Only the board-local classification produces this; the cloud never does.
   */
  | "unresolved";

/** Where a device is meant to run. Mirrors the governed environment vocabulary. */
export type DeviceEnvironment = "development" | "pilot" | "production";

/** Lifecycle of the cloud device record. Mirrors `kitluy_devices.device_lifecycle`. */
export type DeviceLifecycle =
  | "manufactured"
  | "enrolled"
  | "awaiting_trust"
  | "quarantined"
  | "restricted_investigation"
  | "active"
  | "suspended"
  | "retired"
  | "replaced";

/** What `register_device_v1` answered on this boot, if it was reached. */
export type RegistrationOutcome =
  | "PENDING_APPROVAL"
  | "KNOWN_DEVICE_INSTALLATION_REGISTERED"
  | "TRUST_REVIEW_REQUIRED"
  | "REFUSED"
  | "UNREACHABLE";

/** Where the Store Hub's encrypted data volume stands, when the board has one. */
export type StoragePosture =
  | "absent"
  /** Opened with this board's own key. */
  | "opened"
  /** A LUKS container this board cannot open: another board's volume. */
  | "foreign"
  /** Present, not a KitLuy volume, and never destroyed automatically. */
  | "unidentified"
  /**
   * A drive is present but this boot did not open the Store's volume. The
   * board cannot say why — the storage key posture may be unresolved (the
   * development marker lives on the card, so every re-flash loses it) or the
   * key may not fit — so it claims neither "foreign" nor "unidentified", which
   * would each tell the shop something that may be false. See GAP-BOOT-006.
   */
  | "not_opened"
  /** Opened, but the data inside names a different Hub or Store (see GAPS). */
  | "opened_foreign_contents";

/**
 * What the CARD claims about itself: the local state files, read as claims and
 * never as authority. Absent fields mean a fresh or wiped card.
 */
export interface MediaClaims {
  /** From `registration-state.json` / `pairing-state.json` / the credential manifest. */
  readonly deviceRecordId?: string;
  /** The enrollment the adopted certificate was issued under. */
  readonly certificateEnrollmentId?: string;
  /**
   * The fingerprint of the identity key this card registered with
   * (`registration-state.json` `keyFingerprint`, SHA-256 of the SPKI). The card
   * does not record its enrollment id, but it does hold this, and the cloud's
   * current enrollment carries the same fingerprint — so a card whose identity
   * a later re-flash replaced is recognised even before recovery completes.
   */
  readonly identityKeyFingerprint?: string;
  /** The credential generation the card holds a certificate for. */
  readonly certificateGeneration?: number;
  /** The assignment generation the card was paired at. */
  readonly assignmentGeneration?: number;
  /** The Store scope the card was paired into. */
  readonly digitalStoreId?: string;
  readonly storeLocationId?: string;
  /** The class the IMAGE on this card was built for (`/etc/kitluy/image.env`). */
  readonly imageDeviceClass: DeviceClass;
  /** True when the card holds an adopted operational certificate. */
  readonly hasAdoptedCredential: boolean;
  /** The environment the image was built for (`KITLUY_ENVIRONMENT`). */
  readonly imageEnvironment: DeviceEnvironment;
}

/** What the cloud holds about the device this board actually is. */
export interface CloudDeviceFacts {
  readonly deviceRecordId: string;
  readonly deviceClass: CloudDeviceClass;
  /** The environment the cloud holds this device in. */
  readonly environment: DeviceEnvironment;
  readonly lifecycle: DeviceLifecycle;
  /** Open trust incidents, excluding `activation_blocked` (which is not a lock). */
  readonly openTrustIncidentCount: number;
  /** `devices.current_enrollment_id`. */
  readonly currentEnrollmentId: string;
  /** `manufacturing_enrollments.device_public_key_fingerprint` of that enrollment. */
  readonly currentIdentityKeyFingerprint?: string;
  /** `devices.assignment_generation`; 0 when the device holds no live assignment. */
  readonly assignmentGeneration: number;
  /** The live assignment, when there is one. */
  readonly assignment?: {
    readonly state: "pending_trust" | "active";
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
  };
  /** Head of the credential chain; absent before first issuance. */
  readonly credentialHeadGeneration?: number;
  /**
   * The head's PREVIOUS generation, present only while its overlap window is
   * still open (`device_credential_heads.overlap_ends_at` in the future). A
   * card at that generation is still honoured by every verifier, so calling it
   * outdated would stop a working shop until the window closed.
   */
  readonly honouredPreviousGeneration?: number;
  /** The active operational certificate, when one exists. */
  readonly activeCertificate?: {
    readonly generation: number;
    readonly enrollmentId: string;
  };
  /**
   * The seat this device is bound to, and the seat the CARD's scope implies.
   * `occupiedByOtherDevice` is true when the seat already holds another board.
   */
  readonly seat?: {
    readonly physicalTerminalId: string;
    readonly occupiedByOtherDevice: boolean;
  };
}

/** Whether this boot could reach anything. */
export interface Connectivity {
  readonly networkUp: boolean;
  readonly cloudReachable: boolean;
}

/** Everything the decision is allowed to look at. */
export interface BootEvidence {
  readonly boardResolution: BoardResolution;
  /** The refusal the resolver or registration gave, verbatim, for the admin. */
  readonly resolutionDetail?: string;
  readonly registration?: RegistrationOutcome;
  readonly media: MediaClaims;
  /** Absent when the board is unknown to the cloud, or the cloud was unreachable. */
  readonly cloudDevice?: CloudDeviceFacts;
  readonly connectivity: Connectivity;
  /** Store Hub only. */
  readonly storage?: StoragePosture;
  /**
   * Board-local, offline only: the most recent CLOUD classification of this
   * exact card was READY, and it was recorded on this same board (the board
   * serial the board reads from its own hardware matched). It lets an adopted
   * device keep trading through an outage. A card cloned into another Pi does
   * not carry it, because that Pi's serial differs.
   */
  readonly confirmedReadyOnThisBoard?: boolean;
}

/** The six outcomes a shop can be shown, plus the waiting states. */
export type BootClassification =
  | "READY"
  | "RECOVERING_DEVICE"
  | "NEW_DEVICE"
  | "WRONG_MEDIA"
  | "REPLACE_HARDWARE"
  | "SECURITY_LOCK"
  | "WAITING";

/** The single action offered. Portals map these to one button. */
export type NextAction =
  /** Nothing to do; the device is working or will continue on its own. */
  | "NONE"
  /** Wait: a transient state, retried automatically. */
  | "WAIT"
  /** Type a pairing code from the Partner Portal on this device. */
  | "ENTER_PAIRING_CODE"
  /** Partner: release this device from its Store, then pair it again. */
  | "RELEASE_DEVICE_THEN_PAIR"
  /** Admin: verify and approve the device. */
  | "APPROVE_ENROLLMENT"
  /** Partner/Admin: run the governed replacement for this seat or Hub. */
  | "REPLACE_DEVICE"
  /** Put the right card in, or reinstall KitLuy for THIS device. */
  | "INSERT_CORRECT_MEDIA"
  /** Only an administrator can move this forward. */
  | "CONTACT_ADMIN"
  /** HET-only service: Hub storage and hardware replacement (KLV4-DEC-007). */
  | "CONTACT_HET_SUPPORT";

/** Reason codes. Technical, for logs, Admin and tests — never shown to a shop. */
export type BootReasonCode =
  | "KLUY-BOOT-READY"
  | "KLUY-BOOT-WAITING-NETWORK"
  | "KLUY-BOOT-WAITING-CLOUD"
  | "KLUY-BOOT-WAITING-APPROVAL"
  | "KLUY-BOOT-RECOVERY-IN-PROGRESS"
  | "KLUY-BOOT-RECOVERY-FRESH-MEDIA"
  | "KLUY-BOOT-RECOVERY-NEEDS-RELEASE"
  | "KLUY-BOOT-RECOVERY-NEEDS-PAIRING"
  | "KLUY-BOOT-NEW-DEVICE"
  | "KLUY-BOOT-NEW-DEVICE-APPROVED"
  | "KLUY-BOOT-MEDIA-OTHER-DEVICE"
  | "KLUY-BOOT-MEDIA-OTHER-STORE"
  | "KLUY-BOOT-MEDIA-WRONG-DEVICE-CLASS"
  | "KLUY-BOOT-MEDIA-WRONG-ENVIRONMENT"
  | "KLUY-BOOT-LOCKED-REGISTRATION-REFUSED"
  | "KLUY-BOOT-MEDIA-OUTDATED"
  | "KLUY-BOOT-HARDWARE-REPLACED"
  | "KLUY-BOOT-HARDWARE-SEAT-OCCUPIED"
  | "KLUY-BOOT-LOCKED-QUARANTINED"
  | "KLUY-BOOT-LOCKED-CONTAINED"
  | "KLUY-BOOT-LOCKED-RETIRED"
  | "KLUY-BOOT-LOCKED-INCIDENT"
  | "KLUY-BOOT-LOCKED-TRUST-REVIEW"
  | "KLUY-BOOT-LOCKED-EVIDENCE-CONFLICT"
  | "KLUY-BOOT-STORAGE-FOREIGN"
  | "KLUY-BOOT-STORAGE-UNIDENTIFIED"
  | "KLUY-BOOT-STORAGE-NOT-OPENED"
  | "KLUY-BOOT-STORAGE-FOREIGN-CONTENTS";

/**
 * Message keys, not sentences. The shop-facing copy lives where the copy always
 * lives — the Device Shell's `messages.ts` and the portals' — so it stays
 * translatable. `DEFAULT_USER_MESSAGES` below is the English fallback the
 * console uses, and it is deliberately free of identifiers, codes and numbers.
 */
export type BootMessageKey =
  | "boot.ready"
  | "boot.waiting.network"
  | "boot.waiting.network.serving"
  | "boot.waiting.cloud"
  | "boot.waiting.approval"
  | "boot.recovering"
  | "boot.recovering.needsRelease"
  | "boot.recovering.needsPairing"
  | "boot.newDevice"
  | "boot.wrongMedia"
  | "boot.wrongMedia.outdated"
  | "boot.wrongMedia.deviceClass"
  | "boot.wrongMedia.environment"
  | "boot.wrongMedia.otherStore"
  | "boot.replaceHardware"
  | "boot.seatOccupied"
  | "boot.locked"
  | "boot.storage.foreign"
  | "boot.storage.support";

export interface BootDecision {
  readonly classification: BootClassification;
  readonly reasonCode: BootReasonCode;
  readonly nextAction: NextAction;
  /** What the shop is told. A key; see DEFAULT_USER_MESSAGES. */
  readonly userMessageKey: BootMessageKey;
  /**
   * The technical sentence for Admin, logs and support. It may name states,
   * generations and refusal codes: this string is never shown to a shop.
   */
  readonly adminDetail: string;
  /** True while the board should keep retrying on its own. */
  readonly retryAutomatically: boolean;
  /**
   * True when this device can go on serving its shop right now, whatever the
   * classification says. An adopted credential needs no cloud round trip, so a
   * Hub that loses the WAN keeps trading and must never be shown an error
   * (owner task §4). The runtime reads THIS, not the classification, before it
   * decides to stop serving anything.
   */
  readonly servesLocally: boolean;
}

/** English fallback copy. No identifiers, no codes, no generations. */
export const DEFAULT_USER_MESSAGES: Readonly<Record<BootMessageKey, string>> = {
  "boot.ready": "KitLuy is ready.",
  "boot.waiting.network": "No network. KitLuy will reconnect automatically.",
  "boot.waiting.network.serving":
    "Internet unavailable. Your shop keeps working. KitLuy will reconnect automatically.",
  "boot.waiting.cloud": "Waiting for KitLuy Cloud. No action required.",
  "boot.waiting.approval": "Waiting for approval. No action required.",
  "boot.recovering": "Recovering device… No action required.",
  "boot.recovering.needsRelease":
    "This device is still assigned to its shop. Release it in KitLuy, then pair it again.",
  "boot.recovering.needsPairing": "Enter the pairing code from KitLuy to finish setting up.",
  "boot.newDevice": "New KitLuy device detected. Waiting for approval.",
  "boot.wrongMedia": "Wrong SD card. This card belongs to another KitLuy device.",
  "boot.wrongMedia.outdated":
    "This SD card is out of date. Reinstall KitLuy on this card to use it again.",
  "boot.wrongMedia.deviceClass":
    "Wrong SD card. This card is for a different kind of KitLuy device.",
  "boot.wrongMedia.environment":
    "This SD card carries a test build. Reinstall KitLuy on this card to use it here.",
  "boot.wrongMedia.otherStore": "Wrong SD card. This card belongs to another shop.",
  "boot.replaceHardware": "New hardware detected. Replace the old device in KitLuy to continue.",
  "boot.seatOccupied": "This position already has a device. Replace it in KitLuy to continue.",
  "boot.locked": "Device locked. Contact your administrator.",
  "boot.storage.foreign":
    "This Store Hub's storage belongs to another Hub. Contact KitLuy support.",
  "boot.storage.support": "Store Hub storage needs attention. Contact KitLuy support.",
};

/** Lifecycles that are a lock, with the reason each one gets. */
const LOCKED_LIFECYCLES: Readonly<Partial<Record<DeviceLifecycle, BootReasonCode>>> = {
  quarantined: "KLUY-BOOT-LOCKED-QUARANTINED",
  restricted_investigation: "KLUY-BOOT-LOCKED-CONTAINED",
  suspended: "KLUY-BOOT-LOCKED-CONTAINED",
  retired: "KLUY-BOOT-LOCKED-RETIRED",
  replaced: "KLUY-BOOT-LOCKED-RETIRED",
};

function lock(reasonCode: BootReasonCode, adminDetail: string): BootDecision {
  return {
    classification: "SECURITY_LOCK",
    reasonCode,
    nextAction: "CONTACT_ADMIN",
    userMessageKey: "boot.locked",
    adminDetail,
    // A lock is a decision, not a wait. Retrying cannot change it, and a board
    // that kept trying would look broken instead of held.
    retryAutomatically: false,
    // A locked device stops serving: that is what a lock is for.
    servesLocally: false,
  };
}

function waiting(
  reasonCode: BootReasonCode,
  userMessageKey: BootMessageKey,
  adminDetail: string,
  servesLocally = false,
): BootDecision {
  return {
    classification: "WAITING",
    reasonCode,
    nextAction: "WAIT",
    userMessageKey,
    adminDetail,
    retryAutomatically: true,
    servesLocally,
  };
}

/**
 * The storage locks, which need no cloud fact: the drive either opens with this
 * board's key or it does not. Shared by the cloud-evaluated path (step 7) and
 * the path where no device record is known (step 4), so an offline Hub or an
 * unseen board carrying another Hub's drive is never told to wait or enroll.
 */
function storageLock(storage: StoragePosture | undefined): BootDecision | undefined {
  // KLV4-DEC-007: Store staff do not repair or reimage Hub storage. The board
  // still says which of the three situations it is, and asks for HET.
  if (storage === "foreign") {
    return {
      classification: "SECURITY_LOCK",
      reasonCode: "KLUY-BOOT-STORAGE-FOREIGN",
      nextAction: "CONTACT_HET_SUPPORT",
      userMessageKey: "boot.storage.foreign",
      adminDetail: "the data volume is a LUKS container this board cannot open",
      retryAutomatically: false,
      servesLocally: false,
    };
  }
  if (storage === "opened_foreign_contents") {
    return {
      classification: "SECURITY_LOCK",
      reasonCode: "KLUY-BOOT-STORAGE-FOREIGN-CONTENTS",
      nextAction: "CONTACT_HET_SUPPORT",
      userMessageKey: "boot.storage.foreign",
      adminDetail: "the data volume opened but its records name another Hub or Store",
      retryAutomatically: false,
      servesLocally: false,
    };
  }
  if (storage === "unidentified") {
    return {
      classification: "SECURITY_LOCK",
      reasonCode: "KLUY-BOOT-STORAGE-UNIDENTIFIED",
      nextAction: "CONTACT_HET_SUPPORT",
      userMessageKey: "boot.storage.support",
      adminDetail:
        "the drive holds a filesystem that is not a KitLuy volume; nothing was destroyed",
      retryAutomatically: false,
      servesLocally: false,
    };
  }
  if (storage === "not_opened") {
    return {
      classification: "SECURITY_LOCK",
      reasonCode: "KLUY-BOOT-STORAGE-NOT-OPENED",
      nextAction: "CONTACT_HET_SUPPORT",
      userMessageKey: "boot.storage.support",
      adminDetail:
        "a drive is present but the Store volume was not opened this boot; check kitluy-hub-storage " +
        "(an unresolved key posture after a re-flash, or a key that does not fit)",
      retryAutomatically: false,
      servesLocally: false,
    };
  }
  return undefined;
}

/**
 * Classify one boot.
 *
 * ORDER IS THE CONTRACT. Security first, then identity, then media freshness,
 * then progress. Each branch returns; nothing falls through to a friendlier
 * answer after a hostile one.
 */
export function classifyBoot(evidence: BootEvidence): BootDecision {
  const { media, cloudDevice, connectivity, boardResolution, registration } = evidence;
  const detail = evidence.resolutionDetail;

  // --- 1. SECURITY, BEFORE ANYTHING ELSE ------------------------------------
  // A fresh card must never clear a containment decision, so the lifecycle is
  // read before the card is even looked at (group 0197 refuses registration for
  // a contained device for the same reason).
  if (cloudDevice !== undefined) {
    const lifecycleLock = LOCKED_LIFECYCLES[cloudDevice.lifecycle];
    if (lifecycleLock !== undefined) {
      return lock(
        lifecycleLock,
        `device ${cloudDevice.deviceRecordId} is ${cloudDevice.lifecycle}; a re-flash does not clear it`,
      );
    }
    if (cloudDevice.openTrustIncidentCount > 0) {
      return lock(
        "KLUY-BOOT-LOCKED-INCIDENT",
        `device ${cloudDevice.deviceRecordId} has ${String(cloudDevice.openTrustIncidentCount)} open trust incident(s)`,
      );
    }
  }
  if (boardResolution === "conflict") {
    return lock(
      "KLUY-BOOT-LOCKED-EVIDENCE-CONFLICT",
      detail ?? "more than one live device claims this board's evidence",
    );
  }
  if (registration === "TRUST_REVIEW_REQUIRED") {
    return lock(
      "KLUY-BOOT-LOCKED-TRUST-REVIEW",
      detail ?? "registration answered TRUST_REVIEW_REQUIRED",
    );
  }
  if (registration === "REFUSED") {
    // The edge function refused the registration itself: a bad signature, a
    // fingerprint that does not match the key, a reserved field. None of those
    // is a transient, and none may be retried into acceptance.
    return lock(
      "KLUY-BOOT-LOCKED-REGISTRATION-REFUSED",
      detail ?? "the cloud refused this board's registration",
    );
  }
  if (boardResolution === "review_mac_only") {
    return lock(
      "KLUY-BOOT-LOCKED-TRUST-REVIEW",
      detail ?? "only the MAC address matched; the cloud will not resolve a board on that alone",
    );
  }

  // --- 2. THE CARD IS FOR A DIFFERENT KIND OF DEVICE ------------------------
  // Checked before identity: a Hub card in a Terminal is wrong even if both
  // belong to the same Store, and the message differs. The card states the
  // class it was built for; the CLOUD states what this board is. Those two
  // disagreeing is the whole check — the card never gets to answer both.
  if (cloudDevice !== undefined && cloudDevice.deviceClass !== media.imageDeviceClass) {
    return {
      classification: "WRONG_MEDIA",
      reasonCode: "KLUY-BOOT-MEDIA-WRONG-DEVICE-CLASS",
      nextAction: "INSERT_CORRECT_MEDIA",
      userMessageKey: "boot.wrongMedia.deviceClass",
      adminDetail: `this board is a ${cloudDevice.deviceClass}; the card carries a ${media.imageDeviceClass} image`,
      retryAutomatically: false,
      servesLocally: false,
    };
  }

  // The environment is part of what the card IS. A development build must not
  // run a pilot or production device even when every identity check passes:
  // the development signer and the unbound storage posture are refused there by
  // name, and a board that got that far would fail later and less clearly.
  if (cloudDevice !== undefined && cloudDevice.environment !== media.imageEnvironment) {
    return {
      classification: "WRONG_MEDIA",
      reasonCode: "KLUY-BOOT-MEDIA-WRONG-ENVIRONMENT",
      nextAction: "INSERT_CORRECT_MEDIA",
      userMessageKey: "boot.wrongMedia.environment",
      adminDetail: `the card carries a ${media.imageEnvironment} image; the device is a ${cloudDevice.environment} device`,
      retryAutomatically: false,
      servesLocally: false,
    };
  }

  // --- 3. WHOSE CARD IS THIS? ------------------------------------------------
  // The card names a device. If the hardware is a DIFFERENT known device, the
  // card is foreign and is refused: the card never redefines the board.
  const cardNamesDevice = media.deviceRecordId !== undefined;
  const cardIsForThisBoard =
    cardNamesDevice &&
    cloudDevice !== undefined &&
    media.deviceRecordId === cloudDevice.deviceRecordId;

  if (cardNamesDevice && cloudDevice !== undefined && !cardIsForThisBoard) {
    return {
      classification: "WRONG_MEDIA",
      reasonCode: "KLUY-BOOT-MEDIA-OTHER-DEVICE",
      nextAction: "INSERT_CORRECT_MEDIA",
      userMessageKey: "boot.wrongMedia",
      adminDetail:
        `the card belongs to device ${String(media.deviceRecordId)}; this board is ` +
        `${cloudDevice.deviceRecordId}`,
      retryAutomatically: false,
      servesLocally: false,
    };
  }

  // The card is valid for a device, and this board is NOT that device — because
  // the cloud has never seen this board. That is a hardware swap, not a
  // recovery: the replacement must be governed (KLD-2026-08-06-WS11-T006-001),
  // never inherited by whichever Pi the card is put into.
  if (cardNamesDevice && boardResolution === "unknown") {
    return {
      classification: "REPLACE_HARDWARE",
      reasonCode: "KLUY-BOOT-HARDWARE-REPLACED",
      nextAction: "REPLACE_DEVICE",
      userMessageKey: "boot.replaceHardware",
      adminDetail:
        `the card names device ${String(media.deviceRecordId)}, and this board resolves to no device; ` +
        "a replacement is a governed operation, not an inheritance",
      retryAutomatically: false,
      servesLocally: false,
    };
  }

  // --- 4. NO DEVICE RECORD YET ----------------------------------------------
  if (cloudDevice === undefined) {
    const noRecordStorage = storageLock(evidence.storage);
    if (noRecordStorage !== undefined) return noRecordStorage;

    // The board-local path: the cloud was not consulted, so nothing about
    // identity is known and the answer is always a wait. The shop keeps trading
    // only when this card was last confirmed READY on this very board, and a
    // Hub's own volume is open.
    const servesOffline =
      boardResolution === "unresolved" &&
      media.hasAdoptedCredential &&
      evidence.confirmedReadyOnThisBoard === true &&
      (evidence.storage === undefined || evidence.storage === "opened");

    if (!connectivity.networkUp) {
      return waiting(
        "KLUY-BOOT-WAITING-NETWORK",
        servesOffline ? "boot.waiting.network.serving" : "boot.waiting.network",
        servesOffline
          ? "no network; the card was last confirmed READY on this board, local operation continues"
          : "no network; registration has not been attempted",
        servesOffline,
      );
    }
    if (
      !connectivity.cloudReachable ||
      registration === "UNREACHABLE" ||
      boardResolution === "unresolved"
    ) {
      return waiting(
        "KLUY-BOOT-WAITING-CLOUD",
        servesOffline ? "boot.waiting.network.serving" : "boot.waiting.cloud",
        servesOffline
          ? "the cloud is unreachable; the card was last confirmed READY on this board, local operation continues"
          : "the cloud is unreachable; the board keeps retrying",
        servesOffline,
      );
    }
    return {
      classification: "NEW_DEVICE",
      reasonCode: "KLUY-BOOT-NEW-DEVICE",
      nextAction: "APPROVE_ENROLLMENT",
      userMessageKey: "boot.newDevice",
      adminDetail: detail ?? "an unseen board registered and is waiting for HET approval",
      retryAutomatically: true,
      servesLocally: false,
    };
  }

  // --- 5. THE SEAT ----------------------------------------------------------
  // A seat already holding another board is refused by the pairing door
  // (KLUY-TERMSESSION-TERMINAL-BOUND). Said plainly here, with the one action.
  if (cloudDevice.seat?.occupiedByOtherDevice === true) {
    return {
      classification: "REPLACE_HARDWARE",
      reasonCode: "KLUY-BOOT-HARDWARE-SEAT-OCCUPIED",
      nextAction: "REPLACE_DEVICE",
      userMessageKey: "boot.seatOccupied",
      adminDetail: `seat ${cloudDevice.seat.physicalTerminalId} is bound to another device`,
      retryAutomatically: false,
      servesLocally: false,
    };
  }

  // --- 6. THE CARD IS FOR THIS DEVICE, BUT FOR ANOTHER STORE ---------------
  // An SD card may not move a device between Stores; that is a governed
  // assignment change (0121 `replace_device_assignment_v1`), never a boot.
  if (
    cardIsForThisBoard &&
    media.digitalStoreId !== undefined &&
    cloudDevice.assignment !== undefined &&
    media.digitalStoreId !== cloudDevice.assignment.digitalStoreId
  ) {
    return {
      classification: "WRONG_MEDIA",
      reasonCode: "KLUY-BOOT-MEDIA-OTHER-STORE",
      nextAction: "CONTACT_ADMIN",
      userMessageKey: "boot.wrongMedia.otherStore",
      adminDetail:
        `the card was paired into Store ${media.digitalStoreId}; the device is assigned to ` +
        `${cloudDevice.assignment.digitalStoreId}. Moving a device between Stores is a governed action`,
      retryAutomatically: false,
      servesLocally: false,
    };
  }

  // --- 7. STORE HUB STORAGE -------------------------------------------------
  const storageDecision = storageLock(evidence.storage);
  if (storageDecision !== undefined) return storageDecision;

  // --- 8. IS THE CARD CURRENT? ---------------------------------------------
  // A card from before the latest recovery still holds a real certificate. It
  // is refused on FRESHNESS, not on validity: the credential head moved on, and
  // the superseded generation may never regain authority.
  const head = cloudDevice.credentialHeadGeneration;
  if (
    cardIsForThisBoard &&
    media.hasAdoptedCredential &&
    media.certificateGeneration !== undefined &&
    head !== undefined &&
    media.certificateGeneration < head &&
    media.certificateGeneration !== cloudDevice.honouredPreviousGeneration
  ) {
    return {
      classification: "WRONG_MEDIA",
      reasonCode: "KLUY-BOOT-MEDIA-OUTDATED",
      nextAction: "INSERT_CORRECT_MEDIA",
      userMessageKey: "boot.wrongMedia.outdated",
      adminDetail:
        `the card holds credential generation ${String(media.certificateGeneration)}; the device is at ` +
        `${String(head)}. A superseded credential never regains authority`,
      retryAutomatically: false,
      servesLocally: false,
    };
  }
  // The same judgement by enrollment, for a card whose certificate predates the
  // current sealed enrollment even though the generation looks current.
  const enrollmentMovedOn =
    (media.certificateEnrollmentId !== undefined &&
      media.certificateEnrollmentId !== cloudDevice.currentEnrollmentId) ||
    (media.identityKeyFingerprint !== undefined &&
      cloudDevice.currentIdentityKeyFingerprint !== undefined &&
      media.identityKeyFingerprint.toLowerCase() !==
        cloudDevice.currentIdentityKeyFingerprint.toLowerCase());
  if (cardIsForThisBoard && media.hasAdoptedCredential && enrollmentMovedOn) {
    return {
      classification: "WRONG_MEDIA",
      reasonCode: "KLUY-BOOT-MEDIA-OUTDATED",
      nextAction: "INSERT_CORRECT_MEDIA",
      userMessageKey: "boot.wrongMedia.outdated",
      adminDetail: "the card's certificate was issued under a superseded enrollment of this device",
      retryAutomatically: false,
      servesLocally: false,
    };
  }

  // --- 9. TRANSIENTS, ONCE THE DEVICE IS KNOWN AND SOUND -------------------
  // Judged here, not at the top: "no network" must not outrank "quarantined",
  // and a card that is foreign is foreign with or without a WAN. But it IS
  // judged before READY, because a shop that has lost its Internet is told so
  // (owner task §4) — while `servesLocally` keeps the till open.
  const installationIsCurrent =
    cardIsForThisBoard &&
    media.hasAdoptedCredential &&
    cloudDevice.lifecycle === "active" &&
    cloudDevice.assignment?.state === "active" &&
    media.assignmentGeneration === cloudDevice.assignmentGeneration;

  if (!connectivity.networkUp) {
    return waiting(
      "KLUY-BOOT-WAITING-NETWORK",
      installationIsCurrent ? "boot.waiting.network.serving" : "boot.waiting.network",
      `device ${cloudDevice.deviceRecordId}: no network; local operation continues where supported`,
      installationIsCurrent,
    );
  }
  if (!connectivity.cloudReachable) {
    return waiting(
      "KLUY-BOOT-WAITING-CLOUD",
      installationIsCurrent ? "boot.waiting.network.serving" : "boot.waiting.cloud",
      `device ${cloudDevice.deviceRecordId}: the cloud is unreachable; retrying`,
      installationIsCurrent,
    );
  }

  // --- 10. READY ------------------------------------------------------------
  if (installationIsCurrent) {
    return {
      classification: "READY",
      reasonCode: "KLUY-BOOT-READY",
      nextAction: "NONE",
      userMessageKey: "boot.ready",
      adminDetail: `device ${cloudDevice.deviceRecordId} is active at generation ${String(cloudDevice.assignmentGeneration)}`,
      retryAutomatically: false,
      servesLocally: true,
    };
  }

  // --- 11. RECOVERY AND FIRST SETUP ----------------------------------------
  // Everything below is the same device on replaceable state that is not yet
  // complete. The board is told to wait; the ONE human action, when there is
  // one, is named.
  if (cloudDevice.lifecycle === "manufactured") {
    return waiting(
      "KLUY-BOOT-WAITING-APPROVAL",
      "boot.waiting.approval",
      `device ${cloudDevice.deviceRecordId} is waiting for HET approval`,
    );
  }

  const everHadCredential = head !== undefined;
  if (!everHadCredential) {
    // First setup of an approved device: it has never held a credential.
    if (cloudDevice.lifecycle === "enrolled") {
      return {
        classification: "NEW_DEVICE",
        reasonCode: "KLUY-BOOT-NEW-DEVICE-APPROVED",
        nextAction: "ENTER_PAIRING_CODE",
        userMessageKey: "boot.recovering.needsPairing",
        adminDetail: `device ${cloudDevice.deviceRecordId} is approved and not yet assigned to a Store`,
        retryAutomatically: true,
        servesLocally: false,
      };
    }
    return waiting(
      "KLUY-BOOT-RECOVERY-IN-PROGRESS",
      "boot.recovering",
      `device ${cloudDevice.deviceRecordId} is ${cloudDevice.lifecycle} and finishing first issuance`,
    );
  }

  // A known device that has held a credential, on a card that holds none (or an
  // incomplete one): the re-flash case. What it needs next depends on whether a
  // live assignment is still in the way — the operator step the pairing door
  // insists on (KLUY-DEVICE-ALREADY-CLAIMED).
  if (cloudDevice.lifecycle === "active" || cloudDevice.assignment?.state === "active") {
    return {
      classification: "RECOVERING_DEVICE",
      reasonCode: "KLUY-BOOT-RECOVERY-NEEDS-RELEASE",
      nextAction: "RELEASE_DEVICE_THEN_PAIR",
      userMessageKey: "boot.recovering.needsRelease",
      adminDetail:
        `device ${cloudDevice.deviceRecordId} still holds a live assignment at generation ` +
        `${String(cloudDevice.assignmentGeneration)}; release it, then pair again`,
      retryAutomatically: true,
      servesLocally: false,
    };
  }
  if (cloudDevice.lifecycle === "enrolled") {
    return {
      classification: "RECOVERING_DEVICE",
      reasonCode: "KLUY-BOOT-RECOVERY-NEEDS-PAIRING",
      nextAction: "ENTER_PAIRING_CODE",
      userMessageKey: "boot.recovering.needsPairing",
      adminDetail: `device ${cloudDevice.deviceRecordId} is released and waiting for a pairing code`,
      retryAutomatically: true,
      servesLocally: false,
    };
  }
  // `awaiting_trust`: paired, and the credential is being recovered right now.
  return {
    classification: "RECOVERING_DEVICE",
    reasonCode: "KLUY-BOOT-RECOVERY-IN-PROGRESS",
    nextAction: "NONE",
    userMessageKey: "boot.recovering",
    adminDetail:
      `device ${cloudDevice.deviceRecordId} is ${cloudDevice.lifecycle}; recovering credential ` +
      `generation ${String((head ?? 0) + 1)}`,
    retryAutomatically: true,
    servesLocally: false,
  };
}

/** Classifications a shop may act on themselves, for portal filtering. */
export const SHOP_ACTIONABLE: readonly NextAction[] = [
  "ENTER_PAIRING_CODE",
  "RELEASE_DEVICE_THEN_PAIR",
  "INSERT_CORRECT_MEDIA",
  "REPLACE_DEVICE",
];

/** True when the decision must never be shown as an error to a shop. */
export function isTransient(decision: BootDecision): boolean {
  return (
    decision.classification === "WAITING" ||
    decision.reasonCode === "KLUY-BOOT-RECOVERY-IN-PROGRESS"
  );
}
