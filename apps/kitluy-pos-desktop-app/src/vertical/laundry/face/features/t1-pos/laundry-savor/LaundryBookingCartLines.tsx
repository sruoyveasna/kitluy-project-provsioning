import { useMemo } from "react";
import { useAppState } from "@face/app/useAppState";
import { ServiceItemIcon } from "@face/components/common/ServiceItemIcon";
import { useLaundryCatalog } from "@face/hooks/useLaundryCatalog";
import { getWfChecklistItems } from "./wfGarmentCatalog";
import { fmt } from "@face/lib/formatters";
import { iconForItemName } from "@face/lib/itemIcons";
import { serviceLabelShort } from "@face/lib/serviceCatalog";
import type { CartItem } from "@face/types";
import { SvIcon } from "./SvIcon";
import { WF_KG_CART_ID } from "./wfKgConstants";

function LineQtyStepper({
  qty,
  onMinus,
  onPlus,
  onRemove,
  minQty = 0,
  hideRemove = false,
}: {
  qty: number;
  onMinus: () => void;
  onPlus: () => void;
  onRemove: () => void;
  minQty?: number;
  hideRemove?: boolean;
}) {
  return (
    <div className="sv-qty" onPointerDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="minus"
        onClick={onMinus}
        disabled={qty <= minQty}
        aria-label="Decrease"
      >
        <SvIcon name="minus" size={14} stroke={2.2} />
      </button>
      <span className="sv-qty-val">{qty}</span>
      <button type="button" className="add" onClick={onPlus} aria-label="Increase">
        <SvIcon name="plus" size={14} stroke={2.4} />
      </button>
      {!hideRemove && (
        <button type="button" className="sv-line-del" onClick={onRemove} aria-label="Remove">
          <SvIcon name="trash" size={14} stroke={2} />
        </button>
      )}
    </div>
  );
}

function CartLineRow({
  line,
  onQtyDelta,
  onRemove,
}: {
  line: CartItem;
  onQtyDelta: (delta: number) => void;
  onRemove?: () => void;
}) {
  const lineTotal = line.price * line.qty;
  return (
    <div className="sv-od-line">
      <div className="sv-od-line-thumb">
        <ServiceItemIcon
          iconPath={line.icon}
          sizePx={22}
          fallback={<span style={{ fontSize: 20 }}>{iconForItemName(line.name)}</span>}
        />
      </div>
      <div className="sv-od-line-body">
        <div className="sv-od-line-top">
          <div className="sv-od-line-name">{line.name}</div>
          <div className="sv-od-line-price">{fmt(lineTotal)}</div>
        </div>
        <div className="sv-od-line-meta">
          {line.id === WF_KG_CART_ID
            ? `${line.qty} kg × ${fmt(line.price)}/kg`
            : `${serviceLabelShort(line.svc)} · ×${line.qty}`}
        </div>
      </div>
      <LineQtyStepper
        qty={line.qty}
        minQty={0}
        onMinus={() => onQtyDelta(-1)}
        onPlus={() => onQtyDelta(1)}
        onRemove={onRemove ?? (() => onQtyDelta(-line.qty))}
      />
    </div>
  );
}

function WfGarmentRow({
  name,
  icon,
  qty,
  onQtyDelta,
}: {
  name: string;
  icon: string;
  qty: number;
  onQtyDelta: (delta: number) => void;
}) {
  return (
    <div className="sv-od-line sv-od-line--wf-child">
      <div className="sv-od-line-thumb sv-od-line-thumb--sm">
        <ServiceItemIcon
          iconPath={icon}
          sizePx={16}
          fallback={<span style={{ fontSize: 14 }}>{iconForItemName(name)}</span>}
        />
      </div>
      <div className="sv-od-line-body">
        <div className="sv-od-line-top">
          <div className="sv-od-line-name">{name}</div>
          <div className="sv-od-line-price sv-od-line-price--muted">included</div>
        </div>
        <div className="sv-od-line-meta">Declared garment</div>
      </div>
      <LineQtyStepper
        qty={qty}
        onMinus={() => onQtyDelta(-1)}
        onPlus={() => onQtyDelta(1)}
        onRemove={() => onQtyDelta(-qty)}
      />
    </div>
  );
}

/** Cart lines for the right-hand booking panel (café Order details rhythm). */
export const LaundryBookingCartLines = () => {
  const { cart, updateQty, removeWfService, wfKg, wfItemQtys, setWfItemQtys } = useAppState();
  const catalog = useLaundryCatalog();
  const garmentTypes = catalog.status === "delivered" ? catalog.garmentTypes : [];
  const wfChecklistById = useMemo(() => {
    const map = new Map<string, { name: string; icon: string }>();
    for (const item of getWfChecklistItems(garmentTypes)) {
      map.set(item.id, { name: item.name, icon: item.icon });
    }
    return map;
  }, [garmentTypes]);

  const wfGarments = useMemo(
    () =>
      wfKg < 1
        ? []
        : Object.entries(wfItemQtys)
            .filter(([, qty]) => qty > 0)
            .map(([itemId, qty]) => {
              const item = wfChecklistById.get(itemId);
              return {
                itemId,
                name: item?.name ?? `Item #${itemId}`,
                icon: item?.icon ?? "👕",
                qty,
              };
            }),
    [wfItemQtys, wfKg, wfChecklistById],
  );

  const changeWfGarmentQty = (itemId: string, delta: number) => {
    setWfItemQtys((prev) => {
      const next = { ...prev };
      const q = (next[itemId] || 0) + delta;
      if (q <= 0) delete next[itemId];
      else next[itemId] = q;
      return next;
    });
  };

  /** Wash & Fold weight line always first; other services follow. */
  const sortedCart = useMemo(() => {
    const wfLines = cart.filter((c) => c.svc === "wf");
    const otherLines = cart.filter((c) => c.svc !== "wf");
    wfLines.sort((a, b) => {
      if (a.id === WF_KG_CART_ID) return -1;
      if (b.id === WF_KG_CART_ID) return 1;
      return 0;
    });
    return [...wfLines, ...otherLines];
  }, [cart]);

  if (cart.length === 0 && wfGarments.length === 0) {
    return <div className="sv-od-empty">No items yet · add garments on the left</div>;
  }

  const hasWfCartLine = sortedCart.some((line) => line.svc === "wf" || line.id === WF_KG_CART_ID);
  let wfGarmentsShown = false;

  return (
    <>
      {!hasWfCartLine &&
        wfGarments.length > 0 &&
        wfGarments.map((g) => (
          <div key={g.itemId} className="sv-od-line-group">
            <WfGarmentRow
              name={g.name}
              icon={g.icon}
              qty={g.qty}
              onQtyDelta={(d) => changeWfGarmentQty(g.itemId, d)}
            />
          </div>
        ))}
      {sortedCart.map((line) => {
        const showWfGarments = line.svc === "wf" && !wfGarmentsShown && wfGarments.length > 0;
        if (showWfGarments) wfGarmentsShown = true;

        return (
          <div key={line.id} className="sv-od-line-group">
            <CartLineRow
              line={line}
              onQtyDelta={(d) => updateQty(line.id, d)}
              onRemove={line.id === WF_KG_CART_ID ? removeWfService : undefined}
            />
            {showWfGarments &&
              wfGarments.map((g) => (
                <WfGarmentRow
                  key={`${line.id}-${g.itemId}`}
                  name={g.name}
                  icon={g.icon}
                  qty={g.qty}
                  onQtyDelta={(d) => changeWfGarmentQty(g.itemId, d)}
                />
              ))}
          </div>
        );
      })}
    </>
  );
};
