/**
 * `edge_documents` repository adapters (schema contract §6.6, §7).
 *
 * Print duplicate suppression is the offline contract §11.1 key
 * `print1.{document_id}.{document_version}.{printer_binding_id}.{copy_index}`,
 * CHECKed by the DDL. A RETRY reuses the same job id and key; an intentional
 * REPRINT is a NEW job id with a NEW key (§11.2) — the two are never conflated.
 */
import type { HubClient } from "../db.js";

export function buildSuppressionKey(
  documentId: string,
  documentVersion: bigint | number,
  printerBindingId: string,
  copyIndex: number,
): string {
  return `print1.${documentId}.${documentVersion.toString()}.${printerBindingId}.${copyIndex}`;
}

export interface InsertReceiptInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly bookingId: string;
  readonly paymentId: string | null;
  readonly receiptNumber: string;
  readonly documentType: string;
  readonly templateVersion: bigint;
  readonly contentSha256: string;
  readonly issuedBy: string;
  readonly eventId: string;
}

export async function insertReceipt(client: HubClient, input: InsertReceiptInput): Promise<void> {
  await client.query(
    `insert into edge_documents.receipt
       (id, tenant_id, digital_store_id, location_id, booking_id, payment_id,
        receipt_number, document_type, template_version, content_sha256, issued_at,
        issued_by, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.bookingId,
      input.paymentId,
      input.receiptNumber,
      input.documentType,
      input.templateVersion.toString(),
      input.contentSha256,
      input.issuedBy,
      input.eventId,
    ],
  );
}

export interface PrintJobRow {
  id: string;
  document_type: string;
  document_id: string;
  printer_binding_id: string;
  payload_sha256: string;
  duplicate_suppression_key: string;
  state: string;
  attempt_count: number;
}

export async function findPrintJobBySuppressionKey(
  client: HubClient,
  suppressionKey: string,
): Promise<PrintJobRow | undefined> {
  const result = await client.query<PrintJobRow>(
    `select id, document_type, document_id, printer_binding_id, payload_sha256,
            duplicate_suppression_key, state, attempt_count
       from edge_documents.print_job where duplicate_suppression_key = $1`,
    [suppressionKey],
  );
  return result.rows[0];
}

export interface EnqueuePrintJobInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly documentType: string;
  readonly documentId: string;
  readonly printerBindingId: string;
  readonly templateVersion: bigint;
  readonly payloadSha256: string;
  readonly copies: number;
  readonly copyIndex: number;
  readonly priority: number;
  readonly createdBy: string;
  readonly terminalDeviceId: string;
}

/**
 * Durable, deduplicated print job (§6.6, §7). Printing is a LOCAL capability:
 * the queue commits with the business transaction and never waits on the WAN.
 */
export async function enqueuePrintJob(
  client: HubClient,
  input: EnqueuePrintJobInput,
): Promise<string> {
  const suppressionKey = buildSuppressionKey(
    input.documentId,
    input.templateVersion,
    input.printerBindingId,
    input.copyIndex,
  );
  const existing = await findPrintJobBySuppressionKey(client, suppressionKey);
  if (existing) return existing.id;

  await client.query(
    `insert into edge_documents.print_job
       (id, tenant_id, digital_store_id, location_id, document_type, document_id,
        printer_binding_id, template_version, payload_sha256, copies,
        duplicate_suppression_key, state, priority, created_at, next_attempt_at,
        attempt_count, created_by, terminal_device_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
             'queued'::edge_documents.print_state, $12, now(), now(), 0, $13, $14)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.documentType,
      input.documentId,
      input.printerBindingId,
      input.templateVersion.toString(),
      input.payloadSha256,
      input.copies,
      suppressionKey,
      input.priority,
      input.createdBy,
      input.terminalDeviceId,
    ],
  );
  return input.id;
}

export async function countQueuedPrintJobs(client: HubClient, locationId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from edge_documents.print_job
      where location_id = $1 and state = 'queued'`,
    [locationId],
  );
  return Number(result.rows[0]?.count ?? "0");
}
