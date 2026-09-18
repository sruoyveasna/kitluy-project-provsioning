/**
 * The honest face of a view that is not built for a Pi Terminal yet.
 *
 * The donor shipped Dashboard, Order Queue, Handoff, Close Shift and Settings
 * against Supabase directly; the disposition register gates each to its
 * WS-12 task (T003 handoff/storage, T007 settings) or marks it OWNER-DECISION
 * (shift/cash-drawer authority). The navigation keeps the designed shape; the
 * view says what is missing and why, and never renders fixture data.
 */
import { useThemeColors } from "@face/app/ThemeProvider";
import type { T1View } from "@face/types";

const REASONS: Record<Exclude<T1View, "new_order">, { title: string; body: string }> = {
  dashboard: {
    title: "Dashboard",
    body: "Today's bookings and ready-for-pickup counts come from the Store Hub's Booking queries (WS-12-T003/T007). Nothing is queued on this terminal yet.",
  },
  orders: {
    title: "Order queue",
    body: "The Booking queue is read from the Store Hub once Booking lines and lifecycle exist on a terminal (WS-12-T003). Until then this list would be invented.",
  },
  handoff: {
    title: "Handoff",
    body: "Pickup hand-over is the T4 → T1 loop over the Store Hub (WS-12-T003 custody events). Not yet delivered to a Pi Terminal.",
  },
  shift_close: {
    title: "Close shift",
    body: "Shift and cash-drawer authority is an OWNER DECISION still open in the disposition register (F-15, F-55). No shift is opened or closed on a Pi Terminal.",
  },
  settings: {
    title: "Settings",
    body: "A Pi Terminal has no local settings: identity, Store, Hub, profile and configuration bind through provisioning and pairing (WS-11) and are shown in the terminal menu.",
  },
};

export const NotAvailable = ({ view }: { view: Exclude<T1View, "new_order"> }) => {
  const C = useThemeColors();
  const r = REASONS[view];
  return (
    <section
      role="status"
      data-not-available={view}
      style={{
        margin: "24px auto",
        maxWidth: 720,
        borderRadius: 16,
        border: `1.5px dashed ${C.border}`,
        background: C.card,
        padding: "28px 26px",
      }}
    >
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>
        {r.title} — not available yet
      </h2>
      <p style={{ fontSize: 14, color: C.textSec, margin: 0, lineHeight: 1.55 }}>{r.body}</p>
    </section>
  );
};
