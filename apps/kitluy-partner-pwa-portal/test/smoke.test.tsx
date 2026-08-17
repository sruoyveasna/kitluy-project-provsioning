import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App, PRODUCT_NAME } from "../src/App.js";
import { MESSAGES } from "../src/messages.js";

describe(`${PRODUCT_NAME} shell smoke test`, () => {
  /**
   * No `VITE_KITLUY_*` variables exist under the test runner, so the portal is
   * unconfigured here — and that is the case worth asserting. It must render the
   * REASON rather than a blank page or, worse, a pairing form that would send a
   * request nowhere.
   */
  it("renders without crashing and fails closed when unconfigured", () => {
    const html = renderToString(<App />);
    expect(html).toContain("KitLuy");
    expect(html).toContain('data-surface-state="unavailable"');
  });

  it("never renders a pairing control before configuration is resolved", () => {
    const html = renderToString(<App />);
    expect(html).not.toContain('aria-label="pairing"');
    expect(html).not.toContain('aria-label="sign-in"');
  });

  it("provides both Khmer and English for every message", () => {
    const keys = Object.keys(MESSAGES["en-US"]) as (keyof (typeof MESSAGES)["en-US"])[];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      // A missing Khmer string is the failure this catches: Khmer is the default
      // locale of this portal, so an untranslated key is what an operator sees.
      expect(MESSAGES["km-KH"][key].length).toBeGreaterThan(0);
      expect(MESSAGES["en-US"][key].length).toBeGreaterThan(0);
    }
  });
});
