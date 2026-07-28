/**
 * WS-10-T006 — signed cloud-to-Hub delivery, and provider payment outcomes.
 *
 * Authority: owner decision KLD-2026-07-28-001 Group 7 (KLREQ-027) and offline
 * contract §8.
 *
 * THE CANONICAL PATH, and the one that does not exist:
 *
 *   provider -> cloud connector / payment service -> SIGNED WS-10 DELIVERY -> Hub
 *   provider -------------------------------------X-------------------------> Hub
 *
 * The Hub has no inbound provider surface at all: `lan-api.ts` answers 405 to
 * every mutating verb, and the only way a provider outcome reaches business
 * truth is `applyProviderOutcomeDelivery` below, which requires a verified
 * inbox message. {@link assertNoDirectProviderCallback} makes that refusal
 * explicit and callable, so a future adapter that tries to shortcut the cloud
 * gets an error naming the decision rather than a mysterious 405.
 *
 * PROVIDER SECRETS STAY CLOUD-CONTROLLED. Nothing here verifies a provider
 * signature; that happened in the cloud, where the provider secret lives. The
 * Hub verifies the CLOUD's signature on the delivery.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../hub-database.js";
import type { HubClient } from "../db.js";
import { uuidv7 } from "../uuid.js";
import { SyncDeliveryError } from "./errors.js";

export type InboxState = "received" | "verified" | "applied" | "rejected" | "dead_letter";

export interface CloudMessage {
  readonly messageId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly messageType: string;
  readonly schemaVersion: number;
  readonly cloudSequence: bigint;
  readonly issuedAt: Date;
  readonly expiresAt: Date | null;
  readonly payload: Record<string, unknown>;
  readonly signature: Buffer;
  readonly signingKeyId: string;
}

export interface InboxAcceptance {
  readonly messageId: string;
  readonly outcome: "accepted" | "duplicate" | "rejected";
  /** For a duplicate: the ORIGINAL result, replayed rather than recomputed. */
  readonly originalResult?: Record<string, unknown> | null;
  readonly errorCode?: string;
}

/**
 * KLREQ-027, made executable. A provider adapter that reaches for the Hub
 * directly gets this, naming the decision and the path it must use instead.
 */
export function assertNoDirectProviderCallback(source: string): never {
  throw new SyncDeliveryError(
    "EDGE_PROVIDER_CALLBACK_DIRECT_REFUSED",
    `Direct provider-to-Hub callbacks are NOT authorized (KLD-2026-07-28-001 Group 7 / KLREQ-027). ` +
      `'${source}' must deliver through the cloud connector or payment service, which signs a WS-10 ` +
      "delivery the Hub verifies and projects locally.",
    { source },
  );
}

/**
 * Persist a cloud message BEFORE applying it (offline §8), and decide what
 * happens next.
 *
 * The order is the contract:
 *   1. a message already seen returns its ORIGINAL result — the delivery is
 *      answered with what happened the first time, not recomputed;
 *   2. an EXPIRED message is recorded as `rejected`, never silently skipped —
 *      "we quietly dropped it" and "it arrived too late" are different facts
 *      and the operator is entitled to the second;
 *   3. an unverifiable signature is recorded as `rejected` too, and the message
 *      body is still stored so the refusal is auditable;
 *   4. only a verified, unexpired, contiguous message becomes `verified`.
 */
export async function acceptCloudMessage(
  client: HubClient,
  message: CloudMessage,
  verify: (message: CloudMessage) => boolean,
  now: Date = new Date(),
): Promise<InboxAcceptance> {
  const existing = await client.query<{
    state: string;
    applied_result: Record<string, unknown> | null;
    error_code: string | null;
  }>(
    `select state::text, applied_result, error_code from edge_sync.inbox
      where message_id = $1
         or (location_id = $2 and cloud_sequence = $3::bigint)`,
    [message.messageId, message.locationId, message.cloudSequence.toString()],
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    return {
      messageId: message.messageId,
      outcome: row.state === "rejected" || row.state === "dead_letter" ? "rejected" : "duplicate",
      originalResult: row.applied_result,
      ...(row.error_code ? { errorCode: row.error_code } : {}),
    };
  }

  const payloadSha256 = createHash("sha256")
    .update(canonicalJson(message.payload), "utf8")
    .digest("hex");

  const expired = message.expiresAt !== null && message.expiresAt.getTime() <= now.getTime();
  const verified = !expired && verify(message);
  const errorCode = expired
    ? "EDGE_INBOX_MESSAGE_EXPIRED"
    : verified
      ? null
      : "EDGE_INBOX_SIGNATURE_INVALID";
  const state: InboxState = verified ? "verified" : "rejected";

  await client.query(
    `insert into edge_sync.inbox
       (message_id, tenant_id, digital_store_id, location_id, message_type, schema_version,
        cloud_sequence, issued_at, expires_at, payload_sha256, payload, signature,
        signing_key_id, state, received_at, verified_at, error_code)
     values ($1, $2, $3, $4, $5, $6, $7::bigint, $8, $9, $10, $11::jsonb, $12, $13,
             $14::edge_sync.inbox_state, now(), $15, $16)`,
    [
      message.messageId,
      message.tenantId,
      message.digitalStoreId,
      message.locationId,
      message.messageType,
      message.schemaVersion,
      message.cloudSequence.toString(),
      message.issuedAt,
      message.expiresAt,
      payloadSha256,
      JSON.stringify(message.payload),
      message.signature,
      message.signingKeyId,
      state,
      verified ? now : null,
      errorCode,
    ],
  );

  return verified
    ? { messageId: message.messageId, outcome: "accepted" }
    : { messageId: message.messageId, outcome: "rejected", errorCode: errorCode! };
}

/**
 * Mark a verified message applied and freeze the result it produced, so a
 * redelivery returns exactly this.
 */
export async function recordInboxApplied(
  client: HubClient,
  messageId: string,
  result: Record<string, unknown>,
): Promise<void> {
  const updated = await client.query(
    `update edge_sync.inbox
        set state = 'applied', applied_at = now(), applied_result = $2::jsonb
      where message_id = $1 and state = 'verified'`,
    [messageId, JSON.stringify(result)],
  );
  if (updated.rowCount === 0) {
    throw new SyncDeliveryError(
      "EDGE_INBOX_SIGNATURE_INVALID",
      `Message ${messageId} is not in the verified state; the Hub applies only what it verified (offline §8).`,
      { messageId },
    );
  }
}

/**
 * Contiguity check (offline §8 "applies in contiguous order").
 *
 * A gap means an earlier message has not arrived. Applying past it would
 * commit to a cloud ordering the Hub cannot reconstruct, so the delivery waits
 * rather than reordering itself.
 */
export async function assertContiguous(
  client: HubClient,
  locationId: string,
  streamCode: string,
  cloudSequence: bigint,
): Promise<void> {
  const cursor = await client.query<{ last_applied_cloud_sequence: bigint }>(
    `select last_applied_cloud_sequence from edge_sync.sync_cursor
      where location_id = $1 and stream_code = $2`,
    [locationId, streamCode],
  );
  const applied = cursor.rows[0]?.last_applied_cloud_sequence ?? 0n;
  if (cloudSequence !== applied + 1n) {
    throw new SyncDeliveryError(
      "EDGE_INBOX_SEQUENCE_GAP",
      `Cloud sequence ${cloudSequence} does not follow ${applied}; an earlier message has not arrived.`,
      { locationId, streamCode, expected: (applied + 1n).toString() },
    );
  }
}

// ---------------------------------------------------------------------------
// Provider payment outcomes (KLREQ-027).
// ---------------------------------------------------------------------------

export interface ProviderOutcome {
  readonly providerCode: string;
  /**
   * REQUIRED. A provider that supplies none needs a DOCUMENTED
   * provider-specific fallback; a generic silent one would merge two accounts
   * into a single dedupe space (KLREQ-027).
   */
  readonly providerAccountReference: string;
  readonly providerEventId: string;
  readonly providerTransactionId: string | null;
  readonly paymentId: string | null;
  readonly status: "SUCCEEDED" | "FAILED" | "EXPIRED";
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly currencyExponent: number;
}

export type ProviderOutcomeDecision = "accepted" | "duplicate" | "conflict";

/**
 * Digest of the FACTS a provider outcome asserts.
 *
 * Deliberately excludes the delivery envelope: two deliveries of the same
 * outcome must hash the same, or every redelivery would look like a
 * contradiction. Includes the amount, currency and status, because a
 * redelivery that changes any of those IS a contradiction.
 */
export function providerOutcomeDigest(outcome: ProviderOutcome): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        provider_code: outcome.providerCode,
        provider_account_reference: outcome.providerAccountReference,
        provider_event_id: outcome.providerEventId,
        provider_transaction_id: outcome.providerTransactionId,
        status: outcome.status,
        amount_minor: outcome.amountMinor.toString(),
        currency_code: outcome.currencyCode,
        currency_exponent: outcome.currencyExponent,
      }),
      "utf8",
    )
    .digest("hex");
}

export interface AcceptProviderOutcomeResult {
  readonly deliveryId: string;
  readonly decision: ProviderOutcomeDecision;
}

/**
 * Dedupe a provider outcome on the ruled triple.
 *
 * `accepted` — first sight; the caller applies the business effect.
 * `duplicate` — same triple, same facts; the caller applies NOTHING.
 * `conflict`  — same triple, DIFFERENT facts; the caller applies NOTHING, the
 *               original recording stands, and a `sync_conflict` now exists for
 *               governed reconciliation. Never a silent overwrite.
 */
export async function acceptProviderOutcome(
  client: HubClient,
  input: {
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly locationId: string;
    readonly inboxMessageId: string;
    readonly outcome: ProviderOutcome;
  },
): Promise<AcceptProviderOutcomeResult> {
  const { outcome } = input;
  if (!outcome.providerAccountReference.trim() || !outcome.providerEventId.trim()) {
    throw new SyncDeliveryError(
      "EDGE_PROVIDER_OUTCOME_CONFLICT",
      "A provider outcome needs both an account reference and an event id to be deduplicated " +
        "(KLREQ-027 allows documented provider-specific fallbacks, never a generic silent one).",
      { providerCode: outcome.providerCode },
    );
  }

  const deliveryId = uuidv7();
  const result = await client.query<{ accept_provider_outcome: ProviderOutcomeDecision }>(
    `select edge_sync.accept_provider_outcome(
              $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::text, $7::text, $8::text,
              $9::uuid, $10::text, $11::text, $12::bigint, $13::char(3), $14::smallint, $15::char(64))`,
    [
      deliveryId,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.inboxMessageId,
      outcome.providerCode,
      outcome.providerAccountReference,
      outcome.providerEventId,
      outcome.paymentId,
      outcome.providerTransactionId,
      outcome.status,
      outcome.amountMinor.toString(),
      outcome.currencyCode,
      outcome.currencyExponent,
      providerOutcomeDigest(outcome),
    ],
  );
  return { deliveryId, decision: result.rows[0]!.accept_provider_outcome };
}

export async function markProviderOutcomeApplied(
  client: HubClient,
  deliveryId: string,
): Promise<void> {
  await client.query(`select edge_sync.mark_provider_outcome_applied($1::uuid)`, [deliveryId]);
}

export interface ProviderOutcomeRow {
  readonly state: string;
  readonly outcomeStatus: string;
  readonly amountMinor: bigint;
  readonly conflictId: string | null;
}

export async function findProviderOutcome(
  client: HubClient,
  providerCode: string,
  providerAccountReference: string,
  providerEventId: string,
): Promise<ProviderOutcomeRow | undefined> {
  const result = await client.query<{
    state: string;
    outcome_status: string;
    amount_minor: bigint;
    conflict_id: string | null;
  }>(
    `select state, outcome_status, amount_minor, conflict_id
       from edge_sync.provider_outcome_delivery
      where provider_code = $1 and provider_account_reference = $2 and provider_event_id = $3`,
    [providerCode, providerAccountReference, providerEventId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    state: row.state,
    outcomeStatus: row.outcome_status,
    amountMinor: row.amount_minor,
    conflictId: row.conflict_id,
  };
}
