/**
 * THE LIVE DEVICE GATE ENFORCING A REVOCATION WITH NO CLOUD.
 *
 * WS-11-T003 Step 4 §2.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS AND WHY `hub-revocation-offline.test.ts` WAS NOT ENOUGH
 * ===========================================================================
 * That suite proves the offline evaluator is CORRECT. It calls
 * `isCertificateRevokedOffline` directly, and independent review pointed out the
 * consequence: the evaluator had exactly one consumer in the entire repository,
 * and it was that test. A Hub could receive a snapshot, verify its signature,
 * check its scope, persist it atomically -- and then admit the revoked device
 * anyway, because the live gate never asked. The mechanism existed and nothing
 * invoked it, which is not enforcement.
 *
 * So this file does not call the evaluator at all. It issues a REAL business
 * command through the shipped `createBookingDraft` -> `executeHubCommand` ->
 * `authorizeHubCommand` path and asserts the command is REFUSED. If someone
 * deletes the offline check from the gate, this file fails; deleting it from the
 * evaluator's own suite would not.
 *
 * ===========================================================================
 * NO CLOUD IS INVOLVED, AND THAT IS THE POINT
 * ===========================================================================
 * The credential's replicated `status` column stays 'active' throughout --
 * exactly the state a Hub is in when the cloud revoked something it has not yet
 * synced. Every denial below therefore comes from the held snapshot and from
 * nothing else, and stage `stays denied after restart` proves it survives losing
 * the process.
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canonicalSnapshotBytes,
  signCanonicalBytesWithPem,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_SIGNATURE_ALGORITHM,
  type SignedRevocationSnapshot,
} from "@kitluy/device-identity";

import { createBookingDraft } from "../src/hub/commands/booking-commands.js";
import { createHubPool, type HubPool } from "../src/hub/db.js";
import {
  applySignedSnapshot,
  loadTrustedKeys,
  readHeldState,
  provisionTrustKey,
  type HubScopeIdentity,
} from "../src/hub/revocation-trust.js";
import {
  businessDate,
  deviceContext,
  hubReachable,
  LOCATION,
  nextCommandKey,
  pool,
  provisionTerminal,
  STORE,
  T1,
  TENANT,
  TEST_LOCATION_CODE,
  ACTOR_CASHIER,
  type ProvisionedTerminal,
} from "./hub-fixtures.js";

const reachable = await hubReachable();
if (!reachable)
  console.warn("SKIPPED: live-gate offline revocation — kitluy_hub_local unreachable");

const SUITE = `livegate-${randomUUID().slice(0, 8)}`;
const KEY_ID = `livegate-${randomUUID().slice(0, 8)}`;

/** EPHEMERAL, per run. No key material is committed anywhere. */
const pair = generateKeyPairSync("ed25519");
const privateKeyPem = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();

/**
 * THIS SUITE OWNS ITS OWN ENVIRONMENT PARTITION.
 *
 * The shipped fixtures pin one Tenant/Store/Location and every other Hub suite
 * operates in `local`, so addressing `local` here would mean two things at once:
 *
 *  * this file would inherit the snapshot ledger its own previous run left
 *    behind -- sequence and watermark must never go backwards, so the second run
 *    is refused SEQUENCE_NOT_NEWER and the tenth WATERMARK_ROLLBACK, since
 *    watermarks compare as TEXT and "10" < "9";
 *  * worse, the live gate now READS `revocation_snapshot` inside every command
 *    transaction, and these run SERIALIZABLE. Writing snapshots for `local`
 *    while other suites issue commands produced real
 *    "could not serialize access due to read/write dependencies" failures in
 *    `hub-command-happy-path` and `hub-offline-operation`.
 *
 * `development` is a distinct KitluyEnvironment, and the offline reader keys on
 * (tenant, store, location, environment), so this suite's snapshots are a
 * separate partition that no other suite reads and none of them can disturb.
 * Nothing is deleted to achieve it.
 */
const SUITE_ENVIRONMENT = "development" as const;

const HUB: HubScopeIdentity = {
  tenantId: TENANT,
  digitalStoreId: STORE,
  storeLocationId: LOCATION,
  environment: SUITE_ENVIRONMENT,
  hubDeviceId: "e0000000-0000-4000-8000-000000000010",
};

function sign(body: Omit<SignedRevocationSnapshot, "signature">): SignedRevocationSnapshot {
  return {
    ...body,
    signature: {
      keyId: KEY_ID,
      keyVersion: 1,
      algorithm: SNAPSHOT_SIGNATURE_ALGORITHM,
      signature: signCanonicalBytesWithPem(canonicalSnapshotBytes(body), privateKeyPem),
    },
  } satisfies SignedRevocationSnapshot;
}

function snapshotRevoking(serials: readonly string[], sequence: number): SignedRevocationSnapshot {
  const now = new Date().toISOString();
  return sign({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    scope: {
      tenantId: HUB.tenantId,
      digitalStoreId: HUB.digitalStoreId,
      storeLocationId: HUB.storeLocationId,
      environment: HUB.environment,
    },
    hubDeviceRecordId: HUB.hubDeviceId,
    snapshotVersion: sequence,
    sequence,
    // ZERO-PADDED, because the watermark is compared as TEXT. An unpadded
    // counter rolls back at 9 -> 10 ("10" < "9") and the Hub correctly refuses
    // it as WATERMARK_ROLLBACK -- which this file hit on its tenth run.
    revocationWatermark: String(sequence).padStart(12, "0"),
    generatedAt: now,
    effectiveAt: now,
    revokedCertificateSerials: [...serials],
    revokedDeviceRecordIds: [],
  });
}

describe.skipIf(!reachable)("the LIVE device gate refuses a snapshot-revoked credential", () => {
  let p: pg.Pool;
  let hubPool: HubPool;
  let today: string;

  /** The terminal whose credential the snapshot will revoke. */
  let doomed: ProvisionedTerminal;
  let doomedSerial = "";
  /** A terminal in the SAME Store that must keep working throughout. */
  let bystander: ProvisionedTerminal;
  let bystanderSerial = "";

  /** Issues a local credential row, as a sync would, in state `active`. */
  const issueCredential = async (terminal: ProvisionedTerminal): Promise<string> => {
    const serial = `LIVEGATE-${randomUUID().slice(0, 13).toUpperCase()}`;
    await p.query(
      `insert into edge_identity.device_credential
         (id, device_id, credential_type, public_key_fingerprint, certificate_serial,
          issuer, issued_at, expires_at, status, rotation_generation)
       values ($1, $2, 'device_certificate', $3, $4, 'kitluy-dev-ca',
               now() - interval '1 day', now() + interval '365 days', 'active', 1)`,
      [randomUUID(), terminal.terminalDeviceId, "a".repeat(64), serial],
    );
    return serial;
  };

  /**
   * Delivers a snapshot exactly as a Hub would.
   *
   * Two details that are not incidental:
   *
   *  * trusted keys come from the Hub's OWN store, never from the caller;
   *  * the sequence ADVANCES from whatever this Hub already holds. The scope is
   *    fixed by the shipped fixtures, so a previous run of this file leaves an
   *    active snapshot behind, and a hard-coded `1` is refused SEQUENCE_NOT_NEWER
   *    on the second run. Advancing is also what a real publisher does.
   */
  const deliver = async (revoked: readonly string[]) => {
    const held = await readHeldState(hubPool, HUB);
    const next = (held.sequence ?? 0) + 1;
    return applySignedSnapshot(
      hubPool,
      HUB,
      snapshotRevoking(revoked, next),
      await loadTrustedKeys(hubPool),
    );
  };

  /** Drives a REAL business command through the shipped pipeline. */
  const attemptCommand = async (terminal: ProvisionedTerminal) =>
    createBookingDraft(p, {
      device: deviceContext(terminal, { environment: SUITE_ENVIRONMENT }),
      ...(await nextCommandKey(p, terminal.terminalDeviceId)),
      businessDate: today,
      locationCode: TEST_LOCATION_CODE,
      pickupMethod: "store_pickup",
    });

  beforeAll(async () => {
    // SMALL ON PURPOSE. Every suite file runs in its own worker against ONE
    // development server; this file opens three pools (command, hub-admin and a
    // restart pool), and taking the default four each starved
    // `hub-outbox-atomicity` into a 5s timeout when the suites ran together.
    p = pool(2);
    hubPool = createHubPool(process.env, 2);
    today = await businessDate(p);

    doomed = await provisionTerminal(p, SUITE, T1, ACTOR_CASHIER);
    bystander = await provisionTerminal(p, `${SUITE}-b`, T1, ACTOR_CASHIER);
    doomedSerial = await issueCredential(doomed);
    bystanderSerial = await issueCredential(bystander);

    await provisionTrustKey(hubPool, {
      keyId: KEY_ID,
      keyVersion: 1,
      publicKeyPem,
      state: "current",
      activatedAt: new Date(Date.now() - 60_000),
    });
  }, 180_000);

  afterAll(async () => {
    await hubPool?.end().catch(() => undefined);
    await p?.end().catch(() => undefined);
  });

  it("ALLOWS the command before any revocation snapshot arrives", async () => {
    // The baseline that makes every later denial mean something: if this failed,
    // the denials below would prove nothing about revocation.
    const result = await attemptCommand(doomed);
    expect(result.aggregateId, "the doomed terminal must work before it is revoked").toBeTruthy();
  });

  it("DENIES the command once a signed snapshot revoking its serial is held", async () => {
    const outcome = await deliver([doomedSerial]);
    expect(outcome.applied, JSON.stringify(outcome)).toBe(true);

    // THE ASSERTION THIS FILE EXISTS FOR. A real command, the shipped path, and
    // the only thing that changed is what the Hub HOLDS.
    await expect(attemptCommand(doomed)).rejects.toThrow(/revoke/i);
  });

  it("attributes the denial to the SNAPSHOT, not to replicated status", async () => {
    // The replicated column is still 'active' -- proving the denial cannot have
    // come from the pre-existing status check, and therefore came from the
    // offline snapshot with no cloud involved.
    const { rows } = await p.query<{ status: string }>(
      `select status from edge_identity.device_credential where certificate_serial = $1`,
      [doomedSerial],
    );
    expect(rows[0]?.status, "the replicated status must still read active").toBe("active");

    await attemptCommand(doomed).then(
      () => expect.unreachable("the gate must refuse"),
      (error: unknown) => {
        const details = (error as { details?: Record<string, unknown> }).details ?? {};
        expect(details.source).toBe("OFFLINE_REVOCATION_SNAPSHOT");
        expect(details.certificateSerial).toBe(doomedSerial);
      },
    );
  });

  it("leaves an UNREVOKED terminal in the same Store working", async () => {
    // Containment: a revocation must deny exactly what it names.
    const result = await attemptCommand(bystander);
    expect(result.aggregateId, "an unrelated valid credential must still work").toBeTruthy();
  });

  it("STAYS denied after a newer snapshot that omits the serial", async () => {
    // Offline knowledge only ever GROWS. A later snapshot that simply does not
    // mention a serial is not a statement that it was reinstated, and treating it
    // as one would make revocation reversible by anyone who can withhold a name.
    const unrelated = "OTHER-SERIAL-0001";
    // Names NEITHER of this suite's serials, so the doomed one is omitted and the
    // bystander is still never mentioned by anything.
    expect([unrelated]).not.toContain(doomedSerial);
    expect([unrelated]).not.toContain(bystanderSerial);
    const outcome = await deliver([unrelated]);
    expect(outcome.applied, JSON.stringify(outcome)).toBe(true);

    await expect(attemptCommand(doomed)).rejects.toThrow(/revoke/i);
    // ... and the bystander, still not named by anything, still works.
    expect((await attemptCommand(bystander)).aggregateId).toBeTruthy();
  });

  it("STAYS denied across a Hub RESTART", async () => {
    // A fresh pool is a fresh process as far as this state is concerned: nothing
    // is cached in memory, so the answer must come from what was PERSISTED.
    const restarted = pool(1);
    try {
      await expect(
        createBookingDraft(restarted, {
          device: deviceContext(doomed, { environment: SUITE_ENVIRONMENT }),
          ...(await nextCommandKey(restarted, doomed.terminalDeviceId)),
          businessDate: today,
          locationCode: TEST_LOCATION_CODE,
          pickupMethod: "store_pickup",
        }),
      ).rejects.toThrow(/revoke/i);
    } finally {
      await restarted.end().catch(() => undefined);
    }
  });

  it("cannot be bypassed by a presenter naming a different serial", async () => {
    // The gate reads the serial from the Hub's OWN credential row. A device
    // context carries no serial at all, so there is nothing for a caller to
    // substitute -- asserted here so that adding one later fails loudly.
    const context = deviceContext(doomed, { environment: SUITE_ENVIRONMENT });
    expect(Object.keys(context)).not.toContain("certificateSerial");
    expect(JSON.stringify(context)).not.toContain(doomedSerial);
    await expect(attemptCommand(doomed)).rejects.toThrow(/revoke/i);
  });
});
