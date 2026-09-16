/**
 * The production boot scenario matrix, S01–S43.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 §6. Every scenario the
 * owner listed is here, named by its number, and every one of them runs — or is
 * marked pending against a NAMED implementation gap and kept. None is deleted.
 *
 * ===========================================================================
 * WHAT THIS SUITE IS, AND WHAT IT IS NOT
 * ===========================================================================
 * These are decision tests over the classification contract: given evidence,
 * exactly one classification, one reason code and one next action. They are
 * fast, exhaustive and total, which is what a decision table needs.
 *
 * They are NOT proof that the governed doors behave: that lives where it
 * belongs and is referenced per scenario —
 *   - stale assignment generations (S24–S28): group 0226 and
 *     `services/kitluy-device-registry-service/test/reflash-credential-recovery.adversarial.test.ts`,
 *     which proves a refused request writes NOTHING;
 *   - repeated recovery (S05), replay and power loss (S29–S32): the same suite
 *     and `services/kitluy-device-firstboot-agent/test/operational-tls-client*.test.ts`;
 *   - quarantine surviving a re-flash (S20–S22): group 0197's registration
 *     refusal, asserted in the registry service's own suites.
 * A classification that disagreed with those doors would be a lie, so where a
 * door exists this suite asserts the SAME answer the door gives.
 */
import { describe, expect, it } from "vitest";

import {
  classifyBoot,
  DEFAULT_USER_MESSAGES,
  isTransient,
  type BootEvidence,
  type CloudDeviceFacts,
  type MediaClaims,
} from "../src/index.js";

const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";
const STORE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const STORE_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-0000000000la";
const ENROLLMENT_1 = "e0000000-0000-4000-8000-000000000001";
const ENROLLMENT_2 = "e0000000-0000-4000-8000-000000000002";
const ENROLLMENT_3 = "e0000000-0000-4000-8000-000000000003";
const SEAT = "5ea70000-0000-4000-8000-000000000001";

/** A card that holds a complete, current installation for device A in Store A. */
function currentCard(over: Partial<MediaClaims> = {}): MediaClaims {
  return {
    deviceRecordId: DEVICE_A,
    certificateEnrollmentId: ENROLLMENT_2,
    certificateGeneration: 2,
    assignmentGeneration: 3,
    digitalStoreId: STORE_A,
    storeLocationId: LOCATION_A,
    imageDeviceClass: "store_hub",
    imageEnvironment: "development",
    hasAdoptedCredential: true,
    ...over,
  };
}

/** A freshly flashed card: the image, and nothing about any device. */
function freshCard(over: Partial<MediaClaims> = {}): MediaClaims {
  return {
    imageDeviceClass: "store_hub",
    imageEnvironment: "development",
    hasAdoptedCredential: false,
    ...over,
  };
}

/** Device A as the cloud holds it: active in Store A at generation 3. */
function activeDevice(over: Partial<CloudDeviceFacts> = {}): CloudDeviceFacts {
  return {
    deviceRecordId: DEVICE_A,
    deviceClass: "store_hub",
    environment: "development",
    lifecycle: "active",
    openTrustIncidentCount: 0,
    currentEnrollmentId: ENROLLMENT_2,
    assignmentGeneration: 3,
    assignment: { state: "active", digitalStoreId: STORE_A, storeLocationId: LOCATION_A },
    credentialHeadGeneration: 2,
    activeCertificate: { generation: 2, enrollmentId: ENROLLMENT_2 },
    ...over,
  };
}

function boot(over: Partial<BootEvidence> = {}): BootEvidence {
  return {
    boardResolution: "resolved",
    registration: "KNOWN_DEVICE_INSTALLATION_REGISTERED",
    media: currentCard(),
    cloudDevice: activeDevice(),
    connectivity: { networkUp: true, cloudReachable: true },
    ...over,
  };
}

/** Every decision must name a message a shop can read, free of identifiers. */
function assertShopSafe(messageKey: keyof typeof DEFAULT_USER_MESSAGES): void {
  const text = DEFAULT_USER_MESSAGES[messageKey];
  expect(text.length).toBeGreaterThan(0);
  expect(text).not.toMatch(/KLUY-|generation|enrollment|certificate|uuid|[0-9a-f]{8}-/i);
}

describe("NORMAL", () => {
  it("S01 same Pi, its own current card, same Store → READY", () => {
    const decision = classifyBoot(boot());
    expect(decision.classification).toBe("READY");
    expect(decision.reasonCode).toBe("KLUY-BOOT-READY");
    expect(decision.nextAction).toBe("NONE");
    assertShopSafe(decision.userMessageKey);
  });

  it("S02 same Pi, current card, no Internet → WAITING, retried, not a recovery", () => {
    const decision = classifyBoot(
      boot({ connectivity: { networkUp: false, cloudReachable: false } }),
    );
    expect(decision.classification).toBe("WAITING");
    expect(decision.reasonCode).toBe("KLUY-BOOT-WAITING-NETWORK");
    expect(decision.retryAutomatically).toBe(true);
    // Local operation continues: this is a link state, not a recovery reset.
    expect(decision.servesLocally).toBe(true);
    expect(isTransient(decision)).toBe(true);
    assertShopSafe(decision.userMessageKey);
  });

  it("S02b offline, an adopted device keeps serving its shop and is never shown an error", () => {
    // The credential is on the card; a later boot makes no cloud call at all
    // (`operational-tls` returns already_adopted). So the till keeps working
    // while the link is down — owner task §4.
    for (const connectivity of [
      { networkUp: false, cloudReachable: false },
      { networkUp: true, cloudReachable: false },
    ]) {
      const decision = classifyBoot(boot({ connectivity }));
      expect(decision.classification).toBe("WAITING");
      expect(decision.servesLocally).toBe(true);
      expect(decision.userMessageKey).toBe("boot.waiting.network.serving");
      expect(DEFAULT_USER_MESSAGES[decision.userMessageKey]).toContain("keeps working");
      expect(isTransient(decision)).toBe(true);
    }
  });
});

describe("OFFLINE, CLASSIFIED ON THE BOARD ITSELF", () => {
  // What a board can actually know when the cloud cannot be reached: its card,
  // its own serial, its storage — and no cloud facts at all.
  const offline = (over: Partial<BootEvidence> = {}): BootEvidence => ({
    boardResolution: "unresolved",
    media: currentCard(),
    connectivity: { networkUp: false, cloudReachable: false },
    ...over,
  });

  it("S02c a card last confirmed READY on this board keeps the shop trading", () => {
    const decision = classifyBoot(offline({ confirmedReadyOnThisBoard: true, storage: "opened" }));
    expect(decision.classification).toBe("WAITING");
    expect(decision.servesLocally).toBe(true);
    expect(decision.userMessageKey).toBe("boot.waiting.network.serving");
  });

  it("S02d offline is never read as new hardware: a good card is not told to replace anything", () => {
    for (const confirmedReadyOnThisBoard of [true, false, undefined]) {
      const decision = classifyBoot(
        offline(confirmedReadyOnThisBoard === undefined ? {} : { confirmedReadyOnThisBoard }),
      );
      expect(decision.classification).toBe("WAITING");
      expect(decision.reasonCode).not.toBe("KLUY-BOOT-HARDWARE-REPLACED");
    }
  });

  it("S02e the same card cloned into another Pi waits, and does NOT serve", () => {
    // Confirmation is bound to the board serial; another Pi has another serial.
    const decision = classifyBoot(offline({ confirmedReadyOnThisBoard: false }));
    expect(decision.classification).toBe("WAITING");
    expect(decision.servesLocally).toBe(false);
  });

  it("S02f a fresh card offline waits; it is never offered as a new device", () => {
    const decision = classifyBoot(offline({ media: freshCard(), confirmedReadyOnThisBoard: true }));
    expect(decision.classification).toBe("WAITING");
    expect(decision.servesLocally).toBe(false);
  });

  it("S02g the classification call failed with the network up → waiting for the cloud", () => {
    const decision = classifyBoot(
      offline({
        connectivity: { networkUp: true, cloudReachable: false },
        confirmedReadyOnThisBoard: true,
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-WAITING-CLOUD");
    expect(decision.servesLocally).toBe(true);
    // Even if a caller claimed the cloud answered, an unresolved board waits.
    const inconsistent = classifyBoot(
      offline({ connectivity: { networkUp: true, cloudReachable: true } }),
    );
    expect(inconsistent.classification).toBe("WAITING");
  });

  it("S02h an offline Hub whose drive is another Hub's is locked, never served", () => {
    const decision = classifyBoot(offline({ confirmedReadyOnThisBoard: true, storage: "foreign" }));
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-STORAGE-FOREIGN");
    expect(decision.servesLocally).toBe(false);
  });

  it("S02i an offline Hub whose drive did not open does not serve", () => {
    const decision = classifyBoot(offline({ confirmedReadyOnThisBoard: true, storage: "absent" }));
    expect(decision.classification).toBe("WAITING");
    expect(decision.servesLocally).toBe(false);
  });
});

describe("SAME PHYSICAL DEVICE, NEW SD", () => {
  it("S03 same registered Pi, fresh card, device still assigned → RECOVERING, release first", () => {
    const decision = classifyBoot(boot({ media: freshCard() }));
    expect(decision.classification).toBe("RECOVERING_DEVICE");
    expect(decision.reasonCode).toBe("KLUY-BOOT-RECOVERY-NEEDS-RELEASE");
    expect(decision.nextAction).toBe("RELEASE_DEVICE_THEN_PAIR");
    assertShopSafe(decision.userMessageKey);
  });

  it("S03b once released, the same board asks for a pairing code", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard(),
        cloudDevice: activeDevice({
          lifecycle: "enrolled",
          assignmentGeneration: 0,
          assignment: undefined,
        }),
      }),
    );
    expect(decision.classification).toBe("RECOVERING_DEVICE");
    expect(decision.reasonCode).toBe("KLUY-BOOT-RECOVERY-NEEDS-PAIRING");
    expect(decision.nextAction).toBe("ENTER_PAIRING_CODE");
  });

  it("S03c after pairing, recovery runs on its own with no action", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard(),
        cloudDevice: activeDevice({
          lifecycle: "awaiting_trust",
          assignmentGeneration: 4,
          assignment: {
            state: "pending_trust",
            digitalStoreId: STORE_A,
            storeLocationId: LOCATION_A,
          },
        }),
      }),
    );
    expect(decision.classification).toBe("RECOVERING_DEVICE");
    expect(decision.reasonCode).toBe("KLUY-BOOT-RECOVERY-IN-PROGRESS");
    expect(decision.nextAction).toBe("NONE");
    expect(isTransient(decision)).toBe(true);
  });

  it("S04 a newer compatible image on a fresh card behaves exactly as S03", () => {
    // The image VERSION is deliberately not evidence: nothing about recovery
    // depends on it. Only class and environment are, and both still match.
    const decision = classifyBoot(boot({ media: freshCard() }));
    expect(decision.classification).toBe("RECOVERING_DEVICE");
  });

  it("S05 a second and third re-flash recover the same way, at the head the device is at", () => {
    for (const head of [2, 3, 4]) {
      const decision = classifyBoot(
        boot({
          media: freshCard(),
          cloudDevice: activeDevice({
            lifecycle: "enrolled",
            assignmentGeneration: 0,
            assignment: undefined,
            credentialHeadGeneration: head,
            currentEnrollmentId: ENROLLMENT_3,
          }),
        }),
      );
      expect(decision.classification).toBe("RECOVERING_DEVICE");
      expect(decision.nextAction).toBe("ENTER_PAIRING_CODE");
    }
    // The durable half — generation N -> N+1 with no duplicate device record —
    // is proven against the real doors in the registry service's recovery suite
    // ("recovers AGAIN after a second re-flash").
  });
});

describe("OLD / SUPERSEDED SD", () => {
  it("S06 the card from before the last recovery → WRONG_MEDIA, outdated", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ certificateGeneration: 1, certificateEnrollmentId: ENROLLMENT_1 }),
        cloudDevice: activeDevice({ credentialHeadGeneration: 2 }),
      }),
    );
    expect(decision.classification).toBe("WRONG_MEDIA");
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OUTDATED");
    expect(decision.nextAction).toBe("INSERT_CORRECT_MEDIA");
    assertShopSafe(decision.userMessageKey);
  });

  it("S07 a card from two recoveries ago is refused the same way", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ certificateGeneration: 1, certificateEnrollmentId: ENROLLMENT_1 }),
        cloudDevice: activeDevice({
          credentialHeadGeneration: 3,
          currentEnrollmentId: ENROLLMENT_3,
        }),
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OUTDATED");
  });

  it("S06b a card whose generation looks current but whose enrollment is superseded is still outdated", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ certificateGeneration: 2, certificateEnrollmentId: ENROLLMENT_1 }),
        cloudDevice: activeDevice({
          credentialHeadGeneration: 2,
          currentEnrollmentId: ENROLLMENT_2,
        }),
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OUTDATED");
  });
});

describe("FOREIGN SD — SAME STORE", () => {
  it("S08 Terminal A's Pi with Terminal B's card → WRONG_MEDIA, never B's seat", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ deviceRecordId: DEVICE_B, imageDeviceClass: "terminal" }),
        cloudDevice: activeDevice({ deviceClass: "terminal" }),
      }),
    );
    expect(decision.classification).toBe("WRONG_MEDIA");
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OTHER-DEVICE");
    expect(decision.adminDetail).toContain(DEVICE_B);
    assertShopSafe(decision.userMessageKey);
  });

  it("S09 Hub A's Pi with another Hub's card, same Store → WRONG_MEDIA", () => {
    const decision = classifyBoot(boot({ media: currentCard({ deviceRecordId: DEVICE_B }) }));
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OTHER-DEVICE");
  });

  it("S10 a Store Hub board with a Terminal card → WRONG_MEDIA, wrong device class", () => {
    const decision = classifyBoot(
      boot({ media: currentCard({ imageDeviceClass: "terminal", deviceRecordId: DEVICE_B }) }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-WRONG-DEVICE-CLASS");
    expect(decision.nextAction).toBe("INSERT_CORRECT_MEDIA");
  });

  it("S11 a Terminal board with a Store Hub card → WRONG_MEDIA, wrong device class", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ imageDeviceClass: "store_hub" }),
        cloudDevice: activeDevice({ deviceClass: "terminal" }),
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-WRONG-DEVICE-CLASS");
  });

  it("S10b class is judged before identity, so the message names the right mistake", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ imageDeviceClass: "terminal", deviceRecordId: DEVICE_B }),
      }),
    );
    expect(decision.userMessageKey).toBe("boot.wrongMedia.deviceClass");
  });
});

describe("FOREIGN SD — OTHER STORE", () => {
  it("S12 Store A's Terminal Pi with Store B's Terminal card → fail closed", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({
          deviceRecordId: DEVICE_B,
          digitalStoreId: STORE_B,
          imageDeviceClass: "terminal",
        }),
        cloudDevice: activeDevice({ deviceClass: "terminal" }),
      }),
    );
    expect(decision.classification).toBe("WRONG_MEDIA");
    expect(decision.nextAction).not.toBe("NONE");
    // Store authority is never transferred by a card.
    expect(decision.adminDetail).not.toContain("assigned to Store B");
  });

  it("S13 Store A's Hub with Store B's Hub card → fail closed", () => {
    const decision = classifyBoot(
      boot({ media: currentCard({ deviceRecordId: DEVICE_B, digitalStoreId: STORE_B }) }),
    );
    expect(decision.classification).toBe("WRONG_MEDIA");
  });

  it("S13b this device's own card naming another Store is refused and sent to an admin", () => {
    // The device is A and the card is A's, but the card was paired into Store B.
    // Moving a device between Stores is a governed action, never a boot.
    const decision = classifyBoot(boot({ media: currentCard({ digitalStoreId: STORE_B }) }));
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OTHER-STORE");
    expect(decision.nextAction).toBe("CONTACT_ADMIN");
    assertShopSafe(decision.userMessageKey);
  });
});

describe("DIFFERENT PHYSICAL HARDWARE", () => {
  it("S14 a replacement Pi holding the failed Pi's card → REPLACE_HARDWARE, never impersonation", () => {
    const decision = classifyBoot(
      boot({
        boardResolution: "unknown",
        cloudDevice: undefined,
        registration: "PENDING_APPROVAL",
      }),
    );
    expect(decision.classification).toBe("REPLACE_HARDWARE");
    expect(decision.reasonCode).toBe("KLUY-BOOT-HARDWARE-REPLACED");
    expect(decision.nextAction).toBe("REPLACE_DEVICE");
    assertShopSafe(decision.userMessageKey);
  });

  it("S15 a new Pi with a fresh image → NEW_DEVICE, waiting for approval", () => {
    const decision = classifyBoot(
      boot({
        boardResolution: "unknown",
        cloudDevice: undefined,
        media: freshCard(),
        registration: "PENDING_APPROVAL",
      }),
    );
    expect(decision.classification).toBe("NEW_DEVICE");
    expect(decision.nextAction).toBe("APPROVE_ENROLLMENT");
  });

  it("S16 a second board for a seat that already has one → REPLACE_HARDWARE, not a silent swap", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard({ imageDeviceClass: "terminal" }),
        cloudDevice: activeDevice({
          deviceClass: "terminal",
          lifecycle: "enrolled",
          assignmentGeneration: 0,
          assignment: undefined,
          seat: { physicalTerminalId: SEAT, occupiedByOtherDevice: true },
        }),
      }),
    );
    expect(decision.classification).toBe("REPLACE_HARDWARE");
    expect(decision.reasonCode).toBe("KLUY-BOOT-HARDWARE-SEAT-OCCUPIED");
    expect(decision.nextAction).toBe("REPLACE_DEVICE");
  });
});

describe("DEVICE CLASS THE IMAGE WAS NEVER BUILT FOR", () => {
  it("S06c a Store image on a board the cloud records as a factory station → WRONG_MEDIA", () => {
    for (const deviceClass of ["manufacturing_station", "peripheral"] as const) {
      const decision = classifyBoot(
        boot({ media: freshCard(), cloudDevice: activeDevice({ deviceClass }) }),
      );
      expect(decision.classification).toBe("WRONG_MEDIA");
      expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-WRONG-DEVICE-CLASS");
      assertShopSafe(decision.userMessageKey);
    }
  });
});

describe("A CARD WHOSE IDENTITY A LATER RE-FLASH REPLACED", () => {
  // A real card does not record its certificate's enrollment id; it records the
  // fingerprint of the identity key it registered with. The cloud's current
  // enrollment carries the same fingerprint (both SHA-256 over the SPKI).
  const KEY_A = "a".repeat(64);
  const KEY_B = "b".repeat(64);
  const cardWithoutEnrollmentId = (identityKeyFingerprint: string) => {
    const { certificateEnrollmentId: _unused, ...rest } = currentCard({ identityKeyFingerprint });
    return rest;
  };

  it("S11b the old card put back after the re-flash registered, before recovery → outdated", () => {
    const decision = classifyBoot(
      boot({
        media: cardWithoutEnrollmentId(KEY_A),
        // Recovery has not run: the head and certificate are unchanged, only
        // the enrollment (and its key) moved on.
        cloudDevice: activeDevice({ currentIdentityKeyFingerprint: KEY_B }),
      }),
    );
    expect(decision.classification).toBe("WRONG_MEDIA");
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OUTDATED");
  });

  it("S11c the card holding the current identity stays READY, whatever the letter case", () => {
    const decision = classifyBoot(
      boot({
        media: cardWithoutEnrollmentId(KEY_B.toUpperCase()),
        cloudDevice: activeDevice({ currentIdentityKeyFingerprint: KEY_B }),
      }),
    );
    expect(decision.classification).toBe("READY");
  });

  it("S11d a fresh card is never judged on an identity it has not adopted", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard({ identityKeyFingerprint: KEY_A }),
        cloudDevice: activeDevice({ currentIdentityKeyFingerprint: KEY_B }),
      }),
    );
    expect(decision.reasonCode).not.toBe("KLUY-BOOT-MEDIA-OUTDATED");
  });
});

describe("STORE HUB STORAGE THE BOARD CANNOT EXPLAIN", () => {
  it("S38c a drive whose volume did not open → HET support, and no claim that it is foreign", () => {
    for (const cloudDevice of [activeDevice(), undefined]) {
      const decision = classifyBoot(
        boot({
          storage: "not_opened",
          ...(cloudDevice === undefined
            ? {
                cloudDevice: undefined,
                boardResolution: "unresolved" as const,
                connectivity: { networkUp: false, cloudReachable: false },
              }
            : { cloudDevice }),
        }),
      );
      expect(decision.classification).toBe("SECURITY_LOCK");
      expect(decision.reasonCode).toBe("KLUY-BOOT-STORAGE-NOT-OPENED");
      expect(decision.nextAction).toBe("CONTACT_HET_SUPPORT");
      // The neutral message: never "belongs to another Hub".
      expect(decision.userMessageKey).toBe("boot.storage.support");
      expect(decision.servesLocally).toBe(false);
    }
  });
});

describe("CREDENTIAL OVERLAP", () => {
  // Observed on kitluy-fresh 2026-09-16: two credential heads at generation 2
  // still honour generation 1 until 2026-09-18. A card at the previous
  // generation inside that window is not outdated.
  it("S27b a card at the previous generation inside the overlap window stays READY", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ certificateGeneration: 1 }),
        cloudDevice: activeDevice({ credentialHeadGeneration: 2, honouredPreviousGeneration: 1 }),
      }),
    );
    expect(decision.classification).toBe("READY");
  });

  it("S27c the same card once the overlap window has closed is outdated", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ certificateGeneration: 1 }),
        cloudDevice: activeDevice({ credentialHeadGeneration: 2 }),
      }),
    );
    expect(decision.classification).toBe("WRONG_MEDIA");
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OUTDATED");
  });

  it("S27d the overlap honours only the previous generation, never an older one", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ certificateGeneration: 1 }),
        cloudDevice: activeDevice({ credentialHeadGeneration: 3, honouredPreviousGeneration: 2 }),
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OUTDATED");
  });
});

describe("CLONING / DUPLICATION", () => {
  it("S17 a cloned card in another Pi is a hardware question, not an identity transfer", () => {
    const decision = classifyBoot(
      boot({
        boardResolution: "unknown",
        cloudDevice: undefined,
        registration: "PENDING_APPROVAL",
      }),
    );
    expect(["REPLACE_HARDWARE", "SECURITY_LOCK"]).toContain(decision.classification);
    expect(decision.nextAction).not.toBe("NONE");
  });

  it("S17b a cloned card in a Pi the cloud already knows as another device → WRONG_MEDIA", () => {
    const decision = classifyBoot(
      boot({ media: currentCard({ deviceRecordId: DEVICE_B }), cloudDevice: activeDevice() }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OTHER-DEVICE");
  });

  it("S18 two boards presenting one identity → SECURITY_LOCK, never two trusted twins", () => {
    const decision = classifyBoot(
      boot({
        boardResolution: "conflict",
        resolutionDetail: "KLUY-BOARD-EVIDENCE-AMBIGUOUS",
        cloudDevice: undefined,
      }),
    );
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-EVIDENCE-CONFLICT");
    expect(decision.retryAutomatically).toBe(false);
    // The evidence is kept for the admin, verbatim.
    expect(decision.adminDetail).toContain("KLUY-BOARD-EVIDENCE-AMBIGUOUS");
    assertShopSafe(decision.userMessageKey);
  });

  it("S19 a cloned STALE card after a legitimate recovery → outdated, never authoritative", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ certificateGeneration: 1, certificateEnrollmentId: ENROLLMENT_1 }),
        cloudDevice: activeDevice({ credentialHeadGeneration: 2 }),
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-OUTDATED");
  });
});

describe("TRUST / SECURITY", () => {
  it("S20 a quarantined device with its own card → SECURITY_LOCK", () => {
    const decision = classifyBoot(
      boot({ cloudDevice: activeDevice({ lifecycle: "quarantined" }) }),
    );
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-QUARANTINED");
    expect(decision.nextAction).toBe("CONTACT_ADMIN");
    assertShopSafe(decision.userMessageKey);
  });

  it("S21 a FRESH card does not clear quarantine", () => {
    const decision = classifyBoot(
      boot({ media: freshCard(), cloudDevice: activeDevice({ lifecycle: "quarantined" }) }),
    );
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-QUARANTINED");
    // The cloud agrees: group 0197 refuses registration for a contained device
    // before it writes anything.
  });

  it("S22 a retired or replaced device is not silently reactivated by a fresh card", () => {
    for (const lifecycle of ["retired", "replaced"] as const) {
      const decision = classifyBoot(
        boot({ media: freshCard(), cloudDevice: activeDevice({ lifecycle }) }),
      );
      expect(decision.classification).toBe("SECURITY_LOCK");
      expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-RETIRED");
    }
  });

  it("S22b an open trust incident holds the device, whatever the card says", () => {
    const decision = classifyBoot(
      boot({ cloudDevice: activeDevice({ openTrustIncidentCount: 1 }) }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-INCIDENT");
  });

  it("S23 a tampered identity proof → SECURITY_LOCK, never a retry loop", () => {
    const decision = classifyBoot(
      boot({
        registration: "REFUSED",
        resolutionDetail: "KLUY-REG-BAD-SIGNATURE",
        cloudDevice: undefined,
      }),
    );
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-REGISTRATION-REFUSED");
    expect(decision.retryAutomatically).toBe(false);
    expect(decision.adminDetail).toContain("KLUY-REG-BAD-SIGNATURE");
  });

  it("S23b MAC-only evidence is reviewed, never resolved", () => {
    const decision = classifyBoot(
      boot({
        boardResolution: "review_mac_only",
        resolutionDetail: "KLUY-BOARD-EVIDENCE-MAC-ONLY",
        cloudDevice: undefined,
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-LOCKED-TRUST-REVIEW");
  });

  it("security outranks everything: a quarantined device with a foreign, outdated card still locks", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ deviceRecordId: DEVICE_B, certificateGeneration: 1 }),
        cloudDevice: activeDevice({ lifecycle: "quarantined" }),
        connectivity: { networkUp: false, cloudReachable: false },
      }),
    );
    expect(decision.classification).toBe("SECURITY_LOCK");
  });
});

describe("ASSIGNMENT GENERATION (the classifier's half; the doors' half is group 0226)", () => {
  it("S24 the current generation N is the only one that reads as READY", () => {
    expect(classifyBoot(boot()).classification).toBe("READY");
  });

  it.each([
    ["S25 N-1", 2],
    ["S26 N-2", 1],
    ["S27 N+1", 4],
  ])("%s on the card is never READY", (_label, generation) => {
    const decision = classifyBoot(
      boot({ media: currentCard({ assignmentGeneration: generation }) }),
    );
    expect(decision.classification).not.toBe("READY");
  });

  it("S28 a card stating no generation at all is never READY", () => {
    const decision = classifyBoot(
      boot({ media: currentCard({ assignmentGeneration: undefined }) }),
    );
    expect(decision.classification).not.toBe("READY");
  });

  // S24–S28, the durable half: a refused stale request must consume no key
  // fingerprint, reservation or evidence row. That is group 0226's invariant and
  // is proven in
  // services/kitluy-device-registry-service/test/reflash-credential-recovery.adversarial.test.ts
  // ("refuses a STALE assignment generation before anything durable").
});

describe("POWER / RETRY SAFETY", () => {
  it("S29 power loss after a new enrollment but before recovery completes → resume, no new case", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard(),
        cloudDevice: activeDevice({
          lifecycle: "enrolled",
          assignmentGeneration: 0,
          assignment: undefined,
          currentEnrollmentId: ENROLLMENT_3,
        }),
      }),
    );
    expect(decision.classification).toBe("RECOVERING_DEVICE");
    expect(decision.retryAutomatically).toBe(true);
  });

  it("S30 power loss after pairing, before adoption → still RECOVERING, no action", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard(),
        cloudDevice: activeDevice({
          lifecycle: "awaiting_trust",
          assignmentGeneration: 4,
          assignment: {
            state: "pending_trust",
            digitalStoreId: STORE_A,
            storeLocationId: LOCATION_A,
          },
        }),
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-RECOVERY-IN-PROGRESS");
    expect(decision.nextAction).toBe("NONE");
  });

  it("S31 a lost response is idempotent: the same evidence classifies identically every time", () => {
    const evidence = boot({
      media: freshCard(),
      cloudDevice: activeDevice({
        lifecycle: "awaiting_trust",
        assignmentGeneration: 4,
        assignment: {
          state: "pending_trust",
          digitalStoreId: STORE_A,
          storeLocationId: LOCATION_A,
        },
      }),
    });
    expect(classifyBoot(evidence)).toEqual(classifyBoot(evidence));
    // The replay itself is proven device-side in
    // services/kitluy-device-firstboot-agent/test/operational-tls-client.test.ts.
  });

  it("S32 the network disappearing during recovery pauses; it does not restart the case", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard(),
        cloudDevice: activeDevice({
          lifecycle: "awaiting_trust",
          assignmentGeneration: 4,
          assignment: {
            state: "pending_trust",
            digitalStoreId: STORE_A,
            storeLocationId: LOCATION_A,
          },
        }),
        connectivity: { networkUp: true, cloudReachable: false },
      }),
    );
    expect(decision.classification).toBe("WAITING");
    expect(decision.reasonCode).toBe("KLUY-BOOT-WAITING-CLOUD");
    expect(decision.retryAutomatically).toBe(true);
    assertShopSafe(decision.userMessageKey);
  });
});

describe("WRONG / UNSUPPORTED IMAGE", () => {
  it("S33 a Store Hub image on terminal-class hardware fails closed and says so", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard({ imageDeviceClass: "store_hub" }),
        cloudDevice: activeDevice({ deviceClass: "terminal" }),
      }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-WRONG-DEVICE-CLASS");
    expect(decision.userMessageKey).toBe("boot.wrongMedia.deviceClass");
  });

  it("S34 a Terminal image on a Store Hub fails the same way", () => {
    const decision = classifyBoot(
      boot({ media: freshCard({ imageDeviceClass: "terminal" }), cloudDevice: activeDevice() }),
    );
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-WRONG-DEVICE-CLASS");
  });

  it("S35 a development image on a production device is refused, never silently permitted", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ imageEnvironment: "development" }),
        cloudDevice: activeDevice({ environment: "production" }),
      }),
    );
    expect(decision.classification).toBe("WRONG_MEDIA");
    expect(decision.reasonCode).toBe("KLUY-BOOT-MEDIA-WRONG-ENVIRONMENT");
    assertShopSafe(decision.userMessageKey);
  });
});

describe("STORE HUB PERSISTENT STORAGE", () => {
  it("S36 same Hub, fresh card, its own storage opens → RECOVERING, one message, no storage noise", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard(),
        storage: "opened",
        cloudDevice: activeDevice({
          lifecycle: "enrolled",
          assignmentGeneration: 0,
          assignment: undefined,
        }),
      }),
    );
    expect(decision.classification).toBe("RECOVERING_DEVICE");
    expect(decision.userMessageKey).toBe("boot.recovering.needsPairing");
  });

  it("S37 storage belonging to another Hub is never mounted as this Store's data", () => {
    const decision = classifyBoot(boot({ media: freshCard(), storage: "foreign" }));
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-STORAGE-FOREIGN");
    // KLV4-DEC-007: Store staff do not repair Hub storage.
    expect(decision.nextAction).toBe("CONTACT_HET_SUPPORT");
    assertShopSafe(decision.userMessageKey);
  });

  it("S38 storage whose CONTENTS name another Hub or Store locks the boot", () => {
    const decision = classifyBoot(boot({ media: freshCard(), storage: "opened_foreign_contents" }));
    expect(decision.reasonCode).toBe("KLUY-BOOT-STORAGE-FOREIGN-CONTENTS");
    expect(decision.nextAction).toBe("CONTACT_HET_SUPPORT");
    // GAP-BOOT-002: the classifier decides this correctly, but NOTHING PRODUCES
    // this evidence yet. `hub-storage-provision` binds the volume to the BOARD
    // and the Hub agent never checks that the mounted database names this Hub
    // or this Store, so a restored volume from the same board carrying another
    // Store's records would open and serve. Closing it needs a Hub-side
    // identity check (hub_device.board_serial_hash / hub_assignment scope
    // against the SD's pairing state) — a separate slice.
  });

  it("S39 a fresh Hub card with no storage at all proceeds to first setup", () => {
    const decision = classifyBoot(
      boot({
        media: freshCard(),
        storage: "absent",
        cloudDevice: activeDevice({
          lifecycle: "enrolled",
          assignmentGeneration: 0,
          assignment: undefined,
          credentialHeadGeneration: undefined,
        }),
      }),
    );
    expect(decision.classification).toBe("NEW_DEVICE");
    expect(decision.nextAction).toBe("ENTER_PAIRING_CODE");
  });

  it("S40 an unidentifiable or locked volume is a recoverable state with one action, not a systemd failure", () => {
    const decision = classifyBoot(boot({ media: freshCard(), storage: "unidentified" }));
    expect(decision.classification).toBe("SECURITY_LOCK");
    expect(decision.reasonCode).toBe("KLUY-BOOT-STORAGE-UNIDENTIFIED");
    expect(decision.nextAction).toBe("CONTACT_HET_SUPPORT");
    assertShopSafe(decision.userMessageKey);
  });
});

describe("TERMINAL CONFIGURATION", () => {
  it("S41 a recovered Terminal whose seat and profile are unchanged just comes back", () => {
    const decision = classifyBoot(
      boot({
        media: currentCard({ imageDeviceClass: "terminal" }),
        cloudDevice: activeDevice({
          deviceClass: "terminal",
          seat: { physicalTerminalId: SEAT, occupiedByOtherDevice: false },
        }),
      }),
    );
    expect(decision.classification).toBe("READY");
  });

  // S42 — the cloud's desired seat/profile changed legitimately while the card
  // was away, and cloud desired state must win over the card.
  //
  // GAP-BOOT-003: not decidable here yet. Terminal profiles are delivered to
  // the board in the pairing response and the Hub's signed configuration
  // snapshot, and the classifier is not given them; more importantly the
  // profile model itself is the open owner decision TOPOLOGY-001 (handoff 41,
  // KLREC-2026-09-15-MULTI-PROFILE-SEAT-PAIRING-001) — which profile a
  // multi-role seat pairs into is undecided. Deciding it here would freeze that
  // answer by accident.
  it.skip("S42 cloud desired seat/profile wins over a stale card (GAP-BOOT-003, TOPOLOGY-001)", () => {
    expect.unreachable();
  });

  // S43 — an intentional role change is REASSIGNMENT, not recovery.
  //
  // GAP-BOOT-004: the classifier keeps the two apart by never returning a
  // recovery for a profile difference, which this suite asserts by omission.
  // The positive case — a governed "change this terminal's role" operation —
  // has no door, no API route and no portal action today (handoff 41 slice
  // TOPOLOGY-004), so there is nothing to classify yet.
  it.skip("S43 a deliberate role change is a configuration operation, not a recovery (GAP-BOOT-004)", () => {
    expect.unreachable();
  });
});

describe("THE CONTRACT ITSELF", () => {
  it("every decision carries exactly one next action and a shop-safe message", () => {
    const evidences: BootEvidence[] = [
      boot(),
      boot({ media: freshCard() }),
      boot({ boardResolution: "unknown", cloudDevice: undefined }),
      boot({ boardResolution: "conflict", cloudDevice: undefined }),
      boot({ cloudDevice: activeDevice({ lifecycle: "quarantined" }) }),
      boot({ media: currentCard({ deviceRecordId: DEVICE_B }) }),
      boot({ connectivity: { networkUp: false, cloudReachable: false } }),
      boot({ media: freshCard(), storage: "foreign" }),
    ];
    for (const evidence of evidences) {
      const decision = classifyBoot(evidence);
      expect(decision.reasonCode).toMatch(/^KLUY-BOOT-/);
      assertShopSafe(decision.userMessageKey);
      expect(decision.adminDetail.length).toBeGreaterThan(0);
    }
  });

  it("a SECURITY_LOCK is never retried, and a WAITING always is", () => {
    const locked = classifyBoot(boot({ cloudDevice: activeDevice({ lifecycle: "quarantined" }) }));
    expect(locked.retryAutomatically).toBe(false);
    const waiting = classifyBoot(
      boot({ connectivity: { networkUp: false, cloudReachable: false } }),
    );
    expect(waiting.retryAutomatically).toBe(true);
  });

  it("no shop-facing message contains a technical code, in any branch", () => {
    for (const key of Object.keys(
      DEFAULT_USER_MESSAGES,
    ) as (keyof typeof DEFAULT_USER_MESSAGES)[]) {
      assertShopSafe(key);
    }
  });
});
