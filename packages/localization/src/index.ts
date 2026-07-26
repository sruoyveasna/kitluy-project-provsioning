/**
 * @kitluy/localization — Cambodia-first localization foundation.
 *
 * Source authority: rebuild bible v4.0.0 (header locks: Khmer/English, KHR/USD,
 * Asia/Phnom_Penh, KHQR readiness, Cambodian phone formats). Vertical
 * terminology (e.g. "Booking", "Pressing") lives in vertical packages, not here.
 *
 * STATUS: BUILT + TESTED (test/localization.test.ts).
 */

/** Canonical timezone for all business-date logic (RB v4 header). */
export const KITLUY_TIMEZONE = "Asia/Phnom_Penh" as const;

/** Supported locales. Khmer and English are both first-class. */
export const KITLUY_LOCALES = ["km-KH", "en-US"] as const;
export type KitluyLocale = (typeof KITLUY_LOCALES)[number];

export const DEFAULT_LOCALE: KitluyLocale = "km-KH";

/** Minimal message-bundle contract shared by all apps. */
export type MessageBundle = Readonly<Record<string, string>>;
export interface LocalizedMessages {
  readonly "km-KH": MessageBundle;
  readonly "en-US": MessageBundle;
}

/**
 * Resolve a message with explicit fallback: requested locale → other locale →
 * the key itself (visible as an obvious gap, never silently empty).
 */
export function resolveMessage(
  messages: LocalizedMessages,
  locale: KitluyLocale,
  key: string,
): string {
  const other: KitluyLocale = locale === "km-KH" ? "en-US" : "km-KH";
  return messages[locale][key] ?? messages[other][key] ?? key;
}

/**
 * Cambodian phone numbers. Canonical storage format is E.164 with country code
 * +855. Local mobile numbers are written 0XX XXX XXX(X); mobile prefixes are
 * carrier-assigned and change over time, so this validates structure, not
 * carrier assignment.
 */
export interface CambodianPhone {
  /** E.164 canonical form, e.g. "+85512345678". */
  readonly e164: string;
}

const KH_E164 = /^\+855([1-9]\d{7,8})$/;
const KH_LOCAL = /^0([1-9]\d{7,8})$/;

/**
 * Normalize a Cambodian phone number to E.164 (+855…). Accepts "+855…",
 * "855…", or local "0…" forms with spaces/dashes. Returns null when the input
 * cannot be a Cambodian number.
 */
export function normalizeCambodianPhone(input: string): CambodianPhone | null {
  const cleaned = input.replace(/[\s\-().]/g, "");
  let m = KH_E164.exec(cleaned);
  if (m) return { e164: `+855${m[1]}` };
  m = KH_E164.exec(`+${cleaned}`);
  if (m) return { e164: `+855${m[1]}` };
  m = KH_LOCAL.exec(cleaned);
  if (m) return { e164: `+855${m[1]}` };
  return null;
}

/**
 * Business date in Asia/Phnom_Penh for a given instant. Business-day cutoff
 * policy beyond calendar-midnight is an owner decision
 * ([REQUIRED: business-date rollover policy — Partner Portal OD-005]); this
 * returns the calendar date in the canonical timezone.
 */
export function businessDateOf(instant: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: KITLUY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(instant); // en-CA yields YYYY-MM-DD
}

/**
 * Group digits for display in the given locale (e.g. "1,250,000").
 * Currency symbols/placement are a design-system concern.
 */
export function groupDigits(wholeNumber: string, _locale: KitluyLocale): string {
  const negative = wholeNumber.startsWith("-");
  const digits = negative ? wholeNumber.slice(1) : wholeNumber;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}
