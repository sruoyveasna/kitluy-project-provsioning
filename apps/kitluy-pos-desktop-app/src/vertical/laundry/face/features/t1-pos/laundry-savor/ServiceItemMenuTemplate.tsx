import { useMemo, type ReactNode } from "react";
import { useThemeColors } from "@face/app/ThemeProvider";
import type { LaundryItemCategory } from "@face/types";
import {
  type CategorizableItem,
  filterSectionsByCategory,
  groupItemsByCategory,
  laundryCategoriesToDefs,
} from "./catalogItemSections";
import { ServiceCatalogSections } from "./ServiceCatalogSections";
import { ServiceCategoryPicker } from "./ServiceCategoryPicker";
import { SERVICE_MENU_GRID_INSET } from "./serviceMenuLayout";

type Props<T extends CategorizableItem> = {
  items: T[];
  categories: LaundryItemCategory[] | undefined;
  selectedCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  accentColor: string;
  renderItem: (item: T) => ReactNode;
  loading?: boolean;
  error?: unknown;
  emptyMessage?: string;
};

/**
 * Shared item menu shell for Dry Clean, Wash & Press, and Wash & Fold:
 * category chips + flat item grid (no section headers).
 */
export function ServiceItemMenuTemplate<T extends CategorizableItem>({
  items,
  categories,
  selectedCategoryId,
  onSelectCategory,
  accentColor,
  renderItem,
  loading = false,
  error,
  emptyMessage,
}: Props<T>) {
  const C = useThemeColors();

  const categoryDefs = useMemo(() => laundryCategoriesToDefs(categories), [categories]);
  const itemSections = useMemo(
    () => groupItemsByCategory(items, categoryDefs),
    [items, categoryDefs],
  );
  const visibleSections = useMemo(
    () => filterSectionsByCategory(itemSections, categories, selectedCategoryId),
    [itemSections, categories, selectedCategoryId],
  );

  const selectedCategoryName = useMemo(() => {
    if (!selectedCategoryId) return null;
    const list = categories && categories.length > 0 ? categories : undefined;
    return list?.find((c) => c.id === selectedCategoryId)?.name ?? null;
  }, [categories, selectedCategoryId]);

  const gridItemCount = visibleSections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="sv-service-item-menu">
      {loading && (
        <div style={{ fontSize: 13, color: C.textSec, padding: 12 }}>Loading catalog…</div>
      )}
      {error != null && (
        <div
          style={{
            fontSize: 13,
            color: C.red,
            background: C.redLight,
            padding: 12,
            borderRadius: 8,
          }}
        >
          Catalog fetch failed: {error instanceof Error ? error.message : String(error)}
        </div>
      )}
      {!loading && !error && items.length === 0 && emptyMessage && (
        <div style={{ fontSize: 13, color: C.textSec, padding: 12 }}>{emptyMessage}</div>
      )}
      <ServiceCategoryPicker
        categories={categories}
        selectedCategoryId={selectedCategoryId}
        onSelect={onSelectCategory}
        accentColor={accentColor}
      />
      {selectedCategoryId && gridItemCount === 0 && (
        <div style={{ fontSize: 13, color: C.textSec, padding: "8px 12px 4px" }}>
          No items in {selectedCategoryName ?? "this category"} for this service.
        </div>
      )}
      <ServiceCatalogSections
        sections={visibleSections}
        renderItem={renderItem}
        gridInset={SERVICE_MENU_GRID_INSET}
      />
    </div>
  );
}
