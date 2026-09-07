import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { KitluyLocale } from "@kitluy/localization";
import { emptyCodeEntry, feedCodeEntry } from "../src/model/code-entry.js";
import { MESSAGES } from "../src/messages.js";
import {
  ApprovedScreen,
  AssignedScreen,
  BootScreen,
  Chrome,
  HaltedScreen,
  WaitingScreen,
} from "../src/screens.js";

const LOCALES: readonly KitluyLocale[] = ["km-KH", "en-US"];
const noop = (): void => {};

describe("screens render in both languages and never offer navigation", () => {
  it("boot splash", () => {
    for (const locale of LOCALES) {
      const html = renderToString(<BootScreen locale={locale} />);
      expect(html).toContain('data-screen="booting"');
      expect(html).toContain(MESSAGES[locale].booting);
      expect(html).not.toContain("<a");
    }
  });

  it("waiting screen shows the sub-state line and can flag no network", () => {
    for (const locale of LOCALES) {
      const html = renderToString(
        <WaitingScreen locale={locale} sub="AWAITING_APPROVAL" noNetwork={false} />,
      );
      expect(html).toContain('data-sub="AWAITING_APPROVAL"');
      expect(html).toContain(MESSAGES[locale].subAwaitingApproval);
      expect(html).not.toContain('data-no-network="true"');

      const offline = renderToString(
        <WaitingScreen locale={locale} sub="UNREACHABLE" noNetwork={true} />,
      );
      expect(offline).toContain('data-no-network="true"');
      expect(offline).toContain(MESSAGES[locale].noNetwork);
      expect(offline).not.toContain("<a");
    }
  });

  it("halted screen distinguishes trust review from contained", () => {
    for (const locale of LOCALES) {
      const trust = renderToString(<HaltedScreen locale={locale} reason="trust_review" />);
      expect(trust).toContain('data-reason="trust_review"');
      expect(trust).toContain(MESSAGES[locale].haltedTrustTitle);

      const contained = renderToString(<HaltedScreen locale={locale} reason="contained" />);
      expect(contained).toContain('data-reason="contained"');
      expect(contained).toContain(MESSAGES[locale].haltedContainedTitle);
    }
  });

  it("assigned screen is static text with no launch path", () => {
    for (const locale of LOCALES) {
      const html = renderToString(<AssignedScreen locale={locale} />);
      expect(html).toContain('data-screen="assigned"');
      expect(html).toContain(MESSAGES[locale].assignedBody);
      expect(html).not.toContain("<a");
      expect(html).not.toContain("<button");
    }
  });

  it("approved screen shows all 32 keys and disables Continue until complete", () => {
    for (const locale of LOCALES) {
      const empty = renderToString(
        <ApprovedScreen
          locale={locale}
          entry={emptyCodeEntry}
          notice={null}
          onKey={noop}
          onBackspace={noop}
          onClear={noop}
          onContinue={noop}
        />,
      );
      expect(empty).toContain(MESSAGES[locale].enterCode);
      expect(empty).toContain('aria-label="key-0"');
      expect(empty).toContain('aria-label="key-Z"');
      // Continue is disabled while incomplete.
      expect(empty).toMatch(/aria-label="continue"[^>]*disabled/);
      expect(empty).not.toContain("<a");

      const full = feedCodeEntry(emptyCodeEntry, "R7K4M2PQ");
      const ready = renderToString(
        <ApprovedScreen
          locale={locale}
          entry={full}
          notice={MESSAGES[locale].pairingNotAvailable}
          onKey={noop}
          onBackspace={noop}
          onClear={noop}
          onContinue={noop}
        />,
      );
      expect(ready).not.toMatch(/aria-label="continue"[^>]*disabled/);
      expect(ready).toContain(MESSAGES[locale].pairingNotAvailable);
      // The entered code is exposed for accessibility but not as a link or src.
      expect(ready).toContain('aria-label="R7K4M2PQ"');
      expect(ready).not.toContain('href="');
      expect(ready).not.toContain('src="');
    }
  });

  it("the chrome shows the device label verbatim and a language toggle", () => {
    const html = renderToString(
      <Chrome locale="en-US" deviceLabel="KL-ABCDEF012345" onToggleLocale={noop}>
        <BootScreen locale="en-US" />
      </Chrome>,
    );
    expect(html).toContain('data-device-label="KL-ABCDEF012345"');
    expect(html).toContain("KL-ABCDEF012345");
    expect(html).toContain('aria-label="switch-language"');
  });
});

describe("message parity", () => {
  it("every key exists and is non-empty in both locales", () => {
    const keys = Object.keys(MESSAGES["en-US"]) as (keyof (typeof MESSAGES)["en-US"])[];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(MESSAGES["km-KH"][key].length).toBeGreaterThan(0);
      expect(MESSAGES["en-US"][key].length).toBeGreaterThan(0);
    }
  });
});
