/**
 * Store Hub pairing-code PRESENTATION, against the canonical database.
 *
 * ===========================================================================
 * WHY THIS SUITE EXISTS
 * ===========================================================================
 * Migration group 0191 gives the Hub claim path the protections the pairing
 * protocol §6.1 requires and `device_claims` did not have: an eight-character
 * Crockford Base32 format, a fifteen-minute ceiling, a five-attempt budget and
 * a security event on lockout.
 *
 * Every one of those is a REFUSAL, and a refusal that is never exercised is
 * indistinguishable from a refusal that does not work. Each behaviour here was
 * proven by hand once against the live stack; this suite is what stops them
 * regressing the next time the function is edited.
 *
 * ===========================================================================
 * WHAT IT DELIBERATELY DOES NOT PROVE
 * ===========================================================================
 * Redemption. `evaluate_hub_claim_code_v1` consumes nothing on purpose:
 * `redeem_device_claim_v1` owns single-use and re-checks everything under its
 * own lock. A presentation suite that also redeemed would be asserting that the
 * two functions agree about who owns consumption — the exact confusion 0191's
 * header refuses to introduce.
 *
 * ===========================================================================
 * HOW IT REFUSES TO PASS DISHONESTLY
 * ===========================================================================
 * Three ways a database suite can lie, and all three are refused here.
 *
 * It can run without a database: the suite SKIPS when 0191's door is absent,
 * rather than passing with nothing exercised.
 *
 * It can assert nothing because its fixtures ran out: every test MINTS its own
 * Store Hub, so there is no shared pool to exhaust (see `mintHub`).
 *
 * It can pass once and skip for ever afterwards — the subtlest of the three,
 * because a skipped suite still reads as green in a summary. That is what the
 * first version of this file did, and minting is what fixes it.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * The PG17 stack, which is the one carrying 0191.
 *
 * Note for whoever points this elsewhere: no local stack can replay the full
 * migration chain today. Group `0189` segfaults the backend on
 * `GRANT <role> TO CURRENT_USER` — recorded, and still OPEN, as
 * KLREC-2026-08-11-EDGE-006. So a stack is "current enough" for this suite when
 * 0191's door EXISTS, not when its migration ledger is complete; gating on the
 * ledger would skip this suite for ever on every developer's machine.
 */
const DB_URL =
  process.env.KITLUY_HUB_CLAIM_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

const clients: Client[] = [];
async function connect(): Promise<Client> {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  clients.push(c);
  return c;
}
afterAll(async () => {
  await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
});

/**
 * Mint a FRESH enrolled Store Hub, through the canonical enrollment door.
 *
 * ===========================================================================
 * WHY THESE SUITES CANNOT DRAW FROM A SHARED POOL
 * ===========================================================================
 * The first version of this file resolved an existing free Hub from the
 * development fixtures. It passed once, and then skipped for ever — which is
 * worse than failing, because a skipped suite still reads as green.
 *
 * A Hub leaves the "free" set PERMANENTLY once a suite touches it:
 *
 *   * a claim this suite LOCKS stays `issued` for all time (there is no unlock,
 *     by design — you issue a new code instead), so the device can never be
 *     claimed again;
 *   * a Hub that PAIRS gains a live assignment, and `create_device_claim_v1`
 *     refuses a device that holds one (`KLUY-DEVICE-ALREADY-CLAIMED`).
 *
 * So every run consumed fixtures it could never return. Minting is the fix: each
 * test gets a device that exists only for it, and the suite is repeatable.
 *
 * Hardware signals are RANDOMISED per device, not seeded. Two devices sharing
 * evidence is a security event — `KLUY-DEVICE-EVIDENCE-COLLISION` quarantines
 * them — so reusing a manifest would make the second test quarantine the first
 * test's Hub.
 */
const HUB_PROFILE_KEY = "WS11-T001-HUB-PROBE";

/** Only 0191's door needs to exist; devices are created on demand below. */
async function doorExists(): Promise<boolean> {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 4000 });
  try {
    await c.connect();
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices' and p.proname = 'evaluate_hub_claim_code_v1'`,
    );
    await c.end();
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    try {
      await c.end();
    } catch {
      /* never connected */
    }
    return false;
  }
}

const ready = await doorExists();

/**
 * A REUSED fixture Hub for one test slot, released before use.
 *
 * ===========================================================================
 * WHY NOT MINT A FRESH ONE EVERY RUN
 * ===========================================================================
 * The previous version did exactly that, and it was the right fix for the bug it
 * solved: drawing from a shared pool made this suite pass once and then SKIP for
 * ever, because a locked claim stays `issued` for good and a paired Hub keeps a
 * live assignment. A skipped suite still reads as green, which is worse than a
 * failing one.
 *
 * But minting per test traded that for unbounded growth. Every run created
 * eleven devices, and after a fortnight of runs this suite alone accounted for
 * 110 of the 490 devices in the development fleet — enough to make the Admin
 * fleet screen useless for seeing a real device.
 *
 * So: a FIXED device per slot, resolved by asset tag, and RELEASED before each
 * use. The suite stays repeatable and the fleet stops growing.
 *
 * `enroll_device_v1` is not idempotent — a second call with the same asset tag
 * fails on `devices_asset_tag_key` — so the device is looked up first and only
 * enrolled when genuinely absent.
 */
const FIXTURE_PREFIX = "PRES-FIXTURE";

/**
 * Close whatever a previous run left behind, so the device is claimable again.
 *
 * Both updates close a row rather than deleting one: `device_claims` and
 * `device_assignments` are append-only by design, and every foreign key into
 * `devices` is NO ACTION, so nothing here may be removed. Closing is the only
 * honest reset, and it leaves the audit trail intact.
 *
 * `revoked_at` is set alongside the state because the schema insists on it
 * (`device_assignments_revoked_cons`), and a state without its timestamp is not
 * a revocation.
 */
async function releaseHub(db: Client, deviceId: string): Promise<void> {
  await db.query(
    `update kitluy_devices.device_claims
        set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state = 'issued'`,
    [deviceId],
  );
  await db.query(
    `update kitluy_devices.device_assignments
        set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state in ('pending_trust', 'active')`,
    [deviceId],
  );
}

let slot = 0;

async function mintHub(db: Client): Promise<string> {
  slot += 1;
  const assetTag = `${FIXTURE_PREFIX}-${String(slot).padStart(2, "0")}`;

  const { rows: found } = await db.query<{ id: string }>(
    `select id from kitluy_devices.devices where asset_tag = $1`,
    [assetTag],
  );
  const existing = found[0]?.id;
  if (existing !== undefined) {
    await releaseHub(db, existing);
    return existing;
  }

  // First run on this database. Hardware signals are derived from the asset tag
  // so they are stable across runs AND unique per slot: two devices sharing
  // evidence is a security event (`KLUY-DEVICE-EVIDENCE-COLLISION`) that would
  // quarantine the previous slot's Hub.
  const h = createHash("sha256").update(assetTag).digest("hex");
  const signals = [
    { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
    { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
    { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
  ];
  const { rows } = await db.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2 and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-PRESENTATION-SUITE',
       'HET-MFG/presentation-suite', $4::jsonb, null) as device_id`,
    [assetTag, HUB_PROFILE_KEY, h, JSON.stringify(signals)],
  );
  const id = rows[0]?.device_id;
  if (id === undefined) throw new Error("enroll_device_v1 returned no device id");
  return id;
}

/**
 * A fresh, VALID eight-character code.
 *
 * `device_claims.claim_token_sha256` is globally UNIQUE, so a fixed literal can
 * be issued exactly once in the lifetime of a database — a suite built on one
 * would pass on a clean stack and fail for ever after. Drawn from the canonical
 * Crockford alphabet so the code under test is well-formed by construction.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function freshCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CROCKFORD[b % CROCKFORD.length]).join("");
}

interface Outcome {
  outcome: string;
  refusal_code?: string;
  failed_attempt_count?: number;
  attempts_remaining?: number;
  state?: string;
  claim_id?: string;
}

async function present(db: Client, deviceId: string, code: string): Promise<Outcome> {
  const { rows } = await db.query<{ r: Outcome }>(
    "select kitluy_devices.evaluate_hub_claim_code_v1($1::uuid, $2, $3) as r",
    [deviceId, code, "device/presentation-suite"],
  );
  return rows[0]!.r;
}

/**
 * Issues through the canonical door, never by INSERT — a hand-inserted claim
 * would prove only that INSERT works. Scope is borrowed from an existing claim
 * so the suite creates no Tenant/Store/Location rows of its own.
 */
async function issueClaim(
  db: Client,
  deviceId: string,
  code: string,
  ttlSeconds: number,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select kitluy_devices.create_device_claim_v1(
              $1::uuid, s.tenant_id, s.digital_store_id, s.store_location_id,
              $2, $3, $4::integer, 'operator/presentation-suite') as id
       from (select tenant_id, digital_store_id, store_location_id
               from kitluy_devices.device_claims
              order by created_at desc limit 1) s`,
    [deviceId, sha256(code), sha256(randomUUID()), ttlSeconds],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("create_device_claim_v1 returned no claim");
  return id;
}

describe.skipIf(!ready)("the code FORMAT is enforced, and folding is not repair", () => {
  it("folds lowercase to a match — an operator typing in lowercase is not wrong", async () => {
    const db = await connect();
    const device = await mintHub(db);
    const code = freshCode();
    await issueClaim(db, device, code, 900);

    const r = await present(db, device, code.toLowerCase());

    expect(r.outcome).toBe("MATCH_READY");
    expect(r.claim_id).toBeTruthy();
  });

  it("refuses a code carrying characters Crockford excludes, and spends an attempt", async () => {
    const db = await connect();
    const device = await mintHub(db);
    await issueClaim(db, device, freshCode(), 900);

    // I and O are excluded precisely so they cannot be confused with 1 and 0.
    const r = await present(db, device, "IOIO1234");

    expect(r.outcome).toBe("PRESENTATION_REFUSED");
    expect(r.refusal_code).toBe("KLUY-HUBCLAIM-INVALID");
    expect(r.failed_attempt_count).toBe(1);
  });

  it("refuses a code of the wrong LENGTH", async () => {
    const db = await connect();
    const device = await mintHub(db);
    await issueClaim(db, device, freshCode(), 900);

    const short = await present(db, device, "ABCD829");
    expect(short.refusal_code).toBe("KLUY-HUBCLAIM-INVALID");

    // The display hyphen in KLSRC-0162's `ABCD-8291` is presentation only.
    // Nothing is trimmed or stripped: a caller that renders one must remove it.
    const hyphenated = await present(db, device, "ABCD-8291");
    expect(hyphenated.refusal_code).toBe("KLUY-HUBCLAIM-INVALID");
  });

  it("tells a guesser nothing about WHY it was wrong", async () => {
    const db = await connect();
    const device = await mintHub(db);
    await issueClaim(db, device, freshCode(), 900);

    const malformed = await present(db, device, "IOIO1234");
    const mismatch = await present(db, device, "ZZZZ1111");

    // A caller that could tell MALFORMED from MISMATCH would learn whether its
    // alphabet is right. That distinction lives in the audit trail instead.
    expect(malformed.refusal_code).toBe(mismatch.refusal_code);
    expect(malformed.outcome).toBe(mismatch.outcome);
  });
});

describe.skipIf(!ready)("the five-attempt budget", () => {
  it("locks on the fifth failure and then refuses even the CORRECT code", async () => {
    const db = await connect();
    const device = await mintHub(db);
    const code = freshCode();
    await issueClaim(db, device, code, 900);

    const remaining: (number | undefined)[] = [];
    for (const wrong of ["ZZZZ1111", "ZZZZ2222", "ZZZZ3333", "ZZZZ4444"]) {
      remaining.push((await present(db, device, wrong)).attempts_remaining);
    }
    expect(remaining).toEqual([4, 3, 2, 1]);

    const fifth = await present(db, device, "ZZZZ5555");
    expect(fifth.refusal_code).toBe("KLUY-HUBCLAIM-LOCKED");

    // The point of a lockout: the right code stops working too. Otherwise the
    // budget only inconveniences someone who already knows the code.
    const correct = await present(db, device, code);
    expect(correct.outcome).toBe("PRESENTATION_REFUSED");
    expect(correct.refusal_code).toBe("KLUY-HUBCLAIM-LOCKED");
  });

  it("emits the security event §6.1 mandates — once, on the transition", async () => {
    const db = await connect();
    const device = await mintHub(db);
    const claimId = await issueClaim(db, device, freshCode(), 900);

    for (const wrong of ["ZZZZ1111", "ZZZZ2222", "ZZZZ3333", "ZZZZ4444", "ZZZZ5555"]) {
      await present(db, device, wrong);
    }

    const { rows } = await db.query<{ event_type: string; n: string }>(
      `select event_type, count(*) as n
         from kitluy_devices.device_claim_events
        where claim_id = $1::uuid
          and event_type in ('CLAIM_FAILED_ATTEMPT','CLAIM_LOCKED')
        group by event_type`,
      [claimId],
    );
    const byType = Object.fromEntries(rows.map((r) => [r.event_type, Number(r.n)]));
    expect(byType.CLAIM_FAILED_ATTEMPT).toBe(5);
    // Once, not once per subsequent presentation — a repeated "security event"
    // is noise, and noise is how a real one gets missed.
    expect(byType.CLAIM_LOCKED).toBe(1);
  });

  it("records MALFORMED and MISMATCH distinctly in the audit trail", async () => {
    const db = await connect();
    const device = await mintHub(db);
    const claimId = await issueClaim(db, device, freshCode(), 900);

    await present(db, device, "IOIO1234");
    await present(db, device, "ZZZZ1111");

    const { rows } = await db.query<{ reason: string }>(
      `select detail->>'reason' as reason
         from kitluy_devices.device_claim_events
        where claim_id = $1::uuid and event_type = 'CLAIM_FAILED_ATTEMPT'
        order by occurred_at`,
      [claimId],
    );
    expect(rows.map((r) => r.reason)).toEqual(["MALFORMED", "MISMATCH"]);
  });

  it("never writes the presented code, or its digest, anywhere", async () => {
    const db = await connect();
    const device = await mintHub(db);
    await issueClaim(db, device, freshCode(), 900);

    await present(db, device, "ZZZZ1111");

    // The eight-character space is searchable; a stored presentation is a
    // dictionary handed to whoever can read the audit table.
    const { rows } = await db.query<{ n: string }>(
      `select count(*) as n from kitluy_devices.device_claim_events
        where device_id = $1::uuid
          and (detail::text like '%ZZZZ1111%' or detail::text like $2)`,
      [device, `%${sha256("ZZZZ1111")}%`],
    );
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe.skipIf(!ready)("expiry is bookkeeping, not a failed attempt", () => {
  it("costs no attempt, and marks the claim expired", async () => {
    const db = await connect();
    const device = await mintHub(db);
    const code = freshCode();
    await issueClaim(db, device, code, 1);
    await db.query("select pg_sleep(2)");

    // The CORRECT code, presented late. If expiry spent an attempt, an attacker
    // could exhaust a victim's budget by doing nothing but waiting.
    const r = await present(db, device, code);
    expect(r.refusal_code).toBe("KLUY-HUBCLAIM-EXPIRED");

    const { rows } = await db.query<{ failed_attempt_count: number; state: string }>(
      `select failed_attempt_count, state::text as state
         from kitluy_devices.device_claims
        where device_id = $1::uuid order by created_at desc limit 1`,
      [device],
    );
    expect(rows[0]!.failed_attempt_count).toBe(0);
    expect(rows[0]!.state).toBe("expired");
  });
});

describe.skipIf(!ready)("the fifteen-minute ceiling", () => {
  it("refuses a code that would outlive the documented life", async () => {
    const db = await connect();
    const device = await mintHub(db);

    // 0121's issuance door accepts up to 86400 seconds — one second to TWENTY-
    // FOUR HOURS. The row constraint is what actually holds the protocol's
    // fifteen minutes.
    await expect(issueClaim(db, device, freshCode(), 3600)).rejects.toThrow(
      /device_claims_ttl_chk/,
    );
  });

  it("accepts the documented 900 seconds", async () => {
    const db = await connect();
    const device = await mintHub(db);

    await expect(issueClaim(db, device, freshCode(), 900)).resolves.not.toThrow();
  });
});
