/**
 * Electron main process — WS-12-T001, with the Pi Terminal composition of
 * T1-STORE-OPERATIONS-001.
 *
 * Hardening per POS spec §16.2: context isolation on, sandbox on, no node
 * integration in the renderer, no cloud/service secrets in the renderer.
 * The renderer receives ONLY the bootstrap report and named operations over
 * the preload bridge; it cannot navigate away or open windows.
 *
 * TWO COMPOSITIONS, CHOSEN BY THE IMAGE, NEVER BY THE RENDERER:
 *   - on a KitLuy Pi Terminal (`KITLUY_DEVICE_CLASS=terminal`, from the unit's
 *     `/etc/kitluy/image.env`) the POS reaches the Store Hub through the root
 *     edge bridge and holds no key (`electron/pi-runtime.ts`);
 *   - anywhere else, the WS-12-T001 composition (`electron/t1-runtime.ts`),
 *     which fails closed until key custody exists (BLK-005).
 *
 * NOTE: the electron binary download is intentionally skipped in this
 * repository (pnpm.neverBuiltDependencies) — see ADR-0004. On a Pi Terminal the
 * runtime is the image's pinned Electron.
 */
import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { T1BootstrapReport } from "../src/bootstrap/states.js";
import type { IntakeOperations } from "../src/intake/ports.js";
import { DEFAULT_EDGE_BRIDGE_SOCKET } from "./edge-bridge-client.js";
import { registerConfigurationIpc } from "./configuration-ipc.js";
import { registerIntakeIpc } from "./intake-ipc.js";
import { PiTerminalRuntime, POS_RUNTIME_STATUS_PATH } from "./pi-runtime.js";
import { registerPinIpc } from "./pin-ipc.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const REPORT_CHANNEL = "kitluy:t1:report";
const REPORT_CHANGED_CHANNEL = "kitluy:t1:report-changed";
/** How often the Pi composition re-proves the terminal against the Hub. */
const PI_REFRESH_MS = 30_000;

const onPiTerminal = process.env["KITLUY_DEVICE_CLASS"] === "terminal";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // A shop counter shows the POS and nothing behind it; cage already gives it
    // the whole output, and kiosk mode keeps it there.
    ...(onPiTerminal ? { kiosk: true, fullscreen: true, autoHideMenuBar: true } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(moduleDirectory, "preload.cjs"),
    },
  });
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  void win.loadFile(path.join(moduleDirectory, "..", "..", "dist", "index.html"));
  return win;
}

function send(window: BrowserWindow, report: T1BootstrapReport): void {
  if (!window.isDestroyed()) window.webContents.send(REPORT_CHANGED_CHANNEL, report);
}

async function startPiTerminal(): Promise<void> {
  const runtime = new PiTerminalRuntime({
    socketPath: process.env["KITLUY_EDGE_BRIDGE_SOCKET"] ?? DEFAULT_EDGE_BRIDGE_SOCKET,
    applicationVersion: app.getVersion(),
    statusPath: POS_RUNTIME_STATUS_PATH,
  });
  ipcMain.handle(REPORT_CHANNEL, () => runtime.report);
  registerIntakeIpc(ipcMain, () => runtime.intakeOperations());
  registerPinIpc(ipcMain, runtime);
  registerConfigurationIpc(ipcMain, () => runtime.configurationRead());

  const window = createWindow();
  runtime.onReport((report) => {
    send(window, report);
  });
  await runtime.refresh();
  setInterval(() => {
    void runtime.refresh();
  }, PI_REFRESH_MS);
}

async function startWorkstation(): Promise<void> {
  let latestReport: T1BootstrapReport | null = null;
  // eslint-disable-next-line prefer-const -- assigned by the intake wiring step when live operations exist
  let intakeOperations: IntakeOperations | null = null;
  ipcMain.handle(REPORT_CHANNEL, () => latestReport);
  // The intake surface answers `unavailable` until a later wiring step
  // supplies live operations (endpoint + credentials + staff session from
  // a completed bootstrap). Handlers exist from startup so the renderer's
  // surface is stable; they FAIL CLOSED, never crash.
  registerIntakeIpc(ipcMain, () => intakeOperations);
  // The workstation composition keeps its verified configuration in the
  // SQLite store behind the bootstrap; surfacing it there is a later step.
  registerConfigurationIpc(ipcMain, () => ({
    status: "not_delivered",
    reason: "the workstation composition does not surface the configuration sections yet",
  }));

  const window = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Loaded lazily: this composition's SQLite store is never needed on a Pi.
  const { runT1Bootstrap } = await import("./t1-runtime.js");
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
  send(window, latestReport);
}

void app.whenReady().then(() => (onPiTerminal ? startPiTerminal() : startWorkstation()));

app.on("window-all-closed", () => {
  app.quit();
});
