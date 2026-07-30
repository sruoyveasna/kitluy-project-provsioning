/**
 * Governed credential revocation — WS-11-T003 Step 4, the TypeScript side of
 * migration group 0136.
 *
 * Authority: KLD-2026-07-28-002 §5.4, §6; migration group 0136
 * (`revoke_device_credential_v1`). KLRISK-DEVICE-007 named the ABSENCE of a
 * governed revocation; group 0136 supplied one, but the risk is NOT closed and
 * this module does not close it. Its gate additionally requires live
 * integration evidence, concurrency evidence and an independent review, and no
 * shipped code implements `RevocationGateway` at all — the only implementations
 * are test fakes. An earlier version of this line said "which closes
 * KLRISK-DEVICE-007"; that was wrong and contradicted the register.
 *
 * ===========================================================================
 * REVOCATION IS NOT FOUR OTHER THINGS
 * ===========================================================================
 *   credential EXPIRY        time ran out; nothing went wrong
 *   overlap RETIREMENT       a newer generation superseded it (0134)
 *   device CONTAINMENT       the DEVICE is restricted; its credential may still
 *                            be cryptographically valid
 *   key SUPERSESSION         a newer key exists
 *   key DESTRUCTION          the private half is gone
 *
 * None of them is REVOCATION: a standing declaration that this credential is
 * repudiated and must fail verification immediately, BEFORE its expiry and
 * THROUGH any granted §5 overlap. `credential-lifecycle.ts` does the first two;
 * this module does none of them. Collapsing them is the failure group 0136's
 * header calls out, and the reason both modules exist separately.
 *
 * ===========================================================================
 * THIS MODULE DECIDES NOTHING THE DATABASE DECIDES
 * ===========================================================================
 * Four-eyes approval, credential resolution, append-only evidence, the derived
 * `revoked` state the verifier reads and the recovery case are all the governed
 * function's work. What happens here is narrower and deliberately so:
 *
 *   - refuse the requests that are wrong on their face, BEFORE a governed call
 *     is made and before an approval could be consumed;
 *   - supply the DEFAULT recovery disposition for a reason, so no caller has to
 *     invent one and no revocation ships without one;
 *   - report the governed outcome faithfully, including the two outcomes that
 *     are not successes.
 *
 * A wrapper that improved on any of those would be a second, weaker policy
 * engine sitting in front of the real one.
 */

import type { TrustEnvironment } from "./environments.js";
import type { RevocationLookup } from "./certificate-validity.js";

// ---------------------------------------------------------------------------
// The governed enums, mirrored exactly
// ---------------------------------------------------------------------------

/** `kitluy_devices.credential_revocation_reason`. */
export type CredentialRevocationReason =
  | "KEY_COMPROMISE"
  | "DEVICE_LOST"
  | "DEVICE_STOLEN"
  | "PROVIDER_COMPROMISE"
  | "ASSIGNMENT_INVALIDATED"
  | "CERTIFICATE_MISISSUANCE"
  | "SECURITY_INCIDENT"
  | "ADMINISTRATIVE_REPLACEMENT"
  | "OTHER_APPROVED_REASON";

/**
 * The full reason list as DATA, in the migration's order.
 *
 * Exported so a conformance test can iterate every value rather than the
 * handful someone remembered. A reason added to the enum without a disposition
 * is caught by the compiler (the mapping below is an exhaustive `Record`) and
 * by that test.
 */
export const CREDENTIAL_REVOCATION_REASONS: readonly CredentialRevocationReason[] = [
  "KEY_COMPROMISE",
  "DEVICE_LOST",
  "DEVICE_STOLEN",
  "PROVIDER_COMPROMISE",
  "ASSIGNMENT_INVALIDATED",
  "CERTIFICATE_MISISSUANCE",
  "SECURITY_INCIDENT",
  "ADMINISTRATIVE_REPLACEMENT",
  "OTHER_APPROVED_REASON",
] as const;

/** `kitluy_devices.credential_recovery_disposition`. */
export type CredentialRecoveryDisposition =
  | "NO_RECOVERY"
  | "RECOVERY_REQUIRED"
  | "REPROVISION_REQUIRED"
  | "REASSIGNMENT_REQUIRED"
  | "MANUAL_SECURITY_REVIEW";

export const CREDENTIAL_RECOVERY_DISPOSITIONS: readonly CredentialRecoveryDisposition[] = [
  "NO_RECOVERY",
  "RECOVERY_REQUIRED",
  "REPROVISION_REQUIRED",
  "REASSIGNMENT_REQUIRED",
  "MANUAL_SECURITY_REVIEW",
] as const;

// ---------------------------------------------------------------------------
// Recovery disposition
// ---------------------------------------------------------------------------

/**
 * The DEFAULT recovery disposition per reason, as a table rather than a switch
 * chain — so the whole policy is readable at once and a reader can see what is
 * owed for every reason without following control flow.
 *
 * These are DEFAULTS. A caller may override UPWARD (ask for more recovery than
 * the reason implies: a `RECOVERY_REQUIRED` reason escalated to
 * `MANUAL_SECURITY_REVIEW` is always allowed). A caller may NOT override
 * downward to `NO_RECOVERY` for a compromise reason, and `revokeDeviceCredential`
 * enforces that rather than trusting the comment — see COMPROMISE_REASONS.
 *
 * `NO_RECOVERY` is the one value with a side effect in the database: group 0136
 * opens no recovery case for it. So "downgrade to NO_RECOVERY" is not a
 * paperwork preference, it is the difference between a compromised device
 * carrying a durable, countable obligation and a compromised device that
 * nobody is on the hook for.
 */
const DEFAULT_RECOVERY_DISPOSITION: Readonly<
  Record<CredentialRevocationReason, CredentialRecoveryDisposition>
> = {
  // The key is in someone else's hands. A new credential over the same key
  // would repudiate nothing, so the device needs a new key: reprovision.
  KEY_COMPROMISE: "REPROVISION_REQUIRED",
  // "Lost" and "stolen" differ in intent, not in what is owed: in both cases
  // the physical device holding the private key is outside the operator's
  // control, and treating "lost" as the softer case is how a stolen device gets
  // filed as misplaced.
  DEVICE_LOST: "REPROVISION_REQUIRED",
  DEVICE_STOLEN: "REPROVISION_REQUIRED",
  // The provider that held or attested the key is compromised, so every key it
  // vouched for is suspect — a replacement credential from the same provider
  // state is not a recovery.
  PROVIDER_COMPROMISE: "REPROVISION_REQUIRED",
  // The device and its key are fine; the scope the credential asserts is not.
  // Reprovisioning would faithfully re-mint the wrong assignment.
  ASSIGNMENT_INVALIDATED: "REASSIGNMENT_REQUIRED",
  // The credential should never have been issued. The key is untouched, so a
  // correctly issued replacement is the whole remedy.
  CERTIFICATE_MISISSUANCE: "RECOVERY_REQUIRED",
  // Scope UNKNOWN by definition — that is what an incident is until someone
  // rules on it. Group 0136 treats an undeclared approval risk class as
  // insufficient rather than permissive; the same reading applies here, so an
  // undetermined blast radius goes to a human instead of being guessed.
  SECURITY_INCIDENT: "MANUAL_SECURITY_REVIEW",
  // Routine and planned. The device keeps its key and gets a new credential.
  ADMINISTRATIVE_REPLACEMENT: "RECOVERY_REQUIRED",
  // "Other" means the reason was not declared. Undeclared is insufficient, not
  // permissive, so it lands on a person.
  OTHER_APPROVED_REASON: "MANUAL_SECURITY_REVIEW",
};

/**
 * The DEFAULT recovery disposition for a reason. Pure; total by construction.
 *
 * The `Record` above is exhaustive over the reason union, so adding a reason
 * to the enum without deciding what recovery it owes does not compile. That is
 * the point: group 0136 made `recovery_disposition` NOT NULL because "we
 * revoked it and nobody said what happens to the device" is how a fleet
 * acquires bricked terminals nobody is responsible for, and a mapping with a
 * hole would reintroduce exactly that by another route.
 */
export function recoveryDispositionFor(
  reason: CredentialRevocationReason,
): CredentialRecoveryDisposition {
  return DEFAULT_RECOVERY_DISPOSITION[reason];
}

/**
 * The reasons for which `NO_RECOVERY` is refused outright.
 *
 * Each of these says the private key is, or may be, in hands the operator does
 * not control. Revoking the credential ends that key's usefulness for THIS
 * credential and nothing more; declaring that nothing is owed afterwards leaves
 * a compromised key with no replacement scheduled and no case anyone counts.
 */
export const COMPROMISE_REASONS: readonly CredentialRevocationReason[] = [
  "KEY_COMPROMISE",
  "DEVICE_STOLEN",
  "PROVIDER_COMPROMISE",
  // DEVICE_LOST belongs here for the same reason DEVICE_STOLEN does. The
  // distinction between lost and stolen is about intent, not about custody:
  // either way a device holding a private key is somewhere the operator does
  // not control. Leaving it out allowed a lost device to be revoked with
  // NO_RECOVERY, which opens no case and schedules no replacement — the exact
  // outcome this list exists to prevent.
  "DEVICE_LOST",
] as const;

const COMPROMISE_REASON_SET: ReadonlySet<CredentialRevocationReason> = new Set(COMPROMISE_REASONS);

export function reasonForbidsNoRecovery(reason: CredentialRevocationReason): boolean {
  return COMPROMISE_REASON_SET.has(reason);
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

/** The four outcomes `revoke_device_credential_v1` can return. */
export type RevocationOutcomeCode =
  "REVOKED" | "ALREADY_REVOKED" | "REVOCATION_REFUSED" | "MANUAL_REVIEW_REQUIRED";

const KNOWN_OUTCOMES: ReadonlySet<string> = new Set<RevocationOutcomeCode>([
  "REVOKED",
  "ALREADY_REVOKED",
  "REVOCATION_REFUSED",
  "MANUAL_REVIEW_REQUIRED",
]);

/** The refusal codes THIS module decides, before any governed call is made. */
export type RevocationRefusalCode =
  | "REVOCATION_NO_REQUEST_ID"
  | "REVOCATION_NO_REQUESTER"
  | "REVOCATION_NO_SOURCE"
  | "REVOCATION_NO_REASON"
  | "REVOCATION_SELF_APPROVED"
  | "REVOCATION_RECOVERY_DOWNGRADED"
  | "REVOCATION_GATEWAY_FAILED"
  | "REVOCATION_NOT_AUTHORIZED"
  | "REVOCATION_UNKNOWN_OUTCOME";

/**
 * The result of a revocation attempt, mirroring the governed function's jsonb.
 *
 * `refusalCode` is typed `string`, NOT a closed union, on purpose. The refusal
 * vocabulary belongs to the database — `KLUY-CRED-REVOCATION-RISK-CLASS`,
 * `KLUY-REVOKE-CONFLICTING-REASON` and the rest are group 0136's words. A union
 * here would force every new database refusal to be either a compile error or
 * quietly rewritten into one of ours, and quietly rewriting a refusal turns it
 * into a different refusal. The codes this module itself decides are the closed
 * {@link RevocationRefusalCode} union above.
 */
export interface RevocationOutcome {
  readonly outcome: RevocationOutcomeCode;
  readonly refusalCode?: string;
  readonly detail?: string;
  readonly revocationId?: string | null;
  readonly credentialId?: string | null;
  readonly credentialGeneration?: number | null;
  readonly publicKeyFingerprint?: string | null;
  readonly reasonCode?: CredentialRevocationReason;
  readonly recoveryDisposition?: CredentialRecoveryDisposition;
  /** Null when the disposition was `NO_RECOVERY`: nothing is owed, no case. */
  readonly recoveryCaseId?: string | null;
  /**
   * SERVER time, formatted by the database. Not a `Date` derived from a device
   * clock: `effective_at` is an operator decision instant, and a device's
   * trusted time is a different clock answering a different question.
   */
  readonly effectiveAt?: string | null;
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * The exact argument list of `kitluy_devices.revoke_device_credential_governed_v1`
 * — the ONE revocation a runtime identity may execute since group 0145
 * (RC-019). NOT `revoke_device_credential_v1`: EXECUTE on that was revoked from
 * every runtime identity precisely because it takes no scope argument.
 *
 * There is no `credentialId` here either, for the same reason there is none on
 * {@link RevocationInput}: the governed function resolves the credential from
 * device + environment + purpose + generation, and an id travelling down this
 * path would be an id the database trusted from a caller.
 */
export interface GovernedRevocationCall {
  readonly revocationRequestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly credentialGeneration: number;
  readonly reasonCode: CredentialRevocationReason;
  readonly reason: string;
  readonly recoveryDisposition: CredentialRecoveryDisposition;
  readonly requestedBy: string;
  readonly source: string;
  readonly approvalRequestId: string | null;
  readonly approvedBy: string | null;
  readonly incidentReference: string | null;
  /**
   * The RECORDED SCOPE this revocation spends — migration group 0141/0142.
   *
   * REQUIRED for PROVIDER_COMPROMISE, SECURITY_INCIDENT and
   * OTHER_APPROVED_REASON, whose affected set decision §3 says cannot be
   * derived from the fleet. Absent for those reasons the governed entry point
   * refuses `KLUY-CRED-REVOCATION-SCOPE-MISSING`, which is the correct answer:
   * a caller that cannot say what the incident reached is not asking for a
   * scoped revocation, it is asking to skip the scope.
   */
  readonly incidentScopeId?: string | null;
  /**
   * Scope SELECTORS for the six fleet-derived reasons. These do not choose the
   * scope — `resolve_revocation_scope_v1` derives it from the REASON — they
   * tell the resolver which key, fingerprint or assignment generation the
   * reason is about. KEY_COMPROMISE without a key reference resolves nothing
   * and is refused `SCOPE-UNRESOLVED`, which is why they are carried here
   * rather than left to the caller's imagination.
   */
  readonly providerKeyReference?: string | null;
  readonly publicKeyFingerprint?: string | null;
  readonly assignmentGeneration?: number | null;
}

/**
 * The database port. ONE method, wrapping ONE governed function.
 *
 * There is deliberately NO method that writes `device_credential_revocations`,
 * sets `device_credentials.state`, or opens a `device_recovery_cases` row
 * directly. Group 0136 granted the issuance executor EXECUTE on the unscoped
 * function; group 0145 REVOKED that — it was the RC-019 bypass — and the
 * repository still withholds INSERT on the evidence table and UPDATE on the
 * credential, and
 * withholds INSERT on the evidence table and UPDATE on the credential — and
 * asserts both, so a migration that loosened it would fail. A convenience
 * method here would be a second path to the same rows that skips the four-eyes
 * gate, the evidence and the recovery case, which is the arrangement that
 * assertion exists to make impossible. Adding one is not an optimisation.
 */
export interface RevocationGateway {
  /**
   * Wraps `kitluy_devices.revoke_device_credential_bound_v1` — the ONE normal
   * revocation entry point a runtime identity may execute since migration group
   * 0147 (RC-019). It is NOT `revoke_device_credential_v1` and NOT the
   * tautological `revoke_device_credential_governed_v1`: EXECUTE on both was
   * revoked from every runtime identity. An adapter still aimed there fails
   * `permission denied`, which is the intended and safe outcome.
   */
  revokeDeviceCredential(call: GovernedRevocationCall): Promise<RevocationOutcome>;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * What a caller may ask for.
 *
 * NOTE THE ABSENT FIELD. There is no `credentialId` and there will not be one.
 * The scope a caller states is device + environment + purpose + generation, and
 * the governed function resolves the credential row from it. A caller that
 * could name a credential id could name ANOTHER DEVICE'S credential id and
 * repudiate it — the revocation would be perfectly well-formed, correctly
 * approved for the device it names, and applied to a credential belonging to a
 * device nobody reviewed. Group 0136 says the same thing in SQL ("never
 * accepted from the caller"); this type makes it unrepresentable one layer up,
 * so the two statements cannot drift.
 */
export interface RevocationInput {
  /** Stable per revocation INTENT. Replaying it is idempotent, not a second effect. */
  readonly revocationRequestId: string;
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
  readonly credentialGeneration: number;
  readonly reasonCode: CredentialRevocationReason;
  /** Free text. Required, and required to be non-empty — see the refusals below. */
  readonly reason: string;
  /**
   * Optional. Absent means {@link recoveryDispositionFor}'s default for the
   * reason, which is why no caller has to know the table to revoke safely.
   */
  readonly recoveryDisposition?: CredentialRecoveryDisposition;
  readonly requestedBy: string;
  readonly source: string;
  readonly approvalRequestId?: string | null;
  readonly approvedBy?: string | null;
  readonly incidentReference?: string | null;
  /**
   * The RECORDED SCOPE this revocation spends — migration group 0141/0142.
   *
   * REQUIRED for PROVIDER_COMPROMISE, SECURITY_INCIDENT and
   * OTHER_APPROVED_REASON, whose affected set decision §3 says cannot be
   * derived from the fleet. Absent for those reasons the governed entry point
   * refuses `KLUY-CRED-REVOCATION-SCOPE-MISSING`, which is the correct answer:
   * a caller that cannot say what the incident reached is not asking for a
   * scoped revocation, it is asking to skip the scope.
   */
  readonly incidentScopeId?: string | null;
  /**
   * Scope SELECTORS for the six fleet-derived reasons. These do not choose the
   * scope — `resolve_revocation_scope_v1` derives it from the REASON — they
   * tell the resolver which key, fingerprint or assignment generation the
   * reason is about. KEY_COMPROMISE without a key reference resolves nothing
   * and is refused `SCOPE-UNRESOLVED`, which is why they are carried here
   * rather than left to the caller's imagination.
   */
  readonly providerKeyReference?: string | null;
  readonly publicKeyFingerprint?: string | null;
  readonly assignmentGeneration?: number | null;
}

// ---------------------------------------------------------------------------
// The orchestrator
// ---------------------------------------------------------------------------

const blank = (value: string | null | undefined): boolean => (value ?? "").trim() === "";
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** CLASS only. A driver message can carry the statement and its bound values. */
const errorClass = (e: unknown): string =>
  e instanceof Error
    ? `the revocation gateway call failed (${e.name})`
    : "the revocation gateway call failed";

/**
 * PostgreSQL `42501 insufficient_privilege`, however the driver surfaces it.
 * Checked by SQLSTATE first because that is the stable signal; the message is
 * only a fallback for drivers that do not expose `code`.
 */
function isAuthorizationDenied(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "42501") return true;
  return /permission denied|insufficient.privilege/i.test(errorText(error));
}

/**
 * Attempts one governed revocation.
 *
 * The refusals below all happen BEFORE the gateway is touched. That ordering is
 * the substance of them: group 0136 consumes an approval single-use, so a
 * request that the database would refuse anyway must not reach it and burn one.
 * A refusal here is also a REFUSAL, never a thrown error — a caller draining a
 * list of revocations must not lose the rest of the batch because one entry had
 * an empty reason.
 */
export async function revokeDeviceCredential(
  input: RevocationInput,
  gateway: RevocationGateway,
): Promise<RevocationOutcome> {
  const refuse = (refusalCode: RevocationRefusalCode, detail: string): RevocationOutcome => ({
    outcome: "REVOCATION_REFUSED",
    refusalCode,
    detail,
  });

  // 1. IDENTITY OF THE INTENT. Without it there is nothing for a retry to match
  //    and every retry is a fresh revocation of the same credential.
  if (blank(input.revocationRequestId)) {
    return refuse(
      "REVOCATION_NO_REQUEST_ID",
      "a revocation intent is identified so that a retry is idempotent",
    );
  }

  // 2. WHO. An unattributed revocation is an unaccountable one, and the
  //    evidence row exists to answer "who asked" months later.
  if (blank(input.requestedBy)) {
    return refuse("REVOCATION_NO_REQUESTER", "a revocation names the identity that requested it");
  }
  if (blank(input.source)) {
    return refuse("REVOCATION_NO_SOURCE", "a revocation names the system it was requested from");
  }

  // 3. WHY. `device_credential_revocations.reason` is CHECKed non-empty in the
  //    database; refusing here keeps that from arriving as a raised exception,
  //    and a blank reason is the one field nobody can reconstruct afterwards.
  if (blank(input.reason)) {
    return refuse(
      "REVOCATION_NO_REASON",
      "a revocation states why; a status change nobody can explain is not evidence",
    );
  }

  // 4. FOUR EYES. Compared on TRIMMED values, because " alice" and "alice" are
  //    one person and a self-approval that only had to survive string equality
  //    would be defeated by a space.
  const requester = input.requestedBy.trim();
  const approver = (input.approvedBy ?? "").trim();
  if (approver !== "" && approver === requester) {
    return refuse(
      "REVOCATION_SELF_APPROVED",
      "the requester and the approver must be different people",
    );
  }

  // 5. RECOVERY. Defaulted from the reason, and not downgradable for a reason
  //    that says a key may be in someone else's hands.
  const recoveryDisposition = input.recoveryDisposition ?? recoveryDispositionFor(input.reasonCode);
  if (recoveryDisposition === "NO_RECOVERY" && reasonForbidsNoRecovery(input.reasonCode)) {
    return refuse(
      "REVOCATION_RECOVERY_DOWNGRADED",
      `${input.reasonCode} cannot be revoked with NO_RECOVERY; a compromise leaves an obligation, and NO_RECOVERY opens no recovery case for anyone to count`,
    );
  }

  let outcome: RevocationOutcome;
  try {
    outcome = await gateway.revokeDeviceCredential({
      revocationRequestId: input.revocationRequestId.trim(),
      deviceRecordId: input.deviceRecordId,
      environment: input.environment,
      purpose: input.purpose,
      credentialGeneration: input.credentialGeneration,
      reasonCode: input.reasonCode,
      reason: input.reason,
      recoveryDisposition,
      requestedBy: requester,
      source: input.source.trim(),
      approvalRequestId: input.approvalRequestId ?? null,
      approvedBy: approver === "" ? null : approver,
      incidentReference: input.incidentReference ?? null,
      incidentScopeId: input.incidentScopeId ?? null,
      providerKeyReference: input.providerKeyReference ?? null,
      publicKeyFingerprint: input.publicKeyFingerprint ?? null,
      assignmentGeneration: input.assignmentGeneration ?? null,
    });
  } catch (error) {
    // A transport or constraint failure is a REFUSAL, never a silent success.
    // The credential's state is unknown from here; reporting anything else
    // would assert a revocation that may not have happened.
    // A PRIVILEGE denial is not a transient outage, and the difference decides
    // whether a worker retries. Since group 0145 an adapter still aimed at the
    // unscoped `revoke_device_credential_v1` gets SQLSTATE 42501 — permanent,
    // and retrying it five times only burns the attempt budget before
    // dead-lettering it as a database problem instead of the authorization
    // problem it is.
    //
    // The message is NOT carried through. `key-destruction.ts` redacts provider
    // errors to a class for exactly this reason, and a driver message routinely
    // repeats the failing statement and sometimes its bound values; the two
    // modules should not disagree about that.
    if (isAuthorizationDenied(error)) {
      return refuse(
        "REVOCATION_NOT_AUTHORIZED",
        "the revocation gateway is not authorized to execute the governed revocation; this is permanent and must not be retried",
      );
    }
    return refuse("REVOCATION_GATEWAY_FAILED", errorClass(error));
  }

  // The governed outcome is returned AS IT CAME. `ALREADY_REVOKED` is not
  // "REVOKED, again" and `MANUAL_REVIEW_REQUIRED` is not a success with a note:
  // the second is group 0136 saying a DIFFERENT intent met an already-revoked
  // credential and the first account of why it was repudiated is not being
  // overwritten. Flattening either into a success is how a conflict becomes a
  // green tick in a report.
  if (!KNOWN_OUTCOMES.has(outcome.outcome)) {
    // Unreachable through the type system, and earns its keep at the jsonb
    // boundary where an adapter parses whatever the database actually sent.
    // Fails towards review, never towards success.
    return {
      ...outcome,
      outcome: "MANUAL_REVIEW_REQUIRED",
      refusalCode: "REVOCATION_UNKNOWN_OUTCOME" satisfies RevocationRefusalCode,
      detail: `the governed revocation returned an unrecognised outcome (${String(outcome.outcome)})`,
    };
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// The verifier's view
// ---------------------------------------------------------------------------

/**
 * One row of `device_credential_revocations`, as the verifier needs it.
 *
 * `certificateSerial` is JOINED from `device_credentials.serial_number`; the
 * evidence row itself records the credential id, generation and fingerprint but
 * not the serial, and the serial is what a presented credential carries. The
 * join is the caller's, so this type states the requirement rather than letting
 * a snapshot be built that silently matches nothing.
 */
export interface RevokedCredentialRecord {
  readonly revocationId: string;
  readonly credentialId: string;
  readonly certificateSerial: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly credentialGeneration: number;
  readonly publicKeyFingerprint: string;
  readonly reasonCode: CredentialRevocationReason;
  readonly recoveryDisposition: CredentialRecoveryDisposition;
  /** SERVER time. Recorded as evidence; see why it is not compared below. */
  readonly effectiveAt: Date;
}

/**
 * The reasons that repudiate the DEVICE, not merely one of its credentials.
 *
 * The distinction is load-bearing in both directions:
 *
 *   too WIDE  — an ADMINISTRATIVE_REPLACEMENT of generation 1 that marked the
 *               whole device revoked would refuse the generation 2 credential
 *               that replacement just issued. Routine renewal would brick the
 *               fleet one device at a time.
 *   too NARROW— a STOLEN device whose revocation only covered the serial it
 *               held would present any other credential it has, or is later
 *               given, and be accepted. The credential was never the problem;
 *               possession of the device was.
 *
 * SECURITY_INCIDENT and OTHER_APPROVED_REASON are here because their scope is
 * UNDECLARED, and group 0136 rules that undeclared is insufficient rather than
 * permissive ("An UNDECLARED risk class is insufficient, not permissive"). Both
 * also default to MANUAL_SECURITY_REVIEW, so a human is already expected.
 *
 * KEY_COMPROMISE and PROVIDER_COMPROMISE are deliberately ABSENT. They condemn
 * a KEY, and the device's remedy is a new key: marking the device itself
 * revoked would refuse the reprovisioned credential that fixes the compromise.
 */
/*
 * REPOSITORY DEFAULT, NOT AN OWNER RULING.
 *
 * Group 0136 revokes CREDENTIALS and says nothing about when a whole DEVICE is
 * to be treated as revoked — it deliberately separates the two. The table below
 * is this repository's fail-safe default, and the reasoning for each row is
 * above, but "which revocation reasons condemn the device itself" is a security
 * policy an owner should rule on rather than inherit from an implementation.
 *
 * Owner decision KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001
 * (OWNER-APPROVED 2026-07-29) rules revocation SCOPE per reason — see its §3
 * table. That ruling is NOT YET IMPLEMENTED: scope resolution is outstanding
 * Phase 1 work, and this table is the narrower device-level read used today.
 * When scope resolution lands, the decision §3 table becomes authoritative and
 * this one should be re-derived from it rather than maintained in parallel.
 */
const DEVICE_SCOPED_REASONS: Readonly<Record<CredentialRevocationReason, boolean>> = {
  KEY_COMPROMISE: false,
  DEVICE_LOST: true,
  DEVICE_STOLEN: true,
  PROVIDER_COMPROMISE: false,
  ASSIGNMENT_INVALIDATED: false,
  CERTIFICATE_MISISSUANCE: false,
  SECURITY_INCIDENT: true,
  ADMINISTRATIVE_REPLACEMENT: false,
  OTHER_APPROVED_REASON: true,
};

export function reasonRevokesTheDevice(reason: CredentialRevocationReason): boolean {
  return DEVICE_SCOPED_REASONS[reason];
}

/**
 * Builds the {@link RevocationLookup} `evaluateCertificateValidity` consumes.
 *
 * Two properties this function does NOT have, both on purpose:
 *
 * 1. It does not compare `effectiveAt` against anything. `effective_at` is
 *    SERVER time — group 0136 says so and says why: routing the moment a
 *    repudiation takes effect through a device's trusted clock would let a
 *    device with a manipulated clock postpone its own revocation. The verifier
 *    holds device trusted time; those are two clocks answering two questions,
 *    and a rule comparing one against the other is a defect waiting for the
 *    wrong skew sign. A row present in this snapshot is in force.
 *
 * 2. It never expires a device-scoped revocation. Clearing one is a recovery
 *    action that belongs to a later WS-11 task; inventing a rule here — "lift
 *    it once the case is resolved" — would make a resolved-by-mistake case
 *    silently re-admit a stolen device. Standing until someone with authority
 *    lifts it is the direction that fails safely.
 *
 * The lookup is a plain projection over the rows it was given; it does not know
 * about environments, because the CALLER built the row set for one environment
 * and a lookup that silently filtered would hide a snapshot assembled wrongly.
 */
export function revokedCredentialsSnapshot(
  rows: readonly RevokedCredentialRecord[],
): RevocationLookup {
  const serials = new Set<string>();
  const devices = new Set<string>();
  for (const row of rows) {
    serials.add(row.certificateSerial);
    if (reasonRevokesTheDevice(row.reasonCode)) devices.add(row.deviceRecordId);
  }
  return {
    isCertificateRevoked: (certificateSerial: string) => serials.has(certificateSerial),
    isDeviceRevoked: (deviceRecordId: string) => devices.has(deviceRecordId),
  };
}
