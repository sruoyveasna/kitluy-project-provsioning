import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "KitLuy — Storefront",
  description: "Scan, Prepare & Queue — Laundry pre-intake for customers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="km">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
