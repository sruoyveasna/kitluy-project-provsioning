import { describe, expect, it } from "vitest";
import { handleKernelRequest, handleRequest } from "../src/http.js";
import { DEVICE_ENROLLMENT_PREFIX } from "../src/enrollment-routes.js";
import { SERVICE_NAME } from "../src/index.js";

describe(`${SERVICE_NAME} kernel`, () => {
  it("liveness returns 200", () => {
    expect(handleKernelRequest("GET", "/health/live", true).status).toBe(200);
  });
  it("readiness reflects state", () => {
    expect(handleKernelRequest("GET", "/health/ready", true).status).toBe(200);
    expect(handleKernelRequest("GET", "/health/ready", false).status).toBe(503);
  });
  it("version endpoint names the service", () => {
    const res = handleKernelRequest("GET", "/version", true);
    expect(res.status).toBe(200);
    expect((res.body as { service: string }).service).toBe(SERVICE_NAME);
  });
  it("unknown routes return the canonical error envelope", () => {
    const res = handleKernelRequest("GET", "/anything", true);
    expect(res.status).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe("RESOURCE_NOT_FOUND");
  });
  it("non-GET is rejected — no business mutations exist in this scaffold", () => {
    expect(handleKernelRequest("POST", "/health/live", true).status).toBe(405);
  });
});

/**
 * The enrollment router existed, was tested, and was mounted by NOTHING — so
 * every enrollment request fell through to the generic `/v1/` branch and was
 * answered by the revocation surface. These prove the kernel reaches it, and
 * that an unwired instance says so instead of impersonating a healthy one.
 */
describe(`${SERVICE_NAME} device-enrollment routing`, () => {
  const request = {
    method: "POST",
    path: `${DEVICE_ENROLLMENT_PREFIX}/challenges`,
    headers: { "content-type": "application/json" },
    rawBody: "{}",
    sourceIp: "127.0.0.1",
  };

  it("reaches the enrollment router rather than the revocation surface", async () => {
    let seenByEnrollment = false;
    let seenByRevocation = false;
    const res = await handleRequest(request, {
      ready: true,
      enrollmentRouter: {
        handle: () => {
          seenByEnrollment = true;
          return Promise.resolve({ status: 201, body: { ok: true } });
        },
      },
      revocationRouter: {
        handle: () => {
          seenByRevocation = true;
          return Promise.resolve({ status: 200, body: {} });
        },
      },
    });
    expect(seenByEnrollment).toBe(true);
    expect(seenByRevocation).toBe(false);
    expect(res.status).toBe(201);
  });

  it("passes the RAW body through, never a pre-parsed one", async () => {
    let received = "";
    await handleRequest(request, {
      ready: true,
      enrollmentRouter: {
        handle: (r) => {
          received = r.rawBody;
          return Promise.resolve({ status: 201, body: {} });
        },
      },
    });
    // The router owns its own size gate, content-type check and JSON parse, so
    // the transport must not have consumed any of them on its behalf.
    expect(received).toBe("{}");
  });

  it("fails CLOSED with 503 when the instance has no enrollment wiring", async () => {
    const res = await handleRequest(request, { ready: true });
    expect(res.status).toBe(503);
    expect((res.body as { error: { code: string } }).error.code).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("a 503 here is never a 404 — the device must not conclude the fleet refused it", async () => {
    const res = await handleRequest(request, { ready: true });
    expect(res.status).not.toBe(404);
  });
});
