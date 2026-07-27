/**
 * Finance-subledger bridge (WS-08-T004).
 *
 * All journal writes go through kitluy_finance.post_journal_entry_v1 — the
 * ONLY journal write path (Amendment-001 AMD-I2); direct INSERT is revoked
 * even for service_role. Account codes here are the clearly fictional DEV-*
 * development chart (mechanism proof only — the canonical chart of accounts
 * is open owner value FIN-OD-001; engine account names are seed candidates
 * per Amendment-001 §8). No statutory accounting treatment is implied.
 */
import type pg from "pg";

export type PostingDirection = "DEBIT" | "CREDIT";

export interface JournalLeg {
  readonly accountCode: string;
  readonly direction: PostingDirection;
  readonly amountMinor: bigint;
  readonly memo?: string;
}

export interface PostJournalCommand {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId?: string;
  readonly businessDate: string; // ISO date (yyyy-mm-dd)
  readonly entryType: string;
  readonly postingRuleKey: string;
  readonly postingRuleVersion?: string;
  readonly sourceType:
    | "ORDER"
    | "ORDER_ADJUSTMENT"
    | "TENDER"
    | "REFUND"
    | "VOID"
    | "SETTLEMENT_REF"
    | "PAYMENT_RECONCILIATION"
    | "PAYMENT_RECONCILIATION_LINE";
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly currency: "KHR" | "USD";
  readonly description?: string;
  readonly actorUserId?: string;
  readonly actorServiceKey?: string;
  readonly idempotencyKey: string;
  readonly legs: readonly JournalLeg[];
  readonly reversesJournalEntryId?: string;
}

export interface PostJournalResult {
  readonly replayed: boolean;
  readonly journalEntryId: string;
}

export class FinancePostingError extends Error {
  constructor(
    readonly code: "ACCOUNT_NOT_FOUND" | "POSTING_REJECTED",
    message: string,
  ) {
    super(message);
    this.name = "FinancePostingError";
  }
}

async function accountIdByCode(
  client: pg.PoolClient,
  tenantId: string,
  accountCode: string,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `select id from kitluy_finance.subledger_accounts
      where tenant_id = $1 and account_code = $2 and status = 'ACTIVE'
      order by digital_store_id nulls last limit 1`,
    [tenantId, accountCode],
  );
  const row = result.rows[0];
  if (!row) {
    throw new FinancePostingError(
      "ACCOUNT_NOT_FOUND",
      `No ACTIVE subledger account ${accountCode} for tenant ${tenantId} (dev chart is fixture-seeded; canonical chart is FIN-OD-001).`,
    );
  }
  return row.id;
}

/** Post one balanced journal entry through the governed RPC. */
export async function postJournalEntry(
  client: pg.PoolClient,
  cmd: PostJournalCommand,
): Promise<PostJournalResult> {
  const legs = [] as Array<Record<string, unknown>>;
  let lineNo = 0;
  for (const leg of cmd.legs) {
    lineNo += 1;
    legs.push({
      line_no: lineNo,
      subledger_account_id: await accountIdByCode(client, cmd.tenantId, leg.accountCode),
      direction: leg.direction,
      // Serialized as a decimal string: JSON numbers pass through IEEE-754 in
      // JS, and money never touches binary floating point (contract §4). The
      // RPC casts (leg->>'amount_minor')::bigint from the string exactly.
      amount_minor: leg.amountMinor.toString(),
      memo: leg.memo ?? null,
    });
  }
  const result = await client.query<{ post_journal_entry_v1: unknown }>(
    `select kitluy_finance.post_journal_entry_v1(
       $1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11::char(3), $12, $13,
       $14, $15, $16, $17::jsonb, $18, $19
     ) as post_journal_entry_v1`,
    [
      cmd.tenantId,
      cmd.digitalStoreId,
      cmd.storeLocationId ?? null,
      cmd.businessDate,
      cmd.entryType,
      cmd.postingRuleKey,
      cmd.postingRuleVersion ?? null,
      cmd.sourceType,
      cmd.sourceId,
      cmd.sourceHash,
      cmd.currency,
      null,
      cmd.description ?? null,
      cmd.actorUserId ?? null,
      cmd.actorServiceKey ?? null,
      cmd.idempotencyKey,
      JSON.stringify(legs),
      cmd.reversesJournalEntryId ?? null,
      null,
    ],
  );
  const payload = result.rows[0]?.post_journal_entry_v1 as
    { replayed: boolean; journal_entry_id: string } | undefined;
  if (!payload) {
    throw new FinancePostingError("POSTING_REJECTED", "post_journal_entry_v1 returned no result");
  }
  return { replayed: payload.replayed, journalEntryId: payload.journal_entry_id };
}
