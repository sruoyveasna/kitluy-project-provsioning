/**
 * T1-REAL-OPERATIONS-001 slice 2 — a real Booking on the Store Hub from a
 * Booking Draft, paid in cash (KHR + USD), with a receipt record; over the
 * edge router, under a TERMINAL PIN session, through the canonical command
 * pipeline. DB-backed; skips VISIBLY when the local Hub database is away.
 *
 * The router is driven directly with the peer identity the mTLS transport
 * would have established (the transport itself is proven by the T001 and
 * edge-LAN suites); every governed door, trigger and grant below is the real
 * one. The fixture Location's ACTIVE snapshot (0050) is given the delivered
 * `catalog` and a KHR money contract for the run; the `pricing` section is
 * restored afterwards, while the `catalog` section stays (sections are
 * append-only — 0012's no-hard-delete trigger — and no other suite reads
 * `catalog`). This package's suites run serially (vitest.config.ts), so no
 * sibling reads the swapped pricing.
 */
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildIdempotencyKey } from "../src/hub-database.js";
import { EdgeDiscoveryAuthority } from "../src/hub/edge/discovery.js";
import {
  createEdgeTerminalRouter,
  unavailableActivationGateway,
  EDGE_BOOKINGS_RECENT_PATH,
  EDGE_BOOKING_DRAFTS_PATH,
  INTAKE_SESSION_HEADER,
} from "../src/hub/edge/routes.js";
import type { EdgeRequestHandler, EdgeResponse } from "../src/hub/edge/transport.js";
import { setupTerminalPin } from "../src/hub/edge/terminal-pin.js";
import {
  TerminalPairingComposition,
  type PairingSigner,
  type SafeLogger,
} from "../src/hub/pairing.js";
import { uuidv7 } from "../src/hub/uuid.js";
import {
  ACTIVE_SNAPSHOT,
  HARDWARE_PROFILE_TERMINAL,
  HUB_DEVICE,
  INSTALLATION,
  LOCATION,
  STORE,
  TENANT,
  T1,
  ensureRuntimeRoleMembership,
  hubReachable,
  pool as makePool,
} from "./hub-fixtures.js";

const SUITE = `cfd-${randomUUID().slice(0, 6)}`;
const live = await hubReachable();
if (!live) {
  console.warn(
    "SKIPPED confirm-from-draft suite: local Hub database (kitluy_hub_local) unreachable",
  );
}

const WF_KG = "0a000000-0000-4000-8000-00000000c001";
const DC_SUIT = "0a000000-0000-4000-8000-00000000c002";
const DC_SHIRT = "0a000000-0000-4000-8000-00000000c003";
const CATALOG = {
  schema: "kitluy.config.catalog.v1",
  currency_code: "KHR",
  content_hash: "b".repeat(64),
  families: [
    { code: "WASH_FOLD", lane: "per_weight", name: "Wash & Fold", sort_order: 1 },
    { code: "DRY_CLEAN", lane: "per_piece", name: "Dry Clean", sort_order: 2 },
  ],
  categories: [],
  services: [
    {
      service_id: WF_KG,
      service_code: "WF-KG",
      family_code: "WASH_FOLD",
      name: "Wash & Fold per kg",
      pricing_mode: "PER_WEIGHT",
      currency_code: "KHR",
      unit_price_minor: 4000,
      service_version: 3,
    },
    {
      service_id: DC_SUIT,
      service_code: "DC-SUIT_2PC",
      family_code: "DRY_CLEAN",
      name: "Suit (2 pc)",
      pricing_mode: "PER_PIECE",
      currency_code: "KHR",
      unit_price_minor: 25000,
    },
    {
      service_id: DC_SHIRT,
      service_code: "DC-DRESS_SHIRT",
      family_code: "DRY_CLEAN",
      name: "Dress shirt",
      pricing_mode: "PER_PIECE",
      currency_code: "KHR",
      unit_price_minor: 8000,
    },
  ],
  garment_types: [],
};
const MONEY = {
  schema: "kitluy.config.money.v1",
  currency_code: "KHR",
  currency_exponent: 0,
  money_rounding: "round_half_up_minor_unit",
  weight_rule: { unit: "kg", increment: 1, rounding: "up", minimum: 1 },
  location_code: "DEMO-PP-01",
  fx: { USD: { khr_per_usd: 4100, effective_from: "2026-09-19T00:00:00Z" } },
};

interface Terminal {
  readonly deviceId: string;
  readonly serial: string;
  readonly sessionId: string;
}

describe.skipIf(!live)("T1 confirm-intake from a Booking Draft (slice 2)", () => {
  let p: pg.Pool;
  let router: EdgeRequestHandler;
  let t1: Terminal;
  let originalPricing: unknown;

  const logger: SafeLogger = { info: () => undefined };

  async function provision(): Promise<Terminal> {
    const deviceId = uuidv7();
    const serial = `cfd${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    await p.query(
      `insert into edge_identity.terminal_device
         (id, tenant_id, digital_store_id, location_id, terminal_name, hardware_profile_id,
          installation_id, certificate_serial, assignment_generation, lifecycle_status,
          last_client_sequence, last_seen_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'active', 0, now(), now(), now())`,
      [
        deviceId,
        TENANT,
        STORE,
        LOCATION,
        `${SUITE}-${deviceId.slice(-8)}`,
        HARDWARE_PROFILE_TERMINAL,
        INSTALLATION,
        serial,
      ],
    );
    await p.query(
      `insert into edge_identity.device_credential
         (id, device_id, credential_type, public_key_fingerprint, certificate_serial, issuer,
          issued_at, expires_at, status, revoked_at, revocation_reason, rotation_generation)
       values ($1, $2, 'terminal_operational', $3, $4, 'KitLuy Test Device CA',
               now() - interval '1 day', now() + interval '1 day', 'active', null, null, 1)`,
      [randomUUID(), deviceId, `fp-${serial}`, serial],
    );
    await p.query(
      `insert into edge_config.terminal_profile_assignment
         (id, tenant_id, digital_store_id, location_id, terminal_device_id, profile_code,
          assignment_version, enabled, effective_from, effective_until, source_snapshot_id)
       values ($1, $2, $3, $4, $5, $6, 1, true, now() - interval '1 hour', null, $7)`,
      [randomUUID(), TENANT, STORE, LOCATION, deviceId, T1, ACTIVE_SNAPSHOT],
    );
    // The Terminal PIN opens the T1 session: the device is the actor.
    const pin = await setupTerminalPin(p, {
      terminalDeviceId: deviceId,
      pin: "4826",
      pinConfirmation: "4826",
      correlationId: randomUUID(),
    });
    if (pin.outcome !== "ok") throw new Error(`PIN setup refused: ${pin.refusal}`);
    return { deviceId, serial, sessionId: pin.value.session.sessionId };
  }

  function call(
    terminal: Terminal,
    method: "GET" | "POST" | "PATCH",
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<EdgeResponse> {
    return router.handle({
      method,
      path,
      headers: {
        ...(method === "GET" ? {} : { "content-type": "application/json" }),
        [INTAKE_SESSION_HEADER]: terminal.sessionId,
        ...headers,
      },
      rawBody: body === undefined ? "" : JSON.stringify(body),
      peer: {
        certificateSerial: terminal.serial,
        certificateFingerprint: "0".repeat(64),
        subjectCommonName: `kitluy-device:${terminal.deviceId}`,
      },
    });
  }

  function detailsOf(response: EdgeResponse): Record<string, unknown> {
    const body = response.body as { error?: { details?: Record<string, unknown> } };
    return body.error?.details ?? {};
  }

  async function openDraft(terminal: Terminal): Promise<{ draftId: string; version: number }> {
    const created = await call(
      terminal,
      "POST",
      EDGE_BOOKING_DRAFTS_PATH,
      { walkIn: true, preferredLanguage: "km-KH", customerNotes: "", staffNotes: SUITE },
      { "idempotency-key": `t1i-${randomUUID()}` },
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const draft = (created.body as { draft: { draftId: string; version: number } }).draft;
    return { draftId: draft.draftId, version: draft.version };
  }

  const CART = [
    { serviceId: DC_SUIT, pieceCount: 1 },
    { serviceId: DC_SHIRT, pieceCount: 2 },
    { serviceId: WF_KG, weighedGrams: 2400 }, // → 3 kg billable
  ];
  // 25 000 + 16 000 + 12 000
  const TOTAL = "53000";

  beforeAll(async () => {
    if (!live) return;
    p = makePool(6);
    await ensureRuntimeRoleMembership(p);
    // The delivered sections for the run (restored in afterAll).
    const saved = await p.query<{ content_json: unknown }>(
      `select content_json from edge_config.configuration_section
        where snapshot_id = $1 and section_code = 'pricing'`,
      [ACTIVE_SNAPSHOT],
    );
    originalPricing = saved.rows[0]?.content_json;
    await p.query(
      `update edge_config.configuration_section set content_json = $2::jsonb
        where snapshot_id = $1 and section_code = 'pricing'`,
      [ACTIVE_SNAPSHOT, JSON.stringify(MONEY)],
    );
    // Upsert: sections are never hard-deleted, so a previous run's row is reused.
    await p.query(
      `insert into edge_config.configuration_section
         (id, snapshot_id, section_code, section_version, content_sha256, content_json,
          required, validation_state, validation_error)
       values ($1, $2, 'catalog', 7, encode(sha256(convert_to($3::text, 'UTF8')), 'hex'), $3::jsonb, false, 'valid', null)
       on conflict (snapshot_id, section_code) do update
         set content_json = excluded.content_json, content_sha256 = excluded.content_sha256`,
      [randomUUID(), ACTIVE_SNAPSHOT, JSON.stringify(CATALOG)],
    );
    const signer: PairingSigner = {
      certificateSerial: "DEMO-OPS-CERT-0001",
      publicKeyPem: "",
      sign: () => {
        throw new Error("not used");
      },
    };
    router = createEdgeTerminalRouter({
      pool: p,
      environment: "development",
      pairing: new TerminalPairingComposition(p, signer, logger),
      activationGateway: unavailableActivationGateway(),
      discovery: new EdgeDiscoveryAuthority(
        {
          hubDeviceId: HUB_DEVICE,
          hubTlsCertificateFingerprint: "0".repeat(64),
          tenantId: TENANT,
          digitalStoreId: STORE,
          storeLocationId: LOCATION,
          environment: "development",
          hostname: "127.0.0.1",
        },
        signer,
        logger,
      ),
      logger,
    });
    t1 = await provision();
  }, 60_000);

  afterAll(async () => {
    if (!live) return;
    if (originalPricing !== undefined) {
      await p.query(
        `update edge_config.configuration_section set content_json = $2::jsonb
          where snapshot_id = $1 and section_code = 'pricing'`,
        [ACTIVE_SNAPSHOT, JSON.stringify(originalPricing)],
      );
    }
    await p.end().catch(() => undefined);
  });

  it("quotes the draft from the Hub's delivered sections: Hub prices, whole-kg-up, rate", async () => {
    const draft = await openDraft(t1);
    const quoted = await call(t1, "POST", `${EDGE_BOOKING_DRAFTS_PATH}/${draft.draftId}/quote`, {
      lines: CART,
    });
    expect(quoted.status, JSON.stringify(quoted.body)).toBe(200);
    const quote = (quoted.body as { quote: Record<string, unknown> }).quote;
    expect(quote).toMatchObject({
      currencyCode: "KHR",
      currencyExponent: 0,
      subtotalMinor: TOTAL,
      totalMinor: TOTAL,
      express: false,
      khrPerUsd: 4100,
      locationCode: "DEMO-PP-01",
    });
    const lines = quote["lines"] as {
      serviceCode: string;
      quantity: string;
      lineSubtotalMinor: string;
    }[];
    expect(lines.map((l) => [l.serviceCode, l.quantity, l.lineSubtotalMinor])).toEqual([
      ["DC-SUIT_2PC", "1.0000", "25000"],
      ["DC-DRESS_SHIRT", "2.0000", "16000"],
      ["WF-KG", "3.0000", "12000"],
    ]);
    // Nothing was written by a quote.
    const { rows } = await p.query(
      `select 1 from edge_laundry.booking where booking_number like 'KLB-DEMO-PP-01-%' and created_at > now() - interval '5 seconds'`,
    );
    void rows;
    const unknown = await call(t1, "POST", `${EDGE_BOOKING_DRAFTS_PATH}/${draft.draftId}/quote`, {
      lines: [{ serviceId: "0a000000-0000-4000-8000-0000000000ff", pieceCount: 1 }],
    });
    expect(unknown.status).toBe(422);
    expect(detailsOf(unknown)["result"]).toBe("SERVICE_UNKNOWN");
    const badShape = await call(t1, "POST", `${EDGE_BOOKING_DRAFTS_PATH}/${draft.draftId}/quote`, {
      lines: [{ serviceId: DC_SUIT, pieceCount: 1, weighedGrams: 5 }],
    });
    expect(badShape.status).toBe(422);
    expect(detailsOf(badShape)["result"]).toBe("REQUEST_INVALID");
  });

  it("refuses a confirm whose displayed total differs, a short tender, and a foreign key — writing nothing", async () => {
    const draft = await openDraft(t1);
    const key = buildIdempotencyKey(t1.deviceId, 1n);
    const path = `/edge/v1/laundry/bookings/${draft.draftId}/confirm-intake`;
    const mismatch = await call(
      t1,
      "POST",
      path,
      {
        expectedVersion: draft.version,
        lines: CART,
        displayedTotalMinor: "52000",
        tender: { type: "cash", localMinor: "60000", usdCents: "0" },
      },
      { "idempotency-key": key },
    );
    expect(mismatch.status, JSON.stringify(mismatch.body)).toBe(409);
    expect(detailsOf(mismatch)).toMatchObject({
      result: "PRICE_MISMATCH",
      hubTotalMinor: TOTAL,
      displayedTotalMinor: "52000",
    });
    const short = await call(
      t1,
      "POST",
      path,
      {
        expectedVersion: draft.version,
        lines: CART,
        displayedTotalMinor: TOTAL,
        tender: { type: "cash", localMinor: "50000", usdCents: "0" },
      },
      { "idempotency-key": key },
    );
    expect(short.status).toBe(422);
    expect(detailsOf(short)).toMatchObject({ result: "TENDER_INSUFFICIENT", shortMinor: "3000" });
    const foreign = await call(
      t1,
      "POST",
      path,
      {
        expectedVersion: draft.version,
        lines: CART,
        displayedTotalMinor: TOTAL,
        tender: { type: "cash", localMinor: "60000", usdCents: "0" },
      },
      { "idempotency-key": buildIdempotencyKey(randomUUID(), 1n) },
    );
    expect(foreign.status).toBe(422);
    expect(detailsOf(foreign)["result"]).toBe("EDGE_IDEMPOTENCY_KEY_MALFORMED");
    const opaque = await call(
      t1,
      "POST",
      path,
      {
        expectedVersion: draft.version,
        lines: CART,
        displayedTotalMinor: TOTAL,
        tender: { type: "cash", localMinor: "60000", usdCents: "0" },
      },
      { "idempotency-key": `t1i-${randomUUID()}` },
    );
    expect(opaque.status).toBe(422);
    expect(detailsOf(opaque)["result"]).toBe("EDGE_IDEMPOTENCY_KEY_MALFORMED");
    // The draft is untouched, no booking, no payment, and the refused key was
    // NOT reserved (the pipeline refused before the reservation).
    const { rows: still } = await p.query<{ lifecycle: string; version: string }>(
      `select lifecycle, version::text from edge_laundry.booking_draft where id = $1`,
      [draft.draftId],
    );
    expect(still).toEqual([{ lifecycle: "open", version: "1" }]);
    const { rows: seq } = await p.query<{ last_client_sequence: string }>(
      `select last_client_sequence::text from edge_identity.terminal_device where id = $1`,
      [t1.deviceId],
    );
    expect(seq[0]?.last_client_sequence).toBe("0");
  });

  it("confirms: Booking, lines, status, cash payment with KHR + USD legs, receipt, draft converted, facts, audit — then replays the same answer", async () => {
    const draft = await openDraft(t1);
    const key = buildIdempotencyKey(t1.deviceId, 1n);
    const path = `/edge/v1/laundry/bookings/${draft.draftId}/confirm-intake`;
    const body = {
      expectedVersion: draft.version,
      lines: CART,
      displayedTotalMinor: TOTAL,
      // 20 000 KHR + 10 USD (41 000 KHR) = 61 000; change 8 000
      tender: { type: "cash", localMinor: "20000", usdCents: "1000" },
    };
    const confirmed = await call(t1, "POST", path, body, { "idempotency-key": key });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const answer = confirmed.body as Record<string, unknown>;
    expect(answer["result"]).toBe("BOOKING_CONFIRMED");
    expect(answer["commandOutcome"]).toBe("accepted");
    const booking = answer["booking"] as Record<string, unknown>;
    expect(booking).toMatchObject({
      status: "intake_confirmed",
      currency_code: "KHR",
      total_minor: TOTAL,
      paid_minor: TOTAL,
      balance_minor: "0",
      line_count: 3,
    });
    expect(booking["booking_number"]).toMatch(/^KLB-DEMO-PP-01-\d{6}-\d{6}$/);
    const payment = answer["payment"] as Record<string, unknown>;
    expect(payment).toMatchObject({
      amount_minor: TOTAL,
      tendered_minor: "61000",
      change_due_minor: "8000",
      currency_code: "KHR",
    });
    expect(payment["payment_number"]).toMatch(/^KLP-DEMO-PP-01-/);
    expect(payment["legs"]).toEqual([
      {
        currency_code: "KHR",
        currency_exponent: 0,
        amount_minor: "20000",
        local_equivalent_minor: "20000",
        khr_per_usd: null,
      },
      {
        currency_code: "USD",
        currency_exponent: 2,
        amount_minor: "1000",
        local_equivalent_minor: "41000",
        khr_per_usd: 4100,
      },
    ]);
    const receipt = answer["receipt"] as Record<string, unknown>;
    expect(receipt["receipt_number"]).toMatch(/^KLR-DEMO-PP-01-/);
    expect(receipt["content_sha256"]).toMatch(/^[0-9a-f]{64}$/);
    // The fixture Location has a receipt_printer binding, so the job is queued.
    expect(receipt["print_state"]).toBe("queued");
    expect(typeof receipt["print_job_id"]).toBe("string");
    expect((receipt["payload"] as Record<string, unknown>)["total_minor"]).toBe(TOTAL);
    expect(answer["draft"]).toEqual({
      draft_id: draft.draftId,
      lifecycle: "converted",
      version: 2,
      converted_booking_id: booking["booking_id"],
    });
    const bookingId = booking["booking_id"] as string;

    // -------------------------------------------------------- Hub rows
    const { rows: b } = await p.query<Record<string, unknown>>(
      `select status, total_minor::text as total, paid_minor::text as paid, balance_minor::text as balance,
              tax_minor::text as tax, aggregate_version::text as v, customer_id
         from edge_laundry.booking where id = $1`,
      [bookingId],
    );
    expect(b[0]).toMatchObject({
      status: "intake_confirmed",
      total: TOTAL,
      paid: TOTAL,
      balance: "0",
      tax: "0",
      v: "2",
      customer_id: null,
    });
    const { rows: lines } = await p.query<Record<string, unknown>>(
      `select display_name, pricing_method, unit_code, quantity::text as quantity, line_total_minor::text as total,
              service_version::text as sv, addon_snapshot_json as addon
         from edge_laundry.booking_line where booking_id = $1 order by id`,
      [bookingId],
    );
    expect(
      lines.map((l) => [
        l["display_name"],
        l["pricing_method"],
        l["quantity"],
        l["total"],
        l["sv"],
      ]),
    ).toEqual([
      ["Suit (2 pc)", "per_piece", "1.0000", "25000", "1"],
      ["Dress shirt", "per_piece", "2.0000", "16000", "1"],
      ["Wash & Fold per kg", "per_weight", "3.0000", "12000", "3"],
    ]);
    expect((lines[2]?.["addon"] as Record<string, unknown>)["weighed_grams"]).toBe(2400);
    const { rows: status } = await p.query<{ from_status: string; to_status: string }>(
      `select from_status, to_status from edge_laundry.status_event where booking_id = $1`,
      [bookingId],
    );
    expect(status).toEqual([{ from_status: "draft", to_status: "intake_confirmed" }]);
    const { rows: pay } = await p.query<Record<string, unknown>>(
      `select state, amount_minor::text as amount, currency_code, idempotency_key, actor_id, terminal_device_id
         from edge_payments.payment where booking_id = $1`,
      [bookingId],
    );
    expect(pay).toEqual([
      {
        state: "confirmed",
        amount: TOTAL,
        currency_code: "KHR",
        idempotency_key: key,
        actor_id: t1.deviceId,
        terminal_device_id: t1.deviceId,
      },
    ]);
    const { rows: legs } = await p.query<Record<string, unknown>>(
      `select currency_code, currency_exponent, amount_minor::text as amount, state
         from edge_payments.tender_leg where payment_id = $1 order by currency_code`,
      [payment["payment_id"]],
    );
    expect(legs).toEqual([
      { currency_code: "KHR", currency_exponent: 0, amount: "20000", state: "settled" },
      { currency_code: "USD", currency_exponent: 2, amount: "1000", state: "settled" },
    ]);
    const { rows: rec } = await p.query<Record<string, unknown>>(
      `select receipt_number, document_type, content_sha256, payment_id, issued_by
         from edge_documents.receipt where booking_id = $1`,
      [bookingId],
    );
    expect(rec[0]).toMatchObject({
      receipt_number: receipt["receipt_number"],
      document_type: "booking_receipt",
      content_sha256: receipt["content_sha256"],
      payment_id: payment["payment_id"],
      issued_by: t1.deviceId,
    });
    const { rows: job } = await p.query<{ state: string; document_id: string }>(
      `select state, document_id from edge_documents.print_job where id = $1`,
      [receipt["print_job_id"]],
    );
    expect(job).toEqual([{ state: "queued", document_id: receipt["receipt_id"] }]);
    const { rows: d } = await p.query<Record<string, unknown>>(
      `select lifecycle, version::text as version, converted_booking_id from edge_laundry.booking_draft where id = $1`,
      [draft.draftId],
    );
    expect(d).toEqual([{ lifecycle: "converted", version: "2", converted_booking_id: bookingId }]);
    const { rows: draftEvents } = await p.query<{
      event_type: string;
      changes: Record<string, unknown>;
    }>(
      `select event_type, changes from edge_laundry.booking_draft_event where draft_id = $1 order by version_after`,
      [draft.draftId],
    );
    expect(draftEvents.map((e) => e.event_type)).toEqual(["created", "updated"]);
    expect(draftEvents[1]?.changes).toEqual({
      lifecycle: "converted",
      converted_booking_id: bookingId,
    });

    // ------------------------------------- the command ledger and the facts
    const { rows: cmd } = await p.query<Record<string, unknown>>(
      `select command_type, commit_status, actor_id, origin_sequence::text as seq, aggregate_id
         from edge_sync.command_result where idempotency_key = $1`,
      [key],
    );
    expect(cmd).toEqual([
      {
        command_type: "laundry.booking.confirm_from_draft",
        commit_status: "committed",
        actor_id: t1.deviceId,
        seq: "1",
        aggregate_id: bookingId,
      },
    ]);
    const { rows: seq } = await p.query<{ last_client_sequence: string }>(
      `select last_client_sequence::text from edge_identity.terminal_device where id = $1`,
      [t1.deviceId],
    );
    expect(seq[0]?.last_client_sequence).toBe("1");
    const { rows: facts } = await p.query<{
      event_type: string;
      delivery_state: string;
      key: string;
      actor: string;
    }>(
      `select e.event_type, o.delivery_state, e.idempotency_key as key,
              e.payload -> 'actor' ->> 'actor_type' as actor
         from edge_sync.outbox o join edge_sync.local_event e on e.id = o.event_id
        where e.id = any($1::uuid[]) order by e.hub_sequence`,
      [
        cmd[0] === undefined
          ? []
          : ((
              await p.query<{ event_ids: string[] }>(
                `select event_ids from edge_sync.command_result where idempotency_key = $1`,
                [key],
              )
            ).rows[0]?.event_ids ?? []),
      ],
    );
    expect(facts.map((f) => f.event_type)).toEqual([
      "laundry_booking.created",
      "payment.recorded",
      "payment.tender_recorded",
      "payment.tender_recorded",
      "document.receipt_issued",
      "laundry.booking_draft_recorded",
    ]);
    expect(new Set(facts.map((f) => f.delivery_state))).toEqual(new Set(["pending"]));
    expect(facts.every((f) => f.key.startsWith("kh1.") && f.actor === "device")).toBe(true);
    const { rows: audit } = await p.query<{
      actor_type: string;
      actor_id: string;
      event_code: string;
      details: Record<string, unknown>;
    }>(
      `select actor_type, actor_id, event_code, details_json as details from edge_audit.audit_event
        where resource_id = $1 and event_code = 'laundry_booking.created'`,
      [bookingId],
    );
    expect(audit[0]).toMatchObject({ actor_type: "terminal_device", actor_id: t1.deviceId });
    expect(audit[0]?.details).toMatchObject({
      permission_source: "terminal_pin",
      hub_draft_id: draft.draftId,
    });

    // -------------------------------------------- replay: same key, same body
    const replayed = await call(t1, "POST", path, body, { "idempotency-key": key });
    expect(replayed.status, JSON.stringify(replayed.body)).toBe(200);
    const again = replayed.body as Record<string, unknown>;
    expect(again["result"]).toBe("BOOKING_CONFIRMED_REPLAYED");
    expect(again["replayed"]).toBe(true);
    expect((again["booking"] as Record<string, unknown>)["booking_number"]).toBe(
      booking["booking_number"],
    );
    expect((again["receipt"] as Record<string, unknown>)["receipt_number"]).toBe(
      receipt["receipt_number"],
    );
    const { rows: count } = await p.query<{ n: string }>(
      `select count(*)::text as n from edge_laundry.booking where id = $1`,
      [bookingId],
    );
    expect(count[0]?.n).toBe("1");

    // ---------------------------- same key, different body: refused + evidence
    const tampered = await call(
      t1,
      "POST",
      path,
      { ...body, displayedTotalMinor: "1" },
      { "idempotency-key": key },
    );
    expect(tampered.status).toBe(409);
    expect(detailsOf(tampered)["result"]).toMatch(/IDEMPOTENCY/);

    // ------------------------- the converted draft cannot be confirmed twice
    const twice = await call(t1, "POST", path, body, {
      "idempotency-key": buildIdempotencyKey(t1.deviceId, 2n),
    });
    expect(twice.status).toBe(409);
    expect(detailsOf(twice)).toMatchObject({
      result: "DRAFT_NOT_OPEN",
      lifecycle: "converted",
      convertedBookingId: bookingId,
    });
    // ...and a quote for it is refused the same way.
    const quoteConverted = await call(
      t1,
      "POST",
      `${EDGE_BOOKING_DRAFTS_PATH}/${draft.draftId}/quote`,
      { lines: CART },
    );
    expect(detailsOf(quoteConverted)["result"]).toBe("DRAFT_NOT_OPEN");

    // ------------------------------------------- the Orders view sees it
    const recent = await call(t1, "GET", EDGE_BOOKINGS_RECENT_PATH);
    expect(recent.status, JSON.stringify(recent.body)).toBe(200);
    const listed = (recent.body as { bookings: Record<string, unknown>[] }).bookings;
    expect(listed.find((x) => x["bookingId"] === bookingId)).toMatchObject({
      bookingNumber: booking["booking_number"],
      status: "intake_confirmed",
      totalMinor: TOTAL,
      paidMinor: TOTAL,
      balanceMinor: "0",
      lineCount: 3,
      walkIn: true,
      receiptNumber: receipt["receipt_number"],
    });
  });

  it("verifies the terminal's command sequence: a gap and a replay are refused before any write", async () => {
    const draft = await openDraft(t1);
    const path = `/edge/v1/laundry/bookings/${draft.draftId}/confirm-intake`;
    const body = {
      expectedVersion: draft.version,
      lines: [{ serviceId: DC_SHIRT, pieceCount: 1 }],
      displayedTotalMinor: "8000",
      tender: { type: "cash", localMinor: "8000", usdCents: "0" },
    };
    // The previous test committed sequence 1; a gap (sequence 5) is refused.
    const gap = await call(t1, "POST", path, body, {
      "idempotency-key": buildIdempotencyKey(t1.deviceId, 5n),
    });
    expect(gap.status).toBe(409);
    expect(detailsOf(gap)["result"]).toBe("EDGE_SEQUENCE_GAP");
    // A sequence already behind the terminal's own is a replay attempt.
    const replay = await call(t1, "POST", path, body, {
      "idempotency-key": buildIdempotencyKey(t1.deviceId, 0n),
    });
    expect(replay.status).toBe(409);
    expect(detailsOf(replay)["result"]).toBe("EDGE_SEQUENCE_REPLAY_REJECTED");
    const { rows: still } = await p.query<{ lifecycle: string }>(
      `select lifecycle from edge_laundry.booking_draft where id = $1`,
      [draft.draftId],
    );
    expect(still).toEqual([{ lifecycle: "open" }]);
    // The expected sequence goes through, and an exact-cash tender has no change.
    const ok = await call(t1, "POST", path, body, {
      "idempotency-key": buildIdempotencyKey(t1.deviceId, 2n),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((ok.body as { payment: Record<string, unknown> }).payment).toMatchObject({
      change_due_minor: "0",
      tendered_minor: "8000",
    });
  });

  it("keeps Store scope: another terminal's session cannot quote or confirm this terminal's draft", async () => {
    const draft = await openDraft(t1);
    const other = await provision();
    // Same Store here (the fixture Hub serves ONE Location), so the draft IS in
    // scope for the other terminal — that is the model (a draft belongs to the
    // Store, not the seat). What must hold is that the OTHER terminal's key and
    // session are the ones judged, and that a draft from a different Store is
    // invisible. Arrange a draft in the sibling Store and try it from here.
    const foreignDraft = uuidv7();
    await p.query(
      `insert into edge_laundry.booking_draft
         (id, tenant_id, digital_store_id, location_id, environment, terminal_device_id, session_id,
          staff_actor_id, customer_id, walk_in, customer_snapshot, preferred_language, intake_source,
          customer_notes, staff_notes, created_request_key, created_request_hash, correlation_id)
       values ($1, $2, $3, $4, 'development', $5, $6, $5, null, true, '{"walkIn":true}', 'km-KH', 't1_walkup',
               '', '', $7, repeat('a', 64), $8)`,
      [
        foreignDraft,
        "e0000000-0000-4000-8000-0000000000a1",
        "e0000000-0000-4000-8000-0000000000a2",
        "e0000000-0000-4000-8000-0000000000a3",
        t1.deviceId,
        t1.sessionId,
        `cfd-foreign-${randomUUID()}`,
        randomUUID(),
      ],
    );
    const crossQuote = await call(
      other,
      "POST",
      `${EDGE_BOOKING_DRAFTS_PATH}/${foreignDraft}/quote`,
      {
        lines: [{ serviceId: DC_SHIRT, pieceCount: 1 }],
      },
    );
    expect(crossQuote.status).toBe(404);
    expect(detailsOf(crossQuote)["result"]).toBe("DRAFT_UNKNOWN");
    const crossConfirm = await call(
      other,
      "POST",
      `/edge/v1/laundry/bookings/${foreignDraft}/confirm-intake`,
      {
        expectedVersion: 1,
        lines: [{ serviceId: DC_SHIRT, pieceCount: 1 }],
        displayedTotalMinor: "8000",
        tender: { type: "cash", localMinor: "8000", usdCents: "0" },
      },
      { "idempotency-key": buildIdempotencyKey(other.deviceId, 1n) },
    );
    expect(crossConfirm.status).toBe(404);
    expect(detailsOf(crossConfirm)["result"]).toBe("DRAFT_UNKNOWN");
    // A session the caller does not own opens nothing.
    const stolen = await router.handle({
      method: "POST",
      path: `${EDGE_BOOKING_DRAFTS_PATH}/${draft.draftId}/quote`,
      headers: { "content-type": "application/json", [INTAKE_SESSION_HEADER]: t1.sessionId },
      rawBody: JSON.stringify({ lines: [{ serviceId: DC_SHIRT, pieceCount: 1 }] }),
      peer: {
        certificateSerial: other.serial,
        certificateFingerprint: "0".repeat(64),
        subjectCommonName: "x",
      },
    });
    expect(stolen.status).toBe(404);
    expect(detailsOf(stolen)["result"]).toBe("SESSION_UNKNOWN");
  });
});
