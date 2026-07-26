import { describe, expect, it } from "vitest";
import { MESSAGES, PRODUCT_NAME } from "../src/messages.js";

describe(`${PRODUCT_NAME} localization`, () => {
  it("provides Khmer and English messages for every key", () => {
    const kmKeys = Object.keys(MESSAGES["km-KH"]).sort();
    const enKeys = Object.keys(MESSAGES["en-US"]).sort();
    expect(kmKeys).toEqual(enKeys);
    for (const key of kmKeys) {
      expect(MESSAGES["km-KH"][key as keyof (typeof MESSAGES)["km-KH"]]).toBeTruthy();
      expect(MESSAGES["en-US"][key as keyof (typeof MESSAGES)["en-US"]]).toBeTruthy();
    }
  });
});
