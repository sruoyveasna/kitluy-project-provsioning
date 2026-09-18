import { useState } from "react";
import { ServiceItemIcon } from "@face/components/common/ServiceItemIcon";
import { fmt } from "@face/lib/formatters";
import { iconForItemName } from "@face/lib/itemIcons";
import type { CatalogItem } from "@face/types";
import { SvIcon } from "./SvIcon";

export interface ItemCustomizePayload {
  stain: boolean;
  qty: number;
}

/** Per-piece item customize — mirrors café SvModifierModal (select → qty → confirm). */
export function ItemCustomizeModal({
  item,
  svcLabel,
  onClose,
  onConfirm,
}: {
  item: CatalogItem;
  svcLabel: string;
  onClose: () => void;
  onConfirm: (payload: ItemCustomizePayload) => void;
}) {
  const [stain, setStain] = useState(false);
  const [qty, setQty] = useState(1);
  const unit = item.priceKhr;
  const total = unit * qty;

  return (
    <div className="sv-mod-overlay sv-mod-overlay--fixed" onClick={onClose}>
      <div className="sv-mod sv-mod-item" onClick={(e) => e.stopPropagation()}>
        <div className="sv-mod-head">
          <h2>Customize</h2>
          <button type="button" className="sv-mod-close" onClick={onClose} aria-label="Close">
            <SvIcon name="close" size={18} />
          </button>
        </div>

        <div className="sv-mod-body scroll">
          <div className="sv-mod-hero">
            <div className="sv-mod-img sv-mod-img--item">
              <ServiceItemIcon
                iconPath={item.iconPath ?? item.icon}
                sizePx={84}
                fallback={<span style={{ fontSize: 48 }}>{iconForItemName(item.name)}</span>}
              />
            </div>
            <div className="sv-mod-info">
              <div className="name">{item.name}</div>
              <div className="km">{svcLabel}</div>
            </div>
            <div className="sv-mod-price">
              <div className="l">Unit price</div>
              <div className="v">{fmt(unit)}</div>
            </div>
          </div>

          <div className="sv-mod-section">
            <div className="sv-mod-section-head">
              <div className="sv-mod-section-title">
                Condition <span className="km">ស្ថានភាព</span>
              </div>
              <span className="sv-mod-req">Required</span>
            </div>
            <div className="sv-mod-opts sv-mod-opts--stain">
              <button
                type="button"
                className={"sv-mod-opt sv-mod-opt--clean" + (stain === false ? " sel" : "")}
                onClick={() => setStain(false)}
              >
                <span className="sv-mod-opt-l">
                  <span className="sv-mod-opt-en">No Stain</span>
                  <span className="sv-mod-opt-km">គ្មានស្នាម</span>
                </span>
                <span className="sv-mod-opt-icon" aria-hidden>
                  ✓
                </span>
              </button>
              <button
                type="button"
                className={"sv-mod-opt sv-mod-opt--stain" + (stain === true ? " sel" : "")}
                onClick={() => setStain(true)}
              >
                <span className="sv-mod-opt-l">
                  <span className="sv-mod-opt-en">Stain</span>
                  <span className="sv-mod-opt-km">មានស្នាម</span>
                </span>
                <span className="sv-mod-opt-icon sv-mod-opt-icon--stain" aria-hidden>
                  ●
                </span>
              </button>
            </div>
          </div>
        </div>

        <div className="sv-mod-foot">
          <div className="sv-mod-qty">
            <button
              type="button"
              onClick={() => setQty(Math.max(1, qty - 1))}
              disabled={qty <= 1}
              aria-label="Decrease quantity"
            >
              <SvIcon name="minus" size={16} />
            </button>
            <span className="v">{qty}</span>
            <button
              type="button"
              className="add"
              onClick={() => setQty(qty + 1)}
              aria-label="Increase quantity"
            >
              <SvIcon name="plus" size={16} />
            </button>
          </div>
          <button
            type="button"
            className="sv-cta"
            style={{ flex: 1, marginTop: 0 }}
            onClick={() => onConfirm({ stain, qty })}
          >
            Add to order · {fmt(total)}
          </button>
        </div>
      </div>
    </div>
  );
}
