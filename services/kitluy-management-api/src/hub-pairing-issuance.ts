/**
 * Opening a Store Hub pairing session, and the code that unlocks it.
 *
 * Authority: KLD-2026-08-13-HUB-PAIRING-SESSION-001 (the owner decision that a
 * code belongs to a STORE, not a Hub) implemented as migration group 0194;
 * KLD-2026-08-13-HUB-PAIRING-ROUTE-001; group 0193 (the permission and the
 * `kitluy_hub_issuance_service` identity); group 0191 (the code's rules).
 *
 * ===========================================================================
 * THE CODE IS GENERATED HERE, AND SHOWN EXACTLY ONCE
 * ===========================================================================
 * Only the DIGEST reaches the database. `hub_pairing_sessions.code_sha256` is
 * what is stored, so the plaintext exists in this process and in the HTTP
 * response, and nowhere else — not in a log line, not in an audit row, not in a
 * second read model. That is why the route returns it once and the Portal must
 * show it once: there is no "show me that code again" endpoint, because there is
 * nothing to show it from.
 *
 * ===========================================================================
 * WHY THE ALPHABET IS DRAWN FROM THE DATABASE
 * ===========================================================================
 * `kitluy_devices.hub_claim_code_alphabet_v1()` is the canonical 32 characters,
 * and group 0192 kept it readable by `authenticated` for precisely this reason.
 * Re-typing "0123456789ABCDEFGHJKMNPQRSTVWXYZ" into TypeScript would create a
 * second definition that can drift from the one the presenter validates against —
 * and the failure mode is a code an operator cannot type successfully.
 *
 * ===========================================================================
 * WHY THE TTL IS PASSED EXPLICITLY
 * ===========================================================================
 * The pairing protocol says fifteen minutes, and 0194 enforces it as a row
 * constraint (`hub_pairing_sessions_ttl_chk`). Passing 900 here is not the
 * enforcement — the table is — but passing nothing, or passing a default from
 * somewhere else, is how a caller ends up refused by a constraint it did not
 * know about.
 */
import { createHash, randomInt } from "node:crypto";

import type pg from "pg";

/** Pairing protocol §6.1: "Valid for 15 minutes by default." */
export const HUB_PAIRING_TTL_SECONDS = 900;
/** §6.1: "8 characters using unambiguous Crockford Base32." */
export const HUB_PAIRING_CODE_LENGTH = 8;

export interface IssuedHubPairingCode {
  /** Plaintext. Returned ONCE and never persisted. */
  readonly code: string;
  /** The SESSION this code opened. Not a claim — see `openHubPairingSession`. */
  readonly sessionId: string;
  readonly expiresAt: string;
}

export type IssuanceResult =
  | { readonly kind: "issued"; readonly issued: IssuedHubPairingCode }
  | { readonly kind: "refused"; readonly code: string; readonly detail: string };

/**
 * Refusals `open_hub_pairing_session_v1` raises, mapped for a STAFF caller.
 *
 * Unlike the device-facing surface, these are safe to distinguish: the caller is
 * an authenticated human acting inside their own Store, and knowing the Location
 * belongs to a different shop is exactly what they need in order to stop trying.
 * Enumeration is not a concern when the actor already holds the Store.
 */
const ISSUANCE_REFUSALS: Readonly<Record<string, string>> = {
  "KLUY-HUBSESSION-SCOPE-UNKNOWN": "that Store or Location does not exist, or they do not match",
  hub_pairing_sessions_ttl_chk: "the requested code lifetime exceeds the fifteen-minute ceiling",
};

/**
 * A uniformly random code over the canonical alphabet.
 *
 * `randomInt` rather than `Math.random`: this value is the sole authority to
 * attach a Store Hub to a Store, so it must come from a CSPRNG. Rejection-free
 * because `randomInt(max)` is already unbiased over its range.
 */
export function generateCode(alphabet: string, length = HUB_PAIRING_CODE_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

export interface HubPairingIssuanceDeps {
  readonly pool: pg.Pool;
}

/**
 * Open a pairing session for one STORE, inside one transaction as
 * `kitluy_hub_issuance_service`.
 *
 * ===========================================================================
 * WHY THIS NAMES NO DEVICE
 * ===========================================================================
 * Owner decision KLD-2026-08-13-HUB-PAIRING-SESSION-001: *the code is for the
 * Store, and any Hub may use it*. A Partner opens a session for their shop, not
 * for a serial number they would have to read off a box — and there is no honest
 * way to offer the alternative, because a Hub that has never paired belongs to
 * nobody, so "their" unpaired Hubs cannot be listed without listing everyone's.
 *
 * The device binding happens later, at the only moment it can honestly be known:
 * when a specific Hub actually presents the code. See the device registry's
 * pairing composition, which creates and redeems a normal device-bound claim at
 * that point, so the claim model and every 0121 refusal stay untouched.
 *
 * Authorization has ALREADY happened — see `authorizePartnerRequest`. This
 * function assumes the caller may act in the named Store and does not re-derive
 * it, because the two run against different identities: authority is decided as
 * the actor, and the governed door is reached as the least-privilege service.
 * Mixing them would mean either the actor needs table privileges or the service
 * decides authority, and both are worse.
 *
 * Opening a session REVOKES any session already open for the same Store. Two
 * live codes for one shop is how a Hub gets attached by a code someone believed
 * was already dead, so the door makes that impossible rather than warning about
 * it. A caller that re-issues has replaced the previous code, and the response
 * says so.
 */
export async function openHubPairingSession(
  deps: HubPairingIssuanceDeps,
  input: {
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
    readonly operatorRef: string;
  },
): Promise<IssuanceResult> {
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role kitluy_hub_issuance_service");

    const { rows: alphabetRows } = await client.query<{ alphabet: string }>(
      "select kitluy_devices.hub_claim_code_alphabet_v1() as alphabet",
    );
    const alphabet = alphabetRows[0]?.alphabet;
    if (alphabet === undefined || alphabet.length === 0) {
      await client.query("rollback");
      return {
        kind: "refused",
        code: "KLUY-HUBCODE-ALPHABET-UNAVAILABLE",
        detail: "the canonical code alphabet is unavailable",
      };
    }

    const code = generateCode(alphabet);

    const { rows } = await client.query<{ session_id: string }>(
      `select kitluy_devices.open_hub_pairing_session_v1(
                $1::uuid, $2::uuid, $3::uuid, $4, $5::integer, $6) as session_id`,
      [
        input.tenantId,
        input.digitalStoreId,
        input.storeLocationId,
        createHash("sha256").update(code, "utf8").digest("hex"),
        HUB_PAIRING_TTL_SECONDS,
        input.operatorRef,
      ],
    );
    const sessionId = rows[0]?.session_id;
    if (sessionId === undefined) {
      await client.query("rollback");
      return {
        kind: "refused",
        code: "KLUY-HUBCODE-NOT-ISSUED",
        detail: "the issuance door returned no session",
      };
    }

    // Read the authoritative expiry back rather than computing it: the row's
    // `expires_at` comes from the DATABASE clock, and a Portal that displayed a
    // locally computed deadline would count down to the wrong moment.
    //
    // Through a CAPABILITY, not a table read. This identity holds no table access
    // by design (group 0192, "one capability, no table reach"), so selecting from
    // `hub_pairing_sessions` here failed with `permission denied` on the first
    // real run — and granting SELECT to fix it would have handed the issuer every
    // column of every session for every Store to save one function.
    const { rows: sessionRows } = await client.query<{ expires_at: Date }>(
      "select kitluy_devices.hub_pairing_session_expiry_v1($1::uuid) as expires_at",
      [sessionId],
    );
    await client.query("commit");

    const expiresAt = sessionRows[0]?.expires_at;
    return {
      kind: "issued",
      issued: {
        code,
        sessionId,
        expiresAt: (expiresAt ?? new Date()).toISOString(),
      },
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const matched = Object.keys(ISSUANCE_REFUSALS).find((c) => message.includes(c));
    if (matched !== undefined) {
      return { kind: "refused", code: matched, detail: ISSUANCE_REFUSALS[matched]! };
    }
    // Unmapped: report a refusal without echoing a SQLSTATE, function name or row
    // identity at an HTTP caller.
    return {
      kind: "refused",
      code: "KLUY-HUBCODE-ISSUANCE-FAILED",
      detail: "the pairing code could not be issued",
    };
  } finally {
    client.release();
  }
}

/**
 * The Tenant, resolved from the Store row — never taken from the request.
 *
 * A caller who could supply the Tenant could try to open a session against a
 * Store in someone else's. `open_hub_pairing_session_v1` does check the pair and
 * refuses with `KLUY-HUBSESSION-SCOPE-UNKNOWN`, so this is defence in depth
 * rather than the only guard — but resolving the Tenant from the Store removes
 * the question a layer earlier, and returns null for a Location that does not
 * belong to the Store.
 */
export async function resolveStoreScope(
  deps: HubPairingIssuanceDeps,
  digitalStoreId: string,
  storeLocationId: string,
): Promise<{ readonly tenantId: string } | null> {
  const { rows } = await deps.pool.query<{ tenant_id: string }>(
    `select ds.tenant_id
       from kitluy_core.digital_stores ds
       join kitluy_core.store_locations sl on sl.digital_store_id = ds.id
      where ds.id = $1::uuid and sl.id = $2::uuid`,
    [digitalStoreId, storeLocationId],
  );
  const tenantId = rows[0]?.tenant_id;
  return tenantId === undefined ? null : { tenantId };
}

export interface PartnerStoreOption {
  readonly digitalStoreId: string;
  readonly digitalStoreReference: string;
  /** The Store's primary vertical code (e.g. LAUNDRY), verbatim. Decides which terminal vocabulary a Portal may offer. */
  readonly vertical: string | null;
  readonly locations: readonly {
    readonly storeLocationId: string;
    readonly locationReference: string;
  }[];
}

/**
 * The Stores and Locations a Partner may open a pairing session for.
 *
 * ===========================================================================
 * WHY THIS ENDPOINT HAD TO EXIST
 * ===========================================================================
 * A session names a Store and a Location, so a Portal must be able to offer
 * them — and it cannot read them itself. `kitluy_core` is deliberately NOT
 * exposed to the data API (`config.toml` exposes `public` alone), so a browser
 * holding an `authenticated` session has no path to `digital_stores` at all,
 * RLS policies notwithstanding.
 *
 * The identifiers come from `current_digital_store_ids()` — the same
 * server-resolved helper the authorizer and the RLS policies use — so this can
 * never list a Store the actor does not hold, whatever the caller sends.
 *
 * Names are read as `authenticated`, not as the service identity: the row-level
 * policies (`digital_stores_select_scoped`, `store_locations_select_scoped`) then
 * apply as a second, independent guard. Reading these as a privileged role would
 * make this function the only thing standing between a Partner and every shop in
 * the system.
 */
export async function listPartnerStores(
  deps: HubPairingIssuanceDeps,
  userId: string,
  digitalStoreIds: readonly string[],
): Promise<readonly PartnerStoreOption[]> {
  if (digitalStoreIds.length === 0) return [];

  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await client.query(
      "select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)",
      [userId],
    );
    await client.query("set local role authenticated");

    const { rows } = await client.query<{
      digital_store_id: string;
      digital_store_reference: string;
      vertical: string | null;
      store_location_id: string | null;
      location_reference: string | null;
    }>(
      // `store_code` / `location_code` are what staff actually say out loud, and
      // `name` is what they read. Both are joined into one label so the Portal
      // does not have to invent a formatting rule of its own.
      `select ds.id                                as digital_store_id,
              ds.store_code || ' — ' || ds.name    as digital_store_reference,
              ds.primary_vertical_code             as vertical,
              sl.id                                as store_location_id,
              sl.location_code || ' — ' || sl.name as location_reference
         from kitluy_core.digital_stores ds
         left join kitluy_core.store_locations sl on sl.digital_store_id = ds.id
        where ds.id = any ($1::uuid[])
        order by ds.store_code, sl.location_code`,
      [[...digitalStoreIds]],
    );

    const byStore = new Map<
      string,
      PartnerStoreOption & { locations: PartnerStoreOption["locations"][number][] }
    >();
    for (const r of rows) {
      let entry = byStore.get(r.digital_store_id);
      if (entry === undefined) {
        entry = {
          digitalStoreId: r.digital_store_id,
          digitalStoreReference: r.digital_store_reference,
          vertical: r.vertical,
          locations: [],
        };
        byStore.set(r.digital_store_id, entry);
      }
      // A Store with no Location yields one row with nulls from the LEFT JOIN.
      // Kept as a Store with an empty location list rather than dropped: the
      // Portal must be able to say "this shop has no Location yet" instead of
      // silently omitting it and leaving an operator hunting for it.
      if (r.store_location_id !== null && r.location_reference !== null) {
        entry.locations.push({
          storeLocationId: r.store_location_id,
          locationReference: r.location_reference,
        });
      }
    }
    return [...byStore.values()];
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}

/**
 * What a Partner may know about a pairing session they opened.
 *
 * ===========================================================================
 * WHY THIS EXISTS
 * ===========================================================================
 * Issuing a code told the Partner what to type and then went silent. On the
 * first real pairing the operator typed the code, the Hub paired successfully,
 * and the Portal still showed a ticking countdown — so the only way to learn it
 * had worked was to read a server log. A session that can be opened must be
 * observable, or "did it work?" has no answer on the screen that asked.
 *
 * Deliberately NOT Realtime over the data API: OD-ADMIN-FLEET-001 keeps
 * `kitluy_devices` closed to browsers, so a subscription would mean exposing the
 * schema. Polling this governed route keeps the boundary intact.
 */
export interface PairingSessionStatus {
  readonly sessionId: string;
  /** `open` · `consumed` · `revoked` · `expired` · `locked` — the stored state (0194). */
  readonly state: string;
  readonly pairedAt: string | null;
  /** The Hub that used the code. An opaque id, safe to show — contract §9. */
  readonly pairedDeviceId: string | null;
  readonly pairedDeviceReference: string | null;
  readonly failedAttemptCount: number;
  readonly lockedAt: string | null;
  readonly expiresAt: string;
  readonly digitalStoreId: string;
}

/**
 * Read one session. Returns null when it does not exist.
 *
 * The caller MUST check the returned `digitalStoreId` against the Stores the
 * actor holds — this function deliberately does no authorization of its own, so
 * a future caller cannot mistake it for a guarded read.
 */
export async function readPairingSession(
  deps: HubPairingIssuanceDeps,
  sessionId: string,
): Promise<PairingSessionStatus | null> {
  const client = await deps.pool.connect();
  try {
    const { rows } = await client.query<{
      id: string;
      state: string;
      paired_at: string | null;
      paired_device_id: string | null;
      asset_tag: string | null;
      failed_attempt_count: string | number;
      locked_at: string | null;
      expires_at: string;
      digital_store_id: string;
    }>(
      `select s.id,
              s.state::text                as state,
              s.paired_at,
              s.paired_device_id,
              d.asset_tag,
              s.failed_attempt_count,
              s.locked_at,
              s.expires_at,
              s.digital_store_id
         from kitluy_devices.hub_pairing_sessions s
         left join kitluy_devices.devices d on d.id = s.paired_device_id
        where s.id = $1::uuid`,
      [sessionId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      sessionId: row.id,
      state: row.state,
      pairedAt: row.paired_at,
      pairedDeviceId: row.paired_device_id,
      pairedDeviceReference: row.asset_tag,
      failedAttemptCount: Number(row.failed_attempt_count ?? 0),
      lockedAt: row.locked_at,
      expiresAt: row.expires_at,
      digitalStoreId: row.digital_store_id,
    };
  } finally {
    client.release();
  }
}
