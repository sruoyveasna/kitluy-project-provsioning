import { useThemeColors } from "@face/app/ThemeProvider";
import { I } from "@face/components/common/icons";
import { ServiceItemIcon } from "@face/components/common/ServiceItemIcon";
import type { LaundryItemCategory } from "@face/types";
import { font } from "@face/styles/tokens";

const CATEGORY_ICON_PX = 18;

const categoryEmojiFallback = (code: string): string => {
  switch (code.toUpperCase()) {
    case "ADD_ON":
      return "👔";
    case "FORMAL":
      return "👔";
    case "CASUAL":
      return "👕";
    default:
      return "📦";
  }
};

type Props = {
  categories: LaundryItemCategory[] | undefined;
  selectedCategoryId: string | null;
  onSelect: (categoryId: string | null) => void;
  accentColor: string;
};

/** Full category row from `catalog.item_categories` — same on DC, WP, and WF. */
export function ServiceCategoryPicker({
  categories,
  selectedCategoryId,
  onSelect,
  accentColor,
}: Props) {
  const C = useThemeColors();
  const list = categories ?? [];

  if (list.length === 0) return null;

  return (
    <div className="sv-catalog-category-pick">
      <div className="sv-catalog-category-pick-hd">
        <I.Tag s={12} c={C.textSec} />
        Item categories
      </div>
      <div className="sv-catalog-category-pick-row">
        <button
          type="button"
          className={
            "sv-catalog-category-pick-btn" + (selectedCategoryId === null ? " is-selected" : "")
          }
          onClick={() => onSelect(null)}
          style={{
            fontFamily: font,
            borderColor: selectedCategoryId === null ? accentColor : C.border,
            background: selectedCategoryId === null ? `${accentColor}14` : C.gray50,
            color: selectedCategoryId === null ? accentColor : C.text,
          }}
        >
          <span className="sv-catalog-category-pick-icon" aria-hidden>
            ✦
          </span>
          <span>All</span>
        </button>
        {list.map((cat) => {
          const selected = selectedCategoryId === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              className={"sv-catalog-category-pick-btn" + (selected ? " is-selected" : "")}
              onClick={() => onSelect(cat.id)}
              style={{
                fontFamily: font,
                borderColor: selected ? accentColor : C.border,
                background: selected ? `${accentColor}14` : C.gray50,
                color: selected ? accentColor : C.text,
              }}
            >
              <span className="sv-catalog-category-pick-icon">
                <ServiceItemIcon
                  iconPath={cat.iconPath}
                  sizePx={CATEGORY_ICON_PX}
                  fallback={
                    <span style={{ fontSize: CATEGORY_ICON_PX, lineHeight: 1 }}>
                      {categoryEmojiFallback(cat.code)}
                    </span>
                  }
                />
              </span>
              <span>{cat.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
