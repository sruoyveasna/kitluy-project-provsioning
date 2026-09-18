type IconProps = { s?: number; c?: string };

const Grid = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const Plus = ({ s = 20, c = "#fff" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const Book = ({ s = 20, c = "#fff" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 4a2 2 0 0 1 2-2h7v18H4a2 2 0 0 1-2-2V4Z" />
    <path d="M22 4a2 2 0 0 0-2-2h-7v18h7a2 2 0 0 0 2-2V4Z" />
  </svg>
);

const Search = ({ s = 20, c = "var(--sv-mute)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const Clock = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const User = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const Receipt = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2-3-2z" />
    <line x1="8" y1="10" x2="16" y2="10" />
    <line x1="8" y1="14" x2="12" y2="14" />
  </svg>
);

const Dollar = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const Settings = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const Printer = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

const Package = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M16.5 9.4l-9-5.19" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const ChevL = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevR = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const Check = ({ s = 20, c = "#fff" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="3"
    strokeLinecap="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const X = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

/** Delete/backspace — clear last digit on cash keypads (avoids flaky ⌫ font glyphs). */
const Backspace = ({ s = 22, c = "var(--sv-danger)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
    <line x1="18" y1="9" x2="12" y2="15" />
    <line x1="12" y1="9" x2="18" y2="15" />
  </svg>
);

const Lock = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const LogOut = ({ s = 20, c = "var(--sv-danger)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const Minus = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const QR = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <rect x="14" y="14" width="3" height="3" />
    <line x1="21" y1="14" x2="21" y2="21" />
    <line x1="14" y1="21" x2="21" y2="21" />
  </svg>
);

const CreditCard = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <rect x="1" y="4" width="22" height="16" rx="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const Wifi = ({ s = 16, c = "var(--sv-primary)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <circle cx="12" cy="20" r="1" fill={c} />
  </svg>
);

const Truck = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <rect x="1" y="3" width="15" height="13" />
    <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
    <circle cx="5.5" cy="18.5" r="2.5" />
    <circle cx="18.5" cy="18.5" r="2.5" />
  </svg>
);

const Barcode = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M3 5v14" />
    <path d="M8 5v14" />
    <path d="M12 5v14" />
    <path d="M17 5v14" />
    <path d="M21 5v14" />
  </svg>
);

const Refresh = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const CashDr = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <line x1="6" y1="12" x2="18" y2="12" />
    <circle cx="12" cy="12" r="1" fill={c} />
  </svg>
);

const Phone = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.7 2.35a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.75.34 1.54.57 2.35.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const Camera = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

const Droplets = ({ s = 20, c = "var(--sv-primary)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
    <path d="M16.7 19.3c3 0 5.3-2.37 5.3-5.18 0-1.57-.73-2.93-2.2-4.11C18.34 8.84 17 7.14 16.7 5.3c-.3 1.84-1.64 3.54-3.1 4.71-1.47 1.18-2.2 2.54-2.2 4.11 0 2.81 2.3 5.18 5.3 5.18z" />
  </svg>
);

const Monitor = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const ShieldCheck = ({ s = 20, c = "var(--sv-primary)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <polyline points="9 12 11 14 15 10" />
  </svg>
);

const MapPin = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const ArrowRight = ({ s = 20, c = "#fff" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const ArrowDown = ({ s = 20, c = "#fff" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);

const List = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <circle cx="4" cy="6" r="1" fill={c} />
    <circle cx="4" cy="12" r="1" fill={c} />
    <circle cx="4" cy="18" r="1" fill={c} />
  </svg>
);

const Clipboard = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </svg>
);

const Scale = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M8 21h8" />
    <path d="M12 17V3" />
    <path d="M2 11h4l2-6 4 10 4-10 2 6h4" />
  </svg>
);

const Wrench = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const Tag = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const RotateCw = Refresh;

const AlertTri = ({ s = 20, c = "var(--sv-warn)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const Layers = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

const Activity = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const Zap = ({ s = 20, c = "var(--sv-warn)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const PieChart = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    <path d="M22 12A10 10 0 0 0 12 2v10z" />
  </svg>
);

const Shield = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const Star = ({ s = 20, c = "var(--sv-warn)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

// ---- Service / category icons ----------------------------------------------

/** Wash & Fold — laundry basket. Used on the WF service tile, Dashboard
 *  cards, T2 customer display, and the bag-tier fixtures. */
const Basket = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 11h14l-1.5 9a2 2 0 0 1-2 1.7H8.5A2 2 0 0 1 6.5 20L5 11z" />
    <path d="M9 11l3-7 3 7" />
    <line x1="9" y1="14" x2="9" y2="18" />
    <line x1="12" y1="14" x2="12" y2="18" />
    <line x1="15" y1="14" x2="15" y2="18" />
  </svg>
);

/** Dry Clean — sparkles. Conveys the "premium / fresh" feel without
 *  resorting to ✨ emoji. Three-point burst stays recognizable at 20px. */
const Sparkles = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
    <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14z" />
    <path d="M5 16l.6 1.6L7 18l-1.4.4L5 20l-.6-1.6L3 18l1.4-.4L5 16z" />
  </svg>
);

/** Wash & Press — collared shirt. Used on the WP service tile and the
 *  garment-icon fallback in itemIcons.ts when nothing else matches. */
const Shirt = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20.4 7.7L16 4l-2 1-2 1.5L10 5 8 4 3.6 7.7a1 1 0 0 0-.3 1l1.6 3.6a1 1 0 0 0 .9.7H7v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-8h1.2a1 1 0 0 0 .9-.7l1.6-3.6a1 1 0 0 0-.3-1z" />
  </svg>
);

/** Plant — for T4 dispatch labels ("at plant", "🏭→🏪"). Stylized factory
 *  with two stacks. */
const Factory = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 21V11l5 3V11l5 3V8l8 4v9H3z" />
    <line x1="7" y1="17" x2="7" y2="19" />
    <line x1="12" y1="17" x2="12" y2="19" />
    <line x1="17" y1="17" x2="17" y2="19" />
  </svg>
);

/** Shop / storefront — for T4 dispatch labels ("at shop", "🏪→🏭"). */
const Store = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 9l1.5-5h15L21 9" />
    <path d="M5 9v11h14V9" />
    <path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    <path d="M10 20v-5h4v5" />
  </svg>
);

/** Bank — for ABA payment button. (KHQR has its own QR icon already; the
 *  generic "bank pillars" silhouette pairs with cash + card + QR for the
 *  full payment-method row.) */
const Bank = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 10l9-6 9 6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="6" y1="10" x2="6" y2="18" />
    <line x1="10" y1="10" x2="10" y2="18" />
    <line x1="14" y1="10" x2="14" y2="18" />
    <line x1="18" y1="10" x2="18" y2="18" />
    <line x1="3" y1="20" x2="21" y2="20" />
  </svg>
);

// ---- Decorative / status icons ---------------------------------------------

/** Sticky note — for cashier notes / order notes. Different silhouette
 *  from `Clipboard` so adjacent uses don't clash visually. */
const StickyNote = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11l5-5V5a2 2 0 0 0-2-2z" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
    <line x1="8" y1="9" x2="14" y2="9" />
    <line x1="8" y1="13" x2="12" y2="13" />
  </svg>
);

/** Sleung Coin — circular coin with a stylized "S". Used on Step3 review's
 *  loyalty card, T2 customer display's coin breakdown, and the Step0
 *  customer-tier chips. */
const Coin = ({ s = 20, c = "var(--sv-warn)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M15 8.5C14.4 8 13.3 7.5 12 7.5c-1.7 0-3 1-3 2.3 0 1.2 1.3 1.7 3 2.4 1.7.7 3 1.2 3 2.4 0 1.3-1.3 2.3-3 2.3-1.3 0-2.4-.5-3-1" />
    <line x1="12" y1="6" x2="12" y2="7.5" />
    <line x1="12" y1="16.5" x2="12" y2="18" />
  </svg>
);

/** Hourglass — pending / waiting state. Used in T4 ConveyorTab's "pending
 *  notification" banner. Differs from Clock (which shows scheduled times)
 *  to keep "in progress" semantics distinct from "scheduled". */
const Filter = ({ s = 20, c = "var(--sv-ink)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
);

const Hourglass = ({ s = 20, c = "var(--sv-warn)" }: IconProps) => (
  <svg
    width={s}
    height={s}
    viewBox="0 0 24 24"
    fill="none"
    stroke={c}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 2h12" />
    <path d="M6 22h12" />
    <path d="M6 2v4a6 6 0 0 0 6 6 6 6 0 0 0 6-6V2" />
    <path d="M6 22v-4a6 6 0 0 1 6-6 6 6 0 0 1 6 6v4" />
  </svg>
);

export const I = {
  Grid,
  Plus,
  Book,
  Search,
  Filter,
  Clock,
  User,
  Receipt,
  Dollar,
  Settings,
  Printer,
  Package,
  ChevL,
  ChevR,
  Check,
  X,
  Backspace,
  Lock,
  LogOut,
  Minus,
  QR,
  CreditCard,
  Wifi,
  Truck,
  Barcode,
  Refresh,
  CashDr,
  Phone,
  Camera,
  Droplets,
  Monitor,
  ShieldCheck,
  MapPin,
  ArrowRight,
  ArrowDown,
  List,
  Clipboard,
  Scale,
  Wrench,
  Tag,
  RotateCw,
  AlertTri,
  Layers,
  Activity,
  Zap,
  PieChart,
  Shield,
  Star,
  // Service / category (Phase IC-2a additions)
  Basket,
  Sparkles,
  Shirt,
  Factory,
  Store,
  Bank,
  // Decorative / status
  StickyNote,
  Coin,
  Hourglass,
};

export type IconKey = keyof typeof I;
