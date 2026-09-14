/**
 * The Device Shell screens, as pure presentational components.
 *
 * They take a locale, their screen data and handlers, and render — no IPC, no
 * timers, no `window`. `App.tsx` owns the snapshot and the keypad state and wires
 * these up; `test/screens.test.tsx` renders each with `renderToString` and checks
 * the Khmer and English strings, the data hooks and the absence of any anchor
 * (a kiosk has nowhere to navigate).
 *
 * There is deliberately no screen that launches a business application. The
 * furthest a Pi gets here is entering a pairing code, and the submit answers
 * "not available in this build yet" (owner decision v2.0.0 §5; Slice 1B scope).
 */
import type { JSX } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { CROCKFORD_BASE32, type CodeEntryState } from "./model/code-entry.js";
import { messagesFor } from "./messages.js";
import type { WaitingSub } from "./model/shell-state.js";

const BRAND = "KitLuy OTA-A";

/** The shared frame: the brand, the board label, and the language toggle. */
export function Chrome(props: {
  locale: KitluyLocale;
  deviceLabel: string | null;
  onToggleLocale: () => void;
  /** Optional so every existing caller and test keeps working unchanged. */
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  /**
   * What software is running (U1 requirement 4). Optional for the same reason:
   * an image without the release runtime renders exactly as it does today.
   */
  release?: { readonly text: string; readonly tone: "normal" | "attention" } | null;
  children: JSX.Element;
}): JSX.Element {
  const m = messagesFor(props.locale);
  return (
    <div className="kt-shell" data-locale={props.locale}>
      <header className="kt-top">
        <span className="kt-brand">{BRAND}</span>
        <span className="kt-top-actions">
          {props.onToggleSettings === undefined ? null : (
            <button
              type="button"
              className="kt-lang"
              aria-label="toggle-settings"
              data-settings-open={props.settingsOpen === true ? "yes" : "no"}
              onClick={props.onToggleSettings}
            >
              {props.settingsOpen === true ? m.settingsClose : m.settings}
            </button>
          )}
          <button
            type="button"
            className="kt-lang"
            aria-label="switch-language"
            onClick={props.onToggleLocale}
          >
            {m.switchLanguage}
          </button>
        </span>
      </header>
      <main className="kt-body">{props.children}</main>
      <footer className="kt-foot" data-device-label={props.deviceLabel ?? ""}>
        <span className="kt-foot-k">{m.deviceLabelPrefix}</span>
        <span className="kt-foot-v kt-mono">{props.deviceLabel ?? m.noDeviceLabel}</span>
        {/*
          The software line. `data-release-tone="attention"` is what a board
          running the IMAGE FALLBACK with an update installed carries, so the
          state is greppable in a screenshot and testable without reading
          pixels — and can never be confused with a normal running release.
        */}
        {props.release == null ? null : (
          <span
            className="kt-foot-release"
            data-release-tone={props.release.tone}
            data-release-text={props.release.text}
          >
            {props.release.text}
          </span>
        )}
      </footer>
    </div>
  );
}

export function BootScreen(props: { locale: KitluyLocale }): JSX.Element {
  const m = messagesFor(props.locale);
  return (
    <section className="kt-center" aria-label="booting" data-screen="booting">
      <div className="kt-brand-big">{BRAND}</div>
      <p className="kt-muted">{m.booting}</p>
    </section>
  );
}

const WAITING_MESSAGE: Readonly<Record<WaitingSub, keyof ReturnType<typeof messagesFor>>> = {
  NOT_REGISTERED: "subNotRegistered",
  REGISTERING: "subRegistering",
  AWAITING_APPROVAL: "subAwaitingApproval",
  UNREACHABLE: "subUnreachable",
};

export function WaitingScreen(props: {
  locale: KitluyLocale;
  sub: WaitingSub;
  noNetwork: boolean;
}): JSX.Element {
  const m = messagesFor(props.locale);
  return (
    <section className="kt-center" aria-label="waiting" data-screen="waiting" data-sub={props.sub}>
      <h1 className="kt-title">{m.waitingTitle}</h1>
      <p className="kt-lead">{m[WAITING_MESSAGE[props.sub]]}</p>
      {props.noNetwork ? (
        <p className="kt-warn" role="status" data-no-network="true">
          {m.noNetwork}
        </p>
      ) : null}
    </section>
  );
}

export function HaltedScreen(props: {
  locale: KitluyLocale;
  reason: "trust_review" | "contained";
}): JSX.Element {
  const m = messagesFor(props.locale);
  const title = props.reason === "contained" ? m.haltedContainedTitle : m.haltedTrustTitle;
  const body = props.reason === "contained" ? m.haltedContainedBody : m.haltedTrustBody;
  return (
    <section
      className="kt-center kt-halted"
      aria-label="halted"
      data-screen="halted"
      data-reason={props.reason}
      role="alert"
    >
      <h1 className="kt-title">{title}</h1>
      <p className="kt-lead">{body}</p>
    </section>
  );
}

export function AssignedScreen(props: { locale: KitluyLocale }): JSX.Element {
  const m = messagesFor(props.locale);
  return (
    <section className="kt-center" aria-label="assigned" data-screen="assigned">
      <h1 className="kt-title">{m.assignedTitle}</h1>
      <p className="kt-lead">{m.assignedBody}</p>
    </section>
  );
}

/** The eight code boxes, filled left to right as characters are accepted. */
function CodeBoxes(props: { entry: CodeEntryState }): JSX.Element {
  const chars = props.entry.value.split("");
  return (
    <div
      className="kt-boxes"
      aria-label={props.entry.value}
      data-code-length={props.entry.value.length}
    >
      {Array.from({ length: CROCKFORD_BASE32.length }, (_, i) => (
        <span key={i} className={chars[i] === undefined ? "kt-box" : "kt-box kt-box-filled"}>
          {chars[i] ?? ""}
        </span>
      ))}
    </div>
  );
}

/**
 * The approved / not-assigned screen: code boxes, an alphanumeric keypad over the
 * Crockford alphabet, and Backspace / Clear / Continue. Continue is enabled only
 * when the code is complete. A USB scanner feeds the same handler as the keys.
 */
export function ApprovedScreen(props: {
  locale: KitluyLocale;
  entry: CodeEntryState;
  notice: string | null;
  onKey: (char: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onContinue: () => void;
}): JSX.Element {
  const m = messagesFor(props.locale);
  const keys = CROCKFORD_BASE32.alphabet.split("");
  return (
    <section className="kt-approved" aria-label="approved" data-screen="approved">
      <h1 className="kt-title">{m.approvedTitle}</h1>
      <p className="kt-lead">{m.approvedIntro}</p>

      <div className="kt-code" role="group" aria-label={m.enterCode}>
        <div className="kt-code-label">{m.enterCode}</div>
        <CodeBoxes entry={props.entry} />
      </div>

      <div className="kt-keypad" role="group" aria-label={m.enterCode}>
        {keys.map((k) => (
          <button
            type="button"
            key={k}
            className="kt-key"
            aria-label={`key-${k}`}
            onClick={() => props.onKey(k)}
          >
            {k}
          </button>
        ))}
      </div>

      <div className="kt-actions">
        <button type="button" className="kt-btn" aria-label="backspace" onClick={props.onBackspace}>
          {m.keyBackspace}
        </button>
        <button type="button" className="kt-btn" aria-label="clear" onClick={props.onClear}>
          {m.keyClear}
        </button>
        <button
          type="button"
          className="kt-btn kt-btn-primary"
          aria-label="continue"
          disabled={!props.entry.complete}
          onClick={props.onContinue}
        >
          {m.keyContinue}
        </button>
      </div>

      {props.notice === null ? null : (
        <p className="kt-warn" role="alert" data-pairing-notice="true">
          {props.notice}
        </p>
      )}
    </section>
  );
}
