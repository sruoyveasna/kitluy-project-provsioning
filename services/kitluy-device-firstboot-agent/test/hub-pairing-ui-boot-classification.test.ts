/**
 * The Store Hub console shows the boot classification's shop sentence — first,
 * and only the sentence.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 §8: a Store screen
 * never shows a KLUY- code, a generation or an enrollment id, and it answers
 * "what happened, and what do I do" before anything else.
 */
import { describe, expect, it } from "vitest";

import type { BootClassificationState } from "../src/boot-classification.js";
import { DEFAULT_USER_MESSAGES } from "../src/boot-classification-contract.js";
import { render } from "../src/bin/hub-pairing-ui.js";

function boot(
  current: Omit<BootClassificationState["current"], "source" | "decidedAt">,
): BootClassificationState {
  return { current: { ...current, source: "cloud", decidedAt: "2026-09-16T08:00:00.000Z" } };
}

const NEEDS_RELEASE = boot({
  classification: "RECOVERING_DEVICE",
  reasonCode: "KLUY-BOOT-RECOVERY-NEEDS-RELEASE",
  nextAction: "RELEASE_DEVICE_THEN_PAIR",
  userMessageKey: "boot.recovering.needsRelease",
  retryAutomatically: false,
  servesLocally: false,
});

describe("the Hub console and the boot classification", () => {
  it("shows the shop sentence before every other line", () => {
    const screen = render(null, null, undefined, null, NEEDS_RELEASE);
    const lines = screen.split("\n").filter((l) => l.trim() !== "");
    expect(lines[0]?.trim()).toBe("KitLuy Store Hub");
    expect(lines[1]?.trim()).toBe(DEFAULT_USER_MESSAGES["boot.recovering.needsRelease"]);
  });

  it("never shows the reason code or the next-action identifier", () => {
    const screen = render(null, null, undefined, null, NEEDS_RELEASE);
    expect(screen).not.toMatch(/KLUY-|RELEASE_DEVICE_THEN_PAIR|RECOVERING_DEVICE/);
  });

  it("renders exactly as before when the image has no classification yet", () => {
    expect(render(null, null, undefined, null, null)).toBe(render(null, null, undefined, null));
    expect(render(null, null)).toBe(render(null, null, undefined, undefined, undefined));
  });
});
