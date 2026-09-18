/**
 * Laundry T1 face — the ONLY way the face reaches the world.
 *
 * The donor app read and wrote Supabase from its hooks (disposition register:
 * REJECTED — hard rule 6). Here every operation is a named port over the
 * preload bridges the Pi runtime already exposes (WS-12-T002-P02 intake
 * operations, TERMINAL-PIN-AND-REAL-POS-AUTH-001 lock), so the face can neither
 * bypass the Store Hub nor invent what the Hub did not answer.
 *
 * `catalog` is deliberately a port too: the Store Hub delivers no Service
 * catalog to a terminal yet (the active configuration snapshot carries only
 * `terminal_profiles`). Until it does, the port answers `not_delivered` and the
 * Items step says so — it never shows a fixture price.
 */
import {
  T1_INTAKE_BRIDGE_KEY,
  T1_PIN_BRIDGE_KEY,
  type T1PinBridge,
} from "../../../bootstrap/bridge-types.js";
import type { IntakeCustomer, IntakeDraft, IntakeResult } from "../../../intake/ports.js";
import type { CatalogItem, Customer, PreferredLanguage, WFItem, WfKgOffering } from "./types";

export type { IntakeDraft, IntakeResult };

/** The renderer-visible intake bridge, exactly as `intake-ipc.ts` exposes it. */
export interface IntakeBridge {
  searchCustomers(p: { phone: string }): Promise<IntakeResult<readonly IntakeCustomer[]>>;
  createCustomer(p: {
    displayName: string;
    phone: string | null;
    preferredLanguage: PreferredLanguage;
  }): Promise<IntakeResult<IntakeCustomer>>;
  createDraft(p: {
    customerId: string | null;
    walkIn: boolean;
    preferredLanguage: PreferredLanguage;
    customerNotes: string;
    staffNotes: string;
  }): Promise<IntakeResult<IntakeDraft>>;
  readDraft(p: { draftId: string }): Promise<IntakeResult<IntakeDraft>>;
  updateDraft(p: {
    draftId: string;
    expectedVersion: number;
    customerNotes?: string;
    staffNotes?: string;
  }): Promise<IntakeResult<IntakeDraft>>;
  cancelDraft(p: { draftId: string; reasonCode: string }): Promise<IntakeResult<IntakeDraft>>;
}

/** What the Items step can know about the catalog. */
export type CatalogAnswer =
  | {
      readonly status: "not_delivered";
      /** Why, in words the operator can read. Never a guess at prices. */
      readonly reason: string;
    }
  | {
      readonly status: "delivered";
      readonly configurationVersion: number;
      readonly perPiece: readonly CatalogItem[];
      readonly perWeight: readonly WfKgOffering[];
      readonly garmentTypes: readonly WFItem[];
    };

export interface FacePorts {
  searchCustomersByPhone(phone: string): Promise<IntakeResult<readonly Customer[]>>;
  createCustomer(input: {
    readonly displayName: string;
    readonly phone: string | null;
    readonly preferredLanguage: PreferredLanguage;
  }): Promise<IntakeResult<Customer>>;
  createDraft(input: {
    readonly customerId: string | null;
    readonly walkIn: boolean;
    readonly preferredLanguage: PreferredLanguage;
    readonly customerNotes: string;
    readonly staffNotes: string;
  }): Promise<IntakeResult<IntakeDraft>>;
  updateDraft(input: {
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly customerNotes?: string;
    readonly staffNotes?: string;
  }): Promise<IntakeResult<IntakeDraft>>;
  cancelDraft(input: {
    readonly draftId: string;
    readonly reasonCode: string;
  }): Promise<IntakeResult<IntakeDraft>>;
  readCatalog(): Promise<CatalogAnswer>;
  /** Closes the Terminal PIN session; the runtime report then shows the PIN screen. */
  lockTerminal(): Promise<void>;
}

/** The Hub's customer answer, projected for the face. Nothing added. */
export function customerFromIntake(c: IntakeCustomer): Customer {
  return {
    id: c.customerId,
    name: c.displayName,
    phoneMasked: c.phoneMasked,
    phoneVerified: c.phoneVerified,
    preferredLanguage: c.preferredLanguage === "en-US" ? "en-US" : "km-KH",
    origin: c.origin,
    syncState: c.syncState,
  };
}

export const CATALOG_NOT_DELIVERED_REASON =
  "The Store Hub has not delivered a Service catalog to this terminal yet " +
  "(the active configuration carries terminal profiles only).";

function mapResult<A, B>(r: IntakeResult<A>, f: (a: A) => B): IntakeResult<B> {
  return r.ok ? { ok: true, value: f(r.value) } : r;
}

/**
 * Ports over the preload bridges. Returns `undefined` when the bridges are
 * absent (a browser dev session): the face then renders its unavailable face
 * and touches nothing — it never falls back to fixtures.
 */
export function bridgeFacePorts(): FacePorts | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as Record<string, unknown>;
  const intake = w[T1_INTAKE_BRIDGE_KEY] as IntakeBridge | undefined;
  const pin = w[T1_PIN_BRIDGE_KEY] as T1PinBridge | undefined;
  if (intake === undefined || pin === undefined) return undefined;
  return {
    searchCustomersByPhone: (phone) =>
      intake
        .searchCustomers({ phone })
        .then((r) => mapResult(r, (list) => list.map(customerFromIntake))),
    createCustomer: (input) =>
      intake.createCustomer(input).then((r) => mapResult(r, customerFromIntake)),
    createDraft: (input) => intake.createDraft(input),
    updateDraft: (input) => intake.updateDraft(input),
    cancelDraft: (input) => intake.cancelDraft(input),
    readCatalog: () =>
      Promise.resolve({ status: "not_delivered", reason: CATALOG_NOT_DELIVERED_REASON }),
    lockTerminal: () => pin.lock().then(() => undefined),
  };
}
