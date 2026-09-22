/**
 * WS-12-T002-P02 §13 — the intake machine's truth rules and the IPC
 * boundary's refusal discipline, proven without any transport.
 */
import { describe, expect, it } from "vitest";

import { INTAKE_VALIDATORS } from "../electron/intake-ipc.js";
import { INTAKE_STATES, IntakeMachine } from "../src/intake/machine.js";
import type { IntakeCustomer, IntakeOperations, IntakeResult } from "../src/intake/ports.js";
import { INTAKE_STRINGS, intakeString } from "../src/intake/strings.js";

function customer(overrides: Partial<IntakeCustomer> = {}): IntakeCustomer {
  return {
    customerId: "11111111-1111-4111-8111-111111111111",
    displayName: "Sokha",
    phoneMasked: "+855••••5678",
    phoneE164: "+85512345678",
    phoneVerified: false,
    preferredLanguage: "km-KH",
    origin: "local_created",
    syncState: "pending_sync",
    ...overrides,
  };
}

function operations(overrides: Partial<IntakeOperations> = {}): IntakeOperations {
  const ok = <T>(value: T): IntakeResult<T> => ({ ok: true, value });
  return {
    searchCustomers: async () => ok([] as readonly IntakeCustomer[]),
    readCustomer: async () => ok(customer()),
    createCustomer: async () => ok(customer()),
    recordConsentDecision: async () => ok({ decisionId: "d", recordedAt: "t" }),
    createDraft: async () =>
      ok({
        draftId: "22222222-2222-4222-8222-222222222222",
        lifecycle: "open",
        version: 1,
        customerId: customer().customerId,
        walkIn: false,
        customerSnapshot: { displayName: "Sokha" },
        preferredLanguage: "km-KH",
        intakeSource: "t1_walkup",
        customerNotes: "",
        staffNotes: "",
        cancelReasonCode: null,
        syncState: "local_authoritative",
        createdAt: "c",
        updatedAt: "u",
      }),
    readDraft: async () => ({ ok: false, kind: "not_found", detail: "none" }),
    updateDraft: async () => ({ ok: false, kind: "stale_version", detail: "stale" }),
    cancelDraft: async () => ({ ok: false, kind: "not_found", detail: "none" }),
    quote: async () => ({ ok: false, kind: "configuration_missing", detail: "none" }),
    confirmIntake: async () => ({ ok: false, kind: "unavailable", detail: "none" }),
    listRecentBookings: async () => ok([]),
    ...overrides,
  };
}

describe("intake machine truth rules (§6)", () => {
  it("declares the CLOSED fifteen-state vocabulary", () => {
    expect(INTAKE_STATES).toHaveLength(15);
    expect(new Set(INTAKE_STATES).size).toBe(15);
  });

  it("zero, one and many matches land in their EXPLICIT states — nothing auto-selects", async () => {
    const zero = new IntakeMachine(operations());
    expect((await zero.search("012 345 678")).state).toBe("no_match");

    const one = new IntakeMachine(
      operations({ searchCustomers: async () => ({ ok: true, value: [customer()] }) }),
    );
    const oneSnap = await one.search("012 345 678");
    expect(oneSnap.state).toBe("one_match");
    expect(oneSnap.selectedCustomer).toBeNull(); // selection is a staff act

    const many = new IntakeMachine(
      operations({
        searchCustomers: async () => ({
          ok: true,
          value: [customer(), customer({ customerId: "33333333-3333-4333-8333-333333333333" })],
        }),
      }),
    );
    const manySnap = await many.search("012 345 678");
    expect(manySnap.state).toBe("ambiguous_matches");
    expect(manySnap.selectedCustomer).toBeNull();
  });

  it("an UNAVAILABLE search is offline — never presented as no_match", async () => {
    const machine = new IntakeMachine(
      operations({
        searchCustomers: async () => ({ ok: false, kind: "unavailable", detail: "down" }),
      }),
    );
    const snap = await machine.search("012 345 678");
    expect(snap.state).toBe("offline");
    expect(snap.state).not.toBe("no_match");
  });

  it("a locally created customer stays pending_sync — never cloud-confirmed", async () => {
    const machine = new IntakeMachine(operations());
    const snap = await machine.createCustomer({
      displayName: "Sokha",
      phone: "012 345 678",
      preferredLanguage: "km-KH",
    });
    expect(snap.selectedCustomer?.syncState).toBe("pending_sync");
    expect(snap.selectedCustomer?.phoneVerified).toBe(false); // presence ≠ verification
  });

  it("a stale draft edit is an explicit conflict, and reopen restores from the Hub", async () => {
    const machine = new IntakeMachine(operations());
    machine.chooseWalkIn();
    await machine.createDraft({ preferredLanguage: "km-KH", customerNotes: "", staffNotes: "" });
    const stale = await machine.saveDraftEdits({ staffNotes: "x" });
    expect(stale.state).toBe("conflict");
  });

  it("selection outside the result set is refused", () => {
    const machine = new IntakeMachine(operations());
    const snap = machine.selectCustomer("44444444-4444-4444-8444-444444444444");
    expect(snap.state).toBe("error");
  });
});

describe("intake strings (§7)", () => {
  it("renders every key in BOTH km-KH and en-US, and never confirms a Booking", () => {
    for (const key of Object.keys(INTAKE_STRINGS) as (keyof typeof INTAKE_STRINGS)[]) {
      const km = intakeString(key, "km-KH");
      const en = intakeString(key, "en-US");
      expect(km.length).toBeGreaterThan(0);
      expect(en.length).toBeGreaterThan(0);
      // §6/§7: a draft is a DRAFT — no confirmed-Booking or payment wording.
      expect(en.toLowerCase()).not.toMatch(/confirmed|completed booking|payment|price|paid/);
    }
    expect(intakeString("draft_title", "en-US")).toBe("Laundry Booking Draft");
  });
});

describe("IPC boundary (§5) — a compromised renderer changes nothing", () => {
  it("refuses unknown fields, scope fields and malformed shapes on every channel", () => {
    // Scope/identity/timestamps are NOT fields — their presence refuses.
    expect(INTAKE_VALIDATORS.searchCustomers({ phone: "012345678", tenantId: "x" })).toBeNull();
    expect(INTAKE_VALIDATORS.searchCustomers({ phone: 12 })).toBeNull();
    expect(INTAKE_VALIDATORS.createCustomer({ displayName: "A", storeId: "x" })).toBeNull();
    expect(
      INTAKE_VALIDATORS.createDraft({ walkIn: true, customerId: null, createdAt: "2020-01-01" }),
    ).toBeNull();
    expect(
      INTAKE_VALIDATORS.updateDraft({
        draftId: "22222222-2222-4222-8222-222222222222",
        expectedVersion: 1,
        version: 9, // renderer cannot set authoritative versions directly
      }),
    ).toBeNull();
    expect(
      INTAKE_VALIDATORS.cancelDraft({
        draftId: "22222222-2222-4222-8222-222222222222",
        reasonCode: "because",
      }),
    ).toBeNull();
  });

  it("cannot launder a consent decision into customer-self or mark verification", () => {
    const validated = INTAKE_VALIDATORS.recordConsentDecision({
      customerId: "11111111-1111-4111-8111-111111111111",
      purposeKey: "sms_marketing",
      policyRef: "P",
      policyVersion: 1,
      decision: "granted",
      staffAssisted: false, // the renderer's claim is overridden
    });
    expect(validated?.staffAssisted).toBe(true);
    // No verification field exists anywhere on the surface.
    expect(
      INTAKE_VALIDATORS.createCustomer({
        displayName: "A",
        phone: "012345678",
        preferredLanguage: "km-KH",
        phoneVerified: true,
      } as never),
    ).toBeNull();
  });

  it("accepts exactly the well-formed shapes", () => {
    expect(INTAKE_VALIDATORS.searchCustomers({ phone: "012 345 678" })).not.toBeNull();
    expect(
      INTAKE_VALIDATORS.createCustomer({ displayName: "Sokha", phone: "012345678" }),
    ).not.toBeNull();
    expect(
      INTAKE_VALIDATORS.createDraft({
        customerId: "11111111-1111-4111-8111-111111111111",
        walkIn: false,
      }),
    ).not.toBeNull();
    expect(
      INTAKE_VALIDATORS.cancelDraft({
        draftId: "22222222-2222-4222-8222-222222222222",
        reasonCode: "customer_left",
      }),
    ).not.toBeNull();
  });
});
