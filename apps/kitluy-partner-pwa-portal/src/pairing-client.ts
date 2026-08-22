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
 * So both calls go to the Management API carrying the signed-in Partner's own
 * access token, and every answer is decided server-side against canonical state.
 * The token is attached per call and never stored here: session storage belongs
 * to the auth client, and a second copy is the one that gets forgotten on
 * sign-out.
 *
 * ===========================================================================
 * THE CODE IS SHOWN ONCE, AND THIS LAYER MUST NOT MAKE THAT WORSE
 * ===========================================================================
 * Only the digest reaches the database, so the plaintext exists in the response
 * and nowhere else. It is therefore never logged, never put in a URL, and never
 * cached — `issuePairingCode` hands it straight to the caller and keeps nothing.
 */

/** Every outcome the UI must be able to tell apart. */
export type PairingOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 401 — the session is absent, expired or revoked. Sign in again. */
  | { readonly kind: "unauthenticated"; readonly reason: string }
  /** 403 — authenticated, but not for this Store. */
  | { readonly kind: "denied"; readonly reason: string; readonly message: string }
  /** 422 — the request was refused by a governed door, with guidance. */
  | { readonly kind: "refused"; readonly message: string }
  /** Network failure, 5xx, or a body that is not the agreed shape. */
  | { readonly kind: "unavailable"; readonly detail: string };

export interface StoreLocationOption {
  readonly storeLocationId: string;
  readonly locationReference: string;
}

export interface PartnerStore {
  readonly digitalStoreId: string;
  readonly digitalStoreReference: string;
  readonly locations: readonly StoreLocationOption[];
}

export interface IssuedCode {
  /** Plaintext, shown ONCE. Never persisted anywhere by this client. */
  readonly code: string;
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly ttlSeconds: number;
  readonly detail: string;
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: { reason?: unknown } };
}

/**
 * Turn one HTTP response into an outcome.
 *
 * Separated from transport so the mapping is testable without a server, and so
 * an unexpected status can never fall through to "ok". Anything unrecognised
 * becomes `unavailable`: an operational portal must not present an unparsed
 * response as data.
 */
export function classifyPairingResponse<T>(status: number, body: unknown): PairingOutcome<T> {
  const errorBody = (body ?? {}) as ErrorBody;
  const reason =
    typeof errorBody.error?.details?.reason === "string"
      ? errorBody.error.details.reason
      : "UNSPECIFIED";
  const message = typeof errorBody.error?.message === "string" ? errorBody.error.message : "";

  if (status === 200 || status === 201) return { kind: "ok", value: body as T };
  if (status === 401) return { kind: "unauthenticated", reason };
  if (status === 403) return { kind: "denied", reason, message: message || "Access denied." };
  if (status === 422) {
    // A governed refusal carries guidance a Partner can act on — "that Location
    // does not belong to that Store" — so the message is surfaced rather than
    // replaced with a generic one.
    return { kind: "refused", message: message || "That request was refused." };
  }
  return { kind: "unavailable", detail: `The service answered ${status}.` };
}

export interface PairingClientOptions {
  readonly baseUrl: string;
  /** Resolves the CURRENT access token, or null when there is no session. */
  readonly accessToken: () => Promise<string | null>;
  readonly fetchImpl?: typeof fetch;
}

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

export function createPairingClient(options: PairingClientOptions): PairingClient {
  const doFetch = options.fetchImpl ?? fetch;

  async function request<T>(
    path: string,
    init?: { readonly method: string; readonly body: unknown },
  ): Promise<PairingOutcome<T>> {
    const token = await options.accessToken();
    if (token === null) {
      // No round trip: there is nothing to authenticate with.
      return { kind: "unauthenticated", reason: "KLUY-AUTH-MISSING-TOKEN" };
    }

    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}/management/v1${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(init === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      // The message is deliberately not the raw error: a fetch failure text is
      // browser-specific noise, and the operator's next action is the same.
      return { kind: "unavailable", detail: "The pairing service could not be reached." };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (response.status === 200 || response.status === 201) {
        return { kind: "unavailable", detail: "The pairing service returned an unusable reply." };
      }
    }

    return classifyPairingResponse<T>(response.status, body);
  }

  return {
    async listStores() {
      const outcome = await request<{ stores?: unknown }>("/partner/stores");
      if (outcome.kind !== "ok") return outcome;
      const stores = outcome.value.stores;
      if (!Array.isArray(stores)) {
        // A 200 whose body is not the agreed shape is not data. Saying so beats
        // rendering an empty list, which reads as "you hold no Stores".
        return { kind: "unavailable", detail: "The Store list was not in the expected shape." };
      }
      return { kind: "ok", value: stores as readonly PartnerStore[] };
    },

    issuePairingCode: (input) =>
      request<IssuedCode>("/hub-pairing-codes", { method: "POST", body: input }),
    sessionStatus: (sessionId: string) =>
      request<PairingSessionStatus>(`/hub-pairing-codes/${encodeURIComponent(sessionId)}`),
  };
}
