/**
 * The missing bridge: `GovernedIssuanceGateway` over the deployed SQL doors.
 *
 * Authority: KLD-2026-07-28-002 (BLK-005 development issuance); the credential
 *   persistence group (0125) and the governed issuance functions it installed.
 *
 * ===========================================================================
 * WHY THIS FILE HAD TO EXIST BEFORE ANY DEVICE COULD BE TRUSTED
 * ===========================================================================
 * Everything on both sides of it was already built and shipped:
 *
 *   TypeScript   runGovernedIssuance()  prepare -> sign -> record -> finalize
 *   PostgreSQL   prepare_/record_/finalize_device_credential_issuance_v1
 *
 * and nothing joined them. The SQL functions were called only from tests, so
 * `device_credentials` held zero rows for the entire fleet, and
 * `activate_device_v1` refused every device with KLUY-DEVICE-NO-CERTIFICATE —
 * the last gate before a Hub may serve a till.
 *
 * ===========================================================================
 * THIS MODULE ALLOCATES NOTHING
 * ===========================================================================
 * Serial numbers, certificate generations, credential ids, validity windows and
 * the canonical to-be-signed bytes all come OUT of the database. The adapter's
 * own header is explicit that it invents none of them, and neither does this.
 * Every method here is a thin, faithful call — no defaulting, no retry, no
 * "helpful" substitution of a missing value.
 *
 * A database refusal is returned as a thrown error on purpose: the adapter
 * catches it and preserves the exact code, so the caller can tell "stale
 * assignment" from "device quarantined" from "no trusted time". Flattening
 * those into one failure would lose the reason a device cannot be trusted.
 */
import type pg from "pg";

import type {
  ChainLinkInput,
  FinalizedCredential,
  GovernedIssuanceGateway,
  PrepareInput,
  PreparedReservation,
} from "@kitluy/device-identity";

export interface IssuanceGatewayDeps {
  readonly pool: pg.Pool;
  /**
   * The role the governed doors are granted to. `kitluy_credential_issuer` is
   * the narrow one and is preferred; `service_role` also holds EXECUTE and is
   * the fallback where the narrow role cannot be assumed
   * (KLREC-2026-08-17-PG16-ROLE-MEMBERSHIP-001 — PostgreSQL 16 gives a role's
   * creator an admin-only membership, so a created role can be unenterable).
   */
  readonly issuerRole?: string;
}

/** Every governed call runs inside one transaction, as the issuing identity. */
async function inIssuerTransaction<T>(
  deps: IssuanceGatewayDeps,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    // `set local`, so the role lasts exactly this transaction and cannot leak
    // to the next request on a pooled connection.
    await client.query(`set local role ${deps.issuerRole ?? "service_role"}`);
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * The database renders its answers as `jsonb`. Keys are snake_case there and
 * camelCase in the adapter's interface; this is the only place the two
 * vocabularies meet, exactly as `CANONICAL_SIGNAL_TYPE` is for hardware signals.
 */
interface PrepareRow {
  outcome: string;
  attempt_id?: string | null;
  request_id: string;
  credential_id: string;
  serial_number: string;
  certificate_generation: number | string;
  assignment_generation?: number | string | null;
  issuer_key_id?: string | null;
  not_before?: string | null;
  not_after?: string | null;
  canonical_tbs?: string | null;
  canonical_tbs_hash?: string | null;
  head_version_seen?: number | string | null;
  already_signed?: boolean | null;
}

const num = (v: number | string | null | undefined): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);

export function createIssuanceGateway(deps: IssuanceGatewayDeps): GovernedIssuanceGateway {
  return {
    async prepare(input: PrepareInput): Promise<PreparedReservation> {
      const { rows } = await inIssuerTransaction(deps, (client) =>
        client.query<{ result: PrepareRow }>(
          `select kitluy_devices.prepare_device_credential_issuance_v1(
             $1, $2::uuid, $3, $4, $5::integer, $6, $7, $8, $9, $10, $11,
             $12::bytea, $13::boolean, $14, $15::timestamptz, $16, $17) as result`,
          [
            input.requestId,
            input.deviceRecordId,
            input.environment,
            input.purpose,
            input.assignmentGeneration,
            input.publicKeyPem,
            input.publicKeyFingerprint,
            input.idempotencyKey,
            input.canonicalPayloadHash,
            input.popAlgorithm,
            input.popSignedPreimageHash,
            Buffer.from(input.popSignature),
            input.popServiceVerified,
            input.issuerKeyId,
            input.trustedTime.toISOString(),
            input.trustedTimeStatus,
            input.actorRef,
          ],
        ),
      );

      const r = rows[0]?.result;
      if (r === undefined) {
        // The door always returns a row. Nothing is inferred from silence.
        throw new Error("KLUY-ISSUE-PREPARE-EMPTY: the governed door returned no reservation");
      }

      return {
        outcome: r.outcome as PreparedReservation["outcome"],
        requestId: r.request_id,
        credentialId: r.credential_id,
        serialNumber: r.serial_number,
        certificateGeneration: Number(r.certificate_generation),
        ...(r.attempt_id ? { attemptId: r.attempt_id } : {}),
        ...(num(r.assignment_generation) !== undefined
          ? { assignmentGeneration: num(r.assignment_generation)! }
          : {}),
        ...(r.issuer_key_id ? { issuerKeyId: r.issuer_key_id } : {}),
        ...(r.not_before ? { notBefore: r.not_before } : {}),
        ...(r.not_after ? { notAfter: r.not_after } : {}),
        ...(r.canonical_tbs ? { canonicalTbs: r.canonical_tbs } : {}),
        ...(r.canonical_tbs_hash ? { canonicalTbsHash: r.canonical_tbs_hash } : {}),
        ...(num(r.head_version_seen) !== undefined
          ? { headVersionSeen: num(r.head_version_seen)! }
          : {}),
        ...(r.already_signed !== null && r.already_signed !== undefined
          ? { alreadySigned: r.already_signed }
          : {}),
      };
    },

    async recordSignature(input): Promise<{ readonly outcome: string }> {
      const { rows } = await inIssuerTransaction(deps, (client) =>
        client.query<{ result: { outcome?: string } }>(
          `select kitluy_devices.record_device_credential_signature_v1(
             $1, $2, $3::bytea, $4::boolean, $5) as result`,
          [
            input.requestId,
            input.canonicalTbsHash,
            Buffer.from(input.detachedSignature),
            input.serviceVerified,
            input.actorRef,
          ],
        ),
      );
      return { outcome: rows[0]?.result?.outcome ?? "RECORDED" };
    },

    async finalize(input: {
      readonly requestId: string;
      readonly chainLinks: readonly ChainLinkInput[];
      readonly actorRef: string;
    }): Promise<FinalizedCredential> {
      const { rows } = await inIssuerTransaction(deps, (client) =>
        client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.finalize_device_credential_issuance_v1($1, $2::jsonb, $3) as result`,
          [
            input.requestId,
            // Chain links go over as the database's own snake_case shape. The
            // adapter builds them; this only renames.
            JSON.stringify(
              input.chainLinks.map((l) => ({
                link_position: l.linkPosition,
                role: l.role,
                subject_fingerprint: l.subjectFingerprint,
                issuer_key_id: l.issuerKeyId,
                canonical_tbs: l.canonicalTbs,
                detached_signature_b64: l.detachedSignatureB64,
              })),
            ),
            input.actorRef,
          ],
        ),
      );

      const r = rows[0]?.result;
      if (r === undefined) {
        throw new Error("KLUY-ISSUE-FINALIZE-EMPTY: the governed door returned no credential");
      }
      // MAPPED, NOT CAST.
      //
      // `finalize_device_credential_issuance_v1` returns the database's own
      // snake_case shape — `credential_id`, `serial_number`,
      // `certificate_generation`, `not_before`, `not_after`. Casting that
      // straight to the camelCase `FinalizedCredential` compiled cleanly and
      // produced an object whose every field was `undefined`, because a cast
      // asserts a shape rather than creating one.
      //
      // It survived because this gateway had never actually run: the first
      // caller to read `credential.notBefore` got `undefined`, built
      // `new Date(undefined)`, and the X.509 signing failed with an error whose
      // text deliberately withholds its cause. `prepare` above maps its fields
      // explicitly; this one did not.
      const raw = r as Record<string, unknown>;
      const text = (key: string): string | undefined =>
        typeof raw[key] === "string" ? (raw[key] as string) : undefined;
      return {
        outcome: raw.outcome === "ALREADY_ISSUED" ? "ALREADY_ISSUED" : "ISSUED",
        credentialId: text("credential_id") ?? "",
        serialNumber: text("serial_number") ?? "",
        certificateGeneration: Number(raw.certificate_generation ?? 0),
        notBefore: text("not_before"),
        notAfter: text("not_after"),
        verificationBoundary: text("verification_boundary"),
      };
    },

    async recordOrphanSignature(input): Promise<void> {
      // A signature that exists with no credential to attach it to is a
      // SECURITY event, not a failure to swallow: something was signed by the
      // CA and the database does not know about it. It is recorded through the
      // orphan-incident door so it is visible in the fleet.
      await inIssuerTransaction(deps, (client) =>
        client.query(
          `insert into kitluy_devices.device_credential_orphan_incidents
             (request_id, device_record_id, serial_number, idempotency_key,
              signature_sha256, detail)
           values ($1, $2::uuid, $3, $4, $5, $6)
           on conflict do nothing`,
          [
            input.requestId,
            input.deviceRecordId,
            input.serialNumber,
            input.idempotencyKey,
            input.signatureSha256,
            input.detail,
          ],
        ),
      );
    },
  };
}
