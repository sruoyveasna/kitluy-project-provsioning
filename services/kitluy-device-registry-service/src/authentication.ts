/**
 * Request authentication for the governed revocation routes.
 *
 * Authority: WS-11-T003 Step 4 final completion §2 ("never accept caller-supplied
 * actor or authority truth"); Hub spec §3.1 ("IP address never establishes
 * trust"); BLK-005 / BLK-006 (signing and provider values are [REQUIRED]).
 *
 * ===========================================================================
 * WHY THIS IS A PORT AND WHY ITS DEFAULT REFUSES
 * ===========================================================================
 * The governed emergency doors evaluate `auth.uid()`. Everything downstream of
 * this file is only as sound as the answer to "who is calling?", and there are
 * exactly two honest ways to get it:
 *
 *   1. verify a signed token here, which needs the issuer key and algorithm —
 *      owner values that do not exist yet (BLK-005 item 8, BLK-006);
 *   2. receive an already-verified subject over a channel that cannot be forged,
 *      which needs the mutual-auth design between the edge and this service —
 *      also absent.
 *
 * Neither exists, so the shipped default is {@link refuseAllRequests}: every
 * request is refused with `AUTHENTICATION_NOT_CONFIGURED`. That is deliberate.
 * The tempting shortcut — trust an `x-user-id` header from the caller — is
 * exactly the "caller-supplied actor truth" this gate forbids, and it would
 * rebuild RC-021 at the HTTP layer: anyone who could reach the port could name
 * themselves the emergency authority.
 *
 * A deployment supplies a real authenticator by composition. Tests supply one
 * explicitly and say so. There is no header, flag or environment variable that
 * turns trust on.
 */

/** A subject an authenticator has VERIFIED. Never parsed from a request body. */
export interface AuthenticatedPrincipal {
  /** Becomes `auth.uid()`. Must be the subject of a verified credential. */
  readonly userId: string;
  /**
   * How the identity was established, for audit correlation. Free text from the
   * authenticator, never from the caller.
   */
  readonly method: string;
}

export type AuthenticationOutcome =
  | { readonly authenticated: true; readonly principal: AuthenticatedPrincipal }
  | {
      readonly authenticated: false;
      readonly code:
        "AUTHENTICATION_NOT_CONFIGURED" | "AUTHENTICATION_REQUIRED" | "AUTHENTICATION_INVALID";
      /** Safe, fixed text. Never echoes a credential or a header value. */
      readonly detail: string;
    };

/** Headers as received. Treated as DATA — nothing here is trusted as identity. */
export type RequestHeaders = Readonly<Record<string, string | string[] | undefined>>;

export interface RequestAuthenticator {
  authenticate(headers: RequestHeaders): Promise<AuthenticationOutcome>;
}

/**
 * The shipped default. Refuses everything.
 *
 * Not a placeholder to be quietly replaced by a permissive one: a service that
 * cannot establish who is calling must not execute a governed emergency
 * revocation, and refusing is the only correct behaviour while the owner values
 * are outstanding.
 */
export function refuseAllRequests(): RequestAuthenticator {
  return {
    authenticate(): Promise<AuthenticationOutcome> {
      return Promise.resolve({
        authenticated: false,
        code: "AUTHENTICATION_NOT_CONFIGURED",
        detail:
          "[REQUIRED: token issuer, signing algorithm and edge mutual-auth design — BLK-005 item 8 / BLK-006]. " +
          "No request identity can be established, so no governed operation may run.",
      });
    },
  };
}
