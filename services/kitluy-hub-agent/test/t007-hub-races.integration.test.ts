/**
 * WS-11-T007 — Hub-local concurrency race families
 * (KLD-2026-08-06-WS11-T007-001).
 *
 * Families executed HERE: restore activation vs Hub retirement (13, the
 * 0037 mode door) and installation promotion vs rollback trigger (16, the
 * 0039 matrix). Families 7/8/9 run in the pairing and terminal-health
 * suites; 11/12/14/15 and the cloud side run in t007-cloud-races.
 *
 * Method: separate pool connections (separate sessions), 20 controlled
 * iterations per family (§19 rule 7), governed outcomes only — every
 * refusal must carry a KLUY- sentinel, and the database must land in
 * exactly one legal terminal state with its append-only journal intact.
 *
 * Harness reset note (family 13): `retired_rejected` is TERMINAL through
 * the door BY DESIGN, so between iterations the suite resets the governed
 * singleton as the OWNING governor with its guard trigger disabled — a
 * test-harness reset of a dev database, performed as the owner, re-enabled
 * immediately, and left in mode `normal` at the end. No production door
 * behavior is bypassed inside any measured race arm.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { hubDatabaseUrl } from "../src/hub-database.js";

const RUN = randomUUID().slice(0, 8);

// RESOLVED, NOT HARDCODED. This read
// `postgresql://postgres:postgres@127.0.0.1:54322/kitluy_hub_local` literally,
// ignoring KITLUY_HUB_DB_URL that every other suite here honours — so it skipped
// on any machine whose Hub database is somewhere else, and on a workstation
// running several stacks, 54322 belongs to whichever one claimed it first.
// `hubDatabaseUrl` also carries the KL-INF-P1-037 local-only guard.
const DSN = hubDatabaseUrl();
const ITERATIONS = 20;

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end();
  }
}

const live = await reachable();
if (!live) console.warn("SKIPPED: T007 hub races — Hub local database unreachable");

type Settled = { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string };

describe.skipIf(!live)("T007 hub-local concurrency race families", () => {
  let pool: pg.Pool;

  async function asRole(
    role: string,
    sql: string,
    params: readonly unknown[],
  ): Promise<Record<string, unknown> | null> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      const { rows } = await client.query(sql, params as unknown[]);
      await client.query("commit");
      return (rows[0] ?? null) as Record<string, unknown> | null;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function settle(p: Promise<Record<string, unknown> | null>): Promise<Settled> {
    try {
      return { ok: true, value: await p };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  function assertGoverned(family: string, iteration: number, outcomes: readonly Settled[]): void {
    for (const o of outcomes) {
      if (!o.ok) {
        expect(
          o.error.includes("KLUY-"),
          `${family} iteration ${iteration}: ungoverned failure — ${o.error}`,
        ).toBe(true);
      }
    }
  }

  /** Owner-context harness reset of the governed replacement singleton. */
  async function resetReplacementMode(mode: string): Promise<void> {
    await pool.query(
      `do $$
       begin
         execute format('grant kitluy_replacement_governor to %I', current_user);
         set local role kitluy_replacement_governor;
         alter table edge_identity.hub_replacement_state disable trigger hub_replacement_state_governed;
         update edge_identity.hub_replacement_state set mode = '${mode}', replacement_operation_ref = case when '${mode}' = 'normal' then null else gen_random_uuid() end, updated_at = now() where singleton;
         alter table edge_identity.hub_replacement_state enable trigger hub_replacement_state_governed;
       end $$`,
    );
    await pool.query(
      `do $$ begin execute format('revoke kitluy_replacement_governor from %I', current_user); end $$`,
    );
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DSN, max: 8 });
    for (const role of ["kitluy_hub_runtime"]) {
      await pool.query(`do $$ begin execute format('grant ${role} to %I', current_user); end $$`);
    }
  }, 60_000);

  afterAll(async () => {
    // Leave the dev Hub in service and hand back the borrowed membership.
    await resetReplacementMode("normal").catch(() => undefined);
    await pool
      .query(
        `do $$ begin execute format('revoke kitluy_hub_runtime from %I', current_user); end $$`,
      )
      .catch(() => undefined);
    await pool.end();
  });

  it("F13: restore activation races retirement — retirement is total, a retired Hub never re-enters service", async () => {
    for (let i = 0; i < ITERATIONS; i += 1) {
      await resetReplacementMode("restored_quarantine");
      const change = (mode: string) =>
        asRole(
          "kitluy_hub_runtime",
          `select edge_identity.set_hub_replacement_mode_v1(
             $1, case when $1 = 'normal' then null else $4::uuid end,
             $2, 'T007-RACE', $3::uuid) as r`,
          [mode, `T007-${RUN} F13 iteration ${i}`, randomUUID(), randomUUID()],
        );
      const [activate, retire] = await Promise.all([
        settle(change("normal")),
        settle(change("retired_rejected")),
      ]);
      assertGoverned("F13", i, [activate, retire]);
      // Retirement must ALWAYS be standing at the end: either it won the
      // race outright (and activation was refused with the RETIRED
      // sentinel), or activation landed first and retirement still applied
      // over it. A final mode of 'normal' would be the dual-active hole.
      expect(retire.ok, `F13 iteration ${i}: retirement must always be recordable`).toBe(true);
      const { rows } = await pool.query<{ mode: string }>(
        `select mode::text as mode from edge_identity.hub_replacement_state where singleton`,
      );
      expect(String(rows[0]?.mode), `F13 iteration ${i}`).toBe("retired_rejected");
      if (!activate.ok) {
        expect(activate.error).toContain("KLUY-EDGE-REPLACEMENT-RETIRED");
      }
      // The journal recorded every committed change exactly once.
      const { rows: ev } = await pool.query<{ n: string }>(
        `select count(*)::text as n from edge_identity.hub_replacement_events
          where to_mode = 'retired_rejected' and reason = $1`,
        [`T007-${RUN} F13 iteration ${i}`],
      );
      expect(Number(ev[0]?.n), `F13 iteration ${i}: retirement journalled once`).toBe(1);
    }
  }, 120_000);

  it("F16: installation promotion races the rollback trigger — one legal terminal state, the loser refused by the matrix", async () => {
    let sawPromoteWin = 0;
    let sawRollbackWin = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      // Fixture: a cached release and an installation walked to
      // health_checking under the runtime role (the 0039 matrix enforces
      // every step).
      const cacheId = randomUUID();
      const instId = randomUUID();
      await asRole(
        "kitluy_hub_runtime",
        `with key as (
           insert into edge_config.release_trust_key
             (key_id, key_version, algorithm, public_key_pem, state, activated_at)
           values ('t007-race-key', 1, 'ed25519',
                   '-----BEGIN PUBLIC KEY-----t007-----END PUBLIC KEY-----', 'current', now())
           on conflict (key_id, key_version) do nothing
           returning 1)
         insert into edge_config.release_cache
           (id, tenant_id, digital_store_id, location_id, product_key, version,
            build_id, architecture, hardware_profile, environment, channel,
            artifact_digest_sha256, artifact_size_bytes, manifest_version,
            signing_key_id, signing_key_version, signature_b64,
            min_schema_version, max_schema_version, state, verified_at, cached_at)
         values
           ($1::uuid, 'e0000000-0000-4000-8000-000000000001',
            'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
            'kitluy-hub-agent', '5.' || $2::text || '.0', 'b-t007-' || $2::text, 'arm64',
            'pi5-hub', 'development', 'internal', repeat('e', 64), 100, 1,
            't007-race-key', 1, repeat('QQQQ', 22), 30, 45, 'cached', now(), now())`,
        [cacheId, i],
      );
      await asRole(
        "kitluy_hub_runtime",
        `insert into edge_config.release_installation
           (id, release_cache_id, device_kind, tenant_id, digital_store_id,
            location_id, candidate_version)
         values ($1::uuid, $2::uuid, 'store_hub',
                 'e0000000-0000-4000-8000-000000000001',
                 'e0000000-0000-4000-8000-000000000002',
                 'e0000000-0000-4000-8000-000000000003', '5.' || $3::text || '.0')`,
        [instId, cacheId, i],
      );
      for (const state of [
        "downloading",
        "verified",
        "staged",
        "installing_inactive_slot",
        "pending_restart",
        "health_checking",
      ]) {
        await asRole(
          "kitluy_hub_runtime",
          `update edge_config.release_installation set state = $2 where id = $1::uuid`,
          [instId, state],
        );
      }
      const move = (state: string) =>
        asRole(
          "kitluy_hub_runtime",
          `update edge_config.release_installation
              set state = $2, failure_reason = case when $2 = 'rolling_back' then 'T007 race' end
            where id = $1::uuid returning state`,
          [instId, state],
        );
      const [promote, rollback] = await Promise.all([
        settle(move("current")),
        settle(move("rolling_back")),
      ]);
      assertGoverned("F16", i, [promote, rollback]);
      const { rows } = await pool.query<{ state: string; rb: boolean }>(
        `select state::text as state, rollback_attempted as rb
           from edge_config.release_installation where id = $1::uuid`,
        [instId],
      );
      const finalState = String(rows[0]?.state);
      if (promote.ok && !rollback.ok) {
        expect(finalState, `F16 iteration ${i}`).toBe("current");
        expect(rollback.error).toContain("KLUY-EDGE-INSTALL-TRANSITION");
        sawPromoteWin += 1;
      } else if (!promote.ok && rollback.ok) {
        expect(finalState, `F16 iteration ${i}`).toBe("rolling_back");
        expect(rows[0]?.rb, `F16 iteration ${i}: the one-rollback pin`).toBe(true);
        expect(promote.error).toContain("KLUY-EDGE-INSTALL-TRANSITION");
        sawRollbackWin += 1;
        // Close the loser branch out legally so no live installation leaks.
        await asRole(
          "kitluy_hub_runtime",
          `update edge_config.release_installation set state = 'failed_rolled_back' where id = $1::uuid`,
          [instId],
        );
      } else {
        expect.fail(
          `F16 iteration ${i}: expected exactly one winner, got ${JSON.stringify([promote, rollback])}`,
        );
      }
      // The trigger-written journal carries the winner's transition once.
      const { rows: ev } = await pool.query<{ n: string }>(
        `select count(*)::text as n from edge_config.release_installation_event
          where installation_id = $1::uuid and to_state in ('current', 'rolling_back')`,
        [instId],
      );
      expect(Number(ev[0]?.n), `F16 iteration ${i}: exactly one terminal-side transition`).toBe(1);
    }
    // Both interleavings are legal; the run must show a governed outcome in
    // every iteration regardless of which side won.
    expect(sawPromoteWin + sawRollbackWin).toBe(ITERATIONS);
  }, 180_000);
});
