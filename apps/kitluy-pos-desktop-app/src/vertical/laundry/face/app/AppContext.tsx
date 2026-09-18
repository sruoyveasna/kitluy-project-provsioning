/**
 * Laundry T1 face — booking state.
 *
 * PROVENANCE: `src/app/AppContext.tsx` of the donor
 * `kitluy-laundry-pos-desk-app@8b2f107`, reduced to the booking wizard. Gone:
 * phase / terminal selection (REJECTED — a terminal never chooses its
 * identity), staff + PIN + shift (SUPERSEDED — the device credential and the
 * Terminal PIN session live in the runtime), payment tender, loyalty coins,
 * ads, T2/T4 mirrors, ABA PayWay, printing flags (GATED to their WS-12 tasks).
 *
 * What remains is what the cashier is composing at the counter: the wizard
 * step, the customer being chosen or created, the cart, the per-kg entry, and
 * the Booking Draft the Store Hub answered.
 */
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";

import { useClock } from "@face/hooks/useClock";
import { useToast } from "@face/hooks/useToast";
import {
  clampWfKg,
  WF_KG_CART_ID,
  WF_KG_WHEEL_MAX,
} from "@face/features/t1-pos/laundry-savor/wfKgConstants";
import type { FacePorts, IntakeDraft } from "@face/ports";
import type { CartItem, Customer, PreferredLanguage, ServiceType, T1View } from "@face/types";

import { AppStateContext } from "./context";

type SetState<T> = Dispatch<SetStateAction<T>>;

export type CustMode = "search" | "new";

/** The Booking Draft as the Store Hub last answered it, plus how it got there. */
export interface DraftContext {
  readonly draft: IntakeDraft;
  /** `created` on the first answer, `updated` after a notes save. */
  readonly lastOperation: "created" | "updated";
}

export interface AppState {
  readonly ports: FacePorts;

  // Shell
  view: T1View;
  setView: SetState<T1View>;
  time: string;
  toast: string | null;
  showToast: (msg: string) => void;

  // Wizard
  wizStep: number;
  /** Highest step reached this booking — enables step-bar jumps. */
  wizStepMax: number;
  setWizStep: SetState<number>;

  // Customer
  custName: string;
  setCustName: SetState<string>;
  custPhone: string;
  setCustPhone: SetState<string>;
  custNote: string;
  setCustNote: SetState<string>;
  custLanguage: PreferredLanguage;
  setCustLanguage: SetState<PreferredLanguage>;
  custMode: CustMode;
  setCustMode: SetState<CustMode>;
  custSearch: string;
  setCustSearch: SetState<string>;
  selCustomer: Customer | null;
  setSelCustomer: SetState<Customer | null>;
  staffNote: string;
  setStaffNote: SetState<string>;

  // Cart
  cart: CartItem[];
  setCart: SetState<CartItem[]>;
  selServiceType: ServiceType | null;
  setSelServiceType: SetState<ServiceType | null>;
  itemQtys: Record<string, number>;
  setItemQtys: SetState<Record<string, number>>;
  wfItemQtys: Record<string, number>;
  setWfItemQtys: SetState<Record<string, number>>;
  /** Weighed load (whole kg). */
  wfKg: number;
  setWfKg: SetState<number>;
  /** True while the cashier is typing kg — shows the numpad on the rail. */
  wfKgInputActive: boolean;
  setWfKgInputActive: SetState<boolean>;
  wfKgDigits: string;
  setWfKgDigits: SetState<string>;

  // Derived
  cartSubtotal: number;
  cartCount: number;
  /** Cart qty + per-kg garment checklist rows (panel display). */
  bookingLineCount: number;

  /** The Booking Draft the Store Hub answered for THIS booking; null until created. */
  bookingDraft: DraftContext | null;
  setBookingDraft: SetState<DraftContext | null>;

  t1WizardScrollRatio: number;
  setT1WizardScrollRatio: SetState<number>;

  // Mutators
  addToCart: (item: CartItem) => void;
  updateQty: (id: string, d: number) => void;
  removeWfService: () => void;
  resetOrder: () => void;
}

export const AppStateProvider = ({
  ports,
  children,
}: {
  readonly ports: FacePorts;
  readonly children: ReactNode;
}) => {
  const time = useClock(30_000);
  const { toast, showToast } = useToast(2500);

  const [view, setView] = useState<T1View>("new_order");
  const [wizStep, setWizStepState] = useState<number>(0);
  const [wizStepMax, setWizStepMax] = useState<number>(0);
  const setWizStep = useCallback((step: SetStateAction<number>) => {
    setWizStepState((prev) => {
      const next = typeof step === "function" ? step(prev) : step;
      if (next > prev) setWizStepMax((max) => Math.max(max, next));
      return next;
    });
  }, []);

  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custNote, setCustNote] = useState("");
  const [custLanguage, setCustLanguage] = useState<PreferredLanguage>("km-KH");
  const [custMode, setCustMode] = useState<CustMode>("search");
  const [custSearch, setCustSearch] = useState("");
  const [selCustomer, setSelCustomer] = useState<Customer | null>(null);
  const [staffNote, setStaffNote] = useState("");

  const [cart, setCart] = useState<CartItem[]>([]);
  const [selServiceType, setSelServiceType] = useState<ServiceType | null>(null);
  const [itemQtys, setItemQtys] = useState<Record<string, number>>({});
  const [wfItemQtys, setWfItemQtys] = useState<Record<string, number>>({});
  const [wfKg, setWfKg] = useState(0);
  const [wfKgInputActive, setWfKgInputActive] = useState(false);
  const [wfKgDigits, setWfKgDigits] = useState("");

  const [bookingDraft, setBookingDraft] = useState<DraftContext | null>(null);
  const [t1WizardScrollRatio, setT1WizardScrollRatio] = useState(0);

  // Integer KHR arithmetic on a display preview. The Booking's price is NOT
  // computed here (WS-12-T004 / vertical pricing authority, @kitluy/money).
  const cartSubtotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const cartCount = cart.reduce((s, c) => {
    if (c.id === WF_KG_CART_ID) return s + (c.qty >= 1 ? 1 : 0);
    return s + c.qty;
  }, 0);
  const wfGarmentCount = wfKg >= 1 ? Object.values(wfItemQtys).reduce((s, v) => s + v, 0) : 0;
  const bookingLineCount = cartCount + wfGarmentCount;

  const addToCart = useCallback((item: CartItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      return existing
        ? prev.map((c) => (c.id === item.id ? { ...c, qty: c.qty + 1 } : c))
        : [...prev, { ...item, qty: 1 }];
    });
  }, []);

  const updateQty = useCallback((id: string, d: number) => {
    if (id === WF_KG_CART_ID) {
      setWfKg((prev) => {
        if (d > 0 && prev === WF_KG_WHEEL_MAX) {
          setWfKgInputActive(true);
          setWfKgDigits(String(WF_KG_WHEEL_MAX));
          return prev;
        }
        const next = prev + d;
        if (!Number.isFinite(next)) return Math.max(0, prev);
        if (d !== 0) setWfKgInputActive(false);
        return clampWfKg(next);
      });
      return;
    }
    setCart((prev) => {
      const touched = prev.find((c) => c.id === id);
      const next = prev
        .map((c) => (c.id === id ? { ...c, qty: Math.max(0, c.qty + d) } : c))
        .filter((c) => c.qty > 0);
      // Per-piece quantities live in `itemQtys` and are rebuilt into the cart
      // when adding from the grid; keep both in sync when the rail +/- is used.
      if (touched !== undefined && touched.svc === "pp" && id.startsWith("pp-")) {
        const key = id.slice("pp-".length);
        const newQty = next.find((c) => c.id === id)?.qty ?? 0;
        setItemQtys((iq) => {
          const m = { ...iq };
          if (newQty <= 0) delete m[key];
          else m[key] = newQty;
          return m;
        });
      }
      return next;
    });
  }, []);

  const removeWfService = useCallback(() => {
    setCart((prev) => prev.filter((c) => c.svc !== "wf"));
    setWfItemQtys({});
    setWfKg(0);
    setWfKgInputActive(false);
    setWfKgDigits("");
    setSelServiceType(null);
  }, []);

  const resetOrder = useCallback(() => {
    setWizStepState(0);
    setWizStepMax(0);
    setCustName("");
    setCustPhone("");
    setCustNote("");
    setCustLanguage("km-KH");
    setCustMode("search");
    setCustSearch("");
    setSelCustomer(null);
    setStaffNote("");
    setCart([]);
    setSelServiceType(null);
    setItemQtys({});
    setWfItemQtys({});
    setWfKg(0);
    setWfKgInputActive(false);
    setWfKgDigits("");
    setBookingDraft(null);
    setT1WizardScrollRatio(0);
  }, []);

  const value = useMemo<AppState>(
    () => ({
      ports,
      view,
      setView,
      time,
      toast,
      showToast,
      wizStep,
      wizStepMax,
      setWizStep,
      custName,
      setCustName,
      custPhone,
      setCustPhone,
      custNote,
      setCustNote,
      custLanguage,
      setCustLanguage,
      custMode,
      setCustMode,
      custSearch,
      setCustSearch,
      selCustomer,
      setSelCustomer,
      staffNote,
      setStaffNote,
      cart,
      setCart,
      selServiceType,
      setSelServiceType,
      itemQtys,
      setItemQtys,
      wfItemQtys,
      setWfItemQtys,
      wfKg,
      setWfKg,
      wfKgInputActive,
      setWfKgInputActive,
      wfKgDigits,
      setWfKgDigits,
      cartSubtotal,
      cartCount,
      bookingLineCount,
      bookingDraft,
      setBookingDraft,
      t1WizardScrollRatio,
      setT1WizardScrollRatio,
      addToCart,
      updateQty,
      removeWfService,
      resetOrder,
    }),
    [
      ports,
      view,
      time,
      toast,
      showToast,
      wizStep,
      wizStepMax,
      setWizStep,
      custName,
      custPhone,
      custNote,
      custLanguage,
      custMode,
      custSearch,
      selCustomer,
      staffNote,
      cart,
      selServiceType,
      itemQtys,
      wfItemQtys,
      wfKg,
      wfKgInputActive,
      wfKgDigits,
      cartSubtotal,
      cartCount,
      bookingLineCount,
      bookingDraft,
      t1WizardScrollRatio,
      addToCart,
      updateQty,
      removeWfService,
      resetOrder,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
};
