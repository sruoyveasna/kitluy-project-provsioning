/**
 * Hub authority-time anchor — WS-12-T001-P02.
 *
 * Authority: KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 §1. Authority time
 * comes from the Hub database transaction; Node, Electron and OS wall
 * clocks are DIAGNOSTIC ONLY. A cached authority timestamp advances only
 * by MONOTONIC elapsed time, never by the wall clock, and expires after
 * the locked 30-second maximum cache age — an expired anchor yields
 * nothing; the caller reacquires Hub time or fails into a named state.
 */

/** The locked maximum terminal monotonic-cache age (owner decision §1). */
export const HUB_TIME_MAX_CACHE_AGE_SECONDS = 30 as const;

/** Monotonic milliseconds. Injected; production uses `performance.now`. */
export type MonotonicClock = () => number;

export interface AuthorityTimeResponse {
  readonly protocolVersion: string;
  readonly authorityTime: string;
  readonly authoritySource: "hub_database";
  readonly responseId: string;
  readonly generatedAt: string;
  readonly maxCacheAgeSeconds: number;
  readonly correlationId: string;
}

export class HubTimeAnchor {
  #anchor: {
    readonly authorityMs: number;
    readonly monotonicAtMs: number;
    readonly maxAgeMs: number;
  } | null = null;
  readonly #monotonic: MonotonicClock;
  readonly #maxAgeMs: number;

  constructor(
    monotonic: MonotonicClock,
    maxCacheAgeSeconds: number = HUB_TIME_MAX_CACHE_AGE_SECONDS,
  ) {
    this.#monotonic = monotonic;
    this.#maxAgeMs = maxCacheAgeSeconds * 1000;
  }

  /**
   * Record a freshly obtained Hub authority timestamp. A Hub-reported
   * `maxCacheAgeSeconds` LOWER than the locked 30-second bound tightens
   * this anchor; a higher or malformed value never widens it (§1 — the
   * locked value is a ceiling, not a suggestion).
   */
  set(authorityTime: Date, maxCacheAgeSeconds?: number): void {
    const reportedMs =
      maxCacheAgeSeconds !== undefined &&
      Number.isFinite(maxCacheAgeSeconds) &&
      maxCacheAgeSeconds > 0
        ? maxCacheAgeSeconds * 1000
        : this.#maxAgeMs;
    this.#anchor = {
      authorityMs: authorityTime.getTime(),
      monotonicAtMs: this.#monotonic(),
      maxAgeMs: Math.min(this.#maxAgeMs, reportedMs),
    };
  }

  /**
   * The current Hub-anchored instant, advanced ONLY by monotonic elapsed
   * time — or `null` when no anchor exists or the anchor is older than the
   * locked cache age. `null` is a fail-closed answer, never a fallback.
   */
  current(): Date | null {
    if (this.#anchor === null) return null;
    const elapsed = this.#monotonic() - this.#anchor.monotonicAtMs;
    if (elapsed < 0 || elapsed > this.#anchor.maxAgeMs) return null;
    return new Date(this.#anchor.authorityMs + elapsed);
  }

  /** Whether a non-expired anchor exists right now. */
  isFresh(): boolean {
    return this.current() !== null;
  }
}

/** Parse and shape-check an authority-time response. Returns null on any
 * malformation — a time authority that cannot be parsed is no authority. */
export function parseAuthorityTime(body: unknown): AuthorityTimeResponse | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  const fields = [
    "protocolVersion",
    "authorityTime",
    "responseId",
    "generatedAt",
    "correlationId",
  ] as const;
  for (const field of fields) {
    if (typeof record[field] !== "string" || (record[field] as string).length === 0) return null;
  }
  if (record["authoritySource"] !== "hub_database") return null;
  if (typeof record["maxCacheAgeSeconds"] !== "number") return null;
  const instant = new Date(record["authorityTime"] as string);
  if (Number.isNaN(instant.getTime())) return null;
  return body as AuthorityTimeResponse;
}
