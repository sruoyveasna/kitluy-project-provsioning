# WS-11-T006-P02 — Hub/NVMe Backup, Restore and Reconciliation

| Field  | Value                                                                |
| ------ | -------------------------------------------------------------------- |
| Date   | 2026-08-06 · Asia/Phnom_Penh                                         |
| Status | **P02 COMPLETE — IMPLEMENTED-IN-DEV** (development backup authority) |
| Push   | NOT PUSHED                                                           |

## Delivered

Extended the EXISTING WS-09 backup/restore tooling (`scripts/hub/hub-db.mjs`)
— no new service — with `scripts/hub/backup-manifest.mjs`:

- **Encrypted KLBK1 container** (AES-256-GCM): a truncated or bit-flipped
  backup fails AUTHENTICATION; the plaintext dump never remains on disk.
  Key custody is the fenced development key (`KITLUY_HUB_DEV_BACKUP_KEY`,
  ≥32 chars; non-local `KITLUY_ENV` refused); production custody stays
  BLK-005, recorded.
- **Manifest v1** (owner decision §4): backup id, Hub/Store/Location scope
  (from the live `hub_assignment`), schema head (migration journal),
  configuration version, release version (null until P04), created/completed,
  plain+encrypted SHA-256, sizes, encryption metadata, status, verification
  result — and the live-captured **governor-ownership map**.
- **Verification before validity**: the completed backup is decrypted and
  re-hashed before `status: verified`; restore refuses anything else.
- **Restore**: manifest shape/version fail-closed; wrong-database refused;
  recovery-intent scope check (`KITLUY_RESTORE_EXPECT_{TENANT,STORE,LOCATION,HUB}`
  → `KLUY-RESTORE-WRONG-SCOPE`); schema-lineage check
  (`KLUY-RESTORE-INCOMPATIBLE-SCHEMA` for a head outside the repository
  set); digest + decrypt + plaintext-digest verification; `pg_restore
--no-owner` followed by **deterministic governor-ownership replay** from
  the manifest (the pre-existing restore defect this package exposed: the
  old path could not replay `ALTER ... OWNER` to NOLOGIN governors at all —
  broken since group 0024 ownership landed, undetected because the
  destructive suite had not run since the 0014-era schema);
  **`restored_quarantine` entered via the 0037 door on BOTH outcomes** —
  fingerprint-verified restores await explicit
  `restore:activate <reason>`, failed verification stays quarantined with
  exit 1.
- **Reconciliation**: preserved identifiers/outbox proven by the WS-09
  round-trip suite (non-`pending` outbox rows byte-identical — restore never
  fabricates or advances a cloud outcome; command/effect keys, custody,
  audit and payment digests equal). The intentional quarantine event is the
  ONLY delta, asserted exactly (+1 `hub_replacement_events`).

## Evidence (executed)

- Full CLI drill: encrypted backup → restore (`ownership replayed 9
governor-owned object(s)`, `restore verified`) → mode
  `restored_quarantine` → `restore:activate` → `normal`.
- Failure injections: corrupted container → checksum refusal; wrong tenant
  intent → `KLUY-RESTORE-WRONG-SCOPE`; manifest-less legacy dump →
  refused (v1 manifest required).
- `hub-backup-manifest.test.ts` **4/4** (container auth, key fence, manifest
  shape fail-closed incl. secret-shaped refusal).
- Destructive WS-09 round trip (`KITLUY_HUB_DESTRUCTIVE_TESTS=1`) **2/2**.
- `hub:db:test` **41 PASS** (regression, unchanged).

## Recorded

- Async upload of completed backups is BLK-006 provider material (owner
  decision §4 "upload asynchronously" — the local pipeline never waits on
  it; no uploader is claimed).
- The 15-min/02:00 scheduler cadence is an operations-runtime concern; the
  backup command is idempotent and cron-safe, and cadence values are the
  owner's §4 development defaults, recorded in the decision.
- Rollback: revert the P02 commit; the tooling returns to the WS-09 shape.
