/**
 * Real {@link createPgRevocationGateway} — LIVE PostgreSQL.
 *
 * Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001; groups 0145–0147;
 * WS-11-T003 Step 4 Phase C.
 *
 * Proves the production adapter calls ONLY
 * `revoke_device_credential_governed_v1` as `kitluy_issuance_service`, maps
 * jsonb outcomes, and treats SQLSTATE 42501 on the legacy unscoped function as
 * permanent authorization denial. Every test rolls back.
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
  currentRole,
  withRole,
} from "./support/renewal-fixtures.js";
import { revokeDeviceCredential, type RevocationOutcome } from "../src/credential-revocation.js";
import { createPgRevocationGateway } from "../src/pg-revocation-gateway.js";

const SUITE = "@kitluy/device-identity pg RevocationGateway";

const reachable = await isDevDatabaseReachable();
if (!reachable) reportSkippedIntegration(SUITE);

describe.skipIf(!reachable)(SUITE, () => {
  beforeAll(() => {
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  it("executes governed revocation as kitluy_issuance_service and never as postgres", async () => {
    await withDatabaseTransaction(async (client: pg.PoolClient) => {
      const fixture = await createIncumbentFixture(client, {
        label: "pg-revocation-gateway",
        issuedAtTrustedTime: new Date(),
      });
      const roles: string[] = [];
      const gateway = createPgRevocationGateway({
        async query(text, values) {
          return withRole(client, TEST_ROLES.issuanceService, async () => {
            roles.push(await currentRole(client));
            return client.query(text, values);
          });
        },
      });

      // Without a matching four-eyes approval the governed door refuses — the
      // adapter must surface that jsonb refusal, not invent success.
      const outcome: RevocationOutcome = await revokeDeviceCredential(
        {
          revocationRequestId: `pg-gw-${randomUUID()}`,
          deviceRecordId: fixture.deviceRecordId,
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          credentialGeneration: 1,
          reasonCode: "ADMINISTRATIVE_REPLACEMENT",
          reason: "pg gateway smoke — expect approval refusal",
          requestedBy: "gateway@test",
          source: "pg-revocation-gateway.integration",
          approvalRequestId: randomUUID(),
          approvedBy: "approver@test",
        },
        gateway,
      );

      expect(roles.every((r) => r === TEST_ROLES.issuanceService)).toBe(true);
      expect(outcome.outcome).toBe("REVOCATION_REFUSED");
      expect(String(outcome.refusalCode ?? "")).toMatch(/KLUY-CRED-REVOCATION/);
    });
  });

  it("maps permission denied on the legacy unscoped door to permanent NOT_AUTHORIZED", async () => {
    await withDatabaseTransaction(async (client: pg.PoolClient) => {
      const legacyGateway = {
        async revokeDeviceCredential() {
          return withRole(client, TEST_ROLES.issuanceService, async () => {
            // Deliberately aim at the REVOKED legacy function — Phase C requires
            // that an adapter still pointed here fails permanently.
            await client.query(
              `select kitluy_devices.revoke_device_credential_v1(
                 $1, $2::uuid, $3, $4, 1,
                 'ADMINISTRATIVE_REPLACEMENT'::kitluy_devices.credential_revocation_reason,
                 'legacy probe', 'NO_RECOVERY'::kitluy_devices.credential_recovery_disposition,
                 'x', 'y', null, null, null)`,
              [`legacy-${randomUUID()}`, randomUUID(), DEVELOPMENT, DEVICE_IDENTITY],
            );
            return { outcome: "REVOKED" as const };
          });
        },
      };

      const outcome = await revokeDeviceCredential(
        {
          revocationRequestId: `legacy-${randomUUID()}`,
          deviceRecordId: randomUUID(),
          environment: DEVELOPMENT,
          purpose: DEVICE_IDENTITY,
          credentialGeneration: 1,
          reasonCode: "ADMINISTRATIVE_REPLACEMENT",
          reason: "must not reach a successful revoke through the legacy door",
          requestedBy: "gateway@test",
          source: "pg-revocation-gateway.integration",
          approvalRequestId: randomUUID(),
          approvedBy: "approver@test",
        },
        legacyGateway,
      );

      expect(outcome.outcome).toBe("REVOCATION_REFUSED");
      expect(outcome.refusalCode).toBe("REVOCATION_NOT_AUTHORIZED");
    });
  });
});
