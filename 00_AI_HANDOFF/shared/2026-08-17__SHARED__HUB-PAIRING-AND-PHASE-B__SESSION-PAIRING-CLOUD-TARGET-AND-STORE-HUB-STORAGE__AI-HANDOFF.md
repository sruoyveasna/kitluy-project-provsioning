# Store Hub pairing, the cloud development target, and Phase B storage

**Date:** 2026-08-17
**Branch:** `claude/fix-firstboot-esm-and-ssh-hostkeys`
**Nothing pushed.** Every change below is committed locally only.

---

## 1. What a reader most needs to know first

Three things changed that invalidate assumptions a previous session would have
carried:

1. **Development now targets the hosted development Supabase project**
   (`kitluy-project-pos`, `gjgbnkhuwlwhngbtrgts`), not a local Docker stack. The
   owner asked for this directly, and the guard that prevented it turned out to
   be stricter than the decision it cited. See §4.
2. **Store Hub pairing is a STORE-scoped session, not a device-scoped claim.**
   The database implemented this and no TypeScript called it; both routes still
   spoke the old per-device contract. See §3.
3. **The Store Hub image now provisions its own encrypted database.** It did
   not before — `postgresql-15` was installed and nothing ever ran `initdb`.
   See §5.

---

## 2. State of the two databases

| | local `kitluy-repo17` | hosted `kitluy-project-pos` |
| --- | --- | --- |
| migration ledger | 88 of 93 | **93 of 93** |
| group 0189 | cannot apply — segfaults the backend | applied |
| group 0190 | PARTIAL (`open_manufacturing_enrollment_challenge_v1` missing) | **complete** |
| pairing groups 0191–0194 | applied by hand | applied by `db:deploy:hosted-dev` |

**The hosted project is the more complete of the two.** `KLREC-2026-08-11-EDGE-006`
(the `GRANT <role> TO CURRENT_USER` segfault) is still OPEN and still means no
local stack can replay the full chain.

Fixtures on hosted: station `CLOUD-STATION-01`, profiles `CLOUD-TERM-PI5` and
`CLOUD-HUB-PI5` (both active), and — new this session — one Tenant/Store/Location
via `pnpm dev:seed:hosted-scope`, because the project had **zero Digital Stores**
and a Hub could enrol with nothing to pair into.

---

## 3. Phase A — Store Hub pairing, completed

Commits `618a793`, `8dc8a9c`, `949648f`, `af8a13a`, `8698df5`, `a39ed3d`, `dee017e`.

* **Migrations 0191–0194.** Code format, fifteen-minute ceiling, five-attempt
  lockout, least-privilege composition identities, governed issuance, and
  store-scoped pairing sessions.
* **`/v1/hub-pairing`** (device) and **`POST /management/v1/hub-pairing-codes`**
  (Partner), both rewired to the session model.
* **Partner Portal** screen: choose shop and Location, generate, show once with a
  live countdown. No Hub picker — the owner decision says the code belongs to the
  Store and any Hub may use it.
* **Admin Portal**: `store_hub` filter and a Hub-readiness column kept separate
  from the condition badge, because `pending_trust` is *waiting*, not *faulty*.

### The correction worth reading

`KLREC-2026-08-13-HUB-PAIRING-WIRING-001`. Group 0194 was applied and granted but
**unreachable** — no TypeScript called its doors. Building the Portal on the
shipped contract would have forced a Hub picker onto the Partner, which the owner
decision rejected and which cannot be built honestly anyway: an unpaired Hub
belongs to nobody, so "their" Hubs cannot be listed without listing everyone's.

Two behaviours were re-asserted because the model changed what is TRUE:

* a wrong code can **never** lock a session — it matches nothing, so there is
  nothing to count it against. The pre-session test asserted a lockout after five
  wrong codes; under sessions that would let a stranger lock a shop out.
* the fifth failure locks but reports its CAUSE, not "locked". Only a later
  presentation meets the closed door.

---

## 4. The development target (`KLREC-2026-08-17-DEV-TARGET-001`)

`dev:fleet` refused every non-loopback database citing
`KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001 §5`. **That decision does not say it.**
Its locked guards concern the ENVIRONMENT, and its §1 asks for Pis to "come
online **in the cloud** by itself". §4 states the accepted risk as a property of
the ENDPOINT, which is still bound to the workstation's LAN.

Also fixed, and invisible until a Hub was booted: `dev:fleet` configured only a
**terminal** hardware profile, and open enrollment answers `TICKET_REFUSED` for a
device class with none — so **no Store Hub could enrol through it at all**.

`pnpm dev:fleet` now defaults to the hosted development project; `--local` selects
the loopback stack. The `docker exec … psql` transport is gone (this host has no
`psql`), replaced by a client library.

---

## 5. Phase B — what was built, and what is blocked

### B1 — the three contradictions, fixed (`c7c080b`)

| | was | now |
| --- | --- | --- |
| LAN port | `8443` in three places | **`7443`** — a terminal REJECTS any other port |
| variable names | `KITLUY_LAN_*` | **`HUB_LAN_*`** — the agent reads the latter; the names never met, so the file was inert |
| bind address | `0.0.0.0` | **unset** — `FORBIDDEN_BINDS` refuses wildcards outright |

The port defect was the dangerous one: the Hub would have presented a correctly
verifying signature and still been refused by every terminal.

### B2 — encrypted NVMe + PostgreSQL (`4f9eb00`)

`kitluy-hub-storage.service` → `var-lib-kitluy-hub.mount` → `kitluy-hub-database.service`.

* LUKS2 key derived by HMAC from the Pi's **OTP device-unique private key**
  (`rpi-otp-private-key`) — fuses, not visible to `vcgencmd otp_dump`. A stolen
  NVMe is ciphertext.
* The upstream `block-device-id | rpi-fw-crypto` pattern is **not usable**: those
  tools ship with Raspberry Pi OS and this image is Debian Bookworm minbase.
  Verified against the built rootfs.
* **Refuses** on: no NVMe, two NVMe drives, NVMe carrying root, a non-KitLuy
  filesystem, an unmounted volume, or unprogrammed OTP (burning fuses is
  irreversible and is an owner decision).
* Migrations apply in **development only** (`KL-INF-P1-037`, owner-locked).
* The mount is a systemd `.mount` unit: a service mounting inside its own sandbox
  namespace would leave the database and agent seeing an empty directory while
  the unit reported success.

### B3a — production entrypoint (`d5ff6ed`)

`services/kitluy-hub-agent/src/bin/hub-agent.ts` + `hub-runtime.ts`, 22 tests.
Separate from `main.ts`, which declares itself a "development simulation ONLY".
Refuses in order — database → drift → pending → ahead → wildcard bind →
certificates — so the message names the FIRST thing wrong. **Degraded is not
refused**: safety mode exists so a Hub keeps a shop trading.

Two `[REQUIRED:]` gaps closed: disk usage is MEASURED via `statfs` (unmeasurable
reports 100%, not 0%, so it cannot read as healthy), and an absent clock reading
stays absent rather than becoming a verified zero.

### B3b — BLOCKED on BLK-005

`createEdgeTlsServer` needs a Hub certificate and a device CA. **Nothing in this
codebase can produce them** — no x509 generation, no CA,
`createProductionBatchSigner()` throws. The test suites mint their own CAs; those
helpers are deliberately test-local and were not promoted. Also absent: any
implementation of `MdnsAnnouncer` (the interface exists).

**A terminal cannot talk to a Hub today, and will not until PKI is decided.**

---

## 6. Image secret scan — both findings

The BUILT image failed its own scan (16 pass, 1 fail):

* **`Cryptodome/SelfTest`** — 2.8 MB of a crypto library's test vectors. Removed
  from the image. The LIBRARY stays: `rpi-eeprom-config` genuinely imports it for
  signed Pi 5 EEPROM, verified by reading the shipped script.
* **Hub migration 0038** contains a PEM marker ON PURPOSE — it asserts at apply
  time that the trust registry REFUSES a private key. Exempted **by name** in the
  scanner rather than rewritten, because an independent review recorded an earlier
  silent amendment of this exact probe as **"THE ONE REAL BREACH"**, and schema
  contract §4 forbids editing an applied file.

⚠️ Two test suites carry **inline copies** of the same secret pattern and needed
the same exception separately. That duplication is the underlying defect and is
recorded here rather than fixed.

---

## 7. Verification at handoff

| Check | Result |
| --- | --- |
| `pnpm typecheck` | 99 / 99 |
| `pnpm secret:scan` | 1790 files, pass |
| `pnpm migrations:validate` | 93 files, pass |
| hub-agent suite | 141 passed |
| management-api | 112 passed |
| partner portal | 20 passed |
| store-hub image suites | build-gates, systemd-runtime, rpi-image-gen — all pass |

**Pre-existing failures, verified at HEAD and NOT caused by this work:**

* device-registry-service: **19 failed** — environmental
  (`kitluy_devices.hardware_profiles does not exist`).
* admin portal `smoke.test.tsx`: **1 failed** — expects
  `data-surface-state="unavailable"` while the shell renders `loading` during
  session restore. Stale assertion, not a broken shell.
* `pnpm verify` overall is **RED** and was before this session: the above, plus
  `prettier --check .` unable to run (`EACCES` on root-owned chroot directories
  under `infra/kitluy-os-image/build/work-*`), plus 43 `no-undef` lint errors
  from `eslint.config.mjs` declaring only 7 globals for `.mjs/.js` files.

---

## 8. Open decisions for the owner

1. **BLK-005 / PKI.** Who issues Hub and terminal certificates, key custody,
   rotation, revocation. Nothing in B3b can proceed without it.
2. **OTP provisioning.** B2 refuses on a board with no programmed OTP key.
   Programming it is irreversible.
3. **`pnpm verify` baseline.** The lint config declares no `Buffer`/`setTimeout`/
   `fetch` for `.mjs` files and lints generated image closures. Left untouched —
   declaring globals to silence errors is an owner call.
4. **The Supabase CLI and the claude.ai MCP connector are authenticated to
   DIFFERENT accounts.** The connector returns "you do not have permission" for
   `gjgbnkhuwlwhngbtrgts`; the CLI and a direct pooler connection both work. This
   has now cost two sessions.

---

## 9. Next step

Rebuild the image (in progress at handoff time) and boot it. Expected:
`store_hub` enrolment against the hosted project via `pnpm dev:fleet`, the
pairing console on tty1, and — with an NVMe fitted and OTP programmed — an
encrypted volume with the 42-migration Hub schema.

**Nothing in Phase B has run on hardware.** The refusal paths are the likeliest
place for a surprise.
