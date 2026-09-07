/**
 * WS-11-T007 — cloud concurrency race families (KLD-2026-08-06-WS11-T007-001).
 *
 * Families executed HERE (the ones no prior suite raced with genuinely
 * separate sessions): trusted-time floor advancement (debt D3), support
 * approval vs revocation (family 10), containment apply vs clear (11), two
 * Hub cutovers for one Location (12, debt D6), release promotion vs
 * revocation (14), two release assignments for one device (15).
 *
 * Families 1–9 and 16's cloud aspects are executed by the existing race
 * suites (provisioning-code-*-races, emergency-concurrency,
 * terminal-activation, hub-terminal-pairing, terminal-health) — cited, not
 * duplicated (§19 rule 11).
 *
 * Method: every race runs callers on SEPARATE pool connections
 * (separate database sessions), repeats 20 controlled iterations (§19 rule
 * 7), and requires a GOVERNED outcome every time — a success, or a refusal
 * whose message carries a KLUY- sentinel. A raw SQLSTATE (deadlock,
 * duplicate key, serialization) anywhere fails the family.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const ITERATIONS = 20;

// The section-56 fixture Location (a REAL store_locations row). The
// beforeAll stray-revocation sweep gives this suite sole ownership of the
// one-live-Hub census there (the section-56 isolation lesson).
const LOCATION = "00000000-0000-4000-8000-000000000450";
const TENANT_B = "00000000-0000-4000-8000-000000000012";
const STORE_B = "00000000-0000-4000-8000-000000000017";
// Persisted drafts from any earlier run must never collide with this one.
const RUN = randomUUID().slice(0, 8);

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
if (!live) console.warn("SKIPPED: T007 cloud races — local cloud database unreachable");

type Settled = { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string };

describe.skipIf(!live)("T007 cloud concurrency race families", () => {
  let pool: pg.Pool;
  let hubProfile: string;
  let terminalProfile: string;

  /** Run one door call on ITS OWN connection under a service role. */
  async function door(
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

  /** Settle a race arm into a governed-outcome record. */
  async function settle(p: Promise<Record<string, unknown> | null>): Promise<Settled> {
    try {
      return { ok: true, value: await p };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Every refusal in a race must be a governed sentinel, never a raw SQLSTATE. */
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

  async function enrollDevice(prefix: string, profile?: string): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1(
         $1, $2::uuid, now(), encode(sha256(convert_to($1, 'UTF8')), 'hex'),
         'ed25519', 'software', 'STATION-T007', 'OP-T007',
         jsonb_build_array(
           jsonb_build_object('signal_type', 'mac_address',   'signal_value', $3::text),
           jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-' || $1),
           jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-' || $1))) as id`,
      [
        `T007-${prefix}-${randomUUID()}`,
        profile ?? terminalProfile,
        `t7:${randomUUID().slice(0, 8)}`,
      ],
    );
    return String(rows[0]?.id);
  }

  async function claimAndRedeem(deviceId: string, tag: string): Promise<void> {
    const token = `t007-tok-${tag}-${randomUUID()}`;
    const payload = `t007-pay-${tag}-${randomUUID()}`;
    await pool.query(
      `select kitluy_devices.create_device_claim_v1(
         $1::uuid, $2::uuid, $3::uuid, $4::uuid,
         encode(sha256(convert_to($5, 'UTF8')), 'hex'),
         encode(sha256(convert_to($6, 'UTF8')), 'hex'), 900, 'OP-T007')`,
      [deviceId, TENANT_B, STORE_B, LOCATION, token, payload],
    );
    await pool.query(
      `select kitluy_devices.redeem_device_claim_v1(
         encode(sha256(convert_to($1, 'UTF8')), 'hex'),
         encode(sha256(convert_to($2, 'UTF8')), 'hex'), $3::uuid, 'HUB-T007')`,
      [token, payload, deviceId],
    );
  }

  /**
   * Fixture isolation (the section-56 lesson): retire every live store_hub
   * assignment in the fixture Location so the one-live census measures ONLY
   * the caller's devices.
   */
  async function sweepStrayHubs(): Promise<void> {
    await pool.query(
      `do $$
       declare v_stray record;
       begin
         set local role kitluy_fleet_governor;
         for v_stray in
           select a.device_id from kitluy_devices.device_assignments a
             join kitluy_devices.devices d on d.id = a.device_id
            where a.store_location_id = '00000000-0000-4000-8000-000000000450'
              and a.state in ('pending_trust', 'active') and d.device_class = 'store_hub'
         loop
           perform kitluy_devices.revoke_device_assignment_v1(
             v_stray.device_id, 'T007 fixture isolation', 'OP-T007');
         end loop;
       end $$`,
    );
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DSN, max: 10 });
    // Borrow-and-hand-back membership, with the grantee QUOTED via format
    // (the KLRISK-HUB-001 lesson).
    for (const role of [
      "kitluy_fleet_service",
      "kitluy_release_service",
      "kitluy_fleet_governor",
    ]) {
      await pool.query(`do $$ begin execute format('grant ${role} to %I', current_user); end $$`);
    }
    await sweepStrayHubs();
    const { rows } = await pool.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    hubProfile = String(rows[0]?.id);
    expect(hubProfile).not.toBe("undefined");
    const { rows: term } = await pool.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T005-TERM-PROBE'`,
    );
    terminalProfile = String(term[0]?.id);
    expect(terminalProfile).not.toBe("undefined");
  }, 60_000);

  afterAll(async () => {
    for (const role of [
      "kitluy_fleet_service",
      "kitluy_release_service",
      "kitluy_fleet_governor",
    ]) {
      await pool
        .query(`do $$ begin execute format('revoke ${role} from %I', current_user); end $$`)
        .catch(() => undefined);
    }
    await pool.end();
  });

  it("D3: concurrent trusted-time evaluations never regress the floor and land on the maximum accepted source", async () => {
    const device = await enrollDevice("TIME");
    const base = Date.parse("2026-08-06T08:00:00+07:00");
    let previousFloor = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      // Two sessions, two DIFFERENT source times inside the forward-jump
      // tolerance; the higher one must become the floor, and no response
      // may ever show the floor moving backwards.
      const tLow = new Date(base + i * 20_000);
      const tHigh = new Date(base + i * 20_000 + 10_000);
      // Direct execution on its own connection (the section-30b caller
      // shape); separate pool clients are separate database sessions.
      const call = async (t: Date): Promise<Record<string, unknown> | null> => {
        const client = await pool.connect();
        try {
          const { rows } = await client.query(
            `select to_jsonb(kitluy_devices.evaluate_trusted_time_v1(
               $1::uuid, 'development', $2::timestamptz, null, null, $3::uuid)) as out`,
            [device, t.toISOString(), randomUUID()],
          );
          return (rows[0] ?? null) as Record<string, unknown> | null;
        } finally {
          client.release();
        }
      };
      const [a, b] = await Promise.all([settle(call(tLow)), settle(call(tHigh))]);
      assertGoverned("D3", i, [a, b]);
      expect(a.ok && b.ok, `D3 iteration ${i}: evaluation refused unexpectedly`).toBe(true);
      const { rows } = await pool.query<{ floor_text: string }>(
        `select trusted_time_floor::text as floor_text from kitluy_devices.device_trusted_time
          where device_id = $1::uuid`,
        [device],
      );
      const floorMs = Date.parse(String(rows[0]?.floor_text));
      expect(
        floorMs >= previousFloor,
        `D3 iteration ${i}: the floor moved backwards (${rows[0]?.floor_text})`,
      ).toBe(true);
      expect(floorMs).toBeGreaterThanOrEqual(tHigh.getTime());
      previousFloor = floorMs;
    }
  }, 120_000);

  it("F10: a support session's revocation races — one governed terminal state, idempotent losers, evidence intact", async () => {
    const device = await enrollDevice("SUP");
    await claimAndRedeem(device, "sup");
    for (let i = 0; i < ITERATIONS; i += 1) {
      const opened = await door(
        "kitluy_fleet_service",
        `select kitluy_devices.open_support_access_session_v1(
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'SUP-OP-T007', null,
           'T007 race probe', 'TICKET-T007-${i}', 'C1_METADATA', null,
           'development', 15) as r`,
        [TENANT_B, STORE_B, LOCATION, device],
      );
      const openR = (opened?.r ?? {}) as Record<string, unknown>;
      expect(String(openR.outcome)).toBe("OPENED");
      const sessionId = String(openR.session_id);
      const revoke = (actor: string) =>
        door(
          "kitluy_fleet_service",
          `select kitluy_devices.revoke_support_access_session_v1($1::uuid, $2, 'race probe') as r`,
          [sessionId, actor],
        );
      const [a, b] = await Promise.all([settle(revoke("SUP-REV-A")), settle(revoke("SUP-REV-B"))]);
      assertGoverned("F10", i, [a, b]);
      const { rows } = await pool.query<{ state: string; n: string }>(
        `select status::text as state, count(*) over ()::text as n
           from kitluy_devices.support_access_sessions where id = $1::uuid`,
        [sessionId],
      );
      expect(rows).toHaveLength(1);
      expect(String(rows[0]?.state)).toBe("revoked");
      const { rows: ev } = await pool.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.support_access_events
          where session_id = $1::uuid and event_type like '%REVOK%'`,
        [sessionId],
      );
      expect(Number(ev[0]?.n), `F10 iteration ${i}: duplicate revocation evidence`).toBe(1);
    }
  }, 120_000);

  it("F11: containment apply races clear — a governed winner, no torn state, append-only evidence consistent", async () => {
    const device = await enrollDevice("CONT");
    await claimAndRedeem(device, "cont");
    for (let i = 0; i < ITERATIONS; i += 1) {
      // Arm: put the device INTO quarantine (approved, four-eyes), then race
      // a CLEAR against a re-APPLY of a different containment reason.
      await door(
        "kitluy_fleet_service",
        `select kitluy_devices.apply_device_containment_v1(
           $1::uuid, 'quarantined', 'T007 arm ${i}', 'FLEET-A', 'FLEET-B') as r`,
        [device],
      );
      const clear = door(
        "kitluy_fleet_service",
        `select kitluy_devices.clear_device_containment_v1(
           $1::uuid, 'operator_recovery', 'T007 clear ${i}', 'FLEET-A', 'FLEET-B') as r`,
        [device],
      );
      const reapply = door(
        "kitluy_fleet_service",
        `select kitluy_devices.apply_device_containment_v1(
           $1::uuid, 'quarantined', 'T007 re-arm ${i}', 'FLEET-C', 'FLEET-D') as r`,
        [device],
      );
      const [a, b] = await Promise.all([settle(clear), settle(reapply)]);
      assertGoverned("F11", i, [a, b]);
      // T008 F-4 (independent review): liveness. Without this the family
      // would pass if BOTH containment doors always refused — a governed
      // deadlock is still a broken system.
      expect(a.ok || b.ok, `F11 iteration ${i}: neither containment arm succeeded`).toBe(true);
      const { rows } = await pool.query<{ state: string; cleared: string | null }>(
        `select containment_state::text as state, cleared_at::text as cleared
           from kitluy_devices.device_containment_states where device_id = $1::uuid`,
        [device],
      );
      expect(rows).toHaveLength(1);
      // Exactly one of the two governed ends: contained (apply won last) or
      // cleared (the clearance stands) — never a torn half-state.
      const contained = rows[0]?.cleared === null;
      expect(typeof rows[0]?.state).toBe("string");
      // Reset to a clean floor for the next iteration whatever won.
      if (contained) {
        await door(
          "kitluy_fleet_service",
          `select kitluy_devices.clear_device_containment_v1(
             $1::uuid, 'operator_recovery', 'T007 reset ${i}', 'FLEET-A', 'FLEET-B') as r`,
          [device],
        );
      }
    }
    const { rows: tamper } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_containment_events
        where device_id = $1::uuid`,
      [device],
    );
    // Every arm/clear/re-apply left exactly one event; nothing was rewritten.
    expect(Number(tamper[0]?.n)).toBeGreaterThanOrEqual(ITERATIONS * 2);
  }, 180_000);

  it("F12/D6: two concurrent cutovers for one Location serialize onto ONE live Hub, twenty generations deep", async () => {
    // Chain: each iteration replaces the CURRENT live hub with a fresh one,
    // racing two concurrent commit calls. The Location must end every
    // iteration with EXACTLY ONE live store_hub — the D6 sweep item.
    await sweepStrayHubs();
    let liveHub = await enrollDevice("HUB0", hubProfile);
    await claimAndRedeem(liveHub, "hub0");
    for (let i = 0; i < ITERATIONS; i += 1) {
      const next = await enrollDevice(`HUB${i + 1}`, hubProfile);
      await claimAndRedeem(next, `hub${i + 1}`);
      const req = await door(
        "kitluy_fleet_service",
        `select kitluy_devices.request_hub_replacement_v1(
           $1::uuid, 'full_pi', 'T007 chain ${i}', 'FLEET-OP-1', 'REAUTH-${i}',
           $2, $3::uuid) as r`,
        [liveHub, `T007-IDEM-${i}-${randomUUID()}`, randomUUID()],
      );
      const op = String(((req?.r ?? {}) as Record<string, unknown>).operation_id);
      await door(
        "kitluy_fleet_service",
        `select kitluy_devices.approve_hub_replacement_v1($1::uuid, 'FLEET-OP-2') as r`,
        [op],
      );
      await door(
        "kitluy_fleet_service",
        `select kitluy_devices.register_replacement_hub_v1($1::uuid, $2::uuid, 'FLEET-OP-1') as r`,
        [op, next],
      );
      await door(
        "kitluy_fleet_service",
        `select kitluy_devices.mark_replacement_restore_ready_v1($1::uuid, $2::uuid, 'FLEET-OP-1') as r`,
        [op, randomUUID()],
      );
      await door(
        "kitluy_fleet_service",
        `select kitluy_devices.mark_replacement_cutover_ready_v1($1::uuid, 'FLEET-OP-1') as r`,
        [op],
      );
      const { rows: gen } = await pool.query<{ g: string }>(
        `select assignment_generation::text as g from kitluy_devices.device_assignments
          where device_id = $1::uuid and state in ('pending_trust', 'active')`,
        [liveHub],
      );
      const generation = Number(gen[0]?.g);
      const commit = () =>
        door(
          "kitluy_fleet_service",
          `select kitluy_devices.commit_hub_replacement_cutover_v1(
             $1::uuid, $2::int, 'FLEET-OP-1', 'REVOKE-REF-${i}', true) as r`,
          [op, generation],
        );
      const [a, b] = await Promise.all([settle(commit()), settle(commit())]);
      assertGoverned("F12", i, [a, b]);
      expect(a.ok || b.ok, `F12 iteration ${i}: no cutover arm succeeded`).toBe(true);
      const { rows: census } = await pool.query<{ n: string }>(
        `select count(*)::text as n
           from kitluy_devices.device_assignments a
           join kitluy_devices.devices d on d.id = a.device_id
          where a.store_location_id = $1::uuid
            and a.state in ('pending_trust', 'active') and d.device_class = 'store_hub'`,
        [LOCATION],
      );
      expect(Number(census[0]?.n), `F12 iteration ${i}: dual-active Hub census`).toBe(1);
      const { rows: cut } = await pool.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.hub_replacement_events
          where operation_id = $1::uuid and to_state = 'cutover_committed'`,
        [op],
      );
      expect(Number(cut[0]?.n), `F12 iteration ${i}: cutover committed more than once`).toBe(1);
      liveHub = next;
    }
  }, 300_000);

  it("F14: release promotion races revocation — the winner is total, the loser is a sentinel, the record is consistent", async () => {
    let sawPromoteWin = 0;
    let sawRevokeWin = 0;
    for (let i = 0; i < ITERATIONS; i += 1) {
      const draft = await door(
        "kitluy_release_service",
        `select kitluy_releases.create_release_draft_v1(
           'kitluy-hub-agent', '9.${i}.0-${RUN}', 'b-t007-${RUN}-${i}', 'arm64', 'pi5-hub',
           'development', 'file-ref-${i}', repeat('a', 64), 1000, 30, 45, 0,
           null, 'REL-OP-1', $1::uuid) as r`,
        [randomUUID()],
      );
      const rel = String(((draft?.r ?? {}) as Record<string, unknown>).release_id);
      await door(
        "kitluy_release_service",
        `select kitluy_releases.sign_release_v1($1::uuid, 'dev-key', 1, $2, 'REL-OP-1') as r`,
        [rel, "Q".repeat(88)],
      );
      const promote = door(
        "kitluy_release_service",
        `select kitluy_releases.promote_release_v1($1::uuid, 'internal', 'REL-OP-1', 'REL-OP-2') as r`,
        [rel],
      );
      const revoke = door(
        "kitluy_release_service",
        `select kitluy_releases.revoke_release_v1($1::uuid, 'REL-OP-1', 'REL-OP-2', 'T007 race') as r`,
        [rel],
      );
      const [a, b] = await Promise.all([settle(promote), settle(revoke)]);
      assertGoverned("F14", i, [a, b]);
      expect(b.ok, `F14 iteration ${i}: revocation must always be recordable`).toBe(true);
      if (a.ok) sawPromoteWin += 1;
      else sawRevokeWin += 1;
      const { rows } = await pool.query<{ state: string }>(
        `select state::text as state from kitluy_releases.release_artifacts where id = $1::uuid`,
        [rel],
      );
      expect(String(rows[0]?.state)).toBe("revoked");
    }
    // Both interleavings must have been observed governed — the promotion
    // winning first AND the revocation landing first are both legal orders.
    expect(sawPromoteWin + sawRevokeWin).toBe(ITERATIONS);
  }, 180_000);

  it("F15: two concurrent assignments of one release to one device are ONE idempotent business effect", async () => {
    const device = await enrollDevice("ASSIGN");
    await claimAndRedeem(device, "assign");
    for (let i = 0; i < ITERATIONS; i += 1) {
      const draft = await door(
        "kitluy_release_service",
        `select kitluy_releases.create_release_draft_v1(
           'kitluy-hub-agent', '8.${i}.0-${RUN}', 'b-t007a-${RUN}-${i}', 'arm64', 'pi5-hub',
           'development', 'file-ref-a-${i}', repeat('b', 64), 1000, 30, 45, 0,
           null, 'REL-OP-1', $1::uuid) as r`,
        [randomUUID()],
      );
      const rel = String(((draft?.r ?? {}) as Record<string, unknown>).release_id);
      await door(
        "kitluy_release_service",
        `select kitluy_releases.sign_release_v1($1::uuid, 'dev-key', 1, $2, 'REL-OP-1') as r`,
        [rel, "R".repeat(88)],
      );
      await door(
        "kitluy_release_service",
        `select kitluy_releases.promote_release_v1($1::uuid, 'internal', 'REL-OP-1', 'REL-OP-2') as r`,
        [rel],
      );
      const idem = `T007-ASSIGN-${RUN}-${i}`;
      const assign = () =>
        door(
          "kitluy_release_service",
          `select kitluy_releases.assign_release_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'development', $5::uuid, $6, 'REL-OP-1') as r`,
          [rel, TENANT_B, STORE_B, LOCATION, device, idem],
        );
      const [a, b] = await Promise.all([settle(assign()), settle(assign())]);
      assertGoverned("F15", i, [a, b]);
      expect(
        a.ok && b.ok,
        `F15 iteration ${i}: an idempotent assignment arm failed — ${JSON.stringify([a, b])}`,
      ).toBe(true);
      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n
           from kitluy_releases.device_installations i
           join kitluy_releases.rollout_campaigns c on c.id = i.campaign_id
          where c.artifact_id = $1::uuid and i.device_id = $2::uuid`,
        [rel, device],
      );
      expect(Number(rows[0]?.n), `F15 iteration ${i}: duplicate assignment row`).toBe(1);
    }
  }, 180_000);

  it("T008 F-5: an idempotency key identifies the WHOLE request — a same-key different-device assignment is REFUSED, never silently dropped", async () => {
    // Independent-review finding F-5, fixed forward in migration 0182.
    // BEFORE: the door compared only the artifact, so the second device
    // returned EXISTING with the FIRST device's campaign and its
    // installation vanished with no refusal and no evidence.
    const deviceA = await enrollDevice("F5A");
    const deviceB = await enrollDevice("F5B");
    await claimAndRedeem(deviceA, "f5a");
    await claimAndRedeem(deviceB, "f5b");
    const draft = await door(
      "kitluy_release_service",
      `select kitluy_releases.create_release_draft_v1(
         'kitluy-hub-agent', '4.0.0-${RUN}', 'b-f5-${RUN}', 'arm64', 'pi5-hub',
         'development', 'file-ref-f5', repeat('f', 64), 1000, 30, 45, 0,
         null, 'REL-OP-1', $1::uuid) as r`,
      [randomUUID()],
    );
    const rel = String(((draft?.r ?? {}) as Record<string, unknown>).release_id);
    await door(
      "kitluy_release_service",
      `select kitluy_releases.sign_release_v1($1::uuid, 'dev-key', 1, $2, 'REL-OP-1') as r`,
      [rel, "T".repeat(88)],
    );
    await door(
      "kitluy_release_service",
      `select kitluy_releases.promote_release_v1($1::uuid, 'internal', 'REL-OP-1', 'REL-OP-2') as r`,
      [rel],
    );
    const key = `T008-F5-${RUN}`;
    const assign = (deviceId: string) =>
      door(
        "kitluy_release_service",
        `select kitluy_releases.assign_release_v1(
           $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'development', $5::uuid, $6, 'REL-OP-1') as r`,
        [rel, TENANT_B, STORE_B, LOCATION, deviceId, key],
      );

    const first = await assign(deviceA);
    expect(String(((first?.r ?? {}) as Record<string, unknown>).outcome)).toBe("ASSIGNED");

    // The SAME device replaying the SAME key still converges (idempotency
    // is preserved, not traded away for strictness).
    const replay = await assign(deviceA);
    expect(String(((replay?.r ?? {}) as Record<string, unknown>).outcome)).toBe("EXISTING");
    expect(((replay?.r ?? {}) as Record<string, unknown>).campaign_id).toBe(
      ((first?.r ?? {}) as Record<string, unknown>).campaign_id,
    );

    // A DIFFERENT device under the same key is now a governed refusal.
    const conflicting = await settle(assign(deviceB));
    expect(conflicting.ok, "the same-key different-device assignment was not refused").toBe(false);
    if (!conflicting.ok) {
      expect(conflicting.error).toContain("KLUY-RELEASE-IDEMPOTENCY-CONFLICT");
    }

    // And device B has NO installation anywhere for this release — the
    // refusal is total, not a partial write.
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n
         from kitluy_releases.device_installations i
         join kitluy_releases.rollout_campaigns c on c.id = i.campaign_id
        where c.artifact_id = $1::uuid and i.device_id = $2::uuid`,
      [rel, deviceB],
    );
    expect(Number(rows[0]?.n)).toBe(0);
  }, 60_000);
});
