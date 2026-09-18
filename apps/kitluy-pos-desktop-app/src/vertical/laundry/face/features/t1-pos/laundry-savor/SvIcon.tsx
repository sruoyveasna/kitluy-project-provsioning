import type { ReactNode } from "react";

/** Lucide-style inline icons — port of Café Savor SvIcon */
export function SvIcon({
  name,
  size = 22,
  stroke = 1.8,
  className,
}: {
  name: string;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const P: Record<string, ReactNode> = {
    dashboard: (
      <>
        <path d="M12 3 3 8l9 5 9-5z" />
        <path d="m3 14 9 5 9-5" />
        <path d="m3 11 9 5 9-5" />
      </>
    ),
    book: (
      <>
        <path d="M2 4a2 2 0 0 1 2-2h7v18H4a2 2 0 0 1-2-2V4Z" />
        <path d="M22 4a2 2 0 0 0-2-2h-7v18h7a2 2 0 0 0 2-2V4Z" />
      </>
    ),
    box: (
      <>
        <rect x="3" y="6" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M9 6V4h6v2" />
      </>
    ),
    table: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 12h18" />
        <path d="M9 18v2" />
        <path d="M15 18v2" />
      </>
    ),
    clipboard: (
      <>
        <rect x="6" y="4" width="12" height="18" rx="2" />
        <path d="M9 4h6v3H9z" />
        <path d="M9 12h6" />
        <path d="M9 16h6" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </>
    ),
    plus: (
      <>
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </>
    ),
    minus: <path d="M5 12h14" />,
    trash: (
      <>
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </>
    ),
    bell: (
      <>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </>
    ),
    more: (
      <>
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
        <circle cx="5" cy="12" r="1" />
      </>
    ),
    check: <path d="M20 6 9 17l-5-5" />,
    user: (
      <>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    backArrow: (
      <>
        <path d="m12 19-7-7 7-7" />
        <path d="M19 12H5" />
      </>
    ),
    lock: (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15.5 14.5" />
      </>
    ),
    close: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    receipt: (
      <>
        <path d="M4 2v20l2.5-1.5L9 22l3-1.5L15 22l2.5-1.5L20 22V2l-2.5 1.5L15 2l-3 1.5L9 2 6.5 3.5 4 2Z" />
        <path d="M8 8h8" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {P[name] ?? null}
    </svg>
  );
}
