/**
 * `POST /v1/device-boot/classification` — a booting board asks what happened to
 * it, and gets one classification and one next action.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slices C and F;
 * migration group 0227; the contract `@kitluy/device-boot-classification`; the
 * transport constants of KLD-2026-08-05-TERMINAL-TRANSPORT-001, reused.
 *
 * ===========================================================================
 * WHAT THIS ROUTE GRANTS: NOTHING
 * ===========================================================================
 * It is PRE-CREDENTIAL, like `/v1/device-enrollment`, `/v1/hub-pairing` and the
 * registration intake: a re-flashed board has no operational certificate yet,
 * and that board is precisely the one that most needs an answer. So its safety
 * cannot rest on authentication. It rests on three facts:
 *
 *   1. It writes nothing. The database read (group 0227) is `stable`, executable
 *      only by `kitluy_device_boot_service`, which can reach nothing else.
 *   2. It changes no outcome. Every governed door keeps its own refusals; a
 *      caller that lies about its card only changes the sentence on its own
 *      screen.
 *   3. It answers only the shop-safe decision. Never a device id, a Store or
 *      Location id, a generation or the admin detail. What remains is bounded
 *      by what the registration intake already returns for the same signals
 *      (the device id and its registration status), which is more.
 *
 * The admin detail goes to the service log, where support reads it.
 *
 * ===========================================================================
 * THE CARD'S FIELDS ARE CLAIMS
 * ===========================================================================
 * `media` is what the SD card says about itself. The route checks its SHAPE and
 * nothing else; the contract compares it against the device the hardware
 * resolves to. Nothing here looks anything up by a card-supplied id.
 */
import { errorEnvelope, httpStatusFor, isRetryable } from "@kitluy/api-errors";
import type {
  DeviceClass,
  DeviceEnvironment,
  MediaClaims,
  RegistrationOutcome,
  StoragePosture,
} from "@kitluy/device-boot-classification";

import type { RequestHeaders } from "./authentication.js";
import type {
  BootClassificationRequest,
  BootClassificationResult,
  BootSignal,
} from "./device-boot-classification.js";
import type { SafeLogger } from "./provisioning-composition.js";
import {
  BootstrapRateLimiter,
  MAX_REQUEST_BYTES,
  type BootstrapRouteRequest,
  type BootstrapRouteResponse,
} from "./provisioning-routes.js";

export const DEVICE_BOOT_PREFIX = "/v1/device-boot";
export const DEVICE_BOOT_CLASSIFICATION_PATH = `${DEVICE_BOOT_PREFIX}/classification`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `kitluy_devices.hardware_signal_type`, verbatim. */
const SIGNAL_TYPES: readonly string[] = [
  "mac_address",
  "board_serial",
  "soc_serial",
  "tpm_ek_public",
  "secure_element_id",
  "storage_serial",
  "storage_model",
  "boot_measurement",
  "os_image_digest",
];
const MAX_SIGNALS = 16;
const MAX_SIGNAL_VALUE = 256;

const REGISTRATION_OUTCOMES: readonly RegistrationOutcome[] = [
  "PENDING_APPROVAL",
  "KNOWN_DEVICE_INSTALLATION_REGISTERED",
  "TRUST_REVIEW_REQUIRED",
  "REFUSED",
  "UNREACHABLE",
];
const STORAGE_POSTURES: readonly StoragePosture[] = [
  "absent",
  "opened",
  "foreign",
  "unidentified",
  "not_opened",
  "opened_foreign_contents",
];
const IMAGE_CLASSES: readonly DeviceClass[] = ["store_hub", "terminal"];
const ENVIRONMENTS: readonly DeviceEnvironment[] = ["development", "pilot", "production"];

const BODY_FIELDS: readonly string[] = ["signals", "registration", "media", "storage"];
const MEDIA_FIELDS: readonly string[] = [
  "deviceRecordId",
  "certificateEnrollmentId",
  "identityKeyFingerprint",
  "certificateGeneration",
  "assignmentGeneration",
  "digitalStoreId",
  "storeLocationId",
  "imageDeviceClass",
  "imageEnvironment",
  "hasAdoptedCredential",
];

export interface DeviceBootRouter {
  handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse>;
}

export interface DeviceBootRouterDeps {
  /** `classifyDeviceBoot` bound to a pool and the deployment's trust environment. */
  readonly classify: (request: BootClassificationRequest) => Promise<BootClassificationResult>;
  readonly rateLimiter?: BootstrapRateLimiter;
  readonly logger?: SafeLogger;
  /** Injectable for tests. */
  readonly newCorrelationId?: () => string;
}

function headerValue(headers: RequestHeaders, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function correlationIdFrom(headers: RequestHeaders): string {
  const supplied = headerValue(headers, "x-correlation-id");
  return supplied !== undefined && /^[A-Za-z0-9_.:-]{1,128}$/.test(supplied) ? supplied : "";
}

function invalid(correlationId: string, detail: string): BootstrapRouteResponse {
  return {
    status: httpStatusFor("VALIDATION_FAILED"),
    body: errorEnvelope("VALIDATION_FAILED", detail, {
      correlationId,
      details: { retryable: false },
    }) as unknown as Record<string, unknown>,
  };
}

/** A request problem, stated without echoing the caller's value. */
class RequestShapeError extends Error {}

function objectOf(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestShapeError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function refuseUnknown(body: Record<string, unknown>, allowed: readonly string[], where: string) {
  const unknown = Object.keys(body).find((k) => !allowed.includes(k));
  if (unknown !== undefined) {
    // The field NAME is the caller's own text, but it is bounded by JSON key
    // syntax and says exactly what to fix; the value is never echoed.
    throw new RequestShapeError(`unknown field in ${where}: ${unknown.slice(0, 64)}`);
  }
}

function enumOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new RequestShapeError(`${field} has an unsupported value`);
  }
  return value as T;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new RequestShapeError(`${field} must be a uuid`);
  }
  return value;
}

function optionalFingerprint(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new RequestShapeError(`${field} must be a sha-256 hex digest`);
  }
  return value.toLowerCase();
}

function optionalGeneration(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RequestShapeError(`${field} must be a non-negative integer`);
  }
  return value;
}

function parseSignals(value: unknown): BootSignal[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SIGNALS) {
    throw new RequestShapeError(`signals must be an array of 1 to ${String(MAX_SIGNALS)} entries`);
  }
  return value.map((entry, i) => {
    const s = objectOf(entry, `signals[${String(i)}]`);
    refuseUnknown(s, ["signalType", "signalValue"], `signals[${String(i)}]`);
    const signalType = enumOf(s.signalType, SIGNAL_TYPES, `signals[${String(i)}].signalType`);
    if (
      typeof s.signalValue !== "string" ||
      s.signalValue.length === 0 ||
      s.signalValue.length > MAX_SIGNAL_VALUE
    ) {
      throw new RequestShapeError(`signals[${String(i)}].signalValue must be a non-empty string`);
    }
    return { signalType, signalValue: s.signalValue };
  });
}

function parseMedia(value: unknown): MediaClaims {
  const m = objectOf(value, "media");
  refuseUnknown(m, MEDIA_FIELDS, "media");
  if (typeof m.hasAdoptedCredential !== "boolean") {
    throw new RequestShapeError("media.hasAdoptedCredential must be a boolean");
  }
  const claims: Record<string, unknown> = {
    imageDeviceClass: enumOf(m.imageDeviceClass, IMAGE_CLASSES, "media.imageDeviceClass"),
    imageEnvironment: enumOf(m.imageEnvironment, ENVIRONMENTS, "media.imageEnvironment"),
    hasAdoptedCredential: m.hasAdoptedCredential,
    deviceRecordId: optionalUuid(m.deviceRecordId, "media.deviceRecordId"),
    certificateEnrollmentId: optionalUuid(
      m.certificateEnrollmentId,
      "media.certificateEnrollmentId",
    ),
    identityKeyFingerprint: optionalFingerprint(
      m.identityKeyFingerprint,
      "media.identityKeyFingerprint",
    ),
    certificateGeneration: optionalGeneration(
      m.certificateGeneration,
      "media.certificateGeneration",
    ),
    assignmentGeneration: optionalGeneration(m.assignmentGeneration, "media.assignmentGeneration"),
    digitalStoreId: optionalUuid(m.digitalStoreId, "media.digitalStoreId"),
    storeLocationId: optionalUuid(m.storeLocationId, "media.storeLocationId"),
  };
  // Absent stays absent: the contract reads a missing claim as a fresh card.
  for (const key of Object.keys(claims)) {
    if (claims[key] === undefined) delete claims[key];
  }
  return claims as unknown as MediaClaims;
}

export function parseBootClassificationBody(rawBody: string): BootClassificationRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new RequestShapeError("body must be a JSON object");
  }
  const body = objectOf(parsed, "body");
  refuseUnknown(body, BODY_FIELDS, "body");
  return {
    signals: parseSignals(body.signals),
    media: parseMedia(body.media),
    ...(body.registration === undefined
      ? {}
      : { registration: enumOf(body.registration, REGISTRATION_OUTCOMES, "registration") }),
    ...(body.storage === undefined
      ? {}
      : { storage: enumOf(body.storage, STORAGE_POSTURES, "storage") }),
  };
}

export function createDeviceBootRouter(deps: DeviceBootRouterDeps): DeviceBootRouter {
  const limiter = deps.rateLimiter ?? new BootstrapRateLimiter();
  const newCorrelationId = deps.newCorrelationId ?? (() => crypto.randomUUID());

  return {
    async handle(request: BootstrapRouteRequest): Promise<BootstrapRouteResponse> {
      const correlationId = correlationIdFrom(request.headers) || newCorrelationId();

      if (request.path !== DEVICE_BOOT_CLASSIFICATION_PATH) {
        return {
          status: httpStatusFor("RESOURCE_NOT_FOUND"),
          body: errorEnvelope("RESOURCE_NOT_FOUND", "no such device-boot route", {
            correlationId,
            details: { retryable: false },
          }) as unknown as Record<string, unknown>,
        };
      }
      if (request.method.toUpperCase() !== "POST") {
        return invalid(correlationId, "method not allowed");
      }
      // Cheapest check first: a length, before any parse an unauthenticated
      // caller could force.
      if (Buffer.byteLength(request.rawBody, "utf8") > MAX_REQUEST_BYTES) {
        return invalid(correlationId, "request body exceeds the maximum size");
      }
      // Keyed on the transport-observed peer, never on a caller-chosen value,
      // and charged before parsing (see `hub-pairing-routes.ts`).
      const allowance = limiter.consume(request.sourceIp);
      if (!allowance.allowed) {
        return {
          status: httpStatusFor("RATE_LIMITED"),
          body: errorEnvelope("RATE_LIMITED", "too many boot classification requests", {
            correlationId,
            details: { retryable: true },
          }) as unknown as Record<string, unknown>,
          headers: { "Retry-After": String(allowance.retryAfterSeconds) },
        };
      }
      const contentType = headerValue(request.headers, "content-type");
      if (contentType?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        return invalid(correlationId, "content-type must be application/json");
      }

      let parsed: BootClassificationRequest;
      try {
        parsed = parseBootClassificationBody(request.rawBody);
      } catch (error) {
        if (error instanceof RequestShapeError) return invalid(correlationId, error.message);
        throw error;
      }

      let result: BootClassificationResult;
      try {
        result = await deps.classify(parsed);
      } catch (error) {
        // The board keeps its own WAITING_FOR_CLOUD state and retries. The cause
        // is logged by name only: a database message can name schemas and roles.
        deps.logger?.info({
          event: "device-boot-classification-unavailable",
          correlationId,
          cause: error instanceof Error ? error.name : "unknown",
        });
        return {
          status: httpStatusFor("DEPENDENCY_UNAVAILABLE"),
          body: errorEnvelope("DEPENDENCY_UNAVAILABLE", "boot classification is unavailable", {
            correlationId,
            details: { retryable: isRetryable("DEPENDENCY_UNAVAILABLE") },
          }) as unknown as Record<string, unknown>,
        };
      }

      const { decision, evidence } = result;
      deps.logger?.info({
        event: "device-boot-classified",
        correlationId,
        classification: decision.classification,
        reasonCode: decision.reasonCode,
        nextAction: decision.nextAction,
        boardResolution: evidence.boardResolution,
        deviceRecordId: evidence.cloudDevice?.deviceRecordId ?? "",
        adminDetail: decision.adminDetail,
      });

      return {
        status: 200,
        body: {
          correlationId,
          classification: decision.classification,
          reasonCode: decision.reasonCode,
          nextAction: decision.nextAction,
          userMessageKey: decision.userMessageKey,
          retryAutomatically: decision.retryAutomatically,
          servesLocally: decision.servesLocally,
        },
      };
    },
  };
}
