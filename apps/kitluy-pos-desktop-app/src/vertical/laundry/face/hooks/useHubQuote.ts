/**
 * The Store Hub prices the cart — T1-REAL-OPERATIONS-001 slice 2.
 *
 * Two effects, in order:
 *   1. the Booking Draft the quote and the confirm are keyed on exists on the
 *      Hub for the customer the cashier chose (a draft's customer binding is
 *      FROZEN — 0040 guard — so a changed choice cancels the draft and opens a
 *      new one; nothing is silently re-bound);
 *   2. whenever the priceable lines or the express flag change, the Hub is
 *      asked for its price. What it answers is the ONLY figure the face calls
 *      a Booking price; a refusal is shown with its reason, never guessed past.
 *
 * Nothing runs once the booking is confirmed.
 */
import { useEffect, useRef, useState } from "react";

import { useAppState } from "@face/app/useAppState";

export function useHubQuote(active: boolean): { readonly busy: boolean } {
  const {
    ports,
    bookingDraft,
    setBookingDraft,
    cartLines,
    express,
    setQuote,
    setQuoteFailure,
    selCustomer,
    custLanguage,
    custNote,
    staffNote,
    confirmation,
  } = useAppState();
  const [busy, setBusy] = useState(false);
  const opening = useRef(false);

  const wantedCustomerId = selCustomer?.id ?? null;
  const draftId = bookingDraft?.draft.draftId ?? null;
  const draftCustomerId = bookingDraft?.draft.customerId ?? null;
  const draftBound = bookingDraft !== null && draftCustomerId === wantedCustomerId;

  // 1. The draft, bound to the chosen customer.
  useEffect(() => {
    if (!active || confirmation !== null || draftBound || opening.current) return;
    opening.current = true;
    setBusy(true);
    void (async () => {
      try {
        if (bookingDraft !== null && bookingDraft.draft.lifecycle === "open") {
          await ports.cancelDraft({
            draftId: bookingDraft.draft.draftId,
            reasonCode: "entered_in_error",
          });
          setBookingDraft(null);
        }
        const r = await ports.createDraft({
          customerId: wantedCustomerId,
          walkIn: wantedCustomerId === null,
          preferredLanguage: selCustomer?.preferredLanguage ?? custLanguage,
          customerNotes: custNote,
          staffNotes: staffNote,
        });
        if (!r.ok) {
          setQuoteFailure(`${r.kind.replace(/_/g, " ")} — ${r.detail}`);
          return;
        }
        setBookingDraft({ draft: r.value, lastOperation: "created" });
      } finally {
        opening.current = false;
        setBusy(false);
      }
    })();
    // The customer-note and staff-note values are snapshot at draft creation;
    // later edits are saved through the Review step's "Save notes". The
    // dependency list is deliberately narrower than the closure: the notes
    // and the draft object are read, not watched.
  }, [active, confirmation, draftBound, wantedCustomerId]);

  // 2. The Hub's price for the lines.
  useEffect(() => {
    if (!active || confirmation !== null || draftId === null || !draftBound) return;
    if (cartLines.length === 0) {
      setQuote(null);
      setQuoteFailure("Add at least one service to price the booking.");
      return;
    }
    let cancelled = false;
    setBusy(true);
    void ports.quote({ draftId, lines: cartLines, express }).then((q) => {
      if (cancelled) return;
      if (!q.ok) {
        setQuote(null);
        setQuoteFailure(`${q.kind.replace(/_/g, " ")} — ${q.detail}`);
      } else {
        setQuote(q.value);
        setQuoteFailure(null);
      }
      setBusy(false);
    });
    return () => {
      cancelled = true;
    };
  }, [active, confirmation, draftId, draftBound, cartLines, express]);

  return { busy };
}
