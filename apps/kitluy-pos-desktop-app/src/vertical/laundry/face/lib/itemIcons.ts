/**
 * Icons for laundry SKUs. `catalog.service_items` has no icon column, so the
 * UI layer owns this mapping by item **name** (case-insensitive, trimmed).
 * Unmatched names fall back to the generic 📦 so the grid still renders.
 */
const ICONS: Record<string, string> = {
  // Dry Clean
  "men's suit (2-piece)": "👔",
  "men's suit (3-piece)": "🤵",
  "dress shirt": "👕",
  blouse: "👚",
  "evening dress": "👗",
  dress: "👗",
  skirt: "🩱",
  "winter coat": "🧥",
  "leather jacket": "🧥",
  "curtains (per panel)": "🪟",
  "curtains (per pair)": "🪟",
  "bed sheet set": "🛏️",
  "bed sheet": "🛏️",
  pillowcase: "🛏️",
  "express shirt service": "⚡",
  "express suit service": "⚡",
  "trousers/pants": "👖",
  "trousers / pants": "👖",
  pants: "👖",
  tie: "👔",
  "sweater/cardigan": "🧶",
  "sweater / cardigan": "🧶",
  sweater: "🧶",
  "hoodie / sweater": "🧶",
  jeans: "👖",
  pant: "👖",
  "starch add-on": "🧴",
  // Wash & Press extras
  "t-shirt": "👕",
  "polo shirt": "👕",
  shirt: "👕",
  shorts: "🩳",
  // Wash & Fold extras
  jacket: "🧥",
  underwear: "🩲",
  "socks (pair)": "🧦",
  towel: "🛁",
  "scarf / shawl": "🧣",
  "uniform set": "🥋",
};

export const iconForItemName = (name: string): string => ICONS[name.trim().toLowerCase()] ?? "📦";
