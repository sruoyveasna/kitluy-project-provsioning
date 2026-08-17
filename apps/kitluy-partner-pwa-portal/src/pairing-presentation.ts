/**
 * How a pairing code is PRESENTED to the person holding it.
 *
 * Kept out of the component so the parts that can be wrong — the countdown, the
 * grouping, what the screen says when the code has died — are testable without a
 * browser or a clock.
 */

/**
 * Group an eight-character code as `ABCD 8291`.
 *
 * Purely visual. KLSRC-0162 renders `ABCD-8291`, but the display separator is
 * NOT part of the credential: `normalize_hub_claim_code_v1` upper-cases and
 * nothing else — it does not strip a hyphen or a space — so a Hub operator who
 * typed the separator would be refused. A space reads as a gap to skip; a hyphen
 * reads as a character to type. That difference is the whole reason for the
 * choice.
 */
export function groupCode(code: string): string {
  if (code.length !== 8) return code;
  return `${code.slice(0, 4)} ${code.slice(4)}`;
}

export type CodeLife =
  | { readonly kind: "live"; readonly secondsRemaining: number; readonly label: string }
  | { readonly kind: "expired" };

/**
 * How long the code has left, from the SERVER's expiry and the browser's clock.
 *
 * The expiry is authoritative and comes from the database; only the tick is
 * local. A portal that computed the deadline itself would count down to the
 * wrong moment on any machine with a skewed clock — and the operator would be
 * told a dead code was live, which is worse than showing no countdown at all.
 *
 * Rounds DOWN, so the display never claims more time than remains.
 */
export function codeLife(expiresAt: string, now: Date): CodeLife {
  const deadline = Date.parse(expiresAt);
  if (Number.isNaN(deadline)) return { kind: "expired" };

  const remaining = Math.floor((deadline - now.getTime()) / 1000);
  if (remaining <= 0) return { kind: "expired" };

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  return {
    kind: "live",
    secondsRemaining: remaining,
    label: `${minutes}:${String(seconds).padStart(2, "0")}`,
  };
}

/**
 * Whether a Store can have a session opened for it right now.
 *
 * A Store with no Location cannot: `open_hub_pairing_session_v1` requires one and
 * would refuse with `KLUY-HUBSESSION-SCOPE-UNKNOWN`. Deciding this here means the
 * Portal can explain the problem instead of offering a button that always fails.
 */
export function canIssueFor(store: { readonly locations: readonly unknown[] }): boolean {
  return store.locations.length > 0;
}
