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
 *     KitLuy ............ Approved
 *     Store ............. Unassigned
 *
 *     Enter pairing code:
 *     > __________
 *
 * A `Fleet` row appears only for a device that enrolled through the older
 * flash-time ticket path. A Store Hub reaches the fleet through cloud
 * registration, so it shows `KitLuy` and no `Fleet` row at all — printing both
 * read as a contradiction on real hardware.
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

import { readBootstrapState, type BootstrapState } from "../bootstrap-state.js";
import { readImageEnv } from "../image-env.js";
import {
  pairingBelongsTo,
  readPairingState,
  writePairingState,
  type PairingState,
} from "../pairing-state.js";
import {
  readRegistrationState,
  registrationHeadline,
  type RegistrationState,
} from "../registration-state.js";

const CLEAR_SCREEN = "[2J[H";

/** The canonical alphabet, mirrored from `hub_claim_code_alphabet_v1()`. */
const CROCKFORD = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/**
 * What the cloud answered. `result` is the COARSE code `/v1/hub-pairing` puts in
 * `details.result`; the route never sends an internal cause and this never asks
 * for one.
 */
export interface PairingAttempt {
  readonly status: number;
  readonly result?: string;
  readonly assignmentId?: string;
  readonly tenantId?: string;
  readonly digitalStoreId?: string;
  readonly storeLocationId?: string;
  readonly retryAfterSeconds?: number;
}

export interface PairingTransport {
  submit(input: {
    readonly deviceRecordId: string;
    readonly code: string;
  }): Promise<PairingAttempt>;
}

/**
 * The screen, as a pure function of state so it is testable without a tty.
 *
 * Absent values render as "Unknown", never as a plausible guess — the discipline
 * `bootstrap-ui.ts` records. A screen that invents "Enrolled" because it has no
 * data is worse than one that admits it does not know.
 */
export function render(
  bootstrap: BootstrapState | null,
  pairing: PairingState | null,
  message?: string,
  /**
   * Cloud registration, when this image has it. Optional and LAST so every
   * existing caller and test keeps working — an image built before registration
   * existed renders exactly as it did.
   */
  registration?: RegistrationState | null,
): string {
  const device = bootstrap?.deviceLabel ?? "Unknown";

  /**
   * The ticket-based enrolment row, shown ONLY to a device that took that path.
   *
   * A Store Hub reaches the fleet through cloud registration and never presents
   * a flash-time ticket, so this row read `Not enrolled` directly beneath
   * `KitLuy ... Approved` — two rows that look like a contradiction to anyone
   * who has not been told there are two enrolment paths. Observed on real
   * hardware, and it cost an operator a worried question.
   *
   * With the ticket agent retired from this image (plan §5.3) there is no
   * `bootstrap-state.json` at all, so the row would degrade to `Unknown` — no
   * better. It is therefore omitted entirely unless the device actually holds a
   * ticket-path identity, which a Pi terminal still does.
   */
  const fleet = bootstrap?.deviceRecordId !== undefined ? "Enrolled" : null;

  // The Store line is DERIVED, never hardcoded. It also refuses to speak for a
  // pairing that belongs to a different device record — a copied card carries a
  // stale file, and rendering it would tell an operator their Hub is assigned to
  // a Store it has never spoken to.
  // The SAME resolution the prompt uses. Asking only `bootstrap` here meant a
  // Hub that reached the fleet through the CLOUD path never recognised its own
  // pairing: the assignment existed, the state file said PAIRED, and the screen
  // still read "Unassigned" because it was comparing against an id that device
  // never had. Observed on real hardware immediately after the first successful
  // pairing.
  const mine = pairingBelongsTo(pairing, resolvePairableDeviceId(bootstrap, registration ?? null));
  const store = !mine
    ? "Unassigned"
    : pairing?.phase === "PAIRED"
      ? "Assigned (awaiting trust)"
      : pairing?.phase === "LOCKED"
        ? "Unassigned (code locked)"
        : "Unassigned";

  // KitLuy registration is a THIRD axis, not a step on the fleet line: a board
  // can be registered and unapproved, or approved and unpaired. Rendered as its
  // own row so an operator is never shown "Not enrolled" for a device that has
  // in fact reached KitLuy and is waiting on a human decision.
  const registrationLine =
    registration === undefined || registration === null
      ? undefined
      : registrationPhaseLabel(registration.phase);

  // Deliberately NOT rendered as a failure. Plan §3.3: pending approval is a
  // healthy waiting condition, and the headline says whether to wait or act.
  const registrationNote =
    registration === undefined || registration === null || registration.phase === "APPROVED"
      ? []
      : [`  ${registrationHeadline(registration.phase)}`, ""];

  return [
    "",
    "  KitLuy Store Hub",
    "",
    `  Device ............ ${device}`,
    ...(registrationLine === undefined ? [] : [`  KitLuy ............ ${registrationLine}`]),
    ...(fleet === null ? [] : [`  Fleet ............. ${fleet}`]),
    `  Store ............. ${store}`,
    "",
    // The id an admin needs to be quoted over the phone. Contract §9 makes this
    // the one identifier a pending device receives, precisely so it can be read
    // out loud; it is opaque and grants nothing.
    ...(registration?.deviceId === undefined
      ? []
      : [`  Device id ......... ${registration.deviceId}`, ""]),
    ...registrationNote,
    ...(message === undefined ? [] : [`  ${message}`, ""]),
  ].join("\n");
}

/** Short status word for the KitLuy row. The headline carries the explanation. */
function registrationPhaseLabel(phase: RegistrationState["phase"]): string {
  switch (phase) {
    case "NOT_REGISTERED":
      return "Not registered";
    case "REGISTERING":
      return "Registering";
    case "AWAITING_APPROVAL":
      return "Waiting for approval";
    case "TRUST_REVIEW_REQUIRED":
      return "Trust review required";
    case "APPROVED":
      return "Approved";
    case "CONTAINED":
      return "Stopped by KitLuy";
    case "UNREACHABLE":
      return "No connection";
  }
}

/**
 * The device id this Hub may pair with, from EITHER enrolment path.
 *
 * ===========================================================================
 * WHY THE CLOUD PATH COUNTS, AND ONLY WHEN APPROVED
 * ===========================================================================
 * Pairing needs one thing before it can begin: a device id the fleet already
 * recognises. Historically that came only from `bootstrap-state.json`, written
 * by the ticket-based fleet enrolment agent. A board that reached the fleet the
 * NEW way — registering itself to the cloud and being approved by HET — has
 * exactly the same standing and a `deviceId` to prove it, but wrote it to a
 * different file. Without this, an approved Hub sat on "Waiting for fleet
 * enrolment" for ever while the cloud held it as `enrolled`.
 *
 * `APPROVED` is the only registration phase accepted, deliberately.
 * `AWAITING_APPROVAL` means HET has NOT yet admitted this board, and letting it
 * pair would make the approval gate decorative — the device would be attaching
 * itself to a Store while still untrusted, which is the whole thing
 * KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001 exists to prevent.
 *
 * Bootstrap state wins when both exist: it is the older, ticket-backed path, and
 * a device holding both should present the identity it enrolled with.
 */
export function resolvePairableDeviceId(
  bootstrap: BootstrapState | null,
  registration: RegistrationState | null,
): string | undefined {
  if (bootstrap?.deviceRecordId !== undefined) return bootstrap.deviceRecordId;
  if (registration?.phase === "APPROVED" && typeof registration.deviceId === "string") {
    return registration.deviceId;
  }
  return undefined;
}

/**
 * Turn one cloud answer into what the operator is told and what is recorded.
 *
 * Pure, so every branch is testable — including the ones a live device would take
 * only rarely, which are exactly the ones that go untested otherwise.
 */
export function interpret(
  attempt: PairingAttempt,
  deviceRecordId: string,
): { readonly message: string; readonly state: PairingState | null; readonly done: boolean } {
  const now = new Date().toISOString();

  if (attempt.status === 200 && attempt.result === undefined) {
    // The success body carries no `details.result`; it carries the assignment.
    return {
      message:
        "Paired. This Hub is assigned to its Store and awaiting trust — it cannot serve terminals until activation.",
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
        message:
          "Paired. This Hub is assigned to its Store and awaiting trust — it cannot serve terminals until activation.",
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
        message:
          "Too many failed attempts. This code is locked — generate a NEW pairing code in the Partner Portal.",
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
        message:
          "That code could not be redeemed. Generate a new pairing code in the Partner Portal.",
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
export function createPairingTransport(options: {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
}): PairingTransport {
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
        let body: Record<string, unknown> = {};
        try {
          body = (await response.json()) as Record<string, unknown>;
        } catch {
          /* a body-less refusal is still an answer */
        }
        const details = body.details as { result?: unknown } | undefined;
        return {
          status: response.status,
          result: typeof details?.result === "string" ? details.result : undefined,
          assignmentId: typeof body.assignmentId === "string" ? body.assignmentId : undefined,
          tenantId: typeof body.tenantId === "string" ? body.tenantId : undefined,
          digitalStoreId: typeof body.digitalStoreId === "string" ? body.digitalStoreId : undefined,
          storeLocationId:
            typeof body.storeLocationId === "string" ? body.storeLocationId : undefined,
          retryAfterSeconds: retryAfter === null ? undefined : Number(retryAfter),
        };
      } catch {
        // Transport failure is reported as a status this program understands
        // rather than thrown: the console must stay up and keep prompting.
        return { status: 0 };
      } finally {
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
/**
 * What an operator typed, reduced to what the protocol actually is.
 *
 * ===========================================================================
 * THE DEFECT THIS FIXES, OBSERVED ON REAL HARDWARE
 * ===========================================================================
 * The Partner Portal renders an issued code GROUPED for readability —
 * `groupCode()` puts a space after the fourth character, so the screen shows
 * `4A5M MGSC`. The operator reads that, types it exactly as shown, and the
 * console refused it: `trim()` removes surrounding whitespace but not the space
 * in the middle, so the string was nine characters and failed the length check.
 *
 * Both halves were individually reasonable and together they were broken. The
 * grouping is PRESENTATION; the code is eight characters. Hyphens are stripped
 * too, because a person copying a code by hand writes the separator they are
 * used to, and refusing them teaches nothing.
 *
 * This only makes the input more forgiving. The alphabet check below is
 * unchanged, so a genuinely wrong code is still refused before any round trip.
 */
export function normalisePairingCode(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function looksLikeCode(raw: string): boolean {
  return CROCKFORD.test(normalisePairingCode(raw));
}

export async function main(): Promise<void> {
  const baseUrl = readImageEnv("KITLUY_ENROLLMENT_BASE_URL");
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (;;) {
      const bootstrap = readBootstrapState();
      const registration = readRegistrationState();
      const pairing = readPairingState();
      const deviceRecordId = resolvePairableDeviceId(bootstrap, registration);

      // Already paired for THIS device: render and stop prompting. Re-presenting
      // a consumed claim is the mistake enrolment already learned once.
      if (pairingBelongsTo(pairing, deviceRecordId) && pairing?.phase === "PAIRED") {
        process.stdout.write(CLEAR_SCREEN);
        process.stdout.write(render(bootstrap, pairing, undefined, registration));
        // DO NOT RETURN. The unit is `Restart=always`, so exiting on success made
        // systemd restart the console every few seconds — the restart counter
        // reached 50 within minutes of the first real pairing, and the screen
        // redrew constantly. Staying alive also lets the display follow a later
        // change (revocation, re-assignment) without a reboot.
        await new Promise((r) => setTimeout(r, 15_000));
        continue;
      }

      process.stdout.write(CLEAR_SCREEN);
      process.stdout.write(render(bootstrap, pairing, undefined, registration));

      if (deviceRecordId === undefined) {
        // Not admitted yet. Pairing cannot start, and inviting a code would be
        // asking for something that cannot possibly work.
        //
        // The reason is taken from the registration state when there is one, so
        // an operator is told WHICH wait they are in — "waiting for HET
        // approval" is a healthy resting state with a person at the other end,
        // and reporting it as "waiting for fleet enrolment" would send them
        // looking for a fault in the wrong system.
        process.stdout.write(
          registration === null
            ? "\n  Waiting for fleet enrolment before pairing can begin.\n\n"
            : `\n  ${registrationHeadline(registration.phase)}\n\n`,
        );
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
        process.stdout.write(
          "\n  A pairing code is 8 characters, letters and digits (no I, L, O or U).\n" +
            "  Spaces and dashes are ignored, so type it exactly as the Portal shows it.\n\n",
        );
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }

      const outcome = interpret(
        await createPairingTransport({ baseUrl }).submit({
          deviceRecordId,
          code: normalisePairingCode(answer),
        }),
        deviceRecordId,
      );
      if (outcome.state !== null) writePairingState(outcome.state);

      process.stdout.write(CLEAR_SCREEN);
      process.stdout.write(
        render(readBootstrapState(), readPairingState(), outcome.message, readRegistrationState()),
      );
      if (outcome.done) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
  } finally {
    rl.close();
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes("hub-pairing-ui")) void main();
