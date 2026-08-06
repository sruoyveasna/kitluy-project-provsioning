# WS-11-T006-P03 — Signed Configuration and Release Authority

| Field  | Value                                 |
| ------ | ------------------------------------- |
| Date   | 2026-08-06 · Asia/Phnom_Penh          |
| Status | **P03 COMPLETE — IMPLEMENTED-IN-DEV** |
| Push   | NOT PUSHED                            |

## Delivered

**Cloud `0180_release_authority`** — schema `kitluy_releases` (the DD
schema-ownership row; DD table names `release_channels`, `release_artifacts`,
`rollout_campaigns`, `device_installations` + append-only `release_events`,
a recorded DD-beyond addition; the service spec's 15-table decomposition is
a recorded divergence the dictionary governs). NOLOGIN
`kitluy_release_governor`/`_service`/`_gateway` (NOINHERIT hinge). Doors:
draft → sign (Ed25519 base64 shape enforced; manifest columns FREEZE after
signing by trigger) → promote with the FIXED order signed→internal→pilot→
stable, no skips; Pilot/Stable demand an independent approver AND fail
closed on the 0120 BLK-005 gate (`assert_pki_configuration_approved`);
pause; revoke = an approved NEW fact leaving the signed manifest
byte-identical; assignment scoped to a live device assignment, idempotent
on its key. FORCE-RLS, doors-only, guard-proven.

**TS `@kitluy/device-identity` `release-manifest.ts`** — the closed
verifier both Hub and terminal run INDEPENDENTLY (snapshot-signing
discipline: domain tag `kitluy.release-manifest.v1`, fixed field order,
US/RS separators with pre-crypto injection guard, key matched on id AND
version, `revoked` refused, fail-closed union) plus the §5 acceptance gate
(`findReleaseAcceptanceRefusal`: product/arch/hardware/environment/channel/
schema-range/config-prerequisite/size).

**Hub `0038_release_trust_and_cache`** — `edge_config.release_trust_key`
(0027 mirror; PUBLIC keys only, private material structurally refused,
guard-probed) and `edge_config.release_cache` (signer FK so an unknown key
cannot even stage; forward-only states assigned→verified→downloading→cached;
`rejected` FINAL; resumable `bytes_downloaded` never regresses; no delete).
**Hub TS `release-cache.ts`** — verification precedes any download byte;
digest and size proven over the DOWNLOADED bytes (object-storage metadata
never trusted); durable rejections; duplicate assignments one effect;
restart answers from relational state.

**Signed configuration (§9): REUSED, not rebuilt** — the 0022 authority
(`configuration_snapshot` binds version/scope/environment/compatible hub
versions/effective-at/digest/signer/signature; `mark_snapshot_verified` →
`activate_snapshot` → `rollback_snapshot` with explicit activation
evidence) is the owner-decision §7 shape already; regression evidence:
`sync-configuration` suite green in this package's run. Snapshots remain
separate from releases (separate tables, separate doors, separate trust
registries).

## Focused test results (executed)

- Cloud canonical order: reset 0000→**0180** + seed + **`db:test` exit 0,
  241 PASS** — new SECTION 57 (11 exact refusals: unsigned promotion,
  malformed signature, skipped channel, missing/self approver, **BLK-005
  Pilot refusal with the owner sentinel**, wrong environment/Store
  assignment, revocation self-approval, revoked-not-assignable, manifest
  immutability past the governor) + WS11-N23a/b.
- Hub: reset 0000→**0038** + seed + **`hub:db:test` 42 PASS** (section 35:
  unknown-key staging FK refusal, forward-only, download-offset monotonic,
  rejected-final, no-delete).
- `release-manifest.test.ts` **5/5** (field binding incl. channel/digest/
  size/rollback tamper, fail-closed union, injection, determinism,
  acceptance gate).
- `release-cache.integration.test.ts` **3/3** (verify→resume→cache with a
  real interruption; duplicate one-effect; restart-shape; tampered/wrong-
  arch/revoked-key durable rejections; wrong-digest artifact refused at
  completion).
- Regression: sync-configuration + registration/contract suites **68/68**;
  typecheck clean; eslint/prettier clean.

## Recorded

- The authenticated cloud→Hub assignment TRANSPORT stays BLK-006 (the same
  posture as every prior consumer); `applyReleaseAssignment` is the
  transport-facing seam and is driven by its integration suite meanwhile.
- Slot activation/rollback deliberately absent — P04's.
- Rollback: revert the P03 commit; both databases replay from zero.
