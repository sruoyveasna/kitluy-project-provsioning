/**
 * T1 customer-intake state machine — WS-12-T002-P02 §6.
 *
 * A CLOSED fifteen-state vocabulary (the bootstrap-machine discipline: a
 * condition that maps to no state here is a mapping defect, never a reason
 * to invent a sixteenth state). Pure logic over the IntakeOperations port;
 * no transport, no Electron, no DOM — the renderer view renders the state,
 * the main process owns the operations.
 *
 * TRUTH RULES enforced structurally here:
 *  - multiple matches land in `ambiguous_matches`; nothing auto-selects;
 *  - an UNAVAILABLE search lands in `offline`/`unavailable`, NEVER
 *    `no_match` — zero results are only ever a SUCCESSFUL empty answer;
 *  - `pending_sync` is its own state, never presented as cloud-confirmed;
 *  - a draft is a DRAFT: no wording here or in the string table calls it a
 *    confirmed Booking, and no payment/price surface exists.
 */
import type { IntakeCustomer, IntakeDraft, IntakeOperations, IntakeResult } from "./ports.js";

export const INTAKE_STATES = [
  "idle",
  "searching",
  "no_match",
  "one_match",
  "ambiguous_matches",
  "customer_selected",
  "customer_creation",
  "consent_review",
  "draft_saving",
  "draft_ready",
  "pending_sync",
  "conflict",
  "offline",
  "unavailable",
  "error",
] as const;
export type IntakeState = (typeof INTAKE_STATES)[number];

export interface IntakeSnapshot {
  readonly state: IntakeState;
  readonly matches: readonly IntakeCustomer[];
  readonly selectedCustomer: IntakeCustomer | null;
  readonly walkIn: boolean;
  readonly draft: IntakeDraft | null;
  readonly detail: string | null;
  readonly transitions: readonly IntakeState[];
}

function isTransportDown(kind: string): boolean {
  return kind === "unavailable";
}

export class IntakeMachine {
  #state: IntakeState = "idle";
  #matches: readonly IntakeCustomer[] = [];
  #selected: IntakeCustomer | null = null;
  #walkIn = false;
  #draft: IntakeDraft | null = null;
  #detail: string | null = null;
  readonly #transitions: IntakeState[] = ["idle"];

  public constructor(private readonly operations: IntakeOperations) {}

  public snapshot(): IntakeSnapshot {
    return {
      state: this.#state,
      matches: this.#matches,
      selectedCustomer: this.#selected,
      walkIn: this.#walkIn,
      draft: this.#draft,
      detail: this.#detail,
      transitions: [...this.#transitions],
    };
  }

  #enter(state: IntakeState, detail: string | null = null): void {
    this.#state = state;
    this.#detail = detail;
    this.#transitions.push(state);
  }

  #fail<T>(failure: Extract<IntakeResult<T>, { ok: false }>): void {
    if (isTransportDown(failure.kind)) {
      // NEVER "no customer found" — the truthful state is offline.
      this.#enter("offline", failure.detail);
    } else if (failure.kind === "conflict" || failure.kind === "stale_version") {
      this.#enter("conflict", failure.detail);
    } else if (failure.kind === "permission_denied" || failure.kind === "session_invalid") {
      this.#enter("unavailable", failure.detail);
    } else {
      this.#enter("error", failure.detail);
    }
  }

  public startIntake(): void {
    this.#matches = [];
    this.#selected = null;
    this.#walkIn = false;
    this.#draft = null;
    this.#enter("idle");
  }

  public async search(phone: string): Promise<IntakeSnapshot> {
    this.#enter("searching");
    const result = await this.operations.searchCustomers(phone);
    if (!result.ok) {
      this.#fail(result);
      return this.snapshot();
    }
    this.#matches = result.value;
    if (result.value.length === 0) this.#enter("no_match");
    else if (result.value.length === 1) this.#enter("one_match");
    else this.#enter("ambiguous_matches"); // an EXPLICIT state; no auto-pick
    return this.snapshot();
  }

  /** Selection is always an explicit staff action — even for one match. */
  public selectCustomer(customerId: string): IntakeSnapshot {
    const match = this.#matches.find((candidate) => candidate.customerId === customerId);
    if (match === undefined) {
      this.#enter("error", "selection outside the current result set");
      return this.snapshot();
    }
    this.#selected = match;
    this.#walkIn = false;
    this.#enter("customer_selected");
    return this.snapshot();
  }

  public chooseWalkIn(): IntakeSnapshot {
    this.#selected = null;
    this.#walkIn = true;
    this.#enter("customer_selected");
    return this.snapshot();
  }

  public beginCustomerCreation(): IntakeSnapshot {
    this.#enter("customer_creation");
    return this.snapshot();
  }

  public async createCustomer(input: {
    readonly displayName: string;
    readonly phone: string | null;
    readonly preferredLanguage: "km-KH" | "en-US";
  }): Promise<IntakeSnapshot> {
    const result = await this.operations.createCustomer(input);
    if (!result.ok) {
      this.#fail(result);
      return this.snapshot();
    }
    this.#selected = result.value;
    this.#walkIn = false;
    this.#enter("customer_selected");
    return this.snapshot();
  }

  public beginConsentReview(): IntakeSnapshot {
    this.#enter("consent_review");
    return this.snapshot();
  }

  public async recordConsent(input: {
    readonly purposeKey: string;
    readonly policyRef: string;
    readonly policyVersion: number;
    readonly decision: "granted" | "declined" | "withdrawn" | "acknowledged";
    readonly staffAssisted: boolean;
  }): Promise<IntakeSnapshot> {
    if (this.#selected === null) {
      this.#enter("error", "consent requires a selected customer");
      return this.snapshot();
    }
    const result = await this.operations.recordConsentDecision({
      customerId: this.#selected.customerId,
      ...input,
    });
    if (!result.ok) this.#fail(result);
    // A recorded decision keeps the review open for further purposes.
    return this.snapshot();
  }

  public async createDraft(input: {
    readonly preferredLanguage: "km-KH" | "en-US";
    readonly customerNotes: string;
    readonly staffNotes: string;
  }): Promise<IntakeSnapshot> {
    if (!this.#walkIn && this.#selected === null) {
      this.#enter("error", "a draft needs a customer or the walk-in path");
      return this.snapshot();
    }
    this.#enter("draft_saving");
    const result = await this.operations.createDraft({
      customerId: this.#selected?.customerId ?? null,
      walkIn: this.#walkIn,
      ...input,
    });
    if (!result.ok) {
      this.#fail(result);
      return this.snapshot();
    }
    this.#draft = result.value;
    this.#enterDraftState(result.value);
    return this.snapshot();
  }

  #enterDraftState(draft: IntakeDraft): void {
    if (draft.syncState === "conflict") this.#enter("conflict");
    else if (draft.syncState === "pending_sync") this.#enter("pending_sync");
    else this.#enter("draft_ready");
  }

  public async reopenDraft(draftId: string): Promise<IntakeSnapshot> {
    const result = await this.operations.readDraft(draftId);
    if (!result.ok) {
      this.#fail(result);
      return this.snapshot();
    }
    this.#draft = result.value;
    this.#enterDraftState(result.value);
    return this.snapshot();
  }

  public async saveDraftEdits(input: {
    readonly customerNotes?: string;
    readonly staffNotes?: string;
    readonly preferredLanguage?: "km-KH" | "en-US";
  }): Promise<IntakeSnapshot> {
    if (this.#draft === null) {
      this.#enter("error", "no draft to edit");
      return this.snapshot();
    }
    this.#enter("draft_saving");
    const result = await this.operations.updateDraft({
      draftId: this.#draft.draftId,
      expectedVersion: this.#draft.version,
      ...input,
    });
    if (!result.ok) {
      this.#fail(result);
      return this.snapshot();
    }
    this.#draft = result.value;
    this.#enterDraftState(result.value);
    return this.snapshot();
  }

  public async cancelDraft(reasonCode: string): Promise<IntakeSnapshot> {
    if (this.#draft === null) {
      this.#enter("error", "no draft to cancel");
      return this.snapshot();
    }
    const result = await this.operations.cancelDraft({
      draftId: this.#draft.draftId,
      reasonCode,
    });
    if (!result.ok) {
      this.#fail(result);
      return this.snapshot();
    }
    this.#draft = result.value;
    this.#enter("idle", "draft cancelled");
    return this.snapshot();
  }
}
