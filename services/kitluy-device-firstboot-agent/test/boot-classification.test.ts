/**
 * Boot classification on the board: what the card claims, what the board reads
 * about itself, and who decides.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slice F.
 *
 * The properties that matter:
 *   1. The card's files become CLAIMS, and only facts the card can back — a
 *      half-copied credential is not adopted, an assumed generation is not
 *      claimed, a Terminal's non-uuid references are not claimed.
 *   2. Offline, the board is `unresolved`: never "new hardware", never "new".
 *   3. The shop keeps trading offline only on THIS board, with THIS card, after
 *      the cloud last said READY. A clone, a changed card or a later lock all
 *      stop it.
 *   4. Storage is reported only as far as a board can see it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  bootSignalsFrom,
  claimsDigest,
  classifyThisBoot,
  createHttpBootClassificationCall,
  readBootClassificationState,
  readHubStoragePosture,
  readMediaClaims,
  registrationOutcomeFor,
  shopDecisionFrom,
  writeBootClassificationState,
  type BootClassificationCall,
  type BootSignal,
  type CardPaths,
  type ShopDecision,
} from "../src/boot-classification.js";
import type { MediaClaims } from "../src/boot-classification-contract.js";
import { commitAdoption } from "../src/operational-credential-state.js";
import { writePairingState } from "../src/pairing-state.js";
import { writeRegistrationState } from "../src/registration-state.js";

const DEVICE = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const STORE = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";
const KEY = "ab".repeat(32);

let dir: string;
let paths: CardPaths & { operational: NonNullable<CardPaths["operational"]> };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-boot-classification-"));
  const operationalDir = join(dir, "operational");
  paths = {
    etcRoot: join(dir, "etc"),
    registrationState: join(dir, "registration-state.json"),
    pairingState: join(dir, "pairing-state.json"),
    terminalAssignment: join(dir, "terminal", "assignment.json"),
    operational: {
      directory: operationalDir,
      privateKey: join(operationalDir, "operational-tls.key.pem"),
      requestState: join(operationalDir, "issuance-request.json"),
      certificate: join(operationalDir, "operational-tls.crt.pem"),
      chain: join(operationalDir, "operational-tls.chain.pem"),
      manifest: join(operationalDir, "operational-credential.json"),
    } as NonNullable<CardPaths["operational"]>,
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function imageEnv(lines: string): void {
  mkdirSync(join(dir, "etc", "kitluy"), { recursive: true });
  writeFileSync(join(dir, "etc", "kitluy", "image.env"), lines);
}

function registered(): void {
  writeRegistrationState(
    {
      phase: "APPROVED",
      deviceId: DEVICE,
      keyFingerprint: KEY,
      updatedAt: new Date().toISOString(),
    },
    paths.registrationState,
  );
}

function pairedHub(generation?: number): void {
  writePairingState(
    {
      phase: "PAIRED",
      deviceRecordId: DEVICE,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
      ...(generation === undefined ? {} : { assignmentGeneration: generation }),
      updatedAt: new Date().toISOString(),
    },
    paths.pairingState,
  );
}

function adopted(): void {
  // The private key must exist too: `currentPhase` will not call a card adopted
  // when it holds a certificate it cannot use.
  mkdirSync(paths.operational.directory, { recursive: true });
  writeFileSync(paths.operational.privateKey, "fixture-key-placeholder\n", { mode: 0o600 });
  commitAdoption(
    {
      certificatePem: "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----",
      chainPem: "-----BEGIN CERTIFICATE-----\nchain\n-----END CERTIFICATE-----",
      manifest: {
        phase: "ADOPTED",
        deviceRecordId: DEVICE,
        environment: "development",
        credentialId: "c0000000-0000-4000-8000-000000000002",
        certificateGeneration: 2,
        certificateSerial: "DEV-0ABCDEF012345678",
        certificateX509Serial: "0abcdef012345678",
        certificateSha256: "cd".repeat(32),
        publicKeyFingerprint: "ef".repeat(32),
        publicKeyAlgorithm: "rsa-2048",
        notBefore: new Date().toISOString(),
        notAfter: new Date(Date.now() + 86_400_000).toISOString(),
        requestId: "r-1",
        adoptedAt: new Date().toISOString(),
      },
    },
    paths.operational,
  );
}

describe("what the card claims", () => {
  it("a current Store Hub card claims its device, Store, generations and identity key", () => {
    imageEnv("KITLUY_DEVICE_CLASS=store_hub\nKITLUY_ENVIRONMENT=development\n");
    registered();
    pairedHub(3);
    adopted();
    expect(readMediaClaims(paths)).toEqual({
      imageDeviceClass: "store_hub",
      imageEnvironment: "development",
      hasAdoptedCredential: true,
      deviceRecordId: DEVICE,
      certificateGeneration: 2,
      assignmentGeneration: 3,
      identityKeyFingerprint: KEY,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
    });
  });

  it("a freshly flashed card claims only what the image says it is", () => {
    imageEnv("KITLUY_DEVICE_CLASS=terminal\n");
    expect(readMediaClaims(paths)).toEqual({
      imageDeviceClass: "terminal",
      imageEnvironment: "development",
      hasAdoptedCredential: false,
    });
  });

  it("an image that does not say what it is cannot be classified", () => {
    imageEnv("KITLUY_ENVIRONMENT=development\n");
    expect(readMediaClaims(paths)).toBeNull();
    imageEnv("KITLUY_DEVICE_CLASS=kiosk\n");
    expect(readMediaClaims(paths)).toBeNull();
    imageEnv("KITLUY_DEVICE_CLASS=store_hub\nKITLUY_ENVIRONMENT=staging\n");
    expect(readMediaClaims(paths)).toBeNull();
  });

  it("a manifest without its certificate or its key is a half-copied card, not an adopted one", () => {
    imageEnv("KITLUY_DEVICE_CLASS=store_hub\n");
    for (const missing of ["certificate", "privateKey"] as const) {
      adopted();
      expect(readMediaClaims(paths)?.hasAdoptedCredential).toBe(true);
      rmSync(paths.operational[missing]);
      const claims = readMediaClaims(paths);
      expect(claims?.hasAdoptedCredential, missing).toBe(false);
      expect(claims && "certificateGeneration" in claims).toBe(false);
    }
  });

  it("a generation the pairing never stated is not claimed", () => {
    imageEnv("KITLUY_DEVICE_CLASS=store_hub\n");
    pairedHub(undefined);
    expect(readMediaClaims(paths) && "assignmentGeneration" in readMediaClaims(paths)!).toBe(false);
  });

  it("a Terminal's references are claimed only when they are ids", () => {
    imageEnv("KITLUY_DEVICE_CLASS=terminal\n");
    mkdirSync(join(dir, "terminal"), { recursive: true });
    writeFileSync(
      paths.terminalAssignment!,
      JSON.stringify({
        deviceRecordId: DEVICE,
        assignmentGeneration: 2,
        digitalStoreReference: "Coffee Corner",
        storeLocationReference: LOCATION,
      }),
    );
    const claims = readMediaClaims(paths)!;
    expect(claims.deviceRecordId).toBe(DEVICE);
    expect(claims.assignmentGeneration).toBe(2);
    expect("digitalStoreId" in claims).toBe(false);
    expect(claims.storeLocationId).toBe(LOCATION);
  });

  it("maps what registration last heard, and claims nothing it did not hear", () => {
    expect(registrationOutcomeFor("AWAITING_APPROVAL")).toBe("PENDING_APPROVAL");
    expect(registrationOutcomeFor("APPROVED")).toBe("KNOWN_DEVICE_INSTALLATION_REGISTERED");
    expect(registrationOutcomeFor("CONTAINED")).toBe("TRUST_REVIEW_REQUIRED");
    expect(registrationOutcomeFor("UNREACHABLE")).toBe("UNREACHABLE");
    expect(registrationOutcomeFor("REGISTERING")).toBeUndefined();
    expect(registrationOutcomeFor(undefined)).toBeUndefined();
  });
});

describe("what the board reads about itself", () => {
  it("storage: opened, not opened, or absent — never 'foreign'", () => {
    const dev = join(dir, "dev");
    mkdirSync(dev);
    expect(readHubStoragePosture(dev)).toBe("absent");
    writeFileSync(join(dev, "nvme0n1"), "");
    expect(readHubStoragePosture(dev)).toBe("not_opened");
    mkdirSync(join(dev, "mapper"));
    writeFileSync(join(dev, "mapper", "kitluy-hub-data"), "");
    expect(readHubStoragePosture(dev)).toBe("opened");
    expect(readHubStoragePosture(join(dir, "no-such-dev"))).toBe("absent");
  });

  it("board signals only, normalised; storage never identifies a board", () => {
    expect(
      bootSignalsFrom({
        boardSerial: " 10000000ABCDEF12 ",
        socSerial: "1F00E4C9",
        macAddress: "D8:3A:DD:11:22:33",
        storageSerial: "0x1a2b",
        storageModel: "SC32G",
      }),
    ).toEqual([
      { signalType: "board_serial", signalValue: "10000000abcdef12" },
      { signalType: "soc_serial", signalValue: "1f00e4c9" },
      { signalType: "mac_address", signalValue: "d8:3a:dd:11:22:33" },
    ]);
  });

  it("the claims digest ignores key order", () => {
    const a: MediaClaims = {
      imageDeviceClass: "store_hub",
      imageEnvironment: "development",
      hasAdoptedCredential: true,
      deviceRecordId: DEVICE,
    };
    const b = {
      deviceRecordId: DEVICE,
      hasAdoptedCredential: true,
      imageEnvironment: "development",
      imageDeviceClass: "store_hub",
    } as MediaClaims;
    expect(claimsDigest(a)).toBe(claimsDigest(b));
    expect(claimsDigest({ ...a, certificateGeneration: 3 })).not.toBe(claimsDigest(a));
  });
});

const CARD: MediaClaims = {
  imageDeviceClass: "store_hub",
  imageEnvironment: "development",
  hasAdoptedCredential: true,
  deviceRecordId: DEVICE,
  certificateGeneration: 2,
  assignmentGeneration: 3,
  digitalStoreId: STORE,
  storeLocationId: LOCATION,
  identityKeyFingerprint: KEY,
};
const THIS_BOARD: BootSignal[] = [
  { signalType: "board_serial", signalValue: "10000000abcdef12" },
  { signalType: "mac_address", signalValue: "d8:3a:dd:11:22:33" },
];
const OTHER_BOARD: BootSignal[] = [{ signalType: "board_serial", signalValue: "10000000ffff0000" }];

const READY: ShopDecision = {
  classification: "READY",
  reasonCode: "KLUY-BOOT-READY",
  nextAction: "NONE",
  userMessageKey: "boot.ready",
  retryAutomatically: false,
  servesLocally: true,
};
const LOCKED: ShopDecision = {
  classification: "SECURITY_LOCK",
  reasonCode: "KLUY-BOOT-LOCKED-QUARANTINED",
  nextAction: "CONTACT_ADMIN",
  userMessageKey: "boot.locked",
  retryAutomatically: false,
  servesLocally: false,
};

const answering = (decision: ShopDecision) => (): Promise<BootClassificationCall> =>
  Promise.resolve({ kind: "answered", decision });
const unreachable = (): Promise<BootClassificationCall> =>
  Promise.resolve({ kind: "unreachable", detail: "the registry could not be reached" });

describe("who decides", () => {
  it("the cloud, when it answers — and its answer is bound to this board and this card", async () => {
    const { state, logLine } = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: true,
      call: answering(READY),
      previous: null,
      now: new Date("2026-09-16T08:00:00Z"),
    });
    expect(state.current).toMatchObject({ classification: "READY", source: "cloud" });
    expect(state.lastCloudAnswer).toEqual({
      classification: "READY",
      boardSerial: "10000000abcdef12",
      claimsDigest: claimsDigest(CARD),
      answeredAt: "2026-09-16T08:00:00.000Z",
    });
    expect(logLine).not.toContain(DEVICE);
  });

  it("offline after a READY on this board: waiting, and the shop keeps trading", async () => {
    const first = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: true,
      call: answering(READY),
      previous: null,
      now: new Date(),
    });
    for (const input of [{ networkUp: false }, { networkUp: true, call: unreachable }]) {
      const { state } = await classifyThisBoot({
        media: CARD,
        signals: THIS_BOARD,
        storage: "opened",
        previous: first.state,
        now: new Date(),
        ...input,
      });
      expect(state.current).toMatchObject({
        classification: "WAITING",
        servesLocally: true,
        source: "board",
      });
      // The confirmation survives the outage for the next boot.
      expect(state.lastCloudAnswer).toEqual(first.state.lastCloudAnswer);
    }
  });

  it("the same card cloned into another Pi does not inherit the confirmation", async () => {
    const first = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: true,
      call: answering(READY),
      previous: null,
      now: new Date(),
    });
    const { state } = await classifyThisBoot({
      media: CARD,
      signals: OTHER_BOARD,
      storage: "opened",
      networkUp: false,
      previous: first.state,
      now: new Date(),
    });
    expect(state.current).toMatchObject({ classification: "WAITING", servesLocally: false });
  });

  it("a card whose claims changed since the confirmation does not trade offline", async () => {
    const first = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: true,
      call: answering(READY),
      previous: null,
      now: new Date(),
    });
    const { state } = await classifyThisBoot({
      media: { ...CARD, digitalStoreId: LOCATION },
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: false,
      previous: first.state,
      now: new Date(),
    });
    expect(state.current.servesLocally).toBe(false);
  });

  it("a lock from the cloud supersedes an earlier READY for every later outage", async () => {
    const ready = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: true,
      call: answering(READY),
      previous: null,
      now: new Date(),
    });
    const locked = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: true,
      call: answering(LOCKED),
      previous: ready.state,
      now: new Date(),
    });
    const offline = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: false,
      previous: locked.state,
      now: new Date(),
    });
    expect(offline.state.current.servesLocally).toBe(false);
  });

  it("offline is never new hardware and never a new device, whatever the card names", async () => {
    for (const media of [
      CARD,
      {
        imageDeviceClass: "store_hub",
        imageEnvironment: "development",
        hasAdoptedCredential: false,
      } as MediaClaims,
    ]) {
      const { state } = await classifyThisBoot({
        media,
        signals: THIS_BOARD,
        networkUp: true,
        call: unreachable,
        previous: null,
        now: new Date(),
      });
      expect(state.current.classification).toBe("WAITING");
      expect(["REPLACE_HARDWARE", "NEW_DEVICE"]).not.toContain(state.current.classification);
    }
  });

  it("a refused request and a missing registry URL are both decided on the board, and say why", async () => {
    const refused = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      networkUp: true,
      previous: null,
      now: new Date(),
      call: () => Promise.resolve({ kind: "refused", status: 503, code: "DEPENDENCY_UNAVAILABLE" }),
    });
    expect(refused.state.current).toMatchObject({ classification: "WAITING", source: "board" });
    expect(refused.logLine).toContain("503 DEPENDENCY_UNAVAILABLE");
    const unconfigured = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      networkUp: true,
      previous: null,
      now: new Date(),
    });
    expect(unconfigured.logLine).toContain("no registry URL configured");
  });

  it("an offline Hub whose volume did not open is sent to HET support, not left serving", async () => {
    const first = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "opened",
      networkUp: true,
      call: answering(READY),
      previous: null,
      now: new Date(),
    });
    const { state } = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      storage: "not_opened",
      networkUp: false,
      previous: first.state,
      now: new Date(),
    });
    expect(state.current).toMatchObject({
      classification: "SECURITY_LOCK",
      nextAction: "CONTACT_HET_SUPPORT",
      servesLocally: false,
    });
  });
});

describe("the wire and the file", () => {
  it("accepts only a decision made of values this board knows", () => {
    expect(shopDecisionFrom({ ...READY, correlationId: "c" })).toEqual(READY);
    expect(shopDecisionFrom({ ...READY, classification: "MAYBE" })).toBeNull();
    expect(shopDecisionFrom({ ...READY, userMessageKey: "boot.unknown" })).toBeNull();
    expect(shopDecisionFrom({ ...READY, reasonCode: "SOMETHING" })).toBeNull();
    expect(shopDecisionFrom({ ...READY, servesLocally: "yes" })).toBeNull();
  });

  it("the HTTP call: answered, malformed, refused, unreachable, timed out", async () => {
    const respond = (status: number, body: unknown) =>
      (() =>
        Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch;
    const body = { signals: THIS_BOARD, media: CARD };
    expect(
      await createHttpBootClassificationCall({
        baseUrl: "http://r",
        fetchImpl: respond(200, { ...READY, correlationId: "x" }),
      })(body),
    ).toEqual({ kind: "answered", decision: READY });
    expect(
      await createHttpBootClassificationCall({
        baseUrl: "http://r",
        fetchImpl: respond(200, { classification: "READY" }),
      })(body),
    ).toMatchObject({ kind: "refused", code: "BOOT_MALFORMED_RESPONSE" });
    expect(
      await createHttpBootClassificationCall({
        baseUrl: "http://r",
        fetchImpl: respond(422, { error: { code: "VALIDATION_FAILED" } }),
      })(body),
    ).toEqual({ kind: "refused", status: 422, code: "VALIDATION_FAILED" });
    const down = (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    expect(
      await createHttpBootClassificationCall({ baseUrl: "http://r", fetchImpl: down })(body),
    ).toMatchObject({ kind: "unreachable" });
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      })) as unknown as typeof fetch;
    expect(
      await createHttpBootClassificationCall({
        baseUrl: "http://r",
        fetchImpl: hang,
        timeoutMs: 5,
      })(body),
    ).toEqual({ kind: "unreachable", detail: "the registry did not answer within 5ms" });
  });

  it("the state file round-trips, and a damaged one reads as nothing", async () => {
    const path = join(dir, "boot-classification.json");
    const { state } = await classifyThisBoot({
      media: CARD,
      signals: THIS_BOARD,
      networkUp: true,
      call: answering(READY),
      previous: null,
      now: new Date(),
    });
    writeBootClassificationState(state, path);
    expect(readBootClassificationState(path)).toEqual(state);
    writeFileSync(path, "{ not json");
    expect(readBootClassificationState(path)).toBeNull();
    writeFileSync(path, JSON.stringify({ current: { classification: "READY" } }));
    expect(readBootClassificationState(path)).toBeNull();
  });
});
