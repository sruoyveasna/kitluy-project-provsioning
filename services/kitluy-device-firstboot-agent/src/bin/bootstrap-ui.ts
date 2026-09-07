/**
 * `/usr/lib/kitluy/terminal-bootstrap-ui` — the unassigned-terminal status
 * screen on tty1, Factory Enrollment edition.
 *
 * Authority: KLD-2026-09-03-FACTORY-ENROLLMENT-001 §4 Phase A and §5.
 *
 * ===========================================================================
 * WHAT THIS SHOWS, AND WHAT IT REFUSES TO SHOW
 * ===========================================================================
 * The device's own Factory Enrollment truth: its id, whether KitLuy has seen
 * it, whether an Admin has approved it, and that it is NOT assigned to a Store.
 * The Store row is a constant on a terminal today for the same reason the Hub
 * console derives it — no pairing state exists on a terminal yet, and a screen
 * must never invent an assignment it cannot see. When terminal pairing arrives
 * (a later slice), the row becomes derived, as `hub-pairing-ui.ts` does.
 *
 * It takes no input. There is no pairing-code prompt, no POS surface and no
 * path to a business application: an enrollment-approved terminal is
 * recognised and eligible for provisioning, nothing more.
 *
 * Absent values render as "Unknown", never as a plausible guess: a screen that
 * invents "Connected" because it has no data is worse than one that admits it.
 *
 * ===========================================================================
 * WHY IT READS registration-state.json, NOT ONLY bootstrap-state.json
 * ===========================================================================
 * The flash-time ticket agent, which wrote `bootstrap-state.json`, is retired
 * from the terminal image: it landed a device in `enrolled` with no Admin
 * decision. Cloud registration writes `registration-state.json` instead, and a
 * screen that only read the old file would say "Unknown" for ever on every
 * terminal built after this change. Both are read; registration wins the rows
 * it knows about.
 */
import { hasDefaultRoute, readBootstrapState, type BootstrapState } from "../bootstrap-state.js";
import { readImageEnv } from "../image-env.js";
import {
  assetTagFromFingerprint,
  readRegistrationState,
  registrationHeadline,
  registrationPhaseLabel,
  type RegistrationState,
} from "../registration-state.js";
import { SERVICE_VERSION } from "../version.js";

const CLEAR_SCREEN = "\x1b[2J\x1b[H";

/** The owner's Phase A wording, verbatim where the rule quotes it. */
export const NOT_ASSIGNED_LINE = "This Terminal has not yet been assigned to a Store.";
export const PAIRING_UNAVAILABLE_LINE =
  "Pairing is not available in this build; Store assignment arrives with a later release.";

export interface RenderOptions {
  /**
   * Route-level reachability, read directly by the caller. Used only when no
   * agent has recorded network state, so the row can still say something true
   * on an image where the ticket agent (which wrote it) no longer exists.
   */
  readonly networkUp?: boolean;
  readonly now?: Date;
  /**
   * `KITLUY_IMAGE_VERSION` from /etc/kitluy/image.env, read by the caller. The
   * first terminal boot showed "Image version ..... Unknown" because the row
   * only knew the retired ticket agent's file; the image itself always knew.
   */
  readonly imageVersion?: string;
}

export function render(
  bootstrap: BootstrapState | null,
  registration: RegistrationState | null,
  options: RenderOptions = {},
): string {
  const now = options.now ?? new Date();

  const network =
    bootstrap !== null
      ? bootstrap.networkReady
        ? "Connected"
        : "Offline"
      : options.networkUp === undefined
        ? "Unknown"
        : options.networkUp
          ? "Connected"
          : "Offline";

  // KitLuy registration is the terminal's Factory Enrollment axis: a board can
  // be registered and unapproved, or approved and unpaired. Rendered as its own
  // row so an operator is never shown "Not enrolled" for a device that has in
  // fact reached KitLuy and is waiting on a human decision.
  const kitluy = registration === null ? "Unknown" : registrationPhaseLabel(registration.phase);

  // The name the Admin Portal lists: the asset tag derived from the
  // registration key, exactly as the client sent it. The opaque cloud id is
  // kept as a second row — contract §9 makes it the one identifier a pending
  // device is guaranteed to hold, and it grants nothing. The ticket-path label
  // is shown only when no registration has named the board.
  const assetTag =
    registration?.keyFingerprint === undefined
      ? bootstrap?.deviceLabel
      : assetTagFromFingerprint(registration.keyFingerprint);
  const deviceRows = [
    ...(assetTag === undefined ? [] : [`  Device ............ ${assetTag}`]),
    ...(registration?.deviceId === undefined
      ? []
      : [`  Cloud id .......... ${registration.deviceId}`]),
  ];

  // Pending approval is a HEALTHY waiting condition, not a failure, and the
  // headline says whether to wait or act. An approved device additionally gets
  // the owner's Phase A wording so nobody reads "Approved" as "ready".
  const noteRows =
    registration === null
      ? []
      : registration.phase === "APPROVED"
        ? [`  ${NOT_ASSIGNED_LINE}`, `  ${PAIRING_UNAVAILABLE_LINE}`, ""]
        : [`  ${registrationHeadline(registration.phase)}`, ""];

  return [
    "",
    "  KitLuy Terminal",
    "  ===============",
    "",
    ...deviceRows,
    `  KitLuy ............ ${kitluy}`,
    "  Store ............. Unassigned",
    `  Network ........... ${network}`,
    `  Image version ..... ${options.imageVersion ?? bootstrap?.imageVersion ?? "Unknown"}`,
    `  Agent version ..... ${bootstrap?.agentVersion ?? SERVICE_VERSION}`,
    "",
    ...noteRows,
    ...(bootstrap?.detail === undefined ? [] : [`  ${bootstrap.detail}`, ""]),
    `  Updated ${registration?.updatedAt ?? bootstrap?.updatedAt ?? now.toISOString()}`,
    "",
  ].join("\n");
}

export async function main(): Promise<void> {
  for (;;) {
    process.stdout.write(CLEAR_SCREEN);
    process.stdout.write(
      render(readBootstrapState(), readRegistrationState(), {
        networkUp: hasDefaultRoute(),
        imageVersion: readImageEnv("KITLUY_IMAGE_VERSION"),
      }),
    );
    await new Promise((r) => setTimeout(r, 5000));
  }
}

if (process.argv[1] !== undefined && process.argv[1].includes("bootstrap-ui")) void main();
