import { useMemo, useState } from "react";
import { useThemeColors } from "@face/app/ThemeProvider";
import { useAppState } from "@face/app/useAppState";
import { ServiceItemIcon } from "@face/components/common/ServiceItemIcon";
import { useLaundryCatalog } from "@face/hooks/useLaundryCatalog";
import { clampWfKg } from "@face/features/t1-pos/laundry-savor/wfKgConstants";
import { iconForItemName } from "@face/lib/itemIcons";
import { font } from "@face/styles/tokens";
import { ServiceItemMenuTemplate } from "./ServiceItemMenuTemplate";
import { getWfChecklistItems, type GarmentChecklistItem } from "./wfGarmentCatalog";

const SERVICE_ITEM_ICON_PX = 28;

/** Wash & Fold garment checklist — same menu template as DC / WP. */
export const WfItemsPanel = () => {
  const C = useThemeColors();
  const { wfItemQtys, setWfItemQtys, wfKg, setWfKg, setWfKgDigits } = useAppState();
  const catalog = useLaundryCatalog();
  const garmentTypes = catalog.status === "delivered" ? catalog.garmentTypes : [];
  const catalogLoading = catalog.status === "loading";
  const [selCategoryId, setSelCategoryId] = useState<string | null>(null);
  const canLogGarments = clampWfKg(wfKg) >= 1;

  const checklistItems = useMemo(() => getWfChecklistItems(garmentTypes), [garmentTypes]);

  const addGarment = (itemId: string) => {
    // Set kg first so the weight bar and wheel snap to 1 before the card highlights.
    if (!canLogGarments) {
      setWfKg(1);
      setWfKgDigits("1");
    }
    setWfItemQtys((p) => ({
      ...p,
      [itemId]: (p[itemId] || 0) + 1,
    }));
  };

  const renderItem = (item: GarmentChecklistItem) => {
    const qty = wfItemQtys[item.id] || 0;
    const displayQty = canLogGarments ? qty : 0;
    const wfColor = C.primary;
    const wfBg = C.primarySoft;

    return (
      <button
        key={item.id}
        type="button"
        className="sv-service-item-card"
        onClick={() => addGarment(item.id)}
        style={{
          borderColor: displayQty > 0 ? wfColor : C.border,
          background: displayQty > 0 ? wfBg : C.card,
          fontFamily: font,
        }}
      >
        {displayQty > 0 && (
          <div className="sv-service-item-card__qty" style={{ background: wfColor }}>
            {displayQty}
          </div>
        )}
        {displayQty > 0 && (
          <div
            role="button"
            tabIndex={0}
            className="sv-service-item-card__minus"
            onClick={(e) => {
              e.stopPropagation();
              setWfItemQtys((p) => {
                const nq = { ...p };
                nq[item.id] = Math.max(0, qty - 1);
                if (!nq[item.id]) delete nq[item.id];
                return nq;
              });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                setWfItemQtys((p) => {
                  const nq = { ...p };
                  nq[item.id] = Math.max(0, qty - 1);
                  if (!nq[item.id]) delete nq[item.id];
                  return nq;
                });
              }
            }}
            aria-label="Decrease quantity"
            style={{
              border: `2px solid ${C.card}`,
              background: C.red,
            }}
          >
            −
          </div>
        )}
        <div className="sv-service-item-card__icon">
          <ServiceItemIcon
            iconPath={item.iconPath ?? item.icon}
            sizePx={SERVICE_ITEM_ICON_PX}
            fallback={iconForItemName(item.name, SERVICE_ITEM_ICON_PX)}
          />
        </div>
        <div className="sv-service-item-card__name" style={{ color: C.text }}>
          {item.name}
        </div>
        {displayQty === 0 && (
          <div className="sv-service-item-card__hint" style={{ color: C.textTer }}>
            Tap to add
          </div>
        )}
      </button>
    );
  };

  return (
    <ServiceItemMenuTemplate
      items={checklistItems}
      // Garment categories are not part of the delivered vocabulary yet: one flat grid.
      categories={undefined}
      selectedCategoryId={selCategoryId}
      onSelectCategory={setSelCategoryId}
      accentColor={C.primary}
      renderItem={renderItem}
      loading={catalogLoading}
      emptyMessage="The Store Hub delivered no garment list for this terminal."
    />
  );
};
