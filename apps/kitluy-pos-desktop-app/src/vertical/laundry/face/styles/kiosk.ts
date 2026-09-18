/**
 * Kiosk / touchscreen layout constants.
 *
 * Target hardware: 15.6" touchscreen monitor at 1920×1080.
 * Numbers are tuned for full-screen kiosk use, NOT a desktop browser:
 *   - sidebar width is wide enough for 22px icon + 16px label + tap padding
 *   - header height clears OS bezels and gives a comfortable secondary nav
 *   - content padding leans dense (cashier flow), but leaves breathing room
 *   - minTap is the *finger* target — buttons should never be smaller
 *
 * Use these constants instead of hard-coding pixel values in screen
 * shells, so future hardware/resolution tweaks are a one-line change.
 */
export const KIOSK = {
  /** T1/T4 sidebar nav width (px). */
  sidebarW: 260,
  /** Top header bar height in main shells (px). Tuned for touch. */
  headerH: 64,
  /** Horizontal / bottom padding inside the main route area (px). Top gap is 0 to match Café Savor. */
  contentPad: 20,
  /** Card / panel corner radius (px). */
  radius: 16,
  /** Minimum touch target & canonical `Btn` height (px); Shift Open/Close CTAs use this strip. */
  minTap: 56,
} as const;

/**
 * Inline-style props every interactive element should spread to feel snappy
 * on a touchscreen — kills the 300ms double-tap zoom delay and the grey
 * tap highlight, and disables accidental text-selection on tap-and-hold.
 */
export const touchInteractive = {
  touchAction: "manipulation" as const,
  WebkitTapHighlightColor: "transparent" as const,
  userSelect: "none" as const,
};
