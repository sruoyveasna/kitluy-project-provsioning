import { describe, expect, it } from "vitest";
import {
  businessDateOf,
  DEFAULT_LOCALE,
  groupDigits,
  KITLUY_LOCALES,
  KITLUY_TIMEZONE,
  normalizeCambodianPhone,
  resolveMessage,
} from "../src/index.js";

describe("@kitluy/localization", () => {
  it("locks the Cambodia-first constants", () => {
    expect(KITLUY_TIMEZONE).toBe("Asia/Phnom_Penh");
    expect(KITLUY_LOCALES).toEqual(["km-KH", "en-US"]);
    expect(DEFAULT_LOCALE).toBe("km-KH");
  });

  it("normalizes Cambodian phone formats to E.164", () => {
    expect(normalizeCambodianPhone("012 345 678")?.e164).toBe("+85512345678");
    expect(normalizeCambodianPhone("+855 12 345 678")?.e164).toBe("+85512345678");
    expect(normalizeCambodianPhone("85512345678")?.e164).toBe("+85512345678");
    expect(normalizeCambodianPhone("092-888-9999")?.e164).toBe("+855928889999");
  });

  it("rejects non-Cambodian or malformed numbers", () => {
    expect(normalizeCambodianPhone("+6591234567")).toBeNull();
    expect(normalizeCambodianPhone("12345")).toBeNull();
    expect(normalizeCambodianPhone("")).toBeNull();
    expect(normalizeCambodianPhone("0012345678")).toBeNull();
  });

  it("computes the business date in Asia/Phnom_Penh (UTC+7, no DST)", () => {
    // 2026-01-01T18:00:00Z is 2026-01-02 01:00 in Phnom Penh.
    expect(businessDateOf(new Date("2026-01-01T18:00:00Z"))).toBe("2026-01-02");
    expect(businessDateOf(new Date("2026-01-01T16:59:59Z"))).toBe("2026-01-01");
  });

  it("resolves messages with explicit fallback, never silently empty", () => {
    const messages = {
      "km-KH": { hello: "សួស្តី" },
      "en-US": { hello: "Hello", onlyEn: "English only" },
    };
    expect(resolveMessage(messages, "km-KH", "hello")).toBe("សួស្តី");
    expect(resolveMessage(messages, "km-KH", "onlyEn")).toBe("English only");
    expect(resolveMessage(messages, "en-US", "missing")).toBe("missing");
  });

  it("groups digits for KHR-style display", () => {
    expect(groupDigits("1250000", "km-KH")).toBe("1,250,000");
    expect(groupDigits("-4000", "en-US")).toBe("-4,000");
    expect(groupDigits("999", "en-US")).toBe("999");
  });
});
