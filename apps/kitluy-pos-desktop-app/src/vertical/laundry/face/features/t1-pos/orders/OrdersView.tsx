/**
 * The Orders view — today's Bookings, as the Store Hub lists them.
 *
 * PROVENANCE: the donor's Order Queue (kitluy-laundry-pos-desk-app@8b2f107)
 * read `ops.bookings` from Supabase directly (REJECTED). This view reads
 * `ports.listRecentBookings()` — the Hub's own rows for this Location, today,
 * newest first (T1-REAL-OPERATIONS-001 slice 2). Nothing is cached, invented
 * or filtered on the terminal; a refusal is shown as such.
 */
import { useCallback, useEffect, useState } from "react";

import { useThemeColors } from "@face/app/ThemeProvider";
import { useAppState } from "@face/app/useAppState";
import { fmt } from "@face/lib/formatters";
import type { IntakeBookingSummary } from "@face/ports";

const formatHHmm = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export const OrdersView = () => {
  const C = useThemeColors();
  const { ports, confirmation } = useAppState();
  const [rows, setRows] = useState<readonly IntakeBookingSummary[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setBusy(true);
    void ports.listRecentBookings().then((r) => {
      setBusy(false);
      if (!r.ok) {
        setRows(null);
        setFailure(`${r.kind.replace(/_/g, " ")} — ${r.detail}`);
        return;
      }
      setRows(r.value);
      setFailure(null);
    });
  }, [ports]);

  // Read on open, and again after a booking was confirmed on this terminal.
  useEffect(() => {
    load();
  }, [load, confirmation]);

  return (
    <section data-orders-view style={{ padding: "16px 0" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Today's bookings</h2>
        <span className="sv-review-badge">from the Store Hub</span>
        <button
          type="button"
          className="sv-cta outline"
          onClick={load}
          disabled={busy}
          style={{ marginLeft: "auto" }}
        >
          {busy ? "Reading…" : "Refresh"}
        </button>
      </div>
      {failure !== null ? (
        <div role="alert" style={{ color: C.redDark, fontSize: 14 }}>
          The Store Hub did not answer: {failure}
        </div>
      ) : rows === null ? (
        <div role="status" style={{ color: C.textSec, fontSize: 14 }}>
          Reading the Store Hub…
        </div>
      ) : rows.length === 0 ? (
        <div role="status" style={{ color: C.textSec, fontSize: 14 }}>
          No booking has been confirmed at this Location today.
        </div>
      ) : (
        <div className="sv-review-lines-card" data-orders-count={rows.length}>
          {rows.map((b) => (
            <div key={b.bookingId} className="sv-review-line" data-booking={b.bookingNumber}>
              <span className="sv-review-line-name">
                <strong>{b.bookingNumber}</strong>
                {" · "}
                {b.walkIn ? "Walk-in" : (b.customerDisplayName ?? "Customer")}
                {" · "}
                {formatHHmm(b.createdAt)}
              </span>
              <span className="sv-review-line-qty">
                {b.status.replace(/_/g, " ")} · {String(b.lineCount)} line
                {b.lineCount === 1 ? "" : "s"}
                {b.receiptNumber ? ` · ${b.receiptNumber}` : ""}
              </span>
              <span className="sv-review-line-price">
                {fmt(b.totalMinor)}
                {BigInt(b.balanceMinor) > 0n ? ` (due ${fmt(b.balanceMinor)})` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
