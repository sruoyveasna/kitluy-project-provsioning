/**
 * "Is this device paired, and to which fleet record?" — for BOTH device classes.
 *
 * ===========================================================================
 * WHY TWO SOURCES
 * ===========================================================================
 * A Store Hub pairs at its console: `bin/hub-pairing-ui.ts` writes the canonical
 * `/var/lib/kitluy/pairing-state.json`.
 *
 * A Pi Terminal pairs on its GRAPHICAL shell, which runs as `kitluy-terminal`
 * with `ReadWritePaths=/var/lib/kitluy/terminal` and therefore CANNOT write that
 * file — the sandbox is deliberate and is not widened for this. It writes
 * `/var/lib/kitluy/terminal/assignment.json` instead, which already carries the
 * two facts a certificate request needs: the device record id and the assignment
 * generation.
 *
 * So the certificate agent must read whichever its device class actually wrote.
 * Without this a Terminal packaged with `operational-tls` would sit at
 * "waiting: not paired yet" for ever, having paired perfectly well — the same
 * shape of bug as `readDeviceRecordId` reading a retired bootstrap file, found
 * on hardware the same day.
 *
 * ===========================================================================
 * THE HUB'S FILE WINS
 * ===========================================================================
 * Checked first, so a Store Hub's behaviour is byte-for-byte what it was. The
 * terminal file is consulted only when the canonical one says nothing.
 */
import { readPairingState } from "./pairing-state.js";
import { readFileSync } from "node:fs";

/** Where the Device Shell writes a terminal's seat. Mirrors TERMINAL_ASSIGNMENT_PATH. */
export const TERMINAL_ASSIGNMENT_PATH = "/var/lib/kitluy/terminal/assignment.json";

export interface PairedIdentity {
  readonly deviceRecordId: string;
  /** The generation the certificate is requested against; 1 when unstated. */
  readonly assignmentGeneration: number;
  /** Which file answered. Logged, so an operator can see what the device read. */
  readonly source: "hub-pairing-state" | "terminal-assignment";
}

function readTerminalAssignment(path: string): PairedIdentity | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // Absent on a Hub, and on a Terminal that has not paired. Both ordinary.
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const deviceRecordId = (raw as { deviceRecordId?: unknown }).deviceRecordId;
  if (typeof deviceRecordId !== "string" || deviceRecordId === "") return null;
  const generation = (raw as { assignmentGeneration?: unknown }).assignmentGeneration;
  return {
    deviceRecordId,
    assignmentGeneration:
      typeof generation === "number" && Number.isInteger(generation) && generation > 0
        ? generation
        : 1,
    source: "terminal-assignment",
  };
}

/**
 * The paired identity, or null when this device has not paired.
 *
 * `activated` on the terminal file is deliberately NOT consulted: a device asks
 * for a certificate in order to BECOME activated, so requiring activation first
 * would be circular. Activation is the server's decision and it makes it after
 * the certificate exists.
 */
export function readPairedIdentity(
  options: { readonly terminalAssignmentPath?: string } = {},
): PairedIdentity | null {
  const hub = readPairingState();
  if (hub !== null && hub.phase === "PAIRED" && hub.deviceRecordId !== undefined) {
    return {
      deviceRecordId: hub.deviceRecordId,
      // The Hub's own state carries no generation; 1 is what this agent has
      // always used for a Hub, and that behaviour is unchanged.
      assignmentGeneration: 1,
      source: "hub-pairing-state",
    };
  }
  return readTerminalAssignment(options.terminalAssignmentPath ?? TERMINAL_ASSIGNMENT_PATH);
}
