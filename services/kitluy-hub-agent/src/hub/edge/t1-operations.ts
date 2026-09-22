/**
 * T1 Store operations over the LAN — T1-REAL-OPERATIONS-001 slice 2.
 *
 * Three operations a Terminal PIN session may perform on its own Booking
 * Drafts, composed for the edge router:
 *
 *   quote     POST /edge/v1/laundry/bookings/drafts/{draftId}/quote
 *             The Hub prices the lines from ITS delivered sections and answers
 *             — no write. Step 2 of the wizard shows Hub truth before confirm.
 *   confirm   POST /edge/v1/laundry/bookings/{id}/confirm-intake   ({id} = draft)
 *             The approved route, served through the canonical command
 *             pipeline as `laundry.booking.confirm_from_draft`. The terminal
 *             presents its session header, its `kl1.{terminal}.{sequence}`
 *             command key and the body; EVERYTHING ELSE in the device context
 *             — scope, actor, profile, seat generation — is read from Hub
 *             relational authority (the terminal row and the session row),
 *             never from the request (T002 §6 discipline).
 *   recent    GET  /edge/v1/laundry/bookings/recent
 *             Today's Bookings at the Location, newest first — the Orders view.
 *
 * Authorization for all three is the T002 stack (`authorizeT1IntakeSession`:
 * owned, open, unexpired T1 session; the terminal's current T1 grant; no
 * blocking containment; the route permission within the closed PIN surface),
 * and confirm additionally passes every dimension of `authorizeHubCommand`.
 */
import type { IntakeLineRequest } from "@kitluy-verticals/phase1-laundry";

import type { KitluyEnvironment } from "@kitluy/shared-types";

import { withHubTransaction, HUB_RUNTIME_ROLE, type HubClient, type HubPool } from "../db.js";
import { HubCommandError } from "../errors.js";
import type { HubDeviceContext } from "../authorization.js";
import type { HubCommandResult } from "../command-pipeline.js";
import {
  confirmBookingFromDraft,
  loadIntakePricingSections,
  priceIntakeOrRefuse,
  type ConfirmFromDraftRefusal,
} from "../commands/confirm-from-draft.js";
import { isCanonicalIdempotencyKey, parseIdempotencyKey } from "../idempotency.js";
import type { T1IntakeAuthority } from "./runtime-bootstrap.js";

/** Money on the wire is a decimal string (§1). */
const s = (value: bigint): string => value.toString();

export interface QuoteWire {
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly lines: readonly {
    readonly serviceId: string;
    readonly serviceCode: string;
    readonly displayName: string;
    readonly familyCode: string | null;
    readonly pricingMethod: "per_piece" | "per_weight";
    readonly unitCode: "piece" | "kg";
    readonly unitPriceMinor: string;
    readonly quantity: string;
    readonly pieceCount: number | null;
    readonly weighedGrams: number | null;
    readonly billableGrams: number | null;
    readonly lineSubtotalMinor: string;
  }[];
  readonly subtotalMinor: string;
  readonly express: boolean;
  readonly expressSurchargeBps: number | null;
  readonly expressSurchargeMinor: string;
  readonly totalMinor: string;
  /** What the Hub will accept as tender: the delivered rate, or none. */
  readonly khrPerUsd: number | null;
  readonly locationCode: string | null;
  readonly configurationVersion: string;
}

/**
 * Price the requested lines exactly as confirm will, without writing.
 * The draft is only checked to be open in this scope — a quote for a
 * cancelled or converted draft is refused like a confirm would be.
 */
export async function quoteDraftIntake(
  pool: HubPool,
  authority: T1IntakeAuthority,
  input: {
    readonly draftId: string;
    readonly lines: readonly IntakeLineRequest[];
    readonly express: boolean;
  },
): Promise<QuoteWire> {
  return withHubTransaction(
    pool,
    async (client) => {
      const draft = await client.query<{ lifecycle: string; converted_booking_id: string | null }>(
        `select lifecycle, converted_booking_id from edge_laundry.booking_draft
          where id = $1::uuid and tenant_id = $2::uuid and digital_store_id = $3::uuid
            and location_id = $4::uuid`,
        [input.draftId, authority.tenantId, authority.digitalStoreId, authority.locationId],
      );
      const row = draft.rows[0];
      if (row === undefined) {
        throw new HubCommandError("EDGE_AGGREGATE_NOT_FOUND", "no such draft in this scope", {
          result: "DRAFT_UNKNOWN" satisfies ConfirmFromDraftRefusal,
        });
      }
      if (row.lifecycle !== "open") {
        throw new HubCommandError("EDGE_INVALID_TRANSITION", `draft is ${row.lifecycle}`, {
          result: "DRAFT_NOT_OPEN" satisfies ConfirmFromDraftRefusal,
          lifecycle: row.lifecycle,
          convertedBookingId: row.converted_booking_id,
        });
      }
      const sections = await loadIntakePricingSections(client, authority.locationId);
      const quote = priceIntakeOrRefuse(sections, input.lines, input.express);
      return {
        currencyCode: quote.currencyCode,
        currencyExponent: quote.currencyExponent,
        lines: quote.lines.map((line) => ({
          serviceId: line.serviceId,
          serviceCode: line.serviceCode,
          displayName: line.displayName,
          familyCode: line.familyCode,
          pricingMethod: line.pricingMethod,
          unitCode: line.unitCode,
          unitPriceMinor: s(line.unitPriceMinor),
          quantity: line.quantity,
          pieceCount: line.pieceCount,
          weighedGrams: line.weighedGrams,
          billableGrams: line.billableGrams,
          lineSubtotalMinor: s(line.lineSubtotalMinor),
        })),
        subtotalMinor: s(quote.subtotalMinor),
        express: quote.express,
        expressSurchargeBps: quote.expressSurchargeBps,
        expressSurchargeMinor: s(quote.expressSurchargeMinor),
        totalMinor: s(quote.totalMinor),
        khrPerUsd: sections.money.khrPerUsd,
        locationCode: sections.money.locationCode,
        configurationVersion: s(sections.snapshotVersion),
      };
    },
    HUB_RUNTIME_ROLE,
  );
}

/**
 * The device context the canonical pipeline authorizes, built from what the
 * Hub itself holds about the authenticated terminal and the session it named.
 * The terminal supplies none of these values; a projection it cannot edit
 * decides them (T002 §6). The idempotency key must name THIS terminal — a key
 * minted for another device is refused before any dimension runs.
 */
export async function deviceContextFromAuthority(
  client: HubClient,
  input: {
    readonly terminalDeviceId: string;
    readonly authority: T1IntakeAuthority;
    readonly environment: KitluyEnvironment;
    readonly idempotencyKey: string;
  },
): Promise<{ readonly device: HubDeviceContext; readonly clientSequence: bigint }> {
  if (!isCanonicalIdempotencyKey(input.idempotencyKey)) {
    throw new HubCommandError(
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      "the command key is not kl1.{terminal_device_uuid}.{client_sequence} (offline contract §2).",
      { result: "EDGE_IDEMPOTENCY_KEY_MALFORMED" },
    );
  }
  const parsed = parseIdempotencyKey(input.idempotencyKey);
  if (parsed.terminalDeviceId.toLowerCase() !== input.terminalDeviceId.toLowerCase()) {
    throw new HubCommandError(
      "EDGE_IDEMPOTENCY_KEY_MALFORMED",
      "the command key names a different terminal than the authenticated one.",
      { result: "EDGE_IDEMPOTENCY_KEY_MALFORMED" },
    );
  }
  const terminal = await client.query<{ assignment_generation: number }>(
    `select assignment_generation from edge_identity.terminal_device where id = $1::uuid`,
    [input.terminalDeviceId],
  );
  const row = terminal.rows[0];
  if (row === undefined) {
    throw new HubCommandError("EDGE_TERMINAL_UNKNOWN", "the terminal projection is missing");
  }
  return {
    device: {
      terminalDeviceId: input.terminalDeviceId,
      sessionId: input.authority.sessionId,
      actorId: input.authority.actorId,
      profileCode: input.authority.profileCode,
      assignmentGeneration: row.assignment_generation,
      tenantId: input.authority.tenantId,
      digitalStoreId: input.authority.digitalStoreId,
      locationId: input.authority.locationId,
      environment: input.environment,
    },
    clientSequence: parsed.clientSequence,
  };
}

export interface ConfirmDraftIntakeInput {
  readonly terminalDeviceId: string;
  readonly authority: T1IntakeAuthority;
  readonly environment: KitluyEnvironment;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly draftId: string;
  readonly expectedVersion: number;
  readonly lines: readonly IntakeLineRequest[];
  readonly express: boolean;
  readonly displayedTotalMinor: bigint;
  readonly tender: { readonly localMinor: bigint; readonly usdCents: bigint };
}

/** Business date from the Hub database clock — never the terminal's. */
async function hubBusinessDate(pool: HubPool): Promise<string> {
  return withHubTransaction(
    pool,
    async (client) => {
      const result = await client.query<{ d: string }>(
        `select to_char(current_date, 'YYYY-MM-DD') as d`,
      );
      return result.rows[0]?.d ?? new Date().toISOString().slice(0, 10);
    },
    HUB_RUNTIME_ROLE,
  );
}

/** Confirm through the canonical pipeline; the pipeline's own transaction does the rest. */
export async function confirmDraftIntakeForTerminal(
  pool: HubPool,
  input: ConfirmDraftIntakeInput,
): Promise<HubCommandResult> {
  const context = await withHubTransaction(
    pool,
    (client) =>
      deviceContextFromAuthority(client, {
        terminalDeviceId: input.terminalDeviceId,
        authority: input.authority,
        environment: input.environment,
        idempotencyKey: input.idempotencyKey,
      }),
    HUB_RUNTIME_ROLE,
  );
  return confirmBookingFromDraft(pool, {
    device: context.device,
    idempotencyKey: input.idempotencyKey,
    clientSequence: context.clientSequence,
    businessDate: await hubBusinessDate(pool),
    correlationId: input.correlationId,
    draftId: input.draftId,
    expectedVersion: input.expectedVersion,
    lines: input.lines,
    express: input.express,
    displayedTotalMinor: input.displayedTotalMinor,
    tender: input.tender,
  });
}

export interface RecentBookingWire {
  readonly bookingId: string;
  readonly bookingNumber: string;
  readonly status: string;
  readonly businessDate: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly totalMinor: string;
  readonly paidMinor: string;
  readonly balanceMinor: string;
  readonly lineCount: number;
  readonly customerDisplayName: string | null;
  readonly walkIn: boolean;
  readonly receiptNumber: string | null;
  readonly createdAt: string;
}

export const RECENT_BOOKINGS_LIMIT = 50;

/** Today's Bookings at the Location (Hub clock), newest first. Read-only. */
export async function listRecentBookings(
  pool: HubPool,
  authority: T1IntakeAuthority,
): Promise<readonly RecentBookingWire[]> {
  return withHubTransaction(
    pool,
    async (client) => {
      const rows = await client.query<{
        id: string;
        booking_number: string;
        status: string;
        business_date: string;
        currency_code: string;
        currency_exponent: number;
        total_minor: string;
        paid_minor: string;
        balance_minor: string;
        line_count: string;
        customer_display_name: string | null;
        walk_in: boolean;
        receipt_number: string | null;
        created_at: Date;
      }>(
        `select b.id, b.booking_number, b.status, to_char(b.business_date, 'YYYY-MM-DD') as business_date,
                b.currency_code, b.currency_exponent,
                b.total_minor::text as total_minor, b.paid_minor::text as paid_minor,
                b.balance_minor::text as balance_minor,
                (select count(*)::text from edge_laundry.booking_line l where l.booking_id = b.id) as line_count,
                coalesce(d.customer_snapshot ->> 'displayName', c.display_name) as customer_display_name,
                coalesce(d.walk_in, b.customer_id is null) as walk_in,
                (select r.receipt_number from edge_documents.receipt r
                  where r.booking_id = b.id order by r.issued_at desc limit 1) as receipt_number,
                b.created_at
           from edge_laundry.booking b
           left join edge_laundry.booking_draft d on d.converted_booking_id = b.id
           left join edge_core.customer c on c.id = b.customer_id
          where b.tenant_id = $1::uuid and b.digital_store_id = $2::uuid
            and b.location_id = $3::uuid and b.business_date = current_date
          order by b.created_at desc
          limit $4`,
        [authority.tenantId, authority.digitalStoreId, authority.locationId, RECENT_BOOKINGS_LIMIT],
      );
      return rows.rows.map((row) => ({
        bookingId: row.id,
        bookingNumber: row.booking_number,
        status: row.status,
        businessDate: row.business_date,
        currencyCode: row.currency_code,
        currencyExponent: row.currency_exponent,
        totalMinor: row.total_minor,
        paidMinor: row.paid_minor,
        balanceMinor: row.balance_minor,
        lineCount: Number(row.line_count),
        customerDisplayName: row.customer_display_name,
        walkIn: row.walk_in,
        receiptNumber: row.receipt_number,
        createdAt: row.created_at.toISOString(),
      }));
    },
    HUB_RUNTIME_ROLE,
  );
}
