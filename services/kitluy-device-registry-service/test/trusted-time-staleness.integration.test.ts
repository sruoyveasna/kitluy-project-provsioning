/**
 * Trusted time after an absence, and the R-1 boundary — against the canonical
 * PG17 development database.
 *
 * ===========================================================================
 * TWO PROPERTIES, AND THEY PULL IN OPPOSITE DIRECTIONS
 * ===========================================================================
 * 1. A Store Hub that was legitimately away — closed overnight, boxed for a
 *    week, off for an afternoon — must be able to re-establish trusted time.
 *    Under the shipped rule it could not: `trusted_time_max_forward_jump_seconds`
 *    is 3600 and the floor only advances on a `trusted` evaluation, so a floor
 *    older than an hour was PERMANENTLY unrecoverable.
 * 2. A device's own clock is still the thing an attacker controls, so a
 *    low-assurance source that jumps forward must still be refused.
 *
 * Group 0200 separates them by SOURCE. `cloud_authoritative` is `now()` read
 * inside the database, which no caller can choose, so a large gap there measures
 * absence. Everything else keeps the strict rule.
 *
 * ===========================================================================
 * HOW A STALE FLOOR IS BUILT HERE — NO BACKDOOR
 * ===========================================================================
 * Not one timestamp in `device_trusted_time` is written by this file. A stale
 * floor is created the way a real device creates one: a FRESH device's first
 * observation lands wherever that observation is, because there is no floor to
 * compare against yet (§12 first-boot rule). Offering `now() - 14 days` to a
 * brand new device is a legitimate governed establishment, and it leaves exactly
 * the state a Hub has after two weeks in a box.
 *
 * Writing the floor with an UPDATE would prove only that UPDATE works, and the
 * floor is the exact thing an attacker wants to move.
 *
 * Every device here is fresh (`randomUUID`), and that is FORCED rather than
 * lazy: trusted-time state can never be deleted — the database refuses it with
 * `KLUY-DEVICE-TIME-IMMUTABLE` — so a reused fixture keeps the floor it earned
 * and a stale floor can never be rebuilt on it. A suite about stale floors needs
 * devices that have none.
 *
 * The fleet does not grow anyway: every device this file creates is RETIRED in
 * `afterAll`, which is a terminal lifecycle state the certificate door already
 * refuses (`KLUY-DEVCERT-CONTAINED`). Fixtures are parked, not left claimable.
 *
 * The intentionally corrupted R-1 fixture is not touched, not repaired and not
 * read: it has a different asset tag and nothing here selects by anything else.
 */
import { randomUUID, createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const DSN =
  process.env.KITLUY_HUB_PAIRING_DSN ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

const ENVIRONMENT = "development";
const HUB_PROFILE = "WS11-T001-HUB-PROBE";
/** Every fixture this file mints carries this prefix, so afterAll can park them. */
const FIXTURE_PREFIX = "TT-STALE-";

let pool: pg.Pool;

/** The group 0200 shape must be present, or these assertions mean nothing. */
async function ready(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 3000 });
  try {
    const { rows } = await probe.query<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices'
          and p.proname = 'evaluate_trusted_time_core_v1'
          and pg_get_function_identity_arguments(p.oid) like '%boolean%'`,
    );
    return (rows[0]?.n ?? 0) === 1;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}
const reachable = await ready();

interface Outcome {
  status: string;
  trusted_time: string | null;
  source: string;
  floor_advanced: boolean;
  anomaly_type: string | null;
  restricted: boolean;
}

/** A brand new enrolled Store Hub. Never reused between tests. */
async function freshDevice(): Promise<string> {
  const tag = `${FIXTURE_PREFIX}${randomUUID()}`;
  const { rows } = await pool.query<{ id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text, (select id from kitluy_devices.hardware_profiles where profile_key = $2::text),
       now(), $3::text, 'ed25519', 'software', 'STATION-TT', 'OP-TT',
       jsonb_build_array(
         jsonb_build_object('signal_type', 'mac_address',    'signal_value', $4::text),
         jsonb_build_object('signal_type', 'board_serial',   'signal_value', 'board-' || $1::text),
         jsonb_build_object('signal_type', 'storage_serial', 'signal_value', 'nvme-' || $1::text))) as id`,
    [
      tag,
      HUB_PROFILE,
      createHash("sha256").update(tag).digest("hex"),
      `fa:${randomUUID().slice(0, 14).replace(/-/g, ":")}`,
    ],
  );
  return rows[0]!.id;
}

/** Offer a low-assurance source, exactly as a device would. */
async function offerNetworkTime(device: string, expression: string): Promise<Outcome> {
  const { rows } = await pool.query<Outcome>(
    `select status, trusted_time, source, floor_advanced, anomaly_type, restricted
       from kitluy_devices.evaluate_trusted_time_v1(
              $1::uuid, $2::text, null, ${expression}, null, gen_random_uuid())`,
    [device, ENVIRONMENT],
  );
  return rows[0]!;
}

/** Offer a low-assurance RTC reading. */
async function offerRtc(device: string, expression: string): Promise<Outcome> {
  const { rows } = await pool.query<Outcome>(
    `select status, trusted_time, source, floor_advanced, anomaly_type, restricted
       from kitluy_devices.evaluate_trusted_time_v1(
              $1::uuid, $2::text, ${expression}, null, null, gen_random_uuid())`,
    [device, ENVIRONMENT],
  );
  return rows[0]!;
}

/**
 * Re-establish through the GOVERNED BRIDGE, as the activation composition —
 * the only path the product actually uses, and the one R-1 repaired.
 */
async function establishAsActivationService(device: string): Promise<Outcome> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role kitluy_activation_service");
    const { rows } = await c.query<Outcome>(
      `select status, trusted_time, source, floor_advanced, anomaly_type, restricted
         from kitluy_devices.establish_device_trusted_time_v1($1::uuid, $2::text, gen_random_uuid())`,
      [device, ENVIRONMENT],
    );
    await c.query("commit");
    return rows[0]!;
  } finally {
    c.release();
  }
}

async function floorOf(device: string): Promise<Date | null> {
  const { rows } = await pool.query<{ f: string | null }>(
    `select trusted_time_floor as f from kitluy_devices.device_trusted_time where device_id = $1::uuid`,
    [device],
  );
  const v = rows[0]?.f;
  return v === undefined || v === null ? null : new Date(v);
}

/**
 * A fresh device whose floor sits `age` behind now.
 *
 * ===========================================================================
 * WHY THIS IS NOW AN OWNER-SIDE INSERT, AND WHY THAT IS NOT A BACKDOOR
 * ===========================================================================
 * It used to offer `now() - age` to a device with no floor, which the §12
 * first-boot rule accepted: the first observation became the floor. Owner
 * Decision 2 closed exactly that — a NULL floor may now be initialized ONLY by
 * `cloud_authoritative`, because the first floor is the one every later
 * comparison is measured against, and a caller that could choose it could brick
 * the device permanently. That primitive is the R-1 outcome and seventeen
 * development devices were already in that state.
 *
 * The consequence for this file is that NO CALLER can construct a past floor any
 * more — which is the point. A test that needs one must therefore do something a
 * caller cannot: INSERT the row as the TABLE OWNER. The monotonic trigger is
 * `before delete or update`, so an initial insert is not a floor regression, and
 * nothing here ever lowers an existing floor.
 *
 * This is fixture construction, not a governed path, and the distinction is the
 * whole security property: the tests below assert that no CALLER — not
 * `service_role`, not the composition identity, not the device — can do this.
 * The harness runs as the owner of the table, which is outside that threat model
 * and is also how every other suite in this repository seeds state.
 */
async function deviceWithStaleFloor(age: string): Promise<string> {
  const device = await freshDevice();
  await pool.query(
    `insert into kitluy_devices.device_trusted_time
       (device_id, trusted_time_floor, last_selected_trusted_time, last_source, status, policy_version)
     values ($1::uuid, now() - $2::interval, now() - $2::interval, 'cloud_authoritative', 'trusted', 1)`,
    [device, age],
  );
  const seeded = await floorOf(device);
  expect(seeded).not.toBeNull();
  return device;
}

/** A fresh device whose floor sits in the FUTURE — the shape R-1 produced. */
async function deviceWithFutureFloor(age: string): Promise<string> {
  const device = await freshDevice();
  await pool.query(
    `insert into kitluy_devices.device_trusted_time
       (device_id, trusted_time_floor, last_selected_trusted_time, last_source, status, policy_version)
     values ($1::uuid, now() + $2::interval, now() + $2::interval, 'cloud_authoritative', 'trusted', 1)`,
    [device, age],
  );
  return device;
}

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DSN, max: 6 });
});
afterAll(async () => {
  // Park this run's fixtures in a terminal state so the active fleet does not
  // grow one Hub per test per run. `retired` is reached by a normal UPDATE for
  // the same reason `hub-pairing.integration.test.ts` walks its slots back:
  // there is no governed "un-create", and a fixture left claimable is a fixture
  // the next suite trips over.
  await pool
    ?.query(
      // `retired_at` is not optional: devices_retired_consistency_chk requires
      // the state and its timestamp to agree, so a state without one is not a
      // retirement.
      `update kitluy_devices.devices
          set lifecycle_state = 'retired', retired_at = now()
        where asset_tag like $1 and lifecycle_state <> 'retired'`,
      [`${FIXTURE_PREFIX}%`],
    )
    .catch(() => undefined);
  await pool?.end().catch(() => undefined);
});

describe.skipIf(!reachable)("a Hub that was away can come back", () => {
  beforeAll(async () => {
    await pool.query(
      `insert into kitluy_devices.hardware_profiles
         (profile_key, display_name, device_class, manufacturer, model_identifier,
          required_signal_types, certification_status)
       values ($1, 'trusted-time staleness fixture', 'store_hub', 'ASSERTION-FIXTURE', 'PROBE-TT',
               array['mac_address','board_serial','storage_serial']::kitluy_devices.hardware_signal_type[],
               'CERTIFIED')
       on conflict (profile_key) do nothing`,
      [HUB_PROFILE],
    );
  });

  // The owner-specified absence ladder. 30 minutes is inside the 3600s policy
  // window and passed even before group 0200; every row after it did not.
  for (const age of ["30 minutes", "2 hours", "8 hours", "24 hours", "14 days"]) {
    it(`re-establishes after ${age} away`, async () => {
      const device = await deviceWithStaleFloor(age);
      const before = await floorOf(device);

      const outcome = await establishAsActivationService(device);

      expect(outcome.status).toBe("trusted");
      expect(outcome.restricted).toBe(false);
      expect(outcome.source).toBe("cloud_authoritative");
      expect(outcome.floor_advanced).toBe(true);

      const after = await floorOf(device);
      expect(after!.getTime()).toBeGreaterThan(before!.getTime());
      // The floor landed on the authority's own clock, not on anything offered.
      expect(Math.abs(after!.getTime() - Date.now())).toBeLessThan(120_000);
    });
  }

  it("activation stops refusing for untrusted time once the Hub is back", async () => {
    const device = await deviceWithStaleFloor("14 days");
    await expect(
      pool.query(`select kitluy_devices.assert_trusted_time_v1($1::uuid, 'activation')`, [device]),
    ).resolves.toBeDefined();

    // Push it into restriction with a low-assurance forward jump, then recover.
    const jumped = await offerRtc(device, `now() + interval '3 days'`);
    expect(jumped.status).toBe("restricted_forward_jump");
    await expect(
      pool.query(`select kitluy_devices.assert_trusted_time_v1($1::uuid, 'activation')`, [device]),
    ).rejects.toThrow(/KLUY-DEVICE-TIME-(UNTRUSTED|RESTRICTED)/);

    const recovered = await establishAsActivationService(device);
    expect(recovered.status).toBe("trusted");
    await expect(
      pool.query(`select kitluy_devices.assert_trusted_time_v1($1::uuid, 'activation')`, [device]),
    ).resolves.toBeDefined();
  });
});

describe.skipIf(!reachable)("the strict rules that must NOT have been relaxed", () => {
  it("a low-assurance source jumping forward is still refused", async () => {
    const device = await deviceWithStaleFloor("14 days");
    // The SAME 14-day gap the authority is allowed to close. Offered by the
    // device, it is refused — that is the entire point of the source split.
    const outcome = await offerNetworkTime(device, `now()`);
    expect(outcome.status).toBe("restricted_forward_jump");
    expect(outcome.restricted).toBe(true);
    expect(outcome.floor_advanced).toBe(false);
    expect(outcome.anomaly_type).toMatch(/ahead of the trusted floor/);
  });

  it("an RTC far ahead is still refused", async () => {
    const device = await freshDevice();
    await establishAsActivationService(device);
    const outcome = await offerRtc(device, `now() + interval '3650 days'`);
    expect(outcome.status).toBe("restricted_forward_jump");
    expect(outcome.floor_advanced).toBe(false);
  });

  it("a candidate behind the floor is rollback, and the floor does not move", async () => {
    const device = await freshDevice();
    await establishAsActivationService(device);
    const before = await floorOf(device);

    const outcome = await offerRtc(device, `now() - interval '1 hour'`);
    expect(outcome.status).toBe("restricted_clock_rollback");
    expect(outcome.floor_advanced).toBe(false);

    const after = await floorOf(device);
    expect(after!.getTime()).toBe(before!.getTime());
  });

  it("the authoritative source is held to the rollback rule too", async () => {
    // A floor in the FUTURE — the shape R-1 produced. `now()` is behind it, so
    // the authority refuses itself. No reset path exists, and none is added.
    //
    // Constructed owner-side now: since Decision 2 a caller cannot produce this
    // state at all, which is why the seventeen bricked development devices are
    // the last of their kind.
    const device = await deviceWithFutureFloor("30 days");
    const before = await floorOf(device);

    const outcome = await establishAsActivationService(device);
    expect(outcome.status).toBe("restricted_clock_rollback");
    expect(outcome.floor_advanced).toBe(false);
    expect((await floorOf(device))!.getTime()).toBe(before!.getTime());
  });

  it("offering nothing is still not a source", async () => {
    const device = await freshDevice();
    const { rows } = await pool.query<Outcome>(
      `select status, restricted, source
         from kitluy_devices.evaluate_trusted_time_v1($1::uuid, $2::text, null, null, null, gen_random_uuid())`,
      [device, ENVIRONMENT],
    );
    expect(rows[0]!.status).toBe("restricted_no_trusted_source");
    expect(rows[0]!.restricted).toBe(true);
  });
});

describe.skipIf(!reachable)("R-1: the caller cannot name the time", () => {
  it("the bridge accepts no timestamp in any overload", async () => {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices'
          and p.proname = 'establish_device_trusted_time_v1'
          and 'pg_catalog.timestamptz'::regtype = any (p.proargtypes::oid[])`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("the exploited signature no longer exists", async () => {
    // The external review's call: three timestamps, one of them now() + 3650d.
    await expect(
      pool.query(
        `select kitluy_devices.establish_device_trusted_time_v1(
                  gen_random_uuid(), 'development',
                  null, now() + interval '3650 days', null, gen_random_uuid())`,
      ),
    ).rejects.toThrow(/does not exist/i);
  });

  it("exactly one bridge exists, taking exactly three non-time arguments", async () => {
    const { rows } = await pool.query<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices' and p.proname = 'establish_device_trusted_time_v1'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.args).toBe("p_device_id uuid, p_environment text, p_correlation_id uuid");
  });

  /**
   * R-1 ONE FUNCTION DEEPER, ASSERTED THROUGH THE PRIVILEGE MATRIX.
   *
   * The natural test is to CALL the evaluation as `service_role` and expect
   * `42501 permission denied`. It cannot run here: this PG17 development
   * container segfaults on a class of permission-denied function calls, taking
   * the whole database into recovery. It is not caused by anything in this
   * change — `assert_device_not_contained_v1` and
   * `assert_support_session_active_v1` reproduce it untouched, and the
   * container's first such crash is dated 2026-08-07 — but a suite that
   * deliberately triggers it would restart the database mid-run and fail
   * everything after it.
   *
   * `has_function_privilege` is the same question asked of the same catalog, and
   * it answers without executing anything. When the instance is repaired the
   * call-based form should be restored; the finding is recorded in the handoff.
   *
   * Before group 0200 revoked it, calling this AS service_role SUCCEEDED and
   * left the victim device's floor in 2036 — the R-1 damage exactly.
   */
  it("service_role — the role the service connects as — cannot supply trusted time", async () => {
    const { rows } = await pool.query<{ wrapper: boolean; core: boolean }>(
      `select has_function_privilege('service_role',
                'kitluy_devices.evaluate_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)',
                'execute') as wrapper,
              has_function_privilege('service_role',
                'kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)',
                'execute') as core`,
    );
    expect(rows[0]!.wrapper).toBe(false);
    expect(rows[0]!.core).toBe(false);
  });

  it("service_role is not a member of the role that still holds the evaluation", async () => {
    // Otherwise the revoke above would be shadowed by an inherited grant and
    // would prove nothing.
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n
         from pg_auth_members m
         join pg_roles member on member.oid = m.member
         join pg_roles granted on granted.oid = m.roleid
        where member.rolname = 'service_role'
          and granted.rolname = 'kitluy_activation_governor'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("no database object except the bridge can reach the evaluation core", async () => {
    const { rows } = await pool.query<{ proname: string }>(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices'
          and p.prosrc like '%evaluate_trusted_time_core_v1%'
          and p.proname <> 'evaluate_trusted_time_core_v1'
        order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      "establish_device_trusted_time_v1",
      "evaluate_trusted_time_v1",
    ]);
  });

  it("the activation composition cannot reach the evaluation directly", async () => {
    // Otherwise it could offer the sources the bridge refuses to carry, and R-1
    // would be reachable one function deeper.
    const { rows } = await pool.query<{ e: boolean }>(
      `select has_function_privilege(
                'kitluy_activation_service',
                'kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)',
                'execute') as e`,
    );
    expect(rows[0]!.e).toBe(false);
  });

  it("browser-reachable roles can do neither", async () => {
    for (const role of ["anon", "authenticated"]) {
      const { rows } = await pool.query<{ b: boolean; e: boolean }>(
        `select has_function_privilege($1, 'kitluy_devices.establish_device_trusted_time_v1(uuid, text, uuid)', 'execute') as b,
                has_function_privilege($1, 'kitluy_devices.evaluate_trusted_time_core_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid, boolean)', 'execute') as e`,
        [role],
      );
      expect(rows[0]!.b).toBe(false);
      expect(rows[0]!.e).toBe(false);
    }
  });
});

describe.skipIf(!reachable)("Decision 2: only the authority may set the FIRST floor", () => {
  /**
   * The first floor is permanent in a way no later one is — every subsequent
   * comparison is measured against it. Before Decision 2 a NULL floor accepted
   * ANY offered timestamp, which is R-1's outcome on the path the device-side
   * gateway is written to call, and seventeen development devices were already
   * in that state.
   */
  for (const [label, args] of [
    ["a caller RTC", "now(),null,null,gen_random_uuid(),false"],
    ["authenticated network time", "null,now(),null,gen_random_uuid(),false"],
    ["a signed cloud token", "null,null,now(),gen_random_uuid(),false"],
    ["an RTC ten years ahead", "now()+interval '3650 days',null,null,gen_random_uuid(),false"],
  ] as const) {
    it(`refuses to initialize the floor from ${label}`, async () => {
      const device = await freshDevice();
      const { rows } = await pool.query<{ s: string; fa: boolean }>(
        `select status::text as s, floor_advanced as fa
           from kitluy_devices.evaluate_trusted_time_core_v1($1::uuid, $2::text, ${args})`,
        [device, ENVIRONMENT],
      );
      expect(rows[0]!.s).not.toBe("trusted");
      expect(rows[0]!.fa).toBe(false);
      // The floor must still be absent — a refused initialization that left a
      // value behind would be the defect wearing a different status.
      expect(await floorOf(device)).toBeNull();
    });
  }

  it("a refused initialization records no SELECTION it did not make", async () => {
    // Found by the re-review. A refusal used to write the refused candidate into
    // `last_selected_trusted_time` / `last_source`, so a device that had just
    // REFUSED a 2036 timestamp carried it in the columns an operator reads first
    // during an incident. Inert — only the floor feeds a comparison — but a
    // record of a selection that never happened.
    const device = await freshDevice();
    await pool.query(
      `select 1 from kitluy_devices.evaluate_trusted_time_core_v1(
                $1::uuid, $2::text, now() + interval '3650 days', null, null, gen_random_uuid(), false)`,
      [device, ENVIRONMENT],
    );
    const { rows } = await pool.query<{
      floor: string | null;
      selected: string | null;
      src: string;
      offered: string | null;
      st: string;
    }>(
      `select trusted_time_floor as floor, last_selected_trusted_time as selected,
              last_source::text as src, last_validated_rtc_time as offered, status::text as st
         from kitluy_devices.device_trusted_time where device_id = $1::uuid`,
      [device],
    );
    expect(rows[0]!.st).toBe("restricted_no_trusted_source");
    expect(rows[0]!.floor).toBeNull();
    // Nothing was chosen, so nothing is recorded as chosen.
    expect(rows[0]!.selected).toBeNull();
    expect(rows[0]!.src).toBe("none");
    // But what was OFFERED is still on the record — that is the forensic trail.
    expect(rows[0]!.offered).not.toBeNull();
  });

  it("every function in the trusted-time chain pins its search_path", async () => {
    // The core needed pinning only because a later edit gave it a clock to read.
    // "Not currently exploitable" is a property of today's bodies.
    const { rows } = await pool.query<{ proname: string }>(
      `select p.proname
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices'
          and p.proname in ('evaluate_trusted_time_core_v1','evaluate_trusted_time_v1',
                            'establish_device_trusted_time_v1','resolve_trust_policy_v1',
                            'emergency_time_correction_v1','evaluate_time_correction_approval_v1')
          and (p.proconfig is null
               or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
        order by p.proname`,
    );
    expect(rows.map((r) => r.proname)).toEqual([]);
  });

  it("initializes from cloud_authoritative, on the authority's own clock", async () => {
    const device = await freshDevice();
    const { rows } = await pool.query<{ s: string; src: string; fa: boolean }>(
      `select status::text as s, source::text as src, floor_advanced as fa
         from kitluy_devices.evaluate_trusted_time_core_v1($1::uuid, $2::text, null, null, null, gen_random_uuid(), true)`,
      [device, ENVIRONMENT],
    );
    expect(rows[0]!.s).toBe("trusted");
    expect(rows[0]!.src).toBe("cloud_authoritative");
    expect(rows[0]!.fa).toBe(true);
    expect(Math.abs((await floorOf(device))!.getTime() - Date.now())).toBeLessThan(120_000);
  });

  it("a signed token is refused even though it is a 'cloud' source", async () => {
    // Deliberate: this database does not verify the token's signature — the
    // CALLER asserts it — so it is not authoritative enough to fix a device's
    // clock permanently. When the boundary can verify it, that is a governed
    // change to one branch.
    const device = await freshDevice();
    const { rows } = await pool.query<{ s: string }>(
      `select status::text as s
         from kitluy_devices.evaluate_trusted_time_core_v1($1::uuid, $2::text, null, null, now(), gen_random_uuid(), false)`,
      [device, ENVIRONMENT],
    );
    expect(rows[0]!.s).toBe("restricted_no_trusted_source");
  });
});

describe.skipIf(!reachable)("Decision 1: service_role holds no trust-critical mutation", () => {
  const TRUST_RELATIONS = [
    "kitluy_devices.device_trusted_time",
    "kitluy_devices.device_trusted_time_events",
    "kitluy_devices.trust_policy",
    "kitluy_devices.pki_trust_configuration",
    "kitluy_devices.time_correction_approvals",
    "kitluy_auth.approval_policies",
    "kitluy_auth.approval_requests",
    "kitluy_auth.approval_decisions",
    "kitluy_audit.sensitive_action_approvals",
  ];

  it("holds SELECT and nothing else on every trust-critical relation", async () => {
    // Asserted as the EXACT privilege set, because the hole this closes was
    // invisible to a function-level check: the first version of group 0200
    // revoked EXECUTE and left the tables underneath writable, so
    // `update device_trusted_time set trusted_time_floor = now() + 3650 days`
    // succeeded with no function call at all.
    for (const relation of TRUST_RELATIONS) {
      const { rows } = await pool.query<{ privs: string }>(
        `select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(none)') as privs
           from information_schema.role_table_grants
          where grantee = 'service_role'
            and table_schema = split_part($1, '.', 1)
            and table_name = split_part($1, '.', 2)`,
        [relation],
      );
      expect(rows[0]!.privs, relation).toBe("SELECT");
    }
  });

  it("cannot write the floor, proven by attempting it", async () => {
    const device = await deviceWithStaleFloor("2 hours");
    const before = await floorOf(device);
    const c = await pool.connect();
    let outcome = "SUCCEEDED";
    try {
      await c.query("begin");
      await c.query("set local role service_role");
      await c.query(
        `update kitluy_devices.device_trusted_time
            set trusted_time_floor = now() + interval '3650 days', status = 'trusted'
          where device_id = $1::uuid`,
        [device],
      );
      await c.query("rollback");
    } catch (error) {
      await c.query("rollback").catch(() => undefined);
      outcome = error instanceof Error ? error.message : "unknown";
    } finally {
      c.release();
    }
    expect(outcome).not.toBe("SUCCEEDED");
    expect(outcome).toMatch(/permission denied/i);
    expect((await floorOf(device))!.getTime()).toBe(before!.getTime());
  });

  it("cannot drive the emergency correction door it can no longer satisfy", async () => {
    // Asserted from the catalog rather than by calling it: on this instance a
    // permission-denied function call SIGSEGVs the backend and takes the
    // database into recovery — a pre-existing fault dated 2026-08-07 that
    // reproduces on functions this change never touched.
    const { rows } = await pool.query<{ correction: boolean; evaluator: boolean }>(
      `select has_function_privilege('service_role',
                'kitluy_devices.emergency_time_correction_v1(uuid, timestamptz, text, text, uuid, text, uuid, uuid, text)',
                'execute') as correction,
              has_function_privilege('service_role',
                'kitluy_devices.evaluate_time_correction_approval_v1(uuid, uuid, text, uuid)',
                'execute') as evaluator`,
    );
    expect(rows[0]!.correction).toBe(false);
    expect(rows[0]!.evaluator).toBe(false);
  });

  it("keeps the governed writer working — the bridge writes as the table owner", async () => {
    // A revoke that also broke the legitimate path would be a fail-closed
    // outage, not a fix.
    const device = await deviceWithStaleFloor("14 days");
    const outcome = await establishAsActivationService(device);
    expect(outcome.status).toBe("trusted");
    expect(outcome.source).toBe("cloud_authoritative");
  });
});
