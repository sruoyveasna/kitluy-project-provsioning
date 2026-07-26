# KitLuy API Error Code Registry

**Filename:** `kitluy-api-error-code-registry-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical shared target registry; not implementation evidence

## 1. Purpose

Provide stable machine-readable errors across the four governed API surfaces without merging their trust boundaries. Codes are immutable after Stable release. Message wording/localization may improve without changing code semantics.

## 2. Error envelope contract

```json
{
  "error": {
    "code": "RESOURCE_VERSION_CONFLICT",
    "message": "The resource changed.",
    "message_key": "api.error.resource_version_conflict",
    "retryable": false,
    "severity": "blocking",
    "request_id": "uuid",
    "details": [],
    "operator_action": "Refresh and reconcile."
  }
}
```

## 3. Registration rules

1. Every production error code is registered here before release.
2. Codes are uppercase `SNAKE_CASE`; surface prefixes are used for domain-specific errors.
3. HTTP status is transport classification and does not replace the code.
4. `retryable=true` means safe only under the documented retry/idempotency contract.
5. Authorization denials do not expose confidential policy internals.
6. Customer-facing messages support Khmer and English; code remains unchanged.
7. Retired codes remain documented with replacement and last-supported version.
8. A code is never reused for a different meaning.

## 4. Canonical registry

| Code                                            |  HTTP | Surface     | Retryable | Meaning                                                      | Required action                                                |
| ----------------------------------------------- | ----: | ----------- | --------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `AUTHENTICATION_REQUIRED`                       | `401` | ALL         | false     | No valid credential was supplied.                            | Authenticate with the credential class allowed by the surface. |
| `AUTHENTICATION_INVALID`                        | `401` | ALL         | false     | Credential is invalid, expired or revoked.                   | Refresh or re-authorize; investigate revocation.               |
| `CREDENTIAL_SURFACE_NOT_ALLOWED`                | `403` | ALL         | false     | Credential class cannot call this API surface.               | Use the correct API and credential.                            |
| `SCOPE_PERMISSION_DENIED`                       | `403` | ALL         | false     | Required scope or permission is absent.                      | Request authorized access; do not retry unchanged.             |
| `RESOURCE_SCOPE_MISMATCH`                       | `403` | ALL         | false     | Tenant/Digital Store/Location/resource scope does not match. | Correct context or request valid authorization.                |
| `ENVIRONMENT_SCOPE_DENIED`                      | `403` | ALL         | false     | Credential is not valid for this environment.                | Use environment-bound credentials.                             |
| `APPROVAL_REQUIRED`                             | `403` | MGT/EDG     | false     | Action requires an approved, payload-bound authorization.    | Create and obtain the required approval.                       |
| `APPROVAL_INVALID_OR_CONSUMED`                  | `403` | MGT/EDG     | false     | Approval is expired, changed, invalid or already used.       | Request a new approval after reviewing payload.                |
| `VALIDATION_FAILED`                             | `422` | ALL         | false     | Request failed schema or business validation.                | Correct listed fields.                                         |
| `RESOURCE_NOT_FOUND`                            | `404` | ALL         | false     | Resource is absent or not visible to caller.                 | Verify safe resource reference and scope.                      |
| `RESOURCE_VERSION_CONFLICT`                     | `409` | ALL         | false     | Expected version/ETag does not match.                        | Refresh and reconcile; do not blind-retry.                     |
| `IDEMPOTENCY_KEY_REQUIRED`                      | `400` | ALL         | false     | Mutation requires an idempotency key.                        | Resubmit once with a unique stable key.                        |
| `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` | `409` | ALL         | false     | Key was used with a different semantic payload.              | Generate a new key only for a new operation.                   |
| `FILTER_NOT_SUPPORTED`                          | `400` | MGT/COM/CON | false     | Filter is not allow-listed.                                  | Use documented filters.                                        |
| `SORT_NOT_SUPPORTED`                            | `400` | MGT/COM/CON | false     | Sort field/order is not supported.                           | Use documented sort.                                           |
| `CURSOR_INVALID`                                | `400` | MGT/COM/CON | false     | Cursor is malformed, expired or unverifiable.                | Restart pagination.                                            |
| `CURSOR_CONTEXT_MISMATCH`                       | `400` | MGT/COM/CON | false     | Cursor belongs to another query or scope.                    | Restart with current query.                                    |
| `RATE_LIMITED`                                  | `429` | ALL         | true      | Rate limit was exceeded.                                     | Wait for Retry-After.                                          |
| `DEPENDENCY_UNAVAILABLE`                        | `503` | ALL         | true      | Required internal dependency is unavailable.                 | Retry with backoff or queue.                                   |
| `STALE_OPERATIONAL_DATA`                        | `409` | MGT/COM     | false     | Required Store-operational truth is too stale.               | Wait for sync or use the authorized Edge workflow.             |
| `PARTIAL_DATA_NOT_ALLOWED`                      | `409` | MGT/COM     | false     | Operation requires complete data.                            | Resolve incomplete projection.                                 |
| `MGT_BULK_OPERATION_NOT_ENABLED`                | `403` | MGT         | false     | Generic bulk operation is not authorized.                    | Use approved endpoint-specific job.                            |
| `MGT_SENSITIVE_ACTION_REAUTH_REQUIRED`          | `401` | MGT         | false     | Fresh re-authentication is required.                         | Re-authenticate and repeat under same approval workflow.       |
| `STOREFRONT_NOT_PUBLISHED`                      | `404` | COM         | false     | Digital Store is not publicly published.                     | Publish or use correct Store.                                  |
| `LOCATION_NOT_AVAILABLE`                        | `409` | COM         | false     | Location cannot accept the requested action.                 | Select an eligible Location.                                   |
| `SESSION_EXPIRED`                               | `401` | COM         | false     | Customer session expired.                                    | Create/refresh customer session.                               |
| `PHONE_CHALLENGE_RATE_LIMITED`                  | `429` | COM         | true      | Phone challenge attempts exceeded policy.                    | Wait for Retry-After.                                          |
| `CART_VERSION_CONFLICT`                         | `409` | COM         | false     | Cart changed since client read.                              | Refresh cart and reconcile.                                    |
| `CHECKOUT_REVALIDATION_FAILED`                  | `409` | COM         | false     | Price, availability, policy or fulfilment changed.           | Present updated checkout to customer.                          |
| `PAYMENT_PENDING`                               | `202` | COM/EDG/CON | true      | Payment outcome is not yet authoritative.                    | Poll/await verified provider event; do not mark paid.          |
| `PRE_INTAKE_VERSION_CONFLICT`                   | `409` | COM/EDG     | false     | Pre-intake or verification version changed.                  | Refresh exact version.                                         |
| `CUSTOMER_CONFIRMATION_STALE`                   | `409` | COM/EDG     | false     | Displayed summary no longer matches verified intake.         | Re-display current summary.                                    |
| `DEVICE_NOT_ASSIGNED`                           | `403` | EDG         | false     | Device lacks active Store/Location/profile assignment.       | Complete provisioning/assignment.                              |
| `DEVICE_CERTIFICATE_INVALID`                    | `401` | EDG         | false     | Certificate is invalid, revoked or mismatched.               | Quarantine and reprovision through HET process.                |
| `PROFILE_NOT_ALLOWED`                           | `403` | EDG         | false     | Terminal profile cannot perform route action.                | Switch to assigned authorized profile.                         |
| `CONFIG_VERSION_INCOMPATIBLE`                   | `409` | EDG         | false     | Client/config contract versions are incompatible.            | Install compatible signed release/config.                      |
| `HUB_UNREACHABLE`                               | `503` | EDG         | true      | Assigned Hub cannot be reached.                              | Use discovery/cache/fallback and diagnose LAN.                 |
| `SYNC_CURSOR_CONFLICT`                          | `409` | EDG         | false     | Sync cursor or history diverged.                             | Run reconciliation/recovery protocol.                          |
| `SYNC_EVENT_REJECTED_PERMANENT`                 | `422` | EDG         | false     | Cloud permanently rejected an edge event.                    | Create operator reconciliation; preserve local evidence.       |
| `PRINT_FAILED`                                  | `503` | EDG         | true      | Print job failed.                                            | Fix peripheral and retry same print job.                       |
| `STORAGE_POSITION_OCCUPIED`                     | `409` | EDG         | false     | Ready storage position is unavailable.                       | Select another validated position.                             |
| `PICKUP_RELEASE_BLOCKED`                        | `409` | EDG         | false     | Custody release prerequisites are incomplete.                | Resolve verification, scans, balance or issue.                 |
| `INSTALLATION_NOT_ACTIVE`                       | `403` | CON         | false     | Connector installation is paused, revoked or not approved.   | Activate through approved installation flow.                   |
| `MAPPING_VERSION_REQUIRED`                      | `400` | CON         | false     | Ingress/projection lacks mapping version.                    | Use active version.                                            |
| `MAPPING_VERSION_CONFLICT`                      | `409` | CON         | false     | Mapping changed or does not cover payload.                   | Re-map and replay safely.                                      |
| `PROVIDER_SIGNATURE_INVALID`                    | `401` | CON         | false     | Callback signature or replay check failed.                   | Reject and investigate provider configuration.                 |
| `PROVIDER_EVENT_DUPLICATE`                      | `200` | CON         | false     | Provider event was already processed.                        | Use returned original outcome.                                 |
| `WEBHOOK_DELIVERY_EXHAUSTED`                    | `409` | CON         | false     | Automatic webhook attempts exhausted.                        | Correct receiver and replay with audit.                        |
| `PROJECTION_STALE`                              | `409` | CON         | false     | Projection is outside allowed freshness.                     | Regenerate delta/full projection.                              |
| `RECONCILIATION_REQUIRED`                       | `409` | CON         | false     | External and KitLuy records differ.                          | Open/resolve reconciliation record; do not overwrite ledger.   |

## 5. Validation and field details

`details` items may contain `field`, `reason`, `expected`, `actual` only when safe, and `resource_ref`. Raw SQL, stack traces, secrets, policy internals and unrelated resource existence are prohibited.

## 6. Error compatibility tests

- Every OpenAPI error response references the shared envelope.
- Every emitted code exists in this registry.
- Status/retryability match the registry.
- Khmer/English localization keys exist.
- Security tests confirm no sensitive leakage.
- Deprecated code aliases are tested until retirement.

## Appendix A — Required values

- `[REQUIRED: registry repository path and code-generation owner]`
- `[REQUIRED: customer/localized message catalogue ownership]`
- `[REQUIRED: error telemetry retention and privacy policy]`
