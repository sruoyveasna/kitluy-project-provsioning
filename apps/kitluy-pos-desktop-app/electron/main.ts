/**
 * Electron main process — WS-12-T001.
 *
 * Hardening per POS spec §16.2: context isolation on, sandbox on, no node
 * integration in the renderer, no cloud/service secrets in the renderer.
 * The renderer receives ONLY the bootstrap report over the read-only
 * preload bridge.
 *
 * NOTE: the electron binary download is intentionally skipped in this
 * repository (pnpm.neverBuiltDependencies) — see ADR-0004. To run the shell
 * locally, remove that entry and reinstall, or install electron globally.
 */
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { T1BootstrapReport } from "../src/bootstrap/states.js";
import type { IntakeOperations } from "../src/intake/ports.js";
import { registerIntakeIpc } from "./intake-ipc.js";
import { runT1Bootstrap } from "./t1-runtime.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

let latestReport: T1BootstrapReport | null = null;
// eslint-disable-next-line prefer-const -- assigned by the intake wiring step when live operations exist
let intakeOperations: IntakeOperations | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(moduleDirectory, "preload.cjs"),
    },
  });
  void win.loadFile(path.join(moduleDirectory, "..", "..", "dist", "index.html"));
  return win;
}

void app.whenReady().then(async () => {
  ipcMain.handle("kitluy:t1:report", () => latestReport);
  // The intake surface answers `unavailable` until a later wiring step
  // supplies live operations (endpoint + credentials + staff session from
  // a completed bootstrap). Handlers exist from startup so the renderer's
  // surface is stable; they FAIL CLOSED, never crash.
  registerIntakeIpc(ipcMain, () => intakeOperations);

  const window = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Run the §5 startup sequence. Every failure is a REPORTED state, not a
  // crash — the renderer shows the fail-closed surface for it.
  latestReport = await runT1Bootstrap(
    {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plainText) => safeStorage.encryptString(plainText),
      decryptString: (encrypted) => safeStorage.decryptString(encrypted),
    },
    app.getPath("userData"),
  );
  if (!window.isDestroyed()) {
    window.webContents.send("kitluy:t1:report-changed", latestReport);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
