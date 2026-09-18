/**
 * The Terminal screen — what a Pi Terminal shows until the Laundry face takes
 * over: the designed terminal launcher, with the Terminal PIN pad opening as a
 * centred modal over it (owner request 2026-09-18, T1-FACE-PORT-001).
 *
 * PROVENANCE: `features/terminal-select/TerminalSelect.tsx`, `pairs.ts` and
 * `features/auth/PinModal.tsx` of the donor `kitluy-laundry-pos-desk-app@
 * 8b2f107` — the anatomy (brand header, pair sections, medallion cards, the
 * PIN modal) and the `.ts-*` chrome.
 *
 * WHAT IS DIFFERENT, AND WHY — the one thing this screen must never do is let
 * a person CHOOSE the terminal. The disposition register rejected the donor's
 * terminal selection ("canonical forbids user-selectable terminal identity";
 * WS-12 task register §3: the user can never select or override the terminal
 * profile — it binds through provisioning and pairing, WS-11). So the cards
 * SHOW the assignment the Store Hub verified: this device's profile is the one
 * live card (tap it → PIN), every other card is locked with the reason. The
 * staff name, role and "Sign out" are gone (no staff login on a Pi).
 */
import { useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";

import type { T1BootstrapReport, T1RuntimeState } from "./bootstrap/states.js";
import { T1BootstrapView } from "./bootstrap-view.js";
import { PinPad } from "./pin-screen.js";
import { ThemeToggleButton } from "./vertical/laundry/face/components/common/ThemeToggleButton.js";
import { I } from "./vertical/laundry/face/components/common/icons.js";
import { KitluyBrandLogo } from "./vertical/laundry/face/components/brand/KitluyBrandLogo.js";
import { ScreenFrame } from "./vertical/laundry/face/components/layout/ScreenFrame.js";
import { ModalShell } from "./vertical/laundry/face/components/modals/ModalShell.js";
import { C } from "./vertical/laundry/face/styles/tokens.js";
import "./vertical/laundry/face/styles/fonts.css";
import "./vertical/laundry/face/styles/base.css";
import "./vertical/laundry/face/styles/savor-theme.css";
import "./vertical/laundry/face/styles/kitluy-global.css";
import "./vertical/laundry/face/styles/touch-input-pad.css";
import "./terminal-launcher.css";

/** This product's one assigned profile on a Pi (the report has no profile field yet). */
export const ASSIGNED_TERMINAL = "T1" as const;

type TerminalId = "T1" | "T2" | "T3" | "T4";

interface TerminalCard {
  readonly id: TerminalId;
  readonly name: string;
  readonly role: string;
  readonly desc: string;
  readonly hw: string;
}

interface PairConfig {
  readonly id: "COUNTER" | "STORAGE";
  readonly name: string;
  readonly machine: string;
  readonly terminals: readonly TerminalCard[];
}

/** The owner-locked T1–T4 Laundry model, grouped as the donor grouped it. */
export const TERMINAL_PAIRS: readonly PairConfig[] = [
  {
    id: "COUNTER",
    name: "Counter",
    machine: "Intake and the customer-facing screen",
    terminals: [
      {
        id: "T1",
        name: "POS Cashier / Intake",
        role: "Cashier",
        desc: "Walk-in intake, the Laundry Booking, payment, receipt and the final hand-over",
        hw: '15.6" Touch · Printer · Scanner · Cash Drawer',
      },
      {
        id: "T2",
        name: "Customer Display",
        role: "Read-only",
        desc: "Live booking, QR payment and loyalty, facing the customer",
        hw: '15.6" IPS · driven from the T1 counter',
      },
    ],
  },
  {
    id: "STORAGE",
    name: "Storage",
    machine: "Clean & ready scan-in, pickup scan-out",
    terminals: [
      {
        id: "T3",
        name: "Clean & Ready Scan-In",
        role: "Storage Clerk",
        desc: "Reconcile the plant's return and assign each bag a slot",
        hw: '15.6" IPS Touch · Scanner',
      },
      {
        id: "T4",
        name: "Customer Pickup Scan-Out",
        role: "Storage Clerk",
        desc: "Locate the bags for a pickup and scan them out to the counter",
        hw: '15.6" IPS Touch · Scanner',
      },
    ],
  },
];

const TEXT = {
  "km-KH": {
    title: "Terminal របស់អ្នក",
    sub: "Store Hub បានចាត់តាំង Terminal នេះ — ចុចដើម្បីដោះសោ",
    assigned: "ឧបករណ៍នេះ",
    lockedChip: "បានចាត់តាំងតាម provisioning",
    tapToUnlock: "ចុចដើម្បីបញ្ចូល PIN",
    hubLabel: "Store Hub",
    footNote:
      "អត្តសញ្ញាណ Terminal ត្រូវបានចង ដោយ provisioning និង pairing — មិនអាចជ្រើសរើសនៅទីនេះទេ។",
  },
  "en-US": {
    title: "Your terminal",
    sub: "The Store Hub assigned this terminal — tap it to unlock",
    assigned: "This device",
    lockedChip: "assigned by provisioning",
    tapToUnlock: "Tap to enter the PIN",
    hubLabel: "Store Hub",
    footNote: "Terminal identity is bound by provisioning and pairing — it is not chosen here.",
  },
} as const;

const HUB_STATES: Partial<Record<T1RuntimeState, string>> = {
  starting: "starting",
  connecting_to_hub: "connecting",
  configuration_loading: "loading configuration",
  staff_authentication_required: "linked",
  ready: "linked",
  offline_ready: "cached",
};

function cardIcon(id: TerminalId) {
  switch (id) {
    case "T1":
      return <I.Receipt s={30} c="currentColor" />;
    case "T2":
      return <I.Monitor s={30} c="currentColor" />;
    case "T3":
      return <I.Barcode s={30} c="currentColor" />;
    case "T4":
      return <I.Package s={30} c="currentColor" />;
  }
}

export function TerminalLauncher(props: {
  readonly report: T1BootstrapReport;
  readonly locale: KitluyLocale;
  readonly onLocale: (locale: KitluyLocale) => void;
}) {
  const { report, locale } = props;
  const text = TEXT[locale];
  const [pinOpen, setPinOpen] = useState(false);
  const canUnlock = report.state === "staff_authentication_required";
  const hubValue = HUB_STATES[report.state] ?? "not reachable";
  const hubOk = report.state === "staff_authentication_required" || report.state === "ready";

  return (
    <ScreenFrame>
      <div className="lsv-shell kl-launcher" data-terminal-launcher={report.state}>
        <div className="ts scroll hide-scrollbar">
          <header className="ts-head">
            <div className="ts-brand">
              <KitluyBrandLogo />
              <div>
                <h1>KitLuy</h1>
                <p className="km">ឃីត់លុយ · Laundry</p>
              </div>
            </div>
            <div className="ts-head-right">
              <div className="ts-hub" data-hub-state={report.state}>
                <span className={"kl-launcher-pulse" + (hubOk ? " on" : "")} aria-hidden />
                <div>
                  <div className="ts-hub-label">{text.hubLabel}</div>
                  <div className="ts-hub-value">
                    {hubValue}
                    {report.hub !== undefined ? ` · ${report.hub.hostname}` : ""}
                  </div>
                </div>
              </div>
              <nav aria-label="language" className="kl-launcher-lang">
                <button
                  type="button"
                  className={"kl-btn kl-btn--soft" + (locale === "km-KH" ? " on" : "")}
                  aria-pressed={locale === "km-KH"}
                  onClick={() => props.onLocale("km-KH")}
                >
                  ខ្មែរ
                </button>
                <button
                  type="button"
                  className={"kl-btn kl-btn--soft" + (locale === "en-US" ? " on" : "")}
                  aria-pressed={locale === "en-US"}
                  onClick={() => props.onLocale("en-US")}
                >
                  English
                </button>
              </nav>
              <ThemeToggleButton className="kl-theme-toggle" size={18} />
            </div>
          </header>

          <div className="ts-body">
            <div className="ts-title">
              <h2>{text.title}</h2>
              <p>{text.sub}</p>
            </div>

            {TERMINAL_PAIRS.map((pair) => {
              const holdsAssigned = pair.terminals.some((t) => t.id === ASSIGNED_TERMINAL);
              return (
                <section
                  key={pair.id}
                  className={"ts-pair" + (holdsAssigned ? "" : " locked")}
                  data-pair={pair.id}
                >
                  <div className="ts-pair-h">
                    <div>
                      <h3>{pair.name}</h3>
                      <p>{pair.machine}</p>
                    </div>
                    <span className="ts-pair-chip">
                      {!holdsAssigned && <I.Lock s={13} c="currentColor" />}
                      {pair.terminals.map((t) => t.id).join(" · ")}
                    </span>
                  </div>
                  <div className="ts-grid">
                    {pair.terminals.map((t) => {
                      const assigned = t.id === ASSIGNED_TERMINAL;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={"ts-card" + (assigned ? " kl-launcher-card--assigned" : "")}
                          disabled={!assigned || !canUnlock}
                          aria-disabled={!assigned}
                          data-terminal-card={t.id}
                          data-assigned={assigned ? "true" : "false"}
                          onClick={() => {
                            if (assigned && canUnlock) setPinOpen(true);
                          }}
                        >
                          <span className="ts-medal">{cardIcon(t.id)}</span>
                          <h4>
                            {t.id} — {t.name}
                          </h4>
                          <span className="ts-role">{assigned ? text.assigned : t.role}</span>
                          <p className="ts-desc">{t.desc}</p>
                          <span className="ts-hw">
                            {assigned ? (
                              canUnlock ? (
                                text.tapToUnlock
                              ) : (
                                t.hw
                              )
                            ) : (
                              <>
                                <I.Lock s={11} c="currentColor" /> {text.lockedChip}
                              </>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {canUnlock ? null : (
              <div className="kl-launcher-status">
                <T1BootstrapView report={report} locale={locale} />
              </div>
            )}
            <p className="ts-foot-note">{text.footNote}</p>
          </div>
        </div>

        <ModalShell
          isOpen={pinOpen && canUnlock}
          onClose={() => setPinOpen(false)}
          colors={C}
          width={440}
          padding={32}
          ariaLabel="Terminal PIN"
        >
          <PinPad locale={locale} report={report} />
        </ModalShell>
      </div>
    </ScreenFrame>
  );
}
