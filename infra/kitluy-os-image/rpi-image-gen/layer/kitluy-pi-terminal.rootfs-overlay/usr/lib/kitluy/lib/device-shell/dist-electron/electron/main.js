/**
 * Electron main process for the Pi Terminal Device Shell.
 *
 * A hardened kiosk: full-screen, frameless, context-isolated, sandboxed, no node
 * integration, no menu, and every window-open / navigation attempt denied. The
 * renderer receives ONLY snapshots of the device's own display state over the
 * read-only preload bridge, and can ask exactly one thing back — to submit a
 * pairing code, which is shape-checked here and then presented to the device
 * registry (owner decision v2.0.0 §5; KLD-2026-09-03-TERMINAL-PROVISIONING-001).
 *
 * THE TRANSPORT IS LOADED, NOT BUNDLED. The firstboot agent owns every device
 * transport, and the image installs its closure under
 * `/usr/lib/kitluy/lib/firstboot-agent/`. This process imports the pairing
 * client from there at first use rather than carrying a second copy: two
 * implementations of one wire contract eventually disagree, and the agent's is
 * the one carrying the drift test against the registry route. When the closure
 * is absent — a development run, or an image built before the module was
 * packaged — submission answers `PAIRING_TRANSPORT_UNAVAILABLE` rather than
 * pretending either way.
 *
 * The electron binary is never downloaded by pnpm in this repo (ADR-0004); the
 * image ships a pinned arm64 Electron separately. Run with
 * `--ozone-platform=wayland` under cage (Electron 33 needs the switch, 38 does
 * not, and the shim passes it regardless).
 */
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CROCKFORD_BASE32, normalizeCodeChar } from "../src/model/code-entry.js";
import { submitPairingCode } from "./pairing.js";
import { startSnapshotFeed } from "./snapshot.js";
import { writeTerminalAssignment } from "./terminal-assignment.js";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_CHANNEL = "kitluy:shell:snapshot";
const SNAPSHOT_CHANGED_CHANNEL = "kitluy:shell:snapshot-changed";
const SUBMIT_CODE_CHANNEL = "kitluy:shell:submit-code";
const TRANSPORT_UNAVAILABLE = "PAIRING_TRANSPORT_UNAVAILABLE";
const CODE_MALFORMED = "CODE_MALFORMED";
/** Where the image installs the firstboot agent's packaged closure. */
const AGENT_PAIRING_CLIENT = "/usr/lib/kitluy/lib/firstboot-agent/adapters/http-terminal-pairing-client.js";
/** The image.env key naming the fleet service, which serves the pairing route. */
const REGISTRY_URL_KEY = "KITLUY_ENROLLMENT_BASE_URL";
/**
 * Resolve the registry origin from `/etc/kitluy/image.env`, read fresh each time.
 *
 * Not cached: a terminal that booted before an operator corrected the file would
 * otherwise hold the wrong origin until someone power-cycled it.
 */
async function registryBaseUrl() {
    try {
        const text = await readFile("/etc/kitluy/image.env", "utf8");
        for (const line of text.split("\n")) {
            const [key, ...rest] = line.split("=");
            if (key?.trim() === REGISTRY_URL_KEY) {
                const value = rest.join("=").trim();
                return value === "" ? null : value;
            }
        }
    }
    catch {
        /* absent or unreadable — treated as unconfigured by the caller */
    }
    return null;
}
/** The agent's client, from the device closure. Null when it is not there. */
async function loadTransport() {
    const base = await registryBaseUrl();
    if (base === null)
        return null;
    try {
        const loaded = (await import(pathToFileURL(AGENT_PAIRING_CLIENT).href));
        return loaded.createHttpTerminalPairingClient?.({ registryBaseUrl: base }) ?? null;
    }
    catch {
        return null;
    }
}
let latest = null;
/** The same shape rule the reducer uses: exactly `length` alphabet characters. */
function isWellFormedCode(code) {
    if (typeof code !== "string")
        return false;
    if (code.length !== CROCKFORD_BASE32.length)
        return false;
    for (const char of code) {
        if (normalizeCodeChar(char) !== char)
            return false;
    }
    return true;
}
function createWindow() {
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
    ipcMain.handle(SUBMIT_CODE_CHANNEL, async (_event, code) => {
        // The code is re-validated HERE, in the trusted process. It is never logged
        // and never persisted; only its shape is checked before we present it.
        if (!isWellFormedCode(code))
            return { status: CODE_MALFORMED };
        const transport = await loadTransport();
        if (transport === null) {
            return {
                status: TRANSPORT_UNAVAILABLE,
                retryable: false,
                message: "this terminal cannot reach KitLuy to pair yet",
            };
        }
        return submitPairingCode(code, {
            transport,
            // From bootstrap-state.json, via the snapshot feed. A board that has not
            // registered has none, and the action refuses before the network.
            deviceRecordId: latest?.deviceRecordId,
            persist: writeTerminalAssignment,
        });
    });
    const window = createWindow();
    const stop = startSnapshotFeed((snapshot) => {
        latest = snapshot;
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed())
                win.webContents.send(SNAPSHOT_CHANGED_CHANNEL, snapshot);
        }
    });
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
    app.on("will-quit", () => stop());
    void window;
});
app.on("window-all-closed", () => app.quit());
//# sourceMappingURL=main.js.map