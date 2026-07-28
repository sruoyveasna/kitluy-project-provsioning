/**
 * THE command effect contract — which business effects each Hub command may
 * emit, and the ORDINAL that identifies each one (KLREQ-026, approved as
 * KLD-2026-07-28-001 Group 6).
 *
 * The ruling, verbatim in substance: the Hub-issued event-effect key is
 * `kh1.{command_result_uuid}.{event_ordinal}`, with "ordinals defined by the
 * command contract rather than insertion order, deterministic across replay,
 * separate from the outbox event ID"; "a Hub-generated event must never claim
 * to be a terminal command"; and "an unregistered ambiguous ordinal must fail
 * rather than emit".
 *
 * WHAT THE ORDINAL IS. Each command declares the effect NAMES it may emit, in
 * contract order. An effect's ordinal is
 *
 *     slot * EFFECT_ORDINAL_STRIDE + occurrenceIndex
 *
 * where `slot` is the effect's position in the declared list and
 * `occurrenceIndex` counts repeats of THAT SAME effect name within the command
 * — a confirm-intake writes one custody effect per garment unit, and those units
 * are a business collection, not an accident of code order.
 *
 * WHY NOT A FLAT COUNTER. A flat counter is insertion order by another name:
 * inserting a new effect type, or emitting two effect types in a different
 * interleaving, would renumber every effect after it, so a replay of the same
 * business command would mint different keys for the same business facts. With
 * a strided slot, an effect's identity depends only on WHICH effect it is and
 * WHICH occurrence of that effect it is.
 *
 * WHY THE FIRST EVENT NO LONGER CARRIES THE TERMINAL KEY. It used to, and that
 * made one Hub-generated event indistinguishable from a terminal command
 * (`kl1.*`) while its siblings were not — precisely what the ruling forbids. The
 * terminal key identifies the COMMAND and lives on
 * `edge_sync.command_result.idempotency_key`, which is unique; every EVENT is
 * Hub-issued and carries `kh1.*`.
 */
import { buildHubEffectKey, isValidHubEffectKey } from "@kitluy/sync-protocol";
import { HubCommandError } from "./errors.js";
import type { HubCommandDefinition } from "./command-registry.js";

/**
 * Occurrences allowed per effect slot. One thousand garment units in a single
 * intake is far beyond any real Store, and exceeding it FAILS rather than
 * wrapping into the next slot's ordinal space.
 */
export const EFFECT_ORDINAL_STRIDE = 1000;

/**
 * Effects a command may emit BEYOND its registered `auditEvent`, in contract
 * order. A command absent from this map emits its audit event only.
 *
 * This is the declaration the ruling requires. It is held honest by
 * `assertDeclaredEffect` at runtime — an effect a command emits without
 * declaring it here fails the command rather than minting an ordinal nobody
 * agreed on.
 */
export const ADDITIONAL_COMMAND_EFFECTS: Readonly<Record<string, readonly string[]>> = {
  // Confirm-intake takes custody of every registered unit and may settle a
  // deposit in the same command (Hub spec §8; laundry T1).
  "laundry.booking.confirm_intake": ["garment.custody_recorded", "payment.recorded"],
  // T3: custody is taken at STORAGE ASSIGNMENT, not at the scan — the unit is
  // in Hub custody once it has a storage position, which is where
  // assignReadyStorage writes it.
  "laundry.ready.assign_storage": ["garment.custody_scanned_in"],
  // T4 scan-out releases custody per unit, written by completePickupSession.
  "laundry.pickup.complete": ["garment.custody_scanned_out"],
  // Pickup payment settles the balance and may move the cash drawer.
  "laundry.pickup.record_payment": ["payment.recorded", "cash.movement_recorded"],
  // Cash payment always writes the payment effect and the drawer movement.
  "payments.record_cash_payment": ["payment.recorded", "cash.movement_recorded"],
  "payments.create_pending_payment": ["payment.recorded"],
  "payments.request_refund": ["payment.recorded", "cash.movement_recorded"],
  "payments.request_void": ["payment.recorded"],
  "payments.apply_provider_callback": ["payment.recorded"],
};

/** The full declared effect list for a command, in contract order. */
export function declaredEffects(definition: HubCommandDefinition): readonly string[] {
  const extra = ADDITIONAL_COMMAND_EFFECTS[definition.commandType] ?? [];
  // The audit event is slot 0 by contract; duplicates in the extras are dropped
  // so a name always maps to exactly one slot.
  const seen = new Set<string>([definition.auditEvent]);
  const effects = [definition.auditEvent];
  for (const name of extra) {
    if (seen.has(name)) continue;
    seen.add(name);
    effects.push(name);
  }
  return effects;
}

/**
 * KLREQ-026: "an unregistered ambiguous ordinal must fail rather than emit."
 * The refusal is a COMMAND error, so it rolls the whole command back — a
 * partially emitted command with one undeclared effect would be worse than no
 * command at all.
 */
export function assertDeclaredEffect(
  commandType: string,
  effects: readonly string[],
  eventName: string,
): number {
  const slot = effects.indexOf(eventName);
  if (slot === -1) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Command '${commandType}' emitted the undeclared effect '${eventName}'. ` +
        `Declared effects: ${effects.join(", ")}. An unregistered effect fails rather than ` +
        "emits (KLREQ-026); declare it in ADDITIONAL_COMMAND_EFFECTS.",
      { commandType, eventName, declared: effects },
    );
  }
  return slot;
}

/**
 * The deterministic ordinal for one effect occurrence.
 *
 * Depends ONLY on the command contract and on which occurrence of that effect
 * this is — never on how many other effects happened to be written first.
 */
export function effectOrdinal(
  commandType: string,
  effects: readonly string[],
  eventName: string,
  occurrenceIndex: number,
): number {
  const slot = assertDeclaredEffect(commandType, effects, eventName);
  if (occurrenceIndex < 0 || occurrenceIndex >= EFFECT_ORDINAL_STRIDE) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Effect '${eventName}' occurred ${occurrenceIndex + 1} times in one '${commandType}' ` +
        `command, past the ${EFFECT_ORDINAL_STRIDE} reserved per effect. Refusing rather than ` +
        "wrapping into the next effect's ordinal space.",
      { commandType, eventName, occurrenceIndex },
    );
  }
  return slot * EFFECT_ORDINAL_STRIDE + occurrenceIndex;
}

/**
 * The Hub-issued business-effect key for one event.
 *
 * Deterministic across replay: the same command result, the same declared
 * effect and the same occurrence always produce the same key, so a cloud that
 * has already ingested this effect recognises it and applies nothing twice.
 */
export function effectKey(input: {
  readonly commandResultId: string;
  readonly commandType: string;
  readonly effects: readonly string[];
  readonly eventName: string;
  readonly occurrenceIndex: number;
}): string {
  const ordinal = effectOrdinal(
    input.commandType,
    input.effects,
    input.eventName,
    input.occurrenceIndex,
  );
  const key = buildHubEffectKey(input.commandResultId, ordinal);
  /* c8 ignore next 8 -- unreachable belt-and-braces: buildHubEffectKey already
     validates both halves. Kept because a malformed key would be persisted by
     the CHECK-widened local_event column and only surface at the cloud. */
  if (!isValidHubEffectKey(key)) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Derived effect key '${key}' is not the canonical kh1 shape (KLREQ-026).`,
      { commandResultId: input.commandResultId, ordinal },
    );
  }
  return key;
}
