/**
 * WS-10-T003 — the command effect contract (KLREQ-026, KLD-2026-07-28-001
 * Group 6).
 *
 * The ruling requires ordinals defined by the COMMAND CONTRACT rather than
 * insertion order, deterministic across replay, and an unregistered ordinal
 * that FAILS rather than emits.
 */
import { describe, expect, it } from "vitest";
import { isValidHubEffectKey, isValidTerminalIdempotencyKey } from "@kitluy/sync-protocol";
import { HubCommandError } from "../src/hub/errors.js";
import {
  ADDITIONAL_COMMAND_EFFECTS,
  EFFECT_ORDINAL_STRIDE,
  assertDeclaredEffect,
  declaredEffects,
  effectKey,
  effectOrdinal,
} from "../src/hub/effect-contract.js";
import { HUB_COMMANDS, findHubCommand } from "../src/hub/command-registry.js";

const COMMAND_RESULT = "0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c2";

describe("declared effects", () => {
  it("puts the registered audit event at slot 0 for every command", () => {
    for (const definition of HUB_COMMANDS) {
      expect(declaredEffects(definition)[0]).toBe(definition.auditEvent);
    }
  });

  it("gives each effect name exactly one slot", () => {
    for (const definition of HUB_COMMANDS) {
      const effects = declaredEffects(definition);
      expect(new Set(effects).size).toBe(effects.length);
    }
  });

  it("only declares extra effects for commands that exist", () => {
    for (const commandType of Object.keys(ADDITIONAL_COMMAND_EFFECTS)) {
      // `payments.apply_provider_callback` is a service pipeline with no Edge
      // route; it declares its effects at its own call site instead.
      if (commandType === "payments.apply_provider_callback") continue;
      expect(findHubCommand(commandType), commandType).toBeDefined();
    }
  });
});

describe("ordinals are contract-defined, not insertion order", () => {
  const effects = ["a.happened", "b.happened", "c.happened"];

  it("depends only on WHICH effect and WHICH occurrence", () => {
    expect(effectOrdinal("cmd", effects, "a.happened", 0)).toBe(0);
    expect(effectOrdinal("cmd", effects, "b.happened", 0)).toBe(EFFECT_ORDINAL_STRIDE);
    expect(effectOrdinal("cmd", effects, "b.happened", 2)).toBe(EFFECT_ORDINAL_STRIDE + 2);
    expect(effectOrdinal("cmd", effects, "c.happened", 0)).toBe(2 * EFFECT_ORDINAL_STRIDE);
  });

  it("does NOT shift when another effect type is emitted first", () => {
    // The whole point of a strided slot: interleaving cannot renumber.
    const before = effectOrdinal("cmd", effects, "c.happened", 0);
    const after = effectOrdinal("cmd", effects, "c.happened", 0);
    expect(after).toBe(before);
    expect(effectOrdinal("cmd", effects, "b.happened", 0)).not.toBe(before);
  });

  it("produces the same key for the same effect on replay", () => {
    const first = effectKey({
      commandResultId: COMMAND_RESULT,
      commandType: "cmd",
      effects,
      eventName: "b.happened",
      occurrenceIndex: 3,
    });
    const replay = effectKey({
      commandResultId: COMMAND_RESULT,
      commandType: "cmd",
      effects,
      eventName: "b.happened",
      occurrenceIndex: 3,
    });
    expect(replay).toBe(first);
    expect(first).toBe(`kh1.${COMMAND_RESULT}.${EFFECT_ORDINAL_STRIDE + 3}`);
  });

  it("emits a kh1 key that can never be read as a terminal command", () => {
    const key = effectKey({
      commandResultId: COMMAND_RESULT,
      commandType: "cmd",
      effects,
      eventName: "a.happened",
      occurrenceIndex: 0,
    });
    expect(isValidHubEffectKey(key)).toBe(true);
    expect(isValidTerminalIdempotencyKey(key)).toBe(false);
  });
});

describe("an unregistered effect FAILS rather than emits", () => {
  const effects = ["a.happened"];

  it("refuses an effect the command never declared", () => {
    expect(() => assertDeclaredEffect("cmd", effects, "z.happened")).toThrow(HubCommandError);
    expect(() => assertDeclaredEffect("cmd", effects, "z.happened")).toThrow(/undeclared effect/);
  });

  it("refuses rather than wrapping into the next effect's ordinal space", () => {
    expect(() => effectOrdinal("cmd", effects, "a.happened", EFFECT_ORDINAL_STRIDE)).toThrow(
      /past the 1000 reserved/,
    );
    expect(() => effectOrdinal("cmd", effects, "a.happened", -1)).toThrow(HubCommandError);
  });

  it("keeps the refusal a COMMAND error so the whole command rolls back", () => {
    try {
      assertDeclaredEffect("cmd", effects, "z.happened");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(HubCommandError);
      expect((error as HubCommandError).code).toBe("EDGE_COMMAND_UNKNOWN");
    }
  });
});
