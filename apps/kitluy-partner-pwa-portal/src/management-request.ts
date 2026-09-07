/**
 * The one transport to the Management API, shared by every client in this
 * portal.
 *
 * Extracted from `pairing-client.ts` when the Terminals client arrived: two
 * copies of the 401/403/422 mapping are two places for it to drift, and the
 * mapping is the part an operator experiences. Everything the Hub client said
 * about this transport still holds — the token is read per call and never
 * stored, a 200 with an unusable body is not data, and a one-time code passing
 * through here is never logged, cached or placed in a URL.
 */

/** Every outcome a screen must be able to tell apart. */
export type ManagementOutcome<T> =
  | { readonly kind: "ok"; readonly value: T }
  /** 401 — the session is absent, expired or revoked. Sign in again. */
  | { readonly kind: "unauthenticated"; readonly reason: string }
  /** 403 — authenticated, but not for this Store. */
  | { readonly kind: "denied"; readonly reason: string; readonly message: string }
  /** 404 — absent, or not this Partner's (the API makes those identical). */
  | { readonly kind: "not_found" }
  /** 422 — the request was refused by a governed door, with guidance. */
  | { readonly kind: "refused"; readonly message: string }
  /** Network failure, 5xx, or a body that is not the agreed shape. */
  | { readonly kind: "unavailable"; readonly detail: string };

interface ErrorBody {
  error?: { code?: unknown; message?: unknown; details?: { reason?: unknown } };
}

/**
 * Turn one HTTP response into an outcome. Pure, so it is testable without a
 * server, and total, so an unexpected status can never fall through to "ok".
 */
export function classifyManagementResponse<T>(status: number, body: unknown): ManagementOutcome<T> {
  const errorBody = (body ?? {}) as ErrorBody;
  const reason =
    typeof errorBody.error?.details?.reason === "string"
      ? errorBody.error.details.reason
      : "UNSPECIFIED";
  const message = typeof errorBody.error?.message === "string" ? errorBody.error.message : "";

  if (status === 200 || status === 201) return { kind: "ok", value: body as T };
  if (status === 401) return { kind: "unauthenticated", reason };
  if (status === 403) return { kind: "denied", reason, message: message || "Access denied." };
  if (status === 404) return { kind: "not_found" };
  if (status === 422) return { kind: "refused", message: message || "That request was refused." };
  return { kind: "unavailable", detail: `The service answered ${status}.` };
}

export interface ManagementRequestOptions {
  readonly baseUrl: string;
  /** Resolves the CURRENT access token, or null when there is no session. */
  readonly accessToken: () => Promise<string | null>;
  readonly fetchImpl?: typeof fetch;
}

export type ManagementRequest = <T>(
  path: string,
  init?: { readonly method: "POST"; readonly body: unknown },
) => Promise<ManagementOutcome<T>>;

export function createManagementRequest(options: ManagementRequestOptions): ManagementRequest {
  const doFetch = options.fetchImpl ?? fetch;

  return async function request<T>(
    path: string,
    init?: { readonly method: "POST"; readonly body: unknown },
  ): Promise<ManagementOutcome<T>> {
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

    return classifyManagementResponse<T>(response.status, body);
  };
}
