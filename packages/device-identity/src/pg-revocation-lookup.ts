/**
 * Production Postgres adapter for {@link RevocationLookup} — the READ side of
 * revocation.
 *
 * Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.4;
 * KLD-2026-07-28-002 §6.1; WS-11-T003 Step 4 Phase D.
 *
 * ===========================================================================
 * THE GAP THIS CLOSES
 * ===========================================================================
 * Before this module the revocation story had a hole in the middle, and both
 * ends looked finished:
 *
 *   * the WRITE side was complete — the governed doors revoke, the database
 *     refuses to un-revoke, and the evidence is append-only;
 *   * the VERIFIER was complete — `evaluateCertificateValidity` rejects with
 *     CERT_REVOKED as soon as its {@link RevocationLookup} says a serial or a
 *     device is revoked, and it checks revocation BEFORE expiry so a revoked
 *     credential is never merely reported as "expired";
 *   * and NOTHING JOINED THEM. `revocationLookupFrom` builds a lookup from a
 *     signed snapshot whose `revokedCertificateSerials` are caller-supplied,
 *     and no code anywhere populated that list from the revocation tables.
 *
 * Every test that reached the verifier passed `isCertificateRevoked: () => false`,
 * which is not a stub standing in for a real implementation — it was the only
 * implementation. So a credential could be revoked through a fully governed,
 * four-eyes, append-only path and still authenticate, because the component
 * that would have objected was never told.
 *
 * ===========================================================================
 * WHAT THIS IS AND IS NOT
 * ===========================================================================
 * This is the ONLINE lookup: a Digital Store (or any caller with a live
 * connection to the authoritative database) asks Postgres directly. It is the
 * simple half of §6, and it is deliberately the half that ships first, because
 * a store with connectivity should never be the reason a revoked device keeps
 * working.
 *
 * It is NOT the offline path. A Store Hub that has lost connectivity must fall
 * back to the last SIGNED snapshot and `revocationLookupFrom`, which enforces
 * what it already knows (§6.1) while refusing to authorize anything new (§6.7).
 * Producing and signing those snapshots needs the configuration signer, which
 * does not exist until Step 6; until then this adapter and the snapshot path
 * remain separate, and that separation is stated rather than papered over with
 * an unsigned "snapshot" built here.
 */
import type { QueryResult } from "pg";

import type { RevocationLookup } from "./certificate-validity.js";

export type RevocationReadExecutor = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

export interface RevocationLookupScope {
  readonly environment: string;
  /**
   * Optional. When given, only this device's revocations are loaded — the shape
   * a single-device verification wants. When omitted the whole environment is
   * loaded, which is what a Store Hub priming itself needs.
   */
  readonly deviceRecordId?: string;
}

/** What was loaded, so a caller can log or assert on it rather than guess. */
export interface LoadedRevocations extends RevocationLookup {
  readonly revokedCertificateSerials: readonly string[];
  readonly revokedDeviceRecordIds: readonly string[];
  readonly loadedAt: Date;
}

/**
 * The device lifecycle states that mean "this device may no longer authenticate".
 *
 * ONLY `retired`, and the omissions are deliberate rather than an oversight:
 *
 *   * a DEVICE is not revoked merely because one of its credentials is. A
 *     terminal that rotated its key after a routine administrative revocation is
 *     a working terminal holding one dead credential, and reporting the device
 *     as revoked would take it off the shop floor;
 *   * `suspended`, `quarantined` and `restricted_investigation` are handled by
 *     their own gates, which can be lifted. Folding them in here would turn a
 *     reversible operational state into a certificate-level revocation, and
 *     `evaluateCertificateValidity` has no way to express "temporarily";
 *   * `replaced` describes a device whose duties moved elsewhere; whether its
 *     own credentials die with it is a lifecycle question the replacement flow
 *     answers by revoking them, not something to infer here.
 *
 * Widening this set is an owner decision, not a code change:
 * [REQUIRED: owner decision on whether quarantine or suspension must also deny
 * certificate validation at the edge, or remain gate-level controls].
 */
export const DEVICE_REVOKING_LIFECYCLE_STATES: readonly string[] = ["retired"];

/**
 * Reads the authoritative revocation state and returns a lookup over it.
 *
 * Certificate-level revocation is keyed on `serial_number`, because that is what
 * the verifier reads out of the TBS it is checking — `credential_id` is the
 * database's key and never appears in a certificate.
 *
 * `state = 'revoked'` and `revoked_at is not null` are ORed rather than ANDed.
 * A CHECK constraint keeps the pair in step, so in practice they agree; the OR
 * decides which way to fail if they ever did not, and the safe direction is to
 * treat a half-written revocation as a revocation.
 */
async function assertLifecycleStatesExist(client: RevocationReadExecutor): Promise<void> {
  const { rows } = await client.query<{ missing: string | null }>(
    `select string_agg(wanted, ', ' order by wanted) as missing
       from unnest($1::text[]) as wanted
      where not exists (
        select 1 from pg_enum e
          join pg_type t on t.oid = e.enumtypid
         where t.typname = 'device_lifecycle_state' and e.enumlabel = wanted)`,
    [DEVICE_REVOKING_LIFECYCLE_STATES],
  );
  const missing = rows[0]?.missing;
  if (missing !== null && missing !== undefined && missing !== "") {
    throw new Error(
      `device revocation lookup names lifecycle state(s) this database does not have (${missing}); ` +
        "device-level revocation would silently match nothing",
    );
  }
}

export async function loadRevocations(
  client: RevocationReadExecutor,
  scope: RevocationLookupScope,
): Promise<LoadedRevocations> {
  const credentials = await client.query<{ serial_number: string }>(
    `select serial_number
       from kitluy_devices.device_credentials
      where environment = $1
        and (state = 'revoked' or revoked_at is not null)
        and ($2::uuid is null or device_record_id = $2::uuid)`,
    [scope.environment, scope.deviceRecordId ?? null],
  );

  // The state names are checked against the catalog BEFORE they are used.
  //
  // `lifecycle_state in ('retired', 'decommissioned')` was the first version of
  // this query, and `decommissioned` is not a state this database has. It did
  // not error — a comparison against a name no row holds simply matches nothing,
  // so device-level revocation would have been silently switched off while every
  // test still passed. A wrong name must be loud.
  await assertLifecycleStatesExist(client);

  const devices = await client.query<{ id: string }>(
    `select id::text as id
       from kitluy_devices.devices
      where lifecycle_state::text = any($1::text[])
        and ($2::uuid is null or id = $2::uuid)`,
    [DEVICE_REVOKING_LIFECYCLE_STATES, scope.deviceRecordId ?? null],
  );

  const serials = new Set(credentials.rows.map((row) => row.serial_number));
  const deviceIds = new Set(devices.rows.map((row) => row.id));

  return {
    revokedCertificateSerials: [...serials],
    revokedDeviceRecordIds: [...deviceIds],
    loadedAt: new Date(),
    isCertificateRevoked: (serial) => serials.has(serial),
    isDeviceRevoked: (deviceRecordId) => deviceIds.has(deviceRecordId),
  };
}

/**
 * A lookup that asks the database on EVERY question rather than caching.
 *
 * Correct by construction and slow by construction, so it is offered for the
 * cases where correctness is the only thing that matters — a single
 * high-consequence verification, or a test that must see a revocation the
 * instant it commits. Anything in a hot path should call {@link loadRevocations}
 * once and reuse the result, and accept that the result is a point-in-time
 * answer.
 *
 * NOT usable offline: with no connection every call throws, and a verifier that
 * treated a thrown lookup as "not revoked" would fail OPEN. Callers that can
 * lose connectivity must use the snapshot path.
 */
export function createLiveRevocationLookup(
  client: RevocationReadExecutor,
  environment: string,
): {
  isCertificateRevoked(serial: string): Promise<boolean>;
  isDeviceRevoked(deviceRecordId: string): Promise<boolean>;
} {
  return {
    async isCertificateRevoked(serial: string): Promise<boolean> {
      const { rows } = await client.query<{ revoked: boolean }>(
        `select exists (
           select 1 from kitluy_devices.device_credentials
            where environment = $1 and serial_number = $2
              and (state = 'revoked' or revoked_at is not null)) as revoked`,
        [environment, serial],
      );
      return rows[0]?.revoked === true;
    },
    async isDeviceRevoked(deviceRecordId: string): Promise<boolean> {
      await assertLifecycleStatesExist(client);
      const { rows } = await client.query<{ revoked: boolean }>(
        `select exists (
           select 1 from kitluy_devices.devices
            where id = $1::uuid
              and lifecycle_state::text = any($2::text[])) as revoked`,
        [deviceRecordId, DEVICE_REVOKING_LIFECYCLE_STATES],
      );
      return rows[0]?.revoked === true;
    },
  };
}
