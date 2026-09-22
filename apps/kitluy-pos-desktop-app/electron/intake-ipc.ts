/**
 * T1 intake IPC boundary — WS-12-T002-P02 §5, extended by
 * T1-REAL-OPERATIONS-001 slice 2 (quote, confirm-intake, recent Bookings).
 *
 * Exactly eleven named channels, each mapping to ONE IntakeOperations
 * method. The renderer supplies operation-specific PUBLIC input only —
 * every request is validated HERE in the main process before any adapter
 * runs, and there is structurally no way to: name a route or URL, choose
 * an HTTP method, reach certificates/keys/databases/Supabase, mutate
 * session permissions, or override Tenant/Store/Location/Hub/profile
 * (none of those are fields; unknown fields refuse).
 *
 * The validators are PURE and exported so the boundary is testable without
 * Electron. A request that fails validation returns a closed
 * `invalid_input` result — a compromised renderer learns nothing and
 * changes nothing.
 */
import type { IntakeLineInput, IntakeOperations, IntakeResult } from "../src/intake/ports.js";

export const INTAKE_CHANNELS = {
  searchCustomers: "kitluy:t1:intake:search-customers",
  readCustomer: "kitluy:t1:intake:read-customer",
  createCustomer: "kitluy:t1:intake:create-customer",
  recordConsentDecision: "kitluy:t1:intake:record-consent",
  createDraft: "kitluy:t1:intake:create-draft",
  readDraft: "kitluy:t1:intake:read-draft",
  updateDraft: "kitluy:t1:intake:update-draft",
  cancelDraft: "kitluy:t1:intake:cancel-draft",
  // T1-REAL-OPERATIONS-001 slice 2
  quote: "kitluy:t1:intake:quote",
  confirmIntake: "kitluy:t1:intake:confirm-intake",
  listRecentBookings: "kitluy:t1:intake:list-recent-bookings",
} as const;

/** Route-level bound mirrored from the Hub (MAX_INTAKE_LINES). */
export const MAX_INTAKE_LINES = 200;
/** Whole minor units as a decimal string (§1) — never a float across IPC. */
const MONEY_STRING = /^[0-9]{1,18}$/u;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCALES = new Set(["km-KH", "en-US"]);
const DECISIONS = new Set(["granted", "declined", "withdrawn", "acknowledged"]);
const PURPOSES = new Set([
  "privacy_notice_acknowledgement",
  "operational_communication",
  "sms_marketing",
  "telegram_marketing",
  "email_marketing",
]);
const CANCEL_REASONS = new Set([
  "customer_left",
  "duplicate_intake",
  "entered_in_error",
  "customer_declined",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const invalid = {
  ok: false as const,
  kind: "invalid_input" as const,
  detail: "refused by the IPC boundary",
};

/** Pure per-channel validators: unknown fields, shapes and vocabularies. */
export const INTAKE_VALIDATORS = {
  searchCustomers(value: unknown): { phone: string } | null {
    const body = record(value);
    if (body === null || !onlyKeys(body, ["phone"])) return null;
    const phone = body["phone"];
    if (typeof phone !== "string" || phone.length < 3 || phone.length > 32) return null;
    return { phone };
  },
  readCustomer(value: unknown): { customerId: string } | null {
    const body = record(value);
    if (body === null || !onlyKeys(body, ["customerId"])) return null;
    const customerId = body["customerId"];
    if (typeof customerId !== "string" || !UUID.test(customerId)) return null;
    return { customerId };
  },
  createCustomer(
    value: unknown,
  ): { displayName: string; phone: string | null; preferredLanguage: "km-KH" | "en-US" } | null {
    const body = record(value);
    if (body === null || !onlyKeys(body, ["displayName", "phone", "preferredLanguage"]))
      return null;
    const displayName = body["displayName"];
    if (
      typeof displayName !== "string" ||
      displayName.trim().length < 1 ||
      displayName.length > 200
    )
      return null;
    const phone = body["phone"] ?? null;
    if (phone !== null && (typeof phone !== "string" || phone.length < 3 || phone.length > 32))
      return null;
    const locale = body["preferredLanguage"] ?? "km-KH";
    if (typeof locale !== "string" || !LOCALES.has(locale)) return null;
    return {
      displayName: displayName.trim(),
      phone: phone as string | null,
      preferredLanguage: locale as "km-KH" | "en-US",
    };
  },
  recordConsentDecision(value: unknown): {
    customerId: string;
    purposeKey: string;
    policyRef: string;
    policyVersion: number;
    decision: "granted" | "declined" | "withdrawn" | "acknowledged";
    staffAssisted: boolean;
  } | null {
    const body = record(value);
    if (
      body === null ||
      !onlyKeys(body, [
        "customerId",
        "purposeKey",
        "policyRef",
        "policyVersion",
        "decision",
        "staffAssisted",
      ])
    )
      return null;
    const customerId = body["customerId"];
    const purposeKey = body["purposeKey"];
    const policyRef = body["policyRef"];
    const policyVersion = body["policyVersion"];
    const decision = body["decision"];
    if (typeof customerId !== "string" || !UUID.test(customerId)) return null;
    if (typeof purposeKey !== "string" || !PURPOSES.has(purposeKey)) return null;
    if (typeof policyRef !== "string" || policyRef.length < 1 || policyRef.length > 200)
      return null;
    if (typeof policyVersion !== "number" || !Number.isInteger(policyVersion) || policyVersion < 1)
      return null;
    if (typeof decision !== "string" || !DECISIONS.has(decision)) return null;
    // staffAssisted may only be WIDENED to true here: the T1 surface is
    // staff-operated, so a renderer can never LAUNDER a decision into
    // "customer self" — anything not explicitly false-with-authority stays
    // assisted (§5: no fabricated self-verification).
    return {
      customerId,
      purposeKey,
      policyRef,
      policyVersion,
      decision: decision as "granted" | "declined" | "withdrawn" | "acknowledged",
      staffAssisted: true,
    };
  },
  createDraft(value: unknown): {
    customerId: string | null;
    walkIn: boolean;
    preferredLanguage: "km-KH" | "en-US";
    customerNotes: string;
    staffNotes: string;
  } | null {
    const body = record(value);
    if (
      body === null ||
      !onlyKeys(body, ["customerId", "walkIn", "preferredLanguage", "customerNotes", "staffNotes"])
    )
      return null;
    const walkIn = body["walkIn"] === true;
    const customerId = body["customerId"] ?? null;
    if (!walkIn && (typeof customerId !== "string" || !UUID.test(customerId))) return null;
    if (walkIn && customerId !== null) return null;
    const locale = body["preferredLanguage"] ?? "km-KH";
    if (typeof locale !== "string" || !LOCALES.has(locale)) return null;
    const customerNotes = body["customerNotes"] ?? "";
    const staffNotes = body["staffNotes"] ?? "";
    if (typeof customerNotes !== "string" || customerNotes.length > 2000) return null;
    if (typeof staffNotes !== "string" || staffNotes.length > 2000) return null;
    return {
      customerId: walkIn ? null : (customerId as string),
      walkIn,
      preferredLanguage: locale as "km-KH" | "en-US",
      customerNotes,
      staffNotes,
    };
  },
  readDraft(value: unknown): { draftId: string } | null {
    const body = record(value);
    if (body === null || !onlyKeys(body, ["draftId"])) return null;
    const draftId = body["draftId"];
    if (typeof draftId !== "string" || !UUID.test(draftId)) return null;
    return { draftId };
  },
  updateDraft(value: unknown): {
    draftId: string;
    expectedVersion: number;
    customerNotes?: string;
    staffNotes?: string;
    preferredLanguage?: "km-KH" | "en-US";
  } | null {
    const body = record(value);
    if (
      body === null ||
      !onlyKeys(body, [
        "draftId",
        "expectedVersion",
        "customerNotes",
        "staffNotes",
        "preferredLanguage",
      ])
    )
      return null;
    const draftId = body["draftId"];
    const expectedVersion = body["expectedVersion"];
    if (typeof draftId !== "string" || !UUID.test(draftId)) return null;
    if (
      typeof expectedVersion !== "number" ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1
    )
      return null;
    const out: {
      draftId: string;
      expectedVersion: number;
      customerNotes?: string;
      staffNotes?: string;
      preferredLanguage?: "km-KH" | "en-US";
    } = { draftId, expectedVersion };
    if (body["customerNotes"] !== undefined) {
      if (typeof body["customerNotes"] !== "string" || body["customerNotes"].length > 2000)
        return null;
      out.customerNotes = body["customerNotes"];
    }
    if (body["staffNotes"] !== undefined) {
      if (typeof body["staffNotes"] !== "string" || body["staffNotes"].length > 2000) return null;
      out.staffNotes = body["staffNotes"];
    }
    if (body["preferredLanguage"] !== undefined) {
      if (typeof body["preferredLanguage"] !== "string" || !LOCALES.has(body["preferredLanguage"]))
        return null;
      out.preferredLanguage = body["preferredLanguage"] as "km-KH" | "en-US";
    }
    return out;
  },
  cancelDraft(value: unknown): { draftId: string; reasonCode: string } | null {
    const body = record(value);
    if (body === null || !onlyKeys(body, ["draftId", "reasonCode"])) return null;
    const draftId = body["draftId"];
    const reasonCode = body["reasonCode"];
    if (typeof draftId !== "string" || !UUID.test(draftId)) return null;
    if (typeof reasonCode !== "string" || !CANCEL_REASONS.has(reasonCode)) return null;
    return { draftId, reasonCode };
  },
  /** The cart lines: a service id and exactly one quantity kind, bounded. */
  lines(value: unknown): readonly IntakeLineInput[] | null {
    if (!Array.isArray(value) || value.length > MAX_INTAKE_LINES) return null;
    const lines: IntakeLineInput[] = [];
    for (const raw of value) {
      const line = record(raw);
      if (line === null || !onlyKeys(line, ["serviceId", "pieceCount", "weighedGrams"]))
        return null;
      const serviceId = line["serviceId"];
      if (typeof serviceId !== "string" || !UUID.test(serviceId)) return null;
      const pieceCount = line["pieceCount"];
      const weighedGrams = line["weighedGrams"];
      if ((pieceCount !== undefined) === (weighedGrams !== undefined)) return null;
      if (pieceCount !== undefined) {
        if (typeof pieceCount !== "number" || !Number.isInteger(pieceCount) || pieceCount < 1)
          return null;
        lines.push({ serviceId: serviceId.toLowerCase(), pieceCount });
      } else {
        if (typeof weighedGrams !== "number" || !Number.isInteger(weighedGrams) || weighedGrams < 1)
          return null;
        lines.push({ serviceId: serviceId.toLowerCase(), weighedGrams });
      }
    }
    return lines;
  },
  quote(
    value: unknown,
  ): { draftId: string; lines: readonly IntakeLineInput[]; express: boolean } | null {
    const body = record(value);
    if (body === null || !onlyKeys(body, ["draftId", "lines", "express"])) return null;
    const draftId = body["draftId"];
    if (typeof draftId !== "string" || !UUID.test(draftId)) return null;
    const lines = INTAKE_VALIDATORS.lines(body["lines"]);
    if (lines === null) return null;
    const express = body["express"] ?? false;
    if (typeof express !== "boolean") return null;
    return { draftId, lines, express };
  },
  confirmIntake(value: unknown): {
    draftId: string;
    expectedVersion: number;
    lines: readonly IntakeLineInput[];
    express: boolean;
    displayedTotalMinor: string;
    tender: { localMinor: string; usdCents: string };
  } | null {
    const body = record(value);
    if (
      body === null ||
      !onlyKeys(body, [
        "draftId",
        "expectedVersion",
        "lines",
        "express",
        "displayedTotalMinor",
        "tender",
      ])
    )
      return null;
    const draftId = body["draftId"];
    if (typeof draftId !== "string" || !UUID.test(draftId)) return null;
    const expectedVersion = body["expectedVersion"];
    if (
      typeof expectedVersion !== "number" ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1
    )
      return null;
    const lines = INTAKE_VALIDATORS.lines(body["lines"]);
    if (lines === null || lines.length === 0) return null;
    const express = body["express"] ?? false;
    if (typeof express !== "boolean") return null;
    const displayedTotalMinor = body["displayedTotalMinor"];
    if (typeof displayedTotalMinor !== "string" || !MONEY_STRING.test(displayedTotalMinor))
      return null;
    const tender = record(body["tender"]);
    if (tender === null || !onlyKeys(tender, ["localMinor", "usdCents"])) return null;
    const localMinor = tender["localMinor"] ?? "0";
    const usdCents = tender["usdCents"] ?? "0";
    if (typeof localMinor !== "string" || !MONEY_STRING.test(localMinor)) return null;
    if (typeof usdCents !== "string" || !MONEY_STRING.test(usdCents)) return null;
    // Cash is the ONLY tender at intake (owner decision 2026-09-19); no type
    // field crosses this boundary at all.
    return {
      draftId,
      expectedVersion,
      lines,
      express,
      displayedTotalMinor,
      tender: { localMinor, usdCents },
    };
  },
  listRecentBookings(value: unknown): Record<string, never> | null {
    if (value === undefined || value === null) return {};
    const body = record(value);
    if (body === null || Object.keys(body).length > 0) return null;
    return {};
  },
} as const;

interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

/**
 * Register the eleven handlers. `getOperations` returns null until the
 * bootstrap reached ready/offline_ready with a staff session — before
 * that, every intake request answers `unavailable` (fail closed).
 */
export function registerIntakeIpc(
  ipc: IpcMainLike,
  getOperations: () => IntakeOperations | null,
): void {
  const unavailable: IntakeResult<never> = {
    ok: false,
    kind: "unavailable",
    detail: "the intake surface is not ready",
  };
  ipc.handle(INTAKE_CHANNELS.searchCustomers, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.searchCustomers(payload);
    if (input === null) return invalid;
    return (await getOperations()?.searchCustomers(input.phone)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.readCustomer, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.readCustomer(payload);
    if (input === null) return invalid;
    return (await getOperations()?.readCustomer(input.customerId)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.createCustomer, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.createCustomer(payload);
    if (input === null) return invalid;
    return (await getOperations()?.createCustomer(input)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.recordConsentDecision, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.recordConsentDecision(payload);
    if (input === null) return invalid;
    return (await getOperations()?.recordConsentDecision(input)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.createDraft, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.createDraft(payload);
    if (input === null) return invalid;
    return (await getOperations()?.createDraft(input)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.readDraft, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.readDraft(payload);
    if (input === null) return invalid;
    return (await getOperations()?.readDraft(input.draftId)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.updateDraft, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.updateDraft(payload);
    if (input === null) return invalid;
    return (await getOperations()?.updateDraft(input)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.cancelDraft, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.cancelDraft(payload);
    if (input === null) return invalid;
    return (await getOperations()?.cancelDraft(input)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.quote, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.quote(payload);
    if (input === null) return invalid;
    return (await getOperations()?.quote(input)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.confirmIntake, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.confirmIntake(payload);
    if (input === null) return invalid;
    return (await getOperations()?.confirmIntake(input)) ?? unavailable;
  });
  ipc.handle(INTAKE_CHANNELS.listRecentBookings, async (_event, payload) => {
    const input = INTAKE_VALIDATORS.listRecentBookings(payload);
    if (input === null) return invalid;
    return (await getOperations()?.listRecentBookings()) ?? unavailable;
  });
}
