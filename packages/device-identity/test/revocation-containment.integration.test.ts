/**
 * A REVOKED CREDENTIAL MUST NOT AUTHENTICATE — LIVE PostgreSQL.
 *
 * Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.4;
 * KLD-2026-07-28-002 §5.4, §6.1; WS-11-T003 Step 4 Phase D.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * `supabase/tests/assertions.sql` section 47b proves containment inside the
 * DATABASE: a revoked credential cannot renew, cannot be restored by the
 * credential governor itself, cannot be resurrected by an overlap window, and
 * its evidence cannot be edited away. All of that is true and none of it is the
 * question a terminal asks at the door, which is: does this certificate verify?
 *
 * That question is answered by `evaluateCertificateValidity`, and it was
 * answered from a {@link RevocationLookup} that NOTHING populated from the
 * database. Every existing test that reached the verifier passed
 * `isCertificateRevoked: () => false` — not as a placeholder for a real
 * implementation, but because there was no other implementation. A credential
 * could therefore be revoked through a fully governed, four-eyes, append-only
 * path and still verify, because the component that would have objected was
 * never told.
 *
 * `pg-revocation-lookup.ts` is the missing join, and this file is the proof that
 * it joins the two halves rather than merely existing. The shape of every test
 * here is the same and is the point:
 *
 *     verify BEFORE  -> revoke through a REAL governed door -> verify AFTER
 *
 * A test that only checked the AFTER state would pass just as happily against a
 * lookup that reported everything as revoked, and against a chain that never
 * verified in the first place. The BEFORE leg is what makes the AFTER leg mean
 * something.
 *
 * Every test runs inside a transaction that ROLLS BACK.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import type pg from "pg";

import {
  devDatabaseUrl,
  isDevDatabaseReachable,
  reportSkippedIntegration,
  withDatabaseTransaction,
} from "./support/dev-database.js";
import {
  DEVELOPMENT,
  DEVICE_IDENTITY,
  TEST_ROLES,
  createIncumbentFixture,
  pgIncumbentRepository,
  withRole,
  type IncumbentFixture,
} from "./support/renewal-fixtures.js";
import { buildChainFromStoredLinks } from "../src/same-key-renewal-preflight.js";
import { evaluateCertificateValidity } from "../src/certificate-validity.js";
import {
  DEVICE_REVOKING_LIFECYCLE_STATES,
  createLiveRevocationLookup,
  loadRevocations,
} from "../src/pg-revocation-lookup.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const SUITE = "@kitluy/device-identity revocation containment at the door";

const reachable = await isDevDatabaseReachable();
if (!reachable) reportSkippedIntegration(SUITE);

const trustedAt = (instant: Date): TrustedTimeEvaluation => ({
  status: "trusted",
  trustedTime: instant,
  source: "authenticated_network",
  floorAdvanced: true,
  anomalyType: null,
  detail: "revocation containment fixture",
});

interface Verdict {
  readonly valid: boolean;
  readonly rejectionCode?: string;
}

/**
 * Verifies generation 1 of the fixture device exactly as a verifier would, with
 * the revocation facts READ FROM THE DATABASE rather than stubbed.
 */
async function verifyWithDatabaseRevocations(
  client: pg.PoolClient,
  fixture: IncumbentFixture,
  trustedTime: Date,
): Promise<Verdict> {
  const repository = pgIncumbentRepository(client);
  const credential = await repository.loadCredentialAtGeneration(
    { deviceRecordId: fixture.deviceRecordId, environment: DEVELOPMENT, purpose: DEVICE_IDENTITY },
    1,
  );
  if (credential === null || credential === undefined) {
    throw new Error("the fixture credential could not be read back");
  }
  const chain = buildChainFromStoredLinks(
    await repository.loadCredentialChainLinks(credential.credentialId),
  );
  if (chain === null || chain === undefined) {
    throw new Error("the fixture chain could not be rebuilt from stored links");
  }

  const revocations = await loadRevocations(client, {
    environment: DEVELOPMENT,
    deviceRecordId: fixture.deviceRecordId,
  });

  const verdict = evaluateCertificateValidity({
    chain,
    trustedTime: trustedAt(trustedTime),
    environment: DEVELOPMENT,
    deviceRecordId: fixture.deviceRecordId,
    currentKeyFingerprint: credential.publicKeyFingerprint,
    currentCertificateGeneration: 1,
    revocations,
    trustedRootFingerprints: [fixture.ca.rootCertificate.tbs.subjectFingerprint],
  });
  return { valid: verdict.valid, rejectionCode: verdict.rejectionCode };
}

/**
 * Revokes generation 1 through the SHIPPED bound door, building the four-eyes
 * approval the way the database requires.
 *
 * The affected set is asked for, never constructed here: the payload hash must
 * be the one the DATABASE derived, or the binding refuses (RC-019, group 0146).
 */
async function revokeThroughGovernedDoor(
  client: pg.PoolClient,
  fixture: IncumbentFixture,
): Promise<void> {
  //
  // The resolver is governor-only, so the membership is BORROWED inside this
  // transaction and never handed out beyond it: `grant role` is catalog state
  // and catalog state is transactional, so the rollback that ends every test
  // here also un-grants it. `withRole` cannot be used — it assumes a membership
  // the session already holds, and `postgres` is deliberately not a member of
  // the credential governor.
  const scope = await (async () => {
    await client.query("select current_user as who");
    await client.query(
      `do $borrow$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $borrow$;`,
    );
    try {
      await client.query("set local role kitluy_credential_issuer");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.authoritative_revocation_scope_v1(
           $1::uuid, 'ADMINISTRATIVE_REPLACEMENT') as result`,
        [fixture.credentialId],
      );
      return rows[0]?.result ?? {};
    } finally {
      await client.query("reset role");
    }
  })();
  expect(
    scope.resolved,
    `the database would not derive the affected set: ${JSON.stringify(scope)}`,
  ).toBe(true);

  const { rows: policyRows } = await client.query<{ id: string }>(
    `insert into kitluy_auth.approval_policies
       (policy_key, version, permission_key, environment, quorum, status, risk_class)
     values ($1, 1, 'device.credential.revoke', $2, 1, 'ACTIVE', 'A4')
     returning id`,
    [`cred.revocation.a4.containment.${randomUUID().slice(0, 8)}`, DEVELOPMENT],
  );
  const { rows: approvalRows } = await client.query<{ id: string }>(
    `insert into kitluy_auth.approval_requests
       (policy_id, requester_id, resource_type, resource_id, environment, action,
        payload_hash, reason, status)
     values ($1::uuid, '00000000-0000-4000-8000-000000000007', 'device', $2::uuid, $3,
             'device_credential_revocation', $4, 'revocation containment fixture', 'APPROVED')
     returning id`,
    [policyRows[0]?.id, fixture.deviceRecordId, DEVELOPMENT, String(scope.payload_hash ?? "")],
  );
  const approvalId = approvalRows[0]?.id;
  await client.query(
    `insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
     values ($1::uuid, '00000000-0000-4000-8000-000000000009', 'APPROVE')`,
    [approvalId],
  );

  const outcome = await withRole(client, TEST_ROLES.issuanceService, async () => {
    const { rows } = await client.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.revoke_device_credential_bound_v1(
         $1::text, $2::uuid, $3::text, $4::text, 1,
         'ADMINISTRATIVE_REPLACEMENT', $5::text, 'REPROVISION_REQUIRED',
         'requester@containment', 'CONTAINMENT', $6::uuid, 'approver@containment',
         $7::text, $8::uuid) as result`,
      [
        `containment-${randomUUID()}`,
        fixture.deviceRecordId,
        DEVELOPMENT,
        DEVICE_IDENTITY,
        "revoked so the door can be asked whether it still opens",
        approvalId,
        `INC-CONTAINMENT-${randomUUID().slice(0, 8)}`,
        // NULL, not "". ADMINISTRATIVE_REPLACEMENT is a FLEET-derived reason
        // (group 0146), so the resolver returns no recorded `incident_scope_id`
        // at all — only the three recorded-set reasons carry one. Coercing the
        // absent value to an empty string asks Postgres to cast '' to uuid.
        typeof scope.incident_scope_id === "string" ? scope.incident_scope_id : null,
      ],
    );
    return rows[0]?.result ?? {};
  });
  expect(
    outcome.outcome,
    `the governed revocation did not complete: ${JSON.stringify(outcome)}`,
  ).toBe("REVOKED");
}

describe.skipIf(!reachable)(SUITE, () => {
  beforeAll(() => {
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  it("stops a credential verifying the moment it is revoked through the governed door", async () => {
    await withDatabaseTransaction(async (client: pg.PoolClient) => {
      const issuedAt = new Date();
      const fixture = await createIncumbentFixture(client, {
        label: "revocation-containment",
        issuedAtTrustedTime: issuedAt,
      });

      // BEFORE. Without this leg the AFTER leg proves nothing: a chain that
      // never verified would also "stop verifying" after a revocation.
      const before = await verifyWithDatabaseRevocations(client, fixture, issuedAt);
      expect(
        before.valid,
        `the fixture credential did not verify before revocation (${before.rejectionCode})`,
      ).toBe(true);

      await revokeThroughGovernedDoor(client, fixture);

      // AFTER. Same chain, same trusted time, same verifier — the ONLY thing
      // that changed is what the database says about revocation.
      const after = await verifyWithDatabaseRevocations(client, fixture, issuedAt);
      expect(after.valid).toBe(false);
      expect(after.rejectionCode).toBe("CERT_REVOKED");
    });
  });

  it("reports the revocation as CERT_REVOKED rather than letting expiry mask it", async () => {
    await withDatabaseTransaction(async (client: pg.PoolClient) => {
      const issuedAt = new Date();
      const fixture = await createIncumbentFixture(client, {
        label: "revocation-containment-expiry",
        issuedAtTrustedTime: issuedAt,
      });
      await revokeThroughGovernedDoor(client, fixture);

      // Verified far past the certificate's own window, so BOTH faults are true
      // at once. §5.4 requires the revocation to be the answer: "expired" would
      // suggest a credential that simply ran its course, and an operator reading
      // that would reissue rather than investigate.
      const wayLater = new Date(issuedAt.getTime() + 400 * 24 * 60 * 60 * 1000);
      const verdict = await verifyWithDatabaseRevocations(client, fixture, wayLater);
      expect(verdict.valid).toBe(false);
      expect(verdict.rejectionCode).toBe("CERT_REVOKED");
    });
  });

  it("loads only the revoked serials, and does not report a live credential as revoked", async () => {
    await withDatabaseTransaction(async (client: pg.PoolClient) => {
      const issuedAt = new Date();
      const dead = await createIncumbentFixture(client, {
        label: "revocation-containment-dead",
        issuedAtTrustedTime: issuedAt,
      });
      const live = await createIncumbentFixture(client, {
        label: "revocation-containment-live",
        issuedAtTrustedTime: issuedAt,
      });
      await revokeThroughGovernedDoor(client, dead);

      // Environment-wide load, which is what a Store Hub priming itself does.
      const all = await loadRevocations(client, { environment: DEVELOPMENT });

      expect(all.isCertificateRevoked(dead.serialNumber)).toBe(true);
      expect(all.isCertificateRevoked(live.serialNumber)).toBe(false);

      // The untouched device still verifies, so the lookup is discriminating
      // rather than simply pessimistic.
      const liveVerdict = await verifyWithDatabaseRevocations(client, live, issuedAt);
      expect(
        liveVerdict.valid,
        `an untouched credential was rejected: ${liveVerdict.rejectionCode}`,
      ).toBe(true);

      // Neither device is a REVOKED DEVICE: revoking one credential must not
      // condemn the hardware, or a routine key rotation would retire a terminal.
      expect(all.isDeviceRevoked(dead.deviceRecordId)).toBe(false);
      expect(all.isDeviceRevoked(live.deviceRecordId)).toBe(false);
    });
  });

  it("answers live, per question, when a caller cannot cache", async () => {
    await withDatabaseTransaction(async (client: pg.PoolClient) => {
      const fixture = await createIncumbentFixture(client, {
        label: "revocation-containment-live-lookup",
        issuedAtTrustedTime: new Date(),
      });
      const serial = fixture.serialNumber;
      const lookup = createLiveRevocationLookup(client, DEVELOPMENT);

      expect(await lookup.isCertificateRevoked(serial)).toBe(false);
      await revokeThroughGovernedDoor(client, fixture);
      // The SAME lookup object, with no reload: this is the difference between
      // the live adapter and the point-in-time one.
      expect(await lookup.isCertificateRevoked(serial)).toBe(true);
    });
  });

  it("refuses to run against a database whose lifecycle states it does not recognise", async () => {
    // The names in DEVICE_REVOKING_LIFECYCLE_STATES must exist, because a name
    // no row can hold matches nothing and would silently disable device-level
    // revocation. The first version of the query named `decommissioned`, which
    // this database does not have.
    await withDatabaseTransaction(async (client: pg.PoolClient) => {
      const { rows } = await client.query<{ label: string }>(
        `select e.enumlabel as label from pg_enum e
           join pg_type t on t.oid = e.enumtypid
          where t.typname = 'device_lifecycle_state'`,
      );
      const known = new Set(rows.map((row) => row.label));
      expect(known.size).toBeGreaterThan(0);
      for (const state of DEVICE_REVOKING_LIFECYCLE_STATES) {
        expect(known.has(state), `${state} is not a device_lifecycle_state in this database`).toBe(
          true,
        );
      }
    });
  });
});
