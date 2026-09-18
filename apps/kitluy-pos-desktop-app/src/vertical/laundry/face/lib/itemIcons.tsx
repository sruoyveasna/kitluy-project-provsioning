/**
 * Icons for catalog services and garments.
 *
 * PROVENANCE: donor `src/lib/itemIcons.ts` mapped garment NAMES to emoji. A Pi
 * Terminal image carries no emoji font (Khmer OS + DejaVu only), so emoji
 * render as boxes there; the mapping now yields the face's own SVG icons, by
 * the same name-matching idea. Unmatched names fall back to a package.
 */
import type { ReactNode } from "react";

import { I } from "@face/components/common/icons";

const GARMENT = /shirt|blouse|dress|suit|jacket|coat|trouser|pant|skirt|uniform|tie|polo|t-shirt/iu;
const LINEN = /bed|sheet|curtain|blanket|duvet|towel|pillow|linen|cover/iu;
const LOAD = /kg|kilo|wash|fold|load|bag|basket/iu;

export function iconForItemName(name: string, size = 20, color = "currentColor"): ReactNode {
  const n = name.trim();
  if (GARMENT.test(n)) return <I.Shirt s={size} c={color} />;
  if (LINEN.test(n)) return <I.Layers s={size} c={color} />;
  if (LOAD.test(n)) return <I.Basket s={size} c={color} />;
  return <I.Package s={size} c={color} />;
}

/** Emoji (extended pictographic) — the Pi cannot draw them, callers fall back to an SVG. */
export const isEmojiGlyph = (s: string): boolean => /\p{Extended_Pictographic}/u.test(s);
