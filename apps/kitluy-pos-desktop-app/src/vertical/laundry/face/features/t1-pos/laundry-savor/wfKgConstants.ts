export const WF_KG_CART_ID = "wf-kg";
export const WF_KG_MIN = 0;

/** Horizontal wheel drum — quick picks for typical counter loads. */
export const WF_KG_WHEEL_MAX = 99;

/** Typed entry cap (practical “unlimited” for commercial / bulk loads). */
export const WF_KG_TYPED_MAX = 999_999;
export const WF_KG_TYPED_MAX_DIGITS = 6;

/** @deprecated Use WF_KG_WHEEL_MAX or WF_KG_TYPED_MAX explicitly. */
export const WF_KG_MAX = WF_KG_WHEEL_MAX;

export function clampWfKg(kg: number): number {
  if (!Number.isFinite(kg)) return WF_KG_MIN;
  const rounded = Math.round(kg);
  return Math.max(WF_KG_MIN, Math.min(WF_KG_TYPED_MAX, rounded));
}

export function clampWfKgForWheel(kg: number): number {
  return Math.max(WF_KG_MIN, Math.min(WF_KG_WHEEL_MAX, clampWfKg(kg)));
}

export function wfKgFitsWheel(kg: number): boolean {
  return clampWfKg(kg) <= WF_KG_WHEEL_MAX;
}

export function normalizeWfKgDigits(digits: string): string {
  const cleaned = digits.replace(/\D/g, "").slice(0, WF_KG_TYPED_MAX_DIGITS);
  if (cleaned === "") return "";
  const n = parseInt(cleaned, 10);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(Math.min(WF_KG_TYPED_MAX, n));
}

export function parseWfKgDigits(digits: string): number {
  if (digits === "") return WF_KG_MIN;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n) || n < 0) return WF_KG_MIN;
  return Math.min(WF_KG_TYPED_MAX, n);
}

/** Scroll index for wheel position (0 = 0 kg). */
export function wfKgToScrollIndex(kg: number): number {
  return clampWfKgForWheel(kg) - WF_KG_MIN;
}
