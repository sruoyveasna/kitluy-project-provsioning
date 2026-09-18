/**
 * The Device Shell renderer: owns the snapshot, the keypad state and the locale,
 * and paints exactly one screen. All the decisions live in the pure `model/`
 * functions; this file is the wiring — IPC in, screens out.
 */
import { useCallback, useEffect, useMemo, useReducer, useState, type JSX } from "react";
import { DEFAULT_LOCALE, type KitluyLocale } from "@kitluy/localization";
import "./bridge.js";
import { messagesFor } from "./messages.js";
import {
  deriveScreen,
  pairingMessageKey,
  releaseCaption,
  type ShellSnapshot,
} from "./model/shell-state.js";
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
  InstallingScreen,
  PinSetupScreen,
  WaitingScreen,
  type PinSetupStep,
} from "./screens.js";
import { DeviceTab, DisplayTab, NetworkTab, PrinterTab, SettingsTabs } from "./settings.js";
import {
  EMPTY_PRINTER_FORM,
  rankNetworks,
  validatePrinterForm,
  type PrinterForm,
  type SettingsTab,
} from "./model/settings.js";
import type {
  ConfigResult,
  DeviceInfoView,
  NetworkStatusView,
  PrinterView,
  ScannedNetwork,
} from "./bridge.js";

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

  // --- Settings ---------------------------------------------------------------
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("network");
  const [netStatus, setNetStatus] = useState<NetworkStatusView | null>(null);
  const [networks, setNetworks] = useState<readonly ScannedNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<ScannedNetwork | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [netNotice, setNetNotice] = useState<string | null>(null);
  const [configUnavailable, setConfigUnavailable] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfoView | null>(null);
  const [printer, setPrinter] = useState<PrinterView | null>(null);
  const [printerForm, setPrinterForm] = useState<PrinterForm>(EMPTY_PRINTER_FORM);
  const [printerNotice, setPrinterNotice] = useState<string | null>(null);
  const [brightness, setBrightness] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

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
    void bridge.submitPairingCode(entry.value).then((result) => {
      // The transport's ACTUAL answer. This used to discard `result` and always
      // render "not available in this build" — which was true in Slice 1B and
      // became a lie the moment a transport shipped: a terminal that had just
      // paired told the person at it that pairing did not exist.
      setNotice(messagesFor(locale)[pairingMessageKey(result.status)]);
      // Only a real pairing clears the keypad. Leaving the code in place after a
      // refusal lets someone fix one mistyped character instead of all eight.
      if (result.status === "PAIRED") dispatch({ kind: "clear" });
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

  // --- T1-FIRST-BOOT-PIN-001: the device PIN, created twice, sealed by root ---
  // The digits live in renderer state only until the confirmation is sent, and
  // are dropped whatever the broker answers. Nothing here logs or shows them.
  const [pinStep, setPinStep] = useState<PinSetupStep>("create");
  const [pinEntry, setPinEntry] = useState("");
  const [pinFirst, setPinFirst] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinNotice, setPinNotice] = useState<string | null>(null);
  const submitPin = useCallback(
    (first: string, second: string) => {
      const bridge = window.kitluyShell;
      setPinEntry("");
      setPinFirst(null);
      setPinStep("create");
      if (first !== second) {
        setPinNotice(messagesFor(locale).pinMismatch);
        return;
      }
      if (bridge === undefined) {
        setPinNotice(messagesFor(locale).pinRefused);
        return;
      }
      setPinBusy(true);
      void bridge
        .setupDevicePin(first, second)
        .then((result) => {
          if (result.ok) {
            setPinNotice(null);
            return;
          }
          const m = messagesFor(locale);
          setPinNotice(
            result.code === "IDENTITY_KEY_UNAVAILABLE"
              ? m.pinStarting
              : result.code === "PIN_CONFIRMATION_MISMATCH"
                ? m.pinMismatch
                : `${m.pinRefused}${result.message === undefined ? "" : ` — ${result.message}`}`,
          );
        })
        .catch(() => setPinNotice(messagesFor(locale).pinRefused))
        .finally(() => setPinBusy(false));
    },
    [locale],
  );
  const onPinDigit = useCallback(
    (digit: string) => {
      if (pinBusy) return;
      setPinNotice(null);
      const next = `${pinEntry}${digit}`;
      if (next.length < 4) {
        setPinEntry(next);
        return;
      }
      if (pinStep === "create") {
        setPinFirst(next);
        setPinEntry("");
        setPinStep("confirm");
        return;
      }
      submitPin(pinFirst ?? "", next);
    },
    [pinBusy, pinEntry, pinStep, pinFirst, submitPin],
  );
  const onPinBackspace = useCallback(() => setPinEntry((e) => e.slice(0, -1)), []);
  const onPinClear = useCallback(() => {
    setPinEntry("");
    setPinFirst(null);
    setPinStep("create");
    setPinNotice(null);
  }, []);
  useEffect(() => {
    if (screen.kind !== "pin_setup") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Backspace") {
        onPinBackspace();
        return;
      }
      if (/^[0-9]$/u.test(event.key)) onPinDigit(event.key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen.kind, onPinDigit, onPinBackspace]);

  /**
   * A refusal from the broker is ORDINARY — no broker in this image, no radio
   * fitted, no backlight. It is rendered, never thrown: an unhandled rejection
   * behind a blank panel is the one outcome a till must not have.
   */
  const unwrap = useCallback((result: ConfigResult): unknown => {
    if (result.ok) return result.data;
    if (result.code === "DEVICE_CONFIG_UNAVAILABLE") setConfigUnavailable(true);
    return null;
  }, []);

  // Loaded when Settings opens, not at boot: none of it is needed to pair, and
  // a scan costs seconds of radio time nobody asked for.
  useEffect(() => {
    if (!settingsOpen) return;
    const bridge = window.kitluyShell;
    if (bridge === undefined) return;
    let live = true;
    void bridge.getNetworkStatus().then((r) => {
      if (live) setNetStatus((unwrap(r) as NetworkStatusView | null) ?? null);
    });
    void bridge.getDeviceInfo().then((info) => {
      if (live) setDeviceInfo(info);
    });
    void bridge.getPrinter().then((saved) => {
      if (!live) return;
      setPrinter(saved);
      if (saved !== null) {
        setPrinterForm({
          host: saved.host,
          port: String(saved.port),
          label: saved.label ?? "",
        });
      }
    });
    void bridge.getBrightness().then((r) => {
      if (!live) return;
      const data = unwrap(r) as { percent?: number | null } | null;
      setBrightness(data?.percent ?? null);
    });
    return () => {
      live = false;
    };
  }, [settingsOpen, unwrap]);

  const onScan = useCallback(() => {
    const bridge = window.kitluyShell;
    if (bridge === undefined) return;
    setScanning(true);
    setNetNotice(null);
    void bridge.scanNetworks().then((r) => {
      setScanning(false);
      const found = unwrap(r) as ScannedNetwork[] | null;
      if (found === null) {
        setNetNotice(r.message ?? null);
        return;
      }
      setNetworks(rankNetworks(found));
    });
  }, [unwrap]);

  const onJoin = useCallback(() => {
    const bridge = window.kitluyShell;
    if (bridge === undefined || selected === null) return;
    setBusy(true);
    setNetNotice(null);
    void bridge
      .joinNetwork(selected.ssidHex, selected.secured ? passphrase : undefined)
      .then((r) => {
        setBusy(false);
        // The passphrase is dropped whatever the outcome: it must not sit in
        // renderer state on a wall-mounted screen after the installer leaves.
        setPassphrase("");
        const outcome = unwrap(r) as { kind?: string; reason?: string } | null;
        if (outcome?.kind === "joined") {
          setSelected(null);
          setNetNotice(messagesFor(locale).netJoined);
          void bridge.getNetworkStatus().then((next) => {
            setNetStatus((unwrap(next) as NetworkStatusView | null) ?? null);
          });
          return;
        }
        setNetNotice(outcome?.reason ?? r.message ?? null);
      });
  }, [selected, passphrase, locale, unwrap]);

  const printerError = validatePrinterForm(printerForm);

  const onSavePrinter = useCallback(() => {
    const bridge = window.kitluyShell;
    if (bridge === undefined || printerError !== null) return;
    setBusy(true);
    setPrinterNotice(null);
    void bridge
      .savePrinter({
        host: printerForm.host.trim(),
        ...(printerForm.port.trim() === "" ? {} : { port: Number(printerForm.port.trim()) }),
        ...(printerForm.label.trim() === "" ? {} : { label: printerForm.label.trim() }),
      })
      .then((r) => {
        setBusy(false);
        if (!r.ok) {
          setPrinterNotice(r.message ?? null);
          return;
        }
        setPrinterNotice(messagesFor(locale).printerSaved);
        void bridge.getPrinter().then(setPrinter);
      });
  }, [printerForm, printerError, locale]);

  const onTestPrinter = useCallback(() => {
    const bridge = window.kitluyShell;
    if (bridge === undefined) return;
    setBusy(true);
    setPrinterNotice(null);
    void bridge.testPrinter().then((r) => {
      setBusy(false);
      setPrinterNotice(r.ok ? messagesFor(locale).printerTestOk : (r.message ?? null));
    });
  }, [locale]);

  const onBrightness = useCallback((percent: number) => {
    const bridge = window.kitluyShell;
    if (bridge === undefined) return;
    // Optimistic: the slider must track the finger, not the round trip.
    setBrightness(percent);
    void bridge.setBrightness(percent);
  }, []);

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
    case "pin_setup":
      body = (
        <PinSetupScreen
          locale={locale}
          step={pinStep}
          length={pinEntry.length}
          busy={pinBusy}
          notice={pinNotice}
          onDigit={onPinDigit}
          onBackspace={onPinBackspace}
          onClear={onPinClear}
        />
      );
      break;
    case "installing":
      body = <InstallingScreen locale={locale} phase={screen.phase} failed={screen.failed} />;
      break;
  }

  if (settingsOpen) {
    body = (
      <div className="kt-settings" data-tab={tab}>
        <SettingsTabs locale={locale} active={tab} onSelect={setTab} />
        {tab === "network" ? (
          <NetworkTab
            locale={locale}
            status={netStatus}
            networks={networks}
            scanning={scanning}
            selected={selected}
            passphrase={passphrase}
            busy={busy}
            notice={netNotice}
            unavailable={configUnavailable}
            onScan={onScan}
            onSelect={(next) => {
              setSelected(next);
              setPassphrase("");
            }}
            onPassphrase={setPassphrase}
            onJoin={onJoin}
          />
        ) : null}
        {tab === "printer" ? (
          <PrinterTab
            locale={locale}
            saved={printer}
            form={printerForm}
            error={printerError}
            busy={busy}
            notice={printerNotice}
            onChange={setPrinterForm}
            onSave={onSavePrinter}
            onTest={onTestPrinter}
          />
        ) : null}
        {tab === "device" ? <DeviceTab locale={locale} info={deviceInfo} /> : null}
        {tab === "display" ? (
          <DisplayTab
            locale={locale}
            brightness={brightness}
            busy={busy}
            onBrightness={onBrightness}
            onToggleLocale={toggleLocale}
          />
        ) : null}
      </div>
    );
  }

  return (
    <Chrome
      locale={locale}
      deviceLabel={deviceLabel}
      onToggleLocale={toggleLocale}
      settingsOpen={settingsOpen}
      onToggleSettings={() => setSettingsOpen((open) => !open)}
      release={snapshot === null ? null : releaseCaption(snapshot)}
    >
      {body}
    </Chrome>
  );
}
