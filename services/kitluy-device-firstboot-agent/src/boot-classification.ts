/**
 * Boot classification, board half: what this board can know about itself, the
 * one question it asks the cloud, and the answer it falls back to offline.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slice F; registry
 * group 0227 and `POST /v1/device-boot/classification`.
 *
 * ===========================================================================
 * ONE CLASSIFIER, SHIPPED TWICE
 * ===========================================================================
 * The decision is `@kitluy/device-boot-classification`. The image ships no
 * `node_modules` (`package-bootstrap-runtime.sh` refuses a runtime dependency),
 * so `boot-classification-contract.ts` is that package's source, byte for byte,
 * and `test/boot-classification-contract-drift.test.ts` fails if a single byte
 * differs. There is no second decision table here: this file only gathers
 * evidence and chooses WHO decides — the cloud when it answers, the same
 * contract on the board when it does not.
 *
 * ===========================================================================
 * WHAT THE BOARD CLAIMS, AND WHAT IT NEVER DOES
 * ===========================================================================
 * The card's state files are read as CLAIMS. Nothing here decides that the card
 * is right for this board: that needs the cloud's view of the hardware. Offline,
 * the board reports `unresolved` — never `unknown` — so an outage can never be
 * read as "new hardware" or "new device".
 *
 * The one thing the board may carry across an outage is the cloud's last
 * answer, bound to the board serial it read at the time and to a digest of the
 * card's claims. A card cloned into another Pi reads a different serial there,
 * so it does not inherit the confirmation, and does not keep trading.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classifyBoot,
  DEFAULT_USER_MESSAGES,
  type BootClassification,
  type BootDecision,
  type BootEvidence,
  type BootReasonCode,
  type DeviceClass,
  type DeviceEnvironment,
  type MediaClaims,
  type NextAction,
  type RegistrationOutcome,
  type StoragePosture,
} from "./boot-classification-contract.js";
import { writeDurable } from "./durable-write.js";
import type { HardwareSignals } from "./identity.js";
import { readImageEnv } from "./image-env.js";
import { currentPhase, OPERATIONAL_PATHS, readManifest } from "./operational-credential-state.js";
import { readPairedIdentity, TERMINAL_ASSIGNMENT_PATH } from "./paired-identity.js";
import { PAIRING_STATE_PATH, readPairingState } from "./pairing-state.js";
import {
  REGISTRATION_STATE_PATH,
  readRegistrationState,
  type RegistrationPhase,
} from "./registration-state.js";

export const BOOT_CLASSIFICATION_ROUTE = "/v1/device-boot/classification";
export const BOOT_CLASSIFICATION_STATE_PATH = "/var/lib/kitluy/boot-classification.json";
/** `hub-storage-provision`'s mapper name. */
export const HUB_DATA_MAPPER = "kitluy-hub-data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

/** The part of a decision a board shows and acts on. Never an id or a detail. */
export type ShopDecision = Pick<
  BootDecision,
  | "classification"
  | "reasonCode"
  | "nextAction"
  | "userMessageKey"
  | "retryAutomatically"
  | "servesLocally"
>;

export interface BootClassificationState {
  readonly current: ShopDecision & {
    /** Who decided: the cloud, or this board's copy of the contract offline. */
    readonly source: "cloud" | "board";
    readonly decidedAt: string;
  };
  /**
   * The cloud's most recent answer for this board, whatever it was. Replaced on
   * every cloud answer, so a later lock always supersedes an earlier READY.
   */
  readonly lastCloudAnswer?: {
    readonly classification: BootClassification;
    readonly boardSerial: string;
    readonly claimsDigest: string;
    readonly answeredAt: string;
  };
}

export interface BootSignal {
  readonly signalType: "board_serial" | "soc_serial" | "mac_address";
  readonly signalValue: string;
}

// ---------------------------------------------------------------------------
// Evidence the board can read
// ---------------------------------------------------------------------------

export interface CardPaths {
  readonly etcRoot?: string;
  readonly registrationState?: string;
  readonly pairingState?: string;
  readonly terminalAssignment?: string;
  readonly operational?: Parameters<typeof readManifest>[0];
}

function uuidOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

/** The terminal's seat file, for the two scope references only. */
function terminalScope(path: string): { digitalStoreId?: string; storeLocationId?: string } {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const digitalStoreId = uuidOrUndefined(raw.digitalStoreReference);
    const storeLocationId = uuidOrUndefined(raw.storeLocationReference);
    return {
      ...(digitalStoreId === undefined ? {} : { digitalStoreId }),
      ...(storeLocationId === undefined ? {} : { storeLocationId }),
    };
  } catch {
    return {};
  }
}

/**
 * What the card says about itself, or null when the IMAGE does not say what it
 * is — without a device class the board cannot even be compared.
 */
export function readMediaClaims(paths: CardPaths = {}): MediaClaims | null {
  const deviceClass = readImageEnv("KITLUY_DEVICE_CLASS", paths.etcRoot);
  if (deviceClass !== "store_hub" && deviceClass !== "terminal") return null;
  const imageDeviceClass: DeviceClass = deviceClass;
  // The same default every other reader of this key applies.
  const environment = readImageEnv("KITLUY_ENVIRONMENT", paths.etcRoot) ?? "development";
  if (environment !== "development" && environment !== "pilot" && environment !== "production") {
    return null;
  }
  const imageEnvironment: DeviceEnvironment = environment;

  // `currentPhase`, not the manifest alone: a manifest whose certificate or chain
  // file is missing is a half-copied card, and must not read as adopted.
  const operational = paths.operational ?? OPERATIONAL_PATHS;
  const manifest = currentPhase(operational) === "ADOPTED" ? readManifest(operational) : null;
  const paired = readPairedIdentity({
    pairingStatePath: paths.pairingState ?? PAIRING_STATE_PATH,
    terminalAssignmentPath: paths.terminalAssignment ?? TERMINAL_ASSIGNMENT_PATH,
  });
  const registration = readRegistrationState(paths.registrationState ?? REGISTRATION_STATE_PATH);

  // The adopted certificate names the device most authoritatively the card can,
  // then the pairing, then registration. They agree on a healthy card.
  const deviceRecordId =
    uuidOrUndefined(manifest?.deviceRecordId) ??
    uuidOrUndefined(paired?.deviceRecordId) ??
    uuidOrUndefined(registration?.deviceId);

  let scope: { digitalStoreId?: string; storeLocationId?: string } = {};
  if (paired?.source === "hub-pairing-state") {
    const hub = readPairingState(paths.pairingState ?? PAIRING_STATE_PATH);
    const digitalStoreId = uuidOrUndefined(hub?.digitalStoreId);
    const storeLocationId = uuidOrUndefined(hub?.storeLocationId);
    scope = {
      ...(digitalStoreId === undefined ? {} : { digitalStoreId }),
      ...(storeLocationId === undefined ? {} : { storeLocationId }),
    };
  } else if (paired?.source === "terminal-assignment") {
    scope = terminalScope(paths.terminalAssignment ?? TERMINAL_ASSIGNMENT_PATH);
  }

  const fingerprint = registration?.keyFingerprint;
  const claims: MediaClaims = {
    imageDeviceClass,
    imageEnvironment,
    hasAdoptedCredential: manifest !== null,
    ...(deviceRecordId === undefined ? {} : { deviceRecordId }),
    ...(manifest === null ? {} : { certificateGeneration: manifest.certificateGeneration }),
    // Only a generation the cloud STATED. An assumed legacy 1 would be a claim
    // this card cannot back, and would read as outdated on a re-paired device.
    ...(paired?.assignmentGenerationSource === "stated"
      ? { assignmentGeneration: paired.assignmentGeneration }
      : {}),
    ...(typeof fingerprint === "string" && SHA256_HEX.test(fingerprint)
      ? { identityKeyFingerprint: fingerprint.toLowerCase() }
      : {}),
    ...scope,
  };
  return claims;
}

/** What `registration-state.json` says the cloud last answered. */
export function registrationOutcomeFor(
  phase: RegistrationPhase | undefined,
): RegistrationOutcome | undefined {
  switch (phase) {
    case "AWAITING_APPROVAL":
      return "PENDING_APPROVAL";
    case "APPROVED":
      return "KNOWN_DEVICE_INSTALLATION_REGISTERED";
    // CONTAINED is the cloud's TRUST_REVIEW_REQUIRED with a containment reason.
    case "TRUST_REVIEW_REQUIRED":
    case "CONTAINED":
      return "TRUST_REVIEW_REQUIRED";
    case "UNREACHABLE":
      return "UNREACHABLE";
    default:
      // Not registered yet, or mid-attempt: nothing the cloud said.
      return undefined;
  }
}

/**
 * The Store Hub data volume, as far as a board can SEE it: the mapper exists,
 * or no NVMe drive exists, or a drive exists and was not opened. It never
 * claims "foreign" — see GAP-BOOT-006 in the contract.
 */
export function readHubStoragePosture(devRoot = "/dev"): StoragePosture {
  let entries: string[];
  try {
    entries = readdirSync(devRoot);
  } catch {
    return "absent";
  }
  try {
    if (readdirSync(join(devRoot, "mapper")).includes(HUB_DATA_MAPPER)) return "opened";
  } catch {
    // No mapper directory: nothing is open.
  }
  return entries.some((name) => /^nvme\d+n1$/.test(name)) ? "not_opened" : "absent";
}

/** Board signals only. Storage signals describe the card and never identify a board. */
export function bootSignalsFrom(hardware: HardwareSignals): BootSignal[] {
  const signals: BootSignal[] = [];
  const add = (signalType: BootSignal["signalType"], value: string | undefined) => {
    const normalised = value?.trim().toLowerCase();
    if (normalised !== undefined && normalised !== "") {
      signals.push({ signalType, signalValue: normalised });
    }
  };
  add("board_serial", hardware.boardSerial);
  add("soc_serial", hardware.socSerial);
  add("mac_address", hardware.macAddress);
  return signals;
}

/** A stable digest of the card's claims: sorted keys, so a rewrite in another order matches. */
export function claimsDigest(media: MediaClaims): string {
  const sorted = Object.fromEntries(
    Object.entries(media).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

// ---------------------------------------------------------------------------
// The state file
// ---------------------------------------------------------------------------

const CLASSIFICATIONS: readonly BootClassification[] = [
  "READY",
  "RECOVERING_DEVICE",
  "NEW_DEVICE",
  "WRONG_MEDIA",
  "REPLACE_HARDWARE",
  "SECURITY_LOCK",
  "WAITING",
];
const NEXT_ACTIONS: readonly NextAction[] = [
  "NONE",
  "WAIT",
  "ENTER_PAIRING_CODE",
  "RELEASE_DEVICE_THEN_PAIR",
  "APPROVE_ENROLLMENT",
  "REPLACE_DEVICE",
  "INSERT_CORRECT_MEDIA",
  "CONTACT_ADMIN",
  "CONTACT_HET_SUPPORT",
];

/** A decision from the wire, or null when any field is not one this board knows. */
export function shopDecisionFrom(value: unknown): ShopDecision | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.classification !== "string" ||
    !(CLASSIFICATIONS as readonly string[]).includes(v.classification) ||
    typeof v.nextAction !== "string" ||
    !(NEXT_ACTIONS as readonly string[]).includes(v.nextAction) ||
    typeof v.userMessageKey !== "string" ||
    !Object.hasOwn(DEFAULT_USER_MESSAGES, v.userMessageKey) ||
    typeof v.reasonCode !== "string" ||
    !v.reasonCode.startsWith("KLUY-BOOT-") ||
    typeof v.retryAutomatically !== "boolean" ||
    typeof v.servesLocally !== "boolean"
  ) {
    return null;
  }
  return {
    classification: v.classification as BootClassification,
    reasonCode: v.reasonCode as BootReasonCode,
    nextAction: v.nextAction as NextAction,
    userMessageKey: v.userMessageKey as ShopDecision["userMessageKey"],
    retryAutomatically: v.retryAutomatically,
    servesLocally: v.servesLocally,
  };
}

export function readBootClassificationState(
  path = BOOT_CLASSIFICATION_STATE_PATH,
): BootClassificationState | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const current = shopDecisionFrom(raw.current);
    if (current === null) return null;
    const c = raw.current as Record<string, unknown>;
    const last = raw.lastCloudAnswer as Record<string, unknown> | undefined;
    const lastCloudAnswer =
      last !== undefined &&
      typeof last.classification === "string" &&
      (CLASSIFICATIONS as readonly string[]).includes(last.classification) &&
      typeof last.boardSerial === "string" &&
      typeof last.claimsDigest === "string" &&
      typeof last.answeredAt === "string"
        ? {
            classification: last.classification as BootClassification,
            boardSerial: last.boardSerial,
            claimsDigest: last.claimsDigest,
            answeredAt: last.answeredAt,
          }
        : undefined;
    return {
      current: {
        ...current,
        source: c.source === "cloud" ? "cloud" : "board",
        decidedAt: typeof c.decidedAt === "string" ? c.decidedAt : "",
      },
      ...(lastCloudAnswer === undefined ? {} : { lastCloudAnswer }),
    };
  } catch {
    return null;
  }
}

export function writeBootClassificationState(
  state: BootClassificationState,
  path = BOOT_CLASSIFICATION_STATE_PATH,
): void {
  // World-readable on purpose: the consoles render it, and it carries no id,
  // no detail and no secret — a classification, a message key and two digests.
  writeDurable(path, `${JSON.stringify(state, null, 2)}\n`, 0o644);
}

// ---------------------------------------------------------------------------
// The call, and the decision
// ---------------------------------------------------------------------------

export type BootClassificationCall =
  | { readonly kind: "answered"; readonly decision: ShopDecision }
  | { readonly kind: "unreachable"; readonly detail: string }
  | { readonly kind: "refused"; readonly status: number; readonly code: string };

export interface BootClassificationRequestBody {
  readonly signals: readonly BootSignal[];
  readonly media: MediaClaims;
  readonly registration?: RegistrationOutcome;
  readonly storage?: StoragePosture;
}

export function createHttpBootClassificationCall(options: {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}): (body: BootClassificationRequestBody) => Promise<BootClassificationCall> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  return async (body) => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${options.baseUrl}${BOOT_CLASSIFICATION_ROUTE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return { kind: "refused", status: response.status, code: "BOOT_MALFORMED_RESPONSE" };
      }
      if (response.ok) {
        const decision = shopDecisionFrom(payload);
        return decision === null
          ? { kind: "refused", status: response.status, code: "BOOT_MALFORMED_RESPONSE" }
          : { kind: "answered", decision };
      }
      const error = (payload as { error?: { code?: unknown } } | null)?.error;
      return {
        kind: "refused",
        status: response.status,
        code: typeof error?.code === "string" ? error.code : "BOOT_REFUSED",
      };
    } catch (error) {
      return {
        kind: "unreachable",
        detail:
          error instanceof Error && error.name === "AbortError"
            ? `the registry did not answer within ${String(timeoutMs)}ms`
            : "the registry could not be reached",
      };
    } finally {
      clearTimeout(deadline);
    }
  };
}

export interface ClassifyThisBootInput {
  readonly media: MediaClaims;
  readonly signals: readonly BootSignal[];
  readonly registration?: RegistrationOutcome;
  readonly storage?: StoragePosture;
  /** Whether any interface has link. No link: the cloud is not even tried. */
  readonly networkUp: boolean;
  /** Absent when no registry URL is configured: the board classifies alone. */
  readonly call?: (body: BootClassificationRequestBody) => Promise<BootClassificationCall>;
  readonly previous: BootClassificationState | null;
  readonly now: Date;
}

export interface ClassifyThisBootResult {
  readonly state: BootClassificationState;
  /** One log line for the journal. No ids, no Store scope. */
  readonly logLine: string;
}

export async function classifyThisBoot(
  input: ClassifyThisBootInput,
): Promise<ClassifyThisBootResult> {
  const boardSerial = input.signals.find((s) => s.signalType === "board_serial")?.signalValue;
  const digest = claimsDigest(input.media);
  const at = input.now.toISOString();

  const body: BootClassificationRequestBody = {
    signals: input.signals,
    media: input.media,
    ...(input.registration === undefined ? {} : { registration: input.registration }),
    ...(input.storage === undefined ? {} : { storage: input.storage }),
  };

  let why: string;
  if (!input.networkUp) {
    why = "no network link";
  } else if (input.call === undefined) {
    why = "no registry URL configured";
  } else if (input.signals.length === 0) {
    why = "no hardware signals could be read";
  } else {
    const answer = await input.call(body);
    if (answer.kind === "answered") {
      return {
        state: {
          current: { ...answer.decision, source: "cloud", decidedAt: at },
          // Only a board that read its own serial can carry a confirmation.
          ...(boardSerial === undefined
            ? {}
            : {
                lastCloudAnswer: {
                  classification: answer.decision.classification,
                  boardSerial,
                  claimsDigest: digest,
                  answeredAt: at,
                },
              }),
        },
        logLine: `cloud: ${answer.decision.classification} ${answer.decision.reasonCode} next=${answer.decision.nextAction}`,
      };
    }
    why =
      answer.kind === "unreachable"
        ? answer.detail
        : `the registry refused the request (${String(answer.status)} ${answer.code})`;
  }

  // THE BOARD DECIDES, WITH THE SAME CONTRACT. `unresolved`, never `unknown`.
  const last = input.previous?.lastCloudAnswer;
  const confirmedReadyOnThisBoard =
    last !== undefined &&
    last.classification === "READY" &&
    boardSerial !== undefined &&
    last.boardSerial === boardSerial &&
    last.claimsDigest === digest;

  const evidence: BootEvidence = {
    boardResolution: "unresolved",
    media: input.media,
    connectivity: { networkUp: input.networkUp, cloudReachable: false },
    confirmedReadyOnThisBoard,
    ...(input.registration === undefined ? {} : { registration: input.registration }),
    ...(input.storage === undefined ? {} : { storage: input.storage }),
  };
  const decision = classifyBoot(evidence);
  return {
    state: {
      current: {
        classification: decision.classification,
        reasonCode: decision.reasonCode,
        nextAction: decision.nextAction,
        userMessageKey: decision.userMessageKey,
        retryAutomatically: decision.retryAutomatically,
        servesLocally: decision.servesLocally,
        source: "board",
        decidedAt: at,
      },
      // The cloud's last answer is kept, untouched, for the next outage.
      ...(last === undefined ? {} : { lastCloudAnswer: last }),
    },
    logLine: `board (${why}): ${decision.classification} ${decision.reasonCode} next=${decision.nextAction} servesLocally=${String(decision.servesLocally)}`,
  };
}
