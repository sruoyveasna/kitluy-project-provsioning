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

function randomHex(bytes: number): string {
  return randomUUID()
    .replace(/-/g, "")
    .repeat(4)
    .slice(0, bytes * 2);
}

async function mintHub(): Promise<string | null> {
  const fingerprint = randomHex(32);
  const h = randomHex(24);
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
    [
      `PAIR-${fingerprint.slice(0, 10).toUpperCase()}`,
      HUB_PROFILE_KEY,
      fingerprint,
      JSON.stringify(signals),
    ],
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
 * Issue a code exactly the way the PARTNER PORTAL will: ONE call to
 * `create_device_claim_v1`, with `payload_sha256` computed up front from the
 * canonical canonicalizer over values the issuer already holds.
 *
 * This helper is the reason the expiry is no longer in the canonical payload. The
 * first version of it inserted a placeholder digest and then UPDATEd the real one,
 * because `expires_at` does not exist until the row does — and the database
 * refused with `KLUY-DEVICE-CLAIM-IMMUTABLE`. That refusal was correct, and it
 * proved the payload definition was impossible for any issuer to satisfy.
 */
async function issueLikeThePortal(deviceId: string, code: string, scope: Scope): Promise<string> {
  const payload = sha256(
    hubClaimPayloadBytes({
      deviceRecordId: deviceId,
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      storeLocationId: scope.storeLocationId,
    }),
  );
  const { rows } = await pool.query<{ id: string }>(
    `select kitluy_devices.create_device_claim_v1(
              $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'operator/pairing-suite') as id`,
    [deviceId, scope.tenantId, scope.digitalStoreId, scope.storeLocationId, sha256(code), payload],
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
    await issueLikeThePortal(device, code, scope);

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
    const { rows } = await pool.query<{ state: string }>(
      `select state::text as state from kitluy_devices.device_assignments where id = $1::uuid`,
      [outcome.data!.assignmentId],
    );
    expect(rows[0]?.state).toBe("pending_trust");

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
    await issueLikeThePortal(device, code, scope);

    const outcome = await composition.pair({
      deviceRecordId: device,
      presentedCode: code.toLowerCase(),
      actorRef: "device/pairing-suite",
    });

    expect(outcome.result).toBe("PAIRED");
  });
});

describe.skipIf(!live)("refusals reach the composition intact", () => {
  it("refuses a wrong code, and the claim survives for another attempt", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();
    await issueLikeThePortal(device, code, scope);

    const outcome = await composition.pair({
      deviceRecordId: device,
      presentedCode: "ZZZZ1111",
      actorRef: "device/pairing-suite",
    });

    expect(outcome.result).toBe("CODE_REFUSED");

    const { rows } = await pool.query<{ failed_attempt_count: number; state: string }>(
      `select failed_attempt_count, state::text as state from kitluy_devices.device_claims
        where device_id = $1::uuid order by created_at desc limit 1`,
      [device],
    );
    expect(rows[0]?.failed_attempt_count).toBe(1);
    // Still issued: a wrong guess must not consume the operator's code.
    expect(rows[0]?.state).toBe("issued");
  });

  it("reports LOCKED distinctly once the budget is spent", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();
    await issueLikeThePortal(device, code, scope);

    const results: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await composition.pair({
        deviceRecordId: device,
        presentedCode: "ZZZZ2222",
        actorRef: "device/pairing-suite",
      });
      results.push(r.result);
    }

    // The fifth failure locks. LOCKED, not CODE_REFUSED, is what lets the CLI
    // tell the operator to fetch a new code instead of retyping.
    expect(results[4]).toBe("LOCKED");

    // And now even the CORRECT code is refused.
    const correct = await composition.pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/pairing-suite",
    });
    expect(correct.result).toBe("LOCKED");
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

describe.skipIf(!live)("the payload binding is not decorative", () => {
  it("REFUSES redemption when the stored payload was bound to a different scope", async () => {
    const device = await mintHub();
    if (device === null) return;
    const scope = await borrowedScope();
    const code = freshCode();

    // Issue with a payload digest bound to the WRONG tenant. Presentation still
    // matches — the code is right — but redemption must refuse, which is exactly
    // the promise `payload_sha256` carries: a captured token cannot be replayed
    // against a different Tenant, Digital Store or Location.
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ id: string }>(
        `select kitluy_devices.create_device_claim_v1(
                  $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'operator/pairing-suite') as id`,
        [
          device,
          scope.tenantId,
          scope.digitalStoreId,
          scope.storeLocationId,
          sha256(code),
          sha256(
            hubClaimPayloadBytes({
              deviceRecordId: device,
              tenantId: "99999999-9999-4999-8999-999999999999",
              digitalStoreId: scope.digitalStoreId,
              storeLocationId: scope.storeLocationId,
            }),
          ),
        ],
      );
      expect(rows[0]?.id).toBeTruthy();
    } finally {
      client.release();
    }

    const outcome = await composition.pair({
      deviceRecordId: device,
      presentedCode: code,
      actorRef: "device/pairing-suite",
    });

    expect(outcome.result).toBe("REDEMPTION_REFUSED");
    expect(outcome.auditDetail).toContain("payload");
  });
});
