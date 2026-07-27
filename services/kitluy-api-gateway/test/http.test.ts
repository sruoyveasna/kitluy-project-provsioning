import { describe, expect, it } from "vitest";
import { handleKernelRequest } from "../src/http.js";
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
