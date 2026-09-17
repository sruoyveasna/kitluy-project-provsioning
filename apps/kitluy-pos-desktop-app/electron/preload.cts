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

// WS-12-T002-P02 §5: exactly eight NAMED intake operations. No channel
// pass-through, no route/method/scope input — every payload is re-validated
// in the main process (electron/intake-ipc.ts) before any adapter runs.
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
});

// T1-STORE-OPERATIONS-001: exactly two NAMED staff operations. The renderer
// supplies a staff id and a passcode; the profile is always T1, chosen by the
// main process, and the Hub is the verifier (electron/staff-ipc.ts).
contextBridge.exposeInMainWorld("kitluyT1Staff", {
  signIn: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("kitluy:t1:staff:sign-in", payload),
  signOut: (): Promise<unknown> => ipcRenderer.invoke("kitluy:t1:staff:sign-out"),
});
