/**
 * PROVENANCE: donor `src/components/common/ServiceItemIcon.tsx`. The storage
 * URL resolver (`lib/catalog-icon` → Supabase storage) is gone: a terminal
 * loads no remote image, so an icon is an emoji glyph or the fallback.
 */
import { type CSSProperties, type ReactNode } from "react";

interface ServiceItemIconProps {
  /**
   * `catalog.service_items.icon_path` (emoji glyph OR storage object key
   * OR full URL). When null/undefined/empty, renders `fallback`.
   */
  iconPath?: string | null;
  /** Square box size in px (drives both <img> and emoji font size). */
  sizePx?: number;
  /** Shown when iconPath is missing or fails to load (e.g. legacy emoji). */
  fallback?: ReactNode;
  /** Optional inline style overrides applied to the wrapper element. */
  style?: CSSProperties;
  /** Optional className passthrough for callers that style externally. */
  className?: string;
}

/**
 * Renders a catalog icon:
 *   - emoji glyph  → <span> text
 *   - empty        → `fallback`
 *
 * Mirrors the PlantOS `<ServiceItemIcon />` component, but uses inline
 * styles instead of Tailwind classes (this app does not use Tailwind).
 */
export const ServiceItemIcon = ({
  iconPath,
  sizePx = 24,
  fallback = null,
  style,
  className,
}: ServiceItemIconProps) => {
  const trimmed = iconPath?.trim();

  if (!trimmed) {
    return <>{fallback}</>;
  }

  // Emoji or unknown short string — render as inline text. Size keys off
  // sizePx so callers can scale both <img> and emoji together.
  const emojiFontSize = Math.max(10, Math.round(sizePx * 0.95));
  return (
    <span
      role="img"
      aria-hidden
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: sizePx,
        height: sizePx,
        fontSize: emojiFontSize,
        lineHeight: 1,
        userSelect: "none",
        ...style,
      }}
    >
      {trimmed}
    </span>
  );
};
