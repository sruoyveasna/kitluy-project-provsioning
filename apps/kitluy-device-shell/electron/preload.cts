/**
 * Preload bridge for the Device Shell.
 *
 * CommonJS (`.cts` → `.cjs`) because a sandboxed preload does not load ESM.
 * Exposes EXACTLY three named methods on `window.kitluyShell` — a snapshot read,
 * a snapshot subscription, and a single code submission. There is no generic
 * `send`/`invoke`, no channel pass-through and no other input surface;
 * `test/preload-surface.test.ts` asserts this is all that is exposed.
 */
import { contextBridge, ipcRenderer } from "electron";

const SNAPSHOT_CHANNEL = "kitluy:shell:snapshot";
const SNAPSHOT_CHANGED_CHANNEL = "kitluy:shell:snapshot-changed";
const SUBMIT_CODE_CHANNEL = "kitluy:shell:submit-code";

contextBridge.exposeInMainWorld("kitluyShell", {
  getSnapshot: (): Promise<unknown> => ipcRenderer.invoke(SNAPSHOT_CHANNEL),
  onSnapshot: (callback: (snapshot: unknown) => void): void => {
    ipcRenderer.on(SNAPSHOT_CHANGED_CHANNEL, (_event, snapshot: unknown) => callback(snapshot));
  },
  submitPairingCode: (code: string): Promise<unknown> =>
    ipcRenderer.invoke(SUBMIT_CODE_CHANNEL, code),
});
