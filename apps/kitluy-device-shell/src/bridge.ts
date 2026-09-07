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
