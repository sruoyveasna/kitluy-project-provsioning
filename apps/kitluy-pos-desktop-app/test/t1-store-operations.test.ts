/**
 * T1-REAL-OPERATIONS-001 slice 2 on the terminal side, without a Hub:
 *
 *   - the IPC boundary for quote / confirm-intake / recent Bookings is CLOSED:
 *     money crosses as decimal strings, a line has exactly one quantity kind,
 *     cash is the only tender and its type is not even a field;
 *   - the confirm adapter's command-key discipline: the key is minted from the
 *     Hub's `nextClientSequence`, replayed unchanged after a lost answer,
 *     released after a governed refusal, advanced only on acceptance, and
 *     re-seeded once on a sequence refusal;
 *   - the tender arithmetic the face displays uses the vertical's conversion.
 */
import { describe, expect, it } from "vitest";

import { INTAKE_CHANNELS, INTAKE_VALIDATORS } from "../electron/intake-ipc.js";
import {
  createHubSeededCommandSequence,
  createIntakeOperationsWithCall,
} from "../electron/t1-intake-client.js";
import type { HubCall } from "../electron/edge-operations-session.js";
import { tenderedKhr } from "../src/vertical/laundry/face/features/t1-pos/new-order/Step2Pricing.js";

const DRAFT = "22222222-2222-4222-8222-222222222222";
const TERMINAL = "7a6f1e26-21c8-4a40-8b4b-1ad789a040e9";
const SUIT = "0a000000-0000-4000-8000-000000000002";
const KG = "0a000000-0000-4000-8000-000000000001";

describe("the slice-2 IPC boundary", () => {
  it("names exactly three new channels", () => {
    expect(INTAKE_CHANNELS.quote).toBe("kitluy:t1:intake:quote");
    expect(INTAKE_CHANNELS.confirmIntake).toBe("kitluy:t1:intake:confirm-intake");
    expect(INTAKE_CHANNELS.listRecentBookings).toBe("kitluy:t1:intake:list-recent-bookings");
    expect(Object.keys(INTAKE_CHANNELS)).toHaveLength(11);
  });

  it("accepts a well-formed quote and confirm, lower-casing service ids", () => {
    expect(
      INTAKE_VALIDATORS.quote({
        draftId: DRAFT,
        lines: [
          { serviceId: SUIT.toUpperCase(), pieceCount: 2 },
          { serviceId: KG, weighedGrams: 2400 },
        ],
      }),
    ).toEqual({
      draftId: DRAFT,
      lines: [
        { serviceId: SUIT, pieceCount: 2 },
        { serviceId: KG, weighedGrams: 2400 },
      ],
      express: false,
    });
    expect(
      INTAKE_VALIDATORS.confirmIntake({
        draftId: DRAFT,
        expectedVersion: 1,
        lines: [{ serviceId: SUIT, pieceCount: 1 }],
        express: false,
        displayedTotalMinor: "25000",
        tender: { localMinor: "20000", usdCents: "1000" },
      }),
    ).toEqual({
      draftId: DRAFT,
      expectedVersion: 1,
      lines: [{ serviceId: SUIT, pieceCount: 1 }],
      express: false,
      displayedTotalMinor: "25000",
      tender: { localMinor: "20000", usdCents: "1000" },
    });
    expect(INTAKE_VALIDATORS.listRecentBookings(undefined)).toEqual({});
  });

  it.each([
    [
      "a line with both quantities",
      { draftId: DRAFT, lines: [{ serviceId: SUIT, pieceCount: 1, weighedGrams: 1 }] },
    ],
    ["a line with neither", { draftId: DRAFT, lines: [{ serviceId: SUIT }] }],
    ["a fractional count", { draftId: DRAFT, lines: [{ serviceId: SUIT, pieceCount: 1.5 }] }],
    ["a zero weight", { draftId: DRAFT, lines: [{ serviceId: KG, weighedGrams: 0 }] }],
    [
      "a price on the line",
      { draftId: DRAFT, lines: [{ serviceId: SUIT, pieceCount: 1, unitPriceMinor: "1" }] },
    ],
    ["a non-uuid service", { draftId: DRAFT, lines: [{ serviceId: "WF-KG", weighedGrams: 1000 }] }],
    [
      "a scope field",
      { draftId: DRAFT, lines: [{ serviceId: SUIT, pieceCount: 1 }], locationId: "x" },
    ],
    [
      "too many lines",
      {
        draftId: DRAFT,
        lines: Array.from({ length: 201 }, () => ({ serviceId: SUIT, pieceCount: 1 })),
      },
    ],
  ])("quote refuses %s", (_name, payload) => {
    expect(INTAKE_VALIDATORS.quote(payload)).toBeNull();
  });

  it.each([
    ["a float total", { displayedTotalMinor: 25000 }],
    ["a negative total", { displayedTotalMinor: "-1" }],
    ["a decimal total", { displayedTotalMinor: "250.00" }],
    ["a tender type", { tender: { localMinor: "1", usdCents: "0", type: "card" } }],
    ["a gateway tender", { tender: { localMinor: "1", usdCents: "0", provider: "x" } }],
    ["a float tender", { tender: { localMinor: 1, usdCents: "0" } }],
    ["no lines", { lines: [] }],
    ["a version of zero", { expectedVersion: 0 }],
    ["an authoritative field", { bookingNumber: "KLB-1" }],
  ])("confirm refuses %s", (_name, override) => {
    expect(
      INTAKE_VALIDATORS.confirmIntake({
        draftId: DRAFT,
        expectedVersion: 1,
        lines: [{ serviceId: SUIT, pieceCount: 1 }],
        displayedTotalMinor: "25000",
        tender: { localMinor: "25000", usdCents: "0" },
        ...override,
      }),
    ).toBeNull();
    expect(INTAKE_VALIDATORS.listRecentBookings({ locationId: "x" })).toBeNull();
  });
});

describe("the confirm adapter's command key", () => {
  const body = {
    draftId: DRAFT,
    expectedVersion: 1,
    lines: [{ serviceId: SUIT, pieceCount: 1 }],
    express: false,
    displayedTotalMinor: "25000",
    tender: { localMinor: "25000", usdCents: "0" },
  };
  const confirmed = (key: string) => ({
    status: 200,
    body: {
      result: "BOOKING_CONFIRMED",
      booking: { booking_number: `KLB-${key.slice(-1)}` },
      receipt: { payload: {} },
      draft: {},
      payment: null,
      lines: [],
    },
  });
  const refused = (result: string, status = 409) => ({
    status,
    body: { error: { details: { result } } },
  });

  function harness(
    answers: ((key: string) => Promise<{ status: number; body: unknown }>)[],
    seeds: string[],
  ) {
    const keys: string[] = [];
    let seedReads = 0;
    const call: HubCall = async (_method, _path, _body, headers) => {
      const key = headers?.["idempotency-key"] ?? "";
      keys.push(key);
      const next = answers.shift();
      if (next === undefined) throw new Error("no answer scripted");
      return next(key);
    };
    const sequence = createHubSeededCommandSequence({
      terminalDeviceId: () => TERMINAL,
      readNextClientSequence: async () => {
        seedReads += 1;
        return seeds.shift() ?? null;
      },
    });
    const ops = createIntakeOperationsWithCall({
      call,
      sessionId: DRAFT,
      commandSequence: sequence,
    });
    return { ops, keys, seedReads: () => seedReads };
  }

  it("mints kl1.{terminal}.{sequence} from the Hub's seed and advances only on acceptance", async () => {
    const h = harness([async (k) => confirmed(k), async (k) => confirmed(k)], ["7"]);
    const first = await h.ops.confirmIntake(body);
    expect(first.ok).toBe(true);
    const second = await h.ops.confirmIntake({
      ...body,
      draftId: "33333333-3333-4333-8333-333333333333",
    });
    expect(second.ok).toBe(true);
    expect(h.keys).toEqual([`kl1.${TERMINAL}.7`, `kl1.${TERMINAL}.8`]);
    expect(h.seedReads()).toBe(1);
  });

  it("replays the SAME key after a lost answer, and the Hub's replay reads as such", async () => {
    const h = harness(
      [
        async () => {
          throw new Error("socket closed");
        },
        async (k) => ({
          ...confirmed(k),
          body: { ...confirmed(k).body, result: "BOOKING_CONFIRMED_REPLAYED" },
        }),
      ],
      ["3", "4"],
    );
    const lost = await h.ops.confirmIntake(body);
    expect(lost).toMatchObject({ ok: false, kind: "unavailable" });
    const again = await h.ops.confirmIntake(body);
    expect(again.ok && again.value.outcome).toBe("replayed");
    expect(h.keys).toEqual([`kl1.${TERMINAL}.3`, `kl1.${TERMINAL}.3`]);
  });

  it("releases the key after a governed refusal (nothing was written) and reuses the sequence", async () => {
    const h = harness(
      [
        async () => refused("PRICE_MISMATCH"),
        async () => refused("TENDER_INSUFFICIENT", 422),
        async (k) => confirmed(k),
      ],
      ["5"],
    );
    expect(await h.ops.confirmIntake(body)).toMatchObject({ ok: false, kind: "price_mismatch" });
    expect(await h.ops.confirmIntake(body)).toMatchObject({
      ok: false,
      kind: "tender_insufficient",
    });
    expect((await h.ops.confirmIntake(body)).ok).toBe(true);
    expect(h.keys).toEqual([`kl1.${TERMINAL}.5`, `kl1.${TERMINAL}.5`, `kl1.${TERMINAL}.5`]);
  });

  it("re-seeds from the Hub once on a sequence refusal, then gives up honestly", async () => {
    const h = harness(
      [async () => refused("EDGE_SEQUENCE_GAP"), async (k) => confirmed(k)],
      ["9", "2"],
    );
    const ok = await h.ops.confirmIntake(body);
    expect(ok.ok).toBe(true);
    expect(h.keys).toEqual([`kl1.${TERMINAL}.9`, `kl1.${TERMINAL}.2`]);
    expect(h.seedReads()).toBe(2);
    const g = harness(
      [
        async () => refused("EDGE_SEQUENCE_REPLAY_REJECTED"),
        async () => refused("EDGE_SEQUENCE_GAP"),
      ],
      ["1", "1"],
    );
    expect(await g.ops.confirmIntake(body)).toMatchObject({ ok: false, kind: "conflict" });
  });

  it("answers unavailable when the terminal has no sequence from the Hub, and never calls", async () => {
    const h = harness([], []);
    expect(await h.ops.confirmIntake(body)).toMatchObject({ ok: false, kind: "unavailable" });
    expect(h.keys).toEqual([]);
    const none = createIntakeOperationsWithCall({
      call: async () => ({ status: 200, body: {} }),
      sessionId: DRAFT,
    });
    expect(await none.confirmIntake(body)).toMatchObject({ ok: false, kind: "unavailable" });
  });
});

describe("the tender the face displays", () => {
  it("adds riel and dollars at the delivered rate, and has no dollars without one", () => {
    expect(tenderedKhr("20000", "10", 4100)).toEqual({
      khr: 20_000n,
      usdCents: 1_000n,
      usdAsKhr: 41_000n,
      total: 61_000n,
    });
    expect(tenderedKhr("20000", "10", null)).toEqual({
      khr: 20_000n,
      usdCents: 0n,
      usdAsKhr: 0n,
      total: 20_000n,
    });
    expect(tenderedKhr("", "", 4100).total).toBe(0n);
  });
});
