# KitLuy Task Handoff

## 0. Identity

| Field              | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| Task ID            | `BRINGUP-002`                                                              |
| Task title         | Store Hub reaches ACTIVE on real hardware: certificate issuance and activation |
| Product/build      | `kitluy-device-firstboot-agent`, `kitluy-device-registry-service`, `@kitluy/device-identity`, `kitluy-store-hub-image` |
| Primary agent      | Claude (interactive session with the owner)                                |
| Status             | `HANDOFF_READY`                                                            |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                                |
| Worktree           | `repos/het-kitluy-project`                                                 |
| Base commit        | `0a30a74`                                                                  |
| Final commit       | `UNCOMMITTED`                                                              |
| Handoff date       | `2026-09-01`                                                               |
| Requested reviewer | Edge Product Owner                                                         |

## 1. Outcome

**A physical Raspberry Pi 5 completed the entire device lifecycle unassisted, from a
wiped card to `active`.** Predecessor BRINGUP-001 reached pairing and stalled at
certificate issuance; that is now closed.

The final run was a genuine cold start: fleet database emptied, device identity and
enrollment state deleted, no operator intervention after the two portal actions.

```
01:35:07  manufactured -> enrolled        (HET approval, Admin Portal)
01:36:30  enrolled -> awaiting_trust      (pairing, Partner Portal + Hub console)
01:36:36  awaiting_trust -> active        (automatic, 6 seconds later)
```

| Fact                | Value                                     |
| ------------------- | ----------------------------------------- |
| Device              | `KL-6C4917D5C6DA`, `store_hub`, **`active`** |
| Assignment          | `active`, DEMO-LAUNDRY-001 / DEMO-PP-01   |
| Certificate         | `active`                                  |
| Trusted time        | 1 row                                     |
| Operator actions    | approve, then type a pairing code. Nothing else. |

## 2. Source-of-truth checked

| Source                                             | Section/path                                | Result  |
| -------------------------------------------------- | ------------------------------------------- | ------- |
| Migration 0127 `build_canonical_device_tbs_v1`     | canonical TBS field list                    | aligned |
| `packages/device-identity/src/dev-crypto.ts`       | `tbsBytes()` field list                     | aligned |
| Migration 0204 `server_authoritative_validity`     | reservation payload shape                   | aligned |
| Migration 0205 `first_issuance_recovery`           | `abandon_generation_key_v1`                 | aligned |
| `device-trust-advance.ts`                          | activation preconditions and ordering       | **conflict — see §5** |
| BRINGUP-001 handoff                                | §10 blockers                                | superseded |

## 3. Files inspected

- `services/kitluy-device-firstboot-agent/src/bin/operational-tls.ts`
- `services/kitluy-device-firstboot-agent/src/adapters/http-operational-certificate-client.ts`
- `services/kitluy-device-registry-service/src/operational-certificate-routes.ts`
- `services/kitluy-device-registry-service/src/device-trust-advance.ts`
- `services/kitluy-device-registry-service/src/issuance-gateway.ts`
- `packages/device-identity/src/issuance-adapter.ts`, `src/dev-crypto.ts`
- `supabase/migrations/20260728190127_0127_governed_issuance_functions.sql`
- `infra/.../usr/lib/kitluy/hub-storage-provision`, `hub-database-provision`

## 4. Files changed

| Path                                                                | Change summary                                             | Why                                       | Generated? |
| ------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- | ---------- |
| `services/kitluy-device-firstboot-agent/src/bin/operational-tls.ts` | `hardwareTrustLevel` is `development_software`, not the device class | D-23 — the certificate blocker    | no         |
| `packages/device-identity/src/issuance-adapter.ts`                 | TBS divergence names the differing field                   | D-24 — the refusal was undiagnosable      | no         |
| `services/kitluy-device-registry-service/src/operational-certificate-routes.ts` | re-checks trust after successful issuance; logs refusals | D-25 activation ordering; D-26 no logging | no         |
| `services/kitluy-device-registry-service/src/main.ts`              | wires a logger into the certificate router                 | D-26                                      | no         |
| `.../rootfs-overlay/etc/systemd/system/postgresql.service`         | mask (symlink to `/dev/null`)                              | D-22 orphan Debian unit                   | no         |
| `.../rootfs-overlay/etc/kitluy/README-postgresql-masked.txt`        | on-device explanation of the mask                          | so it is not undone                       | no         |
| `infra/kitluy-store-hub-image/scripts/build-rpi-image.sh`          | `KITLUY_DEV_SUDO=1` opt-in                                 | device was undiagnosable                  | no         |
| `scripts/development/fleet-service.mjs`                            | `--no-open-enrollment`; announces either mode              | open enrollment bypassed approval         | no         |

### Allowlist verification

`PASS` — changes are confined to `services/kitluy-device-firstboot-agent`,
`services/kitluy-device-registry-service`, `packages/device-identity`,
`infra/kitluy-store-hub-image` and `scripts/development`. No migration was
authored, no app touched, no hosted target reached.

## 5. Implementation details

### D-23 — a device class was sent where a trust level belongs (the blocker)

```js
hardwareTrustLevel: readImageEnv("KITLUY_DEVICE_CLASS") ?? "development_software"
```

`KITLUY_DEVICE_CLASS` is `store_hub`. `hardware_trust_level` is a different
vocabulary entirely: `development_software | tpm_2_0 | secure_element`. The enum
rejects `store_hub`, the column went NULL — and `concat_ws` in
`build_canonical_device_tbs_v1` **silently drops NULL arguments**, so the database
produced **16** canonical fields where `tbsBytes()` produced **17** (it writes
`"-"`). The strings could never match, `ISSUE_CANONICAL_TBS_DIVERGENCE` fired on
every attempt, and nothing was ever signed.

The `??` fallback never helped: the key is always present in `image.env`, so the
wrong value always won.

`concat_ws`'s NULL-skipping is the load-bearing detail. Migration 0127's own
comment claims it "Mirrors tbsBytes() field for field" — true for non-NULL input,
and silently false otherwise. **Any nullable field in that list can reproduce this.**

### D-24 — the divergence refused to say what diverged

The refusal said only "the two layers disagree about canonical TBS bytes". The
canonical form is a newline-joined positional record, so the first mismatch
identifies the culprit exactly. It now reports position and lengths — never
content, because the string reaches an unauthenticated device:

```
field 20 of 23 (local 9 chars, database 20)
```

`store_hub` is 9 characters; `development_software` is 20. **That one line found
D-23 in seconds after hours of guessing.**

### D-25 — activation was attempted once, too early, and never again

Activation requires four facts: an accepted claim, a live assignment, trusted
time, and a certificate. `advanceDeviceTrust` runs **once, during pairing** — and
at that moment the certificate cannot exist, because the Hub only requests one
*after* it is paired. Pairing's attempt is therefore correctly `blocked`, and
nothing reconsidered it.

The result was a Hub that registered, was approved, paired, established trusted
time and obtained a valid certificate, then sat at `awaiting_trust` for ever with
every precondition satisfied. The device could not help: `operational-tls` exits
cleanly once adopted and has no reason to tell anyone.

The certificate route now re-checks trust immediately after a successful
issuance — the moment the last precondition becomes true.
`attempt_activate_device_v1` is idempotent and refuses politely, so a device that
is not ready simply stays put. **Deliberately non-fatal:** the certificate is
already durable, so a failure is logged rather than told to the Hub as a refusal.

### D-26 — the only governed route with no observability

The operational-certificate route logged nothing: not a request, not a refusal.
Compounding it, the device could not report the code either — the client reads
`payload.code`/`payload.details` while `errorEnvelope` nests both under `error`,
so every refusal reached the Pi as the generic `OPCERT_REFUSED`. **The precise
code existed on both sides of the wire and was visible on neither.**

Route logging is added. **The client-side envelope parsing is NOT fixed** — see §9.

### Schema/data/migrations

No migration authored. All data work was on the disposable local `kitluy-fresh`
stack (`:54372`); the canonical `kitluy-repo17` stack was never touched.

Two device-lifecycle behaviours confirmed on hardware:

- **Board continuity works.** One board, two SD cards, cloud registration →
  **one** device row at installation generation 2. Contrast with open enrollment,
  which mints a new identity per card and produced seven rows for one board.
- **A retired device keeps its unique `asset_tag`**, so a re-registering board
  collides with its own tombstone (23505). Renaming tombstones releases it.

### Permissions/audit/security

- `supabase_admin` (superuser, present in the local container) was used for fleet
  cleanup. `postgres` cannot: the `manufacturing_*` and credential tables are
  owned by `kitluy_fleet_governor`, the FK to `devices` is `NO ACTION`, and
  postgres cannot `SET ROLE` to the governor (**D-12**).
- Append-only and frozen-record guards were disabled only inside single
  transactions on the disposable stack, always re-enabled before COMMIT.
- `KITLUY_DEV_SUDO` is opt-in, off by default, and must never reach a signed build.

### Offline/Store Hub/device impact

`kitluy-hub-storage` fails on hardware: the board has no device-unique OTP key
programmed. **This is not a defect** — burning OTP is irreversible and the image
deliberately refuses to do it on first boot. Verified inert: `Restart=no`, one
refusal per boot, no retry loop, load average 0.00. It blocks only
`var-lib-kitluy-hub.mount` and `kitluy-hub-database`; nothing on the trust path
depends on it. NVMe (`nvme0n1`, 465.8 GB) is present and untouched.

### Observability/runbooks/docs

- Certificate route now logs refusals with the typed code and correlation id.
- TBS divergence names the field.
- `/etc/kitluy/README-postgresql-masked.txt` ships on-device.

## 6. Acceptance criteria evidence

| Criterion                                  | Evidence                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| Certificate issues from a cold start       | `certificates: 1` with no intervention                     |
| Activation happens automatically           | `awaiting_trust -> active` 6s after pairing                |
| The new hook fires                         | `post-issuance-trust-advance result=advanced state=active` |
| Full lifecycle unassisted                  | lifecycle trail in §1                                      |
| Board continuity across cards              | one device row, installation generation 2                  |
| Hub LAN serving terminals                  | **NOT MET** — D-05, agent not packaged                     |

## 7. Validation performed

- Full cold run on hardware: wiped card, emptied database, deleted device identity
- `typecheck` clean on all three changed packages
- Controlled TBS comparison: SQL builder vs `tbsBytes()` byte-identical for valid input
- NULL-field divergence reproduced deliberately (16 fields vs 17)
- Image artifacts verified **inside the built rootfs**, not from build logs

## 8. Not run / not verified

- **`pnpm verify` was NOT run.** It was already failing on four pre-existing items.
- **No new automated test covers D-23, D-25 or D-26.** All three were proven on
  hardware only. This is the largest gap in this handoff.
- Terminal (T1–T4) provisioning untouched. No terminal has ever been provisioned.
- No hosted deployment. Hosted development remains at **0197**.

## 9. Risks and known limitations

| Risk                                                                              | Severity |
| --------------------------------------------------------------------------------- | -------- |
| **D-27** `kitluy-enrollment-agent` crash-loops on hardware: binary absent from the `store-hub` profile, `Restart=always`, so it shows `activating` and never appears in `systemctl --failed`. Introduced by enabling the unit in BRINGUP-001. | HIGH |
| **D-28** Certificate client cannot parse `errorEnvelope` — reads top-level `code`/`details`, server nests under `error`. Every refusal degrades to `OPCERT_REFUSED`. | MEDIUM |
| **D-29** Hub console shows `Device ... Unknown` on the registration path: the label is read only from bootstrap state, which only the ticket path writes. | MEDIUM |
| **D-30** Hub console has no concept of activation — an `active` Hub still displays `Assigned (awaiting trust)`. An installer cannot tell it succeeded. | MEDIUM |
| **D-31** `systemd-hostnamed` fails every boot: `226/NAMESPACE` on the read-only erofs rootfs. Cosmetic, but pollutes `systemctl --failed`. | LOW |
| Any nullable field in the canonical TBS list can reproduce D-23's silent field-skip. | MEDIUM |
| Three fixes have no regression test.                                              | HIGH     |

## 10. Blockers and open decisions

- **`[REQUIRED: store_hub_otp_provisioning]`** — irreversible fuse burn, owner's
  decision. Blocks the Hub's local database only. Procedure verified present
  (`rpi-otp-private-key`), OTP currently empty, NVMe untouched.
- **D-05 Hub LAN agent not packaged** — nothing listens on 7443, so no terminal
  can reach an `ACTIVE` Hub. This is the next blocker on the road to a shop.

## 11. Rollback / recovery

All changes uncommitted and individually revertible. Backups in the session
scratchpad: `issuance-adapter.ts.bak`, `operational-certificate-routes.ts.bak`,
`fleet-service.mjs.bak`, `build-rpi-image.sh.bak`. The `kitluy-fresh` stack is
disposable; `kitluy-repo17` was never touched.

## 12. Review focus

1. The post-issuance trust advance — it changes **when** a device becomes `active`.
2. D-23's fix hardcodes `development_software`. Correct while keys are held in
   software; **must read a probed hardware fact** when TPM or secure-element
   storage lands.
3. Whether `concat_ws` in 0127 should be replaced with an explicit NULL-to-`"-"`
   mapping, so the SQL cannot silently disagree with `tbsBytes()` again.
4. D-27 — decide whether `store-hub` ships the enrollment-agent binary or stops
   enabling the unit.

## 13. Next step

1. **Fix D-27.** A unit restarting for ever against a missing binary is wrong, and
   it hides in `activating` rather than `failed`.
2. Add regression tests for D-23, D-25 and D-26.
3. Fix D-28, D-29, D-30 — the operator-facing surface still cannot report the
   truth it holds.
4. **D-05, the Hub LAN agent** — the real next milestone.

## 14. Truth statement

The lifecycle in §1 was **observed on physical hardware** and the timestamps are
copied from `device_lifecycle_events`. The final run was a genuine cold start.

**No terminal has ever connected to a Hub.** Nothing listens on the LAN port; D-05
is open. An `ACTIVE` Store Hub is not yet a serving Store Hub, and nothing here
should be read as claiming otherwise.

**Three fixes are proven on hardware and by no automated test.** `pnpm verify` was
not run. No hosted deployment was made; hosted development remains at 0197. Every
change is uncommitted on `claude/fix-firstboot-esm-and-ssh-hostkeys`, base `0a30a74`.
