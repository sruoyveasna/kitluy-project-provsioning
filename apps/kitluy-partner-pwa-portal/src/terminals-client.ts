/**
 * Browser client for Provisioning → Terminals.
 *
 * Same transport, same discipline as the Hub client: every call carries the
 * signed-in Partner's token to the Management API, every 200 is re-validated
 * before it becomes data, and a one-time code is handed straight to the caller
 * and kept nowhere. There is no QR: the code is typed on the Pi.
 */
import {
  createManagementRequest,
  type ManagementOutcome,
  type ManagementRequestOptions,
} from "./management-request.js";

export interface TerminalSessionSummary {
  readonly sessionId: string;
  readonly state: string;
  readonly expiresAt: string;
  readonly pairedAt: string | null;
  readonly failedAttemptCount: number;
  readonly locked: boolean;
}

export interface BoundDevice {
  readonly deviceId: string;
  readonly deviceReference: string;
  readonly lifecycle: string;
  readonly assignmentState: string | null;
}

/**
 * What the bound Terminal last reported about its own runtime (Management API,
 * cloud group 0229). DEVICE-REPORTED, aged by the cloud's receipt clock. Absent
 * from an older API, null when never reported — both mean "not reported".
 */
export interface TerminalRuntime {
  readonly source: "device_reported";
  readonly receivedAt: string;
  readonly ageSeconds: number;
  readonly hubLink: null | {
    readonly phase: string;
    readonly hubDeviceId: string | null;
    readonly checkedAt: string;
  };
  readonly application: null | {
    readonly product: string;
    readonly installedReleaseId: string | null;
    readonly installedVersion: string | null;
    readonly journalPhase: string;
    readonly lastOutcome: string | null;
    readonly runningReleaseId: string | null;
    readonly unitActive: boolean;
  };
  readonly pos: null | {
    readonly state: string;
    readonly refusalCode: string | null;
    readonly applicationVersion: string;
    readonly configurationVersion: number | null;
    readonly configurationFreshness: string | null;
    readonly staffSignedIn: boolean;
  };
}

export interface PhysicalTerminal {
  readonly physicalTerminalId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly locationReference: string | null;
  readonly label: string;
  readonly terminalProfileKeys: readonly string[];
  readonly boundDevice: BoundDevice | null;
  readonly lastSession: TerminalSessionSummary | null;
  readonly runtime?: TerminalRuntime | null;
  readonly createdAt: string;
}

export interface TerminalsPage {
  readonly terminals: readonly PhysicalTerminal[];
  readonly count: number;
  readonly dataAsOf?: string;
}

export interface IssuedTerminalCode {
  /** Plaintext, shown ONCE. Never persisted anywhere by this client. */
  readonly code: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
  readonly showOnce: boolean;
  readonly physicalTerminalId: string;
  readonly label: string;
  readonly terminalProfileKeys: readonly string[];
  readonly storeHubReference: string | null;
  readonly detail: string;
}

export interface TerminalSessionStatus {
  readonly sessionId: string;
  readonly physicalTerminalId: string;
  readonly state: string;
  readonly paired: boolean;
  readonly expired: boolean;
  readonly pairedAt: string | null;
  readonly pairedDeviceReference: string | null;
  readonly failedAttemptCount: number;
  readonly locked: boolean;
  readonly expiresAt: string;
  readonly terminalProfileKeys: readonly string[];
}

export interface TerminalsClient {
  listTerminals(digitalStoreId: string): Promise<ManagementOutcome<TerminalsPage>>;
  defineTerminal(input: {
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
    /** Omitted when blank: the server generates a name. */
    readonly label?: string;
    readonly terminalProfileKeys: readonly string[];
  }): Promise<ManagementOutcome<{ readonly terminal: PhysicalTerminal }>>;
  openSession(input: {
    readonly physicalTerminalId: string;
  }): Promise<ManagementOutcome<IssuedTerminalCode>>;
  sessionStatus(sessionId: string): Promise<ManagementOutcome<TerminalSessionStatus>>;
  cancelSession(sessionId: string): Promise<ManagementOutcome<unknown>>;
}

export function createTerminalsClient(options: ManagementRequestOptions): TerminalsClient {
  const request = createManagementRequest(options);
  return {
    async listTerminals(digitalStoreId) {
      const outcome = await request<{ terminals?: unknown; count?: unknown; dataAsOf?: unknown }>(
        `/partner/stores/${encodeURIComponent(digitalStoreId)}/terminals`,
      );
      if (outcome.kind !== "ok") return outcome;
      const terminals = outcome.value.terminals;
      if (!Array.isArray(terminals)) {
        return {
          kind: "unavailable",
          detail: "The terminal list was not in the expected shape.",
        };
      }
      return {
        kind: "ok",
        value: {
          terminals: terminals as readonly PhysicalTerminal[],
          count: terminals.length,
          ...(typeof outcome.value.dataAsOf === "string"
            ? { dataAsOf: outcome.value.dataAsOf }
            : {}),
        },
      };
    },

    async defineTerminal(input) {
      const label = input.label?.trim() ?? "";
      const body = {
        digitalStoreId: input.digitalStoreId,
        storeLocationId: input.storeLocationId,
        ...(label === "" ? {} : { label }),
        terminalProfileKeys: [...input.terminalProfileKeys],
      };
      const outcome = await request<{ terminal?: unknown }>("/partner/terminals", {
        method: "POST",
        body,
      });
      if (outcome.kind !== "ok") return outcome;
      const terminal = outcome.value.terminal;
      if (terminal === null || typeof terminal !== "object") {
        return {
          kind: "unavailable",
          detail: "The defined terminal was not in the expected shape.",
        };
      }
      return { kind: "ok", value: { terminal: terminal as PhysicalTerminal } };
    },

    async openSession(input) {
      const outcome = await request<IssuedTerminalCode>("/terminal-pairing-sessions", {
        method: "POST",
        body: { physicalTerminalId: input.physicalTerminalId },
      });
      if (outcome.kind !== "ok") return outcome;
      const v = outcome.value;
      if (
        typeof v.code !== "string" ||
        typeof v.sessionId !== "string" ||
        typeof v.expiresAt !== "string"
      ) {
        return { kind: "unavailable", detail: "The issued code was not in the expected shape." };
      }
      return outcome;
    },

    sessionStatus: (sessionId) =>
      request<TerminalSessionStatus>(`/terminal-pairing-sessions/${encodeURIComponent(sessionId)}`),

    cancelSession: (sessionId) =>
      request<unknown>(`/terminal-pairing-sessions/${encodeURIComponent(sessionId)}/cancel`, {
        method: "POST",
        body: {},
      }),
  };
}
