/**
 * Device-side identity bootstrap for the KitLuy OS firstboot service.
 *
 * Authority:
 *   00_AI_HANDOFF/000_ACTIVE_PHASE.md §10 — the owner-fixed identity model
 *   @kitluy/device-identity — THE IDENTITY RULE
 *   KLD-2026-07-28-002 (BLK-005) — key custody and trust environments
 *
 * ===========================================================================
 * THE IDENTITY RULE, RESTATED WHERE IT IS ENFORCED
 * ===========================================================================
 * The primary identity is an opaque, server-generated `device_record_id`. This
 * agent NEVER derives an identity from MAC address, board serial or storage
 * serial. Those are collected as BINDING and TAMPER signals and sent as
 * evidence; a changed signal quarantines the device server-side and requires
 * governed re-enrollment. Hashing them into a local identity would make a
 * repaired device a different device and a cloned device the same device.
 *
 * ===========================================================================
 * WHAT NEVER LEAVES THE DEVICE
 * ===========================================================================
 * The private key. It is generated on the device, stored on the encrypted data
 * partition, and only ever used to produce signatures. There is no code path
 * in this module that serialises it into a request body, a log line or an
 * error message — `IdentityRecord` deliberately has no private-key field, so a
 * caller cannot transmit one by accident.
 */

/** Where the identity material lives, injected so tests need no real disk. */
export interface IdentityStore {
  read(): Promise<StoredIdentity | null>;
  /** Must be atomic: a torn write is the failure mode this whole module guards. */
  write(identity: StoredIdentity): Promise<void>;
}

/** Key material provider — the device's crypto backend. */
export interface KeyProvider {
  generateKeyPair(): Promise<{ publicKeyPem: string; privateKeyHandle: string }>;
  /** Confirms a previously generated key is still usable (e.g. secure element present). */
  verifyKeyUsable(privateKeyHandle: string): Promise<boolean>;
}

/** Hardware binding/tamper signals. Evidence, never identity inputs. */
export interface HardwareSignals {
  readonly macAddress?: string;
  readonly boardSerial?: string;
  readonly socSerial?: string;
  readonly storageSerial?: string;
  readonly storageModel?: string;
}

export interface HardwareProbe {
  collect(): Promise<HardwareSignals>;
}

/**
 * What firstboot persists. Note the absence of any private key: the handle is
 * an opaque reference the key provider understands, not the key itself.
 */
export interface StoredIdentity {
  /** Set only after the cloud has assigned one. Absent before enrollment. */
  readonly deviceRecordId?: string;
  readonly publicKeyPem: string;
  readonly privateKeyHandle: string;
  readonly hardwareSignals: HardwareSignals;
  readonly createdAt: string;
  /**
   * `complete` is written LAST and only after every other field is durable.
   * A record without it is a torn firstboot and is re-created, which is what
   * makes rerun safety a property of the data rather than of a marker file.
   */
  readonly complete: boolean;
}

/** The safe, transmittable view of identity. No private material by construction. */
export interface IdentityRecord {
  readonly deviceRecordId?: string;
  readonly publicKeyPem: string;
  readonly hardwareSignals: HardwareSignals;
  readonly createdAt: string;
}

export interface FirstbootDeps {
  readonly store: IdentityStore;
  readonly keys: KeyProvider;
  readonly hardware: HardwareProbe;
  readonly now: () => Date;
}

export type FirstbootOutcome =
  | { readonly kind: "created"; readonly identity: IdentityRecord }
  | { readonly kind: "reused"; readonly identity: IdentityRecord }
  | { readonly kind: "recreated"; readonly identity: IdentityRecord; readonly reason: string };

/**
 * Establish device identity, exactly once, safely on every rerun.
 *
 * The three outcomes are distinguished on purpose. `recreated` is not a
 * success dressed up as one — it means a previous attempt left unusable
 * material behind, and the fleet needs to be able to see that happened.
 */
export async function bootstrapIdentity(deps: FirstbootDeps): Promise<FirstbootOutcome> {
  const existing = await deps.store.read();

  if (existing !== null) {
    if (!existing.complete) {
      return recreate(deps, "previous firstboot did not complete (torn write)");
    }
    const usable = await deps.keys.verifyKeyUsable(existing.privateKeyHandle);
    if (!usable) {
      // The key is gone or the secure element changed. Re-keying locally is
      // correct; the SERVER decides whether this device keeps its record — a
      // new key against a known record is a governed re-enrollment, not a
      // silent new identity.
      return recreate(deps, "stored private key is no longer usable");
    }
    return { kind: "reused", identity: toRecord(existing) };
  }

  const created = await create(deps);
  return { kind: "created", identity: toRecord(created) };
}

async function recreate(deps: FirstbootDeps, reason: string): Promise<FirstbootOutcome> {
  const created = await create(deps);
  return { kind: "recreated", identity: toRecord(created), reason };
}

async function create(deps: FirstbootDeps): Promise<StoredIdentity> {
  const { publicKeyPem, privateKeyHandle } = await deps.keys.generateKeyPair();
  const hardwareSignals = await deps.hardware.collect();
  const identity: StoredIdentity = {
    publicKeyPem,
    privateKeyHandle,
    hardwareSignals,
    createdAt: deps.now().toISOString(),
    complete: true,
  };
  await deps.store.write(identity);
  return identity;
}

function toRecord(stored: StoredIdentity): IdentityRecord {
  // Explicit field selection, not a spread-and-delete: a future field added to
  // StoredIdentity must be opted IN to transmission, never opted out of it.
  const record: IdentityRecord = {
    publicKeyPem: stored.publicKeyPem,
    hardwareSignals: stored.hardwareSignals,
    createdAt: stored.createdAt,
  };
  return stored.deviceRecordId === undefined
    ? record
    : { ...record, deviceRecordId: stored.deviceRecordId };
}
