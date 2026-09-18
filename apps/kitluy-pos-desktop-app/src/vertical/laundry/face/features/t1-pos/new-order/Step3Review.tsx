/**
 * Review step — open the Booking Draft on the Store Hub.
 *
 * PROVENANCE: donor `Step3Review.tsx` (kitluy-laundry-pos-desk-app@8b2f107,
 * 1 021 lines). Kept: the review cards and the post-commit success rhythm
 * (`.sv-review-*`, `.sv-step3-success-*`). Gone: receipt canvas + printing
 * (T005/T006), ABA PayWay (T005), loyalty (no authority), the fixture commit.
 *
 * What "confirm" means here is exactly what the Store Hub offers a terminal
 * today: a LAUNDRY BOOKING DRAFT (WS-12-T002) with the customer snapshot and
 * the notes. The cart lines are shown but NOT saved — Booking lines are
 * WS-12-T003 — and the screen says so. A draft is labelled a DRAFT with its
 * sync state, never a Booking (T002 §6).
 */
import { useState } from "react";

import { useThemeColors } from "@face/app/ThemeProvider";
import { useAppState } from "@face/app/useAppState";
import { I } from "@face/components/common/icons";
import { ServiceItemIcon } from "@face/components/common/ServiceItemIcon";
import { fmt } from "@face/lib/formatters";
import { iconForItemName } from "@face/lib/itemIcons";
import { formatPhoneLocal } from "@face/lib/phone";
import { serviceLabel } from "@face/lib/serviceCatalog";
import type { ServiceType } from "@face/types";

import { BookingMainHead } from "../laundry-savor/BookingMainHead";

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

export const Step3Review = ({ layout }: { layout: "main" | "panel" }) => {
  const C = useThemeColors();
  const {
    ports,
    cart,
    cartSubtotal,
    cartCount,
    custName,
    custPhone,
    custNote,
    custLanguage,
    staffNote,
    setStaffNote,
    selCustomer,
    bookingDraft,
    setBookingDraft,
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

  const openDraft = async () => {
    if (busy || bookingDraft !== null) return;
    setBusy(true);
    setFailure(null);
    const r = await ports.createDraft({
      customerId: selCustomer?.id ?? null,
      walkIn,
      preferredLanguage: selCustomer?.preferredLanguage ?? custLanguage,
      customerNotes: custNote,
      staffNotes: staffNote,
    });
    setBusy(false);
    if (!r.ok) {
      setFailure(`${r.kind.replace(/_/g, " ")} — ${r.detail}`);
      return;
    }
    setBookingDraft({ draft: r.value, lastOperation: "created" });
    showToast("✓ Booking Draft opened on the Store Hub");
  };

  const saveNotes = async () => {
    if (busy || bookingDraft === null) return;
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
    if (busy || bookingDraft === null) return;
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

  const sections = (["wf", "pp"] as const satisfies readonly ServiceType[])
    .map((svc) => ({ svc, items: cart.filter((c) => c.svc === svc) }))
    .filter((s) => s.items.length > 0);

  // ------------------------------------------------------------------ panel
  if (layout === "panel") {
    if (bookingDraft !== null) {
      const d = bookingDraft.draft;
      return (
        <div className="sv-step3-review-panel" data-draft-state={d.lifecycle}>
          <div className="sv-review-panel-cards hide-scrollbar">
            <div className="sv-review-card">
              <div className="sv-review-card-label">Booking Draft</div>
              <div className="sv-review-card-value">{d.draftId.slice(0, 8)}</div>
              <div className="sv-review-card-sub">
                {d.lifecycle} · v{d.version} · {d.syncState.replace(/_/g, " ")}
              </div>
              <div className="sv-review-card-sub">
                {bookingDraft.lastOperation === "created" ? "Opened" : "Updated"}{" "}
                {formatHHmm(d.updatedAt)}
              </div>
            </div>
          </div>
          <div className="sv-review-confirm-stack">
            <button type="button" className="sv-cta" onClick={resetOrder} disabled={busy}>
              Start new booking
            </button>
            <button
              type="button"
              className="sv-cta outline"
              onClick={() => void saveNotes()}
              disabled={busy}
            >
              {busy ? "Saving…" : "Save notes"}
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
                <button
                  type="button"
                  className="sv-cta outline"
                  onClick={() => setCancelOpen(false)}
                >
                  Keep the draft
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="sv-cta outline"
                onClick={() => setCancelOpen(true)}
                disabled={busy}
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
    return (
      <div className="sv-step3-review-panel">
        <div className="sv-review-panel-cards hide-scrollbar">
          <div className="sv-review-card">
            <div className="sv-review-card-label">Booking preview</div>
            <span className="sv-review-badge">
              Draft id assigned by the Store Hub on confirmation
            </span>
            <div className="sv-review-card-sub" style={{ marginTop: 6 }}>
              {walkIn ? "Walk-in (no customer record)" : `For ${displayName}`}
            </div>
            <div className="sv-review-card-sub">
              {cartCount} line{cartCount === 1 ? "" : "s"} shown · lines are saved in WS-12-T003
            </div>
          </div>
          <div className="sv-review-card">
            <div className="sv-review-card-label">Preview subtotal</div>
            <div className="sv-review-card-value sv-review-card-value--lg">{fmt(cartSubtotal)}</div>
            <div className="sv-review-card-sub">not a Booking price</div>
          </div>
        </div>
        <div className="sv-review-confirm-stack">
          <button
            type="button"
            className="sv-cta"
            onClick={() => void openDraft()}
            disabled={busy}
            data-action="open-draft"
          >
            {busy ? "Opening on the Store Hub…" : "Open Booking Draft"}
          </button>
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
  if (bookingDraft !== null) {
    const d = bookingDraft.draft;
    return (
      <div className="sv-step3-success-main" data-draft-state={d.lifecycle}>
        <div className="sv-step3-success-hero">
          <div className="sv-step3-success-icon" aria-hidden>
            ✓
          </div>
          <div className="sv-step3-success-title">Booking Draft opened</div>
          <div className="sv-step3-success-time">{formatHHmm(d.createdAt)}</div>
        </div>
        <div className="sv-step3-success-booking">
          <div className="sv-step3-success-booking-label">Draft</div>
          <div className="sv-step3-success-booking-num">{d.draftId}</div>
        </div>
        <div className="sv-step3-success-pills">
          <span className="sv-review-status-pill sv-review-status-pill--ok">{d.lifecycle}</span>
          <span className="sv-review-status-pill sv-review-status-pill--ok">
            {d.syncState.replace(/_/g, " ")}
          </span>
          <span className="sv-review-status-pill sv-review-status-pill--ok">v{d.version}</span>
        </div>
        <div className="sv-step3-success-panel">
          <div className="sv-review-card">
            <div className="sv-review-card-label">Customer snapshot</div>
            <div className="sv-review-card-value">
              {typeof d.customerSnapshot["displayName"] === "string"
                ? d.customerSnapshot["displayName"]
                : d.walkIn
                  ? "Walk-in"
                  : displayName}
            </div>
            <div className="sv-review-card-sub">
              {d.preferredLanguage} · {d.intakeSource}
            </div>
          </div>
          <div className="sv-review-card">
            <div className="sv-review-card-label">Staff note</div>
            <textarea
              value={staffNote}
              onChange={(e) => setStaffNote(e.target.value)}
              rows={2}
              aria-label="Staff note"
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
          <div className="sv-step3-success-hint">
            The draft lives on the Store Hub (<em>local authoritative</em>) and is queued for the
            cloud. Lines and price follow in WS-12-T003 / T004.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sv-step3-review-main">
      <BookingMainHead marginBottom={12}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Review &amp; open the draft</h3>
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
            <div className="sv-review-card-sub">Not available yet — WS-12-T005.</div>
          </div>
          {sections.length > 0 ? (
            <div className="sv-review-lines-card">
              {sections.map((section) => (
                <div key={section.svc}>
                  <div className="sv-review-section-hd">
                    <span>{serviceLabel(section.svc)}</span>
                  </div>
                  {section.items.map((c) => (
                    <div key={c.id} className="sv-review-line">
                      <ServiceItemIcon
                        iconPath={c.icon}
                        sizePx={20}
                        fallback={iconForItemName(c.name, 16)}
                      />
                      <span className="sv-review-line-name">{c.name}</span>
                      <span className="sv-review-line-qty">×{c.qty}</span>
                      <span className="sv-review-line-price">
                        {c.price === 0 ? "" : fmt(c.price * c.qty)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="sv-review-card-sub" style={{ padding: "8px 12px" }}>
                Shown for the counter only — Booking lines are saved in WS-12-T003.
              </div>
            </div>
          ) : (
            <div className="sv-review-card">
              <div className="sv-review-card-label">Lines</div>
              <div className="sv-review-card-sub">No lines — a draft can open without them.</div>
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
