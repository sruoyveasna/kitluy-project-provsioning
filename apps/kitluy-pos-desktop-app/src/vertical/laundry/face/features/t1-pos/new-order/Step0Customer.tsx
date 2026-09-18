/**
 * Customer step — lookup by phone, or a new customer, over the Store Hub.
 *
 * PROVENANCE: donor `src/features/t1-pos/new-order/Step0Customer.tsx`
 * (kitluy-laundry-pos-desk-app@8b2f107, 1 978 lines). Kept: the two-column
 * rhythm (main list / rail preview + numpad), the on-screen keyboard, the
 * touch ergonomics and the `.sv-step0-*` / `.kl-touch-pad-*` chrome. Gone:
 * loyalty tiers, subscriptions, lifetime spend, Telegram scans, the "recent
 * customers" list and name search — none of it is a fact the Store Hub answers
 * a terminal (WS-12-T002: search by phone, masked answers).
 *
 * Truth rules (T002 §6): `unavailable` is a distinct face, never "no customer
 * found"; a chosen customer is shown as the Hub answered it.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { useThemeColors } from "@face/app/ThemeProvider";
import { useAppState } from "@face/app/useAppState";
import { Btn } from "@face/components/common/Btn";
import { I } from "@face/components/common/icons";
import { OnScreenKeyboard, type OnScreenKey } from "@face/components/common/OnScreenKeyboard";
import "@face/styles/touch-input-pad.css";
import {
  PHONE_SEARCH_MIN_DIGITS,
  useCreateCustomer,
  useSearchCustomers,
} from "@face/hooks/useCustomers";
import { useT1WizardScrollReporter } from "@face/hooks/useT1WizardScrollReporter";
import { formatPhoneLocal, toE164 } from "@face/lib/phone";
import { KIOSK } from "@face/styles/kiosk";
import { CV, font, fontKm } from "@face/styles/tokens";
import type { Customer, PreferredLanguage } from "@face/types";

import { BookingMainHead, BookingStepsRow } from "../laundry-savor/BookingMainHead";

const touchRow = {
  minH: KIOSK.minTap,
  tap: KIOSK.minTap,
  inputMinH: KIOSK.minTap,
  fontBody: 16,
  fontMeta: 14,
} as const;

const backToLookupBtnStyle: CSSProperties = {
  width: "100%",
  justifyContent: "flex-start",
  marginBottom: 16,
  border: `2px solid ${CV.primary}`,
  background: CV.primarySoft,
  color: CV.primaryDeep,
  fontWeight: 700,
  boxShadow: CV.shadowSm,
};

type NumpadKey = number | "back" | "plus";
const NUMPAD_KEYS: NumpadKey[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, "plus", 0, "back"];

/** Which text input the on-screen letter keyboard drives. */
type SoftKbField = "name" | "note";

const LANGUAGES: readonly { readonly code: PreferredLanguage; readonly label: string }[] = [
  { code: "km-KH", label: "ខ្មែរ" },
  { code: "en-US", label: "English" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts[1]?.charAt(0) ?? "";
  return (first + second).toUpperCase() || "?";
}

function PhoneNumpad({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const trimmed = value.trim();
  const display = trimmed.length === 0 ? "—" : formatPhoneLocal(trimmed) || trimmed;
  const handleKey = (k: NumpadKey) => {
    if (k === "plus") {
      onChange(value + "+");
      return;
    }
    if (k === "back") {
      onChange(value.slice(0, -1));
      return;
    }
    onChange(value + String(k));
  };
  return (
    <div className="kl-touch-pad-zone kl-touch-pad-zone--numpad">
      <div className={`kl-pad-status right${trimmed.length === 0 ? " muted" : ""}`}>{display}</div>
      <div className="kl-numpad-grid">
        {NUMPAD_KEYS.map((k, i) => {
          const isPlus = k === "plus";
          const isBack = k === "back";
          return (
            <button
              key={i}
              type="button"
              className={
                "kl-numpad-key" +
                (isPlus ? " kl-numpad-key--plus" : "") +
                (isBack ? " kl-numpad-key--back" : "")
              }
              onClick={() => handleKey(k)}
              disabled={isBack && value.length === 0}
              aria-label={isBack ? "Delete last character" : isPlus ? "Add plus" : undefined}
            >
              {isPlus ? "(+)" : isBack ? <I.Backspace s={24} c="var(--sv-danger,#cb3a31)" /> : k}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CustomerPickRow({
  customer: c,
  selected,
  isLast,
  onPick,
  compact,
}: {
  customer: Customer;
  selected?: boolean;
  isLast?: boolean;
  onPick: () => void;
  compact?: boolean;
}) {
  const C = useThemeColors();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      aria-current={selected ? "true" : undefined}
      data-customer-row={c.id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 12 : 14,
        padding: compact ? "11px 16px" : "16px 18px",
        minHeight: compact ? 52 : touchRow.minH,
        borderBottom: isLast ? "none" : `1px solid ${C.border}`,
        background: selected ? C.primarySoft : "transparent",
        boxShadow: selected ? `inset 3px 0 0 ${C.primary}` : undefined,
        cursor: "pointer",
        fontFamily: font,
        textAlign: "left",
        width: "100%",
        boxSizing: "border-box",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div
        style={{
          width: compact ? 40 : 48,
          height: compact ? 40 : 48,
          borderRadius: 10,
          flexShrink: 0,
          background: selected ? `${C.primary}12` : C.gray50,
          color: selected ? C.primaryDeep : C.textSec,
          border: `1px solid ${selected ? `${C.primary}35` : C.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: compact ? 14 : 15,
          fontWeight: 700,
        }}
      >
        {initials(c.name)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: touchRow.fontBody, fontWeight: 600, color: C.text }}>
            {c.name}
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.textTer }}>
            {c.preferredLanguage === "km-KH" ? "ខ្មែរ" : "English"}
          </span>
        </div>
        <div style={{ fontSize: touchRow.fontMeta, color: C.textTer, lineHeight: 1.35 }}>
          {c.phoneMasked ?? "no phone"}
          {c.phoneVerified ? " · verified" : ""} · {c.syncState.replace(/_/g, " ")}
        </div>
      </div>
      <span style={{ flexShrink: 0 }}>
        <I.ChevR s={18} c={selected ? C.primary : C.textTer} />
      </span>
    </div>
  );
}

/** The chosen (or being-created) customer, exactly as the Store Hub answered — or will see it. */
function CustomerPreview({
  customer,
  draftName,
  draftPhone,
  draftLanguage,
}: {
  customer: Customer | null;
  draftName: string;
  draftPhone: string;
  draftLanguage: PreferredLanguage;
}) {
  const C = useThemeColors();
  const name = customer?.name ?? draftName.trim();
  const phone = customer
    ? (customer.phoneMasked ?? "no phone")
    : formatPhoneLocal(draftPhone) || "—";
  const language = customer?.preferredLanguage ?? draftLanguage;
  return (
    <div
      data-customer-preview={customer ? "hub" : "draft"}
      style={{
        borderRadius: 14,
        border: `1px solid ${C.border}`,
        background: C.card,
        padding: 16,
        fontFamily: font,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 12,
            background: C.primarySoft,
            color: C.primaryDeep,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
          }}
        >
          {name ? initials(name) : "?"}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.text }}>
            {name || "New customer"}
          </div>
          <div style={{ fontSize: 13, color: C.textTer }}>{phone}</div>
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginTop: 14,
          fontSize: 12,
          color: C.textSec,
        }}
      >
        <div>
          <div style={{ color: C.textTer }}>Language</div>
          <div style={{ fontWeight: 600, fontFamily: language === "km-KH" ? fontKm : font }}>
            {language === "km-KH" ? "ខ្មែរ" : "English"}
          </div>
        </div>
        <div>
          <div style={{ color: C.textTer }}>Record</div>
          <div style={{ fontWeight: 600 }}>
            {customer ? customer.syncState.replace(/_/g, " ") : "not created yet"}
          </div>
        </div>
        {customer ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={{ color: C.textTer }}>Origin</div>
            <div style={{ fontWeight: 600 }}>{customer.origin.replace(/_/g, " ")}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const Step0Customer = ({ layout }: { layout: "main" | "rail" }) => {
  const C = useThemeColors();
  const {
    custMode,
    setCustMode,
    custSearch,
    setCustSearch,
    custName,
    setCustName,
    custPhone,
    setCustPhone,
    custNote,
    setCustNote,
    custLanguage,
    setCustLanguage,
    selCustomer,
    setSelCustomer,
    showToast,
  } = useAppState();
  const onWizardScroll = useT1WizardScrollReporter();

  const [activeKbField, setActiveKbField] = useState<SoftKbField>("name");
  const [kbShifted, setKbShifted] = useState(true);
  const [createFailure, setCreateFailure] = useState<string | null>(null);

  const search = useSearchCustomers(custSearch);
  const { create, pending: creating } = useCreateCustomer();

  const nameRef = useRef<HTMLInputElement | null>(null);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (custMode === "new") setActiveKbField("name");
  }, [custMode]);

  const dispatchKbKey = useCallback(
    (key: OnScreenKey) => {
      const target = activeKbField;
      const value = target === "name" ? custName : custNote;
      const set = target === "name" ? setCustName : setCustNote;
      if (key.type === "char") {
        set(value + (kbShifted ? key.char.toUpperCase() : key.char));
        // Auto-lower after the first capital, like a phone keyboard.
        if (kbShifted && key.char !== " ") setKbShifted(false);
        return;
      }
      if (key.type === "backspace") {
        set(value.slice(0, -1));
        return;
      }
      if (key.type === "tab" || key.type === "enter") {
        setActiveKbField(target === "name" ? "note" : "name");
      }
    },
    [activeKbField, custName, custNote, kbShifted, setCustName, setCustNote],
  );

  const pick = (c: Customer) => {
    setSelCustomer(c);
    setCustMode("search");
    showToast(`✓ ${c.name} selected`);
  };

  const enterNewCustomerMode = () => {
    setSelCustomer(null);
    setCreateFailure(null);
    setCustMode("new");
  };
  const leaveNewCustomerMode = () => {
    setCustMode("search");
    setCreateFailure(null);
  };

  const canCreate = custName.trim().length >= 2 && !creating;

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreateFailure(null);
    const phone = toE164(custPhone) ?? (custPhone.trim() === "" ? null : custPhone.trim());
    const r = await create({
      displayName: custName.trim(),
      phone,
      preferredLanguage: custLanguage,
    });
    if (!r.ok) {
      setCreateFailure(`${r.kind.replace(/_/g, " ")} — ${r.detail}`);
      return;
    }
    setSelCustomer(r.value);
    setCustMode("search");
    showToast(`✓ ${r.value.name} created on the Store Hub`);
  };

  // ------------------------------------------------------------ main column
  if (layout === "main") {
    const searching = search.status === "searching";
    return (
      <div
        className={
          "sv-menu-card sv-menu-card--booking-steps sv-step0-customer" +
          (custMode === "new" ? " sv-step0-new-mode" : "")
        }
        style={{
          flex: 1,
          minHeight: 0,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <BookingStepsRow />
        <BookingMainHead marginBottom={custMode === "new" ? 10 : 12}>
          <h3 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>Customer</h3>
          <p style={{ fontSize: touchRow.fontMeta, color: C.textSec, margin: 0, lineHeight: 1.4 }}>
            {custMode === "new"
              ? "Type the name here; the phone comes from the number pad in the booking panel."
              : "Enter the customer's phone with the number pad in the booking panel, then tap a row."}
          </p>
        </BookingMainHead>

        {custMode === "new" ? (
          <div
            className="sv-step0-new-body"
            style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
          >
            <div className="hide-scrollbar sv-step0-new-fields" style={{ paddingRight: 4 }}>
              <Btn
                variant="secondary"
                size="lg"
                onClick={leaveNewCustomerMode}
                icon={<I.ChevL s={22} c={C.primaryDeep} />}
                style={backToLookupBtnStyle}
              >
                Back to lookup
              </Btn>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 20,
                  marginBottom: 16,
                }}
              >
                <div>
                  <label
                    style={{
                      fontSize: touchRow.fontMeta,
                      fontWeight: 600,
                      color: C.textSec,
                      display: "block",
                      marginBottom: 8,
                    }}
                  >
                    Customer name *
                  </label>
                  <input
                    ref={nameRef}
                    value={custName}
                    readOnly
                    inputMode="none"
                    autoComplete="off"
                    onFocus={() => setActiveKbField("name")}
                    placeholder="e.g. Sokha Keo"
                    aria-label="Customer name"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "16px 18px",
                      minHeight: touchRow.inputMinH,
                      borderRadius: 12,
                      border: `1.5px solid ${activeKbField === "name" ? C.primary : C.border}`,
                      fontSize: touchRow.fontBody,
                      fontFamily: font,
                      outline: "none",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      fontSize: touchRow.fontMeta,
                      fontWeight: 600,
                      color: C.textSec,
                      display: "block",
                      marginBottom: 8,
                    }}
                  >
                    Phone
                  </label>
                  <div
                    aria-label="Customer phone"
                    style={{
                      padding: "16px 18px",
                      minHeight: touchRow.inputMinH,
                      borderRadius: 12,
                      border: `1.5px solid ${C.border}`,
                      fontSize: touchRow.fontBody,
                      fontFamily: font,
                      color: custPhone ? C.text : C.textTer,
                      boxSizing: "border-box",
                    }}
                  >
                    {custPhone ? formatPhoneLocal(custPhone) || custPhone : "Use the number pad →"}
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label
                  style={{
                    fontSize: touchRow.fontMeta,
                    fontWeight: 600,
                    color: C.textSec,
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  Preferred language
                </label>
                <div
                  role="radiogroup"
                  aria-label="Preferred language"
                  style={{ display: "flex", gap: 10 }}
                >
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      type="button"
                      role="radio"
                      aria-checked={custLanguage === l.code}
                      onClick={() => setCustLanguage(l.code)}
                      style={{
                        minHeight: touchRow.tap,
                        padding: "0 22px",
                        borderRadius: 12,
                        border: `1.5px solid ${custLanguage === l.code ? C.primary : C.border}`,
                        background: custLanguage === l.code ? C.primarySoft : C.card,
                        color: custLanguage === l.code ? C.primaryDeep : C.text,
                        fontFamily: l.code === "km-KH" ? fontKm : font,
                        fontSize: touchRow.fontBody,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label
                  style={{
                    fontSize: touchRow.fontMeta,
                    fontWeight: 600,
                    color: C.textSec,
                    display: "block",
                    marginBottom: 8,
                  }}
                >
                  Customer note
                </label>
                <textarea
                  ref={noteRef}
                  value={custNote}
                  readOnly
                  inputMode="none"
                  onFocus={() => setActiveKbField("note")}
                  placeholder="Optional — travels with the Booking Draft"
                  aria-label="Customer note"
                  rows={2}
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "14px 18px",
                    borderRadius: 12,
                    border: `1.5px solid ${activeKbField === "note" ? C.primary : C.border}`,
                    fontSize: touchRow.fontBody,
                    fontFamily: font,
                    outline: "none",
                    resize: "none",
                  }}
                />
              </div>
              {createFailure !== null ? (
                <div
                  role="alert"
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: C.redLight,
                    color: C.redDark,
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                >
                  The Store Hub did not create the customer: {createFailure}
                </div>
              ) : null}
            </div>
            <div className="sv-step0-create-foot">
              <div className="kl-touch-pad-zone kl-touch-pad-zone--keyboard">
                <OnScreenKeyboard
                  onKey={dispatchKbKey}
                  shifted={kbShifted}
                  onToggleShift={() => setKbShifted((v) => !v)}
                />
              </div>
              <Btn
                variant="primary"
                size="xl"
                onClick={() => {
                  void handleCreate();
                }}
                disabled={!canCreate}
                style={{ width: "100%", marginTop: 10 }}
              >
                {creating ? "Creating on the Store Hub…" : "Create customer"}
              </Btn>
            </div>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ marginBottom: 8, flexShrink: 0 }}>
              <div className="sv-step0-search-row">
                <div className="sv-step0-search-field">
                  <I.Search s={20} c={C.textSec} />
                  <input
                    value={custSearch ? formatPhoneLocal(custSearch) || custSearch : ""}
                    readOnly
                    inputMode="none"
                    autoComplete="off"
                    placeholder="Phone (012…)"
                    aria-label="Search by phone"
                  />
                  {custSearch && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setCustSearch("")}
                      style={{
                        minWidth: touchRow.tap,
                        minHeight: touchRow.tap,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        borderRadius: 10,
                      }}
                    >
                      <I.X s={20} c={C.textTer} />
                    </button>
                  )}
                </div>
                <Btn
                  variant="secondary"
                  size="lg"
                  onClick={enterNewCustomerMode}
                  icon={<I.User s={20} c={C.primaryDeep} />}
                >
                  New customer
                </Btn>
              </div>
            </div>
            <div
              className="hide-scrollbar"
              onScroll={onWizardScroll}
              data-customer-search={search.status}
              style={{
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                borderRadius: 14,
                border: `1px solid ${C.border}`,
                background: C.card,
              }}
            >
              {search.status === "found"
                ? search.customers.map((c, i, all) => (
                    <CustomerPickRow
                      key={c.id}
                      customer={c}
                      selected={selCustomer?.id === c.id}
                      isLast={i === all.length - 1}
                      onPick={() => pick(c)}
                    />
                  ))
                : null}
              {selCustomer !== null && search.status !== "found" ? (
                <CustomerPickRow
                  customer={selCustomer}
                  selected
                  isLast
                  onPick={() => pick(selCustomer)}
                />
              ) : null}
              <div
                style={{
                  padding: 18,
                  fontSize: touchRow.fontMeta,
                  color: C.textSec,
                  lineHeight: 1.5,
                }}
              >
                {search.status === "idle" && selCustomer === null
                  ? "Enter the customer's phone number with the number pad in the booking panel."
                  : null}
                {search.status === "too_short"
                  ? `Keep going — at least ${String(PHONE_SEARCH_MIN_DIGITS)} digits are needed to search the Store Hub.`
                  : null}
                {searching ? "Searching the Store Hub…" : null}
                {search.status === "none"
                  ? "No customer with this phone on the Store Hub. Tap New customer to create one."
                  : null}
                {search.status === "failed" ? (
                  <span role="alert" style={{ color: C.redDark }}>
                    {search.kind === "unavailable"
                      ? "The Store Hub could not be reached — this is not a “no match”. Try again."
                      : `The Store Hub refused the search: ${search.kind.replace(/_/g, " ")} — ${search.detail}`}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ rail column
  return (
    <>
      <div
        className="hide-scrollbar"
        style={{
          flex: "1 1 0%",
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "0 0 12px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <CustomerPreview
          customer={selCustomer}
          draftName={custName}
          draftPhone={custPhone}
          draftLanguage={custLanguage}
        />
        {selCustomer !== null ? (
          <Btn
            variant="secondary"
            size="md"
            onClick={() => {
              setSelCustomer(null);
              showToast("Customer cleared");
            }}
          >
            Choose a different customer
          </Btn>
        ) : null}
      </div>
      <div
        className="kl-touch-pad-footer"
        style={{ padding: "8px 0 0", background: "transparent" }}
      >
        {custMode === "new" ? (
          <PhoneNumpad value={custPhone} onChange={setCustPhone} />
        ) : (
          <PhoneNumpad value={custSearch} onChange={setCustSearch} />
        )}
      </div>
    </>
  );
};
