import { describe, expect, it } from "vitest";
import { createLogger, redactFields } from "../src/index.js";

describe("@kitluy/observability", () => {
  it("emits JSON lines with service and level", () => {
    const lines: string[] = [];
    const log = createLogger("kitluy-test-service", {}, (l) => lines.push(l));
    log.info("hello", { correlationId: "corr-1" });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.service).toBe("kitluy-test-service");
    expect(parsed.level).toBe("info");
    expect(parsed.correlationId).toBe("corr-1");
  });

  it("child loggers keep bound fields", () => {
    const lines: string[] = [];
    const log = createLogger("svc", {}, (l) => lines.push(l)).child({ tenantId: "t-1" });
    log.warn("warned");
    expect(JSON.parse(lines[0]!).tenantId).toBe("t-1");
  });

  it("redacts secret-bearing field names as a backstop", () => {
    expect(
      redactFields({ apiKey: "abc", SERVICE_ROLE_KEY: "xyz", password: "p", safe: 1 }),
    ).toEqual({
      apiKey: "[REDACTED]",
      SERVICE_ROLE_KEY: "[REDACTED]",
      password: "[REDACTED]",
      safe: 1,
    });
    const lines: string[] = [];
    const log = createLogger("svc", {}, (l) => lines.push(l));
    log.error("boom", { supabaseServiceRoleKey: "secret-value" });
    expect(lines[0]).not.toContain("secret-value");
  });
});
