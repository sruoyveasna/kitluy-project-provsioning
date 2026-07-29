# KitLuy Owner Decision — Device Private-Key Retention and Destruction

**Decision ID:** KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001
**Closes:** KLREQ-031
**Decision owner:** HET / Project Owner
**Effective scope:** KitLuy development, internal, pilot, and production device-identity environments
**Decision date:** 2026-07-29
**Status:** OWNER-APPROVED
**Approved by:** HET / Project Owner
**Approved on:** 2026-07-29
**Approval record:** Approved as written, without amendment, during WS-11-T003
Step 4 completion. The values in §15 are the approved values; nothing in this
document was paraphrased, rounded or reinterpreted during implementation.

> Approval closes the MISSING-POLICY requirement (KLREQ-031) only. Per §17 it
> does not itself promote any implementation. `destruction_enabled = true`
> permits the governed workflow to accept requests; it authorizes neither
> automatic nor approval-free destruction.

## 1. Decision

KitLuy may destroy a superseded or abandoned device private key only after all credential, overlap, recovery, reconciliation, incident-hold, legal-hold, authorization, provider-confirmation, and audit requirements in this decision are satisfied.

Private-key destruction is:

- irreversible;
- separate from credential retirement;
- separate from credential revocation;
- separate from device containment;
- never inferred from a credential status alone.

No active or referenced key may be destroyed.

## 2. Superseded-key minimum retention

A normally superseded device private key must be retained for at least:

```text
30 calendar days after credential overlap_ends_at
```

The retention clock begins only after the permitted credential overlap has ended.

A key remains ineligible when `overlap_ends_at` is absent, disputed, derived from untrusted time, or not associated with an authoritative credential-head transition.

## 3. Abandoned-key minimum retention

A generated replacement key that never became active and is terminally marked `abandoned` must be retained for at least:

```text
7 calendar days after abandoned_at
```

The key must not be associated with:

- an issued credential;
- a current or previous credential head;
- an active renewal;
- an unfinished issuance attempt;
- an unresolved reconciliation;
- a manual-review case;
- an incident or legal hold.

An abandoned key cannot be reused during this retention period.

## 4. Recovery retention

A superseded or abandoned key must also be retained for at least:

```text
14 calendar days after the latest related renewal, issuance,
activation, reconciliation, or recovery process reached a verified
terminal state
```

The destruction eligibility time is the latest applicable value:

```text
superseded key:
max(
  overlap_ends_at + 30 days,
  latest_verified_terminal_recovery_at + 14 days
)

abandoned key:
max(
  abandoned_at + 7 days,
  latest_verified_terminal_recovery_at + 14 days
)
```

When no verified terminal recovery timestamp exists, the key is not destruction-eligible.

## 5. Destruction blockers

A key must not be destroyed while any of the following is true:

- referenced by the current credential;
- referenced by a credential still valid through approved overlap;
- referenced by another valid credential;
- active or pending activation;
- attached to an unfinished issuance or renewal attempt;
- attached to pending reconciliation;
- attached to manual review;
- provider and database state disagree;
- credential-head state is inconsistent;
- trusted time is unavailable or untrusted;
- destruction retention has not elapsed;
- incident hold is active;
- legal or regulatory hold is active;
- audit-preservation hold is active;
- provider destruction capability is unavailable;
- required approval is absent or expired.

Unknown states fail closed.

## 6. Authorization model

Private-key destruction requires two distinct authorized humans:

```text
Requester
→ Approver
→ Provider destruction
→ Database confirmation
```

The requester and approver must be different users.

Required permission concepts:

```text
fleet.device_key.destruction_request
fleet.device_key.destruction_approve
fleet.device_key.hold_manage
```

These permission keys must be added through the governed RBAC registry before pilot or production use. Until registered, destruction fails closed.

### Requester requirements

The requester must:

- re-authenticate;
- provide a reason;
- identify the device, environment, purpose, key generation, fingerprint, and provider reference;
- confirm all retention and recovery conditions;
- confirm no hold is known;
- submit an immutable destruction request.

### Approver requirements

The approver must:

- be a different authorized user;
- re-authenticate;
- independently verify eligibility;
- verify the provider key reference and fingerprint;
- verify that the key is not current or referenced;
- approve or reject with a reason.

Approval expires after:

```text
24 hours
```

An expired approval requires a new eligibility evaluation and approval.

## 7. Automation policy

Discovery, eligibility evaluation, evidence collection, and request preparation may be automated.

The irreversible provider destruction call must not be fully automatic for internal, pilot, or production environments.

Required behavior:

```text
automated discovery
→ automated eligibility evaluation
→ human destruction request
→ distinct human approval
→ automated provider destruction
→ automated database confirmation
```

Development test fixtures may simulate automatic destruction only inside isolated test providers and disposable test identities. Such tests do not authorize destruction in shared development infrastructure.

## 8. Incident and legal holds

The following authorized functions may place a hold:

- CISO or delegated security incident authority;
- General Counsel or delegated legal authority;
- authorized compliance owner;
- authorized incident commander for an active security incident.

A hold immediately suspends:

- eligibility completion;
- pending destruction execution;
- approval use;
- retry of a failed destruction operation.

Required hold fields:

```text
hold_id
hold_type
device_record_id
provider_key_reference
public_key_fingerprint
key_generation
reason
declared_by
declared_at
review_due_at
released_by
released_at
release_reason
audit_event_id
```

A hold release requires an authorized human other than the original declarer, unless an emergency policy explicitly authorizes the same role and records the exception.

Releasing a hold does not resume an old approval. Eligibility and four-eyes approval must be performed again.

## 9. Provider destruction execution

The provider destruction call must be idempotent and bind:

```text
device_record_id
environment
purpose
provider_key_reference
public_key_fingerprint
key_generation
superseding_credential_id or abandonment record
policy decision ID
destruction request ID
approval ID
```

Accepted provider outcomes:

```text
DESTROYED
ALREADY_DESTROYED with matching prior evidence
```

The database must not mark the key `destroyed` before one of those outcomes is verified.

Provider timeout, ambiguous response, missing key, changed reference, changed fingerprint, or changed generation must produce manual review—not assumed success.

## 10. Database lifecycle

The permitted lifecycle is:

```text
superseded or abandoned
→ destruction_eligible
→ destruction_requested
→ destruction_approved
→ destruction_pending
→ destroyed
```

Failure states may include:

```text
destruction_failed
manual_review
hold_active
```

Required invariants:

- `active` cannot transition directly to `destroyed`;
- `credential_issued_pending_activation` cannot be destroyed;
- current-key references block eligibility;
- destroyed is terminal;
- failed destruction never becomes destroyed without verified provider evidence;
- duplicate execution produces one business effect;
- database/provider divergence enters manual review.

## 11. Surviving evidence

The following evidence must survive private-key destruction permanently according to KitLuy audit-retention policy:

```text
device_record_id
environment
purpose
provider name
provider key reference
public-key fingerprint
public key where policy permits
key generation
key lifecycle history
related credential IDs and generations
overlap_ends_at
eligibility calculation
retention timestamps
recovery-terminal timestamp
hold checks
requester identity
approver identity
request and approval timestamps
reasons
policy decision ID and version
provider destruction result
provider receipt or attestation
receipt digest
database confirmation
worker/execution identity
audit event IDs
failure and retry history
destroyed_at
```

The evidence must never contain:

- private-key material;
- exportable provider secrets;
- database credentials;
- bearer tokens;
- unredacted sensitive provider responses.

## 12. Provider proof requirement

A destruction operation is complete only when KitLuy retains either:

1. a provider-issued destruction receipt or signed attestation; or
2. a deterministic provider response with request ID, provider key reference, timestamp, and verifiable audit-log correlation.

KitLuy must store a digest of the receipt or attestation and retain the original evidence in the governed File Service when supported.

A local database status alone is insufficient proof of provider destruction.

## 13. Failure and retry policy

Retryable failures include:

- temporary provider outage;
- network timeout with no confirmed provider result;
- temporary database outage before confirmation.

Retries must preserve the original destruction request and approval.

A retry must not:

- generate a new key reference;
- change the fingerprint;
- change the key generation;
- change the approving users;
- silently extend an expired approval.

Ambiguous provider outcomes require reconciliation before retry.

After five failed execution attempts, the operation enters manual review.

## 14. Environment policy

### Development

Shared development infrastructure follows the full approval policy.

Disposable unit-test and isolated integration-test providers may simulate destruction without human approval, but must never target shared or persistent provider keys.

### Internal, Pilot, and Production

Four-eyes approval, re-authentication, reason, immutable audit, and provider evidence are mandatory.

No environment may enable destruction merely by setting a feature flag without the approved policy record and required RBAC permissions.

## 15. Configuration values

Upon owner approval, configure:

```text
destruction_enabled = true

superseded_minimum_retention_days = 30
abandoned_minimum_retention_days = 7
recovery_retention_days = 14
approval_validity_hours = 24
maximum_execution_attempts = 5

automatic_provider_destruction = false
four_eyes_required = true
reauthentication_required = true
reason_required = true

owner_decision_reference =
KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001
```

`destruction_enabled = true` means the governed workflow may accept destruction requests. It does not permit automatic or approval-free destruction.

## 16. Implementation sequence

Implementation must proceed additively:

1. Record this owner decision.
2. Register RBAC permissions and audit events.
3. Extend the destruction-policy schema with the approved values.
4. Add hold, request, approval, execution, and evidence records.
5. Add governed eligibility and request operations.
6. Add governed four-eyes approval.
7. Add provider destruction and reconciliation.
8. Add database confirmation.
9. Add worker support.
10. Add hostile authorization, idempotency, hold, failure, and concurrency tests.
11. Run independent security review.
12. Enable only after review approval.

No existing migration may be rewritten.

## 17. Promotion restriction

This decision closes the missing-policy requirement only.

It does not prove the destruction implementation exists.

After owner approval:

```text
KLREQ-031 → OWNER-APPROVED
Provider-key destruction → SPECIFIED / IMPLEMENTATION PENDING
```

Only repository, migration, tests, provider evidence, and independent-review results may later promote it to `IMPLEMENTED-IN-DEV`, pilot-ready, or production-ready.
