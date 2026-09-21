/**
 * The device-side transport for Pi Terminal pairing.
 *
 * Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 §6–§7 (the person at the
 *   Pi enters only a pairing code; pairing determines Store, Location, Hub,
 *   roles, vertical and required app); migration group 0213; the route contract
 *   in `services/kitluy-device-registry-service/src/terminal-pairing-routes.ts`.
 *
 * ===========================================================================
 * WHY A SIBLING OF http-registration-client.ts, NOT A BRANCH INSIDE IT
 * ===========================================================================
 * The same reasoning that file records for itself. Registration signs its OWN
 * content at `/functions/v1/device-registration` on Supabase and can answer
 * PENDING_APPROVAL; pairing presents a SHARED SECRET a human read aloud, at
 * `/v1/terminal-pairing` on the device registry, and can answer LOCKED. Two
 * services, two contracts, two vocabularies, and no outcome in common. Folding
 * them together would put two authorities behind one exported name.
 *
 * ===========================================================================
 * WHAT LEAVES THE DEVICE
 * ===========================================================================
 * Exactly two values: `deviceRecordId` — what this board is — and `code` — what
 * it was told. Never where it belongs: the Store, the Location, the Hub and the
 * seat all come BACK from the server, which is what makes a byte-identical
 * golden image possible.
 *
 * This is a PRE-CREDENTIAL surface. There is no signature and no certificate
 * here, because a board that has not paired has nothing to sign with that the
 * server would accept for this purpose. The code is the whole proof, and the
 * server rate-limits and locks it accordingly.
 *
 * ===========================================================================
 * THE CODE IS NEVER LOGGED, NEVER PERSISTED, NEVER RETURNED
 * ===========================================================================
 * It is a live shared secret for as long as the session is open. It appears in
 * exactly one place — the request body — and this module has no path that
 * writes it anywhere else. Refusals carry the server's safe message, which is
 * written to be shown to whoever is standing at the Pi and never echoes the code
 * back.
 *
 * ===========================================================================
 * A REFUSAL IS NOT AN ERROR
 * ===========================================================================
 * A mistyped code is the ordinary case, not an exception: someone reads eight
 * characters off a portal and types them on a touchscreen. `CODE_REFUSED` means
 * try again; `LOCKED` means stop and ask for a new code; `ALREADY_ASSIGNED`
 * means the problem is not in this room at all. Those are three different
 * things for a person to do, so they stay three outcomes rather than collapsing
 * into one failure.
 */
import type { PairingPhase } from "../pairing-state.js";

/** The route, appended to the registry origin. Mirrors TERMINAL_PAIRING_PREFIX. */
export const TERMINAL_PAIRING_PATH = "/v1/terminal-pairing";

/**
 * Crockford Base32, length 8 — spelled out rather than expressed as ranges.
 *
 * The same literal appears in `bin/hub-pairing-ui.ts`, in the Device Shell's
 * `code-entry.ts`, and in the database as
 * `kitluy_devices.hub_claim_code_alphabet_v1()` (migration 0191, reused by the
 * terminal sessions of 0213). I, L, O and U are absent by construction. Written
 * out because a range like `A-HJ-KM-NP-TV-Z` says the same thing while hiding
 * which four letters are missing, and getting that wrong here would refuse a
 * code the portal legitimately issued.
 */
const CROCKFORD_CODE = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/**
 * The owner's §7 context: what a paired terminal is told about itself.
 *
 * Mirrors `TerminalPairingContext` in the registry's
 * `terminal-pairing-composition.ts`. Every field is a server row. The device
 * decides none of it and stores it only so the screen can name the Store after
 * a reboot.
 */
export interface TerminalPairingContext {
  readonly contextVersion: string;
  readonly tenantId: string;
  readonly tenantReference: string;
  readonly digitalStoreId: string;
  readonly digitalStoreReference: string;
  readonly storeLocationId: string;
  readonly storeLocationReference: string;
  readonly storeHubDeviceId: string;
  readonly storeHubReference: string | null;
  readonly physicalTerminalId: string;
  readonly physicalTerminalLabel: string;
  readonly terminalProfileKeys: readonly string[];
  readonly terminalAssignments: readonly {
    readonly terminalAssignmentId: string;
    readonly terminalProfileKey: string;
  }[];
  readonly vertical: string;
  /** v2 (TERMINAL-APPLICATION-ASSIGNMENT-001): server-derived. Absent from a pre-0231 registry. */
  readonly desiredApplications?: readonly string[];
  /** v2: Partner-configured. Absent from a pre-0231 registry. */
  readonly allowedSurfaces?: readonly string[];
  readonly requiredAppFamily: string | null;
  readonly releaseChannel: string | null;
  readonly environment: string;
}

export type TerminalPairingResult =
  | {
      readonly kind: "paired";
      readonly deviceRecordId: string;
      readonly sessionId: string;
      readonly assignmentId: string;
      readonly assignmentGeneration: number;
      /**
       * PAIRING IS NOT ACTIVATION. True only when the registry also advanced
       * trust in the same call; `pending_trust` is the normal answer and the
       * screen must not claim a terminal is ready to sell because of it.
       */
      readonly activated: boolean;
      readonly context: TerminalPairingContext;
      readonly detail: string;
    }
  | {
      readonly kind: "refused";
      /** The registry's `TerminalPairingResultCode`, or a transport code. */
      readonly result: string;
      readonly retryable: boolean;
      /** The server's safe, operator-facing sentence. Never contains the code. */
      readonly message: string;
    };

export interface TerminalPairingInput {
  readonly deviceRecordId: string;
  /** The eight characters the installer typed. Sent once, stored never. */
  readonly code: string;
}

export interface TerminalPairingClient {
  pair(input: TerminalPairingInput): Promise<TerminalPairingResult>;
}

export interface HttpTerminalPairingClientOptions {
  /**
   * ORIGIN of the device registry, e.g. `https://fleet.example.com`. The route
   * is appended here, unlike registration's full URL: this and the enrollment
   * routes are the same service, so a base plus a path constant cannot drift
   * onto the wrong host the way an assembled registration URL could.
   */
  readonly registryBaseUrl: string;
  /** Injectable for tests; the global `fetch` otherwise. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Echoed to the server so one pairing attempt can be traced end to end. */
  readonly correlationId?: string;
}

/**
 * What the screen should become after this answer.
 *
 * The mapping lives here, beside the vocabulary it translates, so the console
 * and the graphical shell cannot disagree about what `LOCKED` means. Anything
 * unrecognised becomes `AWAITING_CODE`: a newer registry answering with a code
 * this image has never heard of should leave the operator able to try again,
 * not stranded on a screen with no action.
 */
export function phaseForRefusal(result: string): PairingPhase {
  switch (result) {
    case "LOCKED":
      return "LOCKED";
    case "ALREADY_ASSIGNED":
      return "ALREADY_ASSIGNED";
    default:
      return "AWAITING_CODE";
  }
}

function refused(result: string, retryable: boolean, message: string): TerminalPairingResult {
  return { kind: "refused", result, retryable, message };
}

/** 5xx and 429 are worth repeating; a 4xx answer about this code is not. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function readString(source: Record<string, unknown> | undefined, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" ? value : null;
}

export function createHttpTerminalPairingClient(
  options: HttpTerminalPairingClientOptions,
): TerminalPairingClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const url = `${options.registryBaseUrl.replace(/\/+$/, "")}${TERMINAL_PAIRING_PATH}`;

  return {
    async pair(input: TerminalPairingInput): Promise<TerminalPairingResult> {
      // Shape is checked here as well as on the server. Not as a security
      // measure — the server's check is the one that counts — but so a stray
      // keystroke costs a screen refresh instead of one of the attempt budget
      // the server locks the session on.
      if (!CROCKFORD_CODE.test(input.code)) {
        return refused("CODE_MALFORMED", true, "that is not a complete pairing code");
      }
      if (input.deviceRecordId.trim() === "") {
        return refused("NO_DEVICE_RECORD", false, "this board has not registered yet");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let status: number;
      let json: unknown;
      try {
        const response = await doFetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.correlationId === undefined
              ? {}
              : { "x-correlation-id": options.correlationId }),
          },
          body: JSON.stringify({ deviceRecordId: input.deviceRecordId, code: input.code }),
          signal: controller.signal,
        });
        status = response.status;
        try {
          json = await response.json();
        } catch {
          json = undefined;
        }
      } catch {
        // No network, or a Store LAN still coming up. Retryable by definition:
        // the registry has said nothing about this code, so the session is
        // untouched and the same code is still worth presenting.
        return refused("PAIRING_UNREACHABLE", true, "no connection to KitLuy");
      } finally {
        clearTimeout(timer);
      }

      if (status !== 200) {
        const error = (json as { error?: Record<string, unknown> } | undefined)?.error;
        const details = error?.["details"] as Record<string, unknown> | undefined;
        const result = readString(details, "result") ?? `PAIRING_${status}`;
        const retryable =
          typeof details?.["retryable"] === "boolean"
            ? (details["retryable"] as boolean)
            : isRetryableStatus(status);
        return refused(
          result,
          retryable,
          readString(error, "message") ?? "the pairing could not be completed",
        );
      }

      const body = json as Record<string, unknown> | undefined;
      const deviceRecordId = readString(body, "deviceRecordId");
      const sessionId = readString(body, "sessionId");
      const assignmentId = readString(body, "assignmentId");
      const context = body?.["context"];

      // A 200 that does not carry the assignment is a contract mismatch, not a
      // pairing. Recording it as success would leave a board claiming a Store it
      // was never given, which is the one lie this whole chain exists to prevent.
      if (
        deviceRecordId === null ||
        sessionId === null ||
        assignmentId === null ||
        context === null ||
        typeof context !== "object"
      ) {
        return refused("PAIRING_MALFORMED_RESPONSE", false, "the pairing answer was incomplete");
      }

      // The server told us which board it paired. If that is not this board, the
      // answer belongs to something else and must not be stored as ours.
      if (deviceRecordId !== input.deviceRecordId) {
        return refused("PAIRING_DEVICE_MISMATCH", false, "the pairing answer named another device");
      }

      const generation = body?.["assignmentGeneration"];
      return {
        kind: "paired",
        deviceRecordId,
        sessionId,
        assignmentId,
        assignmentGeneration: typeof generation === "number" ? generation : 0,
        activated: body?.["activated"] === true,
        context: context as TerminalPairingContext,
        detail: readString(body, "detail") ?? "the Pi Terminal is assigned to its seat",
      };
    },
  };
}
