/**
 * DEVELOPMENT configuration publisher for a Store Hub.
 *
 * WHY THIS EXISTS, PRECISELY.
 *
 * A Store Hub will not pair a terminal into a profile it holds no grant for, and
 * `edge_identity.begin_terminal_pairing_v1` (migration 0031) sources that grant
 * from `edge_config.terminal_profile_assignment` joined to a
 * `configuration_snapshot` in state `active`. No unsigned snapshot may reach
 * `active` — the schema comment says so and `edge_config.activate_snapshot`
 * enforces it.
 *
 * The cloud publisher that would sign such a snapshot is not built (BLK-006),
 * and the LAN configuration route deliberately ships without a delivery signer
 * so it fails closed rather than serving development-signed configuration. The
 * consequence on real hardware is that a genuine, activated, recognised Pi
 * Terminal is refused PAIR_PROFILE_FORBIDDEN and the shop cannot trade.
 *
 * OWNER DECISION 2026-09-10: a development-only signer is permitted, in the
 * `development` environment only. This is that signer, and it is deliberately
 * narrow:
 *
 *   - It REFUSES unless the image declares KITLUY_ENVIRONMENT=development.
 *   - It uses the sanctioned `DevelopmentHmacBatchSigner` — the same
 *     development signer the sync path already carries — never a new scheme.
 *   - Its key is generated ON THE HUB, 0600, and never leaves it. No secret is
 *     baked into an image, and none crosses a machine boundary.
 *   - It goes THROUGH the real pipeline: record as `downloaded`, verify with the
 *     same verifier the cloud path uses, then activate. It does not write
 *     `state = 'active'` behind the verifier's back, so every check that guards
 *     a cloud snapshot guards this one.
 *
 * What it is NOT: a production path, and not a way to skip a signature. When the
 * BLK-006 publisher lands, this is deleted rather than kept as a fallback.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type pg from "pg";

import { HUB_RUNTIME_ROLE, withHubTransaction } from "./db.js";
import {
  activateSnapshot,
  recordDownloadedSnapshot,
  snapshotManifest,
  verifySnapshot,
  type PublishedSnapshot,
  type SnapshotSection,
} from "./sync/configuration.js";
import { DevelopmentHmacBatchSigner } from "./sync/signing.js";

/** On the encrypted volume, root-only, generated in place. Never in an image. */
export const DEV_CONFIGURATION_KEY_PATH =
  "/var/lib/kitluy/operational/development-configuration-signing.key";

/** Names the signer in every row it writes, so its provenance is never guessed. */
export const DEV_CONFIGURATION_KEY_ID = "kitluy.development-configuration-signer.v1";

/** One section is enough: the profile grants are the configuration in question. */
export const TERMINAL_PROFILES_SECTION = "terminal_profiles";

export class DevelopmentConfigurationRefused extends Error {
  constructor(
    readonly code: string,
    detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = "DevelopmentConfigurationRefused";
  }
}

/**
 * Load the Hub's development signing key, generating it on first use.
 *
 * 32 bytes is the floor `DevelopmentHmacBatchSigner` enforces; this writes 32
 * and lets that constructor be the judge rather than restating the rule.
 */
export function loadOrCreateDevelopmentSigner(
  path: string = DEV_CONFIGURATION_KEY_PATH,
): DevelopmentHmacBatchSigner {
  let secret: Buffer;
  try {
    secret = Buffer.from(readFileSync(path, "utf8").trim(), "base64");
  } catch {
    secret = randomBytes(32);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${secret.toString("base64")}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  return new DevelopmentHmacBatchSigner(DEV_CONFIGURATION_KEY_ID, secret);
}

export interface TerminalProfileGrant {
  readonly terminalDeviceId: string;
  readonly profileCodes: readonly string[];
}

export interface PublishOutcome {
  readonly snapshotId: string;
  readonly snapshotVersion: string;
  readonly previousSnapshotId: string | null;
  readonly grantsWritten: number;
}

export interface PublishInput {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly grants: readonly TerminalProfileGrant[];
  readonly environment: string;
  readonly signer?: DevelopmentHmacBatchSigner;
  readonly now?: Date;
  /**
   * Close every grant still OPEN at this location before writing the new set,
   * in the same transaction. The eligibility read honours only the grants at
   * the highest assignment_version from the ACTIVE snapshot, but the partial
   * unique index `terminal_profile_assignment_active_uq` refuses a second open
   * row for the same (terminal, profile) — so a re-publish for a terminal
   * already granted fails unless its previous rows are closed first. Done by
   * hand on 2026-09-18 (handoff 50 §7); the terminal sync passes `true`.
   * Default `false` keeps the one-terminal CLI publish exactly as it was.
   */
  readonly supersedeOpenGrants?: boolean;
}

/**
 * Publish, verify and activate a development configuration snapshot carrying the
 * profile grants, then write the grants that reference it.
 *
 * One transaction: a snapshot that activated but whose grants did not land would
 * leave a Hub that believes it is configured and still refuses every pairing.
 */
export async function publishDevelopmentConfiguration(
  pool: pg.Pool,
  input: PublishInput,
): Promise<PublishOutcome> {
  if (input.environment !== "development") {
    throw new DevelopmentConfigurationRefused(
      "KLUY-HUB-DEV-CONFIG-ENVIRONMENT",
      `this Hub declares environment '${input.environment}'; a development-signed configuration ` +
        "is permitted in development only (owner decision 2026-09-10)",
    );
  }
  if (input.grants.length === 0) {
    throw new DevelopmentConfigurationRefused(
      "KLUY-HUB-DEV-CONFIG-EMPTY",
      "no profile grants were given; an empty configuration would activate and grant nothing",
    );
  }
  const signer = input.signer ?? loadOrCreateDevelopmentSigner();
  const now = input.now ?? new Date();

  return withHubTransaction(
    pool,
    async (client) => {
      const versions = await client.query<{ next: string }>(
        `select coalesce(max(snapshot_version), 0) + 1 as next
           from edge_config.configuration_snapshot where location_id = $1::uuid`,
        [input.locationId],
      );
      const snapshotVersion = BigInt(versions.rows[0]?.next ?? "1");

      const section: SnapshotSection = {
        sectionCode: TERMINAL_PROFILES_SECTION,
        sectionVersion: snapshotVersion,
        required: true,
        content: {
          grants: input.grants.map((grant) => ({
            terminal_device_id: grant.terminalDeviceId,
            profile_codes: [...grant.profileCodes].sort(),
          })),
        },
      };

      const unsigned = {
        snapshotId: randomUUID(),
        tenantId: input.tenantId,
        digitalStoreId: input.digitalStoreId,
        locationId: input.locationId,
        snapshotVersion,
        schemaVersion: 1,
        notBefore: now,
        expiresAt: null,
        minimumHubVersion: "0.1.0",
        maximumHubVersion: null,
        sections: [section],
      };
      const signature = signer.sign(
        snapshotManifest({
          ...unsigned,
          signatureAlgorithm: signer.algorithm,
          signature: Buffer.alloc(0),
          signingKeyId: signer.keyId,
        }),
      );
      const snapshot: PublishedSnapshot = {
        ...unsigned,
        signatureAlgorithm: signature.algorithm,
        signature: Buffer.from(signature.signature, "base64"),
        signingKeyId: signature.keyId,
      };

      await recordDownloadedSnapshot(client, snapshot);

      // Through the real verifier, not around it. A snapshot that fails here is
      // marked `rejected` and never activates.
      const verdict = await verifySnapshot(client, snapshot, signer);
      if (!verdict.verified) {
        throw new DevelopmentConfigurationRefused(
          "KLUY-HUB-DEV-CONFIG-SIGNATURE",
          verdict.reason ?? "the snapshot did not verify against its own signer",
        );
      }

      const activation = await activateSnapshot(client, {
        activationId: randomUUID(),
        snapshotId: snapshot.snapshotId,
        actorType: "service",
        healthCheck: { source: "development-configuration-publisher" },
      });

      if (input.supersedeOpenGrants === true) {
        await client.query(
          `update edge_config.terminal_profile_assignment
              set effective_until = $2::timestamptz
            where location_id = $1::uuid and enabled and effective_until is null
              and effective_from < $2::timestamptz`,
          [input.locationId, now.toISOString()],
        );
      }

      let grantsWritten = 0;
      for (const grant of input.grants) {
        for (const profileCode of grant.profileCodes) {
          await client.query(
            `insert into edge_config.terminal_profile_assignment
               (id, tenant_id, digital_store_id, location_id, terminal_device_id, profile_code,
                assignment_version, enabled, effective_from, effective_until, source_snapshot_id)
             values (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
                     $6::bigint, true, $7, null, $8::uuid)`,
            [
              input.tenantId,
              input.digitalStoreId,
              input.locationId,
              grant.terminalDeviceId,
              profileCode,
              snapshotVersion.toString(),
              now,
              snapshot.snapshotId,
            ],
          );
          grantsWritten += 1;
        }
      }

      return {
        snapshotId: snapshot.snapshotId,
        snapshotVersion: snapshotVersion.toString(),
        previousSnapshotId: activation.previousSnapshotId,
        grantsWritten,
      };
    },
    HUB_RUNTIME_ROLE,
  );
}
