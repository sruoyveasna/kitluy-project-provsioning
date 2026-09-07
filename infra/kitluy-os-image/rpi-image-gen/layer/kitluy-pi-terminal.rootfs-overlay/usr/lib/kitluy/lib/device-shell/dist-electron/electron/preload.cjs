"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Preload bridge for the Device Shell.
 *
 * CommonJS (`.cts` → `.cjs`) because a sandboxed preload does not load ESM.
 * Exposes EXACTLY three named methods on `window.kitluyShell` — a snapshot read,
 * a snapshot subscription, and a single code submission. There is no generic
 * `send`/`invoke`, no channel pass-through and no other input surface;
 * `test/preload-surface.test.ts` asserts this is all that is exposed.
 */
const electron_1 = require("electron");
const SNAPSHOT_CHANNEL = "kitluy:shell:snapshot";
const SNAPSHOT_CHANGED_CHANNEL = "kitluy:shell:snapshot-changed";
const SUBMIT_CODE_CHANNEL = "kitluy:shell:submit-code";
electron_1.contextBridge.exposeInMainWorld("kitluyShell", {
    getSnapshot: () => electron_1.ipcRenderer.invoke(SNAPSHOT_CHANNEL),
    onSnapshot: (callback) => {
        electron_1.ipcRenderer.on(SNAPSHOT_CHANGED_CHANNEL, (_event, snapshot) => callback(snapshot));
    },
    submitPairingCode: (code) => electron_1.ipcRenderer.invoke(SUBMIT_CODE_CHANNEL, code),
});
//# sourceMappingURL=preload.cjs.map