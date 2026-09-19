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
  T1_CONFIGURATION_BRIDGE_KEY,
  T1_INTAKE_BRIDGE_KEY,
  T1_PIN_BRIDGE_KEY,
  type T1ConfigurationBridge,
  type T1ConfigurationRead,
  type T1PinBridge,
} from "../../../bootstrap/bridge-types.js";
import type { IntakeCustomer, IntakeDraft, IntakeResult } from "../../../intake/ports.js";
import {
  parseLaundryCatalogSection,
  parseLaundryMoneySection,
  type LaundryCatalogSection,
  type LaundryMoneySection,
} from "../catalog-section.js";
import type {
  CatalogFamily,
  CatalogItem,
  Customer,
  DeliveredMoney,
  LaundryItemCategory,
  PreferredLanguage,
  WFItem,
  WfKgOffering,
} from "./types";

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
      readonly families: readonly CatalogFamily[];
      readonly categories: readonly LaundryItemCategory[];
      readonly perPiece: readonly CatalogItem[];
      readonly perWeight: readonly WfKgOffering[];
      readonly garmentTypes: readonly WFItem[];
      /** Null when the Store has published no money contract: the Hub will not price. */
      readonly money: DeliveredMoney | null;
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
  "(the active configuration carries no `catalog` section).";

/**
 * The delivered sections → what the face renders. Pure, so a test can hand it
 * a delivery. Families with no priced service are dropped; a per-piece
 * service is a grid card of its family; per-weight services are kg offerings.
 */
export function catalogAnswerFromSections(read: T1ConfigurationRead): CatalogAnswer {
  if (read.status !== "delivered") return { status: "not_delivered", reason: read.reason };
  const catalog: LaundryCatalogSection | null = parseLaundryCatalogSection(
    read.sections["catalog"],
  );
  if (catalog === null) {
    return {
      status: "not_delivered",
      reason:
        read.sections["catalog"] === undefined
          ? CATALOG_NOT_DELIVERED_REASON
          : "The delivered `catalog` section is not the kitluy.config.catalog.v1 shape this terminal reads.",
    };
  }
  const moneySection: LaundryMoneySection | null = parseLaundryMoneySection(
    read.sections["pricing"],
  );
  const familyName = new Map(catalog.families.map((f) => [f.code, f.name]));
  const lane = (code: string | null): "wf" | "pp" | null => {
    const f = catalog.families.find((x) => x.code === code);
    return f === undefined ? null : f.lane === "per_weight" ? "wf" : "pp";
  };
  const perPiece: CatalogItem[] = [];
  const perWeight: WfKgOffering[] = [];
  for (const s of [...catalog.services].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (s.currencyCode !== "KHR") continue; // the face shows whole riel only
    if (s.pricingMode === "PER_WEIGHT") {
      perWeight.push({
        serviceCode: s.serviceCode,
        name: s.displayName,
        rateKhr: s.unitPriceMinor,
        familyCode: s.familyCode,
        familyName: familyName.get(s.familyCode ?? "") ?? null,
      });
    } else {
      const category = catalog.categories.find((c) => c.code === s.categoryCode);
      perPiece.push({
        id: s.serviceId,
        code: s.serviceCode,
        name: s.displayName,
        icon: s.iconKey ?? "",
        iconPath: null,
        priceKhr: s.unitPriceMinor,
        category: s.categoryCode,
        categorySortOrder: category?.sortOrder ?? null,
        familyCode: s.familyCode,
        familyName: familyName.get(s.familyCode ?? "") ?? null,
      });
    }
  }
  const pricedFamilies = new Set([
    ...perPiece.map((i) => i.familyCode),
    ...perWeight.map((o) => o.familyCode),
  ]);
  const families: CatalogFamily[] = catalog.families
    .filter((f) => pricedFamilies.has(f.code))
    .map((f) => ({
      code: f.code,
      lane: lane(f.code) ?? "pp",
      name: f.name,
      nameKm: f.nameKm,
      sortOrder: f.sortOrder,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const categories: LaundryItemCategory[] = catalog.categories.map((c) => ({
    id: c.code,
    code: c.code,
    name: c.name,
    sortOrder: c.sortOrder,
    iconPath: null,
  }));
  const garmentTypes: WFItem[] = [...catalog.garmentTypes]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => {
      const category = catalog.categories.find((c) => c.code === g.categoryCode);
      return {
        id: g.code,
        name: g.name,
        icon: "",
        category: category?.name ?? g.categoryCode ?? "",
        categorySortOrder: category?.sortOrder ?? 0,
      };
    });
  const money: DeliveredMoney | null =
    moneySection === null
      ? null
      : {
          currencyCode: moneySection.currencyCode,
          currencyExponent: moneySection.currencyExponent,
          weightRule:
            moneySection.weightRule === null
              ? null
              : {
                  increment: moneySection.weightRule.increment,
                  rounding: moneySection.weightRule.rounding,
                  minimum: moneySection.weightRule.minimum,
                },
          khrPerUsd: moneySection.khrPerUsd,
          expressSurchargeBps: moneySection.expressSurchargeBps,
          locationCode: moneySection.locationCode,
        };
  return {
    status: "delivered",
    configurationVersion: read.configurationVersion,
    families,
    categories,
    perPiece,
    perWeight,
    garmentTypes,
    money,
  };
}

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
  const configuration = w[T1_CONFIGURATION_BRIDGE_KEY] as T1ConfigurationBridge | undefined;
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
    // The catalog is a section of the configuration the main process VERIFIED
    // against the Hub's signed envelope; an application without that bridge
    // (an older preload) still says "not delivered" rather than guessing.
    readCatalog: () =>
      configuration === undefined
        ? Promise.resolve({ status: "not_delivered", reason: CATALOG_NOT_DELIVERED_REASON })
        : configuration.read().then(catalogAnswerFromSections),
    lockTerminal: () => pin.lock().then(() => undefined),
  };
}
