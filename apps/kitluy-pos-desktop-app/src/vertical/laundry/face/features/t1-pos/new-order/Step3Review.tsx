/**
 * Review step — confirm the Booking on the Store Hub, paid in cash.
 *
 * PROVENANCE: donor `Step3Review.tsx` (kitluy-laundry-pos-desk-app@8b2f107,
 * 1 021 lines). Kept: the review cards, the "Confirm & Print" rhythm and the
 * post-commit success screen with the receipt (`.sv-review-*`,
 * `.sv-step3-success-*`). Gone: the card/QR gateway, loyalty, the fixture
 * commit, the canvas receipt renderer (the printed form is slice 3).
 *
 * T1-REAL-OPERATIONS-001 slice 2. "Confirm" is ONE Store Hub command on the
 * Booking Draft (`ports.confirmIntake`): the Hub prices the lines again from
 * its delivered catalog, refuses if the total shown here differs, converts
 * the draft into the Booking, records the cash tender (KHR + USD at the
 * delivered rate) and issues the receipt record. What this screen shows after
 * that is the Hub's answer — the booking number, the receipt, the change —
 * never a figure of its own. A retry after a lost answer replays the same
 * command key, so a booking can never be made twice.
 */
import { useState } from "react";

import { useThemeColors } from "@face/app/ThemeProvider";
import { useAppState } from "@face/app/useAppState";
import { I } from "@face/components/common/icons";
import { fmt } from "@face/lib/formatters";
import { formatPhoneLocal } from "@face/lib/phone";
import type { IntakeConfirmation } from "@face/ports";

import { BookingMainHead } from "../laundry-savor/BookingMainHead";
import { tenderedKhr } from "./Step2Pricing";

const CANCEL_REASONS = [
  { code: "customer_left", label: "Customer left" },
  { code: "duplicate_intake", label: "Duplicate intake" },
  { code: "entered_in_error", label: "Entered in error" },
  { code: "customer_declined", label: "Customer declined" },
] as const;

const formatHHmm = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** The receipt the Hub issued, rendered line by line from its payload. */
export const ReceiptView = ({ confirmation }: { readonly confirmation: IntakeConfirmation }) => {
  const r = confirmation.receipt.payload;
  const lines = Array.isArray(r["lines"]) ? (r["lines"] as Record<string, unknown>[]) : [];
  const payment = confirmation.payment;
  return (
    <div className="sv-review-lines-card" data-receipt={confirmation.receipt.receipt_number}>
      <div className="sv-review-section-hd">
        <span>Receipt {confirmation.receipt.receipt_number}</span>
      </div>
      {lines.map((line, index) => (
        <div key={String(line["booking_line_id"] ?? index)} className="sv-review-line">
          <span className="sv-review-line-name">{String(line["display_name"] ?? "")}</span>
          <span className="sv-review-line-qty">
            {line["pricing_method"] === "per_weight"
              ? `${Number(line["quantity"]).toString()} kg`
              : `×${Number(line["quantity"]).toString()}`}
          </span>
          <span className="sv-review-line-price">
            {fmt(String(line["line_subtotal_minor"] ?? "0"))}
          </span>
        </div>
      ))}
      <div className="sv-review-line" style={{ fontWeight: 700 }}>
        <span className="sv-review-line-name">Total</span>
        <span className="sv-review-line-qty">{confirmation.booking.currency_code}</span>
        <span className="sv-review-line-price">{fmt(confirmation.booking.total_minor)}</span>
      </div>
      {payment !== null ? (
        <>
          {payment.legs.map((leg) => (
            <div key={leg.currency_code} className="sv-review-line">
              <span className="sv-review-line-name">Cash {leg.currency_code}</span>
              <span className="sv-review-line-qty">
                {leg.currency_code === "USD"
                  ? `$${(Number(leg.amount_minor) / 100).toFixed(2)} @ ${fmt(leg.khr_per_usd ?? 0)}`
                  : ""}
              </span>
              <span className="sv-review-line-price">{fmt(leg.local_equivalent_minor)}</span>
            </div>
          ))}
          <div className="sv-review-line">
            <span className="sv-review-line-name">Change</span>
            <span className="sv-review-line-qty" />
            <span className="sv-review-line-price">{fmt(payment.change_due_minor)}</span>
          </div>
        </>
      ) : null}
      <div className="sv-review-card-sub" style={{ padding: "8px 12px" }}>
        {confirmation.receipt.print_state === "queued"
          ? "Print job queued on the Store Hub."
          : "No receipt printer is bound at this Location; the receipt is on record."}
      </div>
    </div>
  );
};

export const Step3Review = ({ layout }: { layout: "main" | "panel" }) => {
  const C = useThemeColors();
  const {
    ports,
    cart,
    cartLines,
    quote,
    setQuote,
    express,
    tenderKhrDigits,
    tenderUsdDigits,
    custName,
    custPhone,
    custNote,
    staffNote,
    setStaffNote,
    selCustomer,
    bookingDraft,
    setBookingDraft,
    confirmation,
    setConfirmation,
    resetOrder,
    showToast,
  } = useAppState();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const walkIn = selCustomer === null;
  const displayName = selCustomer?.name ?? custName.trim();
  const displayPhone = selCustomer
    ? (selCustomer.phoneMasked ?? "—")
    : formatPhoneLocal(custPhone) || "—";
  const tender = tenderedKhr(tenderKhrDigits, tenderUsdDigits, quote?.khrPerUsd ?? null);
  const total = quote === null ? null : BigInt(quote.totalMinor);
  const covered = total !== null && tender.total >= total;
  const canConfirm =
    !busy && confirmation === null && quote !== null && bookingDraft !== null && covered;

  const confirm = async () => {
    if (!canConfirm || quote === null || bookingDraft === null) return;
    setBusy(true);
    setFailure(null);
    const r = await ports.confirmIntake({
      draftId: bookingDraft.draft.draftId,
      expectedVersion: bookingDraft.draft.version,
      lines: cartLines,
      express,
      displayedTotalMinor: quote.totalMinor,
      tender: { localMinor: tender.khr.toString(), usdCents: tender.usdCents.toString() },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.kind === "price_mismatch") {
        // The Hub's price moved (a newer configuration): show the Hub's
        // figure again before anyone pays — never the stale one.
        setQuote(null);
      }
      setFailure(`${r.kind.replace(/_/g, " ")} — ${r.detail}`);
      return;
    }
    setConfirmation(r.value);
    showToast(
      r.value.outcome === "replayed"
        ? `✓ Booking ${r.value.booking.booking_number} was already confirmed`
        : `✓ Booking ${r.value.booking.booking_number} confirmed on the Store Hub`,
    );
  };

  const saveNotes = async () => {
    if (busy || bookingDraft === null || confirmation !== null) return;
    setBusy(true);
    setFailure(null);
    const r = await ports.updateDraft({
      draftId: bookingDraft.draft.draftId,
      expectedVersion: bookingDraft.draft.version,
      customerNotes: custNote,
      staffNotes: staffNote,
    });
    setBusy(false);
    if (!r.ok) {
      setFailure(`${r.kind.replace(/_/g, " ")} — ${r.detail}`);
      return;
    }
    setBookingDraft({ draft: r.value, lastOperation: "updated" });
    showToast("✓ Notes saved on the Store Hub");
  };

  const cancelDraft = async (reasonCode: string) => {
    if (busy || bookingDraft === null || confirmation !== null) return;
    setBusy(true);
    setFailure(null);
    const r = await ports.cancelDraft({ draftId: bookingDraft.draft.draftId, reasonCode });
    setBusy(false);
    setCancelOpen(false);
    if (!r.ok) {
      setFailure(`${r.kind.replace(/_/g, " ")} — ${r.detail}`);
      return;
    }
    showToast("Booking Draft cancelled");
    resetOrder();
  };

  // ------------------------------------------------------------------ panel
  if (layout === "panel") {
    if (confirmation !== null) {
      const b = confirmation.booking;
      return (
        <div className="sv-step3-review-panel" data-booking-state={b.status}>
          <div className="sv-review-panel-cards hide-scrollbar">
            <div className="sv-review-card">
              <div className="sv-review-card-label">Booking</div>
              <div className="sv-review-card-value">{b.booking_number}</div>
              <div className="sv-review-card-sub">
                {b.status.replace(/_/g, " ")} · paid {fmt(b.paid_minor)} · balance{" "}
                {fmt(b.balance_minor)}
              </div>
            </div>
            {confirmation.payment !== null ? (
              <div className="sv-review-card">
                <div className="sv-review-card-label">Change due</div>
                <div className="sv-review-card-value sv-review-card-value--lg">
                  {fmt(confirmation.payment.change_due_minor)}
                </div>
                <div className="sv-review-card-sub">
                  tendered {fmt(confirmation.payment.tendered_minor)} ·{" "}
                  {confirmation.payment.payment_number}
                </div>
              </div>
            ) : null}
          </div>
          <div className="sv-review-confirm-stack">
            <button type="button" className="sv-cta" onClick={resetOrder} data-action="new-booking">
              Start new booking
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="sv-step3-review-panel">
        <div className="sv-review-panel-cards hide-scrollbar">
          <div className="sv-review-card">
            <div className="sv-review-card-label">Total to pay</div>
            <div className="sv-review-card-value sv-review-card-value--lg">
              {total === null ? "—" : fmt(total.toString())}
            </div>
            <div className="sv-review-card-sub">
              {quote === null ? "not priced by the Store Hub yet" : "Store Hub price"}
            </div>
          </div>
          <div className="sv-review-card">
            <div className="sv-review-card-label">Cash tendered</div>
            <div className="sv-review-card-value">{fmt(tender.total.toString())}</div>
            <div className="sv-review-card-sub">
              {total === null
                ? "—"
                : covered
                  ? `change ${fmt((tender.total - total).toString())}`
                  : `short ${fmt((total - tender.total).toString())} — go back to Pricing`}
            </div>
          </div>
          {bookingDraft !== null ? (
            <div className="sv-review-card">
              <div className="sv-review-card-label">Booking Draft</div>
              <div className="sv-review-card-value">{bookingDraft.draft.draftId.slice(0, 8)}</div>
              <div className="sv-review-card-sub">
                {bookingDraft.draft.lifecycle} · v{String(bookingDraft.draft.version)} ·{" "}
                {bookingDraft.draft.syncState.replace(/_/g, " ")}
              </div>
            </div>
          ) : null}
        </div>
        <div className="sv-review-confirm-stack">
          <button
            type="button"
            className="sv-cta"
            onClick={() => void confirm()}
            disabled={!canConfirm}
            data-action="confirm-intake"
          >
            {busy ? "Confirming on the Store Hub…" : "Confirm & Print"}
          </button>
          <button
            type="button"
            className="sv-cta outline"
            onClick={() => void saveNotes()}
            disabled={busy || bookingDraft === null}
          >
            Save notes
          </button>
        </div>
        <div className="sv-review-cancel-wrap">
          {cancelOpen ? (
            <div role="group" aria-label="Cancel reason" style={{ display: "grid", gap: 8 }}>
              {CANCEL_REASONS.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  className="sv-cta outline"
                  onClick={() => void cancelDraft(r.code)}
                  disabled={busy}
                >
                  {r.label}
                </button>
              ))}
              <button type="button" className="sv-cta outline" onClick={() => setCancelOpen(false)}>
                Keep the draft
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="sv-cta outline"
              onClick={() => setCancelOpen(true)}
              disabled={busy || bookingDraft === null}
              style={{ color: C.redDark }}
            >
              Cancel draft
            </button>
          )}
        </div>
        {failure !== null ? (
          <div role="alert" style={{ color: C.redDark, fontSize: 13, padding: "8px 2px" }}>
            The Store Hub refused: {failure}
          </div>
        ) : null}
      </div>
    );
  }

  // ------------------------------------------------------------------- main
  if (confirmation !== null) {
    const b = confirmation.booking;
    return (
      <div className="sv-step3-success-main" data-booking-state={b.status}>
        <div className="sv-step3-success-hero">
          <div className="sv-step3-success-icon" aria-hidden>
            ✓
          </div>
          <div className="sv-step3-success-title">
            {confirmation.outcome === "replayed"
              ? "Booking already confirmed"
              : "Booking confirmed"}
          </div>
          <div className="sv-step3-success-time">
            {formatHHmm(
              String(confirmation.receipt.payload["issued_at"] ?? new Date().toISOString()),
            )}
          </div>
        </div>
        <div className="sv-step3-success-booking">
          <div className="sv-step3-success-booking-label">Booking</div>
          <div className="sv-step3-success-booking-num">{b.booking_number}</div>
        </div>
        <div className="sv-step3-success-pills">
          <span className="sv-review-status-pill sv-review-status-pill--ok">
            {b.status.replace(/_/g, " ")}
          </span>
          <span className="sv-review-status-pill sv-review-status-pill--ok">
            paid {fmt(b.paid_minor)}
          </span>
          <span className="sv-review-status-pill sv-review-status-pill--ok">on the Store Hub</span>
        </div>
        <div className="sv-step3-success-panel">
          <ReceiptView confirmation={confirmation} />
          <div className="sv-step3-success-hint">
            The Booking, its payment and its receipt are recorded on the Store Hub (
            <em>committed locally</em>) and queued for the cloud.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sv-step3-review-main">
      <BookingMainHead marginBottom={12}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Review &amp; confirm</h3>
      </BookingMainHead>
      <div className="sv-review-split">
        <div className="sv-review-info-col hide-scrollbar">
          <div className="sv-review-card">
            <div className="sv-review-card-label">Customer</div>
            <div className="sv-review-card-value">{walkIn ? "Walk-in" : displayName}</div>
            <div className="sv-review-card-sub">{displayPhone}</div>
            {selCustomer ? (
              <div className="sv-review-card-sub">
                {selCustomer.preferredLanguage === "km-KH" ? "ខ្មែរ" : "English"} ·{" "}
                {selCustomer.syncState.replace(/_/g, " ")}
              </div>
            ) : null}
          </div>
          <div className="sv-review-card">
            <div className="sv-review-card-label">Payment</div>
            <div className="sv-review-card-value">
              {tender.total === 0n ? "—" : `Cash ${fmt(tender.total.toString())}`}
            </div>
            <div className="sv-review-card-sub">
              {tender.khr > 0n ? `${fmt(tender.khr.toString())} riel` : ""}
              {tender.khr > 0n && tender.usdCents > 0n ? " + " : ""}
              {tender.usdCents > 0n
                ? `$${(Number(tender.usdCents) / 100).toFixed(2)} (${fmt(tender.usdAsKhr.toString())})`
                : ""}
              {tender.total === 0n ? "enter the cash on the Pricing step" : ""}
            </div>
          </div>
          {quote !== null ? (
            <div className="sv-review-lines-card" data-quote-review>
              <div className="sv-review-section-hd">
                <span>Priced by the Store Hub</span>
              </div>
              {quote.lines.map((line) => (
                <div key={`${line.serviceId}-${line.quantity}`} className="sv-review-line">
                  <span className="sv-review-line-name">{line.displayName}</span>
                  <span className="sv-review-line-qty">
                    {line.pricingMethod === "per_weight"
                      ? `${Number(line.quantity).toString()} kg`
                      : `×${Number(line.quantity).toString()}`}
                  </span>
                  <span className="sv-review-line-price">{fmt(line.lineSubtotalMinor)}</span>
                </div>
              ))}
              {quote.express ? (
                <div className="sv-review-line">
                  <span className="sv-review-line-name">Express</span>
                  <span className="sv-review-line-qty" />
                  <span className="sv-review-line-price">{fmt(quote.expressSurchargeMinor)}</span>
                </div>
              ) : null}
              <div className="sv-review-line" style={{ fontWeight: 700 }}>
                <span className="sv-review-line-name">Total</span>
                <span className="sv-review-line-qty">{quote.currencyCode}</span>
                <span className="sv-review-line-price">{fmt(quote.totalMinor)}</span>
              </div>
            </div>
          ) : (
            <div className="sv-review-card">
              <div className="sv-review-card-label">Lines</div>
              <div className="sv-review-card-sub">
                {cart.length === 0
                  ? "No lines — add a service on the Items step."
                  : "Not priced by the Store Hub yet — go back to Pricing."}
              </div>
            </div>
          )}
          {custNote && (
            <div className="sv-review-note" role="note">
              <I.StickyNote s={16} c="currentColor" /> {custNote}
            </div>
          )}
          <div className="sv-review-card">
            <div className="sv-review-card-label">Staff note</div>
            <textarea
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              rows={2}
              aria-label="Staff note"
              placeholder="Optional — visible to staff only"
              style={{
                width: "100%",
                boxSizing: "border-box",
                borderRadius: 10,
                border: `1px solid ${C.border}`,
                padding: 10,
                fontSize: 14,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
