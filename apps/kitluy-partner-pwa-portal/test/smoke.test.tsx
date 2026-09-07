import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { App, PRODUCT_NAME } from "../src/App.js";
import { MESSAGES } from "../src/messages.js";

/**
 * STATE THE PREMISE, DO NOT INHERIT IT.
 *
 * The comment below used to say "no `VITE_KITLUY_*` variables exist under the
 * test runner". That is true in CI and false on any workstation carrying an
 * `.env.local`: Vitest loads Vite's env files, so `resolvePortalRuntime`
 * returned `ready` and this suite rendered the sign-in form it exists to forbid.
 * The guard failed loudly in the one place it was least needed and not at all
 * where it was.
 *
 * Blanking the three values states the unconfigured case instead of hoping for
 * it. `readPortalConfig` treats an empty string as absent, so this is a genuinely
 * unconfigured deployment rather than a stand-in for one.
 */
beforeEach(() => {
  vi.stubEnv("VITE_KITLUY_SUPABASE_URL", "");
  vi.stubEnv("VITE_KITLUY_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("VITE_KITLUY_MANAGEMENT_API_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe(`${PRODUCT_NAME} shell smoke test`, () => {
  /**
   * The portal is unconfigured here (see the stubs above), and that is the case
   * worth asserting. It must render the REASON rather than a blank page or,
   * worse, a pairing form that would send a request nowhere.
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
