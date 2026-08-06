# WS-11-T006-P04 — A/B Installation, Health Check and Rollback

| Field  | Value                                                                 |
| ------ | --------------------------------------------------------------------- |
| Date   | 2026-08-06 · Asia/Phnom_Penh                                          |
| Status | **P04 COMPLETE — IMPLEMENTED-IN-DEV** (with one RECORDED adapter gap) |
| Push   | NOT PUSHED                                                            |

## Delivered

**Hub `0039_release_installation_state`** — durable per-device installation
rows with the full §12 lifecycle as a SCHEMA-ENFORCED transition matrix
(entry only at `assigned`; illegal jumps refused; `failed_rolled_back`
terminal for automatic movement), ONE live installation per device by
partial unique index, the owner §6 one-automatic-rollback rule pinned by
trigger (`rollback_attempted` set exactly once, a second `rolling_back`
refused), and a trigger-written append-only journal so NO code path can
move state without leaving evidence.

**`src/hub/release-agent.ts`** — one shared state machine for Store Hub and
T1–T4 terminals with device adapters (`SlotAdapter`) and injectable gate
timings whose LOCKED defaults are the owner values (20 s / 5 min / 3
consecutive / one rollback). §13 prechecks with exact refusal codes:
uncached-or-unverified release, revoked release (sync-fed list), restore
quarantine (0037 mode), containment (0035 directives), unverified
pre-release backup (P02 evidence), missing rollback artifact, insufficient
disk, staged-slot verification. The durable walk persists BEFORE every
externally visible action; `resumeAfterRestart` is pure durable-state
resume; promotion updates current/rollback versions separately (§16);
rollback restarts the previous slot and NEVER touches the database
(`release-agent` holds no backup/restore capability — application rollback
and P02 recovery are structurally separate). `createHubHealthProbe` is the
production-shaped OFFLINE probe (local DB, schema state, outbox, device
identity, operational readiness — no WAN). `cancelInstallation` allows
authorized cancel strictly before restart.

**Terminal distribution (§16)** — terminals run the SAME closed verifier
(`verifyReleaseManifestSignature`) over their OWN trust keys: proven that a
Hub-tampered manifest fails the terminal's verification outright (the Hub
cannot make an invalid release trustworthy), and the full terminal A/B
lifecycle runs through the shared machine with containment blocking updates
until an explicit cleared directive.

## Focused results (executed, zero skips)

`release-agent.integration.test.ts` **5/5**: Hub A/B end to end (inactive
slot only, restart, REAL offline probe, promote; outbox and booking counts
byte-stable across the cycle); health failure → automatic rollback exactly
once → `failed_rolled_back` → automatic retry REFUSED; the §13 refusal
matrix (uncached, revoked, disk, backup, quarantine, duplicate-in-progress
idempotent); terminal independent verification + containment block/clear +
terminal A/B promote; authorized cancel before restart and never after.
Hub `hub:db:test` **43 PASS** (section 36: matrix walk auto-journalled,
one-live index, entry rule, one-rollback pin, terminal-state refusals).
Typecheck/eslint/prettier clean; open-items contract 43.

## Recorded gaps (not claimed)

- **Runtime adapter gap (§11)**: no Raspberry Pi boot-slot or Electron
  updater runtime exists in the repository or on this host; the
  `SlotAdapter` implementations in evidence are production-SHAPED in-memory
  fakes. The adapter surface is the seam; the physical-device adapters are
  hardware-certification work under BLK-005's pilot gates.
- The revoked-release feed into the Hub (`revokedReleaseIds`) is the sync
  layer's to deliver (BLK-006 transport posture, same as every consumer).
- Rollback: revert the P04 commit; the Hub database replays from zero.
