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
import { requestDeviceConfig } from "./device-config-client.js";
import { readDeviceInfo } from "./device-info.js";
import { printTest, readPrinterConfig, validateConfig, writePrinterConfig } from "./printer.js";
import { writeTerminalAssignment } from "./terminal-assignment.js";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_CHANNEL = "kitluy:shell:snapshot";
const SNAPSHOT_CHANGED_CHANNEL = "kitluy:shell:snapshot-changed";
const NETWORK_STATUS_CHANNEL = "kitluy:shell:network-status";
const NETWORK_SCAN_CHANNEL = "kitluy:shell:network-scan";
const NETWORK_JOIN_CHANNEL = "kitluy:shell:network-join";
const NETWORK_FORGET_CHANNEL = "kitluy:shell:network-forget";
const BRIGHTNESS_GET_CHANNEL = "kitluy:shell:brightness-get";
const BRIGHTNESS_SET_CHANNEL = "kitluy:shell:brightness-set";
const DEVICE_PIN_SETUP_CHANNEL = "kitluy:shell:device-pin-setup";
const DEVICE_INFO_CHANNEL = "kitluy:shell:device-info";
const PRINTER_GET_CHANNEL = "kitluy:shell:printer-get";
const PRINTER_SAVE_CHANNEL = "kitluy:shell:printer-save";
const PRINTER_TEST_CHANNEL = "kitluy:shell:printer-test";
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
        const outcome = await submitPairingCode(code, {
            transport,
            // From bootstrap-state.json, via the snapshot feed. A board that has not
            // registered has none, and the action refuses before the network.
            deviceRecordId: latest?.deviceRecordId,
            persist: writeTerminalAssignment,
        });
        // Paired: ask the update agent to check for the application NOW rather than
        // on its next five-minute poll — the person at the till is watching.
        if (outcome.status === "PAIRED")
            void requestDeviceConfig({ verb: "update.check" });
        return outcome;
    });
    // T1-FIRST-BOOT-PIN-001. Shape-checked here (four digits each) and never
    // logged; the root broker seals it under the device identity. The renderer
    // gets a posture back, never the digits.
    ipcMain.handle(DEVICE_PIN_SETUP_CHANNEL, async (_event, pin, confirmation) => {
        const digits = /^[0-9]{4}$/u;
        if (typeof pin !== "string" || !digits.test(pin)) {
            return {
                ok: false,
                code: "PIN_MALFORMED",
                message: "A Terminal PIN is exactly four digits.",
            };
        }
        if (typeof confirmation !== "string" || !digits.test(confirmation)) {
            return {
                ok: false,
                code: "PIN_MALFORMED",
                message: "A Terminal PIN is exactly four digits.",
            };
        }
        const result = await requestDeviceConfig({
            verb: "pin.setup",
            pin,
            pinConfirmation: confirmation,
        });
        // The PIN is on the Hub: the update agent may install and start the
        // application now (it holds the install back while the Hub says
        // setup_required, so the PIN screen is never pre-empted by the POS).
        if (result.ok)
            void requestDeviceConfig({ verb: "update.check" });
        return result;
    });
    // --- Settings -------------------------------------------------------------
    // Every argument is re-checked HERE, in the trusted process, before it reaches
    // the broker. The broker validates again and is the real boundary; this is the
    // near-side check that keeps obviously wrong input off the socket entirely.
    const hex = (value) => typeof value === "string" && value !== "" && value.length <= 64 && /^[0-9a-fA-F]+$/.test(value)
        ? value
        : null;
    ipcMain.handle(NETWORK_STATUS_CHANNEL, () => requestDeviceConfig({ verb: "network.status" }));
    ipcMain.handle(NETWORK_SCAN_CHANNEL, () => requestDeviceConfig({ verb: "network.scan" }));
    ipcMain.handle(NETWORK_JOIN_CHANNEL, async (_event, ssidHex, passphrase) => {
        const ssid = hex(ssidHex);
        if (ssid === null) {
            return { ok: false, code: "MALFORMED", message: "That network could not be identified." };
        }
        // An open network sends no passphrase at all rather than an empty string,
        // so the broker's own "is this open?" test stays the only one that decides.
        return requestDeviceConfig({
            verb: "network.join",
            ssidHex: ssid,
            ...(typeof passphrase === "string" && passphrase !== "" ? { psk: passphrase } : {}),
        });
    });
    ipcMain.handle(NETWORK_FORGET_CHANNEL, async (_event, ssidHex) => {
        const ssid = hex(ssidHex);
        if (ssid === null) {
            return { ok: false, code: "MALFORMED", message: "That network could not be identified." };
        }
        return requestDeviceConfig({ verb: "network.forget", ssidHex: ssid });
    });
    ipcMain.handle(BRIGHTNESS_GET_CHANNEL, () => requestDeviceConfig({ verb: "display.getBrightness" }));
    ipcMain.handle(BRIGHTNESS_SET_CHANNEL, async (_event, percent) => {
        if (typeof percent !== "number" || !Number.isFinite(percent)) {
            return { ok: false, code: "MALFORMED", message: "That brightness is not a number." };
        }
        return requestDeviceConfig({ verb: "display.setBrightness", percent });
    });
    ipcMain.handle(DEVICE_INFO_CHANNEL, () => readDeviceInfo());
    ipcMain.handle(PRINTER_GET_CHANNEL, () => readPrinterConfig());
    ipcMain.handle(PRINTER_SAVE_CHANNEL, async (_event, config) => {
        const validated = validateConfig(config);
        if ("ok" in validated)
            return validated;
        writePrinterConfig(validated);
        return { ok: true };
    });
    ipcMain.handle(PRINTER_TEST_CHANNEL, async () => {
        const config = readPrinterConfig();
        if (config === null) {
            return { ok: false, code: "PRINTER_UNSET", message: "No printer has been set up yet." };
        }
        return printTest(config);
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