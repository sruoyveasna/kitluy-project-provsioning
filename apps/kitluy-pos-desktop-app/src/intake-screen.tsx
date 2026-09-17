/**
 * T1 intake — the first real Store operation on a Pi Terminal
 * (T1-STORE-OPERATIONS-001; WS-12-T002 routes and vocabulary).
 *
 * Customer lookup by phone, a locally created customer, and a Laundry BOOKING
 * DRAFT: create, edit its notes, reopen it, cancel it. Every write goes to the
 * Store Hub through the named intake operations; the Hub commits it locally and
 * records the sync fact in its outbox in the same transaction.
 *
 * TRUTH RULES CARRIED FROM T002 §6
 *   - `unavailable` is never shown as "no customer found";
 *   - a Booking Draft is labelled a DRAFT, with its sync state, never a Booking;
 *   - consent is NOT captured here yet: the privacy-notice policy reference and
 *     version are owner values that do not exist ([REQUIRED]), and inventing one
 *     would manufacture consent evidence.
 */
import { useState } from "react";
import type { KitluyLocale } from "@kitluy/localization";

import {
  T1_INTAKE_BRIDGE_KEY,
  T1_STAFF_BRIDGE_KEY,
  type T1StaffBridge,
} from "./bootstrap/bridge-types.js";
import type { T1BootstrapReport } from "./bootstrap/states.js";
import type { IntakeCustomer, IntakeDraft, IntakeResult } from "./intake/ports.js";

interface IntakeBridge {
  searchCustomers(p: { phone: string }): Promise<IntakeResult<readonly IntakeCustomer[]>>;
  createCustomer(p: {
    displayName: string;
    phone: string | null;
    preferredLanguage: "km-KH" | "en-US";
  }): Promise<IntakeResult<IntakeCustomer>>;
  createDraft(p: {
    customerId: string | null;
    walkIn: boolean;
    preferredLanguage: "km-KH" | "en-US";
    customerNotes: string;
    staffNotes: string;
  }): Promise<IntakeResult<IntakeDraft>>;
  readDraft(p: { draftId: string }): Promise<IntakeResult<IntakeDraft>>;
  updateDraft(p: {
    draftId: string;
    expectedVersion: number;
    customerNotes?: string;
    staffNotes?: string;
  }): Promise<IntakeResult<IntakeDraft>>;
  cancelDraft(p: { draftId: string; reasonCode: string }): Promise<IntakeResult<IntakeDraft>>;
}

const CANCEL_REASONS = [
  "customer_left",
  "duplicate_intake",
  "entered_in_error",
  "customer_declined",
] as const;

const TEXT = {
  "km-KH": {
    signedInAs: "បុគ្គលិក",
    signOut: "ចាកចេញ",
    search: "ស្វែងរកតាមលេខទូរស័ព្ទ",
    searchButton: "ស្វែងរក",
    noMatch: "រកមិនឃើញអតិថិជន",
    newCustomer: "អតិថិជនថ្មី",
    name: "ឈ្មោះ",
    phone: "ទូរស័ព្ទ",
    create: "បង្កើត",
    draftTitle: "សេចក្តីព្រាងការកក់ (Booking Draft)",
    walkIn: "អតិថិជនដើរចូល (គ្មានឈ្មោះ)",
    forCustomer: "សម្រាប់",
    customerNotes: "កំណត់ចំណាំអតិថិជន",
    staffNotes: "កំណត់ចំណាំបុគ្គលិក",
    createDraft: "បង្កើតសេចក្តីព្រាង",
    saveNotes: "រក្សាទុកកំណត់ចំណាំ",
    reopen: "បើកម្ដងទៀត",
    cancelDraft: "បោះបង់សេចក្តីព្រាង",
    consent: "ការទទួលស្គាល់ការជូនដំណឹងឯកជនភាពមិនទាន់មានទេ",
    failure: "មិនបានសម្រេច",
  },
  "en-US": {
    signedInAs: "Staff",
    signOut: "Sign out",
    search: "Search by phone",
    searchButton: "Search",
    noMatch: "No customer found",
    newCustomer: "New customer",
    name: "Name",
    phone: "Phone",
    create: "Create",
    draftTitle: "Laundry Booking Draft",
    walkIn: "Walk-in (no customer record)",
    forCustomer: "For",
    customerNotes: "Customer notes",
    staffNotes: "Staff notes",
    createDraft: "Create Booking Draft",
    saveNotes: "Save notes",
    reopen: "Reopen",
    cancelDraft: "Cancel draft",
    consent: "Privacy-notice acknowledgement is not available yet",
    failure: "Not completed",
  },
} as const;

function intakeBridge(): IntakeBridge | undefined {
  return (window as unknown as Record<string, IntakeBridge | undefined>)[T1_INTAKE_BRIDGE_KEY];
}
function staffBridge(): T1StaffBridge | undefined {
  return (window as unknown as Record<string, T1StaffBridge | undefined>)[T1_STAFF_BRIDGE_KEY];
}

export function IntakeScreen(props: {
  readonly locale: KitluyLocale;
  readonly report: T1BootstrapReport;
}) {
  const text = TEXT[props.locale];
  const language = props.locale;
  const [failure, setFailure] = useState<string | null>(null);
  const [phoneQuery, setPhoneQuery] = useState("");
  const [matches, setMatches] = useState<readonly IntakeCustomer[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [customer, setCustomer] = useState<IntakeCustomer | null>(null);
  const [customerNotes, setCustomerNotes] = useState("");
  const [staffNotes, setStaffNotes] = useState("");
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [recent, setRecent] = useState<readonly string[]>([]);
  const [reason, setReason] = useState<(typeof CANCEL_REASONS)[number]>("entered_in_error");

  const intake = typeof window === "undefined" ? undefined : intakeBridge();
  if (intake === undefined) return null;

  const settle = <T,>(result: IntakeResult<T>, onValue: (value: T) => void): void => {
    if (result.ok) {
      setFailure(null);
      onValue(result.value);
    } else {
      // The KIND leads: `unavailable` and `not_found` are different facts.
      setFailure(`${text.failure}: ${result.kind} (${result.detail})`);
    }
  };
  const showDraft = (value: IntakeDraft): void => {
    setDraft(value);
    setCustomerNotes(value.customerNotes);
    setStaffNotes(value.staffNotes);
    setRecent((ids) => [value.draftId, ...ids.filter((id) => id !== value.draftId)].slice(0, 5));
  };

  return (
    <section data-intake-screen="t1" aria-label={text.draftTitle}>
      <p>
        {text.signedInAs}: <strong>{props.report.staff?.displayName ?? "—"}</strong>{" "}
        <button onClick={() => void staffBridge()?.signOut()}>{text.signOut}</button>
      </p>
      {failure !== null ? <p role="alert">{failure}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void intake.searchCustomers({ phone: phoneQuery.trim() }).then((r) => {
            settle(r, setMatches);
          });
        }}
      >
        <label>
          {text.search}{" "}
          <input
            name="phone-search"
            inputMode="tel"
            value={phoneQuery}
            onChange={(e) => {
              setPhoneQuery(e.target.value);
            }}
          />
        </label>{" "}
        <button type="submit" disabled={phoneQuery.trim().length < 3}>
          {text.searchButton}
        </button>
      </form>
      {matches !== null && matches.length === 0 ? <p>{text.noMatch}</p> : null}
      {matches !== null && matches.length > 0 ? (
        <ul>
          {matches.map((m) => (
            <li key={m.customerId}>
              <button
                onClick={() => {
                  setCustomer(m);
                }}
                aria-pressed={customer?.customerId === m.customerId}
              >
                {m.displayName} {m.phoneMasked ?? ""} <em>{m.syncState}</em>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void intake
            .createCustomer({
              displayName: newName.trim(),
              phone: newPhone.trim() === "" ? null : newPhone.trim(),
              preferredLanguage: language,
            })
            .then((r) => {
              settle(r, (created) => {
                setCustomer(created);
                setNewName("");
                setNewPhone("");
              });
            });
        }}
      >
        <h3>{text.newCustomer}</h3>
        <label>
          {text.name}{" "}
          <input
            name="customer-name"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
            }}
          />
        </label>{" "}
        <label>
          {text.phone}{" "}
          <input
            name="customer-phone"
            inputMode="tel"
            value={newPhone}
            onChange={(e) => {
              setNewPhone(e.target.value);
            }}
          />
        </label>{" "}
        <button type="submit" disabled={newName.trim() === ""}>
          {text.create}
        </button>
      </form>
      <p data-consent="unavailable">
        <em>{text.consent}</em> — [REQUIRED: privacy notice policy reference and version]
      </p>
      <h3>{text.draftTitle}</h3>
      <p>
        {customer === null ? (
          text.walkIn
        ) : (
          <>
            {text.forCustomer} <strong>{customer.displayName}</strong> ({customer.syncState}){" "}
            <button
              onClick={() => {
                setCustomer(null);
              }}
            >
              ×
            </button>
          </>
        )}
      </p>
      <label>
        {text.customerNotes}{" "}
        <textarea
          name="customer-notes"
          value={customerNotes}
          onChange={(e) => {
            setCustomerNotes(e.target.value);
          }}
        />
      </label>{" "}
      <label>
        {text.staffNotes}{" "}
        <textarea
          name="staff-notes"
          value={staffNotes}
          onChange={(e) => {
            setStaffNotes(e.target.value);
          }}
        />
      </label>
      <p>
        <button
          onClick={() =>
            void intake
              .createDraft({
                customerId: customer?.customerId ?? null,
                walkIn: customer === null,
                preferredLanguage: language,
                customerNotes,
                staffNotes,
              })
              .then((r) => {
                settle(r, showDraft);
              })
          }
        >
          {text.createDraft}
        </button>
      </p>
      {draft !== null ? (
        <div data-draft-id={draft.draftId}>
          <p>
            <strong>{text.draftTitle}</strong> {draft.draftId} · {draft.lifecycle} · v
            {draft.version} · <em>{draft.syncState}</em>
          </p>
          <button
            disabled={draft.lifecycle !== "open"}
            onClick={() =>
              void intake
                .updateDraft({
                  draftId: draft.draftId,
                  expectedVersion: draft.version,
                  customerNotes,
                  staffNotes,
                })
                .then((r) => {
                  settle(r, showDraft);
                })
            }
          >
            {text.saveNotes}
          </button>{" "}
          <select
            value={reason}
            onChange={(e) => {
              setReason(e.target.value as (typeof CANCEL_REASONS)[number]);
            }}
          >
            {CANCEL_REASONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>{" "}
          <button
            disabled={draft.lifecycle !== "open"}
            onClick={() =>
              void intake.cancelDraft({ draftId: draft.draftId, reasonCode: reason }).then((r) => {
                settle(r, showDraft);
              })
            }
          >
            {text.cancelDraft}
          </button>
        </div>
      ) : null}
      {recent.length > 0 ? (
        <ul aria-label={text.reopen}>
          {recent.map((id) => (
            <li key={id}>
              <button
                onClick={() =>
                  void intake.readDraft({ draftId: id }).then((r) => {
                    settle(r, showDraft);
                  })
                }
              >
                {text.reopen} {id.slice(0, 8)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
