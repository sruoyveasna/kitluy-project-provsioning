/**
 * The Terminals views, rendered to a string. Every state an operator meets is
 * a pure function of props, so it is asserted here rather than assumed.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";

import { MESSAGES } from "../src/messages.js";
import type { PartnerStore } from "../src/pairing-client.js";
import { codeLife } from "../src/pairing-presentation.js";
import {
  deriveLadder,
  hubReadiness,
  canOpenTerminalSession,
  type LadderRung,
} from "../src/terminal-presentation.js";
import { roleVocabulary } from "../src/terminal-roles.js";
import type { IssuedTerminalCode, PhysicalTerminal } from "../src/terminals-client.js";
import {
  DefineTerminalForm,
  ProvisioningLadder,
  StoreNav,
  TerminalPairPanel,
  TerminalsView,
} from "../src/views.js";

const NOW = new Date("2026-09-04T10:00:00Z");
const STORE: PartnerStore = {
  digitalStoreId: "22222222-2222-4222-8222-222222222222",
  digitalStoreReference: "DEMO-LAUNDRY-001 — Demo Laundry",
  vertical: "LAUNDRY",
  hub: { deviceReference: "KL-6C4917D5C6DA", state: "active" },
  locations: [{ storeLocationId: "l-1", locationReference: "BKK1 — Boeung Keng Kang 1" }],
};
const TERMINAL: PhysicalTerminal = {
  physicalTerminalId: "t-1",
  digitalStoreId: STORE.digitalStoreId,
  storeLocationId: "l-1",
  locationReference: "BKK1 — Boeung Keng Kang 1",
  label: "Front Counter 01",
  terminalProfileKeys: ["laundry.t1.intake_cashier", "laundry.t2.customer_display"],
  boundDevice: null,
  lastSession: null,
  createdAt: "2026-09-04T09:00:00Z",
};
const ISSUED: IssuedTerminalCode = {
  code: "ABCD8291",
  sessionId: "s-1",
  expiresAt: "2026-09-04T10:14:00Z",
  ttlSeconds: 900,
  showOnce: true,
  physicalTerminalId: "t-1",
  label: "Front Counter 01",
  terminalProfileKeys: TERMINAL.terminalProfileKeys,
  storeHubReference: "KL-6C4917D5C6DA",
  detail: "",
};
const noop = (): void => undefined;

function view(over: Partial<Parameters<typeof TerminalsView>[0]> = {}) {
  const store = over.store ?? STORE;
  const readiness = hubReadiness(store);
  const terminals = over.terminals ?? [TERMINAL];
  const ladders = new Map<string, readonly LadderRung[]>(
    terminals.map((t) => [
      t.physicalTerminalId,
      deriveLadder({ hub: readiness, terminal: t, session: null }, NOW),
    ]),
  );
  return renderToString(
    <TerminalsView
      locale="en-US"
      store={store}
      readiness={readiness}
      terminals={terminals}
      ladders={ladders}
      vocabulary={roleVocabulary(store.vertical)}
      dataAsOf={undefined}
      now={NOW}
      pairing={null}
      life={null}
      busyTerminalId={null}
      defineBusy={false}
      defineNotice={null}
      pairNotice={null}
      canPair={canOpenTerminalSession(readiness)}
      onDefine={noop}
      onPair={noop}
      onCancel={noop}
      {...over}
    />,
  );
}

describe("the Terminals screen", () => {
  it("shows an empty Store honestly and offers the form", () => {
    const html = view({ terminals: [] });
    expect(html).toContain('data-surface-state="empty"');
    expect(html).toContain(MESSAGES["en-US"].noTerminals);
    expect(html).toContain('aria-label="define-terminal"');
    expect(html).toContain('type="checkbox"');
  });

  it("lists a seat with short role codes, no device, the ladder, and a Pair button", () => {
    const html = view();
    expect(html).toContain("Front Counter 01");
    expect(html).toContain("T1");
    expect(html).toContain(" + ");
    expect(html).toContain(MESSAGES["en-US"].noBoundDevice);
    expect(html).toContain('data-rung="hubActive" data-rung-state="done"');
    expect(html).toContain('data-rung="issued" data-rung-state="current"');
    expect(html).toContain('data-rung="active" data-rung-state="not_reported"');
    expect(html).toContain(MESSAGES["en-US"].pair);
    expect(html).toContain('data-hub-readiness="active"');
  });

  it("replaces Pair with the reason when the Hub is pending, and fails closed when unreported", () => {
    const pending = view({
      store: { ...STORE, hub: { deviceReference: "KL-6C4917D5C6DA", state: "pending_trust" } },
    });
    expect(pending).toContain('data-blocked="hubNotActive"');
    expect(pending).not.toContain(`>${MESSAGES["en-US"].pair}<`);
    const unreported = view({ store: { ...STORE, hub: undefined } });
    expect(unreported).toContain('data-blocked="hubUnreported"');
    expect(unreported).toContain('data-hub-readiness="unreported"');
  });

  it("offers no profile checkboxes for an unreported vertical, and says why", () => {
    const html = view({ store: { ...STORE, vertical: undefined } });
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('data-vocabulary="unreported"');
  });

  it("shows an unknown profile key verbatim, marked not recognised", () => {
    const html = view({ terminals: [{ ...TERMINAL, terminalProfileKeys: ["t2_scan_in"] }] });
    expect(html).toContain("t2_scan_in");
    expect(html).toContain(MESSAGES["en-US"].profileNotRecognised);
  });

  it("renders Khmer by default vocabulary", () => {
    const html = renderToString(
      <DefineTerminalForm
        locale="km-KH"
        locations={STORE.locations}
        vocabulary={roleVocabulary("LAUNDRY")}
        busy={false}
        notice={null}
        onSubmit={noop}
      />,
    );
    expect(html).toContain(MESSAGES["km-KH"].defineTerminal);
    expect(html).toContain(MESSAGES["km-KH"].roleLaundryT1);
  });
});

describe("the terminal code panel", () => {
  const panel = (over: Partial<Parameters<typeof TerminalPairPanel>[0]> = {}) =>
    renderToString(
      <TerminalPairPanel
        locale="en-US"
        issued={ISSUED}
        session={null}
        life={codeLife(ISSUED.expiresAt, NOW)}
        cancelling={false}
        cancelled={false}
        gone={false}
        onCancel={noop}
        {...over}
      />,
    );

  it("shows the grouped code once, with the ungrouped code for screen readers, and never in an href", () => {
    const html = panel();
    expect(html).toContain("ABCD 8291");
    expect(html).toContain('aria-label="ABCD8291"');
    expect(html).not.toMatch(/(href|src)="[^"]*ABCD8291/);
    expect(html).toContain(MESSAGES["en-US"].terminalCodeHeading);
    expect(html).toContain(MESSAGES["en-US"].cancelSession);
    expect(html).not.toContain("qr");
  });

  it("turns urgent under two minutes", () => {
    const html = panel({ life: codeLife("2026-09-04T10:01:30Z", NOW) });
    expect(html).toContain("1:30");
    expect(html).toContain("font-weight:700");
  });

  it("says expired, locked, paired, cancelled and gone", () => {
    expect(panel({ life: codeLife("2026-09-04T09:00:00Z", NOW) })).toContain(
      MESSAGES["en-US"].expired,
    );
    expect(
      panel({
        session: {
          sessionId: "s-1",
          physicalTerminalId: "t-1",
          state: "locked",
          paired: false,
          expired: false,
          pairedAt: null,
          pairedDeviceReference: null,
          failedAttemptCount: 5,
          locked: true,
          expiresAt: ISSUED.expiresAt,
          terminalProfileKeys: [],
        },
      }),
    ).toContain('data-locked="true"');
    const paired = panel({
      life: codeLife("2026-09-04T09:00:00Z", NOW),
      session: {
        sessionId: "s-1",
        physicalTerminalId: "t-1",
        state: "consumed",
        paired: true,
        expired: false,
        pairedAt: "2026-09-04T10:05:00Z",
        pairedDeviceReference: "KL-6783D70CB6BF",
        failedAttemptCount: 0,
        locked: false,
        expiresAt: ISSUED.expiresAt,
        terminalProfileKeys: [],
      },
    });
    expect(paired).toContain('data-paired="true"');
    expect(paired).toContain("KL-6783D70CB6BF");
    expect(paired).not.toContain(MESSAGES["en-US"].expired);
    expect(panel({ cancelled: true })).toContain(MESSAGES["en-US"].sessionCancelled);
    expect(panel({ gone: true })).toContain(MESSAGES["en-US"].sessionGone);
  });
});

describe("navigation and the ladder", () => {
  it("marks the active tab and links both tabs of the selected Store", () => {
    const html = renderToString(
      <StoreNav
        locale="en-US"
        stores={[STORE]}
        storeId={STORE.digitalStoreId}
        tab="terminals"
        onStore={noop}
      />,
    );
    expect(html).toContain(`href="#/stores/${STORE.digitalStoreId}/hub"`);
    expect(html).toContain(`href="#/stores/${STORE.digitalStoreId}/terminals"`);
    expect(html).toContain('aria-current="page"');
  });

  it("colours a blocked rung and names the reason", () => {
    const rungs = deriveLadder(
      {
        hub: hubReadiness({ hub: { deviceReference: null, state: "none" } }),
        terminal: TERMINAL,
        session: null,
      },
      NOW,
    );
    const html = renderToString(<ProvisioningLadder locale="en-US" rungs={rungs} />);
    expect(html).toContain('data-rung="hubActive" data-rung-state="blocked"');
    expect(html).toContain(MESSAGES["en-US"].hubNone);
  });
});
