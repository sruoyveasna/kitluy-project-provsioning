/**
 * Open reconciliation items, residual risks and the CONFIRMED boundaries.
 *
 * These assertions exist so a later refactor cannot quietly drop an item once a
 * workaround exists. They also PIN the strict behaviour the owner directed must
 * not be weakened: the seed is untouched and the canonical production guard
 * still refuses the disputed edge.
 *
 * Mostly pure; the two DB-backed cases skip visibly when the Hub database is
 * unreachable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canProductionTransition,
  markReady,
  ProductionTransitionError,
} from "@kitluy-verticals/phase1-laundry";
import {
  HUB_CONFIRMED_BOUNDARIES,
  HUB_DB_ASSERTION_CONTRACT,
  HUB_OPEN_RECONCILIATION_ITEMS,
  HUB_RESIDUAL_RISKS,
  OPEN_ITEM_BOOKING_STATUS_VS_PRODUCTION_CHAIN,
  RESIDUAL_RISK_GRANT_CURRENT_USER_CRASH,
} from "../src/hub/open-items.js";
import { productionStateForStatus } from "../src/hub/booking-status.js";
import { WS09_DELIVERY_STATE, WS09_WIRE_SYNC_STATE } from "../src/hub/repositories/sync.js";
import { WS09_WRITABLE_SYNC_STATES } from "../src/hub/idempotency.js";
import { FORBIDDEN_HUB_SCHEMAS } from "../src/hub/commands/finance-events.js";
import { countRows, hubReachable, pool } from "./hub-fixtures.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SEED_FILE = join(REPO_ROOT, "hub", "seed", "dev-fixtures.sql");
const available = await hubReachable();

describe("open reconciliation items stay OPEN and legible", () => {
  it("records every open item with sources, current behaviour and the ruling owed", () => {
    expect(HUB_OPEN_RECONCILIATION_ITEMS.length).toBeGreaterThanOrEqual(4);
    for (const item of HUB_OPEN_RECONCILIATION_ITEMS) {
      expect(item.status).toBe("OPEN — awaiting owner ruling");
      expect(item.id).toMatch(/^KLREQ-\d+$/);
      expect(item.conflict.length).toBeGreaterThan(40);
      expect(item.sources.length).toBeGreaterThan(0);
      expect(item.currentBehaviour.length).toBeGreaterThan(40);
      expect(item.rulingRequired.length).toBeGreaterThan(20);
      expect(item.doNot.length).toBeGreaterThan(0);
    }
    // No duplicate ids — each item is one decision.
    const ids = HUB_OPEN_RECONCILIATION_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("states the Booking-status ambiguity as the two competing readings, unresolved", () => {
    const item = OPEN_ITEM_BOOKING_STATUS_VS_PRODUCTION_CHAIN;
    expect(item.id).toBe("KLREQ-024");
    expect(item.status).toBe("OPEN — awaiting owner ruling");
    // The ruling the owner owes must name the derived-summary reading explicitly.
    expect(item.rulingRequired).toMatch(/derived summary/i);
    expect(item.rulingRequired).toMatch(/production[- ]state projection/i);
    expect(item.doNot.join(" ")).toMatch(/Do NOT modify hub\/seed\/dev-fixtures\.sql/);
    expect(item.doNot.join(" ")).toMatch(/Do NOT relax/);
  });
});

describe("the disputed edge is still refused — the strict check is NOT weakened", () => {
  it("keeps the canonical production chain forward-only (RECEIVED -> READY is refused)", () => {
    // If this ever becomes true, the guard was relaxed — which the owner forbade.
    expect(canProductionTransition("RECEIVED", "READY")).toBe(false);
    expect(() =>
      markReady("RECEIVED", {
        profile: "laundry.t3.ready_scan_in",
        qaPassed: true,
        countVerified: true,
        storageAssigned: true,
      }),
    ).toThrow(ProductionTransitionError);
  });

  it("still maps the seed's own status values onto the strict production states", () => {
    expect(productionStateForStatus("intake_confirmed")).toBe("RECEIVED");
    expect(productionStateForStatus("ready")).toBe("READY");
  });

  it("leaves the shipped seed UNMODIFIED — the disputed status_event is still there", () => {
    const seed = readFileSync(SEED_FILE, "utf8");
    // The seed still contains the disputed direct edge. Its presence is the
    // evidence for KLREQ-024; "fixing" the seed would have destroyed it.
    expect(seed).toContain("'intake_confirmed', 'ready'");
  });
});

describe("residual risks survive their own workarounds", () => {
  it("keeps the GRANT ... TO current_user server crash on the record", () => {
    const risk = RESIDUAL_RISK_GRANT_CURRENT_USER_CRASH;
    expect(risk.id).toBe("KLRISK-HUB-001");
    expect(risk.hazard).toMatch(/current_user/);
    expect(risk.hazard).toMatch(/SIGSEGV|signal 11|[Ss]egmentation/);
    expect(risk.observedImpact).toMatch(/signal 11|[Ss]egmentation/);
    // The record must say the crash is NOT fixed, only avoided here.
    expect(risk.residual).toMatch(/NOT fixed|only avoided/i);
    expect(risk.workaround.length).toBeGreaterThan(20);
  });

  it("records every residual risk with a hazard, an impact, a workaround and what remains", () => {
    expect(HUB_RESIDUAL_RISKS.length).toBeGreaterThanOrEqual(3);
    for (const risk of HUB_RESIDUAL_RISKS) {
      expect(risk.id).toMatch(/^KLRISK-HUB-\d+$/);
      expect(risk.hazard.length).toBeGreaterThan(30);
      expect(risk.observedImpact.length).toBeGreaterThan(20);
      expect(risk.workaround.length).toBeGreaterThan(20);
      expect(risk.residual.length).toBeGreaterThan(20);
      expect(["low", "medium", "high"]).toContain(risk.severity);
    }
  });

  it("uses the explicit-grantee form in the fixtures, never TO current_user", () => {
    const fixtures = readFileSync(join(import.meta.dirname, "hub-fixtures.ts"), "utf8");
    // Only EXECUTABLE SQL matters: a template literal that actually runs a
    // grant. The uppercase prose in the hazard comment must stay exactly as it
    // is — that comment is the record, not the defect.
    expect(fixtures).not.toMatch(/`grant[^`]*to current_user/);
    expect(fixtures).toMatch(/to "\$\{grantee\}"/);
    // ...and the hazard IS still documented at the call site.
    expect(fixtures).toMatch(/segfault/i);
  });
});

describe("confirmed boundaries — finance and sync", () => {
  it("keeps the finance boundary: source events only, no Hub-side ledger", () => {
    expect(HUB_CONFIRMED_BOUNDARIES.finance).toMatch(/NO edge_finance schema/);
    expect(HUB_CONFIRMED_BOUNDARIES.finance).toMatch(/KLD-FIN-002/);
    expect(HUB_CONFIRMED_BOUNDARIES.forbiddenSchemas).toContain("edge_finance");
    expect([...FORBIDDEN_HUB_SCHEMAS].sort()).toEqual(
      [...HUB_CONFIRMED_BOUNDARIES.forbiddenSchemas].sort(),
    );
  });

  it("keeps the sync boundary: WS-09 writes only 'pending' and reports only 'pending_cloud_sync'", () => {
    expect(WS09_DELIVERY_STATE).toBe(HUB_CONFIRMED_BOUNDARIES.ws09DeliveryState);
    expect(WS09_WIRE_SYNC_STATE).toBe(HUB_CONFIRMED_BOUNDARIES.ws09WireSyncState);
    // WS-10's vocabulary must never appear in what WS-09 may persist.
    expect(WS09_WRITABLE_SYNC_STATES).not.toContain("cloud_acknowledged");
    expect(WS09_WRITABLE_SYNC_STATES).not.toContain("cloud_rejected");
    expect(HUB_CONFIRMED_BOUNDARIES.sync).toMatch(/WS-10 owns transmission/);
  });

  it.skipIf(!available)("has no forbidden schema in the live Hub database", async () => {
    const p = pool(1);
    try {
      for (const schema of HUB_CONFIRMED_BOUNDARIES.forbiddenSchemas) {
        expect(
          await countRows(
            p,
            `select count(*)::text as count from pg_namespace where nspname = $1`,
            [schema],
          ),
          `${schema} must not exist`,
        ).toBe(0);
      }
    } finally {
      await p.end().catch(() => undefined);
    }
  });

  it.skipIf(!available)("has no non-pending outbox row that WS-09 could have written", async () => {
    const p = pool(1);
    try {
      // SCOPE OF THIS CHECK (narrowed in Cycle 9). WS-10 now legitimately writes
      // in_flight / retry_wait / acknowledged / rejected / dead_letter, so a
      // database-wide "everything is pending" assertion is no longer a true
      // statement about the system and would only be testing that WS-10 has not
      // run yet.
      //
      // The invariant that still holds and still matters: rows produced by the
      // WS-09 COMMAND-LAYER suites — which all run in assignment_generation 1 —
      // are only ever written as 'pending'. WS-10's own suites reserve their own
      // generations (see hub-fixtures reserveSyncGenerationBlock), so anything
      // non-pending in generation 1 outside the shipped WS-10-shaped fixtures
      // would mean WS-09 wrote a delivery state it does not own.
      const rows = await p.query<{ event_id: string; delivery_state: string }>(
        `select o.event_id, o.delivery_state from edge_sync.outbox o
           where o.delivery_state <> 'pending'
             and o.assignment_generation = 1
             and o.event_id not in (
               'e0000000-0000-4000-8000-0000000000d1',
               'e0000000-0000-4000-8000-0000000000d3')`,
      );
      expect(rows.rows).toEqual([]);
    } finally {
      await p.end().catch(() => undefined);
    }
  });
});

describe("hub:db:test assertion-count contract", () => {
  it("pins 40 NOTICE PASS lines and the correct counting command", () => {
    expect(HUB_DB_ASSERTION_CONTRACT.expectedPassNotices).toBe(40);
    expect(HUB_DB_ASSERTION_CONTRACT.countCommand).toContain('grep -c "NOTICE:  PASS"');
    expect(HUB_DB_ASSERTION_CONTRACT.wrongCountCommand).toMatch(/38/);
  });

  it("matches the number of PASS notices the assertions file actually emits", () => {
    const assertions = readFileSync(join(REPO_ROOT, "hub", "tests", "assertions.sql"), "utf8");
    const emitted = (assertions.match(/raise notice 'PASS/g) ?? []).length;
    expect(emitted).toBe(HUB_DB_ASSERTION_CONTRACT.expectedPassNotices);
  });
});
