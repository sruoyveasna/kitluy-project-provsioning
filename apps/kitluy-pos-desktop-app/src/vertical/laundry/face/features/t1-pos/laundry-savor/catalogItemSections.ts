/**
 * PROVENANCE: donor `catalogItemSections.ts`, minus its fixture category list —
 * sections come from the delivered catalog only.
 */
import type { LaundryItemCategory } from "@face/types";

const OTHER_SORT = 9999;

export type CatalogSection<T> = { category: string; items: T[] };

export type CategorizableItem = {
  category?: string | null;
  categorySortOrder?: number | null;
};

export type CategoryDef = { name: string; sortOrder: number };

export function laundryCategoriesToDefs(
  categories: LaundryItemCategory[] | undefined,
): CategoryDef[] {
  return (categories ?? []).map((c) => ({ name: c.name, sortOrder: c.sortOrder }));
}

function resolveCategorySort(item: CategorizableItem, category: string): number {
  if (item.categorySortOrder != null && Number.isFinite(item.categorySortOrder)) {
    return item.categorySortOrder;
  }
  return category === "Other" ? OTHER_SORT : OTHER_SORT - 1;
}

/** Group items by `catalog.item_categories.name`; order follows the DB category list. */
export function groupItemsByCategory<T extends CategorizableItem>(
  items: T[],
  categoryDefs?: CategoryDef[],
): CatalogSection<T>[] {
  const buckets = new Map<string, T[]>();

  for (const item of items) {
    const cat = item.category?.trim() || "Other";
    const list = buckets.get(cat) ?? [];
    list.push(item);
    buckets.set(cat, list);
  }

  if (categoryDefs?.length) {
    const sections = categoryDefs
      .map((def) => ({
        category: def.name,
        items: buckets.get(def.name) ?? [],
      }))
      .filter((section) => section.items.length > 0);

    const other = buckets.get("Other");
    if (other && other.length > 0) {
      sections.push({ category: "Other", items: other });
    }
    return sections;
  }

  const ranked = [...buckets.entries()].map(([category, sectionItems]) => ({
    category,
    sortOrder: sectionItems.reduce(
      (min, item) => Math.min(min, resolveCategorySort(item, category)),
      9999,
    ),
    items: sectionItems,
  }));

  ranked.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.category.localeCompare(b.category);
  });

  return ranked.map(({ category, items: sectionItems }) => ({
    category,
    items: sectionItems,
  }));
}

export function filterSectionsByCategory<T>(
  sections: CatalogSection<T>[],
  categories: LaundryItemCategory[] | undefined,
  selectedCategoryId: string | null,
): CatalogSection<T>[] {
  if (!selectedCategoryId) return sections;
  const name = (categories ?? []).find((c) => c.id === selectedCategoryId)?.name;
  if (!name) return sections;
  return sections.filter((s) => s.category === name);
}
