# KitLuy Owner Decision — Revocation Scope Binding and Approval-Gate Boundary

**Decision ID:** KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002
**Amends:** KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001
**Decision owner:** HET / Project Owner
**Effective scope:** KitLuy development, internal, pilot and production
device-identity environments
**Decision date:** 2026-07-29
**Status:** OWNER-APPROVED
**Approved by:** HET / Project Owner
**Approved on:** 2026-07-29
**Approval record:** Four rulings, approved as written. They answer two
questions raised by the implementation of groups 0136-0139 and close one
security boundary that the implementation had left wider than intended.

## Ruling 1 — Scope storage, and the binding that makes it trustworthy

The separate `revocation_recorded_scopes` design is **APPROVED** instead of
adding full payload storage to `kitluy_auth.approval_requests`.

The approval request must **cryptographically bind the exact scope** through its
`payload_hash`. Identifiers are canonicalized and sorted, and the digest binds at
least:

```text
scope digest
revocation reason
environment
tenant / digital store / location scope, as applicable
subject type
identifier count
requester
owner-decision version
```

A recorded scope is **immutable once submitted**. It cannot be expanded,
reduced, updated or deleted after approval. Any change requires a new request
and a new approval.

The approval is **single-use and consumed atomically with the revocation**.

Empty, missing, malformed, mutable or hash-mismatched scope **fails closed**. No
unrestricted wildcard is permitted. Scope and approval evidence are append-only.

> The binding is the point. A scope recorded beside an approval, rather than
> inside what the approver signed, is a scope somebody can change after the
> approval and before the execution. Hashing the canonicalized identifier set
> into `payload_hash` means the approver approved THAT set, and any other set is
> a different request.

## Ruling 2 — The approval gate may not run as `service_role`

A `SECURITY DEFINER` owned by the global-BYPASSRLS `service_role` is **NOT
approved** as the final Step 4 design. Migration 0139 shipped it as the only
route available at the time; this ruling supersedes that additively.

Additive migration **0140** introduces a purpose-built role:

```text
kitluy_credential_approval_reader
```

Required properties:

- NOLOGIN;
- **no BYPASSRLS**;
- no membership granted to any application, worker, issuer, service or human
  role;
- minimum schema usage;
- minimum SELECT, or column-level SELECT;
- **exactly three narrowly scoped RLS SELECT policies** on the required approval
  relations;
- policy visibility limited to credential-revocation approval records;
- no write privileges.

The approval-evaluation `SECURITY DEFINER` is transferred to or recreated under
this role, and must: use a pinned `search_path`; contain no dynamic SQL; perform
no writes; return only authorized/refusal information; expose no approval row or
payload; revoke PUBLIC EXECUTE; and be executable only by the credential
governor.

**The RLS policy census increase from 58 to 61 is OWNER-APPROVED for this exact
purpose.** Migration 0139 is not rewritten; its `service_role` ownership is
superseded additively.

## Ruling 3 — Revocation finality

**Every credential revocation is irreversible**, not only emergency revocation.

A revoked credential must never return to issued, active, overlapping or
cryptographically acceptable status. Recovery occurs through governed
replacement issuance only.

> This generalizes what group 0138 already enforced with its one-way trigger.
> That implementation applied the rule to every revocation on the reasoning that
> nothing here has ever had a legitimate reason to un-revoke; this ruling makes
> that the owner's rule rather than the implementer's.

## Ruling 4 — The emergency deadline

The emergency post-approval deadline **may be shortened but never extended,
reset or renewed**.

A missed or refused post-approval leaves the credential **revoked** and moves the
case to `MANUAL_SECURITY_REVIEW` with incident escalation.

> Group 0138 implemented exactly this asymmetry and flagged it as a deliberate,
> narrower-than-frozen choice needing confirmation. It is now confirmed as
> policy. Shortening can only cause an earlier escalation, and escalation never
> restores a credential; extending is the attack.

## Required evidence for migration 0140

Executable negative controls, not inspection:

1. `service_role` no longer owns the approval gate.
2. `service_role` ownership is not required for successful evaluation.
3. The dedicated reader is NOLOGIN and lacks BYPASSRLS.
4. Application, worker, issuer and service identities cannot `SET ROLE` to it.
5. The reader sees only the required revocation approval records.
6. Unrelated approval records remain invisible.
7. Cross-tenant, cross-store, cross-location and cross-device approvals fail.
8. Removing any required policy makes the gate fail closed.
9. PUBLIC cannot execute the function.
10. Only the credential governor can execute it.
11. The function cannot write approval data.
12. An exact scope-hash mismatch refuses revocation.
13. Post-approval scope mutation is impossible.
14. Duplicate scope consumption is refused.
15. Changing one identifier requires a new approval.
16. An empty or wildcard broader scope is refused.
17. All revoked credentials remain permanently revoked.

## Promotion restriction

These rulings close policy and boundary questions only. They promote no
implementation. Only repository, migration, test and independent-review evidence
may advance any status.
