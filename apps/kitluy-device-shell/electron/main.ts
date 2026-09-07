/**
 * Electron main process for the Pi Terminal Device Shell.
 *
 * A hardened kiosk: full-screen, frameless, context-isolated, sandboxed, no node
 * integration, no menu, and every window-open / navigation attempt denied. The
 * renderer receives ONLY snapshots of the device's own display state over the
 * read-only preload bridge, and can ask exactly one thing back — to submit a
 * pairing code — which is shape-checked here and, in this slice, answered
 * `PAIRING_NOT_AVAILABLE_IN_THIS_BUILD` (owner decision v2.0.0 §5; the pairing
 * transport lands in Phase 3).
 *
 * The electron binary is never downloaded by pnpm in this repo (ADR-0004); the
 * image ships a pinned arm64 Electron separately. Run with
 * `--ozone-platform=wayland` under cage (Electron 33 needs the switch, 38 does
 * not, and the shim passes it regardless).
 */
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { CROCKFORD_BASE32, normalizeCodeChar } from "../src/model/code-entry.js";
import { startSnapshotFeed } from "./snapshot.js";
import type { ShellSnapshot } from "../src/model/shell-state.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

const SNAPSHOT_CHANNEL = "kitluy:shell:snapshot";
const SNAPSHOT_CHANGED_CHANNEL = "kitluy:shell:snapshot-changed";
const SUBMIT_CODE_CHANNEL = "kitluy:shell:submit-code";

const PAIRING_NOT_AVAILABLE = "PAIRING_NOT_AVAILABLE_IN_THIS_BUILD";
const CODE_MALFORMED = "CODE_MALFORMED";

let latest: ShellSnapshot | null = null;

/** The same shape rule the reducer uses: exactly `length` alphabet characters. */
function isWellFormedCode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  if (code.length !== CROCKFORD_BASE32.length) return false;
  for (const char of code) {
    if (normalizeCodeChar(char) !== char) return false;
  }
  return true;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    fullscreen: true,
    kiosk: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b1120",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(moduleDirectory, "preload.cjs"),
    },
  });

  // A kiosk goes nowhere: deny every navigation and every new window.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  void win.loadFile(path.join(moduleDirectory, "..", "..", "dist", "index.html"));
  return win;
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  ipcMain.handle(SNAPSHOT_CHANNEL, () => latest);
  ipcMain.handle(SUBMIT_CODE_CHANNEL, (_event, code: unknown) => {
    // The code is re-validated HERE, in the trusted process. It is never logged
    // and never persisted; only its shape is checked before we answer.
    if (!isWellFormedCode(code)) return { status: CODE_MALFORMED };
    return { status: PAIRING_NOT_AVAILABLE };
  });

  const window = createWindow();

  const stop = startSnapshotFeed((snapshot) => {
    latest = snapshot;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(SNAPSHOT_CHANGED_CHANNEL, snapshot);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("will-quit", () => stop());

  void window;
});

app.on("window-all-closed", () => app.quit());
