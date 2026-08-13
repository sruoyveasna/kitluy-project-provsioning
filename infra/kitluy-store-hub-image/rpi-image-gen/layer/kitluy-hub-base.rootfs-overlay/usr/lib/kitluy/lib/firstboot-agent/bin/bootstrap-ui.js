/**
 * `/usr/lib/kitluy/terminal-bootstrap-ui` — the minimal unassigned-terminal
 * surface (§13).
 *
 * Deliberately NOT a second POS shell. It renders device state inside the
 * Wayland session so an operator standing at an unassigned terminal sees the
 * truth instead of a black screen or a restart loop. No Store pairing, no
 * vertical, no Laundry workflow — those belong to the next milestone.
 *
 * Absent values render as "Unknown", never as a plausible guess: a screen that
 * invents "Connected" because it has no data is worse than one that admits it.
 */
import { readBootstrapState } from "../bootstrap-state.js";
import { SERVICE_VERSION } from "../version.js";
const CLEAR_SCREEN = "[2J[H";
export function render(state, now = new Date()) {
    const identity = state === null ? "Unknown" : state.identityReady ? "Ready" : "Initializing";
    const network = state === null ? "Unknown" : state.networkReady ? "Connected" : "Offline";
    const enrolment = state === null
        ? "Unknown"
        : state.deviceRecordId !== undefined
            ? "Enrolled"
            : "Not enrolled";
    return [
        "",
        "  KitLuy Terminal",
        "  ===============",
        "",
        `  Device identity ... ${identity}`,
        `  Network ........... ${network}`,
        `  Fleet enrolment ... ${enrolment}`,
        "  Store assignment .. Unassigned",
        `  Device ............ ${state?.deviceLabel ?? "Unknown"}`,
        `  Image version ..... ${state?.imageVersion ?? "Unknown"}`,
        `  Agent version ..... ${state?.agentVersion ?? SERVICE_VERSION}`,
        "",
        ...(state?.detail === undefined ? [] : [`  ${state.detail}`, ""]),
        `  Updated ${state?.updatedAt ?? now.toISOString()}`,
        "",
    ].join("\n");
}
export async function main() {
    for (;;) {
        process.stdout.write(CLEAR_SCREEN);
        process.stdout.write(render(readBootstrapState()));
        await new Promise((r) => setTimeout(r, 5000));
    }
}
if (process.argv[1] !== undefined && process.argv[1].includes("bootstrap-ui"))
    void main();
//# sourceMappingURL=bootstrap-ui.js.map