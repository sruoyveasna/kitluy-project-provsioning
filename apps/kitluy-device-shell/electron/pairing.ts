/**
 * The pairing action: what happens when someone finishes typing eight characters.
 *
 * Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 §6–§7; the route contract
 *   in the registry's `terminal-pairing-routes.ts`.
 *
 * ===========================================================================
 * WHY THE TRANSPORT IS INJECTED
 * ===========================================================================
 * On a device the transport is the firstboot agent's packaged
 * `http-terminal-pairing-client.js`, which the image installs under
 * `/usr/lib/kitluy/lib/firstboot-agent/`. That path exists only on a Pi, so
 * hard-wiring it would make this function untestable off-device and would tie
 * the shell's behaviour to the packager's layout. The caller supplies the
 * transport; `main.ts` supplies the real one, the tests supply a fake, and the
 * decision about how the shell reaches the agent's closure stays in packaging
 * where it belongs.
 *
 * ===========================================================================
 * WHAT THIS FUNCTION IS ALLOWED TO SAY
 * ===========================================================================
 * A status code, and nothing that could be mistaken for authority. It never
 * returns the Store to the renderer beyond what the next snapshot will show
 * anyway, never returns a certificate, and never returns the code. `PAIRED` here
 * means the cloud created an assignment — `pending_trust`, not active.
 */
import type { TerminalAssignment } from "./terminal-assignment.js";

/** The subset of the agent's client this action needs. Structural, not nominal. */
export interface PairingTransport {
  pair(input: { deviceRecordId: string; code: string }): Promise<PairingTransportResult>;
}

export type PairingTransportResult =
  | {
      readonly kind: "paired";
      readonly deviceRecordId: string;
      readonly assignmentId: string;
      readonly assignmentGeneration: number;
      readonly activated: boolean;
      readonly context: {
        readonly digitalStoreReference: string;
        readonly storeLocationReference: string;
        readonly physicalTerminalLabel: string;
        readonly terminalProfileKeys: readonly string[];
      };
    }
  | {
      readonly kind: "refused";
      readonly result: string;
      readonly retryable: boolean;
      readonly message: string;
    };

export interface SubmitOutcome {
  /** `PAIRED`, or the registry's refusal code. Rendered, never interpreted as authority. */
  readonly status: string;
  /** True when presenting the same code again could still succeed. */
  readonly retryable?: boolean;
  /** The server's safe operator sentence. Never contains the code. */
  readonly message?: string;
}

export interface PairingDependencies {
  readonly transport: PairingTransport;
  /** The board's own record id, from `bootstrap-state.json`. */
  readonly deviceRecordId: string | undefined;
  readonly persist: (assignment: TerminalAssignment) => void;
  readonly now?: () => Date;
}

export const NOT_REGISTERED = "NO_DEVICE_RECORD";
export const PERSIST_FAILED = "PAIRING_NOT_RECORDED";

/**
 * Present a code and, if the cloud accepts it, record the seat it granted.
 *
 * A pairing that the cloud accepted but the device failed to WRITE is reported
 * as `PAIRING_NOT_RECORDED` rather than as success. The seat is real — the
 * server made it — but this board cannot prove it after a reboot, and telling
 * the installer "done" would send them away from a terminal that will show an
 * empty keypad tomorrow. The refusal is non-retryable on purpose: presenting the
 * same code again cannot help, because the session has already been consumed.
 */
export async function submitPairingCode(
  code: string,
  deps: PairingDependencies,
): Promise<SubmitOutcome> {
  if (deps.deviceRecordId === undefined || deps.deviceRecordId.trim() === "") {
    return {
      status: NOT_REGISTERED,
      retryable: true,
      message: "this board has not finished registering yet",
    };
  }

  const result = await deps.transport.pair({ deviceRecordId: deps.deviceRecordId, code });
  if (result.kind === "refused") {
    return { status: result.result, retryable: result.retryable, message: result.message };
  }

  const now = (deps.now ?? (() => new Date()))();
  try {
    deps.persist({
      deviceRecordId: result.deviceRecordId,
      assignmentId: result.assignmentId,
      assignmentGeneration: result.assignmentGeneration,
      activated: result.activated,
      digitalStoreReference: result.context.digitalStoreReference,
      storeLocationReference: result.context.storeLocationReference,
      physicalTerminalLabel: result.context.physicalTerminalLabel,
      terminalProfileKeys: result.context.terminalProfileKeys,
      updatedAt: now.toISOString(),
    });
  } catch {
    return {
      status: PERSIST_FAILED,
      retryable: false,
      message: "the seat was granted but could not be saved on this device",
    };
  }

  return { status: "PAIRED" };
}
