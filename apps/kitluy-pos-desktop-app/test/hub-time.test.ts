/**
 * WS-12-T001-P02 §8 "Authority time" — the monotonic Hub-time anchor.
 *
 * The locked rules (owner decision §1): 30-second maximum cache age;
 * advancement by MONOTONIC elapsed time only; no wall-clock fallback; an
 * expired anchor yields nothing.
 */
import { describe, expect, it } from "vitest";

import {
  HUB_TIME_MAX_CACHE_AGE_SECONDS,
  HubTimeAnchor,
  parseAuthorityTime,
} from "../src/bootstrap/hub-time.js";

const HUB_INSTANT = new Date("2026-08-06T10:00:00.000Z");

function anchored(): { anchor: HubTimeAnchor; tick: (ms: number) => void } {
  let monotonic = 1_000_000;
  const anchor = new HubTimeAnchor(() => monotonic);
  anchor.set(HUB_INSTANT);
  return {
    anchor,
    tick: (ms: number) => {
      monotonic += ms;
    },
  };
}

describe("Hub authority-time anchor (§1)", () => {
  it("advances a cached authority timestamp by monotonic elapsed time only", () => {
    const { anchor, tick } = anchored();
    expect(anchor.current()?.toISOString()).toBe("2026-08-06T10:00:00.000Z");
    tick(12_000);
    expect(anchor.current()?.toISOString()).toBe("2026-08-06T10:00:12.000Z");
    tick(17_999);
    expect(anchor.isFresh()).toBe(true);
  });

  it("a terminal wall clock ahead does not cause false expiry — the wall clock is never read", () => {
    // The anchor takes ONLY an injected monotonic clock; there is no code
    // path that consults Date.now(). Structural proof: constructing and
    // advancing works with a monotonic source completely detached from the
    // wall clock, and the produced instants derive from the HUB instant.
    const { anchor, tick } = anchored();
    tick(5_000);
    const produced = anchor.current();
    expect(produced?.getTime()).toBe(HUB_INSTANT.getTime() + 5_000);
  });

  it("a terminal wall clock behind does not extend validity — expiry is monotonic", () => {
    const { anchor, tick } = anchored();
    tick(HUB_TIME_MAX_CACHE_AGE_SECONDS * 1000);
    expect(anchor.isFresh()).toBe(true);
    tick(1);
    expect(anchor.current()).toBeNull();
    expect(anchor.isFresh()).toBe(false);
  });

  it("an expired or backwards anchor fails closed to null — no wall-clock fallback exists", () => {
    const { anchor, tick } = anchored();
    tick(-1); // a monotonic source can never go back; if it does, refuse
    expect(anchor.current()).toBeNull();
    const empty = new HubTimeAnchor(() => 0);
    expect(empty.current()).toBeNull();
  });

  it("re-anchoring after expiry restores freshness from the NEW Hub instant", () => {
    const { anchor, tick } = anchored();
    tick(31_000);
    expect(anchor.current()).toBeNull();
    anchor.set(new Date("2026-08-06T10:05:00.000Z"));
    expect(anchor.current()?.toISOString()).toBe("2026-08-06T10:05:00.000Z");
  });

  it("parses only a well-formed hub_database authority response", () => {
    const good = {
      protocolVersion: "1.0",
      authorityTime: "2026-08-06T10:00:00.000Z",
      authoritySource: "hub_database",
      responseId: "r-1",
      generatedAt: "2026-08-06T10:00:00.000Z",
      maxCacheAgeSeconds: 30,
      correlationId: "c-1",
    };
    expect(parseAuthorityTime(good)).not.toBeNull();
    expect(parseAuthorityTime({ ...good, authoritySource: "wall_clock" })).toBeNull();
    expect(parseAuthorityTime({ ...good, authorityTime: "not-a-time" })).toBeNull();
    expect(parseAuthorityTime({ ...good, maxCacheAgeSeconds: "30" })).toBeNull();
    expect(parseAuthorityTime(null)).toBeNull();
  });
});
