/**
 * `/usr/lib/kitluy/update-agent` — the release/update agent (§16).
 *
 * ===========================================================================
 * WHAT THIS WAS, AND WHAT U1 ADDED
 * ===========================================================================
 * Until U1 this file was 91 lines that logged one of three PRECONDITION states
 * every five minutes and did nothing else. It never queried, downloaded,
 * verified or installed anything — `up_to_date` was returned unconditionally as
 * soon as a trust anchor and a release source existed.
 *
 * U1 GREW it rather than replacing it, and kept the part that was already
 * right: it refuses to LOOK FOR a payload when it holds no trust material,
 * rather than fetching first and failing to verify afterwards. That refusal
 * order is the thing most updaters get wrong, and `evaluatePreconditions` below
 * is the original function, unchanged in behaviour.
 *
 * It is still BAKED INTO THE IMAGE and still not itself updatable
 * (KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001): an updater cannot be delivered
 * by the thing it delivers. The release store holds APPLICATIONS only — the
 * Device Shell payload (OD-U1-2 = C) and the POS `kitluy-terminal` (the same
 * locked decision: POS business applications are governed releases) — and
 * `assertProductPermitted` enforces that boundary in code.
 *
 * ONE PASS PER PRODUCT THIS IMAGE CAN RUN. A product is installed only when the
 * image defines the unit that runs it; the Store Hub image defines neither, so
 * its agent reports and installs nothing, as before.
 *
 * ===========================================================================
 * IT STILL HOLDS NO SIGNING KEY
 * ===========================================================================
 * Public trust material only, loaded from `/etc/kitluy/trust`, purpose-checked
 * before use. Nothing here can sign a release, and nothing here is trusted to
 * decide what to install — that is the governed assignment's job.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SERVICE_VERSION } from "../version.js";
import { readImageEnv } from "../image-env.js";
import { loadReleaseTrustRegistry } from "../release-trust.js";
import { describeReleaseStatus, formatReleaseStatusLine } from "../release-status.js";
import { activeReleaseId, PERMITTED_PRODUCTS, isPermittedProduct, readJournal, storePaths, TERMINAL_CLIENT_PRODUCT, } from "../release-store.js";
import { composeInstallDependencies, RELEASE_PRODUCTS } from "../release-runtime.js";
import { runInstallPass } from "../release-install.js";
export const TRUST_ANCHOR_DIR = "/etc/kitluy/trust";
/** terminal-edge's link status: the Hub's word on the Terminal PIN lives here. */
export const EDGE_STATUS_PATH = "/var/lib/kitluy/terminal/edge-status.json";
/**
 * THE ORDER THE OWNER RULED (KLD-2026-09-19-PIN-AFTER-PAIRING-001): pair →
 * create the Terminal PIN on the Store Hub → install and start the application.
 * The first POS install used to race the PIN screen — the POS unit takes the
 * seat the moment it starts, and on 2026-09-21 it took it while the person was
 * still on the Shell's PIN screen, so the PIN ended up created in the
 * application's fallback face instead. A FIRST install (nothing of this product
 * installed yet) therefore waits while the Hub says `setup_required`; the Shell
 * asks for a check the moment the Hub confirms the PIN. An update of a running
 * POS is never held: the PIN exists by then. A board with no edge status, or an
 * older Hub with no PIN answer, is not held either — only the Hub's explicit
 * `setup_required` holds the door.
 */
export function terminalPinSetupPending(edgeStatusPath = EDGE_STATUS_PATH) {
    try {
        const raw = JSON.parse(readFileSync(edgeStatusPath, "utf8"));
        return raw.phase === "SERVING" && raw.terminalPin?.state === "setup_required";
    }
    catch {
        return false;
    }
}
/**
 * The BAKED default, in the read-only rootfs. A bootstrap value, not the last
 * word — see `RELEASE_SOURCE_OVERRIDE_PATH`.
 */
export const RELEASE_CONFIG_PATH = "/etc/kitluy/release.env";
/**
 * THE OVERRIDE, and why it exists.
 *
 * `/etc/kitluy/release.env` is baked into an EROFS rootfs at build time, so on a
 * development terminal it would pin the release source to whatever IP the
 * workstation happened to have that afternoon. A DHCP lease changing would then
 * cost a reflash — which is the opposite of what U1 is for.
 *
 * So the baked value is a default, and this file wins when it exists. It lives
 * directly on `/persistent`, which:
 *
 *   - is a real partition mounted before `local-fs.target` by the upstream
 *     `slot-perst-generator`, so it needs no declaration of ours;
 *   - is SHARED ACROSS A/B SLOTS by construction, so a system update does not
 *     lose it — the property `/var` does NOT have;
 *   - is never written by the image, so nothing overwrites an edited value.
 *
 * That last point is not incidental. `rpi-persistent-shared-init` rsyncs image
 * content INTO `/persistent/shared` on every boot for paths declared in
 * `slot-shared.d`, so a file the image also ships would be silently restored
 * from the image on the next reboot. Keeping the override on a path the image
 * never writes is what makes an edit stick.
 *
 * NOT a discovery protocol. When the Store Hub becomes the release source at
 * U4, the terminal already finds it over the mDNS service it uses today
 * (`_kitluy-edge._tcp`), and this file stops being needed. Inventing discovery
 * here would be building U4 early.
 */
export const RELEASE_SOURCE_OVERRIDE_PATH = "/persistent/shared/kitluy/release-source.env";
export const POLL_SECONDS = 300;
/** Where an image defines its units. The overlay writes /etc; packages write /usr/lib. */
export const UNIT_DIRECTORIES = [
    "/etc/systemd/system",
    "/usr/lib/systemd/system",
    "/lib/systemd/system",
];
/**
 * The products THIS image can run, in `PERMITTED_PRODUCTS` order.
 *
 * Decided by the unit definition, not by a flag: an agent that installed a
 * product whose unit the image does not define would restart nothing and pass
 * nothing, and the health gate would roll back a release that was never the
 * problem.
 */
export function productsOnThisImage(unitDirectories = UNIT_DIRECTORIES) {
    return PERMITTED_PRODUCTS.filter(isPermittedProduct).filter((product) => unitDirectories.some((dir) => existsSync(join(dir, RELEASE_PRODUCTS[product].unit))));
}
/**
 * Trust is a PRECONDITION, not a step. An update agent with no public trust
 * material cannot distinguish a genuine release from an attacker's, so it
 * refuses to look for one at all rather than fetching first and failing to
 * verify afterwards.
 *
 * (Named `evaluatePreconditions` since U1; it was `evaluateUpdate` when
 * checking the preconditions was the whole job. The behaviour of the three
 * states is unchanged — only the third is now honest about what it means: the
 * agent is READY to check, not already up to date.)
 */
/** Read `KITLUY_RELEASE_SOURCE` out of one env-style file, or undefined. */
function readReleaseSource(path) {
    try {
        const value = /^KITLUY_RELEASE_SOURCE=(.+)$/m.exec(readFileSync(path, "utf8"))?.[1]?.trim();
        return value === undefined || value === "" ? undefined : value;
    }
    catch {
        return undefined;
    }
}
export function evaluatePreconditions(options) {
    const trustDir = options.trustDir ?? TRUST_ANCHOR_DIR;
    let anchors = [];
    try {
        anchors = readdirSync(trustDir).filter((name) => name.endsWith(".pub") || name.endsWith(".pem") || name.endsWith(".json"));
    }
    catch {
        anchors = [];
    }
    if (anchors.length === 0) {
        return {
            kind: "no_trust_anchor",
            detail: `no public release trust anchor in ${trustDir}; refusing to consider any payload`,
        };
    }
    // The override wins. An absent or unreadable override is the normal case on a
    // freshly flashed board and falls through to the baked default in silence.
    const override = readReleaseSource(options.releaseSourceOverridePath ?? RELEASE_SOURCE_OVERRIDE_PATH);
    const baked = readReleaseSource(options.releaseConfigPath ?? RELEASE_CONFIG_PATH);
    const source = override ?? baked;
    if (source === undefined) {
        return {
            kind: "no_release_source",
            detail: "no governed release source configured; nothing to check",
        };
    }
    const imageVersion = readImageVersion(options.imageEnvPath ?? "/etc/kitluy/image.env");
    return {
        kind: "ready",
        imageVersion: imageVersion ?? "unknown",
        source,
        // Reported so `journalctl` says WHICH file decided, rather than leaving
        // somebody to work out why the board is talking to an address that is not
        // in the image.
        sourceFrom: override === undefined ? "image" : "override",
    };
}
function readImageVersion(path) {
    try {
        return /^KITLUY_IMAGE_VERSION=(.+)$/m.exec(readFileSync(path, "utf8"))?.[1]?.trim();
    }
    catch {
        return undefined;
    }
}
function emit(event, fields) {
    const parts = Object.entries(fields).map(([key, value]) => `${key}=${typeof value === "string" ? JSON.stringify(value) : String(value)}`);
    process.stdout.write(`event=${event} agent=${SERVICE_VERSION} ${parts.join(" ")}\n`);
}
/**
 * One poll. Reports the preconditions, then — when they are met — the release
 * status, so that `journalctl -u kitluy-update-agent` answers "what is running
 * and why" without anybody opening a JSON file or an SSH session (U1 req 4).
 *
 * Reporting only. `runOnce` below is what actually installs — the two are
 * separate so this one stays callable without a network, which is how it is
 * tested.
 */
export function reportOnce(options = {}) {
    const state = evaluatePreconditions(options);
    if (state.kind !== "ready") {
        emit("kitluy.update.bootstrap", { state: state.kind, detail: state.detail });
        return state;
    }
    const environment = readImageEnv("KITLUY_ENVIRONMENT", options.etcRoot);
    const registry = loadReleaseTrustRegistry({ trustDir: options.trustDir, environment });
    if (registry.keys.length === 0) {
        // Anchors are PRESENT but none survived the purpose/environment checks. That
        // is a different fault from having none at all, and saying so is the
        // difference between a five-minute fix and an evening.
        emit("kitluy.update.bootstrap", {
            state: "no_usable_trust_anchor",
            detail: "every trust record was refused",
            rejected: registry.rejected.map((r) => `${r.file}:${r.refusal}`).join(","),
        });
        return { kind: "no_trust_anchor", detail: "every trust record was refused" };
    }
    const products = productsOnThisImage(options.unitDirectories);
    if (products.length === 0) {
        emit("kitluy.update.status", {
            imageVersion: state.imageVersion,
            source: state.source,
            sourceFrom: state.sourceFrom,
            trustedKeys: registry.keys.length,
            products: "none",
            status: "this image defines no updatable application unit",
        });
        return state;
    }
    for (const product of products) {
        const paths = storePaths(product, options.storeRoot);
        const status = describeReleaseStatus(paths, {
            runningSourcePath: options.runningSourcePath ?? RELEASE_PRODUCTS[product].runningSourcePath,
        });
        emit("kitluy.update.status", {
            product,
            imageVersion: state.imageVersion,
            source: state.source,
            sourceFrom: state.sourceFrom,
            trustedKeys: registry.keys.length,
            status: formatReleaseStatusLine(status),
        });
    }
    return state;
}
/**
 * ONE poll: report, then — when the preconditions hold — actually try to install.
 *
 * This is the step that was missing. The agent reported `ready` for ever and
 * never installed, because nothing composed the install pass. Keeping `runOnce`
 * exported means the composition can be asserted about in a test rather than
 * existing only inside a `for(;;)` nobody can call.
 */
export async function runOnce(options = {}) {
    const state = reportOnce(options);
    if (state.kind !== "ready")
        return;
    // One product at a time, Device Shell first: a POS pass holds the health gate
    // for up to five minutes, and the screen that recovers a board must not wait
    // behind the application it would recover.
    for (const product of productsOnThisImage(options.unitDirectories)) {
        const composed = composeInstallDependencies({
            baseUrl: state.source,
            product,
            etcRoot: options.etcRoot,
            trustDir: options.trustDir,
            storeRoot: options.storeRoot,
            registrationStatePath: options.registrationStatePath,
        });
        if (!composed.ok) {
            // A board that is not yet registered, or carries no usable anchor, is a
            // NORMAL resting state early in a device's life — not an error to shout
            // about every five minutes. It is still named, because "not updating" with
            // no reason given is what costs an afternoon. The refusal is the same for
            // every product, so it is said once.
            emit("kitluy.update.waiting", { reason: composed.refusal, detail: composed.detail });
            return;
        }
        if (product === TERMINAL_CLIENT_PRODUCT) {
            const paths = storePaths(product, options.storeRoot);
            const firstInstall = readJournal(paths).committed === null;
            if (firstInstall && terminalPinSetupPending(options.edgeStatusPath)) {
                emit("kitluy.update.waiting", {
                    product,
                    reason: "TERMINAL_PIN_SETUP_PENDING",
                    detail: "the Store Hub says this terminal has no PIN yet; the application installs once it is created on the Shell",
                });
                continue;
            }
        }
        const result = await runInstallPass(composed.deps);
        emit("kitluy.update.pass", { product, outcome: result.outcome, ...describeOutcome(result) });
    }
    if (productsOnThisImage(options.unitDirectories).includes(TERMINAL_CLIENT_PRODUCT)) {
        const started = startInstalledTerminalClientOnce({ storeRoot: options.storeRoot });
        if (started.action !== "NOT_NEEDED")
            emit("kitluy.update.terminal-client", { ...started });
    }
}
const runSystemctl = (args) => {
    try {
        return {
            ok: true,
            output: execFileSync("systemctl", [...args], { encoding: "utf8", timeout: 20_000 }).trim(),
        };
    }
    catch (error) {
        const out = error.stdout;
        return { ok: false, output: typeof out === "string" ? out.trim() : "" };
    }
};
let terminalClientStartAttempted = false;
/** Tests only: forget that this process already tried. */
export function resetTerminalClientStartForTests() {
    terminalClientStartAttempted = false;
}
/**
 * BRING AN INSTALLED POS UP AT BOOT — ONCE.
 *
 * `kitluy-terminal-client.service` is deliberately NOT wanted by any target:
 * the image cannot know whether a POS is installed, and a unit that started on
 * every boot would take the display from the Device Shell on a board that has
 * nothing to show. The install pass starts it (restart, then the health gate);
 * after a reboot, this does — and only when the store holds a usable release
 * that is not in the middle of an activation.
 *
 * ONCE PER AGENT PROCESS. The unit's `OnFailure=` hands the display back to the
 * Device Shell when the POS cannot run. Trying again on every poll would take it
 * straight back, every five minutes, from the one screen that can explain the
 * problem. A new release (the install pass) or a reboot is what tries again.
 */
export function startInstalledTerminalClientOnce(options = {}) {
    if (terminalClientStartAttempted) {
        return { action: "NOT_NEEDED", detail: "already attempted by this agent process" };
    }
    const paths = storePaths(TERMINAL_CLIENT_PRODUCT, options.storeRoot);
    const releaseId = activeReleaseId(paths);
    if (releaseId === null)
        return { action: "NOT_NEEDED", detail: "no POS release is installed" };
    const phase = readJournal(paths).phase;
    if (phase === "ACTIVATING" || phase === "HEALTH_PENDING") {
        return { action: "NOT_NEEDED", detail: `an activation owns the unit (${phase})` };
    }
    terminalClientStartAttempted = true;
    const systemctl = options.systemctl ?? runSystemctl;
    const unit = RELEASE_PRODUCTS[TERMINAL_CLIENT_PRODUCT].unit;
    const state = systemctl(["is-active", unit]).output;
    if (state === "active" || state === "activating") {
        return { action: "NOT_NEEDED", detail: `${unit} is already ${state}` };
    }
    // --no-block: the unit takes the display from the Device Shell (Conflicts=),
    // and waiting on that here would stall the next poll behind a compositor.
    const started = systemctl(["start", "--no-block", unit]);
    return started.ok
        ? { action: "STARTED", releaseId }
        : {
            action: "START_FAILED",
            releaseId,
            detail: started.output || `systemctl start ${unit} failed`,
        };
}
function describeOutcome(result) {
    if (result.outcome === "INSTALLED")
        return { releaseId: result.releaseId, version: result.version };
    if (result.outcome === "ROLLED_BACK")
        return { releaseId: result.releaseId, reason: result.reason };
    if (result.outcome === "REFUSED")
        return { code: result.code, detail: result.detail };
    return { detail: result.detail };
}
export async function main() {
    for (;;) {
        try {
            await runOnce();
        }
        catch (error) {
            // A fault in one pass must never stop the agent: the next poll may be the
            // one that installs something.
            emit("kitluy.update.error", { detail: String(error.message ?? error) });
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_SECONDS * 1000));
    }
}
if (process.argv[1] !== undefined && process.argv[1].includes("update-bootstrap"))
    void main();
//# sourceMappingURL=update-bootstrap.js.map