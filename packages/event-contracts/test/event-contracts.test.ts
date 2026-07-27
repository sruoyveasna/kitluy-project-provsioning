import { describe, expect, it } from "vitest";
import { asId } from "@kitluy/shared-types";
import {
  assertValidEnvelope,
  EVENT_NAME_PATTERN,
  EventRegistry,
  freezeEnvelope,
  isValidEventName,
  isValidPayloadChecksum,
  isValidSchemaVersion,
  MIN_SCHEMA_VERSION,
  validateEnvelope,
  type DomainEventEnvelope,
  type EventRegistration,
} from "../src/index.js";

/** Canonical names published in Domain Event Registry v1.0.0 §5. */
const CANONICAL_EVENT_NAMES = [
  "digital_store.created",
  "laundry_booking.created",
  "laundry_booking.ready",
  "garment.custody_scanned_in",
  "garment.custody_scanned_out",
  "payment.recorded",
  "payment.refunded",
] as const;

const SHA256_ZERO = "a".repeat(64);

function makeEnvelope(
  overrides: Partial<DomainEventEnvelope<Readonly<Record<string, unknown>>>> = {},
): DomainEventEnvelope<Readonly<Record<string, unknown>>> {
  return {
    event_id: "00000000-0000-7000-8000-000000000001",
    event_name: "payment.recorded",
    schema_version: 1,
    occurred_at: "2026-07-27T10:00:00+07:00",
    recorded_at: "2026-07-27T10:00:01+07:00",
    tenant_id: "00000000-0000-7000-8000-0000000000t1",
    digital_store_id: null,
    location_id: null,
    aggregate: { type: "payment", id: "00000000-0000-7000-8000-00000000a001", version: 1 },
    producer: "cloud.payments",
    source: { source_type: "cloud_service", source_id: "payments-api" },
    actor: { actor_type: "service", actor_id: "payments-worker" },
    correlation_id: asId.correlationId("00000000-0000-7000-8000-0000000000c1"),
    causation_id: null,
    idempotency_key: asId.idempotencyKey("idem-payment-recorded-0001"),
    payload: { amount_minor: 1500 },
    payload_sha256: SHA256_ZERO,
    ...overrides,
  };
}

function makeRegistration(overrides: Partial<EventRegistration> = {}): EventRegistration {
  return {
    eventName: "payment.recorded",
    schemaVersion: 1,
    description: "A payment was recorded against a booking.",
    owningBoundary: "payments",
    source: "Domain Event Registry v1.0.0 §5 EVT-PAY-001",
    ...overrides,
  };
}

describe("canonical event-name grammar (KLD-2026-07-26-002 Group 4)", () => {
  it("is exactly the corrected two-segment lowercase pattern", () => {
    expect(EVENT_NAME_PATTERN.source).toBe("^[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*$");
  });

  it.each(CANONICAL_EVENT_NAMES)("accepts canonical name %s", (name) => {
    expect(isValidEventName(name)).toBe(true);
  });

  it.each([
    ["version-suffixed", "payment.khqr_confirmed.v1"],
    ["version-suffixed legacy alias", "laundry.booking_created.v1"],
    ["three-segment", "laundry.booking.created"],
    ["single-segment", "payment"],
    ["leading digit in context", "1payment.recorded"],
    ["leading digit in fact", "payment.1recorded"],
    ["uppercase context", "Payment.recorded"],
    ["uppercase fact", "payment.Recorded"],
    ["screaming snake", "PAYMENT.RECORDED"],
    ["empty string", ""],
    ["trailing dot", "payment."],
    ["leading dot", ".recorded"],
    ["hyphenated", "payment-service.recorded"],
    ["whitespace", "payment.recorded "],
  ])("rejects %s name (%s)", (_label, name) => {
    expect(isValidEventName(name)).toBe(false);
  });

  it("documents the grammar's blind spot for two-segment legacy aliases", () => {
    // The approved regex rejects every THREE-segment `.v<n>` form. A legacy
    // alias such as "digital_store_created.v1" is structurally indistinguish-
    // able from a valid <context>.<fact> pair, so the grammar alone cannot
    // reject it. Per KLD-2026-07-26-002 Group 4 such aliases are
    // documentation-only reconciliation mappings and are excluded by the
    // Domain Event Registry, not by this pattern. No runtime alias layer
    // exists because no affected event was ever deployed or published.
    expect(isValidEventName("digital_store_created.v1")).toBe(true);
    expect(CANONICAL_EVENT_NAMES).not.toContain("digital_store_created.v1");
  });
});

describe("schema_version is the sole version carrier", () => {
  it("accepts integers >= 1", () => {
    expect(MIN_SCHEMA_VERSION).toBe(1);
    for (const version of [1, 2, 7, 42]) {
      expect(isValidSchemaVersion(version)).toBe(true);
    }
  });

  it.each([0, -1, -7, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (version) => {
    expect(isValidSchemaVersion(version)).toBe(false);
  });

  it("rejects non-numeric schema versions", () => {
    for (const version of ["1", null, undefined, {}]) {
      expect(isValidSchemaVersion(version)).toBe(false);
    }
  });

  it("flags an out-of-range schema_version on the envelope", () => {
    const violations = validateEnvelope(makeEnvelope({ schema_version: 0 }));
    expect(violations.some((v) => v.includes("schema_version"))).toBe(true);
    expect(() => {
      assertValidEnvelope(makeEnvelope({ schema_version: 0 }));
    }).toThrow(/schema_version/);
  });

  it("rejects a version-suffixed event_name on the envelope", () => {
    const violations = validateEnvelope(makeEnvelope({ event_name: "payment.recorded.v1" }));
    expect(violations.some((v) => v.includes("event_name"))).toBe(true);
  });
});

describe("payload checksum", () => {
  it("accepts 64-character lowercase hex", () => {
    expect(isValidPayloadChecksum(SHA256_ZERO)).toBe(true);
    expect(
      isValidPayloadChecksum("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"),
    ).toBe(true);
  });

  it.each([
    ["uppercase hex", "A".repeat(64)],
    ["too short", "a".repeat(63)],
    ["too long", "a".repeat(65)],
    ["non-hex characters", "z".repeat(64)],
    ["empty", ""],
  ])("rejects %s", (_label, checksum) => {
    expect(isValidPayloadChecksum(checksum)).toBe(false);
  });

  it("requires payload_sha256 on the envelope", () => {
    const violations = validateEnvelope(makeEnvelope({ payload_sha256: "" }));
    expect(violations.some((v) => v.includes("payload_sha256"))).toBe(true);
  });

  it("accepts a fully-formed canonical envelope", () => {
    expect(validateEnvelope(makeEnvelope())).toEqual([]);
    expect(() => {
      assertValidEnvelope(makeEnvelope());
    }).not.toThrow();
  });
});

describe("correlation and causation", () => {
  it("requires a correlation_id", () => {
    const violations = validateEnvelope(makeEnvelope({ correlation_id: asId.correlationId("") }));
    expect(violations.some((v) => v.includes("correlation_id"))).toBe(true);
  });

  it("treats a null causation_id as a root event", () => {
    expect(validateEnvelope(makeEnvelope({ causation_id: null }))).toEqual([]);
    expect(validateEnvelope(makeEnvelope({ causation_id: undefined }))).toEqual([]);
  });

  it("accepts a causation_id pointing at the causing event", () => {
    const envelope = makeEnvelope({
      causation_id: "00000000-0000-7000-8000-0000000000ff",
    });
    expect(validateEnvelope(envelope)).toEqual([]);
    expect(envelope.causation_id).not.toBe(envelope.event_id);
  });

  it("rejects an empty or self-referential causation_id", () => {
    expect(
      validateEnvelope(makeEnvelope({ causation_id: "" })).some((v) => v.includes("causation_id")),
    ).toBe(true);

    const selfCaused = makeEnvelope();
    expect(
      validateEnvelope(makeEnvelope({ causation_id: selfCaused.event_id })).some((v) =>
        v.includes("causation_id"),
      ),
    ).toBe(true);
  });

  it("enforces idempotency_key length bounds", () => {
    expect(
      validateEnvelope(makeEnvelope({ idempotency_key: asId.idempotencyKey("short") })).some((v) =>
        v.includes("idempotency_key"),
      ),
    ).toBe(true);
  });
});

describe("replay metadata", () => {
  it("accepts an absent replay block", () => {
    expect(validateEnvelope(makeEnvelope())).toEqual([]);
  });

  it("accepts a non-replay marker", () => {
    expect(validateEnvelope(makeEnvelope({ replay: { is_replay: false } }))).toEqual([]);
  });

  it("accepts a replay carrying its run and original event identity", () => {
    const envelope = makeEnvelope({
      replay: {
        is_replay: true,
        replay_run_id: "00000000-0000-7000-8000-0000000000r1",
        original_event_id: "00000000-0000-7000-8000-000000000001",
      },
    });
    expect(validateEnvelope(envelope)).toEqual([]);
    expect(envelope.replay?.is_replay).toBe(true);
    expect(envelope.replay?.original_event_id).toBe("00000000-0000-7000-8000-000000000001");
  });

  it("rejects a replay that does not name the original event", () => {
    const violations = validateEnvelope(makeEnvelope({ replay: { is_replay: true } }));
    expect(violations.some((v) => v.includes("original_event_id"))).toBe(true);
  });
});

describe("immutable event identity", () => {
  it("cannot be mutated once frozen", () => {
    const envelope = freezeEnvelope(makeEnvelope());

    expect(Object.isFrozen(envelope)).toBe(true);
    expect(() => {
      (envelope as { event_id: string }).event_id = "tampered";
    }).toThrow(TypeError);
    expect(() => {
      (envelope as { schema_version: number }).schema_version = 99;
    }).toThrow(TypeError);
    expect(envelope.event_id).toBe("00000000-0000-7000-8000-000000000001");
    expect(envelope.schema_version).toBe(1);
  });

  it("freezes nested aggregate, source and payload structures", () => {
    const envelope = freezeEnvelope(
      makeEnvelope({ replay: { is_replay: false }, payload: { amount_minor: 1500 } }),
    );

    expect(Object.isFrozen(envelope.aggregate)).toBe(true);
    expect(Object.isFrozen(envelope.source)).toBe(true);
    expect(Object.isFrozen(envelope.payload)).toBe(true);
    expect(Object.isFrozen(envelope.replay)).toBe(true);
    expect(() => {
      (envelope.aggregate as { version: number }).version = 99;
    }).toThrow(TypeError);
    expect(envelope.aggregate.version).toBe(1);
  });

  it("carries aggregate identity as a nested type/id/version reference", () => {
    const envelope = makeEnvelope();
    expect(envelope.aggregate).toEqual({
      type: "payment",
      id: "00000000-0000-7000-8000-00000000a001",
      version: 1,
    });
  });
});

describe("EventRegistry", () => {
  it("registers and reads back a canonical event contract", () => {
    const registry = new EventRegistry();
    const entry = makeRegistration();
    registry.register(entry);

    expect(registry.get("payment.recorded")).toEqual(entry);
    expect(registry.get("payment.recorded", 1)).toEqual(entry);
    expect(registry.all()).toHaveLength(1);
  });

  it("rejects version-suffixed and otherwise malformed event names", () => {
    const registry = new EventRegistry();
    expect(() => {
      registry.register(makeRegistration({ eventName: "payment.khqr_confirmed.v1" }));
    }).toThrow(/past_tense_fact/);
    expect(() => {
      registry.register(makeRegistration({ eventName: "Payment.Recorded" }));
    }).toThrow(/Invalid event name/);
    expect(registry.all()).toHaveLength(0);
  });

  it("rejects schema versions below 1", () => {
    const registry = new EventRegistry();
    expect(() => {
      registry.register(makeRegistration({ schemaVersion: 0 }));
    }).toThrow(/schema version/i);
    expect(() => {
      registry.register(makeRegistration({ schemaVersion: 1.5 }));
    }).toThrow(/schema version/i);
  });

  it("accepts a backward-compatible higher schema version for the same event", () => {
    const registry = new EventRegistry();
    registry.register(makeRegistration({ schemaVersion: 1 }));
    registry.register(makeRegistration({ schemaVersion: 2, description: "Adds tip_minor." }));

    expect(registry.versionsOf("payment.recorded")).toEqual([1, 2]);
    expect(registry.get("payment.recorded", 1)?.description).toBe(
      "A payment was recorded against a booking.",
    );
    // Bare lookup resolves to the latest registered version.
    expect(registry.get("payment.recorded")?.schemaVersion).toBe(2);
  });

  it("conflicts when the same name and version is registered twice", () => {
    const registry = new EventRegistry();
    registry.register(makeRegistration({ schemaVersion: 2 }));
    expect(() => {
      registry.register(makeRegistration({ schemaVersion: 2 }));
    }).toThrow(/already registered; event contracts are immutable/);
    expect(registry.versionsOf("payment.recorded")).toEqual([2]);
  });

  it("keeps distinct event names independent", () => {
    const registry = new EventRegistry();
    for (const eventName of CANONICAL_EVENT_NAMES) {
      registry.register(makeRegistration({ eventName }));
    }

    expect(registry.all()).toHaveLength(CANONICAL_EVENT_NAMES.length);
    expect(registry.get("garment.custody_scanned_out")?.eventName).toBe(
      "garment.custody_scanned_out",
    );
    expect(registry.get("laundry_booking.cancelled")).toBeUndefined();
    expect(registry.versionsOf("laundry_booking.cancelled")).toEqual([]);
  });
});
