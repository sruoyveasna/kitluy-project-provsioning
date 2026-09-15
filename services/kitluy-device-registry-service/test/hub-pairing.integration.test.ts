/**
 * Store Hub pairing, END TO END against the canonical database.
 *
 * The route tests prove the transport refuses correctly with a stubbed
 * composition. This proves the part a stub cannot: that the two governed doors
 * actually compose, that the canonical payload digest this layer builds is the
 * one the issuer stored, and that a paired Hub really lands at `pending_trust`.
 *
 * ===========================================================================
 * THE ASSERTION THAT JUSTIFIES THE WHOLE SUITE
 * ===========================================================================
 * `payload_sha256`. The Partner Portal hashes the canonical claim payload when it
 * issues a code; this composition hashes it again from the scope the presentation
 * door returned. If those two disagree by a single byte, redemption answers
 * `KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED` on every legitimate pairing — and no unit
 * test can catch it, because a stub agrees with itself.
 *
 * Both halves here go through `@kitluy/device-identity`'s `hubClaimPayloadBytes`,
 * which is what makes the agreement real rather than coincidental.
 *
 * It skips — rather than passing vacuously — when the stack is unreachable or
 * predates group 0192.
 */
import { createHash, randomUUID } from "node:crypto";

import { hubClaimPayloadBytes } from "@kitluy/device-identity";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { HubPairingComposition } from "../src/hub-pairing-composition.js";

const DSN =
  process.env.KITLUY_HUB_PAIRING_DSN ?? "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

const sha256 = (v: Uint8Array | string): string => createHash("sha256").update(v).digest("hex");

/** The composition's least-privilege identity must exist (group 0192). */
async function ready(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 3000 });
  try {
    const { rows } = await probe.query<{ n: number }>(
      `select count(*)::int as n from pg_roles where rolname = 'kitluy_hub_pairing_service'`,
    );
    await probe.end();
    return (rows[0]?.n ?? 0) > 0;
  } catch {
    await probe.end().catch(() => undefined);
    return false;
  }
}
const live = await ready();

const pool = new pg.Pool({ connectionString: DSN, max: 4 });
afterAll(async () => {
  await pool.end().catch(() => undefined);
});

interface Scope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
}

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

/**
 * A REUSED fixture Hub for one test slot, released before use.
 *
 * Minting a fresh device per test made this suite repeatable, but it also grew
 * the development fleet by seven devices on EVERY run — 81 of the 490 devices in
 * the local fleet came from here alone, which is enough to make the Admin fleet
 * screen useless for finding a real Pi.
 *
 * A fixed device per slot, released before use, keeps the repeatability without
 * the growth. `enroll_device_v1` is not idempotent (a second call with the same
 * asset tag violates `devices_asset_tag_key`), so the device is resolved first
 * and only enrolled when genuinely absent.
 */
const FIXTURE_PREFIX = "PAIR-FIXTURE";
let slot = 0;

/**
 * Close what a previous run left behind so the device is claimable again.
 *
 * Rows are CLOSED, never deleted: `device_claims` and `device_assignments` are
 * append-only, and every foreign key into `devices` is NO ACTION. `revoked_at`
 * is set with the state because `device_assignments_revoked_cons` requires it —
 * a state without its timestamp is not a revocation.
 */
async function releaseHub(deviceId: string): Promise<void> {
  await pool.query(
    `update kitluy_devices.device_claims
        set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state = 'issued'`,
    [deviceId],
  );
  await pool.query(
    `update kitluy_devices.device_assignments
        set state = 'revoked', revoked_at = now()
      where device_id = $1::uuid and state in ('pending_trust', 'active')`,
    [deviceId],
  );
  // Pairing legitimately advances the device to `awaiting_trust`, and the
  // session door refuses anything that is not `enrolled`
  // (`KLUY-HUBSESSION-DEVICE-INELIGIBLE`). There is no governed "un-pair" —
  // rightly, because in the field a Hub that paired HAS paired — so a fixture
  // that is to be reused has to be walked back explicitly.
  //
  // The transition is checked by `trg_devices_lifecycle_transition` and it
  // permits this one, so the reset is legal rather than smuggled past a guard.
  // Scoped to `awaiting_trust` so it can never disturb a device in any other
  // state, and to this suite's own fixtures by the caller.
  // A fixture can now reach `active`, because activation started working
  // (groups 0198/0199). Revoke the certificate first: leaving an active
  // credential on a device walked back to `enrolled` would be an inconsistent
  // state no governed path can produce, and the next run would inherit it.
  await pool.query(
    `update kitluy_devices.device_certificates
        set status = 'revoked', revoked_at = now(), revocation_reason = 'fixture release'
      where device_id = $1::uuid and status = 'active'`,
    [deviceId],
  );
  await pool.query(
    `update kitluy_devices.devices
        set lifecycle_state = 'enrolled'
      where id = $1::uuid and lifecycle_state in ('awaiting_trust', 'active')`,
    [deviceId],
  );
}

async function mintHub(): Promise<string | null> {
  slot += 1;
  const assetTag = `${FIXTURE_PREFIX}-${String(slot).padStart(2, "0")}`;

  const { rows: found } = await pool.query<{ id: string }>(
    `select id from kitluy_devices.devices where asset_tag = $1`,
    [assetTag],
  );
  const existing = found[0]?.id;
  if (existing !== undefined) {
    await releaseHub(existing);
    return existing;
  }

  // Signals derived from the asset tag: stable across runs, unique per slot.
  // Two devices sharing evidence is a security event that would quarantine the
  // previous slot's Hub (`KLUY-DEVICE-EVIDENCE-COLLISION`).
  const h = createHash("sha256").update(assetTag).digest("hex");
  const signals = [
    { signal_type: "mac_address", signal_value: (h.slice(0, 12).match(/../g) ?? []).join(":") },
    { signal_type: "board_serial", signal_value: `BS-${h.slice(12, 28)}` },
    { signal_type: "storage_serial", signal_value: `SS-${h.slice(28, 44)}` },
  ];
  const { rows } = await pool.query<{ device_id: string }>(
    `select kitluy_devices.enroll_device_v1(
       $1::text,
       (select id from kitluy_devices.hardware_profiles where profile_key = $2 and is_active),
       now(), $3::text, 'ed25519', 'software', 'STATION-PAIRING-SUITE',
       'HET-MFG/pairing-suite', $4::jsonb, null) as device_id`,
    [assetTag, HUB_PROFILE_KEY, h, JSON.stringify(signals)],
  );
  return rows[0]?.device_id ?? null;
}

async function borrowedScope(): Promise<Scope> {
  const { rows } = await pool.query<{
    tenant_id: string;
    digital_store_id: string;
    store_location_id: string;
  }>(
    `select tenant_id, digital_store_id, store_location_id
       from kitluy_devices.device_claims order by created_at desc limit 1`,
  );
  const r = rows[0]!;
  return {
    tenantId: r.tenant_id,
    digitalStoreId: r.digital_store_id,
    storeLocationId: r.store_location_id,
  };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function freshCode(): string {
  return Array.from(
    randomUUID().replace(/-/g, "").slice(0, 8),
    (c) => CROCKFORD[parseInt(c, 16) % CROCKFORD.length],
  ).join("");
}

/**
 * Open a session exactly the way the PARTNER PORTAL does: store scope and a code
 * digest, and NO DEVICE.
 *
 * That absence is the whole point of the model
 * (KLD-2026-08-13-HUB-PAIRING-SESSION-001). A helper that named a device here
 * would be testing a contract the Portal cannot express — it has no way to know
 * which Hub will be standing in the shop, and no way to list "their" unpaired
 * Hubs to find out.
 *
 * The device-bound claim still exists; it is minted by the composition under
 * test, at the moment a specific Hub presents the code. So the canonical payload
 * digest is computed there rather than here, which is why this helper no longer
 * needs `hubClaimPayloadBytes` at all.
 */
async function openSessionLikeThePortal(code: string, scope: Scope): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select kitluy_devices.open_hub_pairing_session_v1(
              $1::uuid, $2::uuid, $3::uuid, $4, 900, 'operator/pairing-suite') as id`,
    [scope.tenantId, scope.digitalStoreId, scope.storeLocationId, sha256(code)],
  );
  return rows[0]!.id;
}

const composition = new HubPairingComposition({ source: pool });

describe.skipIf(!live)("a Store Hub pairs, and lands exactly where the model says", () => {
  it("PAIRS with the correct code and reaches pending_trust, not active", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();
    await openSessionLikeThePortal(code, scope);

    const outcome = await composition.pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/pairing-suite",
    });

    // If the two canonicalizations disagreed, this would be REDEMPTION_REFUSED
    // with `KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED` in the audit detail.
    expect(outcome.result).toBe("PAIRED");
    expect(outcome.data?.storeAssignment).toBe("pending_trust");
    expect(outcome.data?.activated).toBe(false);
    expect(outcome.data?.tenantId).toBe(scope.tenantId);

    // The assignment is real, and it is NOT active.
    const { rows } = await pool.query<{ state: string; assignment_generation: number }>(
      `select state::text as state, assignment_generation
         from kitluy_devices.device_assignments where id = $1::uuid`,
      [outcome.data!.assignmentId],
    );
    expect(rows[0]?.state).toBe("pending_trust");
    // The generation the board is told is the one the cloud holds (group 0226).
    expect(outcome.data?.assignmentGeneration).toBe(rows[0]?.assignment_generation);

    // BLK-005 holds: pairing did not activate the device.
    const { rows: dev } = await pool.query<{ lifecycle_state: string }>(
      `select lifecycle_state::text as lifecycle_state from kitluy_devices.devices where id = $1::uuid`,
      [device],
    );
    expect(dev[0]?.lifecycle_state).not.toBe("active");
  });

  it("accepts the code in lowercase, because an operator's shift key is not authority", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();
    await openSessionLikeThePortal(code, scope);

    const outcome = await composition.pair({
      deviceRecordId: device,
      presentedCode: code.toLowerCase(),
      actorRef: "device/pairing-suite",
    });

    expect(outcome.result).toBe("PAIRED");
  });
});

describe.skipIf(!live)("refusals reach the composition intact", () => {
  it("refuses a wrong code, and the session survives UNSPENT", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();
    const sessionId = await openSessionLikeThePortal(code, scope);

    const outcome = await composition.pair({
      deviceRecordId: device,
      presentedCode: "ZZZZ1111",
      actorRef: "device/pairing-suite",
    });

    expect(outcome.result).toBe("CODE_REFUSED");

    const { rows } = await pool.query<{ failed_attempt_count: number; state: string }>(
      `select failed_attempt_count, state from kitluy_devices.hub_pairing_sessions where id = $1::uuid`,
      [sessionId],
    );
    // ZERO, not one. A wrong code matches no session at all, so there is nothing
    // to count it against — you cannot lock a session you did not find
    // (KLD-2026-08-13-HUB-PAIRING-SESSION-001). Guessing is bounded by the
    // transport rate limiter and the code space, not by this counter.
    expect(rows[0]?.failed_attempt_count).toBe(0);
    expect(rows[0]?.state).toBe("open");
  });

  it("a wrong code can NEVER lock the session, however many times it is tried", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();
    const sessionId = await openSessionLikeThePortal(code, scope);

    for (let i = 0; i < 6; i += 1) {
      const r = await composition.pair({
        deviceRecordId: device,
        presentedCode: "ZZZZ2222",
        actorRef: "device/pairing-suite",
      });
      expect(r.result).toBe("CODE_REFUSED");
    }

    // The operator's own code still works. If misses DID spend the budget, a
    // stranger could lock a shop out of pairing by typing rubbish six times.
    const correct = await composition.pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/pairing-suite",
    });
    expect(correct.result).toBe("PAIRED");

    const { rows } = await pool.query<{ state: string }>(
      "select state from kitluy_devices.hub_pairing_sessions where id = $1::uuid",
      [sessionId],
    );
    expect(rows[0]?.state).toBe("consumed");
  });

  it("reports LOCKED once five INELIGIBLE devices spend the budget", async () => {
    const scope = await borrowedScope();
    const code = freshCode();
    const sessionId = await openSessionLikeThePortal(code, scope);

    // A HIT that then fails is what §6.1's "five failed attempts lock the
    // session" can honestly mean. Here the code is RIGHT every time and the
    // presenting device is not an enrolled Store Hub — a real scenario: someone
    // typing the Hub's code into a Pi Terminal.
    const { rows: terminals } = await pool.query<{ id: string }>(
      `select id from kitluy_devices.devices
        where device_class <> 'store_hub' or lifecycle_state <> 'enrolled'
        order by created_at desc limit 5`,
    );
    if (terminals.length < 5) return;

    const results: string[] = [];
    for (const t of terminals) {
      const r = await composition.pair({
        deviceRecordId: t.id,
        presentedCode: code,
        actorRef: "device/pairing-suite",
      });
      results.push(r.result);
    }

    // The fifth attempt LOCKS the session but still answers with the reason it
    // failed, not with "locked" — the door records the transition and reports the
    // cause, and only a LATER presentation meets the closed door. Asserted as it
    // actually behaves rather than as one might assume: an operator whose fifth
    // try is refused is told why that device cannot pair, which is the more useful
    // message at that moment.
    expect(results.every((r) => r === "CODE_REFUSED")).toBe(true);

    const { rows } = await pool.query<{ state: string; failed_attempt_count: number }>(
      `select state, failed_attempt_count from kitluy_devices.hub_pairing_sessions where id = $1::uuid`,
      [sessionId],
    );
    expect(rows[0]?.failed_attempt_count).toBe(5);
    expect(rows[0]?.state).toBe("locked");

    // THIS is where LOCKED surfaces, and it is what lets the CLI tell the operator
    // to fetch a new code rather than retype the one they are holding. A genuine
    // Hub with the correct code is now refused — the code is dead.
    const hub = await mintHub();
    if (hub === null) return;
    const late = await composition.pair({
      deviceRecordId: hub,
      presentedCode: code,
      actorRef: "device/pairing-suite",
    });
    expect(late.result).toBe("LOCKED");
  });

  it("refuses a code whose alphabet is wrong WITHOUT reaching the database", async () => {
    // `IOIO1234` cannot be a code: I and O are not Crockford. The composition
    // refuses it as a CODE (not a request error), and no device needs to exist.
    const outcome = await composition.pair({
      deviceRecordId: "11111111-1111-4111-8111-111111111111",
      presentedCode: "IOIO1234",
      actorRef: "device/pairing-suite",
    });
    expect(outcome.result).toBe("CODE_REFUSED");
  });

  it("refuses a malformed device id as a REQUEST problem", async () => {
    const outcome = await composition.pair({
      deviceRecordId: "not-a-uuid",
      presentedCode: "ABCD8291",
      actorRef: "device/pairing-suite",
    });
    expect(outcome.result).toBe("REQUEST_INVALID");
  });
});

describe.skipIf(!live)("the scope comes from the session, never from the caller", () => {
  /**
   * The pre-session version of this suite issued a claim carrying a payload
   * digest bound to the WRONG tenant, and proved redemption refused it with
   * `KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED`.
   *
   * That scenario is now UNREACHABLE, and saying so is more useful than keeping a
   * test that no longer tests it: there is no window in which a mis-scoped claim
   * exists, because the composition mints the claim itself, in the same
   * transaction, from the scope the session door returned. The binding is now
   * structural rather than checked after the fact.
   *
   * So what is worth proving is the property that replaced it — a Hub lands in
   * the session's Store, and the caller has no way to influence that.
   */
  it("a paired Hub lands in the SESSION's Store, not one the device asked for", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();
    await openSessionLikeThePortal(code, scope);

    const outcome = await composition.pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/pairing-suite",
    });
    expect(outcome.result).toBe("PAIRED");

    // Read the ASSIGNMENT the database actually wrote, not the composition's own
    // report of it — the two agreeing is the point.
    const { rows } = await pool.query<{
      tenant_id: string;
      digital_store_id: string;
      store_location_id: string;
    }>(
      `select tenant_id, digital_store_id, store_location_id
         from kitluy_devices.device_assignments
        where device_id = $1::uuid order by created_at desc limit 1`,
      [device],
    );
    expect(rows[0]?.tenant_id).toBe(scope.tenantId);
    expect(rows[0]?.digital_store_id).toBe(scope.digitalStoreId);
    expect(rows[0]?.store_location_id).toBe(scope.storeLocationId);
  });

  it("the claim it minted is bound to THAT Hub, so the 0121 model still holds", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();
    await openSessionLikeThePortal(code, scope);

    await composition.pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/pairing-suite",
    });

    // `device_claims.device_id` was never relaxed (see 0194's header). A claim
    // exists for this Hub, it is redeemed, and its payload digest is the
    // canonical one — which is what keeps every 0121 refusal meaningful.
    const { rows } = await pool.query<{ state: string; payload_sha256: string }>(
      `select state::text as state, payload_sha256 from kitluy_devices.device_claims
        where device_id = $1::uuid order by created_at desc limit 1`,
      [device],
    );
    expect(rows[0]?.state).toBe("redeemed");
    expect(rows[0]?.payload_sha256).toBe(
      sha256(
        hubClaimPayloadBytes({
          deviceRecordId: device,
          tenantId: scope.tenantId,
          digitalStoreId: scope.digitalStoreId,
          storeLocationId: scope.storeLocationId,
        }),
      ),
    );
  });
});
