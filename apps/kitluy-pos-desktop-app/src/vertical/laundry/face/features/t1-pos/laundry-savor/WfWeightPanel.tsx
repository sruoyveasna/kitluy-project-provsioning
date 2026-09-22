import { useEffect, useRef } from "react";

import { useThemeColors } from "@face/app/ThemeProvider";

import { useAppState } from "@face/app/useAppState";

import { I } from "@face/components/common/icons";

import { useLaundryCatalog } from "@face/hooks/useLaundryCatalog";

import { fmt } from "@face/lib/formatters";

import { SvIcon } from "./SvIcon";

import { WfKgWheelPicker } from "./WfKgWheelPicker";

import {
  WF_KG_CART_ID,
  WF_KG_MIN,
  WF_KG_TYPED_MAX,
  WF_KG_WHEEL_MAX,
  clampWfKg,
  parseWfKgDigits,
  wfKgFitsWheel,
} from "./wfKgConstants";

export { WF_KG_CART_ID };

/**
 * Whole-kg entry for the per-kilogram service; wheel 0–99, typed entry up to
 * 999,999 kg. PROVENANCE: donor `WfWeightPanel.tsx`; the 4 000 KHR fixture rate
 * is gone — the rate is the delivered per-weight service's, or the panel says
 * none was delivered.
 */

export const WfWeightPanel = () => {
  const C = useThemeColors();

  const {
    setCart,
    wfKg,
    setWfKg,
    wfKgInputActive,
    setWfKgInputActive,
    wfKgDigits,
    setWfKgDigits,
    selServiceType,
  } = useAppState();

  const catalog = useLaundryCatalog();
  const isLoading = catalog.status === "loading";
  const offering = catalog.status === "delivered" ? (catalog.perWeight[0] ?? null) : null;
  const rateKhr = offering?.rateKhr ?? 0;
  const serviceName = offering?.name ?? "Per kilogram";

  const kg = clampWfKg(wfKg);
  const displayKg = wfKgInputActive ? parseWfKgDigits(wfKgDigits) : kg;
  const showWheel = !wfKgInputActive && wfKgFitsWheel(kg);
  const lineTotal = displayKg * rateKhr;
  const valueScrollRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = valueScrollRef.current;
    if (!el) return;
    el.scrollLeft = wfKgInputActive ? el.scrollWidth : 0;
  }, [wfKgDigits, kg, wfKgInputActive]);

  useEffect(() => {
    if (selServiceType !== "wf") {
      setWfKgInputActive(false);
    }
  }, [selServiceType, setWfKgInputActive]);

  // wfKg → cart line (order panel +/- updates wfKg via AppContext).

  useEffect(() => {
    if (rateKhr <= 0 || selServiceType !== "wf") return;
    const lineName = `${serviceName} (${kg} kg)`;
    setCart((prev) => {
      const existing = prev.find((c) => c.id === WF_KG_CART_ID);
      if (kg < 1) {
        if (!existing) return prev;
        return prev.filter((c) => c.id !== WF_KG_CART_ID);
      }
      if (
        existing &&
        existing.qty === kg &&
        existing.price === rateKhr &&
        existing.name === lineName
      ) {
        return prev;
      }
      const rest = prev.filter((c) => c.id !== WF_KG_CART_ID);
      return [
        ...rest,
        {
          id: WF_KG_CART_ID,
          name: lineName,
          icon: "",
          price: rateKhr,
          qty: kg,
          svc: "wf" as const,
          ...(offering?.serviceId ? { serviceId: offering.serviceId } : {}),
          serviceCode: offering?.serviceCode,
        },
      ];
    });
  }, [
    kg,
    rateKhr,
    serviceName,
    offering?.serviceId,
    offering?.serviceCode,
    setCart,
    selServiceType,
  ]);

  const setKg = (next: number, exitTyping = false) => {
    if (exitTyping) setWfKgInputActive(false);
    const clamped = clampWfKg(next);
    setWfKg(clamped);
    setWfKgDigits(clamped > 0 ? String(clamped) : "");
  };

  const changeKg = (delta: number, exitTyping = false) => {
    setKg(kg + delta, exitTyping);
  };

  const startTyping = () => {
    setWfKgInputActive(true);
    setWfKgDigits(kg > 0 ? String(kg) : "");
  };

  /** Wheel stops at 99 — further loads open the numpad. */
  const increaseKg = () => {
    if (!wfKgInputActive && kg === WF_KG_WHEEL_MAX) {
      startTyping();
      return;
    }
    changeKg(1, true);
  };

  return (
    <div className="sv-wf-weight-panel">
      {offering === null && !isLoading && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: C.amberLight,
            color: C.amberDark,
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          No per-kilogram service was delivered by the Store Hub — the weight cannot be priced.
        </div>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <I.Scale s={18} c={C.primary} />
          <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Enter weighed load</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.primary }}>
          {isLoading ? "…" : `${fmt(rateKhr)} / kg`}
        </span>
      </div>
      <div
        className={
          "sv-wf-weight-display" +
          (wfKgInputActive ? " sv-wf-weight-display--editing" : "") +
          (displayKg >= 1 ? " sv-wf-weight-display--active" : "")
        }
        data-wf-kg-input-zone={wfKgInputActive ? true : undefined}
      >
        <div className="sv-wf-weight-stepper">
          <button
            type="button"
            className="minus"
            onClick={() => changeKg(-1, true)}
            disabled={kg <= WF_KG_MIN}
            aria-label="Decrease kg"
          >
            <SvIcon name="minus" size={20} stroke={2.2} />
          </button>
          <div className="sv-wf-weight-picker-slot">
            {wfKgInputActive ? (
              <button
                type="button"
                className="sv-wf-weight-value sv-wf-weight-value--editing"
                aria-label="Typing weight in kg"
              >
                <div className="sv-wf-weight-value-frame">
                  <span ref={valueScrollRef} className="sv-wf-weight-value-scroll hide-scrollbar">
                    <span className="sv-wf-weight-display-num">
                      {wfKgDigits.length > 0 ? wfKgDigits : kg > 0 ? String(kg) : "—"}
                    </span>
                    <span className="sv-wf-weight-caret" aria-hidden />
                    <span className="sv-wf-weight-display-unit">kg</span>
                  </span>
                </div>
              </button>
            ) : showWheel ? (
              <WfKgWheelPicker
                value={kg}
                onChange={(next) => setKg(next)}
                onRequestTypedEntry={startTyping}
              />
            ) : (
              <button
                type="button"
                className="sv-wf-weight-value"
                onClick={startTyping}
                aria-label={`${kg} kg; tap to edit`}
              >
                <div className="sv-wf-weight-value-frame">
                  <span ref={valueScrollRef} className="sv-wf-weight-value-scroll hide-scrollbar">
                    <span className="sv-wf-weight-display-num">{kg}</span>
                    <span className="sv-wf-weight-display-unit">kg</span>
                  </span>
                </div>
              </button>
            )}
          </div>
          <button
            type="button"
            className="add"
            onClick={increaseKg}
            disabled={kg >= WF_KG_TYPED_MAX}
            aria-label={
              !wfKgInputActive && kg === WF_KG_WHEEL_MAX ? "Type kg over 99" : "Increase kg"
            }
          >
            <SvIcon name="plus" size={20} stroke={2.4} />
          </button>
        </div>
        <span className="sv-wf-weight-total">{displayKg >= 1 ? fmt(lineTotal) : "—"}</span>
      </div>
    </div>
  );
};
