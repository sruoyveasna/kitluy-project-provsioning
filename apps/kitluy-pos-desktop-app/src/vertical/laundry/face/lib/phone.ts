/**
 * Cambodian phone-number helpers.
 *
 * Stored format: `core.users.phone_e164` is the international form
 * (`+85512345678`). What the cashier types in the search box is
 * almost always the local form starting with a `0` (`012345678`).
 * Direct substring match against `+855…` would never hit, so we
 * normalize both sides to a canonical "national digits only" form
 * before comparing.
 */

const COUNTRY_CODE_DIGITS = "855";

/**
 * Strip whitespace and any of: leading `+855`, `855`, or `0`. Lowercase
 * the rest (idempotent — digits only). Returns the bare national-number
 * digits, e.g.:
 *   `+85512345678` → `12345678`
 *   `012345678`    → `12345678`
 *   `12345678`     → `12345678`
 *   `0 12 345 678` → `12345678`
 *
 * Non-numeric input (e.g. a name partial) passes through unchanged so
 * the caller can use the same normalizer for any search field — only
 * the phone column is keyed off it.
 */
export const normalizePhoneSearch = (raw: string): string => {
  const trimmed = raw.replace(/[\s\-()]/g, "").toLowerCase();
  if (trimmed.startsWith("+" + COUNTRY_CODE_DIGITS)) {
    return trimmed.slice(1 + COUNTRY_CODE_DIGITS.length);
  }
  if (trimmed.startsWith(COUNTRY_CODE_DIGITS)) {
    return trimmed.slice(COUNTRY_CODE_DIGITS.length);
  }
  if (trimmed.startsWith("0")) {
    return trimmed.slice(1);
  }
  return trimmed;
};

/**
 * Display the phone number in Cambodian local format with the leading
 * `0`, regardless of how it's stored. Used when the cashier needs to
 * read it off-screen — `0 12 345 678` is what people in KH actually
 * dial. Returns the original string unchanged for anything that doesn't
 * look like a Cambodian phone (so foreign customers' raw numbers still
 * display as-is).
 */
export const formatPhoneLocal = (raw: string | null | undefined): string => {
  if (!raw) return "";
  const trimmed = raw.replace(/\s+/g, "");
  if (trimmed.startsWith("+" + COUNTRY_CODE_DIGITS)) {
    return "0" + trimmed.slice(1 + COUNTRY_CODE_DIGITS.length);
  }
  return trimmed;
};

/**
 * Normalize a cashier-typed phone number to the E.164 form the backend
 * expects (`+855…`) before sending it across the wire. Idempotent — a
 * value already in `+…` form passes through unchanged. Empty / nullish
 * input returns `null` so the caller can hand it straight to a
 * `customerPhone?: string | null` field.
 *
 *   `012345678`    → `+85512345678`
 *   `0 12 345 678` → `+85512345678`
 *   `+85512345678` → `+85512345678`
 *   `12345678`     → `+85512345678`  (bare national digits)
 *   ``  / null     → `null`
 *
 * Anything that doesn't match the Cambodian shape (e.g. a foreign
 * customer's raw number with a different `+CC`) is returned as-typed so
 * we don't silently mangle it.
 */
export const toE164 = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const trimmed = raw.replace(/[\s\-()]/g, "");
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) return trimmed;
  if (trimmed.startsWith(COUNTRY_CODE_DIGITS)) return "+" + trimmed;
  if (trimmed.startsWith("0")) return "+" + COUNTRY_CODE_DIGITS + trimmed.slice(1);
  if (/^\d+$/.test(trimmed)) return "+" + COUNTRY_CODE_DIGITS + trimmed;
  return trimmed;
};
