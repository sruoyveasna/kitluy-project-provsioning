import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { App, MESSAGES, PRODUCT_NAME } from "../src/App.js";

/**
 * STATE THE PREMISE, DO NOT INHERIT IT.
 *
 * These assertions are about the UNCONFIGURED portal — the deployment that must
 * render the reason instead of an operational surface. That used to rely on no
 * `VITE_KITLUY_*` variable happening to exist under the runner, which is true in
 * CI and false on any workstation with an `.env.local`: Vitest loads Vite's env
 * files, `resolvePortalRuntime` then returned `ready`, and the fail-closed guard
 * silently stopped being tested exactly where the portal is developed.
 *
 * Blanking the three values makes the case explicit and the result the same
 * everywhere. `readPortalConfig` treats an empty string as absent, so this is the
 * unconfigured deployment, not a mock of one.
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
