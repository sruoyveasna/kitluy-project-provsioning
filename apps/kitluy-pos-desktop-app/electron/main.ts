/**
 * Electron main process (SCAFFOLDED).
 *
 * Hardening per POS spec §16.2: context isolation on, sandbox on, no node
 * integration in the renderer, no cloud/service secrets in the renderer.
 *
 * NOTE: the electron binary download is intentionally skipped in this
 * repository (pnpm.neverBuiltDependencies) — see ADR-0004. To run the shell
 * locally, remove that entry and reinstall, or install electron globally.
 */
import { app, BrowserWindow } from "electron";
import * as path from "node:path";

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  void win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
