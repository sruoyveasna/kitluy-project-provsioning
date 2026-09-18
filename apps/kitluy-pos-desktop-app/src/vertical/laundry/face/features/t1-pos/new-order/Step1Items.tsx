/**
 * Items step — the services of the delivered catalog, two ways in.
 *
 * PROVENANCE: donor `src/features/t1-pos/new-order/Step1Items.tsx`
 * (kitluy-laundry-pos-desk-app@8b2f107). The donor hard-coded three product
 * cards (Wash & Fold / Dry Clean / Wash & Press) with fixture items and a
 * fixture per-kg rate. Here the cards ARE the catalog the Store Hub delivered
 * (KLD-2026-08-07-BOOKING-SEMANTICS-001: catalog Service → Booking line): a
 * per-weight service opens the kg panel, per-piece services fill the grid.
 * When no catalog has been delivered, the step says so — it invents nothing.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import { useThemeColors } from "@face/app/ThemeProvider";
import { useAppState } from "@face/app/useAppState";
import { I } from "@face/components/common/icons";
import { ServiceItemIcon } from "@face/components/common/ServiceItemIcon";
import { useLaundryCatalog } from "@face/hooks/useLaundryCatalog";
import { fmt } from "@face/lib/formatters";
import { iconForItemName } from "@face/lib/itemIcons";
import { serviceColor, serviceIcon, serviceLabel, serviceSoftBg } from "@face/lib/serviceCatalog";
import { C as C_LIGHT, font } from "@face/styles/tokens";
import type { CatalogItem, ServiceType } from "@face/types";

import { BookingMainHead } from "../laundry-savor/BookingMainHead";
import { ItemCustomizeModal } from "../laundry-savor/ItemCustomizeModal";
import { ServiceItemMenuTemplate } from "../laundry-savor/ServiceItemMenuTemplate";
import { WfServicePanel } from "../laundry-savor/WfServicePanel";

const STAIN_SUFFIX = "::stain";
const stainKey = (itemId: string, stain: boolean) => (stain ? `${itemId}${STAIN_SUFFIX}` : itemId);
const parseStainKey = (key: string): { itemId: string; stain: boolean } =>
  key.endsWith(STAIN_SUFFIX)
    ? { itemId: key.slice(0, -STAIN_SUFFIX.length), stain: true }
    : { itemId: key, stain: false };

const SERVICE_ITEM_ICON_PX = 28;

interface ServiceCard {
  code: ServiceType;
  name: string;
  desc: string;
  pricing: string;
  icon: ReactNode;
  color: string;
  gradient: string;
}

/** Width share for the card row — cards with lines grow; always sums to 1. */
const serviceCardWidthShare = (
  code: ServiceType,
  codesInCart: readonly ServiceType[],
  cardCount: number,
): number => {
  const n = codesInCart.length;
  const inCart = codesInCart.includes(code);
  if (cardCount <= 1 || n === 0 || n === cardCount) return 1 / Math.max(1, cardCount);
  return inCart ? 0.6 : 0.4;
};

export const Step1Items = () => {
  const C = useThemeColors();
  const { cart, setCart, selServiceType, setSelServiceType, itemQtys, setItemQtys, showToast } =
    useAppState();
  const catalog = useLaundryCatalog();

  const [stainPicker, setStainPicker] = useState<CatalogItem | null>(null);
  const [selCategoryId, setSelCategoryId] = useState<string | null>(null);

  const delivered = catalog.status === "delivered" ? catalog : null;
  const perPiece: readonly CatalogItem[] = delivered?.perPiece ?? [];
  const perWeight = delivered?.perWeight ?? [];
  const perPieceById = new Map(perPiece.map((i) => [i.id, i]));

  useEffect(() => {
    setSelCategoryId(null);
  }, [selServiceType]);

  const cards: ServiceCard[] = [];
  if (perWeight.length > 0) {
    const first = perWeight[0];
    cards.push({
      code: "wf",
      name: first?.name ?? serviceLabel("wf"),
      desc: "Weigh the load and enter whole kilograms — optional garment checklist.",
      pricing: first !== undefined ? `${fmt(first.rateKhr)} / kg` : "Per kg",
      icon: serviceIcon("wf", 34),
      color: C_LIGHT.primary,
      gradient: `linear-gradient(135deg, ${C_LIGHT.primaryDeep} 0%, ${C_LIGHT.primary} 100%)`,
    });
  }
  if (perPiece.length > 0) {
    cards.push({
      code: "pp",
      name: serviceLabel("pp"),
      desc: `${String(perPiece.length)} service${perPiece.length === 1 ? "" : "s"} priced per piece — tap to add pieces.`,
      pricing: "Per piece",
      icon: serviceIcon("pp", 34),
      color: C_LIGHT.purple,
      gradient: `linear-gradient(135deg, #5B21B6 0%, ${C_LIGHT.purple} 100%)`,
    });
  }

  // ---------------------------------------------------------- service pick
  if (!selServiceType) {
    return (
      <div className="sv-step1-svc-pick" data-catalog={catalog.status}>
        <BookingMainHead marginBottom={16}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 4px" }}>Select service</h3>
          <p className="sv-step1-svc-pick-sub" style={{ fontSize: 13, color: C.textSec }}>
            {cart.length > 0
              ? "Add another service to this booking, or continue to the customer"
              : "Choose the service for this booking"}
          </p>
        </BookingMainHead>
        <div className="sv-svc-pick-wrap">
          {catalog.status === "loading" ? (
            <div style={{ fontSize: 13, color: C.textSec, padding: 12 }}>Reading the catalog…</div>
          ) : null}
          {catalog.status === "not_delivered" ? (
            <div
              role="status"
              data-catalog-empty
              style={{
                borderRadius: 16,
                border: `1.5px dashed ${C.border}`,
                background: C.card,
                padding: "28px 26px",
                fontFamily: font,
                maxWidth: 640,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <I.AlertTri s={22} c={C.amberDark} />
                <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>
                  No service catalog on this terminal yet
                </h3>
              </div>
              <p style={{ fontSize: 14, color: C.textSec, margin: "0 0 10px", lineHeight: 1.5 }}>
                {catalog.reason}
              </p>
              <p style={{ fontSize: 13, color: C.textTer, margin: 0, lineHeight: 1.5 }}>
                Services and prices reach a terminal only through the Store Hub&apos;s signed
                configuration (WS-05). You can still continue to the customer and open a Booking
                Draft.
              </p>
            </div>
          ) : null}
          {cards.length > 0 ? (
            <div className="sv-svc-pick-grid">
              {(() => {
                const codesInCart = cards
                  .filter((st) => cart.some((c) => c.svc === st.code))
                  .map((st) => st.code);
                return cards.map((st) => {
                  const svcItems = cart.filter((c) => c.svc === st.code);
                  const hasItems = svcItems.length > 0;
                  const cartQty = svcItems.reduce((s, c) => s + c.qty, 0);
                  const widthShare = serviceCardWidthShare(st.code, codesInCart, cards.length);
                  return (
                    <div
                      key={st.code}
                      role="button"
                      tabIndex={0}
                      data-service-card={st.code}
                      onClick={() => setSelServiceType(st.code)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelServiceType(st.code);
                        }
                      }}
                      className={
                        "sv-svc-pick-card" + (hasItems ? " sv-svc-pick-card--in-cart" : "")
                      }
                      style={{
                        fontFamily: font,
                        ...({
                          "--sv-svc-pick-accent": st.color,
                          "--sv-svc-pick-share": String(widthShare),
                        } as CSSProperties),
                      }}
                    >
                      <div className="sv-svc-pick-card-hero" style={{ background: st.gradient }}>
                        <span
                          className={
                            "sv-svc-pick-card-badge" +
                            (hasItems ? "" : " sv-svc-pick-card-badge--empty")
                          }
                          style={{ background: st.color }}
                          aria-hidden={!hasItems}
                        >
                          ✓
                          <span className="sv-svc-pick-card-badge-qty">
                            {hasItems ? cartQty : 0}
                          </span>
                        </span>
                        <div className="sv-svc-pick-card-icon">{st.icon}</div>
                        <h3 className="sv-svc-pick-card-title">{st.name}</h3>
                        <p className="sv-svc-pick-card-desc">{st.desc}</p>
                      </div>
                      <div className="sv-svc-pick-card-foot">
                        <div className="sv-svc-pick-card-foot-row">
                          <div className="sv-svc-pick-card-foot-meta">
                            <I.Tag s={10} c={C.textSec} />
                            <span>{st.pricing}</span>
                          </div>
                          <span
                            className="sv-svc-pick-card-cta"
                            style={{ "--sv-svc-pick-accent": st.color } as CSSProperties}
                          >
                            Open →
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------- per-piece grid
  const rebuildCart = (updated: Record<string, number>) => {
    setItemQtys(updated);
    setCart((prev) => {
      const other = prev.filter((c) => c.svc !== "pp");
      const lines = Object.entries(updated).flatMap(([k, v]) => {
        const { itemId, stain } = parseStainKey(k);
        const it = perPieceById.get(itemId);
        if (it === undefined || v <= 0) return [];
        return [
          {
            id: `pp-${k}`,
            name: stain ? `${it.name} (Stain)` : it.name,
            icon: it.icon,
            price: it.priceKhr,
            qty: v,
            svc: "pp" as const,
            stain,
            serviceCode: it.code,
          },
        ];
      });
      return [...other, ...lines];
    });
  };

  const addWithStain = (item: CatalogItem, stain: boolean, qty = 1) => {
    const key = stainKey(item.id, stain);
    rebuildCart({ ...itemQtys, [key]: (itemQtys[key] ?? 0) + qty });
    showToast(`✓ ${item.name}${stain ? " (Stain)" : ""}${qty > 1 ? ` ×${String(qty)}` : ""} added`);
    setStainPicker(null);
  };

  const svcColor = selServiceType === "wf" ? C.primary : C.purple;
  const svcBg = selServiceType === "wf" ? C.primarySoft : C.purpleLight;

  const renderPerPieceItem = (item: CatalogItem) => {
    const cleanQty = itemQtys[stainKey(item.id, false)] ?? 0;
    const stainQty = itemQtys[stainKey(item.id, true)] ?? 0;
    const qty = cleanQty + stainQty;
    const decrementOne = () => {
      const targetKey = stainKey(item.id, stainQty > 0);
      const updated = { ...itemQtys };
      const next = (updated[targetKey] ?? 0) - 1;
      if (next <= 0) delete updated[targetKey];
      else updated[targetKey] = next;
      rebuildCart(updated);
    };
    return (
      <button
        key={item.id}
        type="button"
        className="sv-service-item-card"
        data-catalog-item={item.code}
        onClick={() => setStainPicker(item)}
        style={{
          borderColor: qty > 0 ? svcColor : C.border,
          background: qty > 0 ? svcBg : C.card,
          fontFamily: font,
        }}
      >
        {qty > 0 && (
          <div className="sv-service-item-card__qty" style={{ background: svcColor }}>
            {qty}
          </div>
        )}
        {qty > 0 && (
          <div
            role="button"
            tabIndex={0}
            className="sv-service-item-card__minus"
            onClick={(e) => {
              e.stopPropagation();
              decrementOne();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                decrementOne();
              }
            }}
            aria-label="Decrease quantity"
            style={{ border: `2px solid ${C.card}`, background: C.red }}
          >
            −
          </div>
        )}
        <div className="sv-service-item-card__icon">
          <ServiceItemIcon
            iconPath={item.iconPath ?? item.icon}
            sizePx={SERVICE_ITEM_ICON_PX}
            fallback={iconForItemName(item.name, SERVICE_ITEM_ICON_PX, svcColor)}
          />
        </div>
        <div className="sv-service-item-card__name" style={{ color: C.text }}>
          {item.name}
        </div>
        <div className="sv-service-item-card__price" style={{ color: svcColor }}>
          {fmt(item.priceKhr)}
        </div>
        {stainQty > 0 && (
          <div className="sv-service-item-card__stain" style={{ color: C.red }}>
            <span aria-hidden style={{ color: C.amber }}>
              ●
            </span>{" "}
            {stainQty} stain
          </div>
        )}
        {qty === 0 && (
          <div className="sv-service-item-card__hint" style={{ color: C.textTer }}>
            Tap to add
          </div>
        )}
      </button>
    );
  };

  const laneTitle =
    selServiceType === "wf" ? (perWeight[0]?.name ?? serviceLabel("wf")) : serviceLabel("pp");

  return (
    <div
      className="sv-step1-svc-catalog sv-step1-svc-catalog--flat"
      data-service-lane={selServiceType}
    >
      <BookingMainHead marginBottom={12}>
        <div className="sv-step1-svc-head-row">
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div
              style={{
                padding: "8px 14px",
                borderRadius: 10,
                background: serviceSoftBg(selServiceType),
              }}
            >
              <span style={{ display: "inline-flex", color: serviceColor(selServiceType) }}>
                {serviceIcon(selServiceType, 22)}
              </span>
            </div>
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  margin: 0,
                  color: serviceColor(selServiceType),
                }}
              >
                {laneTitle}
              </h3>
              <span style={{ fontSize: 12, color: C.textSec }}>
                {selServiceType === "wf"
                  ? "Enter the weighed kilograms, then optionally log garments"
                  : "Select services — per-piece pricing from the delivered catalog"}
              </span>
            </div>
          </div>
          {selServiceType === "wf" && perWeight[0] !== undefined && (
            <div className="sv-wf-rate-badge">1 kg = {fmt(perWeight[0].rateKhr)}</div>
          )}
        </div>
      </BookingMainHead>
      <div className="sv-step1-svc-catalog-body">
        {selServiceType === "wf" && <WfServicePanel />}
        {selServiceType === "pp" && (
          <ServiceItemMenuTemplate
            items={[...perPiece]}
            categories={undefined}
            selectedCategoryId={selCategoryId}
            onSelectCategory={setSelCategoryId}
            accentColor={svcColor}
            renderItem={renderPerPieceItem}
            loading={catalog.status === "loading"}
            emptyMessage="No per-piece service was delivered by the Store Hub."
          />
        )}
      </div>
      {stainPicker && (
        <ItemCustomizeModal
          item={stainPicker}
          svcLabel={serviceLabel("pp")}
          onClose={() => setStainPicker(null)}
          onConfirm={({ stain, qty }) => addWithStain(stainPicker, stain, qty)}
        />
      )}
    </div>
  );
};
