/**
 * The Device Shell renderer: owns the snapshot, the keypad state and the locale,
 * and paints exactly one screen. All the decisions live in the pure `model/`
 * functions; this file is the wiring — IPC in, screens out.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type JSX } from "react";
import { DEFAULT_LOCALE, type KitluyLocale } from "@kitluy/localization";
import "./bridge.js";
import { messagesFor } from "./messages.js";
import { deriveScreen, type ShellSnapshot } from "./model/shell-state.js";
import {
  emptyCodeEntry,
  reduceCodeEntry,
  type CodeEntryAction,
  type CodeEntryState,
} from "./model/code-entry.js";
import {
  ApprovedScreen,
  AssignedScreen,
  BootScreen,
  Chrome,
  HaltedScreen,
  WaitingScreen,
} from "./screens.js";

function otherLocale(locale: KitluyLocale): KitluyLocale {
  return locale === "km-KH" ? "en-US" : "km-KH";
}

export function App(): JSX.Element {
  const [locale, setLocale] = useState<KitluyLocale>(DEFAULT_LOCALE);
  const [snapshot, setSnapshot] = useState<ShellSnapshot | null>(null);
  const [entry, dispatch] = useReducer(
    (state: CodeEntryState, action: CodeEntryAction) => reduceCodeEntry(state, action),
    emptyCodeEntry,
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const bridge = window.kitluyShell;
    if (bridge === undefined) return;
    let live = true;
    void bridge.getSnapshot().then((next) => {
      if (live) setSnapshot(next);
    });
    bridge.onSnapshot((next) => setSnapshot(next));
    return () => {
      live = false;
    };
  }, []);

  const screen = useMemo(() => deriveScreen(snapshot), [snapshot]);

  const onKey = useCallback((char: string) => {
    setNotice(null);
    dispatch({ kind: "key", char });
  }, []);
  const onBackspace = useCallback(() => {
    setNotice(null);
    dispatch({ kind: "backspace" });
  }, []);
  const onClear = useCallback(() => {
    setNotice(null);
    dispatch({ kind: "clear" });
  }, []);
  const onContinue = useCallback(() => {
    if (!entry.complete) return;
    const bridge = window.kitluyShell;
    if (bridge === undefined) return;
    void bridge.submitPairingCode(entry.value).then(() => {
      // Slice 1B stops here on purpose: the code is shape-checked in main and the
      // build has no pairing transport yet, so we say so rather than hang.
      setNotice(messagesFor(locale).pairingNotAvailable);
    });
  }, [entry.complete, entry.value, locale]);

  // The physical keyboard and a USB keyboard-wedge scanner feed the same reducer.
  useEffect(() => {
    if (screen.kind !== "approved_unassigned") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Enter") {
        onContinue();
        return;
      }
      if (event.key === "Backspace") {
        onBackspace();
        return;
      }
      if (event.key.length === 1) onKey(event.key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen.kind, onKey, onBackspace, onContinue]);

  const toggleLocale = useCallback(() => setLocale((current) => otherLocale(current)), []);

  const deviceLabel = screen.kind === "booting" ? null : screen.deviceLabel;

  let body: JSX.Element;
  switch (screen.kind) {
    case "booting":
      body = <BootScreen locale={locale} />;
      break;
    case "waiting_for_approval":
      body = <WaitingScreen locale={locale} sub={screen.sub} noNetwork={screen.noNetwork} />;
      break;
    case "halted":
      body = <HaltedScreen locale={locale} reason={screen.reason} />;
      break;
    case "approved_unassigned":
      body = (
        <ApprovedScreen
          locale={locale}
          entry={entry}
          notice={notice}
          onKey={onKey}
          onBackspace={onBackspace}
          onClear={onClear}
          onContinue={onContinue}
        />
      );
      break;
    case "assigned":
      body = <AssignedScreen locale={locale} />;
      break;
  }

  return (
    <Chrome locale={locale} deviceLabel={deviceLabel} onToggleLocale={toggleLocale}>
      {body}
    </Chrome>
  );
}
