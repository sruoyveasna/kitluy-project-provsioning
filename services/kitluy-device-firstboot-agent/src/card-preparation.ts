/**
 * FLASH-TIME CARD PREPARATION — the KitLuy "front desk".
 *
 * Authority: KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2), §5 ticket
 * properties, §7 development-versus-production custody.
 *
 * ===========================================================================
 * WHAT THIS IS FOR
 * ===========================================================================
 * The golden image is identical on every unit and carries no secret, so the
 * image cannot be what makes a device legitimate. This step is: after a card
 * has been flashed, exactly one per-device, single-use ticket is issued and
 * written onto it. §2 — "the flashing step IS the station".
 *
 * Until this module existed the step was performed by hand, against the
 * governed door, by whoever happened to know the SQL. That is not a process a
 * workshop can run, and it is the last gap in the enrollment chain.
 *
 * ===========================================================================
 * THE SECRET'S ENTIRE LIFETIME
 * ===========================================================================
 * Generated here -> hashed -> the DIGEST goes to the database -> the SECRET is
 * written to the card -> dropped. It is deliberately absent from
 * `PrepareCardResult`, so no caller can log it by printing an outcome, and it
 * is never returned, thrown or embedded in a refusal detail.
 *
 * ===========================================================================
 * ORDERING, AND WHY A FAILED WRITE IS LOUD
 * ===========================================================================
 * The ticket is issued BEFORE the card is written, because a card carrying a
 * secret the server never recorded is a card that silently fails at first boot
 * with nothing to diagnose. The reverse ordering — write, then issue — cannot
 * fail safely.
 *
 * The cost is that a write failure leaves a LIVE ticket nobody holds. That is
 * reported as `WRITE_FAILED_TICKET_LIVE` with the reference, so an operator can
 * revoke it, rather than being folded into a generic error. §5 requires tickets
 * to be revocable precisely for this case.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  issueEnrollmentTicket,
  type DatabaseHandle,
  type EnrollmentTicketResult,
} from "./factory-gateway.js";

/**
 * Where the device's bootstrap agent looks, relative to the card root.
 * `enrollment-bootstrap.ts` reads the absolute form as `TICKET_PATH`; this is
 * the same location expressed against a mounted card.
 */
export const TICKET_RELATIVE_PATH = "var/lib/kitluy/enrollment/ticket";

/** 168 hours (7 days): a card prepared on a Monday is still usable that week. */
export const DEFAULT_TICKET_VALIDITY_HOURS = 168;

export interface TicketMaterial {
  readonly reference: string;
  readonly secret: string;
  readonly digest: string;
}

/**
 * Reference and secret for one card.
 *
 * The reference is a human-legible handle an operator can read back over the
 * phone; the secret is 32 random bytes and is never meant to be read by anyone.
 * They are separate values because the reference is used to REVOKE a ticket,
 * which must be possible without holding the secret.
 */
export function generateTicketMaterial(
  randomId: () => string = randomUUID,
  randomSecret: () => Buffer = () => randomBytes(32),
): TicketMaterial {
  const reference = `KL-TKT-${randomId().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const secret = randomSecret().toString("base64url");
  const digest = createHash("sha256").update(secret, "utf8").digest("hex");
  return { reference, secret, digest };
}

/**
 * The exact bytes the device parses. `enrollment-bootstrap.ts` reads
 * `reference=` and `secret=` line-wise, so the format is fixed by that reader
 * and is not a free choice here.
 */
export function ticketFileContents(reference: string, secret: string): string {
  return `reference=${reference}\nsecret=${secret}\n`;
}

/** Filesystem port. Injected so preparation is testable without a real card. */
export interface CardFilesystem {
  /** True when the path exists and is a directory. */
  isDirectory(path: string): boolean;
  /** Creates the ticket's parent directory, 0700. */
  makeTicketDirectory(path: string): void;
  /** Writes the ticket, 0600, replacing any existing one. */
  writeTicket(path: string, contents: string): void;
}

export interface PrepareCardRequest {
  /** Mount point of the flashed card's root filesystem. */
  readonly cardRoot: string;
  /**
   * Resolved by the caller BEFORE it drops into the issuance role — reading the
   * profile catalogue and minting a credential are separate privileges. See
   * `resolveHardwareProfileId`.
   */
  readonly hardwareProfileId: string;
  readonly environment: string;
  readonly enrollmentStationKey: string;
  readonly enrollmentOperatorRef: string;
  readonly issuedByOperatorRef: string;
  readonly validForHours?: number;
  readonly enrollmentBatchRef?: string;
}

export type PrepareCardResult =
  | {
      readonly kind: "prepared";
      readonly ticketReference: string;
      readonly environment: string;
      readonly expiresAt: string;
      readonly ticketPath: string;
    }
  | {
      readonly kind: "refused";
      readonly code: string;
      readonly detail: string;
    }
  | {
      /**
       * The ticket EXISTS but the card does not have it. Distinct from
       * `refused` because it leaves state behind that an operator must act on.
       */
      readonly kind: "write_failed";
      readonly code: "WRITE_FAILED_TICKET_LIVE";
      readonly ticketReference: string;
      readonly detail: string;
    };

export interface PrepareCardDeps {
  readonly db: DatabaseHandle;
  readonly fs: CardFilesystem;
  readonly material?: () => TicketMaterial;
}

function joinCardPath(cardRoot: string, relative: string): string {
  return `${cardRoot.replace(/\/+$/, "")}/${relative}`;
}

/**
 * Prepare one flashed card.
 *
 * Refuses BEFORE issuing when the card is not present: issuing a ticket that
 * could never be written spends a single-use credential for nothing, and §5
 * makes tickets expiring and revocable rather than free.
 */
export async function prepareCard(
  deps: PrepareCardDeps,
  request: PrepareCardRequest,
): Promise<PrepareCardResult> {
  if (!deps.fs.isDirectory(request.cardRoot)) {
    return {
      kind: "refused",
      code: "KLUY-CARD-ROOT-ABSENT",
      detail: `no mounted card at ${request.cardRoot}`,
    };
  }

  const material = (deps.material ?? generateTicketMaterial)();

  const issued: EnrollmentTicketResult = await issueEnrollmentTicket(deps.db, {
    ticketReference: material.reference,
    ticketDigest: material.digest,
    hardwareProfileId: request.hardwareProfileId,
    environment: request.environment,
    enrollmentStationKey: request.enrollmentStationKey,
    enrollmentOperatorRef: request.enrollmentOperatorRef,
    issuedByOperatorRef: request.issuedByOperatorRef,
    validForHours: request.validForHours ?? DEFAULT_TICKET_VALIDITY_HOURS,
    ...(request.enrollmentBatchRef === undefined
      ? {}
      : { enrollmentBatchRef: request.enrollmentBatchRef }),
  });

  if (issued.kind === "refused") {
    // Nothing was written, so nothing must be cleaned up.
    return { kind: "refused", code: issued.code, detail: issued.detail };
  }

  const ticketPath = joinCardPath(request.cardRoot, TICKET_RELATIVE_PATH);
  try {
    deps.fs.makeTicketDirectory(ticketPath.slice(0, ticketPath.lastIndexOf("/")));
    deps.fs.writeTicket(ticketPath, ticketFileContents(material.reference, material.secret));
  } catch (error) {
    return {
      kind: "write_failed",
      code: "WRITE_FAILED_TICKET_LIVE",
      ticketReference: issued.ticketReference,
      // The message may name a path; it can never name the secret, which is
      // not a parameter of anything the filesystem port was given except the
      // file body itself.
      detail: error instanceof Error ? error.message : "the ticket could not be written",
    };
  }

  return {
    kind: "prepared",
    ticketReference: issued.ticketReference,
    environment: issued.environment,
    expiresAt: issued.expiresAt,
    ticketPath,
  };
}
