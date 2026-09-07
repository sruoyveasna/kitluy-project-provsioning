# KitLuy Task Handoff

## 0. Identity

| Field              | Value                                                            |
| ------------------ | ---------------------------------------------------------------- |
| Task ID            | `BRINGUP-001`                                                     |
| Task title         | Store Hub hardware bring-up: first registration, approval and pairing on a real Raspberry Pi 5 |
| Product/build      | `kitluy-store-hub-image`, `kitluy-device-firstboot-agent`, `kitluy-device-registry-service` |
| Primary agent      | Claude (interactive session with the owner)                       |
| Status             | `PARTIAL`                                                         |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                       |
| Worktree           | `repos/het-kitluy-project`                                        |
| Base commit        | `0a30a74`                                                         |
| Final commit       | `UNCOMMITTED`                                                     |
| Handoff date       | `2026-08-31`                                                      |
| Requested reviewer | Edge Product Owner                                                |

## 1. Outcome

**A physical Raspberry Pi 5 completed registration, HET approval, enrolment and Store
pairing for the first time**, driven entirely through the Admin and Partner PWA
portals. It reached `awaiting_trust` with a live Store assignment and established
trusted time.

The chain stops at **operational certificate issuance**, which strands at
`prepared -> signing`. That step has never completed on hardware.

Observable state at handoff (local `kitluy-fresh` stack, `127.0.0.1:54372`):

| Fact                        | Value                                             |
| --------------------------- | ------------------------------------------------- |
| Device                      | `KL-95D3D1F92BD7`, `store_hub`, `awaiting_trust`  |
| Board serial (reported)     | `334a2a7bcc3dba2a`                                |
| Installation generation     | **2** — board continuity across two SD cards worked |
| Assignment                  | `pending_trust`, DEMO-LAUNDRY-001 / DEMO-PP-01     |
| Trusted time                | 1 row                                             |
| Credentials / certificates  | **0 / 0**                                         |

## 2. Source-of-truth checked

| Source                                            | Version/commit | Section/path                             | Result   |
| ------------------------------------------------- | -------------- | ---------------------------------------- | -------- |
| `KITLUY_STOREHUB_DEV_HANDOFF.md`                  | 2026-08-28     | §6 image state, §13 status, §16 blockers | aligned  |
| `kitluy-implementation-status-and-evidence-register-v1.0.0.md` | v1.0.0 | WS-11 rows                               | aligned  |
| Migration 0194 `store_hub_pairing_sessions`       | applied        | eligibility check, line 274              | aligned  |
| Migration 0197 `device_self_registration_and_approval` | applied   | `resolve_device_by_board_evidence_v1`    | aligned  |
| Migration 0205 `first_issuance_recovery`          | applied        | `abandon_generation_key_v1`              | aligned  |
| `KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001`          | owner decision | §5.3 announcement requirement            | aligned  |

## 3. Files inspected

- `services/kitluy-device-firstboot-agent/src/bin/operational-tls.ts`
- `services/kitluy-device-firstboot-agent/src/bin/hub-pairing-ui.ts`
- `services/kitluy-device-firstboot-agent/src/bin/cloud-registration.ts`
- `services/kitluy-device-registry-service/src/device-trust-advance.ts`
- `services/kitluy-device-registry-service/src/hub-pairing-composition.ts`
- `supabase/functions/device-registration/index.ts`
- `supabase/migrations/20260813150000_0194_store_hub_pairing_sessions.sql`
- `supabase/migrations/20260817090000_0197_device_self_registration_and_approval.sql`
- `supabase/migrations/20260826110000_0205_first_issuance_recovery.sql`
- `infra/kitluy-store-hub-image/scripts/build-rpi-image.sh`
- `infra/kitluy-store-hub-image/rpi-image-gen/layer/kitluy-hub-base.yaml`
- `build/upstream/.../system-generators/slot-shared-generator`

## 4. Files changed

| Path                                                                 | Change summary                                                        | Why                                             | Generated? |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- | ---------- |
| `services/kitluy-device-firstboot-agent/src/bin/operational-tls.ts`  | read `KITLUY_ENROLLMENT_BASE_URL`; export `readOperationalBaseUrl`     | D-19: certificate endpoint read the wrong key   | no         |
| `services/kitluy-device-firstboot-agent/test/operational-certificate-endpoint.test.ts` | NEW — 5 tests over the image.env -> client composition | nothing exercised that boundary                 | no         |
| `.../rootfs-overlay/etc/systemd/system/multi-user.target.wants/kitluy-enrollment-agent.service` | NEW enable symlink                     | D-20: unit shipped but never enabled            | no         |
| `.../rootfs-overlay/etc/systemd/system/kitluy-ssh-hostkeys.service`  | `Requires=`/`After=etc-ssh.mount`                                     | D-21: `etc-ssh.mount` generated but never wanted | no         |
| `.../rootfs-overlay/etc/systemd/system/postgresql.service`           | NEW symlink to `/dev/null` (mask)                                     | D-22: orphan Debian unit fails every boot       | no         |
| `.../rootfs-overlay/etc/kitluy/README-postgresql-masked.txt`         | NEW — explains the mask on-device                                     | so the next operator does not undo it           | no         |
| `infra/kitluy-store-hub-image/scripts/build-rpi-image.sh`            | `KITLUY_DEV_SUDO=1` opt-in for diagnostic sudo                        | device was undiagnosable without it             | no         |
| `scripts/development/fleet-service.mjs`                              | `--no-open-enrollment`; banner announces either mode                  | open enrollment bypassed the approval path      | no         |

### Allowlist verification

`PASS` — all changes sit inside `services/kitluy-device-firstboot-agent`,
`infra/kitluy-store-hub-image` and `scripts/development`. No migration, no app,
no vertical, no hosted target was touched.

## 5. Implementation details

### Functional behavior

Nine defects were found and fixed. Each one only became visible after the
previous was cleared, which is why the sequence matters.

**D-19 — the certificate endpoint read the wrong configuration key.**
`bin/operational-tls.ts` read `KITLUY_REGISTRATION_URL` and appended
`/v1/operational-certificate`. That key names the cloud registration route on a
*different* service; the image layer says so in terms — the fleet service "does
not serve this route". The correct key is `KITLUY_ENROLLMENT_BASE_URL`, which
`bin/hub-pairing-ui.ts` already uses to reach `/v1/hub-pairing` on the same
service. Nothing caught it because the file exported nothing and took no
`etcRoot`, so the `image.env` -> client composition never executed off-device;
the existing tests all inject a `baseUrl` directly, which is the value in
question.

**D-20 — `kitluy-enrollment-agent.service` was never enabled.** The unit, its
`[Install] WantedBy=multi-user.target`, and its binary were all present and
correct. The overlay simply shipped no enable-symlink, so systemd never started
it. The device made zero network calls. An audit of all eleven units found this
was the only one affected.

**D-21 — `etc-ssh.mount` is generated but never enabled.** Upstream
`slot-shared-generator` writes a `.mount` unit per shared path, then creates the
`local-fs.target.wants` symlink **once, after both loops**, using the leftover
`unit_name`. With `60-kitluy-ssh.conf` and `61-kitluy-wifi.conf` declared, wifi is
last, so `etc-ssh.mount` is written and never started. `/etc/ssh` therefore stayed
on the read-only erofs rootfs, `ssh-keygen -A` failed with EROFS, `sshd -t` failed
for want of host keys, and the device was unreachable over SSH permanently.

Fixed **without patching the pinned upstream checkout**: the generated unit is
valid and merely needs a consumer, so `kitluy-ssh-hostkeys.service` — which we own
and which is already `Before=ssh.service` — now `Requires=`/`After=` it. Verified
on hardware: `/dev/mmcblk0p6 on /etc/ssh` and an SSH session established.

**D-22 — orphan `postgresql.service`.** Debian leaves its unit enabled and ships
`/etc/postgresql/15/main`, but the image deliberately never initialises
`/var/lib/postgresql/15/main`, because `hub-database-provision` refuses to create
a cluster anywhere but inside the LUKS2 volume ("would put the Store's data in the
clear"). The unit failed every boot, permanently polluting `systemctl --failed`.
Masked. KitLuy drives its own cluster with `pg_ctl` and never touches the Debian
unit, so behaviour is unchanged.

### Schema/data/migrations

No migration was authored. Data changes were confined to the disposable local
`kitluy-fresh` stack.

**A `kitluy-fresh` stack was created** (project `kitluy-fresh`, db `:54372`,
PostgreSQL 17) as a disposable replay target, leaving the canonical
`kitluy-repo17` stack (`:54392`, 9,301 devices) untouched. It carries migrations
0000-0212 **except 0189**, plus both seeds, both trust anchors and the dev:fleet
fixtures. Ledger: 110 rows, head `20260828090000` (0212) — the first KitLuy
database whose ledger honestly matches its schema.

**Three constraints on a clean-from-zero replay were discovered and are not
documented anywhere else:**

1. **Migration 0189 cannot be applied on this PostgreSQL image.** This is the root
   cause of **D-01**, open since 2026-08-26 with the cause unknown. A single
   statement crashes the server:

   ```sql
   grant kitluy_fleet_governor to current_user;   -- server terminated abnormally
   ```

   It is a supautils bug in the **role-grant** path, distinct from the
   permission-hint crash of D-08/D-15 — the `hint_roles` workaround was applied
   and 0189 still crashed. Without the grant, `alter function ... owner to` is
   refused with *"must be able to SET ROLE"*, because the membership carries no
   SET option (**D-12**). Both directions are closed until the image is upgraded.
   `record_factory_qa_v1` is owned by `postgres` on **both** stacks — 0189 has
   never applied anywhere.

2. **The migration set is not self-contained.** Migration 0193 asserts
   `DIGITAL_STORE_STAFF` holds `fleet.hub_pairing_code.issue`, and creates that
   grant by selecting the role template — which only exists after
   `seed/reference-data.sql`. The real order is **0000-0192, then seeds, then
   0193-0212**. Nothing in the repository states this, and `db:reset` does not
   honour it.

3. **Seeds refuse without a runner-supplied context.** `set kitluy.environment =
   'local'` must be prepended by the caller; the seed will not assert its own
   context (review RV-301).

**Two device-lifecycle behaviours worth recording:**

- **A retired device keeps its globally-unique `asset_tag`.** A Pi derives the same
  tag from its hardware every boot, so registration collides with its own tombstone
  — `23505` on `devices_asset_tag_key`. The edge function cannot return a database
  error to an unauthenticated caller, so the device only ever sees
  `KLUY-REG-UPSTREAM` and retries forever. Renaming tombstones releases the tag.
- **Retired device rows cannot be deleted as `postgres`.**
  `manufacturing_enrollment_tickets` references them, is owned by
  `kitluy_fleet_governor`, and postgres holds no DELETE and cannot SET ROLE
  (D-12 again). `supabase_admin` — a superuser present in the local container —
  can, and was used to purge the fleet cleanly.

### APIs/events/jobs/webhooks

No contract changed. `dev:fleet` gained `--no-open-enrollment`.

### Permissions/audit/security

- **Diagnostic sudo is opt-in and off by default** (`KITLUY_DEV_SUDO=1`). The build
  warns loudly. It must never be set for a pilot or production artifact. The
  hardened default purges sudo, which is correct for a shop device — but it also
  made the Hub undiagnosable: `/var/lib/kitluy` is root-only `0750`, so agent state
  could not be read at all and `journalctl` returned nothing. Most of this session
  was spent inferring device state from server logs, and two conclusions drawn that
  way were wrong.
- Append-only guards and the frozen-retired-record guard were disabled **only**
  inside single transactions on the disposable stack, always re-enabled before
  COMMIT, with FK triggers left active throughout.
- Open enrollment is now announced in both directions, per
  `KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001` §5.3.

### Offline/Store Hub/device impact

`kitluy-hub-storage.service` fails on real hardware:

```
found NVMe at /dev/nvme0n1
REFUSED: this board has no device-unique OTP key programmed.
  programming OTP is IRREVERSIBLE (fuses never return from 1 to 0)
```

This cascades to `var-lib-kitluy-hub.mount` and `kitluy-hub-database.service`, so
the Hub has **no local database**. This is **not a defect** — it is an owner
decision that first boot deliberately refuses to make. Pairing and activation do
not depend on it.

### UI/localization/accessibility

**The Hub pairing console reports governed refusals as network errors.**
`interpret()` handles `ALREADY_ASSIGNED`, `REDEMPTION_REFUSED`, 429 and 503, and
sends everything else to *"Pairing could not be completed. Check the network and
try again."* A `KLUY-HUBSESSION-DEVICE-INELIGIBLE` refusal — a precise, actionable
server answer — is displayed as a cabling problem. This cost roughly two hours of
misdirected diagnosis and should be fixed.

### Observability/runbooks/docs

- The operational-certificate route logs **nothing** — no request, no refusal. It
  is the only governed route with no observability, and it is currently the
  blocking step.
- `/etc/kitluy/README-postgresql-masked.txt` ships on-device.

## 6. Acceptance criteria evidence

| Criterion                                   | Evidence                                                          |
| ------------------------------------------- | ------------------------------------------------------------------ |
| Device registers through the cloud path     | `KL-95D3D1F92BD7`, `manufactured`, 07:21:15                        |
| Board continuity across two SD cards        | **installation generation 2**, one device row                      |
| HET approval through the Admin Portal       | owner approved; device -> `enrolled`                               |
| Pairing through the Partner Portal          | session `consumed`; device -> `awaiting_trust`                     |
| Store assignment                            | `pending_trust`, DEMO-LAUNDRY-001 / DEMO-PP-01                     |
| Trusted time                                | 1 row in `device_trusted_time`                                     |
| SSH reachable                               | session established; `/dev/mmcblk0p6 on /etc/ssh`                  |
| Certificate issued                          | **NOT MET** — stranded at `prepared -> signing`                    |

## 7. Validation performed

- `operational-certificate-endpoint.test.ts` — 5 passed
- **Mutation test**: reinstating `KITLUY_REGISTRATION_URL` fails 3 of 5, naming the wrong host
- `kitluy-device-firstboot-agent` full suite — **414 passed, 0 failed**, 9 skipped
- `typecheck` clean; `secret:scan` PASS (1,882 files)
- Image artifacts verified **inside the built rootfs**, not from build logs
- Hardware: registration, approval, enrolment, pairing, trusted time, SSH

## 8. Not run / not verified

- **`pnpm verify` was NOT run.** It was already failing on four pre-existing items
  before this session.
- The two pre-existing warnings on `operational-tls.ts` (one prettier import block,
  one unused eslint-disable) were confirmed present **before** this change and left
  alone, per D-11 precedent.
- No hosted deployment. Hosted development remains at **0197**.
- Terminal (T1-T4) provisioning untouched.

## 9. Risks and known limitations

| Risk                                                                        | Severity |
| --------------------------------------------------------------------------- | -------- |
| Certificate issuance strands at `signing` with no logging — cause unknown    | HIGH     |
| `resolvePairableDeviceId` prefers bootstrap state unconditionally, no freshness check | MEDIUM |
| Pairing console reports governed refusals as network errors                 | MEDIUM   |
| `kitluy-fresh` omits 0189, so it is not a faithful replay of any other stack | MEDIUM   |
| Diagnostic sudo must never reach a pilot or production build                 | MEDIUM   |

## 10. Blockers and open decisions

- **Certificate issuance strands at `signing`.** First cause was a missing
  `KITLUY_DEV_PKI_DIR` on the registry service (no CA to sign with) — fixed and
  verified. It still strands with the CA present, so a second cause remains
  unidentified. `abandon_generation_key_v1` returned `ABANDONED` and stranded rows
  were purged; the next attempt reproduced the same state.
- **`[REQUIRED: store_hub_otp_provisioning]`** — programming the board's OTP key is
  irreversible and is the owner's decision. Until then there is no Hub database.
- **D-01 is now root-caused but not fixable here** — needs a supautils/PostgreSQL
  image upgrade, same upstream fix as D-15.

## 11. Rollback / recovery

Every change is uncommitted and individually revertible. Backups in the session
scratchpad: `fleet-service.mjs.bak`, `build-rpi-image.sh.bak`, both portal
`.env.local` files. The `kitluy-fresh` stack is disposable — `supabase stop` in its
project directory removes it and leaves `kitluy-repo17` untouched.

## 12. Review focus

1. `operational-tls.ts` endpoint key and its new test — the fix sits on the
   credential path, which has had four independent security reviews.
2. Whether `resolvePairableDeviceId` should prefer an APPROVED registration over
   stale bootstrap state. This decides **which identity is permitted to pair** and
   has a test written specifically about it; it was deliberately NOT changed.
3. `KITLUY_DEV_SUDO` — confirm it can never reach a signed artifact.
4. Whether the upstream `slot-shared-generator` loop bug should be reported
   upstream as well as worked around.

## 13. Next step

1. **Add logging to the operational-certificate route**, then reproduce the
   `signing` strand. It is the only governed route with no observability and it is
   the blocking step.
2. Fix the pairing console's refusal mapping so governed codes are shown verbatim.
3. Decide the `resolvePairableDeviceId` precedence question.
4. Owner decision on OTP provisioning.

## 14. Truth statement

Registration, HET approval, enrolment, Store pairing and trusted time were
**observed on physical hardware** and are recorded above with the values seen.

Operational certificate issuance **has never completed on hardware**, and nothing
in this handoff should be read as claiming otherwise. The device is
`awaiting_trust`, not `active`.

`pnpm verify` was not run. No hosted deployment was made. Hosted development
remains at 0197. Every code change is uncommitted on
`claude/fix-firstboot-esm-and-ssh-hostkeys`, base `0a30a74`.
