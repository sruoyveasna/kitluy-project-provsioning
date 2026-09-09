/**
 * The contract between the renderer and the Electron main process.
 *
 * The preload (`electron/preload.cts`) exposes EXACTLY these three methods on
 * `window.kitluyShell` — no generic `send`/`invoke`. `test/preload-surface.test.ts`
 * asserts the preload exposes this surface and nothing more.
 */
import type { ShellSnapshot } from "./model/shell-state.js";

/** The result of asking the main process to submit a code. */
export interface SubmitResult {
  /**
   * `PAIRED`, or a refusal code: the registry's own (`CODE_REFUSED`, `LOCKED`,
   * `ALREADY_ASSIGNED`, …), or one raised before the network
   * (`CODE_MALFORMED`, `NO_DEVICE_RECORD`, `PAIRING_TRANSPORT_UNAVAILABLE`).
   * Rendered to the person at the Pi; never treated as authority.
   */
  readonly status: string;
  /** True when presenting the same code again could still succeed. */
  readonly retryable?: boolean;
  /** The server's safe operator sentence. Never contains the code. */
  readonly message?: string;
}

/**
 * Whatever the privileged broker answered.
 *
 * `ok: false` is ORDINARY here, not exceptional: an image without the broker, a
 * radio that is not fitted, a screen with no backlight. Every Settings control
 * renders the refusal rather than treating it as a fault.
 */
export interface ConfigResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly code?: string;
  readonly message?: string;
}

/** One scanned network. `ssidHex` is what a join must quote back. */
export interface ScannedNetwork {
  /** Printable, control bytes replaced. DISPLAY only. */
  readonly ssid: string;
  /** The SSID's real bytes. What the device actually joins. */
  readonly ssidHex: string;
  /** dBm. Higher (less negative) is stronger. */
  readonly signal: number;
  readonly secured: boolean;
}

export interface LinkView {
  readonly name: string;
  readonly present: boolean;
  readonly carrier: boolean;
  readonly operstate: string;
}

export interface NetworkStatusView {
  readonly wired: LinkView;
  readonly wireless: LinkView;
  readonly hasLink: boolean;
  readonly wirelessConfigured: boolean;
}

export interface DeviceInfoView {
  readonly hostname: string;
  readonly serial: string | null;
  readonly imageVersion: string | null;
  readonly deviceClass: string | null;
  readonly environment: string | null;
  readonly registrationUrl: string | null;
}

export interface PrinterView {
  readonly kind: "network";
  readonly host: string;
  readonly port: number;
  readonly label?: string;
}

export interface KitluyShellBridge {
  getSnapshot(): Promise<ShellSnapshot>;
  onSnapshot(callback: (snapshot: ShellSnapshot) => void): void;
  submitPairingCode(code: string): Promise<SubmitResult>;

  // --- Settings -------------------------------------------------------------
  getNetworkStatus(): Promise<ConfigResult>;
  scanNetworks(): Promise<ConfigResult>;
  joinNetwork(ssidHex: string, passphrase?: string): Promise<ConfigResult>;
  forgetNetwork(ssidHex: string): Promise<ConfigResult>;
  getBrightness(): Promise<ConfigResult>;
  setBrightness(percent: number): Promise<ConfigResult>;
  getDeviceInfo(): Promise<DeviceInfoView>;
  getPrinter(): Promise<PrinterView | null>;
  savePrinter(config: { host: string; port?: number; label?: string }): Promise<ConfigResult>;
  testPrinter(): Promise<ConfigResult>;
}

declare global {
  interface Window {
    readonly kitluyShell?: KitluyShellBridge;
  }
}

export {};
