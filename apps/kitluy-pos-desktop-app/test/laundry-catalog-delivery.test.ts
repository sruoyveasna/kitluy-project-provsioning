/**
 * T1-REAL-OPERATIONS-001 (slice 1) — the catalog and the money contract reach
 * the terminal THROUGH the verified configuration: the neutral section parser,
 * the Laundry catalog/money contract, the face's mapping, the billable-weight
 * rule as data, and the Pi runtime handing the sections over whole.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EdgeBridgeStatusWire } from "../src/bootstrap/edge-machine.js";
import { parseConfigurationSections } from "../src/bootstrap/configuration-sections.js";
import type { HubCall } from "../electron/edge-operations-session.js";
import { PiTerminalRuntime } from "../electron/pi-runtime.js";
import {
  LAUNDRY_CATALOG_SCHEMA,
  LAUNDRY_MONEY_SCHEMA,
  billableKilograms,
  parseLaundryCatalogSection,
  parseLaundryMoneySection,
} from "../src/vertical/laundry/catalog-section.js";
import {
  CATALOG_NOT_DELIVERED_REASON,
  catalogAnswerFromSections,
} from "../src/vertical/laundry/face/ports.js";

const T1 = "laundry.t1.intake_cashier";
const TERMINAL = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const HUB = "549a41c6-21e9-4838-8b48-34a3878ba290";
const SCOPE = {
  tenantId: "e0000000-0000-4000-8000-000000000001",
  digitalStoreId: "e0000000-0000-4000-8000-000000000002",
  storeLocationId: "e0000000-0000-4000-8000-000000000003",
};

/** The designed price list, exactly as the development loader reads it. */
const DESIGNED = JSON.parse(
  readFileSync(
    new URL("../../../scripts/development/fixtures/laundry-catalog.designed.json", import.meta.url),
    "utf8",
  ),
) as {
  families: { code: string; lane: string; name: string; name_km?: string; sort_order: number }[];
  categories: { code: string; name: string; sort_order: number; families: string[] }[];
  services: {
    service_code: string;
    family: string;
    pricing_mode: string;
    name: string;
    display_name?: string;
    unit_price_khr: number;
    garment_code: string | null;
    category_code: string | null;
    sort_order: number;
  }[];
  garment_types: {
    code: string;
    name: string;
    category_code: string;
    sort_order: number;
    families: string[];
  }[];
};

/** What the group 0233 door projects from that list (the same key names). */
function doorCatalog() {
  const services = DESIGNED.services.map((s, i) => ({
    service_id: `00000000-0000-4000-8000-${String(1000 + i).padStart(12, "0")}`,
    service_code: s.service_code,
    family_code: s.family,
    catalog_item_code: `SRV-${s.service_code}`,
    name: s.name,
    name_km: null,
    display_name: s.display_name ?? s.name,
    garment_code: s.garment_code,
    category_code: s.category_code,
    icon_key: null,
    sort_order: s.sort_order,
    pricing_mode: s.pricing_mode,
    currency_code: "KHR",
    unit_price_minor: s.unit_price_khr,
    min_charge_minor: null,
    effective_from: "2026-09-19T00:00:00+00:00",
    location_price: false,
    service_version: 1,
  }));
  const catalog = {
    schema: LAUNDRY_CATALOG_SCHEMA,
    currency_code: "KHR",
    families: DESIGNED.families.map((f) => ({
      code: f.code,
      lane: f.lane,
      name: f.name,
      name_km: f.name_km ?? null,
      sort_order: f.sort_order,
    })),
    categories: DESIGNED.categories.map((c) => ({
      code: c.code,
      name: c.name,
      name_km: null,
      sort_order: c.sort_order,
      family_codes: c.families,
    })),
    services,
    garment_types: DESIGNED.garment_types.map((g) => ({
      code: g.code,
      name: g.name,
      name_km: null,
      category_code: g.category_code,
      sort_order: g.sort_order,
      family_codes: g.families,
    })),
  };
  return { ...catalog, content_hash: "a".repeat(64) };
}

const MONEY = {
  schema: LAUNDRY_MONEY_SCHEMA,
  currency_code: "KHR",
  currency_exponent: 0,
  money_rounding: "round_half_up_minor_unit",
  weight_rule: { unit: "kg", increment: 1, rounding: "up", minimum: 1 },
  location_code: "DEMO-PP-01",
  fx: { USD: { khr_per_usd: 4100, effective_from: "2026-09-19T00:00:00.000Z" } },
};

describe("the neutral section parser", () => {
  it("reads `{ section_code: content }` and refuses anything else", () => {
    expect(
      parseConfigurationSections('{"terminal_profiles":{"grants":[]},"catalog":{"a":1}}'),
    ).toEqual({
      terminal_profiles: { grants: [] },
      catalog: { a: 1 },
    });
    expect(parseConfigurationSections("[]")).toBeNull();
    expect(parseConfigurationSections('{"Bad-Code":{}}')).toBeNull();
    expect(parseConfigurationSections('{"pricing":"USD"}')).toBeNull();
    expect(parseConfigurationSections("not json")).toBeNull();
  });
});

describe("the Laundry catalog and money sections", () => {
  it("parse the door's projection of the designed price list", () => {
    const catalog = parseLaundryCatalogSection(doorCatalog());
    expect(catalog).not.toBeNull();
    expect(catalog?.families.map((f) => f.code)).toEqual(["WASH_FOLD", "DRY_CLEAN", "WASH_PRESS"]);
    expect(catalog?.services).toHaveLength(31);
    expect(catalog?.garmentTypes).toHaveLength(24);
    const shirtDc = catalog?.services.find((s) => s.serviceCode === "DC-DRESS_SHIRT");
    const shirtWp = catalog?.services.find((s) => s.serviceCode === "WP-DRESS_SHIRT");
    expect(shirtDc).toMatchObject({
      displayName: "Dress Shirt",
      unitPriceMinor: 8000,
      familyCode: "DRY_CLEAN",
    });
    expect(shirtWp).toMatchObject({
      displayName: "Dress Shirt",
      unitPriceMinor: 5000,
      familyCode: "WASH_PRESS",
    });
    const money = parseLaundryMoneySection(MONEY);
    expect(money).toMatchObject({
      currencyCode: "KHR",
      currencyExponent: 0,
      weightRule: { unit: "kg", increment: 1, rounding: "up", minimum: 1 },
      khrPerUsd: 4100,
      expressSurchargeBps: null,
      locationCode: "DEMO-PP-01",
    });
  });

  it("refuse a malformed section rather than reading around it", () => {
    expect(
      parseLaundryCatalogSection({ ...doorCatalog(), schema: "kitluy.config.catalog.v2" }),
    ).toBeNull();
    expect(parseLaundryCatalogSection({ ...doorCatalog(), content_hash: "short" })).toBeNull();
    const negative = doorCatalog();
    negative.services[0]!.unit_price_minor = -1;
    expect(parseLaundryCatalogSection(negative)).toBeNull();
    expect(parseLaundryMoneySection({ ...MONEY, currency_exponent: "0" })).toBeNull();
    expect(
      parseLaundryMoneySection({
        ...MONEY,
        weight_rule: { unit: "lb", increment: 1, rounding: "up", minimum: 1 },
      }),
    ).toBeNull();
    expect(parseLaundryMoneySection({ ...MONEY, fx: { USD: { khr_per_usd: 0 } } })).toBeNull();
    expect(parseLaundryMoneySection(undefined)).toBeNull();
  });

  it("bill weight by the Store's rule as data — never a default in code", () => {
    const whole = { unit: "kg" as const, increment: 1, rounding: "up" as const, minimum: 1 };
    expect(billableKilograms(2.3, whole)).toBe(3);
    expect(billableKilograms(3, whole)).toBe(3);
    expect(billableKilograms(0.4, whole)).toBe(1);
    expect(billableKilograms(0, whole)).toBe(0);
    const half = { unit: "kg" as const, increment: 0.5, rounding: "up" as const, minimum: 1 };
    expect(billableKilograms(2.3, half)).toBe(2.5);
    const exact = { unit: "kg" as const, increment: 0.1, rounding: "nearest" as const, minimum: 0 };
    expect(billableKilograms(2.34, exact)).toBeCloseTo(2.3, 9);
  });
});

describe("the face's catalog answer", () => {
  const read = {
    status: "delivered" as const,
    snapshotId: "s",
    configurationVersion: 9,
    verifiedAtHubTime: "2026-09-19T03:00:00.000Z",
    sections: { terminal_profiles: { grants: [] }, catalog: doorCatalog(), pricing: MONEY },
  };

  it("renders one family per priced family, the grid per family, the kg offering and the money", () => {
    const answer = catalogAnswerFromSections(read);
    expect(answer.status).toBe("delivered");
    if (answer.status !== "delivered") return;
    expect(answer.configurationVersion).toBe(9);
    expect(answer.families.map((f) => [f.code, f.lane])).toEqual([
      ["WASH_FOLD", "wf"],
      ["DRY_CLEAN", "pp"],
      ["WASH_PRESS", "pp"],
    ]);
    expect(answer.families[0]?.nameKm).toBe("បោកបត់");
    expect(answer.perWeight).toEqual([
      {
        serviceCode: "WF-KG",
        name: "Wash & Fold (per kg)",
        rateKhr: 4000,
        familyCode: "WASH_FOLD",
        familyName: "Wash & Fold",
      },
    ]);
    expect(answer.perPiece).toHaveLength(30);
    expect(answer.perPiece.filter((i) => i.familyCode === "DRY_CLEAN")).toHaveLength(15);
    expect(answer.perPiece.find((i) => i.code === "WP-SUIT_2PC")).toMatchObject({
      name: "Men's Suit (2-piece)",
      priceKhr: 15000,
      category: "GENERAL",
      familyName: "Wash & Press",
    });
    expect(answer.garmentTypes.map((g) => g.id).slice(0, 2)).toEqual(["WF_TSHIRT", "WF_POLO"]);
    expect(answer.garmentTypes[0]?.category).toBe("Tops");
    expect(answer.categories.map((c) => c.id)).toEqual([
      "GENERAL",
      "TOPS",
      "BOTTOMS",
      "LINENS",
      "KIDS_SPORTS",
    ]);
    expect(answer.money).toMatchObject({
      currencyCode: "KHR",
      khrPerUsd: 4100,
      weightRule: { increment: 1, rounding: "up", minimum: 1 },
    });
    // No emoji reaches the face from the delivery.
    expect(JSON.stringify(answer)).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("says not delivered — with the honest reason — when the section is absent, malformed, or the runtime has none", () => {
    expect(catalogAnswerFromSections({ ...read, sections: { terminal_profiles: {} } })).toEqual({
      status: "not_delivered",
      reason: CATALOG_NOT_DELIVERED_REASON,
    });
    expect(
      catalogAnswerFromSections({ ...read, sections: { catalog: { schema: "x" } } }),
    ).toMatchObject({
      status: "not_delivered",
      reason: expect.stringContaining("kitluy.config.catalog.v1"),
    });
    expect(
      catalogAnswerFromSections({ status: "not_delivered", reason: "no verified delivery" }),
    ).toEqual({
      status: "not_delivered",
      reason: "no verified delivery",
    });
    // A catalog without a money contract is delivered, money null: the Hub will not price.
    const noMoney = catalogAnswerFromSections({ ...read, sections: { catalog: doorCatalog() } });
    expect(noMoney.status === "delivered" && noMoney.money === null).toBe(true);
  });
});

describe("the Pi runtime hands the verified sections over whole", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kitluy-pi-config-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const STATUS: EdgeBridgeStatusWire = {
    edge: { phase: "SERVING", detail: "connected", checkedAt: new Date().toISOString() },
    hub: { hubDeviceId: HUB, host: "h", port: 7443 },
    terminal: { deviceId: TERMINAL, assignmentGeneration: 3, profileCodes: [T1] },
  };

  function hubWith(payloadJson: string): HubCall {
    const now = () => new Date().toISOString();
    return async (_method, path) => {
      if (path === "/edge/v1/runtime/authority-time") {
        return {
          status: 200,
          body: {
            protocolVersion: "1.0",
            authorityTime: now(),
            authoritySource: "hub_database",
            responseId: "r",
            generatedAt: now(),
            maxCacheAgeSeconds: 30,
            correlationId: "c",
          },
        };
      }
      if (path === "/edge/v1/runtime/eligibility") {
        return {
          status: 200,
          body: {
            eligibility: {
              protocolVersion: "1.0",
              ...SCOPE,
              environment: "development",
              hubDeviceId: HUB,
              terminalDeviceId: TERMINAL,
              assignmentId: "a",
              assignmentGeneration: 3,
              terminalProfileCode: T1,
              primaryVertical: "laundry",
              credentialId: "c",
              credentialGeneration: 3,
              credentialEligibility: "eligible",
              activationEligibility: "activated",
              pairingEligibility: "paired",
              pairedAt: now(),
              containmentState: "none",
              hubReplacementState: "normal",
              requiredConfigurationVersion: null,
              authorityTime: now(),
            },
          },
        };
      }
      if (path === "/edge/v1/configuration/current") {
        return {
          status: 200,
          body: {
            delivery: {
              snapshotId: "snap-9",
              configurationVersion: 9,
              schemaVersion: 1,
              ...SCOPE,
              environment: "development",
              hubDeviceId: HUB,
              terminalDeviceId: TERMINAL,
              assignmentGeneration: 3,
              terminalProfileCode: T1,
              primaryVertical: "laundry",
              minimumApplicationVersion: "0.1.0",
              maximumApplicationVersion: null,
              issuedAt: new Date(Date.now() - 60_000).toISOString(),
              effectiveAt: new Date(Date.now() - 60_000).toISOString(),
              validUntil: new Date(Date.now() + 3_600_000).toISOString(),
              manifestSha256: "m",
              payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
              signingKeyId: "k",
              correlationId: "x",
            },
            payloadJson,
            deliverySignature: "AAAA",
            rollbackReference: null,
          },
        };
      }
      if (path === "/edge/v1/terminal-pin/status") {
        return {
          status: 200,
          body: {
            result: "TERMINAL_PIN_STATUS",
            pin: {
              state: "set",
              pinVersion: 1,
              setAt: now(),
              lockedUntil: null,
              attemptsBeforeLock: 5,
            },
            session: null,
            authorityTime: now(),
          },
        };
      }
      return { status: 404, body: null };
    };
  }

  it("answers not_delivered before a run, and the sections after the digest-checked delivery", async () => {
    const payloadJson = JSON.stringify({
      terminal_profiles: { grants: [] },
      catalog: doorCatalog(),
      pricing: MONEY,
    });
    let t = 1_000;
    const runtime = new PiTerminalRuntime({
      socketPath: "/nonexistent",
      applicationVersion: "0.1.0",
      statusPath: join(dir, "pos-runtime.json"),
      call: hubWith(payloadJson),
      bridgeStatus: () => Promise.resolve(STATUS),
      monotonicNow: () => (t += 1),
      logger: { log: () => undefined },
      devicePinPosturePath: null,
    });
    expect(runtime.configurationRead()).toMatchObject({ status: "not_delivered" });
    const report = await runtime.refresh();
    expect(report.state).toBe("staff_authentication_required");
    const read = runtime.configurationRead();
    expect(read).toMatchObject({
      status: "delivered",
      snapshotId: "snap-9",
      configurationVersion: 9,
    });
    if (read.status !== "delivered") return;
    expect(Object.keys(read.sections).sort()).toEqual(["catalog", "pricing", "terminal_profiles"]);
    const answer = catalogAnswerFromSections(read);
    expect(answer.status === "delivered" && answer.perPiece.length).toBe(30);
  });
});
