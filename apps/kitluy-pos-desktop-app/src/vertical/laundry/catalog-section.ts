/**
 * The Laundry catalog and money contract AS DELIVERED to a terminal —
 * T1-REAL-OPERATIONS-001.
 *
 * Slice 2 moved the parsers into the Laundry vertical so the Store Hub prices
 * from the SAME closed shape the face renders (one parser, two ends of the
 * LAN). This module keeps the face's import path and re-exports them.
 */
export {
  LAUNDRY_CATALOG_SCHEMA,
  LAUNDRY_MONEY_SCHEMA,
  billableKilograms,
  parseLaundryCatalogSection,
  parseLaundryMoneySection,
  type CatalogLane,
  type DeliveredCategory,
  type DeliveredFamily,
  type DeliveredGarmentType,
  type DeliveredService,
  type LaundryCatalogSection,
  type LaundryMoneySection,
  type PricingMode,
  type WeightRule,
} from "@kitluy-verticals/phase1-laundry";
