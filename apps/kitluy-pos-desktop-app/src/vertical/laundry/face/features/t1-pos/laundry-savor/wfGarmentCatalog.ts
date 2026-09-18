/**
 * PROVENANCE: donor `wfGarmentCatalog.ts`. The `WF_ITEMS` garment fixture
 * fallback is gone: the checklist is the garment vocabulary the Store Hub
 * delivered, or nothing.
 */
import type { CartItem, WFItem } from "@face/types";

export type GarmentChecklistItem = {
  id: string;
  name: string;
  icon: string;
  iconPath?: string | null;
  category: string;
  categorySortOrder?: number | null;
};

/** The delivered garment vocabulary as checklist rows; empty when none was delivered. */
export function getWfChecklistItems(garmentTypes: readonly WFItem[]): GarmentChecklistItem[] {
  return garmentTypes.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    category: c.category.trim() || "Other",
    categorySortOrder: c.categorySortOrder ?? null,
  }));
}

/** One declared Wash & Fold garment, resolved for commit + receipt. */
export interface ResolvedWfGarment {
  /** `catalog.service_items.id` when the checklist id is numeric, else null. */
  serviceItemId: number | null;
  name: string;
  icon: string;
  quantity: number;
}

/**
 * Turn the WF garment-checklist quantity map (`wfItemQtys`: checklist id → qty)
 * into resolved garment rows, using the checklist for names/icons. These become
 * zero-priced `ops.order_items` rows on commit and manifest lines on the
 * receipt. Entries with a non-positive quantity are dropped.
 */
export function resolveWfGarments(
  wfItemQtys: Record<string, number>,
  checklist: GarmentChecklistItem[],
): ResolvedWfGarment[] {
  const byId = new Map(checklist.map((c) => [c.id, c]));
  const out: ResolvedWfGarment[] = [];
  for (const [id, qty] of Object.entries(wfItemQtys)) {
    if (!qty || qty <= 0) continue;
    const item = byId.get(id);
    out.push({
      serviceItemId: null,
      name: item?.name ?? id,
      icon: item?.icon ?? "🧺",
      quantity: qty,
    });
  }
  return out;
}

/**
 * Declared WF garments as zero-priced `CartItem`s for DISPLAY surfaces only
 * (Pricing table, receipt preview, printed receipt). The real cart keeps just
 * the priced kilogram line; these rows exist purely to show the bag's contents
 * and never affect pricing or commit.
 */
export function wfGarmentCartItems(
  wfItemQtys: Record<string, number>,
  checklist: GarmentChecklistItem[],
): CartItem[] {
  return resolveWfGarments(wfItemQtys, checklist).map((g) => ({
    id: `wfg-${g.name}`,
    name: g.name,
    icon: g.icon,
    price: 0,
    qty: g.quantity,
    svc: "wf",
  }));
}
