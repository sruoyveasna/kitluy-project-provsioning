import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { App, MESSAGES, PRODUCT_NAME } from "../src/App.js";

describe(`${PRODUCT_NAME} shell smoke test`, () => {
  it("renders the four locked terminal profiles, all locked, failing closed", () => {
    const html = renderToString(<App />);
    expect(html).toContain("T1 — POS Cashier / Intake");
    expect(html).toContain("T2 — Customer Display Screen");
    expect(html).toContain("T3 — Clean &amp; Ready Scan-In");
    expect(html).toContain("T4 — Customer Pickup Scan-Out");
    expect(html).toContain('data-surface-state="unavailable"');
    expect(html).not.toContain("t2_scan_in");
  });

  it("provides Khmer and English messages", () => {
    expect(MESSAGES["km-KH"].notAssigned).toBeTruthy();
    expect(MESSAGES["en-US"].notAssigned).toBeTruthy();
  });
});
