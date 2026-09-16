/**
 * The boot classification HTTP surface.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 slice C; group 0227.
 *
 * The properties that are easiest to destroy at the route layer:
 *
 *   1. The answer carries the shop-safe decision and NOTHING else — no device,
 *      Store or Location id, no generation, no admin detail. The route is
 *      pre-credential; the admin detail belongs in the service log.
 *   2. The limiter runs before parsing, counts malformed attempts, and is keyed
 *      on the transport peer alone.
 *   3. An unknown field is a refusal, in the body and inside `media`.
 *   4. A database failure is DEPENDENCY_UNAVAILABLE and retryable, so the board
 *      keeps waiting rather than being told something false.
 *   5. A malformed evidence row is refused, never guessed into a branch.
 */
import { describe, expect, it } from "vitest";

import { httpStatusFor } from "@kitluy/api-errors";
import { classifyBoot, type BootEvidence } from "@kitluy/device-boot-classification";

import {
  BootEvidenceUnreadableError,
  cloudDeviceFactsFromRow,
} from "@kitluy/device-boot-classification/evidence-row";

import type {
  BootClassificationRequest,
  BootClassificationResult,
} from "../src/device-boot-classification.js";
import {
  createDeviceBootRouter,
  DEVICE_BOOT_CLASSIFICATION_PATH,
  parseBootClassificationBody,
} from "../src/device-boot-routes.js";
import { handleRequest } from "../src/http.js";
import { BootstrapRateLimiter, type BootstrapRouteRequest } from "../src/provisioning-routes.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const STORE = "44444444-4444-4444-8444-444444444444";
const LOCATION = "55555555-5555-4555-8555-555555555555";
const ENROLLMENT = "66666666-6666-4666-8666-666666666666";

const GOOD_BODY = {
  signals: [
    { signalType: "board_serial", signalValue: "10000000abcdef01" },
    { signalType: "mac_address", signalValue: "2c:cf:67:00:00:01" },
  ],
  registration: "KNOWN_DEVICE_INSTALLATION_REGISTERED",
  media: {
    deviceRecordId: DEVICE,
    certificateEnrollmentId: ENROLLMENT,
    certificateGeneration: 2,
    assignmentGeneration: 3,
    digitalStoreId: STORE,
    storeLocationId: LOCATION,
    imageDeviceClass: "store_hub",
    imageEnvironment: "development",
    hasAdoptedCredential: true,
  },
  storage: "opened",
};

function request(
  body: unknown,
  overrides: Partial<BootstrapRouteRequest> = {},
): BootstrapRouteRequest {
  return {
    method: "POST",
    path: DEVICE_BOOT_CLASSIFICATION_PATH,
    headers: { "content-type": "application/json" },
    sourceIp: "10.0.0.1",
    rawBody: typeof body === "string" ? body : JSON.stringify(body),
    ...overrides,
  };
}

/** A READY Hub, as the composition would produce it from the governed read. */
function readyResult(req: BootClassificationRequest): BootClassificationResult {
  const evidence: BootEvidence = {
    boardResolution: "resolved",
    registration: "KNOWN_DEVICE_INSTALLATION_REGISTERED",
    media: req.media,
    cloudDevice: {
      deviceRecordId: DEVICE,
      deviceClass: "store_hub",
      environment: "development",
      lifecycle: "active",
      openTrustIncidentCount: 0,
      currentEnrollmentId: ENROLLMENT,
      assignmentGeneration: 3,
      assignment: { state: "active", digitalStoreId: STORE, storeLocationId: LOCATION },
      credentialHeadGeneration: 2,
      activeCertificate: { generation: 2, enrollmentId: ENROLLMENT },
    },
    connectivity: { networkUp: true, cloudReachable: true },
    storage: "opened",
  };
  return { evidence, decision: classifyBoot(evidence) };
}

function router(
  options: {
    classify?: (r: BootClassificationRequest) => Promise<BootClassificationResult>;
    limiter?: BootstrapRateLimiter;
    logged?: Array<Record<string, string | number | boolean>>;
  } = {},
) {
  return createDeviceBootRouter({
    classify: options.classify ?? ((r) => Promise.resolve(readyResult(r))),
    ...(options.limiter === undefined ? {} : { rateLimiter: options.limiter }),
    logger: { info: (fields) => options.logged?.push(fields) },
    newCorrelationId: () => "corr-fixed",
  });
}

describe("the answer is the shop-safe decision, and nothing else", () => {
  it("returns exactly the seven decision fields", async () => {
    const res = await router().handle(request(GOOD_BODY));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "classification",
        "correlationId",
        "nextAction",
        "reasonCode",
        "retryAutomatically",
        "servesLocally",
        "userMessageKey",
      ].sort(),
    );
    expect(res.body.classification).toBe("READY");
    expect(res.body.nextAction).toBe("NONE");
    expect(res.body.servesLocally).toBe(true);
  });

  it("never carries a device, Store or Location id, or the admin detail", async () => {
    const res = await router().handle(request(GOOD_BODY));
    const text = JSON.stringify(res.body);
    for (const secret of [DEVICE, STORE, LOCATION, ENROLLMENT]) {
      expect(text).not.toContain(secret);
    }
    expect(text).not.toMatch(/adminDetail|generation/i);
  });

  it("puts the admin detail in the service log, where support reads it", async () => {
    const logged: Array<Record<string, string | number | boolean>> = [];
    await router({ logged }).handle(request(GOOD_BODY));
    const entry = logged.find((e) => e.event === "device-boot-classified");
    expect(entry?.reasonCode).toBe("KLUY-BOOT-READY");
    expect(entry?.deviceRecordId).toBe(DEVICE);
    expect(typeof entry?.adminDetail).toBe("string");
  });
});

describe("the transport gates", () => {
  it("answers 404 for any other device-boot path", async () => {
    const res = await router().handle(request(GOOD_BODY, { path: "/v1/device-boot/other" }));
    expect(res.status).toBe(httpStatusFor("RESOURCE_NOT_FOUND"));
  });

  it("refuses a method other than POST", async () => {
    const res = await router().handle(request(GOOD_BODY, { method: "GET" }));
    expect(res.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("refuses an oversized body before parsing it", async () => {
    let called = false;
    const res = await router({
      classify: () => {
        called = true;
        return Promise.reject(new Error("unreachable"));
      },
    }).handle(request("x".repeat(16 * 1024 + 1)));
    expect(res.status).toBe(httpStatusFor("VALIDATION_FAILED"));
    expect(called).toBe(false);
  });

  it("refuses a body that is not JSON", async () => {
    const res = await router().handle(
      request(GOOD_BODY, { headers: { "content-type": "text/plain" } }),
    );
    expect(res.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("rate limits per peer, counts malformed attempts, and says when to retry", async () => {
    const limiter = new BootstrapRateLimiter({ now: () => 1_000_000 });
    const r = router({ limiter });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await r.handle(request("{not json"))).status);
    }
    const invalidStatus = httpStatusFor("VALIDATION_FAILED");
    expect(statuses.slice(0, 3)).toEqual([invalidStatus, invalidStatus, invalidStatus]);
    const limited = await r.handle(request(GOOD_BODY));
    expect(limited.status).toBe(httpStatusFor("RATE_LIMITED"));
    expect(limited.headers?.["Retry-After"]).toBeDefined();
    // A different peer is a different bucket.
    expect((await r.handle(request(GOOD_BODY, { sourceIp: "10.0.0.2" }))).status).toBe(200);
  });
});

describe("the body is refused rather than guessed at", () => {
  const cases: Array<[string, unknown]> = [
    ["an unknown top-level field", { ...GOOD_BODY, deviceRecordId: DEVICE }],
    [
      "an unknown media field",
      { ...GOOD_BODY, media: { ...GOOD_BODY.media, lifecycle: "active" } },
    ],
    ["no signals", { ...GOOD_BODY, signals: [] }],
    [
      "an unknown signal type",
      { ...GOOD_BODY, signals: [{ signalType: "cpu_temp", signalValue: "1" }] },
    ],
    [
      "an empty signal value",
      { ...GOOD_BODY, signals: [{ signalType: "board_serial", signalValue: "" }] },
    ],
    [
      "a media id that is not a uuid",
      { ...GOOD_BODY, media: { ...GOOD_BODY.media, digitalStoreId: "store-1" } },
    ],
    [
      "a negative generation",
      { ...GOOD_BODY, media: { ...GOOD_BODY.media, assignmentGeneration: -1 } },
    ],
    [
      "a fractional generation",
      { ...GOOD_BODY, media: { ...GOOD_BODY.media, certificateGeneration: 1.5 } },
    ],
    [
      "an image class no image is built for",
      { ...GOOD_BODY, media: { ...GOOD_BODY.media, imageDeviceClass: "peripheral" } },
    ],
    ["an unknown registration outcome", { ...GOOD_BODY, registration: "APPROVED" }],
    ["an unknown storage posture", { ...GOOD_BODY, storage: "wiped" }],
    [
      "a missing credential flag",
      { ...GOOD_BODY, media: { imageDeviceClass: "store_hub", imageEnvironment: "development" } },
    ],
  ];
  for (const [name, body] of cases) {
    it(`refuses ${name}`, async () => {
      let called = false;
      const res = await router({
        classify: (r) => {
          called = true;
          return Promise.resolve(readyResult(r));
        },
      }).handle(request(body));
      expect(res.status).toBe(httpStatusFor("VALIDATION_FAILED"));
      expect(called).toBe(false);
    });
  }

  it("keeps an absent claim absent: a fresh card is a fresh card", () => {
    const parsed = parseBootClassificationBody(
      JSON.stringify({
        signals: GOOD_BODY.signals,
        media: {
          imageDeviceClass: "terminal",
          imageEnvironment: "development",
          hasAdoptedCredential: false,
        },
      }),
    );
    expect(Object.keys(parsed.media).sort()).toEqual(
      ["hasAdoptedCredential", "imageDeviceClass", "imageEnvironment"].sort(),
    );
    expect("registration" in parsed).toBe(false);
    expect("storage" in parsed).toBe(false);
  });
});

describe("failures keep the board waiting", () => {
  it("a database failure is DEPENDENCY_UNAVAILABLE, retryable, and leaks nothing", async () => {
    const logged: Array<Record<string, string | number | boolean>> = [];
    const res = await router({
      logged,
      classify: () => Promise.reject(new Error('permission denied for schema "kitluy_devices"')),
    }).handle(request(GOOD_BODY));
    expect(res.status).toBe(httpStatusFor("DEPENDENCY_UNAVAILABLE"));
    expect(JSON.stringify(res.body)).not.toContain("kitluy_devices");
    expect((res.body.error as { details: { retryable: boolean } }).details.retryable).toBe(true);
    expect(logged.find((e) => e.event === "device-boot-classification-unavailable")?.cause).toBe(
      "Error",
    );
  });

  it("an instance without the wiring answers 503, never 404", async () => {
    const res = await handleRequest(
      { method: "POST", path: DEVICE_BOOT_CLASSIFICATION_PATH, headers: {}, rawBody: "{}" },
      { ready: true },
    );
    expect(res.status).toBe(503);
  });
});

describe("the evidence row is read strictly", () => {
  const row = {
    device_record_id: DEVICE,
    device_class: "terminal",
    lifecycle: "active",
    open_trust_incident_count: 0,
    current_enrollment_id: ENROLLMENT,
    assignment_generation: 2,
    assignment: { state: "active", digital_store_id: STORE, store_location_id: LOCATION },
    credential_head_generation: 2,
    honoured_previous_generation: 1,
    active_certificate: { generation: 2, enrollment_id: ENROLLMENT },
    seat: { physical_terminal_id: LOCATION, occupied_by_other_device: false },
  };

  it("maps a well-formed row onto the contract, overlap included", () => {
    const facts = cloudDeviceFactsFromRow(row, "development");
    expect(facts.deviceClass).toBe("terminal");
    expect(facts.honouredPreviousGeneration).toBe(1);
    expect(facts.seat?.occupiedByOtherDevice).toBe(false);
    expect(facts.environment).toBe("development");
  });

  it("omits what the row does not hold", () => {
    const facts = cloudDeviceFactsFromRow(
      {
        ...row,
        assignment: null,
        active_certificate: null,
        seat: null,
        credential_head_generation: null,
        honoured_previous_generation: null,
      },
      "development",
    );
    for (const key of [
      "assignment",
      "activeCertificate",
      "seat",
      "credentialHeadGeneration",
      "honouredPreviousGeneration",
    ]) {
      expect(key in facts).toBe(false);
    }
  });

  const broken: Array<[string, Record<string, unknown>]> = [
    ["an unknown lifecycle", { ...row, lifecycle: "hibernating" }],
    ["an unknown device class", { ...row, device_class: "kiosk" }],
    ["a string generation", { ...row, assignment_generation: "2" }],
    ["a non-uuid enrollment", { ...row, current_enrollment_id: "enrollment-2" }],
    [
      "an assignment in a dead state",
      { ...row, assignment: { ...row.assignment, state: "revoked" } },
    ],
    ["a seat without its flag", { ...row, seat: { physical_terminal_id: LOCATION } }],
  ];
  for (const [name, bad] of broken) {
    it(`refuses ${name}`, () => {
      expect(() => cloudDeviceFactsFromRow(bad, "development")).toThrow(
        BootEvidenceUnreadableError,
      );
    });
  }
});
