/**
 * Verified, encrypted terminal-local pairing-receipt persistence —
 * WS-11-T004-P04C2.
 *
 * Authority: the P04C owner package §18-§19; pairing protocol §9 (the
 * Hub-signed receipt) and §11 (reconnection re-validates certificates and
 * assignment SEPARATELY — a receipt is historical evidence, never a standing
 * authorization); POS spec §16 storage table.
 *
 * ===========================================================================
 * THE TERMINAL AUTHORS NOTHING
 * ===========================================================================
 * Every field persisted here comes from a receipt the STORE HUB signed, and
 * the signature is verified BEFORE the row is written and AGAIN every time it
 * is read back. There is no setter, no patch and no "repair" path: the public
 * surface accepts a signed receipt and returns verified evidence, so a
 * terminal that wanted to alter a receipt field would have to forge the Hub's
 * signature.
 *
 * WHAT IS NEVER PERSISTED, structurally: pairing nonces, ephemeral proof
 * signatures, the provisioning code or its digest, the terminal private key,
 * the Hub private key, database credentials. None of them appear in the
 * persisted record type, and {@link assertNoForbiddenMaterial} re-checks the
 * value before it is sealed, so a future caller that widened the record would
 * fail here rather than write a secret to disk.
 *
 * ===========================================================================
 * ATOMICITY, HISTORY AND WHAT "NOT PAIRED" MEANS
 * ===========================================================================
 * The receipt row and the current-receipt pointer move in ONE transaction;
 * SQLite triggers make prior receipts immutable and undeletable, so a
 * replacement SUPERSEDES its predecessor and never overwrites it. A missing,
 * corrupt, unverifiable or scope-mismatched current receipt means NOT PAIRED —
 * the store refuses rather than degrading, and recovery is governed
 * re-pairing, never a locally reconstructed receipt.
 *
 * A verified receipt still does not authorize operation on its own:
 * {@link PairingReceiptStore.authorizeOperationalUse} re-validates the Hub,
 * the assignment generation and both credentials against CURRENT eligibility
 * before the receipt may be used, exactly as protocol §11 requires.
 */

import {
  pairingReceiptBytes,
  publicKeyFingerprint,
  verifyDetachedSignature,
  verifyPairingReceipt,
  type PairingReceipt,
  type ReceiptExpectation,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import type { SqlValue, TerminalSqlDriver } from "./driver.js";
import {
  blindIndex,
  deriveSealingKeys,
  open,
  seal,
  TerminalStoreSealError,
  type SealingKeys,
} from "./sealing.js";
import type { SecureKeyStore } from "./secure-key-store.js";

const RECEIPT_TABLE = "pairing_receipts";
const RECEIPT_DOMAIN = "pairing_receipt_id";
const SESSION_DOMAIN = "pairing_session_id";

export type ReceiptLifecycleState = "current" | "superseded";

export class TerminalPairingStoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "TerminalPairingStoreError";
  }
}

/**
 * The installation-context facts the RECEIPT itself does not carry.
 *
 * The Hub-signed receipt binds the transcript, both fingerprints, the scope,
 * the generation and the profile; the assignment ROW id and the activation id
 * belong to the terminal's own governed provisioning state. They are stored
 * alongside so the record is complete per §19, and they are NEVER used to
 * relax a verification decision.
 */
export interface ReceiptInstallationContext {
  readonly terminalAssignmentId: string;
  readonly activationId: string;
}

/** Exactly the §19 field list. Nothing else is persistable. */
export interface StoredPairingReceipt {
  readonly receiptId: string;
  readonly protocolVersion: string;
  readonly pairingSessionId: string;
  readonly hubDeviceId: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalDeviceId: string;
  readonly terminalCertificateFingerprint: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly terminalAssignmentId: string;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly activationId: string;
  readonly transcriptHash: string;
  /** The Hub-signed PUBLIC receipt payload, exactly as received. */
  readonly receiptPayload: PairingReceiptPayload;
  /** The Hub's detached signature over the canonical receipt bytes, base64. */
  readonly hubReceiptSignatureBase64: string;
  readonly pairedAt: string;
  readonly verifiedAt: string;
  readonly lifecycleState: ReceiptLifecycleState;
  readonly supersededByReceiptId: string | null;
}

/** The receipt as it travels and is stored: instants as ISO strings. */
export interface PairingReceiptPayload {
  readonly receiptId: string;
  readonly receiptVersion: string;
  readonly pairingSessionId: string;
  readonly transcriptHash: string;
  readonly hubDeviceId: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalDeviceId: string;
  readonly terminalCertificateFingerprint: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly pairedAt: string;
  readonly validUntil: string | null;
  readonly correlationId: string;
}

export function toPayload(receipt: PairingReceipt): PairingReceiptPayload {
  return {
    receiptId: receipt.receiptId,
    receiptVersion: receipt.receiptVersion,
    pairingSessionId: receipt.pairingSessionId,
    transcriptHash: receipt.transcriptHash,
    hubDeviceId: receipt.hubDeviceId,
    hubCertificateFingerprint: receipt.hubCertificateFingerprint,
    terminalDeviceId: receipt.terminalDeviceId,
    terminalCertificateFingerprint: receipt.terminalCertificateFingerprint,
    tenantId: receipt.tenantId,
    digitalStoreId: receipt.digitalStoreId,
    storeLocationId: receipt.storeLocationId,
    environment: receipt.environment,
    terminalAssignmentGeneration: receipt.terminalAssignmentGeneration,
    terminalProfileKey: receipt.terminalProfileKey,
    pairedAt: receipt.pairedAt.toISOString(),
    validUntil: receipt.validUntil === null ? null : receipt.validUntil.toISOString(),
    correlationId: receipt.correlationId,
  };
}

export function fromPayload(payload: PairingReceiptPayload): PairingReceipt {
  return {
    receiptId: payload.receiptId,
    receiptVersion: payload.receiptVersion,
    pairingSessionId: payload.pairingSessionId,
    transcriptHash: payload.transcriptHash,
    hubDeviceId: payload.hubDeviceId,
    hubCertificateFingerprint: payload.hubCertificateFingerprint,
    terminalDeviceId: payload.terminalDeviceId,
    terminalCertificateFingerprint: payload.terminalCertificateFingerprint,
    tenantId: payload.tenantId,
    digitalStoreId: payload.digitalStoreId,
    storeLocationId: payload.storeLocationId,
    environment: payload.environment,
    terminalAssignmentGeneration: payload.terminalAssignmentGeneration,
    terminalProfileKey: payload.terminalProfileKey,
    pairedAt: new Date(payload.pairedAt),
    validUntil: payload.validUntil === null ? null : new Date(payload.validUntil),
    correlationId: payload.correlationId,
  };
}

/**
 * Material that must never reach the terminal-local database.
 *
 * Checked by VALUE rather than by field name: the risk is a field nobody
 * thought of. `nonce` is included because a persisted pairing nonce would
 * survive the handshake that consumed it, and a consumed nonce is supposed to
 * be permanently unusable — keeping one is not "extra evidence", it is a
 * replay input sitting on disk.
 */
const FORBIDDEN_KEY_FRAGMENTS = [
  "nonce",
  "privatekey",
  "proofsignature",
  "provisioningcode",
  "codedigest",
  "password",
  "secret",
  "connectionstring",
] as const;
const FORBIDDEN_VALUE = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|postgres(?:ql)?:\/\//;

/** Matched on the key with separators stripped, so `hub_nonce` and
 * `terminalNonce` are the same finding rather than two spellings to remember. */
function isForbiddenKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

export function assertNoForbiddenMaterial(value: unknown, at = "record"): void {
  const seen = new Set<object>();
  const walk = (node: unknown, path: string): void => {
    if (typeof node === "string") {
      if (FORBIDDEN_VALUE.test(node)) {
        throw new TerminalPairingStoreError(
          `KLUY-TERMINAL-STORE-FORBIDDEN-MATERIAL: a private key or a database credential at ` +
            `${path} must never reach the terminal-local store (P04C §19).`,
          "KLUY-TERMINAL-STORE-FORBIDDEN-MATERIAL",
        );
      }
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, item] of Object.entries(node)) {
      if (isForbiddenKey(key)) {
        throw new TerminalPairingStoreError(
          `KLUY-TERMINAL-STORE-FORBIDDEN-MATERIAL: field '${key}' at ${path}. Nonces, proof ` +
            "signatures, provisioning codes, private keys and database credentials are never " +
            "persisted (P04C §19).",
          "KLUY-TERMINAL-STORE-FORBIDDEN-MATERIAL",
        );
      }
      walk(item, `${path}.${key}`);
    }
  };
  walk(value, at);
}

/** What CURRENT eligibility says, at the moment the receipt would be used. */
export interface OperationalEligibility {
  readonly hubDeviceId: string;
  readonly hubCertificateFingerprint: string;
  readonly terminalCertificateFingerprint: string;
  readonly terminalAssignmentId: string;
  readonly terminalAssignmentGeneration: number;
  readonly terminalProfileKey: string;
  readonly terminalCredentialStatus: string;
  readonly hubCredentialStatus: string;
}

export interface OperationalVerdict {
  readonly authorized: boolean;
  readonly refusalCode?: string;
  readonly detail?: string;
}

const SCHEMA = [
  `create table if not exists ${RECEIPT_TABLE} (
     row_no            integer primary key autoincrement,
     receipt_key       text    not null unique,
     session_key       text    not null unique,
     superseded_by_key text    null,
     lifecycle_state   text    not null,
     record            text    not null,
     hub_signature     text    not null,
     created_at        text    not null
   )`,
  `create table if not exists current_pairing_receipt (
     singleton   integer primary key check (singleton = 1),
     receipt_key text not null
   )`,
  // History is immutable: the sealed record, both identity indexes, the
  // signature and the creation instant can never change, and nothing is ever
  // deleted. Only the lifecycle state and the successor pointer move, and only
  // forward.
  `create trigger if not exists pairing_receipts_immutable
     before update on ${RECEIPT_TABLE}
     for each row
     when old.record <> new.record
       or old.hub_signature <> new.hub_signature
       or old.receipt_key <> new.receipt_key
       or old.session_key <> new.session_key
       or old.created_at <> new.created_at
     begin
       select raise(abort, 'KLUY-TERMINAL-STORE-IMMUTABLE: a stored pairing receipt is history');
     end`,
  `create trigger if not exists pairing_receipts_no_delete
     before delete on ${RECEIPT_TABLE}
     for each row
     begin
       select raise(abort, 'KLUY-TERMINAL-STORE-IMMUTABLE: pairing receipts are never deleted');
     end`,
  `create trigger if not exists pairing_receipts_forward_only
     before update on ${RECEIPT_TABLE}
     for each row
     when old.lifecycle_state = 'superseded' and new.lifecycle_state = 'current'
     begin
       select raise(abort, 'KLUY-TERMINAL-STORE-IMMUTABLE: a superseded receipt cannot become current');
     end`,
];

interface ReceiptRow extends Record<string, SqlValue> {
  readonly row_no: number;
  readonly receipt_key: string;
  readonly session_key: string;
  readonly superseded_by_key: string | null;
  readonly lifecycle_state: string;
  readonly record: string;
  readonly hub_signature: string;
  readonly created_at: string;
}

/**
 * The terminal-local pairing-receipt authority.
 *
 * One instance per open store. Construct it with the OS-protected key store
 * (the shipped default refuses when no OS custody exists) and a driver.
 */
export class PairingReceiptStore {
  readonly #driver: TerminalSqlDriver;
  readonly #keys: SealingKeys;
  readonly #custodyId: string;

  constructor(driver: TerminalSqlDriver, keyStore: SecureKeyStore) {
    this.#driver = driver;
    this.#custodyId = keyStore.id;
    this.#keys = deriveSealingKeys(keyStore.getOrCreateDatabaseKey());
    for (const statement of SCHEMA) driver.exec(statement);
  }

  /** Which OS facility protects this store's key. Evidence, not decoration. */
  get keyCustodyId(): string {
    return this.#custodyId;
  }

  /**
   * Verify a Hub-signed receipt and persist it atomically with the
   * current-receipt pointer.
   *
   * Order is the contract: the signature and every scope binding are checked
   * BEFORE a byte is written, so an unverifiable receipt never reaches disk at
   * all. A repeat of the SAME receipt returns the stored evidence unchanged —
   * a lost response must not create a second row or move `paired_at`.
   */
  persistVerifiedReceipt(input: {
    readonly receipt: PairingReceipt;
    readonly hubReceiptSignatureBase64: string;
    readonly hubPublicKeyPem: string;
    readonly expectation: ReceiptExpectation;
    readonly context: ReceiptInstallationContext;
    readonly at: Date;
  }): StoredPairingReceipt {
    const verdict = verifyPairingReceipt(
      input.receipt,
      Buffer.from(input.hubReceiptSignatureBase64, "base64"),
      input.hubPublicKeyPem,
      input.expectation,
      input.at,
      publicKeyFingerprint,
    );
    if (!verdict.verified) {
      throw new TerminalPairingStoreError(
        "The Hub-signed pairing receipt did not verify; nothing was persisted.",
        verdict.refusalCode ?? "PAIR_RECEIPT_INVALID",
        verdict.detail,
      );
    }

    const receiptKey = blindIndex(this.#keys, RECEIPT_DOMAIN, input.receipt.receiptId);
    const existing = this.#rowByReceiptKey(receiptKey);
    if (existing !== undefined) {
      // The identical receipt again: return the ORIGINAL evidence, including
      // its original verified_at. Re-writing it would move a fact the terminal
      // does not own.
      return this.#decode(existing);
    }

    const stored: StoredPairingReceipt = {
      receiptId: input.receipt.receiptId,
      protocolVersion: input.receipt.receiptVersion,
      pairingSessionId: input.receipt.pairingSessionId,
      hubDeviceId: input.receipt.hubDeviceId,
      hubCertificateFingerprint: input.receipt.hubCertificateFingerprint,
      terminalDeviceId: input.receipt.terminalDeviceId,
      terminalCertificateFingerprint: input.receipt.terminalCertificateFingerprint,
      tenantId: input.receipt.tenantId,
      digitalStoreId: input.receipt.digitalStoreId,
      storeLocationId: input.receipt.storeLocationId,
      environment: input.receipt.environment,
      terminalAssignmentId: input.context.terminalAssignmentId,
      terminalAssignmentGeneration: input.receipt.terminalAssignmentGeneration,
      terminalProfileKey: input.receipt.terminalProfileKey,
      activationId: input.context.activationId,
      transcriptHash: input.receipt.transcriptHash,
      receiptPayload: toPayload(input.receipt),
      hubReceiptSignatureBase64: input.hubReceiptSignatureBase64,
      pairedAt: input.receipt.pairedAt.toISOString(),
      verifiedAt: input.at.toISOString(),
      lifecycleState: "current",
      supersededByReceiptId: null,
    };
    assertNoForbiddenMaterial(stored);

    const sessionKey = blindIndex(this.#keys, SESSION_DOMAIN, input.receipt.pairingSessionId);

    return this.#driver.transaction(() => {
      // A replacement SUPERSEDES its predecessor; the predecessor row is never
      // rewritten beyond its lifecycle state and successor pointer.
      const previous = this.#currentRow();
      if (previous !== undefined) {
        this.#driver.run(
          `update ${RECEIPT_TABLE}
              set lifecycle_state = ?, superseded_by_key = ?
            where receipt_key = ?`,
          [
            seal(this.#keys, RECEIPT_TABLE, "lifecycle_state", previous.receipt_key, "superseded"),
            receiptKey,
            previous.receipt_key,
          ],
        );
      }
      this.#driver.run(
        `insert into ${RECEIPT_TABLE}
           (receipt_key, session_key, superseded_by_key, lifecycle_state, record,
            hub_signature, created_at)
         values (?, ?, null, ?, ?, ?, ?)`,
        [
          receiptKey,
          sessionKey,
          seal(this.#keys, RECEIPT_TABLE, "lifecycle_state", receiptKey, "current"),
          seal(this.#keys, RECEIPT_TABLE, "record", receiptKey, JSON.stringify(stored)),
          seal(
            this.#keys,
            RECEIPT_TABLE,
            "hub_signature",
            receiptKey,
            input.hubReceiptSignatureBase64,
          ),
          seal(this.#keys, RECEIPT_TABLE, "created_at", receiptKey, input.at.toISOString()),
        ],
      );
      // The pointer moves in the SAME transaction. There is no window in which
      // a receipt exists without being current, or is current without existing.
      this.#driver.run(
        `insert into current_pairing_receipt (singleton, receipt_key) values (1, ?)
           on conflict(singleton) do update set receipt_key = excluded.receipt_key`,
        [receiptKey],
      );
      return stored;
    });
  }

  /**
   * Startup path: load the current receipt and RE-VERIFY it.
   *
   * "Missing, corrupt or unverifiable means not paired" is implemented here as
   * a `null` return for missing and a typed refusal for everything else — the
   * caller must not be able to mistake "no receipt yet" for "the store lied".
   */
  loadVerifiedCurrentReceipt(input: {
    readonly hubPublicKeyPem: string;
    readonly expectation: ReceiptExpectation;
    readonly at: Date;
  }): StoredPairingReceipt | null {
    const row = this.#currentRow();
    if (row === undefined) return null;
    const stored = this.#decode(row);
    const verdict = verifyPairingReceipt(
      fromPayload(stored.receiptPayload),
      Buffer.from(stored.hubReceiptSignatureBase64, "base64"),
      input.hubPublicKeyPem,
      input.expectation,
      input.at,
      publicKeyFingerprint,
    );
    if (!verdict.verified) {
      throw new TerminalPairingStoreError(
        "The stored current pairing receipt no longer verifies; this terminal is NOT paired. " +
          "Recovery is governed re-pairing — the terminal cannot repair a receipt it did not author.",
        verdict.refusalCode ?? "PAIR_RECEIPT_INVALID",
        verdict.detail,
      );
    }
    // The signature is checked against the SEALED payload as well, so a record
    // that survived the seal but disagrees with its own signature is caught.
    if (
      !verifyDetachedSignature(
        input.hubPublicKeyPem,
        pairingReceiptBytes(fromPayload(stored.receiptPayload)),
        Buffer.from(stored.hubReceiptSignatureBase64, "base64"),
      )
    ) {
      throw new TerminalPairingStoreError(
        "The stored receipt payload and its Hub signature disagree; this terminal is NOT paired.",
        "PAIR_RECEIPT_INVALID",
      );
    }
    return stored;
  }

  /**
   * Protocol §11: a verified receipt is EVIDENCE, not a standing
   * authorization. Before operational use the Hub, the assignment and both
   * credentials are re-validated against CURRENT eligibility.
   *
   * Refusals name the fact that moved, so an operator sees "your assignment
   * generation changed", not "not paired".
   */
  authorizeOperationalUse(
    stored: StoredPairingReceipt,
    eligibility: OperationalEligibility,
  ): OperationalVerdict {
    const refuse = (refusalCode: string, detail: string): OperationalVerdict => ({
      authorized: false,
      refusalCode,
      detail,
    });
    if (
      stored.hubDeviceId !== eligibility.hubDeviceId ||
      stored.hubCertificateFingerprint !== eligibility.hubCertificateFingerprint
    ) {
      return refuse("PAIR_HUB_CHANGED", "the receipt names a different Hub or Hub credential");
    }
    if (stored.terminalCertificateFingerprint !== eligibility.terminalCertificateFingerprint) {
      return refuse("PAIR_CREDENTIAL_CHANGED", "the terminal credential is not the paired one");
    }
    if (
      stored.terminalAssignmentId !== eligibility.terminalAssignmentId ||
      stored.terminalAssignmentGeneration !== eligibility.terminalAssignmentGeneration ||
      stored.terminalProfileKey !== eligibility.terminalProfileKey
    ) {
      return refuse("PAIR_ASSIGNMENT_MISMATCH", "the assignment, generation or profile moved");
    }
    if (eligibility.terminalCredentialStatus !== "active") {
      return refuse("PAIR_DEVICE_NOT_ELIGIBLE", "the terminal credential is not active");
    }
    if (eligibility.hubCredentialStatus !== "active") {
      return refuse("PAIR_HUB_NOT_ACTIVE", "the Hub credential is not active");
    }
    if (stored.lifecycleState !== "current") {
      return refuse("PAIR_RECEIPT_SUPERSEDED", "this receipt has been superseded");
    }
    return { authorized: true };
  }

  /** Immutable history, oldest first. Includes the current receipt. */
  history(): readonly StoredPairingReceipt[] {
    return this.#driver
      .all<ReceiptRow>(`select * from ${RECEIPT_TABLE} order by row_no asc`)
      .map((row) => this.#decode(row));
  }

  findBySessionId(pairingSessionId: string): StoredPairingReceipt | null {
    const key = blindIndex(this.#keys, SESSION_DOMAIN, pairingSessionId);
    const rows = this.#driver.all<ReceiptRow>(
      `select * from ${RECEIPT_TABLE} where session_key = ?`,
      [key],
    );
    return rows[0] === undefined ? null : this.#decode(rows[0]);
  }

  #currentRow(): ReceiptRow | undefined {
    const pointer = this.#driver.all<{ receipt_key: string }>(
      `select receipt_key from current_pairing_receipt where singleton = 1`,
    );
    const key = pointer[0]?.receipt_key;
    return key === undefined ? undefined : this.#rowByReceiptKey(key);
  }

  #rowByReceiptKey(receiptKey: string): ReceiptRow | undefined {
    return this.#driver.all<ReceiptRow>(`select * from ${RECEIPT_TABLE} where receipt_key = ?`, [
      receiptKey,
    ])[0];
  }

  /**
   * Open one row. Any seal failure surfaces as CORRUPT — the store fails
   * closed rather than returning a partially readable receipt, because a
   * receipt that is half-trustworthy is not evidence of anything.
   */
  #decode(row: ReceiptRow): StoredPairingReceipt {
    try {
      const record = JSON.parse(
        open(this.#keys, RECEIPT_TABLE, "record", row.receipt_key, row.record),
      ) as StoredPairingReceipt;
      const lifecycleState = open(
        this.#keys,
        RECEIPT_TABLE,
        "lifecycle_state",
        row.receipt_key,
        row.lifecycle_state,
      ) as ReceiptLifecycleState;
      const signature = open(
        this.#keys,
        RECEIPT_TABLE,
        "hub_signature",
        row.receipt_key,
        row.hub_signature,
      );
      // The successor pointer is a blind index, so the successor's receipt id
      // is resolved from the record it belongs to rather than stored twice.
      const supersededBy =
        row.superseded_by_key === null
          ? null
          : (this.#rowByReceiptKey(row.superseded_by_key) ?? null);
      const supersededByReceiptId =
        supersededBy === null
          ? null
          : (
              JSON.parse(
                open(
                  this.#keys,
                  RECEIPT_TABLE,
                  "record",
                  supersededBy.receipt_key,
                  supersededBy.record,
                ),
              ) as StoredPairingReceipt
            ).receiptId;
      return {
        ...record,
        lifecycleState,
        hubReceiptSignatureBase64: signature,
        supersededByReceiptId,
      };
    } catch (error) {
      if (error instanceof TerminalStoreSealError) {
        throw new TerminalPairingStoreError(
          "The terminal-local pairing store did not authenticate its own contents; this terminal " +
            "is NOT paired. Recovery is governed re-pairing.",
          "KLUY-TERMINAL-STORE-CORRUPT",
          error.message,
        );
      }
      throw new TerminalPairingStoreError(
        "The terminal-local pairing store could not be read; this terminal is NOT paired.",
        "KLUY-TERMINAL-STORE-CORRUPT",
      );
    }
  }
}
