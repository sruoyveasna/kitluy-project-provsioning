/**
 * T1 shell: top bar, the routed view, the toast.
 *
 * PROVENANCE: donor `T1POS.tsx` (kitluy-laundry-pos-desk-app@8b2f107). The
 * swipe-tabs, the T2 publisher and the six donor views are gone; `new_order`
 * is the one built experience and every other view renders `NotAvailable`.
 */
import { useAppState } from "@face/app/useAppState";
import { ToastBar } from "@face/components/common/ToastBar";
import { LaundrySavorShell } from "@face/components/laundry/LaundrySavorShell";
import { ScreenFrame } from "@face/components/layout/ScreenFrame";
import { KIOSK } from "@face/styles/kiosk";

import { LaundryTopBar, type TerminalFacts } from "./laundry-savor/LaundryTopBar";
import { NewOrder } from "./new-order/NewOrder";
import { NotAvailable } from "./NotAvailable";

export const T1POS = ({ terminal }: { readonly terminal: TerminalFacts }) => {
  const { view, toast } = useAppState();
  return (
    <ScreenFrame>
      <LaundrySavorShell>
        <LaundryTopBar terminal={terminal} />
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            className="hide-scrollbar"
            data-t1-view={view}
            style={{
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              overflow: view === "new_order" ? "hidden" : "auto",
              padding:
                view === "new_order"
                  ? 0
                  : `0 ${String(KIOSK.contentPad)}px ${String(KIOSK.contentPad)}px`,
              ...(view === "new_order"
                ? { display: "flex", flexDirection: "column" as const }
                : {}),
            }}
          >
            {view === "new_order" ? <NewOrder /> : <NotAvailable view={view} />}
          </div>
        </main>
        <ToastBar message={toast} />
      </LaundrySavorShell>
    </ScreenFrame>
  );
};
