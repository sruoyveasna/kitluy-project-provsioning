# 54 — Same-Pi reflash continuity: zero-touch development recovery

**Date** 2026-09-23 · **Area** edge-platform / devices · **Authority** KLD-2026-09-23-DEVICE-CONTINUITY-RULE-001 (owner-locked), building on KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001 and handoffs 39, 43, 51.

**Status per scope is in §7. Nothing here is HARDWARE VERIFIED: the continuity proof needs a second SD card flashed on the same board (Cycle B), which only the owner can do. Cycle A's baseline is recorded and is on the hardware now.**

## 1. The rule

A KitLuy device represents the **physical Raspberry Pi**, not its SD card.

```
Physical Raspberry Pi
  └── permanent device_record_id (a UUID, minted once)
        ├── installation 1 → enrollment 1 → key 1 → certificate 1
        └── installation 2 → enrollment 2 → key 2 → certificate 2   ← a reflash
```

Same board + new card = **recovery of the same device**. A different board = a **replacement device**, and must never inherit the identity. Old private keys are never copied forward; identity lives in the cloud record, not in key material. Hardware serials are how a board is **recognised**, never what it **is**.

## 2. What already existed — audited, not rewritten

The mission's first instruction was to inspect before changing. Most of the model was already built, and is preserved intact:

| Capability | Where | Verdict |
| --- | --- | --- |
| Same board recognised | `resolve_device_by_board_evidence_v1` (0197) — matches on `board_serial` of the device's **current** enrollment; `soc_serial` only corroborates; `mac_address` alone returns `KLUY-BOARD-EVIDENCE-MAC-ONLY` and resolves nothing | Preserved |
| `device_record_id` preserved | `register_device_v1` PATHS B/C — the lifecycle state is READ, never written; a new row is created only when no `board_serial` matched | Preserved |
| New installation / enrollment per reflash | `device_installations.generation` (keyed by a per-install fingerprint), `manufacturing_enrollments.enrollment_sequence` chained by `supersedes_enrollment_id` | Preserved |
| New key and certificate generation | `device_credential_heads`, `device_generation_keys`, reflash recovery 0224/0225/0226 | Preserved |
| Clone fails closed | credential-reuse detection (0197 PATH D) with an anti-poisoning guard so a clone cannot lock the real board out; evidence collision (0121); activation bound to the current enrollment (0225); boot classification `REPLACE_HARDWARE` / `WRONG_MEDIA` | Preserved |
| Storage key survives a reflash | `HMAC-SHA256("kitluy.hub-data-volume.development-unbound.v1", board serial)` — derived, not stored, so a new card on the same board reproduces it | Preserved |

**Coverage already in place:** `device-registration-continuity.db.test.ts` asserts one `device_record_id` across a reflash with a new key and a new hostname; `reflash-credential-recovery.adversarial.test.ts` carries 19 adversarial cases including "the replaced card is not the device" and "a stranger who knows the device id".

## 3. What was actually missing, and is now fixed

### 3.1 The Hub could be reflashed into a locked-out state (Scope D — fixed `7bae332`)

The hub-self projection ended stale assignments only where `hub_device_id = <this board>`. A reflashed Hub has a NEW identity, so the PREVIOUS board's assignment stayed **active** beside it — two live Hub identities in one database. The Hub then answered its own terminal `403 PAIRING_REQUIRED`, and the pairing session it opened bound to the old identity at the old generation. Nothing self-healed it. A Hub database serves exactly one board, so every active assignment that is not this board's is now ended.

### 3.2 Storage recovery needed a hand-made file (Scope C — fixed `c84be16`)

`DEVELOPMENT-UNBOUND` storage required an operator marker on the SD card's persistent partition — which a reflash wipes. Every fresh Hub card therefore stopped with the volume locked, and with it the database, the agent and the LAN API. A **development image** may now carry the authorization. The environment gate is enforced three times: the builder refuses the flag outside a development build, the layer re-checks against the `image.env` it wrote, and the provisioner refuses the posture outside development whatever any file says. OTP still wins on a fused board.

### 3.3 The Hub could destroy a Store to make recovery look successful (Scope C — fixed `6c9298b`)

Two automatic paths, found by audit:

- **`mkfs.ext4` on an already-unlocked volume** whenever `blkid` could not identify a filesystem. The database is plaintext behind the mapper at that point, so a corrupted superblock after a bad power cut meant the next boot silently re-made the till and came up healthy. Now: if the volume still **mounts**, it is a repair job — `STORAGE_FILESYSTEM_UNREADABLE`, nothing changed. The long-declared, never-read `PROVISIONED_MARKER` is now written after a real format so a later boot can tell *blank* from *broken*.
- **A volume this board cannot open** ended the unit with cryptsetup's own words — the same sentence a correctly-keyed volume produced when the key was passed wrongly. Now `STORAGE_KEY_MISMATCH`, or `STORAGE_LEGACY_KEY_MISSING` when the retired random key file from a previous card is gone and the volume was made with it. Both state that nothing was changed and point at the deliberate operator command.

### 3.4 Every development reflash needed `dev:device:unassign` (Scope E — new, migration 0234)

A re-flashed board returns holding a live assignment. `evaluate_hub_pairing_session_v1` admits `enrolled` only — and spends one of five attempts on each refusal, so a Hub typing its code before release burns the code. `release_reflashed_device_for_repair_v1` automates that one operator step and nothing else. It refuses outside development (checked before anything is read), without reflash evidence (the current enrollment must supersede an earlier one — a board that never had its card replaced is never taken out of service), for a contained device, for an open trust incident, and when nothing live is held.

**It never re-assigns.** The Partner pairing code stays as the trust transition. Recognition is a **self-reported** board serial, so automatic re-assignment would let a device that merely claims a serial take a seat; releasing rather than transferring keeps the residual at denial-of-service in development, never a takeover — pairing still needs a code (0194/0220), recovery still binds the current enrollment's identity key (0224), activation still binds the certificate to it (0225).

## 4. Recovery states — reused, not reinvented (Scope H)

The vocabulary already existed and is used rather than duplicated: `BootClassification` = `READY | RECOVERING_DEVICE | NEW_DEVICE | WRONG_MEDIA | REPLACE_HARDWARE | SECURITY_LOCK | WAITING`, with reason codes including `KLUY-BOOT-RECOVERY-FRESH-MEDIA`, `KLUY-BOOT-RECOVERY-IN-PROGRESS`, `KLUY-BOOT-RECOVERY-NEEDS-PAIRING`; `StoragePosture` = `absent | opened | foreign | unidentified | not_opened | opened_foreign_contents`; `RegistrationPhase` = `NOT_REGISTERED | REGISTERING | AWAITING_APPROVAL | TRUST_REVIEW_REQUIRED | APPROVED | CONTAINED | UNREACHABLE`.

Added this cycle (`c95bfe1`): runtime report **v3** carries `hubLink.endpoint` and `hubLink.detail`, so a terminal that cannot reach its Hub says **which address it tried and how the attempt failed** instead of leaving the Partner ladder on a silent "Next". The new storage refusals above are worded as machine-greppable states (`STORAGE_KEY_MISMATCH`, `STORAGE_LEGACY_KEY_MISSING`, `STORAGE_FILESYSTEM_UNREADABLE`).

## 5. Legacy development volumes — the limitation, stated

The retired `development-unbound-storage.key` random file is still honoured when it is **present** (read-only; nothing creates it any more). When it is **absent** and the volume was created with it, the key is genuinely gone: the board serial derives only the current key, and no derivation can reproduce a destroyed random secret. That case is now **reported** (`STORAGE_LEGACY_KEY_MISSING`) and never repaired by wiping. Recovering such a volume is an explicit operator decision (`--reset-data-volume`, which refuses while this board can still open the volume).

## 6. Hardware: Cycle A baseline recorded, Cycle B not run

**Cycle A (2026-09-23, after the deliberate fleet purge of handoff 51) — the new canonical development baseline:**

| | Store Hub | Terminal |
| --- | --- | --- |
| asset tag | `KL-9830994458E0` | `KL-C33197FAE9EA` |
| `device_record_id` | `4cfc40b4-da47-4578-8219-42d54468f028` | `d5ad30c5-778c-428b-a64d-bf1f323e5ce1` |
| installation | `20064f77-8659-47d4-9339-85aea71ac110` | `cfc65f57-cda5-4ef1-9846-ab75f99707ec` |
| board serial | `334a2a7bcc3dba2a` | `53b91c797e480ed6` |
| enrollments / manifests / certs / assignments | 1 / 1 / 1 / 1 | 1 / 1 / 1 / 1 |
| storage posture | `DEVELOPMENT-UNBOUND`, NVMe 465.8 G | — |

A continuity probe was written **inside the encrypted volume** so Cycle B can prove the data survived: `edge_ops.reflash_continuity_probe`, cycle `A`, recorded 13:33 local. The Hub database also holds 44 migrations, 1 active hub assignment and 1 terminal.

**Cycle B — NOT RUN.** It needs a second SD card flashed on the same Hub. Expected, with no purge and no NVMe wipe: same `device_record_id`; new installation, enrollment, key and certificate generation; the LUKS volume unlocks automatically; the probe row still present; exactly one active hub assignment; the agent serving on `:7443`. The one operator action that remains is the **Partner pairing code** — the release that used to precede it is now automatic in development.

## 7. Verification classification — exact

| Scope | IMPLEMENTED | TESTED | INTEGRATED | IMAGE VERIFIED | HARDWARE VERIFIED | END-TO-END VERIFIED |
| --- | --- | --- | --- | --- | --- | --- |
| A — permanent device continuity (pre-existing) | yes (0197) | yes (`device-registration-continuity.db.test.ts`, 25 passed) | yes | n/a | **not this cycle** (proven in earlier sessions: one board carried 5 enrollments on 1 device row before the purge) | no |
| B — credential recovery (pre-existing) | yes (0224/0225/0226) | yes (formal security suite 19/19 with the dev PKI) | yes | n/a | no | no |
| C — Hub NVMe automatic development recovery | yes (`c84be16`, `6c9298b`) | yes (storage-posture 46/0) | yes | **yes** for `c84be16` (Hub image `8fc5b32d…`, overlay 138/138) — **NOT** for `6c9298b`, which is newer than that image | no | no |
| D — Hub identity reconciliation | yes (`7bae332`) | yes (terminal-sync integration 11/11 against the live Hub DB) | yes | no | no | no |
| E — assignment continuity (0234) | yes | yes (5 tests + live refusals on the development stack) | **cloud only** — the registry service does not yet CALL the door; it is exercised by SQL | no | no | no |
| F — reflash vs factory reset | documented | n/a | n/a | n/a | n/a | n/a |
| G — Hub boot order | unchanged by design | n/a | n/a | n/a | no | no |
| H — truthful recovery states | yes (`c95bfe1` + the new storage states) | yes (portal 74, management API 189, agent report+drift 22) | yes | no | no | no |

**NOT VERIFIED anywhere in this cycle:** any claim that a reflashed board comes back operational without an operator. That is Cycle B.

## 7b. FINALIZATION (2026-09-23, mission SAME-PI-REFLASH-CONTINUITY-FINALIZATION-001)

The three gaps §7/§8 left open before Cycle B are closed.

### GAP 1 — 0234 is now called by the real flow (`0235`, `00b3dd2`)

`release_reflashed_device_for_repair_auto_v1` is called by the
**device-registration edge function**, on the one boot that opens a new
installation.

The environment is **not** a parameter and **not** a deployment variable. That
route is unauthenticated — a board reaches it before it holds any credential —
so an environment flag there would put a production fleet one mis-set variable
away from releasing Store assignments automatically. The door resolves the
environment from the device's own governed records (its assignment projection,
else its credential head) and **fails closed** when it cannot prove
`development`.

Four gates before the door is even called: a new installation was created (so
not the 60-second poll a waiting board makes, and not a normal boot), the status
is KNOWN_DEVICE (so not a first installation, and not a different board, which
answer PENDING_APPROVAL / TRUST_REVIEW_REQUIRED), no credential reuse was
detected, and a failed release never fails a registration. 0234's own gates
still stand.

**Proven through the real route**, not by SQL: a test signs the real
`kitluy.device-registration-request.v1` bytes with a real Ed25519 key per
install and POSTs to the live edge function — first boot, then a reflash of the
same board — then reads back that the board kept its `device_record_id`, opened
a new installation, and came back `enrolled` at generation 0 with no live
assignment. Two more prove the gates. **3 passed.** The suite is OPT-IN
(`KITLUY_ROUTE_TESTS=1`) because the only stack serving that route is the one
the hardware registers against, and assignment history there is append-only, so
a run cannot fully tidy up after itself.

### GAP 2 — a recovery grants the previous credential no overlap (`0236`, `5d32b86`)

**Invalidated, not revoked — and the distinction is the point.** Owner decision
§2.5 is a CHECK constraint, not a convention:

```
credential_revocation_policy_no_machine_chk check (machine_initiated_revocation_permitted = false)
"a worker may detect, record and escalate; it may not decide to revoke"
```

Every revocation reason also requires four eyes, and none of the nine approved
reasons names a re-flash. A machine revoking here would take a decision the owner
reserved for people. So the existing lifecycle does the work: on a **recovery**
the head grants no overlap, and `certificate-validity` accepts a previous
generation *only* while the head grants one. The certificate on the replaced card
stops verifying the instant the new one is finalized; its audit row is untouched;
its artifact was already `superseded` by 0224's trigger; and the four-eyes
revocation door remains available to a person.

A BEFORE-UPDATE trigger on `device_credential_heads`, not a re-created
`finalize_device_credential_issuance_v1` (~300 lines of governed issuance).
Editing `NEW` in place needs no second UPDATE, so it cannot disturb the rule that
every head write moves the version by exactly one; the trigger is named to sort
**after** `trg_device_heads_overlap`, so that trigger still validates what
finalize proposed before this one withdraws it. Recovery is identified by the
recovery **evidence** row that `classify_operational_certificate_request_v1`
already treats as the marker — never by `renewal_mode`, which is only a
policy-dependent proxy.

Ordinary renewal is untouched: **94 passed** across credential-lifecycle,
certificate-renewal and certificate-validity, every overlap-boundary case
included. Adversarial recovery suite **19/19**, with a new verifier-level proof:
after recovery `credential_verification_state_v1` offers no previous generation,
no overlap end and no previous key — and reports `revoked = false`, because this
is invalidation. Full registry-service suite: **zero** failures that are not
already failing without the change (10 vs 13 at baseline).

### GAP 3 — the final Cycle-B image

Built from `c42b7d5` in `worktrees/kitluy-ecosystem/wt-pin-image`, detached and
clean, with the runtime rebuilt and repackaged first so the overlay reproduces
the commit byte-for-byte before the build started. Identity and read-back below.

### The final Cycle-B image — IMAGE VERIFIED

| | |
| --- | --- |
| Source commit | **`c42b7d5`** (worktree `wt-pin-image`, detached and clean; overlay repackaged and `git status` clean BEFORE the build started) |
| Path | `worktrees/kitluy-ecosystem/wt-pin-image/infra/edge/raspberry-pi/store-hub-image/build/work/deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst` |
| Compressed bytes | **660 476 191** (630 MiB) |
| sha256 (compressed) | **`7f887229c1e3dda8a46f6751257b6cc4ff152fad68300816761115fd2d6ac17c`** |
| sha256 (raw `.img`, 17 490 268 160 B) | `d98f0373392ebc9f9488031083807cebd575bd245fe1591566d2a3ade4d77aaa` |
| sha256 (`.img.sparse.zst`) | `74c7a98c7588c8f7b84eb2d220ea953676a76c8f566824a9e3d3c3f0841c05c5` |
| Manifest | `build/work/kitluy-store-hub-dev-manifest.json`, builderCommit `a7b6d480…` (rpi-image-gen v2.7.0); all five artifact digests equal |
| Overlay read-back | **140 entries, 126 files + 14 links, 0 DIFFERS** against `c42b7d5` |
| Secret scan (image) | 17 passed, 0 failed |

Read out of the finished erofs with the builder's own `dump.erofs`:

| Fix | Evidence in the image |
| --- | --- |
| `c84be16` automatic development storage | `hub.env`: `KITLUY_HUB_STORAGE_DEVELOPMENT_UNBOUND=authorized` |
| `6c9298b` non-destructive storage recovery | `hub-storage-provision` carries `STORAGE_KEY_MISMATCH`, `STORAGE_LEGACY_KEY_MISSING`, `STORAGE_FILESYSTEM_UNREADABLE` |
| `7bae332` previous-Hub reconciliation | the shipped agent bundle contains `where status = 'active' and id <> $1::uuid`, and is **byte-identical** to the bundle built from this commit |
| terminal-sync runtime | `HUB_SYNC_URL=http://172.16.21.17:8792`, trust anchor `3c4a5cea…` (`transport_signing`, development) |
| release/update trust | `release.env` → `:8791`; `/etc/kitluy/trust/release-signing.json` → `bfccb44e…`, `release_signing`, development |

Suites against this build: rpi-image-gen 22/0/1, build-gates 34/0, environment-gating 19/0, systemd-runtime 183/0, storage-posture 46/0, image-contents 62/0/0.

### Cycle B — the owner's instruction

1. Flash **a different, fresh SD card** with the image above (verify the sha256 first).
2. Put it in the **same physical Store Hub**, with the **same NVMe** still fitted.
3. **Do not** purge cloud state, wipe the NVMe, reset the data volume, or delete the probe row.
4. Power on.
5. **The one manual step:** when the Partner Portal shows the Hub waiting to pair, enter **one pairing code**. Nothing else — no `dev:device:unassign`, no SQL, no storage authorization, no SSH repair.

Expected: same `device_record_id` `4cfc40b4-da47-4578-8219-42d54468f028`; a new installation, enrollment, key and certificate generation; the previous credential no longer able to authenticate (no overlap granted); the LUKS volume unlocked automatically; `edge_ops.reflash_continuity_probe` cycle `A` still present; exactly one active hub assignment after pairing; the agent serving on `:7443`; terminals reconnecting.

## 8. Open, and deliberately not done

- **Cycle B hardware proof** — the acceptance test. Needs the owner.
- **Scope E is not wired into the device flow.** `release_reflashed_device_for_repair_v1` exists and is proven by SQL; the registry service does not call it on registration yet. Until it does, the operator still runs `dev:device:unassign` — the door simply makes the automation safe to add.
- **The incumbent credential is not revoked on recovery** (handoff 39 §9, still open). A lost old SD card keeps a valid certificate until the 3-day overlap or expiry, so mission requirement B-6 is **not met**. Closing it means revoking the incumbent artifact when a *recovery* (not a renewal) finalises.
- **The operational-certificate route carries no hardware signals**, so a clone is caught at registration and boot classification, never at the certificate route.
- **The Hub pairing door was never widened** the way the Terminal's was in 0220; a reflashed `active` Hub still burns pairing attempts if a code is typed before release.
- **Production storage recovery** is untouched by design: no OTP fuses were programmed, and the board serial is not a production secret.
