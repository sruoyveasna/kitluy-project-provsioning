/**
 * The pairing-code keypad, as a pure reducer.
 *
 * ===========================================================================
 * ONE FORMAT, MIRRORED FROM THE CLOUD
 * ===========================================================================
 * A KitLuy pairing code is eight characters of Crockford Base32 — the alphabet
 * `hub_claim_code_alphabet_v1()` generates and the Hub console validates against
 * (`services/kitluy-device-firstboot-agent/src/bin/hub-pairing-ui.ts:75`,
 * `CROCKFORD`). The Pi Terminal types the same code an installer reads off the
 * Partner Portal, so the format lives here as a constant and nothing hardcodes
 * "8" or the alphabet anywhere else in the shell.
 *
 * This reducer is PRESENTATION only. It never authorises anything: the cloud
 * re-checks the alphabet and owns the attempt budget. Forgiving input here just
 * saves an operator a wasted round trip (and, more importantly, a wasted attempt)
 * on an obvious typo — exactly the reasoning in `normalisePairingCode()`.
 *
 * The same reducer serves the on-screen keypad AND a USB keyboard-wedge scanner:
 * both are just streams of characters, out-of-alphabet keys are ignored, and the
 * screen submits when the code is complete.
 */

export interface CodeFormat {
  /** The canonical encode alphabet. Excludes I, L, O and U by construction. */
  readonly alphabet: string;
  readonly length: number;
}

/** Crockford Base32, length 8 — mirrors `hub-pairing-ui.ts` and the cloud. */
export const CROCKFORD_BASE32: CodeFormat = {
  alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ",
  length: 8,
};

export interface CodeEntryState {
  /** The accepted characters so far, always within the alphabet and length. */
  readonly value: string;
  /** True exactly when `value.length === format.length`. */
  readonly complete: boolean;
}

export const emptyCodeEntry: CodeEntryState = { value: "", complete: false };

/**
 * A single typed or scanned character, reduced to what the protocol accepts, or
 * `null` when it is not part of a code.
 *
 * Crockford's forgiving-input rules: `I`/`L` are read as `1` and `O` as `0`
 * (the classic OCR/keyboard confusions), case is folded up. `U` is deliberately
 * NOT mapped — it carries no canonical digit and a code never contains it — so a
 * `U` is ignored rather than silently turned into something else. Anything
 * outside the alphabet after normalisation (a space, a hyphen, a scanner's stray
 * control byte) is ignored.
 */
export function normalizeCodeChar(
  raw: string,
  format: CodeFormat = CROCKFORD_BASE32,
): string | null {
  if (raw.length !== 1) return null;
  let c = raw.toUpperCase();
  if (c === "I" || c === "L") c = "1";
  else if (c === "O") c = "0";
  return format.alphabet.includes(c) ? c : null;
}

export type CodeEntryAction =
  | { readonly kind: "key"; readonly char: string }
  | { readonly kind: "backspace" }
  | { readonly kind: "clear" };

/**
 * Total function: any state and any action yield a valid state. A key past the
 * length is dropped (the box is full); an out-of-alphabet key is dropped; a
 * backspace on an empty value is a no-op.
 */
export function reduceCodeEntry(
  state: CodeEntryState,
  action: CodeEntryAction,
  format: CodeFormat = CROCKFORD_BASE32,
): CodeEntryState {
  switch (action.kind) {
    case "key": {
      if (state.value.length >= format.length) return state;
      const c = normalizeCodeChar(action.char, format);
      if (c === null) return state;
      const value = state.value + c;
      return { value, complete: value.length === format.length };
    }
    case "backspace": {
      if (state.value.length === 0) return state;
      const value = state.value.slice(0, -1);
      return { value, complete: value.length === format.length };
    }
    case "clear":
      return emptyCodeEntry;
  }
}

/**
 * Feed a burst of characters — a scanner wedge pastes the whole code at once,
 * often with a trailing newline. Each character runs through the same reducer,
 * so out-of-alphabet bytes and overflow are handled identically to typing.
 */
export function feedCodeEntry(
  state: CodeEntryState,
  chars: string,
  format: CodeFormat = CROCKFORD_BASE32,
): CodeEntryState {
  let next = state;
  for (const char of chars) {
    next = reduceCodeEntry(next, { kind: "key", char }, format);
  }
  return next;
}
