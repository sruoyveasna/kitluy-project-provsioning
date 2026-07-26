import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "KitLuy — B2B Website",
  description: "Create digitally. Operate physically. Sell everywhere.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="km">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
