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
import { serviceIcon, serviceLabel, serviceSoftBg } from "@face/lib/serviceCatalog";
import { C as C_LIGHT, font } from "@face/styles/tokens";
import type { CatalogFamily, CatalogItem, ServiceType } from "@face/types";

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
  /** The delivered family (Wash & Fold / Dry Clean / Wash & Press). */
  familyCode: string;
  lane: ServiceType;
  name: string;
  nameKm: string | null;
  desc: string;
  pricing: string;
  icon: ReactNode;
  color: string;
  gradient: string;
}

/** The family colour: the per-kg lane keeps the primary, per-piece families alternate. */
const FAMILY_PALETTE = [
  { color: "#6D28D9", gradient: "linear-gradient(135deg, #5B21B6 0%, #6D28D9 100%)" },
  { color: "#0F766E", gradient: "linear-gradient(135deg, #115E59 0%, #0F766E 100%)" },
  { color: "#B45309", gradient: "linear-gradient(135deg, #92400E 0%, #B45309 100%)" },
] as const;

/** Width share for the card row — cards with lines grow; always sums to 1. */
const serviceCardWidthShare = (
  code: string,
  codesInCart: readonly string[],
  cardCount: number,
): number => {
  const n = codesInCart.length;
  const inCart = codesInCart.includes(code);
  if (cardCount <= 1 || n === 0 || n === cardCount) return 1 / Math.max(1, cardCount);
  return inCart ? 0.6 : 0.4;
};

export const Step1Items = () => {
  const C = useThemeColors();
  const {
    cart,
    setCart,
    selServiceType,
    setSelServiceType,
    selFamilyCode,
    setSelFamilyCode,
    itemQtys,
    setItemQtys,
    showToast,
  } = useAppState();
  const catalog = useLaundryCatalog();

  const [stainPicker, setStainPicker] = useState<CatalogItem | null>(null);
  const [selCategoryId, setSelCategoryId] = useState<string | null>(null);

  const delivered = catalog.status === "delivered" ? catalog : null;
  const perPiece: readonly CatalogItem[] = delivered?.perPiece ?? [];
  const perWeight = delivered?.perWeight ?? [];
  const families: readonly CatalogFamily[] = delivered?.families ?? [];
  const perPieceById = new Map(perPiece.map((i) => [i.id, i]));

  useEffect(() => {
    setSelCategoryId(null);
  }, [selServiceType, selFamilyCode]);

  // ONE CARD PER DELIVERED FAMILY. The donor hard-coded Wash & Fold / Dry
  // Clean / Wash & Press; here they are rows of `service_families`, and a
  // family with no priced service in this Location has no card.
  const cards: ServiceCard[] = families.map((family, index) => {
    if (family.lane === "wf") {
      const offering = perWeight.find((o) => o.familyCode === family.code) ?? perWeight[0];
      return {
        familyCode: family.code,
        lane: "wf",
        name: family.name,
        nameKm: family.nameKm,
        desc: "Weigh the load and enter whole kilograms — optional garment checklist.",
        pricing: offering !== undefined ? `${fmt(offering.rateKhr)} / kg` : "Per kg",
        icon: serviceIcon("wf", 34),
        color: C_LIGHT.primary,
        gradient: `linear-gradient(135deg, ${C_LIGHT.primaryDeep} 0%, ${C_LIGHT.primary} 100%)`,
      };
    }
    const count = perPiece.filter((i) => i.familyCode === family.code).length;
    const palette = FAMILY_PALETTE[index % FAMILY_PALETTE.length] ?? FAMILY_PALETTE[0];
    return {
      familyCode: family.code,
      lane: "pp",
      name: family.name,
      nameKm: family.nameKm,
      desc: `${String(count)} item${count === 1 ? "" : "s"} priced per piece — tap to add pieces.`,
      pricing: "Per piece",
      icon: serviceIcon("pp", 34),
      color: palette.color,
      gradient: palette.gradient,
    };
  });
  const selectedFamily = families.find((f) => f.code === selFamilyCode) ?? null;
  const selectedCard = cards.find((c) => c.familyCode === selFamilyCode) ?? null;
  const familyItems = perPiece.filter((i) => i.familyCode === (selFamilyCode ?? i.familyCode));
  const familyCategories = (delivered?.categories ?? []).filter((c) =>
    familyItems.some((i) => i.category === c.id),
  );
  const openFamily = (card: ServiceCard) => {
    setSelFamilyCode(card.familyCode);
    setSelServiceType(card.lane);
  };

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
                const inCartOf = (st: ServiceCard) =>
                  cart.filter((c) =>
                    st.lane === "wf" ? c.svc === "wf" : c.familyCode === st.familyCode,
                  );
                const codesInCart = cards
                  .filter((st) => inCartOf(st).length > 0)
                  .map((st) => st.familyCode);
                return cards.map((st) => {
                  const svcItems = inCartOf(st);
                  const hasItems = svcItems.length > 0;
                  const cartQty = svcItems.reduce((s, c) => s + c.qty, 0);
                  const widthShare = serviceCardWidthShare(
                    st.familyCode,
                    codesInCart,
                    cards.length,
                  );
                  return (
                    <div
                      key={st.familyCode}
                      role="button"
                      tabIndex={0}
                      data-service-card={st.lane}
                      data-service-family={st.familyCode}
                      onClick={() => openFamily(st)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openFamily(st);
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
                        <h3 className="sv-svc-pick-card-title">
                          {st.name}
                          {st.nameKm !== null ? (
                            <span className="km" style={{ display: "block", fontSize: 14 }}>
                              {st.nameKm}
                            </span>
                          ) : null}
                        </h3>
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
            ...(it.familyCode ? { familyCode: it.familyCode } : {}),
            ...(it.familyName ? { familyName: it.familyName } : {}),
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

  const svcColor = selServiceType === "wf" ? C.primary : (selectedCard?.color ?? C.purple);
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
    selectedFamily?.name ??
    (selServiceType === "wf" ? (perWeight[0]?.name ?? serviceLabel("wf")) : serviceLabel("pp"));

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
              <span style={{ display: "inline-flex", color: svcColor }}>
                {serviceIcon(selServiceType, 22)}
              </span>
            </div>
            <div style={{ minWidth: 0 }}>
              <h3
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  margin: 0,
                  color: svcColor,
                }}
              >
                {laneTitle}
                {selectedFamily?.nameKm ? (
                  <span className="km" style={{ marginLeft: 8, fontWeight: 500, fontSize: 14 }}>
                    {selectedFamily.nameKm}
                  </span>
                ) : null}
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
            items={[...familyItems]}
            categories={familyCategories.length > 1 ? familyCategories : undefined}
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
          svcLabel={selectedFamily?.name ?? serviceLabel("pp")}
          onClose={() => setStainPicker(null)}
          onConfirm={({ stain, qty }) => addWithStain(stainPicker, stain, qty)}
        />
      )}
    </div>
  );
};
