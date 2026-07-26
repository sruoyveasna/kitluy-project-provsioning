/**
 * @kitluy/observability — structured logging, correlation and health contracts.
 *
 * Source authority: infrastructure spec v1.0.0 §9.1 (every service exposes
 * /health/live and /health/ready from first release) and §17 (independent
 * observability). Zero-dependency by design; a provider-backed logger can
 * implement the same interface later.
 *
 * STATUS: BUILT + TESTED (test/observability.test.ts).
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bound: LogFields): Logger;
}

const SECRET_FIELD_PATTERN = /(password|secret|token|api[_-]?key|service[_-]?role|credential)/i;

/** Redact obviously secret-bearing fields before they reach any sink. */
export function redactFields(fields: LogFields): LogFields {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_FIELD_PATTERN.test(k) ? "[REDACTED]" : v;
  }
  return out;
}

/**
 * JSON-lines structured logger writing to stdout/stderr. Suitable for
 * container platforms; never logs secrets (field-name redaction as backstop).
 */
export function createLogger(
  service: string,
  bound: LogFields = {},
  sink: (line: string) => void = (line) => {
    process.stdout.write(line + "\n");
  },
): Logger {
  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    sink(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        service,
        message,
        ...redactFields({ ...bound, ...fields }),
      }),
    );
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) => createLogger(service, { ...bound, ...extra }, sink),
  };
}

/** Health/readiness contract (infrastructure spec §9.1). */
export interface HealthReport {
  readonly status: "ok" | "degraded" | "unavailable";
  readonly service: string;
  readonly version: string;
  readonly checks: Readonly<Record<string, "ok" | "failed" | "skipped">>;
}

/** Metrics hook contract; a provider adapter implements emission later. */
export interface MetricsHook {
  counter(name: string, value?: number, labels?: Readonly<Record<string, string>>): void;
  gauge(name: string, value: number, labels?: Readonly<Record<string, string>>): void;
}

export const noopMetrics: MetricsHook = {
  counter: () => undefined,
  gauge: () => undefined,
};
