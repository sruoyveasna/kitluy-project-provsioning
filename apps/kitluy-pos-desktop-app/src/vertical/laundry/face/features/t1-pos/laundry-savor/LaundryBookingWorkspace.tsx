import type { ReactNode } from "react";

/** Café-style two-column workspace: main (left) + booking panel (right). */
export const LaundryBookingWorkspace = ({
  main,
  panel,
  bookingStep,
}: {
  main: ReactNode;
  panel: ReactNode;
  /** When 1 (customer step), aligns left keyboard band with right numpad (above CTAs). */
  bookingStep?: number;
}) => (
  <div className="sv-booking-workspace" data-booking-step={bookingStep ?? undefined}>
    <div className="sv-booking-main-col">{main}</div>
    {panel}
  </div>
);
