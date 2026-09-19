#!/usr/bin/env node
/**
 * `pnpm dev:catalog:load` — load a Laundry price list and the Store's money
 * contract into the development cloud (T1-REAL-OPERATIONS-001, slice 1).
 *
 *   KITLUY_DEV_FLEET_DSN=postgresql://postgres:postgres@127.0.0.1:54372/postgres \
 *   pnpm dev:catalog:load --khr-per-usd 4100 [--file <json>] [--store <uuid>] [--location <uuid>]
 *
 * ===========================================================================
 * WHAT IT WRITES, AND WHERE THE TRUTH THEN LIVES
 * ===========================================================================
 * Pricing truth stays with the WS-05 tables (WS-12 task register §2): this
 * writes `kitluy_core.catalog_items` (+ km/en translations),
 * `kitluy_laundry.services` (family = production_profile) and
 * `kitluy_laundry.service_prices` (the Store BASE book, KHR), plus the group
 * 0233 vocabulary (`service_families`, `catalog_categories`, `garment_types`),
 * and PUBLISHES the Store Location's `laundry.money.v1` configuration version
 * (group 0050 `kitluy_config.configuration_versions`). The Store Hub then pulls
 * all of it through the projection door (0232/0233) and publishes its signed
 * configuration; the terminal reads that. Nothing here talks to a Hub.
 *
 * The default price list is the owner's designed catalog
 * (`fixtures/laundry-catalog.designed.json`, derived from the donor app —
 * owner choice 2026-09-19). Replace the file, run again: idempotent by code.
 *
 * ===========================================================================
 * WHAT IT REFUSES TO GUESS
 * ===========================================================================
 * The KHR/USD rate. Without `--khr-per-usd` the money contract carries no FX
 * and the terminal offers no USD tender. The per-weight rule is the owner's
 * ruling of 2026-09-19 (whole kg, rounded up, minimum 1 kg) and is written as
 * data, not as code: change it here, not in the pricing engine.
 *
 * DEVELOPMENT ONLY: a local stack or the one allowlisted hosted dev project
 * (`dev-target.mjs`). A price change closes the open price row and opens a new
 * one from now — the history stays (service_prices is append-by-window).
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { resolveDevTarget } from "./dev-target.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = join(HERE, "fixtures", "laundry-catalog.designed.json");
/** The demo Store / Location the development boards are paired into. */
const DEFAULT_STORE = "00000000-0000-4000-8000-000000000015";
const DEFAULT_LOCATION = "00000000-0000-4000-8000-000000000018";
const MONEY_CONFIG_KEY = "laundry.money.v1";
const MONEY_SCHEMA = "kitluy.config.money.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function die(message) {
  console.error(`\nREFUSED: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {
    file: DEFAULT_FILE,
    store: DEFAULT_STORE,
    location: DEFAULT_LOCATION,
    khrPerUsd: null,
    expressBps: null,
    local: false,
    dryRun: false,
    pauseOthers: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--file") out.file = resolve(argv[(i += 1)] ?? "");
    else if (a === "--store") out.store = argv[(i += 1)] ?? "";
    else if (a === "--location") out.location = argv[(i += 1)] ?? "";
    else if (a === "--khr-per-usd") out.khrPerUsd = Number(argv[(i += 1)]);
    else if (a === "--express-bps") out.expressBps = Number(argv[(i += 1)]);
    else if (a === "--local") out.local = true;
    else if (a === "--dry-run") out.dryRun = true;
    // The Store's catalog becomes EXACTLY the file: every other ACTIVE service
    // of the Store is PAUSED (never deleted — a Booking line may snapshot it).
    else if (a === "--pause-others") out.pauseOthers = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "usage: load-laundry-catalog.mjs [--file <json>] [--store <uuid>] [--location <uuid>] " +
          "[--khr-per-usd <int>] [--express-bps <int>] [--pause-others] [--dry-run] [--local]",
      );
      process.exit(0);
    } else die(`unknown argument '${a}'`);
  }
  if (!UUID.test(out.store) || !UUID.test(out.location))
    die("--store and --location must be uuids");
  if (out.khrPerUsd !== null && (!Number.isInteger(out.khrPerUsd) || out.khrPerUsd < 1000)) {
    die("--khr-per-usd must be a whole number of riel per dollar (e.g. 4100)");
  }
  if (
    out.expressBps !== null &&
    (!Number.isInteger(out.expressBps) || out.expressBps < 0 || out.expressBps > 100000)
  ) {
    die("--express-bps must be an integer 0..100000 (5000 = +50%)");
  }
  return out;
}

const CODE = /^[A-Z][A-Z0-9_-]{1,39}$/u;

/** Validate the load file's closed shape; refuse anything that looks invented. */
export function parseCatalogFile(doc) {
  if (doc?.kind !== "kitluy.laundry-catalog-load.v1")
    throw new Error("the file is not a kitluy.laundry-catalog-load.v1 document");
  if (doc.currency_code !== "KHR")
    throw new Error(
      "only KHR price lists are loaded (KHR has no minor unit; prices are whole riel)",
    );
  const families = new Map();
  for (const f of doc.families ?? []) {
    if (
      !CODE.test(f.code) ||
      !["per_weight", "per_piece"].includes(f.lane) ||
      typeof f.name !== "string"
    ) {
      throw new Error(`family ${JSON.stringify(f.code)} is malformed`);
    }
    families.set(f.code, { ...f, name_km: f.name_km ?? null, sort_order: f.sort_order ?? 0 });
  }
  const categories = (doc.categories ?? []).map((c) => {
    if (!CODE.test(c.code) || typeof c.name !== "string")
      throw new Error(`category ${JSON.stringify(c.code)} is malformed`);
    for (const fam of c.families ?? [])
      if (!families.has(fam)) throw new Error(`category ${c.code} names unknown family ${fam}`);
    return {
      ...c,
      name_km: c.name_km ?? null,
      sort_order: c.sort_order ?? 0,
      families: c.families ?? [],
    };
  });
  const categoryCodes = new Set(categories.map((c) => c.code));
  const services = (doc.services ?? []).map((s) => {
    if (!CODE.test(s.service_code))
      throw new Error(`service code ${JSON.stringify(s.service_code)} is malformed`);
    if (!families.has(s.family))
      throw new Error(`service ${s.service_code} names unknown family ${s.family}`);
    if (!["PER_PIECE", "PER_WEIGHT"].includes(s.pricing_mode))
      throw new Error(`service ${s.service_code}: pricing_mode must be PER_PIECE or PER_WEIGHT`);
    if (
      families.get(s.family).lane !== (s.pricing_mode === "PER_WEIGHT" ? "per_weight" : "per_piece")
    ) {
      throw new Error(`service ${s.service_code}: pricing_mode does not match its family's lane`);
    }
    if (!Number.isInteger(s.unit_price_khr) || s.unit_price_khr < 0)
      throw new Error(`service ${s.service_code}: unit_price_khr must be a whole riel amount`);
    if (typeof s.name !== "string" || s.name === "")
      throw new Error(`service ${s.service_code}: name is required`);
    if (s.category_code != null && !categoryCodes.has(s.category_code))
      throw new Error(`service ${s.service_code} names unknown category ${s.category_code}`);
    return {
      ...s,
      display_name: s.display_name ?? s.name,
      name_km: s.name_km ?? null,
      garment_code: s.garment_code ?? null,
      category_code: s.category_code ?? null,
      icon_key: s.icon_key ?? null,
      sort_order: s.sort_order ?? 0,
      min_charge_khr: Number.isInteger(s.min_charge_khr) ? s.min_charge_khr : null,
    };
  });
  const garmentTypes = (doc.garment_types ?? []).map((g) => {
    if (!CODE.test(g.code) || typeof g.name !== "string")
      throw new Error(`garment type ${JSON.stringify(g.code)} is malformed`);
    if (g.category_code != null && !categoryCodes.has(g.category_code))
      throw new Error(`garment type ${g.code} names unknown category ${g.category_code}`);
    for (const fam of g.families ?? [])
      if (!families.has(fam)) throw new Error(`garment type ${g.code} names unknown family ${fam}`);
    return {
      ...g,
      name_km: g.name_km ?? null,
      category_code: g.category_code ?? null,
      sort_order: g.sort_order ?? 0,
      families: g.families ?? [],
    };
  });
  return { families: [...families.values()], categories, services, garmentTypes };
}

/** The money contract the Hub publishes as its `pricing` section. Owner values only. */
export function buildMoneyPayload({ locationCode, khrPerUsd, expressBps, now }) {
  const payload = {
    schema: MONEY_SCHEMA,
    currency_code: "KHR",
    currency_exponent: 0,
    money_rounding: "round_half_up_minor_unit",
    // Owner ruling 2026-09-19: whole kilograms, rounded UP, minimum 1 kg.
    weight_rule: { unit: "kg", increment: 1, rounding: "up", minimum: 1 },
    location_code: locationCode,
  };
  if (khrPerUsd !== null)
    payload.fx = { USD: { khr_per_usd: khrPerUsd, effective_from: now.toISOString() } };
  if (expressBps !== null) payload.express_surcharge_bps = expressBps;
  return payload;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(readFileSync(args.file, "utf8"));
  const catalog = parseCatalogFile(doc);
  const target = resolveDevTarget({ local: args.local });
  console.error(
    `Preflight\n  target: ${target.label}\n  file:   ${args.file}\n  store:  ${args.store}\n  location: ${args.location}`,
  );
  console.error(
    `  services ${catalog.services.length} · families ${catalog.families.length} · categories ${catalog.categories.length} · garment types ${catalog.garmentTypes.length}`,
  );
  console.error(
    `  KHR/USD: ${args.khrPerUsd === null ? "(none — no USD tender)" : String(args.khrPerUsd)} · express bps: ${args.expressBps === null ? "(none)" : String(args.expressBps)}`,
  );

  const pool = new pg.Pool({ ...target.connectionConfig, max: 1 });
  const client = await pool.connect();
  const summary = {
    items: 0,
    services: 0,
    pricesOpened: 0,
    pricesUnchanged: 0,
    vocab: 0,
    money: "unchanged",
  };
  try {
    await client.query("begin");
    const scope = await client.query(
      `select ds.tenant_id, sl.location_code
         from kitluy_core.digital_stores ds
         join kitluy_core.store_locations sl on sl.digital_store_id = ds.id
        where ds.id = $1::uuid and sl.id = $2::uuid`,
      [args.store, args.location],
    );
    const row = scope.rows[0];
    if (row === undefined) die("the Store / Location pair does not exist on this stack");
    const tenantId = row.tenant_id;
    const locationCode = row.location_code;
    const now = new Date();

    // 1. Vocabulary.
    for (const f of catalog.families) {
      await client.query(
        `insert into kitluy_laundry.service_families (tenant_id, digital_store_id, code, lane, name, name_km, sort_order, status)
         values ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
         on conflict (digital_store_id, code) do update
            set lane = excluded.lane, name = excluded.name, name_km = excluded.name_km,
                sort_order = excluded.sort_order, status = 'ACTIVE', updated_at = now(),
                version = kitluy_laundry.service_families.version + 1`,
        [tenantId, args.store, f.code, f.lane, f.name, f.name_km, f.sort_order],
      );
      summary.vocab += 1;
    }
    for (const c of catalog.categories) {
      await client.query(
        `insert into kitluy_laundry.catalog_categories (tenant_id, digital_store_id, code, name, name_km, sort_order, family_codes, status)
         values ($1, $2, $3, $4, $5, $6, $7::text[], 'ACTIVE')
         on conflict (digital_store_id, code) do update
            set name = excluded.name, name_km = excluded.name_km, sort_order = excluded.sort_order,
                family_codes = excluded.family_codes, status = 'ACTIVE', updated_at = now(),
                version = kitluy_laundry.catalog_categories.version + 1`,
        [tenantId, args.store, c.code, c.name, c.name_km, c.sort_order, c.families],
      );
      summary.vocab += 1;
    }
    for (const g of catalog.garmentTypes) {
      await client.query(
        `insert into kitluy_laundry.garment_types (tenant_id, digital_store_id, code, name, name_km, category_code, sort_order, family_codes, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8::text[], 'ACTIVE')
         on conflict (digital_store_id, code) do update
            set name = excluded.name, name_km = excluded.name_km, category_code = excluded.category_code,
                sort_order = excluded.sort_order, family_codes = excluded.family_codes, status = 'ACTIVE',
                updated_at = now(), version = kitluy_laundry.garment_types.version + 1`,
        [
          tenantId,
          args.store,
          g.code,
          g.name,
          g.name_km,
          g.category_code,
          g.sort_order,
          g.families,
        ],
      );
      summary.vocab += 1;
    }

    // 2. Services: catalog item root, translations, laundry extension, base-book price.
    for (const s of catalog.services) {
      const itemCode = `SRV-${s.service_code}`;
      const metadata = {
        display_name: s.display_name,
        garment_code: s.garment_code,
        category_code: s.category_code,
        icon_key: s.icon_key,
        sort_order: s.sort_order,
        family_code: s.family,
      };
      const item = await client.query(
        `insert into kitluy_core.catalog_items (tenant_id, digital_store_id, item_type, code, name, status, metadata)
         values ($1, $2, 'SERVICE', $3, $4, 'ACTIVE', $5::jsonb)
         on conflict (digital_store_id, code) do update
            set name = excluded.name, status = 'ACTIVE', metadata = excluded.metadata, updated_at = now(),
                version = kitluy_core.catalog_items.version + 1
         returning id`,
        [tenantId, args.store, itemCode, s.name, JSON.stringify(metadata)],
      );
      const itemId = item.rows[0].id;
      summary.items += 1;
      for (const [locale, name] of [
        ["en-US", s.name],
        ["km-KH", s.name_km],
      ]) {
        if (name === null) continue;
        await client.query(
          `insert into kitluy_core.catalog_item_translations (catalog_item_id, locale, name)
           values ($1, $2, $3)
           on conflict (catalog_item_id, locale) do update set name = excluded.name, updated_at = now()`,
          [itemId, locale, name],
        );
      }
      const service = await client.query(
        `insert into kitluy_laundry.services (tenant_id, digital_store_id, catalog_item_id, service_code, pricing_modes, production_profile, status)
         values ($1, $2, $3, $4, array[$5]::text[], $6, 'ACTIVE')
         on conflict (digital_store_id, service_code) do update
            set catalog_item_id = excluded.catalog_item_id, pricing_modes = excluded.pricing_modes,
                production_profile = excluded.production_profile, status = 'ACTIVE', updated_at = now(),
                version = kitluy_laundry.services.version + 1
         returning id`,
        [tenantId, args.store, itemId, s.service_code, s.pricing_mode, s.family],
      );
      const serviceId = service.rows[0].id;
      summary.services += 1;

      // The open Store-base KHR price row for this mode; unchanged → keep it.
      const open = await client.query(
        `select id, unit_price_minor, min_charge_minor, version
           from kitluy_laundry.service_prices
          where service_id = $1 and digital_store_id = $2 and store_location_id is null
            and currency_code = 'KHR' and pricing_mode = $3 and effective_to is null
          order by effective_from desc limit 1`,
        [serviceId, args.store, s.pricing_mode],
      );
      const current = open.rows[0];
      if (
        current !== undefined &&
        Number(current.unit_price_minor) === s.unit_price_khr &&
        (current.min_charge_minor === null ? null : Number(current.min_charge_minor)) ===
          s.min_charge_khr
      ) {
        summary.pricesUnchanged += 1;
        continue;
      }
      if (current !== undefined) {
        await client.query(
          `update kitluy_laundry.service_prices set effective_to = $2 where id = $1`,
          [current.id, now],
        );
      }
      await client.query(
        `insert into kitluy_laundry.service_prices
           (tenant_id, service_id, digital_store_id, store_location_id, currency_code, pricing_mode,
            unit_price_minor, min_charge_minor, effective_from, effective_to, version)
         values ($1, $2, $3, null, 'KHR', $4, $5, $6, $7, null, $8)`,
        [
          tenantId,
          serviceId,
          args.store,
          s.pricing_mode,
          s.unit_price_khr,
          s.min_charge_khr,
          now,
          current === undefined ? 1 : Number(current.version) + 1,
        ],
      );
      summary.pricesOpened += 1;
    }

    if (args.pauseOthers) {
      const paused = await client.query(
        `update kitluy_laundry.services
            set status = 'PAUSED', updated_at = now(), version = version + 1
          where digital_store_id = $1 and status = 'ACTIVE' and not (service_code = any($2::text[]))
          returning service_code`,
        [args.store, catalog.services.map((x) => x.service_code)],
      );
      summary.paused = paused.rows.map((r) => r.service_code);
    }

    // 3. The money contract: a PUBLISHED configuration version for the Location.
    const payload = buildMoneyPayload({
      locationCode,
      khrPerUsd: args.khrPerUsd,
      expressBps: args.expressBps,
      now,
    });
    const payloadHash = createHash("sha256").update(canonical(payload), "utf8").digest("hex");
    const latest = await client.query(
      `select id, version, payload_hash from kitluy_config.configuration_versions
        where config_key = $1 and scope_type = 'store_location' and store_location_id = $2::uuid and status = 'PUBLISHED'
        order by version desc limit 1`,
      [MONEY_CONFIG_KEY, args.location],
    );
    const same =
      latest.rows[0] !== undefined &&
      // fx.effective_from differs on every run; compare without it.
      canonical(stripFxTime(JSON.parse(JSON.stringify(payload)))) ===
        canonical(
          stripFxTime(
            (
              await client.query(
                `select payload from kitluy_config.configuration_versions where id = $1`,
                [latest.rows[0].id],
              )
            ).rows[0].payload,
          ),
        );
    if (!same) {
      const version = latest.rows[0] === undefined ? 1 : Number(latest.rows[0].version) + 1;
      const inserted = await client.query(
        `insert into kitluy_config.configuration_versions
           (config_key, scope_type, precedence, tenant_id, digital_store_id, store_location_id,
            version, schema_version, payload, payload_hash, status)
         values ($1, 'store_location', 3, $2, $3, $4, $5, $6, $7::jsonb, $8, 'PUBLISHED')
         returning id`,
        [
          MONEY_CONFIG_KEY,
          tenantId,
          args.store,
          args.location,
          version,
          MONEY_SCHEMA,
          JSON.stringify(payload),
          payloadHash,
        ],
      );
      await client.query(
        `insert into kitluy_config.configuration_publications (configuration_version_id, publication_kind, idempotency_key, status)
         values ($1, 'PUBLISH', $2, 'PUBLISHED')`,
        [
          inserted.rows[0].id,
          `${MONEY_CONFIG_KEY}:${args.location}:${String(version)}:${randomUUID()}`,
        ],
      );
      summary.money = `published v${String(version)}`;
    }

    if (args.dryRun) {
      await client.query("rollback");
      console.error("  DRY RUN — rolled back");
    } else {
      await client.query("commit");
    }
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
  console.log(JSON.stringify({ target: target.label, ...summary }, null, 2));
}

function stripFxTime(payload) {
  if (payload?.fx?.USD) delete payload.fx.USD.effective_from;
  return payload;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href
) {
  main().catch((error) => {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(2);
  });
}
