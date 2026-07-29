# KitLuy Owner Decision — Device Credential Revocation Approval and Scope

**Decision ID:** KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001
**Closes:** `[REQUIRED: device_credential_revocation_approval_policy]` and
`[REQUIRED: device_revocation_scope_policy]`
**Decision owner:** HET / Project Owner
**Effective scope:** KitLuy development, internal, pilot and production
device-identity environments
**Decision date:** 2026-07-29
**Status:** OWNER-APPROVED
**Approved by:** HET / Project Owner
**Approved on:** 2026-07-29
**Approval record:** Approved as written, without amendment. The reason lists
and the scope table below are the approved values; nothing was paraphrased,
widened or narrowed during implementation.

> This decision governs WHO may revoke and WHAT a revocation reaches. It does
> not itself promote any implementation. Migration group 0136 shipped the
> governed revocation path requiring approval for every reason, which is the
> fail-closed default this decision now refines.

## 1. Revocation is its own control

Credential revocation remains distinct from credential expiry, overlap
retirement, device containment, provider-key supersession and provider-key
destruction. None of those implies revocation, and revocation implies none of
them. A revocation is a standing declaration that a credential is repudiated
and must fail verification immediately, before its expiry and through any
granted overlap.

## 2. Four-eyes policy

**Normal revocations require approval by two distinct authorized humans BEFORE
execution.**

### 2.1 Approve-before-execute reasons

These reasons may never execute without a completed prior approval:

```text
ASSIGNMENT_INVALIDATED
CERTIFICATE_MISISSUANCE
ADMINISTRATIVE_REPLACEMENT
OTHER_APPROVED_REASON
```

None of these describes an active compromise. Waiting for a second person costs
nothing that matters, and the discipline is what stops an administrative action
from becoming an unreviewed one.

### 2.2 Emergency immediate-revocation reasons

An emergency path that executes IMMEDIATELY, before a second approval, is
permitted only for:

```text
KEY_COMPROMISE
DEVICE_LOST
DEVICE_STOLEN
PROVIDER_COMPROMISE
SECURITY_INCIDENT
```

Every one of these means a private key may be in hands the operator does not
control. Making an incident responder wait for a second signature while that is
true would be the more dangerous policy.

### 2.3 Emergency requirements

Emergency execution requires ALL of:

```text
an authorized CISO or incident commander
re-authentication
a mandatory reason
an incident reference
immutable audit
a distinct second-person post-approval within 4 hours
```

### 2.4 Post-approval, and what it cannot do

The revocation **takes effect immediately** and **must never automatically
reverse**.

A late, missing or refused post-approval does NOT restore the credential. The
case moves to `MANUAL_SECURITY_REVIEW` and the incident escalates.

This is deliberate and is the most important sentence in this decision. An
auto-reversing revocation would mean an attacker who merely delays the second
approver gets the credential back — the emergency path would become a way to
schedule un-revocation. Revocation is one-way; the review that follows decides
what happens next, not whether it happened.

### 2.5 No machine-initiated revocation

**No automatic machine-generated revocation is approved for Phase 1.** A worker
may detect, record and escalate. It may not decide to revoke. Every revocation
in Phase 1 originates with a named human.

## 3. Revocation scope policy

The scope a revocation reaches is determined by its reason, and is not the
caller's choice:

| Reason                       | Required scope                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `DEVICE_LOST`                | All active and overlapping credentials for that device in the affected environment         |
| `DEVICE_STOLEN`              | All active and overlapping credentials for that device in the affected environment         |
| `KEY_COMPROMISE`             | Every credential bound to the compromised provider key reference or public-key fingerprint |
| `ASSIGNMENT_INVALIDATED`     | All credentials issued under the invalidated assignment generation                         |
| `CERTIFICATE_MISISSUANCE`    | The identified credential only, plus explicitly linked duplicates                          |
| `ADMINISTRATIVE_REPLACEMENT` | The identified credential only                                                             |
| `OTHER_APPROVED_REASON`      | The credential only, unless the approved request explicitly names a broader scope          |
| `PROVIDER_COMPROMISE`        | An explicitly recorded incident-defined affected-key set                                   |
| `SECURITY_INCIDENT`          | An explicitly recorded incident-defined device/key/credential set                          |

### 3.1 No wildcards

`PROVIDER_COMPROMISE` and `SECURITY_INCIDENT` **must never use an unrestricted
"all devices" wildcard.** The affected set must be explicitly recorded and
approved.

A wildcard revocation is indistinguishable from a fleet-wide denial of service
issued by whoever can reach the revocation path. The affected set being written
down is what makes the blast radius reviewable before it happens and auditable
afterwards.

### 3.2 Unknown scope fails closed

When the affected scope cannot be determined, the operation **fails closed** and
enters manual security review. It does not guess narrow, and it does not guess
wide.

## 4. Implementation obligations

Additive only. No applied migration is rewritten.

1. Record this decision and resolve both `[REQUIRED: ...]` markers.
2. Extend the revocation policy with the emergency reason set, the
   approve-before-execute reason set, and the 4-hour post-approval window.
3. Add durable emergency-revocation records: declaring authority, incident
   reference, re-authentication evidence, post-approval deadline, and the
   post-approval decision or its absence.
4. Add scope resolution per §3, derived from the reason rather than accepted
   from the caller.
5. Refuse a wildcard scope for `PROVIDER_COMPROMISE` and `SECURITY_INCIDENT` by
   constraint, not convention.
6. Add hostile tests for every reason in §2 and every row of §3, including the
   missed-post-approval path and the unknown-scope refusal.
7. Independent review before any promotion.

## 5. Promotion restriction

This decision closes the missing-policy requirements only. It does not prove the
implementation exists. Only repository, migration, test and independent-review
evidence may promote governed credential revocation to `IMPLEMENTED-IN-DEV`.
