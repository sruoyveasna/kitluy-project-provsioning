import type { CSSProperties, ReactNode } from "react";
import type { CatalogSection } from "./catalogItemSections";

type Props<T> = {
  sections: CatalogSection<T>[];
  renderItem: (item: T) => ReactNode;
  gridInset?: CSSProperties;
};

/** Flat item grid — category chips handle grouping; no per-section headers. */
export function ServiceCatalogSections<T>({ sections, renderItem, gridInset }: Props<T>) {
  const items = sections.flatMap((section) => section.items);
  if (items.length === 0) return null;

  return (
    <div style={gridInset}>
      <div className="sv-service-item-grid">{items.map((item) => renderItem(item))}</div>
    </div>
  );
}
