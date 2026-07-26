/**
 * kitluy-ai-gateway — AI Gateway — governed AI inference entry; never receives unrestricted production-database access (RB v4 §7.8)
 *
 * STATUS: SCAFFOLDED. Runtime kernel (health/readiness/version, config
 * validation, graceful shutdown) is BUILT + TESTED; no business behavior is
 * implemented. Boundary and ownership: see README.md.
 */
import type { HealthReport } from "@kitluy/observability";

export const SERVICE_NAME = "kitluy-ai-gateway" as const;
export const SERVICE_VERSION = "0.1.0" as const;

export function buildHealthReport(ready: boolean): HealthReport {
  return {
    status: ready ? "ok" : "unavailable",
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    checks: { startup: ready ? "ok" : "failed" },
  };
}
