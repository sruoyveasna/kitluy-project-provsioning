/**
 * Preload bridge — WS-12-T001.
 *
 * CommonJS (`.cts` → `.cjs`) because sandboxed preload scripts do not load
 * ESM. Exposes the READ-ONLY report surface defined in
 * `src/bootstrap/bridge-types.ts` and nothing else: no generic `send`, no
 * channel pass-through, no configuration input of any kind.
 */
import { contextBridge, ipcRenderer } from "electron";

const T1_REPORT_CHANNEL = "kitluy:t1:report";
const T1_REPORT_CHANGED_CHANNEL = "kitluy:t1:report-changed";

contextBridge.exposeInMainWorld("kitluyT1", {
  getReport: (): Promise<unknown> => ipcRenderer.invoke(T1_REPORT_CHANNEL),
  onReport: (listener: (report: unknown) => void): (() => void) => {
    const wrapped = (_event: unknown, report: unknown): void => {
      listener(report);
    };
    ipcRenderer.on(T1_REPORT_CHANGED_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(T1_REPORT_CHANGED_CHANNEL, wrapped);
    };
  },
});

// WS-12-T002-P02 §5: exactly eight NAMED intake operations, plus the three
// T1 Store operations of T1-REAL-OPERATIONS-001 slice 2 (quote, confirm-intake,
// recent Bookings). No channel pass-through, no route/method/scope input —
// every payload is re-validated in the main process (electron/intake-ipc.ts)
// before any adapter runs; the command key is minted there, never here.
contextBridge.exposeInMainWorld("kitluyT1Intake", {
  searchCustomers: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:search-customers", payload),
  readCustomer: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:read-customer", payload),
  createCustomer: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:create-customer", payload),
  recordConsentDecision: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:record-consent", payload),
  createDraft: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:create-draft", payload),
  readDraft: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:read-draft", payload),
  updateDraft: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:update-draft", payload),
  cancelDraft: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:cancel-draft", payload),
  quote: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:quote", payload),
  confirmIntake: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:confirm-intake", payload),
  listRecentBookings: (): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:intake:list-recent-bookings"),
});

// TERMINAL-PIN-AND-REAL-POS-AUTH-001: exactly four NAMED Terminal PIN
// operations. The renderer supplies four-digit PINs; the Store Hub is the
// verifier and the main process holds the session (electron/pin-ipc.ts). There
// is no staff sign-in channel on a Pi Terminal.
contextBridge.exposeInMainWorld("kitluyT1Pin", {
  setup: (payload: unknown): Promise<unknown> => ipcRenderer.invoke("kitluy:t1:pin:setup", payload),
  unlock: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:pin:unlock", payload),
  change: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:pin:change", payload),
  lock: (): Promise<unknown> => ipcRenderer.invoke("kitluy:t1:pin:lock"),
});

// T1-REAL-OPERATIONS-001: the verified configuration's sections, read whole.
// No section name travels from the renderer; the main process answers with
// what the Hub signed and nothing else.
contextBridge.exposeInMainWorld("kitluyT1Configuration", {
  read: (): Promise<unknown> => ipcRenderer.invoke("kitluy:t1:configuration:read"),
});
