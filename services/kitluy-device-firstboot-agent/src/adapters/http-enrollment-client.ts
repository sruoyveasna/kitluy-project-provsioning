/**
 * The device-side transport for `/v1/device-enrollment`.
 *
 * Authority: KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2).
 *
 * ===========================================================================
 * THIS IS THE MISSING INJECTION, NOT A NEW STATE MACHINE
 * ===========================================================================
 * `runEnrollmentStep` in `../enrollment.ts` was built and tested long before
 * the endpoint existed, and its header records that when the endpoint arrives
 * "the change here is to inject a real `EnrollmentClient`… Nothing in this file
 * needs rewriting for that." That promise is kept: this module implements the
 * existing port and nothing in the state machine changed.
 *
 * ===========================================================================
 * WHAT LEAVES THE DEVICE, AND WHAT NEVER DOES
 * ===========================================================================
 * Leaves: the PUBLIC key, its fingerprint, hardware evidence signals, the
 * ticket REFERENCE, a digest of the ticket secret, and a signature.
 *
 * Never leaves: the private key, and the raw ticket secret. The secret is
 * hashed on this device and only the digest is transmitted — the server stores
 * a digest too, so the plaintext exists nowhere but the flashed file. Signing
 * happens inside `FileKeyProvider.signPayload`, which returns a signature and
 * has no path that returns a key.
 *
 * ===========================================================================
 * REFUSALS ARE NOT CRASHES
 * ===========================================================================
 * Every non-2xx maps to a `refused` result with a retryable flag. The agent
 * loop decides what to do; this transport never throws to express "the server
 * said no", because an exception on a routine refusal turns a policy decision
 * into a restart loop.
 */
import { createHash, createPublicKey } from "node:crypto";

import {
  ENROLLMENT_POP_PURPOSE,
  enrollmentPopChallengeBytes,
  type EnrollmentPopChallengeFields,
} from "../enrollment-pop-bytes.js";
import type {
  AssignmentPollResult,
  DeviceClass,
  EnrollmentClient,
  EnrollmentResult,
  HeartbeatResult,
} from "../enrollment.js";

/** What the device must be able to do with its key, without holding it. */
export interface DeviceSigner {
  signPayload(privateKeyHandle: string, payload: Uint8Array): Promise<Uint8Array>;
}

export interface HttpEnrollmentClientOptions {
  /** Base URL of the device-registry service, e.g. `https://…`. No trailing slash. */
  readonly baseUrl: string;
  /** Opaque handle the signer understands. Never key material. */
  readonly privateKeyHandle: string;
  readonly signer: DeviceSigner;
  /** The one-time flash-time ticket, read from TICKET_PATH. */
  readonly ticketReference: string;
  readonly ticketSecret: string;
  readonly environment: string;
  /** Injectable for tests; the global `fetch` otherwise. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

interface ChallengeResponse {
  readonly challenge: {
    readonly challengeId: string;
    readonly purpose: string;
    readonly environment: string;
    readonly presentedKeyFingerprint: string;
    readonly nonce: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
  };
}

interface RedemptionResponse {
  readonly deviceRecordId: string;
  readonly fleetEnrollment: string;
  readonly storeAssignment: string;
  readonly trustedTimeToken?: unknown;
}

/** SHA-256 of the SPKI DER, matching what the server records. */
export function fingerprintFromPem(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(new Uint8Array(der)).digest("hex");
}

function refused(code: string, retryable: boolean): EnrollmentResult {
  return { kind: "refused", code, retryable };
}

/**
 * Retryable when the fault is plausibly transient. A 4xx refusal from the
 * enrollment surface is a decision — retrying it is how a device turns a bad
 * ticket into a denial-of-service against its own fleet.
 */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function createHttpEnrollmentClient(options: HttpEnrollmentClientOptions): EnrollmentClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const ticketDigest = createHash("sha256").update(options.ticketSecret, "utf8").digest("hex");

  async function post(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(`${options.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let json: unknown = undefined;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      return { status: response.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async enroll(input: {
      readonly publicKeyPem: string;
      readonly deviceClass: DeviceClass;
      readonly hardwareSignals: Readonly<Record<string, string | undefined>>;
    }): Promise<EnrollmentResult> {
      const fingerprint = fingerprintFromPem(input.publicKeyPem);

      // --- 1. Challenge -------------------------------------------------
      let challengeBody: ChallengeResponse;
      try {
        const { status, json } = await post("/v1/device-enrollment/challenges", {
          ticketReference: options.ticketReference,
          ticketDigest,
          publicKeyFingerprint: fingerprint,
          publicKeyPem: input.publicKeyPem,
          publicKeyAlgorithm: "ed25519",
          keyStorageClass: "software",
        });
        if (status !== 201) {
          return refused(`ENROLLMENT_CHALLENGE_${status}`, isRetryableStatus(status));
        }
        challengeBody = json as ChallengeResponse;
      } catch {
        // Network-level failure: the endpoint may simply be unreachable from a
        // Store network that is still coming up. Retryable by definition.
        return refused("ENROLLMENT_CHALLENGE_UNREACHABLE", true);
      }

      const c = challengeBody.challenge;
      if (c === undefined || typeof c.challengeId !== "string") {
        return refused("ENROLLMENT_CHALLENGE_MALFORMED", false);
      }

      // --- 2. Prove possession -----------------------------------------
      // The bytes come from `enrollment-pop-bytes.ts`, the image-shippable
      // copy of the canonicalizer. It is proven byte-identical to the
      // authoritative one by `test/enrollment-pop-drift.test.ts` — see that
      // module's header for why a copy exists at all.
      const challenge: EnrollmentPopChallengeFields = {
        challengeId: c.challengeId,
        purpose: ENROLLMENT_POP_PURPOSE,
        environment: c.environment,
        presentedKeyFingerprint: c.presentedKeyFingerprint,
        nonce: c.nonce,
        issuedAt: new Date(c.issuedAt),
        expiresAt: new Date(c.expiresAt),
      };

      let signature: Uint8Array;
      try {
        signature = await options.signer.signPayload(
          options.privateKeyHandle,
          enrollmentPopChallengeBytes(challenge),
        );
      } catch {
        // The key is unusable. Not retryable over the network — the device
        // needs to re-key, which is firstboot's job, not this transport's.
        return refused("ENROLLMENT_SIGNING_FAILED", false);
      }

      // --- 3. Redeem ----------------------------------------------------
      const signals = Object.entries(input.hardwareSignals)
        .filter(([, value]) => typeof value === "string" && value.length > 0)
        .map(([signal_type, signal_value]) => ({ signal_type, signal_value }));

      try {
        const { status, json } = await post("/v1/device-enrollment/redemptions", {
          challengeId: challenge.challengeId,
          signature: Buffer.from(signature).toString("base64url"),
          publicKeyPem: input.publicKeyPem,
          assetTag: `KL-${fingerprint.slice(0, 12).toUpperCase()}`,
          nonce: challenge.nonce,
          presentedKeyFingerprint: challenge.presentedKeyFingerprint,
          issuedAt: challenge.issuedAt.toISOString(),
          expiresAt: challenge.expiresAt.toISOString(),
          signals,
        });
        if (status !== 201) {
          return refused(`ENROLLMENT_REDEMPTION_${status}`, isRetryableStatus(status));
        }
        const body = json as RedemptionResponse;
        if (typeof body?.deviceRecordId !== "string") {
          return refused("ENROLLMENT_REDEMPTION_MALFORMED", false);
        }
        return { kind: "enrolled", deviceRecordId: body.deviceRecordId };
      } catch {
        // The redemption may in fact have COMMITTED before the connection
        // dropped. `already_enrolled` is not claimed here, because this device
        // cannot know that — it reports a retryable refusal and the ticket's
        // single-use guarantee makes the retry safe to refuse server-side.
        return refused("ENROLLMENT_REDEMPTION_UNREACHABLE", true);
      }
    },

    heartbeat(): Promise<HeartbeatResult> {
      // The heartbeat route is not built yet. Reporting a retryable refusal is
      // the honest answer: it keeps the agent looping without inventing a
      // success it cannot observe.
      return Promise.resolve({
        kind: "refused",
        code: "HEARTBEAT_NOT_IMPLEMENTED",
        retryable: true,
      });
    },

    pollAssignment(): Promise<AssignmentPollResult> {
      // Assignment belongs to Store pairing, which is a later lifecycle stage.
      // A freshly enrolled device is UNASSIGNED and that is the correct answer.
      return Promise.resolve({ kind: "unassigned" });
    },
  };
}
