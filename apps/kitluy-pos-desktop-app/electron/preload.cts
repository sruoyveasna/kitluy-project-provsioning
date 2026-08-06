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
