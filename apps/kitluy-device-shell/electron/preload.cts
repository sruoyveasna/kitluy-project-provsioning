/**
 * Preload bridge for the Device Shell.
 *
 * CommonJS (`.cts` → `.cjs`) because a sandboxed preload does not load ESM.
 * Exposes a CLOSED list of named methods on `window.kitluyShell`: three for the
 * pairing flow, and since Settings arrived, one per configuration verb. There is
 * still no generic `send`/`invoke` and no channel pass-through —
 * `test/preload-surface.test.ts` asserts this is all that is exposed.
 *
 * ONE METHOD PER VERB, not a single `deviceConfig(request)` that forwards an
 * object the renderer composed. A forwarder is a channel pass-through wearing a
 * different name, and the thing on the other end of these channels is a root
 * process. Each method below names exactly what it can ask for, so reading this
 * file tells you the renderer's whole reach.
 */
import { contextBridge, ipcRenderer } from "electron";

const SNAPSHOT_CHANNEL = "kitluy:shell:snapshot";
const SNAPSHOT_CHANGED_CHANNEL = "kitluy:shell:snapshot-changed";
const SUBMIT_CODE_CHANNEL = "kitluy:shell:submit-code";
const DEVICE_PIN_SETUP_CHANNEL = "kitluy:shell:device-pin-setup";
const NETWORK_STATUS_CHANNEL = "kitluy:shell:network-status";
const NETWORK_SCAN_CHANNEL = "kitluy:shell:network-scan";
const NETWORK_JOIN_CHANNEL = "kitluy:shell:network-join";
const NETWORK_FORGET_CHANNEL = "kitluy:shell:network-forget";
const BRIGHTNESS_GET_CHANNEL = "kitluy:shell:brightness-get";
const BRIGHTNESS_SET_CHANNEL = "kitluy:shell:brightness-set";
const DEVICE_INFO_CHANNEL = "kitluy:shell:device-info";
const PRINTER_GET_CHANNEL = "kitluy:shell:printer-get";
const PRINTER_SAVE_CHANNEL = "kitluy:shell:printer-save";
const PRINTER_TEST_CHANNEL = "kitluy:shell:printer-test";

contextBridge.exposeInMainWorld("kitluyShell", {
  getSnapshot: (): Promise<unknown> => ipcRenderer.invoke(SNAPSHOT_CHANNEL),
  onSnapshot: (callback: (snapshot: unknown) => void): void => {
    ipcRenderer.on(SNAPSHOT_CHANGED_CHANNEL, (_event, snapshot: unknown) => callback(snapshot));
  },
  submitPairingCode: (code: string): Promise<unknown> =>
    ipcRenderer.invoke(SUBMIT_CODE_CHANNEL, code),
  // T1-FIRST-BOOT-PIN-001: the first-boot device PIN, sealed by the root broker.
  setupDevicePin: (pin: string, pinConfirmation: string): Promise<unknown> =>
    ipcRenderer.invoke(DEVICE_PIN_SETUP_CHANNEL, pin, pinConfirmation),

  // --- Settings -------------------------------------------------------------
  getNetworkStatus: (): Promise<unknown> => ipcRenderer.invoke(NETWORK_STATUS_CHANNEL),
  scanNetworks: (): Promise<unknown> => ipcRenderer.invoke(NETWORK_SCAN_CHANNEL),
  // The SSID crosses as hex, never as the printable form: a network whose name
  // carries a control byte must be joined as broadcast, not as displayed.
  joinNetwork: (ssidHex: string, passphrase?: string): Promise<unknown> =>
    ipcRenderer.invoke(NETWORK_JOIN_CHANNEL, ssidHex, passphrase),
  forgetNetwork: (ssidHex: string): Promise<unknown> =>
    ipcRenderer.invoke(NETWORK_FORGET_CHANNEL, ssidHex),
  getBrightness: (): Promise<unknown> => ipcRenderer.invoke(BRIGHTNESS_GET_CHANNEL),
  setBrightness: (percent: number): Promise<unknown> =>
    ipcRenderer.invoke(BRIGHTNESS_SET_CHANNEL, percent),
  getDeviceInfo: (): Promise<unknown> => ipcRenderer.invoke(DEVICE_INFO_CHANNEL),
  getPrinter: (): Promise<unknown> => ipcRenderer.invoke(PRINTER_GET_CHANNEL),
  savePrinter: (config: unknown): Promise<unknown> =>
    ipcRenderer.invoke(PRINTER_SAVE_CHANNEL, config),
  testPrinter: (): Promise<unknown> => ipcRenderer.invoke(PRINTER_TEST_CHANNEL),
});
