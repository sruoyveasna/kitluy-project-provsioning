import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App, MESSAGES, PRODUCT_NAME } from "../src/App.js";

describe(`${PRODUCT_NAME} shell smoke test`, () => {
  it("renders without crashing and fails closed (no fake operational data)", () => {
    const html = renderToString(<App />);
    expect(html).toContain("KitLuy");
    expect(html).toContain('data-surface-state="unavailable"');
  });

  it("provides both Khmer and English messages", () => {
    for (const locale of ["km-KH", "en-US"] as const) {
      expect(MESSAGES[locale].boundary.length).toBeGreaterThan(0);
      expect(MESSAGES[locale].signedOut.length).toBeGreaterThan(0);
    }
  });
});
