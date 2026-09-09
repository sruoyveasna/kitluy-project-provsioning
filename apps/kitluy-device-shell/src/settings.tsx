/**
 * Terminal Settings, as pure presentational components.
 *
 * Same contract as `screens.tsx`: locale in, data in, handlers in, markup out —
 * no IPC, no timers, no `window`. `App.tsx` owns every call to the bridge, so
 * these render identically in a test and on a till.
 *
 * ===========================================================================
 * WHAT THIS SCREEN IS NOT
 * ===========================================================================
 * It is not a Linux administration surface. Four tabs, a fixed set of controls,
 * and no free-text command anywhere — the same rule `network-ui.ts` states for
 * the Hub console: "two verbs and no way out of them". Everything privileged
 * here goes through the device-config broker's closed verb list.
 *
 * ===========================================================================
 * SETTINGS IS NOT YET LOCKED
 * ===========================================================================
 * Anyone standing at the Terminal can open this. The 4-digit Terminal PIN
 * (owner decision v2.0.0 §10–§14) is what will gate it, and it is SPECIFIED —
 * NOT BUILT: the Store Hub is its authoritative verifier and the Hub is not
 * reachable until activation. Recorded here so this is a known gap rather than
 * something discovered later.
 */
import type { JSX } from "react";
import type { KitluyLocale } from "@kitluy/localization";
import { messagesFor } from "./messages.js";
import type { DeviceInfoView, NetworkStatusView, PrinterView, ScannedNetwork } from "./bridge.js";
import {
  SETTINGS_TABS,
  signalBars,
  summariseConnection,
  type PrinterForm,
  type PrinterFormError,
  type SettingsTab,
} from "./model/settings.js";

/** Bars as text: a kiosk has no icon font, and dBm means nothing to a shop. */
function bars(signal: number): string {
  const n = signalBars(signal);
  return "▮".repeat(n) + "▯".repeat(4 - n);
}

export function SettingsTabs(props: {
  locale: KitluyLocale;
  active: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}): JSX.Element {
  const m = messagesFor(props.locale);
  const label: Record<SettingsTab, string> = {
    network: m.tabNetwork,
    printer: m.tabPrinter,
    device: m.tabDevice,
    display: m.tabDisplay,
  };
  return (
    <nav className="kt-tabs" aria-label="settings-tabs">
      {SETTINGS_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          className="kt-tab"
          data-tab={tab}
          data-active={props.active === tab ? "yes" : "no"}
          aria-current={props.active === tab ? "page" : undefined}
          onClick={() => props.onSelect(tab)}
        >
          {label[tab]}
        </button>
      ))}
    </nav>
  );
}

export function NetworkTab(props: {
  locale: KitluyLocale;
  status: NetworkStatusView | null;
  networks: readonly ScannedNetwork[];
  scanning: boolean;
  /** The network the operator has tapped, awaiting a passphrase. */
  selected: ScannedNetwork | null;
  passphrase: string;
  busy: boolean;
  notice: string | null;
  unavailable: boolean;
  onScan: () => void;
  onSelect: (network: ScannedNetwork | null) => void;
  onPassphrase: (value: string) => void;
  onJoin: () => void;
}): JSX.Element {
  const m = messagesFor(props.locale);
  const connection = summariseConnection(props.status);
  const connectionText =
    connection.kind === "wired"
      ? m.netConnectedWired
      : connection.kind === "wireless"
        ? m.netConnectedWireless
        : m.netDisconnected;

  if (props.unavailable) {
    return (
      <section className="kt-panel" aria-label="settings-network">
        <p className="kt-warn" data-unavailable="yes">
          {m.configUnavailable}
        </p>
      </section>
    );
  }

  return (
    <section className="kt-panel" aria-label="settings-network">
      <p className="kt-lead" data-connection={connection.kind}>
        {connectionText}
      </p>
      {props.status?.wirelessConfigured === true ? (
        <p className="kt-muted" data-wifi-saved="yes">
          {m.netSaved}
        </p>
      ) : null}

      <button
        type="button"
        className="kt-btn"
        data-action="scan"
        disabled={props.scanning || props.busy}
        onClick={props.onScan}
      >
        {props.scanning ? m.netScanning : m.netScan}
      </button>

      {props.networks.length === 0 && !props.scanning ? (
        <p className="kt-muted" data-empty="networks">
          {m.netNoneFound}
        </p>
      ) : null}

      <ul className="kt-nets" data-count={props.networks.length}>
        {props.networks.map((network) => (
          <li key={network.ssidHex} className="kt-net" data-ssid-hex={network.ssidHex}>
            <button
              type="button"
              className="kt-net-btn"
              data-secured={network.secured ? "yes" : "no"}
              onClick={() => props.onSelect(network)}
            >
              <span className="kt-net-name">{network.ssid}</span>
              <span className="kt-net-bars kt-mono" data-signal={network.signal}>
                {bars(network.signal)}
              </span>
              <span className="kt-muted">{network.secured ? m.netSecured : m.netOpen}</span>
            </button>
          </li>
        ))}
      </ul>

      {props.selected === null ? null : (
        <form
          className="kt-join"
          data-join-for={props.selected.ssidHex}
          onSubmit={(event) => {
            event.preventDefault();
            props.onJoin();
          }}
        >
          <p className="kt-lead">{props.selected.ssid}</p>
          {props.selected.secured ? (
            <label className="kt-field">
              <span>{m.netPassword}</span>
              {/* type=password: this screen is on a wall in a shop, and the
                  passphrase must not still be readable after the installer
                  walks away. The same rule network-ui.ts applies on the Hub. */}
              <input
                type="password"
                name="passphrase"
                autoComplete="off"
                value={props.passphrase}
                onChange={(event) => props.onPassphrase(event.target.value)}
              />
            </label>
          ) : null}
          <div className="kt-actions">
            <button
              type="submit"
              className="kt-btn kt-btn-primary"
              data-action="join"
              disabled={props.busy}
            >
              {props.busy ? m.netJoining : m.netJoin}
            </button>
            <button
              type="button"
              className="kt-btn"
              data-action="cancel-join"
              onClick={() => props.onSelect(null)}
            >
              {m.settingsClose}
            </button>
          </div>
        </form>
      )}

      {props.notice === null ? null : (
        <p className="kt-warn" role="status" data-notice="network">
          {props.notice}
        </p>
      )}
    </section>
  );
}

export function PrinterTab(props: {
  locale: KitluyLocale;
  saved: PrinterView | null;
  form: PrinterForm;
  error: PrinterFormError;
  busy: boolean;
  notice: string | null;
  onChange: (form: PrinterForm) => void;
  onSave: () => void;
  onTest: () => void;
}): JSX.Element {
  const m = messagesFor(props.locale);
  const set = (patch: Partial<PrinterForm>): void => props.onChange({ ...props.form, ...patch });
  return (
    <section className="kt-panel" aria-label="settings-printer">
      {props.saved === null ? (
        <p className="kt-muted" data-printer="none">
          {m.printerNone}
        </p>
      ) : (
        <p className="kt-lead kt-mono" data-printer="set">
          {props.saved.label ?? ""} {props.saved.host}:{props.saved.port}
        </p>
      )}

      <label className="kt-field">
        <span>{m.printerHost}</span>
        <input
          type="text"
          name="host"
          inputMode="url"
          autoComplete="off"
          value={props.form.host}
          onChange={(event) => set({ host: event.target.value })}
        />
      </label>
      <label className="kt-field">
        <span>{m.printerPort}</span>
        <input
          type="text"
          name="port"
          inputMode="numeric"
          autoComplete="off"
          value={props.form.port}
          onChange={(event) => set({ port: event.target.value })}
        />
      </label>
      <label className="kt-field">
        <span>{m.printerLabel}</span>
        <input
          type="text"
          name="label"
          autoComplete="off"
          value={props.form.label}
          onChange={(event) => set({ label: event.target.value })}
        />
      </label>

      {props.error === null ? null : (
        <p className="kt-warn" data-error={props.error}>
          {props.error === "host" ? m.printerBadHost : m.printerBadPort}
        </p>
      )}

      <div className="kt-actions">
        <button
          type="button"
          className="kt-btn kt-btn-primary"
          data-action="save-printer"
          disabled={props.busy || props.error !== null}
          onClick={props.onSave}
        >
          {m.printerSave}
        </button>
        <button
          type="button"
          className="kt-btn"
          data-action="test-printer"
          disabled={props.busy || props.saved === null}
          onClick={props.onTest}
        >
          {props.busy ? m.printerTesting : m.printerTest}
        </button>
      </div>

      {/* Said plainly rather than shown as a control that fails: reaching a USB
          printer needs the `lp` group, which is a privilege change and a
          separate decision. */}
      <p className="kt-muted" data-note="usb">
        {m.printerUsbNote}
      </p>

      {props.notice === null ? null : (
        <p className="kt-warn" role="status" data-notice="printer">
          {props.notice}
        </p>
      )}
    </section>
  );
}

export function DeviceTab(props: {
  locale: KitluyLocale;
  info: DeviceInfoView | null;
}): JSX.Element {
  const m = messagesFor(props.locale);
  const rows: readonly (readonly [string, string | null])[] = [
    [m.devHostname, props.info?.hostname ?? null],
    [m.devSerial, props.info?.serial ?? null],
    [m.devClass, props.info?.deviceClass ?? null],
    [m.devImage, props.info?.imageVersion ?? null],
    [m.devEnvironment, props.info?.environment ?? null],
  ];
  return (
    <section className="kt-panel" aria-label="settings-device">
      <dl className="kt-facts">
        {rows.map(([key, value]) => (
          <div className="kt-fact" key={key} data-fact={key}>
            <dt className="kt-foot-k">{key}</dt>
            <dd className="kt-foot-v kt-mono">{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DisplayTab(props: {
  locale: KitluyLocale;
  /** null when the board has no backlight — an HDMI monitor has none. */
  brightness: number | null;
  busy: boolean;
  onBrightness: (percent: number) => void;
  onToggleLocale: () => void;
}): JSX.Element {
  const m = messagesFor(props.locale);
  return (
    <section className="kt-panel" aria-label="settings-display">
      {props.brightness === null ? (
        <p className="kt-muted" data-backlight="absent">
          {m.dispNoBacklight}
        </p>
      ) : (
        <label className="kt-field">
          <span>{m.dispBrightness}</span>
          {/* min=1, never 0: a till whose screen is dark reads as broken, and
              the only way back would be a reboot. The broker clamps too. */}
          <input
            type="range"
            name="brightness"
            min={1}
            max={100}
            step={1}
            value={props.brightness}
            disabled={props.busy}
            onChange={(event) => props.onBrightness(Number(event.target.value))}
          />
          <span className="kt-mono" data-brightness={props.brightness}>
            {props.brightness}%
          </span>
        </label>
      )}

      <div className="kt-actions">
        <span className="kt-foot-k">{m.dispLanguage}</span>
        <button
          type="button"
          className="kt-btn"
          data-action="toggle-locale"
          onClick={props.onToggleLocale}
        >
          {m.switchLanguage}
        </button>
      </div>
    </section>
  );
}
