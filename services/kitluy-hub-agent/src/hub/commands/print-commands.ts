/**
 * Print queue and receipt issuance (schema contract §6.6, §7; offline §11).
 *
 * Printing is a LOCAL capability: the job commits with its business
 * transaction and NEVER waits on the WAN. A retry reuses the SAME job id and
 * suppression key; an intentional reprint is a NEW job with a NEW key (§11.2).
 *
 * This is a Hub-internal service operation with no approved Edge route and no
 * actor-facing RBAC key, so it is NOT exposed as a terminal command: it is
 * invoked by the Hub print service after a business command has committed, or
 * inside one. It therefore carries no permission dimension of its own —
 * recorded, not stubbed.
 */
import type { HubClient, HubPool } from "../db.js";
import { withHubTransaction } from "../db.js";
import { HubCommandError } from "../errors.js";
import { configRepo, documentsRepo } from "../repositories/index.js";
import { uuidv7 } from "../uuid.js";

export interface EnqueueReceiptPrintInput {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly documentType: string;
  readonly documentId: string;
  readonly templateVersion: bigint;
  readonly payloadSha256: string;
  readonly createdBy: string;
  readonly terminalDeviceId: string;
  readonly copies?: number;
  readonly copyIndex?: number;
  readonly logicalRole?: string;
}

/** Queue a print job against the Location's configured printer binding. */
export async function enqueueReceiptPrint(
  client: HubClient,
  input: EnqueueReceiptPrintInput,
): Promise<string> {
  const binding = await configRepo.findPeripheralBinding(
    client,
    input.locationId,
    input.logicalRole ?? "receipt_printer",
  );
  if (!binding) {
    throw new HubCommandError(
      "EDGE_CONFIGURATION_MISSING",
      `Location ${input.locationId} has no enabled '${input.logicalRole ?? "receipt_printer"}' peripheral binding.`,
      { locationId: input.locationId },
    );
  }
  return documentsRepo.enqueuePrintJob(client, {
    id: uuidv7(),
    tenantId: input.tenantId,
    digitalStoreId: input.digitalStoreId,
    locationId: input.locationId,
    documentType: input.documentType,
    documentId: input.documentId,
    printerBindingId: binding.id,
    templateVersion: input.templateVersion,
    payloadSha256: input.payloadSha256,
    copies: input.copies ?? 1,
    copyIndex: input.copyIndex ?? 1,
    priority: 0,
    createdBy: input.createdBy,
    terminalDeviceId: input.terminalDeviceId,
  });
}

/** Standalone variant for the Hub print service (its own transaction). */
export async function queueReceiptPrint(
  pool: HubPool,
  input: EnqueueReceiptPrintInput,
): Promise<string> {
  return withHubTransaction(pool, async (client) => enqueueReceiptPrint(client, input));
}
