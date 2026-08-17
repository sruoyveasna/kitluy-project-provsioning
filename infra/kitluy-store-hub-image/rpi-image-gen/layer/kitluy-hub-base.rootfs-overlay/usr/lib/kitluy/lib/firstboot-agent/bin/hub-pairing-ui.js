/**
 * `/usr/lib/kitluy/hub-pairing-ui` — the Store Hub setup console.
 *
 * ===========================================================================
 * WHAT THIS IS
 * ===========================================================================
 * The screen the owner decision §2.3 mandates, rendered verbatim on tty1, with a
 * prompt an operator types a pairing code into:
 *
 *     KitLuy Store Hub
 *
 *     Device ............ KL-1A2B3C4D
 *     Fleet ............. Enrolled
 *     Store ............. Unassigned
 *
 *     Enter pairing code:
 *     > __________
 *
 * ===========================================================================
 * WHY THIS IS NOT `bootstrap-ui.ts`
 * ===========================================================================
 * That program is the Pi Terminal's status screen and it says so — it titles
 * itself "KitLuy Terminal" and hardcodes `Store assignment .. Unassigned`. On a
 * Hub the title is wrong, and the hardcoded line becomes a LIE the moment the Hub
 * pairs. A status surface that lies is worse than no surface, because an operator
 * cannot tell which parts to believe.
 *
 * It is also read-only by design (its unit ships `ReadOnlyPaths=/var/lib/kitluy`),
 * and pairing writes state. Two different jobs, two programs.
 *
 * ===========================================================================
 * WHAT IT REFUSES TO CLAIM
 * ===========================================================================
 * Pairing ends at ASSIGNED, never ACTIVE. `redeem_device_claim_v1` leaves the
 * device at `awaiting_trust` on purpose: activation is certificate-backed and
 * gated on BLK-005. So a paired Hub is reported as assigned and awaiting trust,
 * and the screen never says "ready" — a Hub that cannot yet serve a terminal must
 * not tell a shop that it can.
 *
 * The presented code is never logged, never written to state, and never echoed
 * back in an error. Eight characters of Crockford Base32 is a searchable space;
 * a code that reaches a log file is a code an attacker can read later.
 *
 * Zero runtime dependencies — `readline/promises` is a Node built-in, and
 * `package-bootstrap-runtime.sh` refuses the build if this closure ever gains a
 * dependency.
 */
import { createInterface } from "node:readline/promises";
import { readBootstrapState } from "../bootstrap-state.js";
import { readImageEnv } from "../image-env.js";
import { pairingBelongsTo, readPairingState, writePairingState, } from "../pairing-state.js";
const CLEAR_SCREEN = "[2J[H";
/** The canonical alphabet, mirrored from `hub_claim_code_alphabet_v1()`. */
const CROCKFORD = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;
/**
 * The screen, as a pure function of state so it is testable without a tty.
 *
 * Absent values render as "Unknown", never as a plausible guess — the discipline
 * `bootstrap-ui.ts` records. A screen that invents "Enrolled" because it has no
 * data is worse than one that admits it does not know.
 */
export function render(bootstrap, pairing, message) {
    const device = bootstrap?.deviceLabel ?? "Unknown";
    const fleet = bootstrap === null ? "Unknown" : bootstrap.deviceRecordId !== undefined ? "Enrolled" : "Not enrolled";
    // The Store line is DERIVED, never hardcoded. It also refuses to speak for a
    // pairing that belongs to a different device record — a copied card carries a
    // stale file, and rendering it would tell an operator their Hub is assigned to
    // a Store it has never spoken to.
    const mine = pairingBelongsTo(pairing, bootstrap?.deviceRecordId);
    const store = !mine
        ? "Unassigned"
        : pairing?.phase === "PAIRED"
            ? "Assigned (awaiting trust)"
            : pairing?.phase === "LOCKED"
                ? "Unassigned (code locked)"
                : "Unassigned";
    return [
        "",
        "  KitLuy Store Hub",
        "",
        `  Device ............ ${device}`,
        `  Fleet ............. ${fleet}`,
        `  Store ............. ${store}`,
        "",
        ...(message === undefined ? [] : [`  ${message}`, ""]),
    ].join("\n");
}
/**
 * Turn one cloud answer into what the operator is told and what is recorded.
 *
 * Pure, so every branch is testable — including the ones a live device would take
 * only rarely, which are exactly the ones that go untested otherwise.
 */
export function interpret(attempt, deviceRecordId) {
    const now = new Date().toISOString();
    if (attempt.status === 200 && attempt.result === undefined) {
        // The success body carries no `details.result`; it carries the assignment.
        return {
            message: "Paired. This Hub is assigned to its Store and awaiting trust — it cannot serve terminals until activation.",
            state: {
                phase: "PAIRED",
                detail: "assigned to the Store and awaiting trust",
                assignmentId: attempt.assignmentId,
                tenantId: attempt.tenantId,
                digitalStoreId: attempt.digitalStoreId,
                storeLocationId: attempt.storeLocationId,
                deviceRecordId,
                updatedAt: now,
            },
            done: true,
        };
    }
    switch (attempt.result) {
        case "PAIRED":
            return {
                message: "Paired. This Hub is assigned to its Store and awaiting trust — it cannot serve terminals until activation.",
                state: {
                    phase: "PAIRED",
                    detail: "assigned to the Store and awaiting trust",
                    assignmentId: attempt.assignmentId,
                    tenantId: attempt.tenantId,
                    digitalStoreId: attempt.digitalStoreId,
                    storeLocationId: attempt.storeLocationId,
                    deviceRecordId,
                    updatedAt: now,
                },
                done: true,
            };
        case "LOCKED":
            // The one refusal where retyping is the WRONG action, which is the entire
            // reason the route reports it separately. Saying "try again" here would
            // send someone typing at a claim that can never accept another attempt.
            return {
                message: "Too many failed attempts. This code is locked — generate a NEW pairing code in the Partner Portal.",
                state: {
                    phase: "LOCKED",
                    detail: "the pairing code was locked after five failed attempts",
                    deviceRecordId,
                    updatedAt: now,
                },
                done: true,
            };
        case "CODE_REFUSED":
            return {
                message: "That pairing code is not valid for this device. Check it and try again.",
                state: null,
                done: false,
            };
        case "REDEMPTION_REFUSED":
            return {
                message: "That code could not be redeemed. Generate a new pairing code in the Partner Portal.",
                state: null,
                done: false,
            };
        default:
            if (attempt.status === 429) {
                const wait = attempt.retryAfterSeconds ?? 60;
                return {
                    message: `Too many attempts from this device. Wait ${wait} seconds and try again.`,
                    state: null,
                    done: false,
                };
            }
            if (attempt.status === 503) {
                return {
                    message: "The pairing service is not available from this device yet. Check the network.",
                    state: null,
                    done: false,
                };
            }
            return {
                message: "Pairing could not be completed. Check the network and try again.",
                state: null,
                done: false,
            };
    }
}
/**
 * The transport. Mirrors `adapters/http-enrollment-client.ts`: `fetch` with an
 * `AbortController` deadline, because a Hub console that hangs on a silent socket
 * looks broken to the operator standing in front of it.
 */
export function createPairingTransport(options) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    return {
        async submit(input) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(`${options.baseUrl}/v1/hub-pairing`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ deviceRecordId: input.deviceRecordId, code: input.code }),
                    signal: controller.signal,
                });
                const retryAfter = response.headers.get("retry-after");
                let body = {};
                try {
                    body = (await response.json());
                }
                catch {
                    /* a body-less refusal is still an answer */
                }
                const details = body.details;
                return {
                    status: response.status,
                    result: typeof details?.result === "string" ? details.result : undefined,
                    assignmentId: typeof body.assignmentId === "string" ? body.assignmentId : undefined,
                    tenantId: typeof body.tenantId === "string" ? body.tenantId : undefined,
                    digitalStoreId: typeof body.digitalStoreId === "string" ? body.digitalStoreId : undefined,
                    storeLocationId: typeof body.storeLocationId === "string" ? body.storeLocationId : undefined,
                    retryAfterSeconds: retryAfter === null ? undefined : Number(retryAfter),
                };
            }
            catch {
                // Transport failure is reported as a status this program understands
                // rather than thrown: the console must stay up and keep prompting.
                return { status: 0 };
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
/**
 * Local shape check before anything leaves the device.
 *
 * Deliberately NOT authorization: the cloud re-checks the alphabet and owns the
 * attempt budget. This exists so an obvious typo costs a round trip and, more
 * importantly, does NOT spend one of the operator's five attempts.
 */
export function looksLikeCode(raw) {
    return CROCKFORD.test(raw.trim().toUpperCase());
}
export async function main() {
    const baseUrl = readImageEnv("KITLUY_ENROLLMENT_BASE_URL");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        for (;;) {
            const bootstrap = readBootstrapState();
            const pairing = readPairingState();
            const deviceRecordId = bootstrap?.deviceRecordId;
            // Already paired for THIS device: render and stop prompting. Re-presenting
            // a consumed claim is the mistake enrolment already learned once.
            if (pairingBelongsTo(pairing, deviceRecordId) && pairing?.phase === "PAIRED") {
                process.stdout.write(CLEAR_SCREEN);
                process.stdout.write(render(bootstrap, pairing));
                return;
            }
            process.stdout.write(CLEAR_SCREEN);
            process.stdout.write(render(bootstrap, pairing));
            if (deviceRecordId === undefined) {
                // Not enrolled yet. Pairing cannot start, and inviting a code would be
                // asking for something that cannot possibly work.
                process.stdout.write("\n  Waiting for fleet enrolment before pairing can begin.\n\n");
                await new Promise((r) => setTimeout(r, 5000));
                continue;
            }
            if (baseUrl === undefined) {
                process.stdout.write("\n  No pairing endpoint is configured in this image.\n\n");
                await new Promise((r) => setTimeout(r, 15_000));
                continue;
            }
            const answer = await rl.question("  Enter pairing code:\n  > ");
            if (!looksLikeCode(answer)) {
                process.stdout.write("\n  A pairing code is 8 characters, letters and digits (no I, L, O or U).\n\n");
                await new Promise((r) => setTimeout(r, 2500));
                continue;
            }
            const outcome = interpret(await createPairingTransport({ baseUrl }).submit({
                deviceRecordId,
                code: answer.trim().toUpperCase(),
            }), deviceRecordId);
            if (outcome.state !== null)
                writePairingState(outcome.state);
            process.stdout.write(CLEAR_SCREEN);
            process.stdout.write(render(readBootstrapState(), readPairingState(), outcome.message));
            if (outcome.done)
                return;
            await new Promise((r) => setTimeout(r, 3000));
        }
    }
    finally {
        rl.close();
    }
}
if (process.argv[1] !== undefined && process.argv[1].includes("hub-pairing-ui"))
    void main();
//# sourceMappingURL=hub-pairing-ui.js.map