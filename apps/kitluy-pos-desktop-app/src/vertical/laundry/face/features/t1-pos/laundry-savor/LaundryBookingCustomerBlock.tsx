import { Step0Customer } from "../new-order/Step0Customer";

/** Step 0 rail — customer search, preview, and phone numpad. */
export const LaundryBookingCustomerBlock = () => (
  <div
    style={{
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    }}
  >
    <Step0Customer layout="rail" />
  </div>
);
