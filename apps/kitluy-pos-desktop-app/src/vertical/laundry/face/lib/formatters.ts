/**
 * Display formatters. PROVENANCE: donor `src/lib/formatters.ts`
 * (kitluy-laundry-pos-desk-app@8b2f107); the hard-coded USD parity is gone —
 * no exchange rate is published to a terminal (WS-05 [REQUIRED]).
 */
export const fmt = (v: number | string): string => `៛${Number(v).toLocaleString()}`;

export const nowTime = (): string =>
  new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

export const todayStr = (): string =>
  new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

export const fmtDay = (d: Date): string =>
  d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

/** Local-calendar "YYYY-MM-DD" for a Date — the format `ops.bookings.pickup_date` (a DATE) expects. */
export const toIsoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
