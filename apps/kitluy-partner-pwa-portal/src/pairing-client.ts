/**
 * Browser client for Store Hub pairing.
 *
 * ===========================================================================
 * WHY THE PORTAL DOES NOT TALK TO THE DATABASE
 * ===========================================================================
 * Two separate reasons, and either alone would be enough:
 *
 *   * `kitluy_core` is not exposed to the data API at all (`config.toml` exposes
 *     `public`), so a browser cannot read Stores or Locations even with a valid
 *     session and the RLS policies in place;
 *   * `open_hub_pairing_session_v1` is granted to `kitluy_hub_issuance_service`
 *     alone — never to `authenticated` — so no browser can open a session
 *     directly however it authenticates.
 *
 * So every call goes to the Management API carrying the signed-in Partner's own
 * access token (`management-request.ts`), and every answer is decided
 * server-side against canonical state.
 *
 * ===========================================================================
 * THE CODE IS SHOWN ONCE, AND THIS LAYER MUST NOT MAKE THAT WORSE
 * ===========================================================================
 * Only the digest reaches the database, so the plaintext exists in the response
 * and nowhere else. It is therefore never logged, never put in a URL, and never
 * cached — `issuePairingCode` hands it straight to the caller and keeps nothing.
 */
import {
  classifyManagementResponse,
  createManagementRequest,
  type ManagementOutcome,
  type ManagementRequestOptions,
} from "./management-request.js";

/** Every outcome the Hub screen must be able to tell apart. */
export type PairingOutcome<T> = Exclude<ManagementOutcome<T>, { kind: "not_found" }>;

export interface StoreLocationOption {
  readonly storeLocationId: string;
  readonly locationReference: string;
}

/** Store Hub readiness as the API reports it. Absent means NOT reported. */
export interface StoreHubReadiness {
  readonly deviceReference: string | null;
  /** `active` · `pending_trust` · `none`, or the stored state verbatim. */
  readonly state: string;
}

export interface PartnerStore {
  readonly digitalStoreId: string;
  readonly digitalStoreReference: string;
  readonly locations: readonly StoreLocationOption[];
  /** The Store's primary vertical code, verbatim. Absent means not reported. */
  readonly vertical?: string | null;
  readonly hub?: StoreHubReadiness;
}

export interface IssuedCode {
  /** Plaintext, shown ONCE. Never persisted anywhere by this client. */
  readonly code: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
  readonly detail: string;
}

/**
 * The Hub client's classification. A 404 is reported as `unavailable` here, as
 * it always was: the Hub screen has no resource that can be absent, so an
 * absent answer is a service problem from its point of view.
 */
export function classifyPairingResponse<T>(status: number, body: unknown): PairingOutcome<T> {
  const outcome = classifyManagementResponse<T>(status, body);
  return outcome.kind === "not_found"
    ? { kind: "unavailable", detail: "The service answered 404." }
    : outcome;
}

export type PairingClientOptions = ManagementRequestOptions;

/**
 * What the Portal learns about a session it opened.
 *
 * `paired` is the one an operator is waiting for. It is derived on the server
 * from the stored state so the Portal cannot disagree with the database about
 * what "paired" means.
 */
export interface PairingSessionStatus {
  readonly sessionId: string;
  readonly state: string;
  readonly paired: boolean;
  readonly pairedAt: string | null;
  readonly pairedDeviceReference: string | null;
  readonly failedAttemptCount: number;
  readonly locked: boolean;
  readonly expiresAt: string;
}

export interface PairingClient {
  listStores(): Promise<PairingOutcome<readonly PartnerStore[]>>;
  /** Poll one session. Used to turn the code screen into a live one. */
  sessionStatus(sessionId: string): Promise<PairingOutcome<PairingSessionStatus>>;
  issuePairingCode(input: {
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
  }): Promise<PairingOutcome<IssuedCode>>;
}

function asPairing<T>(outcome: ManagementOutcome<T>): PairingOutcome<T> {
  return outcome.kind === "not_found"
    ? { kind: "unavailable", detail: "The service answered 404." }
    : outcome;
}

export function createPairingClient(options: PairingClientOptions): PairingClient {
  const request = createManagementRequest(options);

  return {
    async listStores() {
      const outcome = asPairing(await request<{ stores?: unknown }>("/partner/stores"));
      if (outcome.kind !== "ok") return outcome;
      const stores = outcome.value.stores;
      if (!Array.isArray(stores)) {
        // A 200 whose body is not the agreed shape is not data. Saying so beats
        // rendering an empty list, which reads as "you hold no Stores".
        return { kind: "unavailable", detail: "The Store list was not in the expected shape." };
      }
      return { kind: "ok", value: stores as readonly PartnerStore[] };
    },

    issuePairingCode: async (input) =>
      asPairing(await request<IssuedCode>("/hub-pairing-codes", { method: "POST", body: input })),
    sessionStatus: async (sessionId: string) =>
      asPairing(
        await request<PairingSessionStatus>(`/hub-pairing-codes/${encodeURIComponent(sessionId)}`),
      ),
  };
}
