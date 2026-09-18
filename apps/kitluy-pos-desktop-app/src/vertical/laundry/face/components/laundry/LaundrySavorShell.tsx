import type { ReactNode } from "react";
import "@face/styles/laundry-savor.css";
import "@face/styles/savor-topbar.css";
import "@face/styles/savor-workspace.css";

/** T1 shell — theme tokens come from savor-theme.css on `.lsv-shell`. */
export const LaundrySavorShell = ({ children }: { children: ReactNode }) => (
  <div className="lsv-shell">{children}</div>
);
