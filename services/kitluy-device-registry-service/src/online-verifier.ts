/**
 * The ONLINE credential verifier — the production caller of the revocation
 * lookup.
 *
 * Authority: KLD-2026-07-28-002 §6.1; WS-11-T003 Step 4 final remediation §3
 * ("wire loadRevocations into the actual credential verification path... do not
 * leave the lookup as an exported but unused package function"); migration group
 * 0155.
 *
 * ===========================================================================
 * THE HOLE THIS CLOSES
 * ===========================================================================
 * Phase D found that a fully governed, four-eyes, append-only revocation did not
 * stop the credential authenticating: the write side was complete, the verifier
 * was complete, and NOTHING JOINED THEM. Phase D shipped `loadRevocations` to
 * close the online half — and then that function had no caller either, so the
 * join existed as a library capability rather than as behaviour.
 *
 * This module is the join. Every fact the validity evaluation consumes is read
 * from the authoritative database through the group 0155 definer bridges:
 *
 *   * the REVOCATION SET, so a revoked serial is refused;
 *   * the CURRENT head generation and fingerprint, so a superseded credential
 *     cannot pass by asserting it is current;
 *   * the PERMITTED OVERLAP including the previous credential's persisted state,
 *     so a spent overlap cannot be kept alive by a caller that keeps passing it.
 *
 * The presenter supplies only what it legitimately owns: the certificate chain it
 * is presenting, and this verifier's own trust anchors and trusted-time
 * evaluation. It asserts none of its own status.
 *
 * ===========================================================================
 * WHY REVOCATION IS NOT CHECKED HERE
 * ===========================================================================
 * It would be easy to read `revoked` from the verification-state bridge and
 * return early. That is deliberately NOT done: `evaluateCertificateValidity` is
 * the governed consumer, it checks revocation BEFORE expiry so a revoked
 * credential is never merely reported as "expired", and a second revocation check
 * in this file would be a second place for the rule to drift. The bridge's
 * `revoked` flag is used only as a cross-check assertion in the tests.
 */
import {
  evaluateCertificateValidity,
  loadRevocationsViaGovernedBridge,
  type CertificateChain,
  type CertificateValidity,
  type CredentialOverlap,
  type TrustedTimeEvaluation,
  type TrustEnvironment,
} from "@kitluy/device-identity";
import type { PoolClient } from "pg";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";
import { throwRedacted } from "./revocation-failures.js";

/** What a presenter supplies. Note the absence of any self-reported status. */
export interface OnlineVerificationRequest {
  /** root -> intermediate -> device, as presented. Verified, never trusted. */
  readonly chain: CertificateChain;
  readonly trustedTime: TrustedTimeEvaluation;
  readonly environment: TrustEnvironment;
  readonly trustedRootFingerprints: readonly string[];
}

export type OnlineVerificationOutcome =
  | { readonly known: true; readonly validity: CertificateValidity }
  /**
   * The presented serial is not in the authoritative database at all.
   *
   * A distinct outcome rather than a `CertificateValidity` rejection, because
   * "this credential was never issued here" and "this credential was issued and
   * is invalid" are different facts, and only the second one has a generation,
   * head and overlap to reason about.
   */
  | { readonly known: false; readonly reason: "CREDENTIAL_NOT_ISSUED_HERE" };

export interface OnlineCredentialVerifier {
  verify(request: OnlineVerificationRequest): Promise<OnlineVerificationOutcome>;
}

interface VerificationState {
  readonly deviceRecordId: string;
  readonly certificateGeneration: number;
  readonly currentGeneration: number | null;
  readonly currentKeyFingerprint: string | null;
  readonly previousGeneration: number | null;
  readonly previousKeyFingerprint: string | null;
  readonly previousCredentialState: string | null;
  readonly overlapEndsAt: string | null;
  /** The PRESENTED credential's own stored fingerprint, read from the database. */
  readonly publicKeyFingerprint: string | null;
  readonly revoked: boolean;
}

function readState(raw: unknown): VerificationState | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const deviceRecordId = row.device_record_id;
  if (typeof deviceRecordId !== "string" || deviceRecordId === "") return null;
  const int = (key: string): number | null => {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "bigint") return Number(value);
    return null;
  };
  const text = (key: string): string | null => {
    const value = row[key];
    return typeof value === "string" && value !== "" ? value : null;
  };
  return {
    deviceRecordId,
    certificateGeneration: int("certificate_generation") ?? 0,
    currentGeneration: int("current_generation"),
    currentKeyFingerprint: text("current_key_fingerprint"),
    previousGeneration: int("previous_generation"),
    previousKeyFingerprint: text("previous_key_fingerprint"),
    previousCredentialState: text("previous_credential_state"),
    overlapEndsAt: text("overlap_ends_at"),
    publicKeyFingerprint: text("public_key_fingerprint"),
    revoked: row.revoked === true,
  };
}

/**
 * Builds the permitted overlap ONLY when the database supplied every fact it
 * requires.
 *
 * A partial overlap is no overlap. `previousCredentialState` is required by
 * `CredentialOverlap` for a reason — an overlap whose previous credential has
 * been superseded is spent — so if any field is absent the overlap is omitted and
 * the verifier falls back to admitting the current generation only. Omission is
 * the strict direction.
 */
function overlapFrom(state: VerificationState): CredentialOverlap | undefined {
  if (
    state.previousGeneration === null ||
    state.previousKeyFingerprint === null ||
    state.previousCredentialState === null ||
    state.overlapEndsAt === null
  ) {
    return undefined;
  }
  return {
    previousGeneration: state.previousGeneration,
    previousKeyFingerprint: state.previousKeyFingerprint,
    overlapEndsAt: new Date(state.overlapEndsAt),
    previousCredentialState: state.previousCredentialState,
  };
}

/**
 * Builds the production online verifier.
 *
 * Runs as `kitluy_issuance_service`, which holds EXECUTE on the group 0155
 * bridges and SELECT on nothing — so this verifier reads exactly the facts it
 * needs and cannot enumerate credential inventory. It is NOT `service_role`; see
 * the note in `pg-revocation-lookup.ts` on why global BYPASSRLS was refused here.
 */
export function createOnlineCredentialVerifier(source: ClientSource): OnlineCredentialVerifier {
  return {
    async verify(request: OnlineVerificationRequest): Promise<OnlineVerificationOutcome> {
      const serial = request.chain.device.tbs.serialNumber;
      try {
        return await withServiceRole(source, REGISTRY_ROLES.issuance, async (client) => {
          const state = await loadState(client, serial, request.environment);
          if (state === null) {
            return { known: false, reason: "CREDENTIAL_NOT_ISSUED_HERE" };
          }
          // Hoisted so the narrowing is visible to the type system as well as to a
          // reader: this refusal is the ONLY thing standing between an absent
          // database fact and the presenter's own value.
          const authoritativeFingerprint =
            state.currentKeyFingerprint ?? state.publicKeyFingerprint;
          if (authoritativeFingerprint === null) {
            // Neither the head nor the credential row yielded a fingerprint. There
            // is no database fact to compare against, and the one thing that must
            // NOT happen is substituting the presenter's own value — so this is a
            // refusal, not a fallback.
            return { known: false, reason: "CREDENTIAL_NOT_ISSUED_HERE" };
          }

          // THE JOIN. The revocation set comes from the authoritative tables
          // through the governed bridge, in the same transaction as the state
          // read, so the verifier cannot see a head that has advanced past a
          // revocation it has not yet been told about.
          const revocations = await loadRevocationsViaGovernedBridge(client, {
            environment: request.environment,
            deviceRecordId: state.deviceRecordId,
          });

          const validity = evaluateCertificateValidity({
            chain: request.chain,
            trustedTime: request.trustedTime,
            environment: request.environment,
            deviceRecordId: state.deviceRecordId,
            // From the HEAD, not from the presented certificate. When the head
            // has no row yet, the presented generation is the only generation, so
            // it is its own current — but the fingerprint still comes from the
            // stored credential rather than the presentation.
            // FROM THE DATABASE, NEVER FROM THE PRESENTER.
            //
            // This previously fell back to `request.chain.device.tbs.subjectFingerprint`
            // under a comment claiming the fingerprint came from the stored
            // credential. It did not. `evaluateCertificateValidity` checks
            // `tbs.subjectFingerprint === currentKeyFingerprint`, so when the head
            // row was absent the comparison became `x === x`,
            // CERT_KEY_FINGERPRINT_MISMATCH became unreachable, and a credential
            // attesting to a key the device no longer holds would be admitted.
            //
            // The stored value was available all along: the group 0155 bridge
            // returns `public_key_fingerprint` for the presented serial and
            // `readState` never read it. It does now, so when the head is unknown
            // the credential's OWN stored fingerprint is used — still a database
            // fact rather than the presentation.
            currentKeyFingerprint: authoritativeFingerprint,
            currentCertificateGeneration: state.currentGeneration ?? state.certificateGeneration,
            revocations,
            trustedRootFingerprints: request.trustedRootFingerprints,
            permittedOverlap: overlapFrom(state),
          });
          return { known: true, validity };
        });
      } catch (error) {
        throwRedacted(error, "online_credential_verification");
      }
    },
  };
}

async function loadState(
  client: PoolClient,
  serialNumber: string,
  environment: string,
): Promise<VerificationState | null> {
  const { rows } = await client.query<{ result: unknown }>(
    `select kitluy_devices.credential_verification_state_v1($1::text, $2::text) as result`,
    [serialNumber, environment],
  );
  const raw = rows[0]?.result;
  if (raw === null || raw === undefined) return null;
  return readState(raw);
}
