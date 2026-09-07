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
  /** In this slice always `PAIRING_NOT_AVAILABLE_IN_THIS_BUILD`. */
  readonly status: string;
}

export interface KitluyShellBridge {
  getSnapshot(): Promise<ShellSnapshot>;
  onSnapshot(callback: (snapshot: ShellSnapshot) => void): void;
  submitPairingCode(code: string): Promise<SubmitResult>;
}

declare global {
  interface Window {
    readonly kitluyShell?: KitluyShellBridge;
  }
}

export {};
