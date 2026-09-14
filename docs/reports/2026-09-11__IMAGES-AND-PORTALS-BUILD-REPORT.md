# KitLuy Suite — what has been built: device images and portals

| Field                     | Value                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report date               | 2026-09-11 · Asia/Phnom_Penh                                                                                                                                                                                                                                                                                     |
| Repository                | `het-kitluy-project` (HET KitLuy Project monorepo)                                                                                                                                                                                                                                                               |
| Repository root           | `~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project`                                                                                                                                                                                                                                                    |
| Product name              | **KitLuy Suite**                                                                                                                                                                                                                                                                                                 |
| Branch at time of writing | `claude/fix-firstboot-esm-and-ssh-hostkeys`                                                                                                                                                                                                                                                                      |
| Purpose of this file      | A self-contained briefing for an outside AI/reader who has **no access to this repository**. It describes the two Raspberry Pi device images and the browser portals, what is proven, and what is not.                                                                                                           |
| Method                    | Written from the repository itself: source files, `runtime-manifest.json` in both image trees, migration directories, and the dated handoff records in `00_AI_HANDOFF/`. No commands were re-run for this report — every test number below is quoted from the handoff that recorded it, and is labelled as such. |

> **Vocabulary rule used throughout.** `BUILT` = implemented and exercised by tests.
> `PROVEN ON HARDWARE` = observed working on a physical Raspberry Pi, with the
> observation recorded. `PARTIAL` = some slices done, named gaps remaining.
> `SCAFFOLDED` = the shell of an application exists with no business behaviour.
> These are not interchangeable, and nothing scaffolded is called implemented.

---

## 0. The one-paragraph version

KitLuy Suite is a retail platform whose store-floor half runs on Raspberry Pi
hardware. Two device classes exist, each with its **own** flashable OS image
built from its **own** source tree: a **Store Hub** (one per store; holds the
store's encrypted local database and serves the store's terminals over the LAN)
and a **Pi Terminal** (the counter device; a kiosk screen). Three browser
portals govern them from the cloud: an **Admin Portal** (HET-internal — approves
boards, creates Digital Stores), a **Partner Portal** (the merchant's back
office — pairs a Store Hub, defines terminal seats, issues one-time pairing
codes), and a **Chain Portal** (scaffold only). As of 2026-09-11, a Pi Terminal
has been taken from a blank SD card through cloud registration, Admin approval,
Partner pairing, LAN discovery of its Store Hub, mutual TLS and a signed pairing
handshake, and is now **served by its Store Hub** — every bootstrap route
answering `200`, on real hardware, from a clean slate.

---

## 1. Repository shape (the numbers)

| Thing                                          | Count                                      | Note                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Applications (`apps/`)                         | 9                                          | 3 PWA portals, device shell, POS desktop, POS mobile, partner app, storefront, B2B website                                                          |
| Services (`services/`)                         | 20                                         | management API, device registry, hub agent, firstboot agent, sync, provisioning, …                                                                  |
| Shared packages (`packages/`)                  | 45                                         | money, rbac, auth, edge-contracts, device-identity, web-ui, localization, …                                                                         |
| Verticals (`verticals/`)                       | 9 phases                                   | Phase 1 Laundry is the owner-locked live vertical                                                                                                   |
| Cloud migrations (`supabase/migrations/`)      | 119 files, sequence numbered to **0220**   | the sequence is sparse by design (0000, 0010, 0020, 0035, …), so 119 files reach 0220. Latest: `…0220_a_recovering_terminal_may_present_a_code.sql` |
| Store Hub local migrations (`hub/migrations/`) | 43 files, numbered to **0042**             | `0042_terminal_pairing_signing_credential.sql`                                                                                                      |
| Supabase edge functions                        | 1 real (`device-registration`) + `_shared` | the unauthenticated door a fresh board knocks on                                                                                                    |

Monorepo, pnpm workspaces, strict TypeScript, Turbo. Node version pinned in
`.nvmrc`; dependency versions live in the `pnpm-workspace.yaml` catalog.

---

## 2. Part A — the two device images

### 2.1 Why there are two images, not one

Owner decision 2026-08-13: **two devices, two images, two sources.** A Store Hub
and a Pi Terminal do fundamentally different jobs and carry different authority,
so they are not profiles of one build.

|                         | Pi Terminal                            | Store Hub                             |
| ----------------------- | -------------------------------------- | ------------------------------------- |
| Source tree             | `infra/kitluy-os-image`                | `infra/kitluy-store-hub-image`        |
| Profile                 | `pi-terminal`                          | `store-hub`                           |
| Carries a database      | **No**                                 | Yes — PostgreSQL 15 on encrypted NVMe |
| Carries Store authority | **No — asserted absent by every test** | Yes                                   |
| Primary surface         | Electron kiosk on a screen             | headless; serves the LAN              |

### 2.2 The mechanism that keeps an image honest: `runtime-manifest.json`

Each image tree has exactly one declaration of what a flashable image contains.
Three consumers read it, which is what stops them drifting apart:

1. `scripts/package-bootstrap-runtime.sh` — packages what is declared, and
   **refuses the build** on any disagreement;
2. `test/image-contents.test.sh` — inspects a **built** root filesystem for it;
3. `test/systemd-runtime.test.sh` — cross-checks that the units are enabled.

This exists because of a real failure: the Hub agent's systemd unit once lived
only in a build path that **cannot** produce an `.img`, so the component was
present in the inspectable tree and absent from every actual card, while the
image went on advertising the service. Declaring a component and not packaging
it now fails the build; packaging one without declaring it makes it invisible to
the tests, which is equally refused.

Rule enforced in both manifests: **nothing per-device belongs in an image** — no
device key, certificate, tenant, store, location, staff record, machine-id or
SSH host key.

### 2.3 Pi Terminal image — `infra/kitluy-os-image`

64-bit Debian on a pinned upstream builder (`rpi-image-gen`), A/B system slots
behind dm-verity, a shared persistent partition, read-only erofs root.

**Declared components** (from `runtime-manifest.json`):

| Component                              | systemd unit                        | Enabled | What it does                                                                                         |
| -------------------------------------- | ----------------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `firstboot-identity`                   | `kitluy-firstboot.service`          | yes     | creates the board's Ed25519 **device identity key** at first boot                                    |
| `cloud-registration`                   | `kitluy-cloud-registration.service` | yes     | Factory Enrollment: registers with KitLuy and waits for an explicit Admin approval; polls every 60 s |
| `health-reporter`                      | `kitluy-health-reporter.service`    | yes     | device heartbeats                                                                                    |
| `update-agent`                         | `kitluy-update-agent.service`       | yes     | signed release / update channel client                                                               |
| `ssh-hostkeys`                         | `kitluy-ssh-hostkeys.service`       | yes     | generates host keys into the slot-shared mount (see §2.6)                                            |
| `bootstrap-screen`                     | `kitluy-bootstrap-screen.service`   | **no**  | the retired _text_ status screen on tty1, superseded by the shell                                    |
| `device-shell`                         | `kitluy-device-shell.service`       | yes     | the Electron kiosk (§3.4)                                                                            |
| `electron-runtime`                     | —                                   | yes     | pinned Electron **38.8.6** arm64, fetched + checksum-verified, not committed                         |
| `terminal-edge`                        | `kitluy-terminal-edge.service`      | yes     | discovers the Store Hub, does mutual TLS, pairs, reads bootstrap (§2.5)                              |
| `terminal-session` / `terminal-client` | —                                   | no      | declared successors, not yet enabled                                                                 |

Plus a **root config broker** (`kitluy-device-config.service`): the kiosk runs
with an **empty `CapabilityBoundingSet`** and therefore cannot join a Wi-Fi
network or set the backlight. Rather than weaken that hardening, the privileged
verbs moved to a root broker answering a **closed six-verb list** on a unix
socket, with the shell as its client.

Two details that would otherwise have been silent failures on a shop counter:
`fonts-khmeros` is installed (the shell is Khmer-default; without it the first
screen an installer sees is a row of empty boxes), and `XDG_RUNTIME_DIR` comes
from systemd's `RuntimeDirectory=` rather than `/run/user`, which `ProtectHome=yes`
makes inaccessible.

**The image carries no Store authority of any kind** — no Hub agent, no
database, no business application — and the test suites assert that absence
explicitly rather than trusting it.

**Build:**

```bash
pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build

KITLUY_DEV_SSH_PUBKEY=$HOME/.ssh/id_ed25519.pub KITLUY_DEV_SUDO=1 \
  bash infra/kitluy-os-image/scripts/build-rpi-image.sh --profile pi-terminal \
    --environment development \
    --registration-url http://<lan-ip>:<port>/functions/v1/device-registration \
    --hardware-profile-key KL-PI5-TERMINAL-DEV
```

`--environment` is never defaulted. The registration URL and hardware profile
key are **baked into the read-only rootfs** — a wrong key is refused
`KLUY-REG-UNKNOWN-PROFILE` on every attempt and cannot be corrected on the card.
There are deliberately two build scripts: `build-image.sh` stages an inspectable
tree and **refuses** to emit an `.img` (exit 3); only `build-rpi-image.sh`
produces a real image. Everything built on a developer workstation is
**DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT PROMOTABLE**.

**Test suites:** `build-gates`, `systemd-runtime`, `environment-gating`,
`rpi-image-gen`, `image-contents` (the only one that reads a **built** rootfs;
it SKIPS when no image has been built, and a skip is treated as _no evidence_,
never as a pass), plus `scan-image-secrets.sh` over the built tree.

### 2.4 Store Hub image — `infra/kitluy-store-hub-image`

**Declared components:**

| Component                | systemd unit                        | What it does                                                                     |
| ------------------------ | ----------------------------------- | -------------------------------------------------------------------------------- |
| `firstboot-identity`     | `kitluy-firstboot.service`          | device identity key                                                              |
| `cloud-registration`     | `kitluy-cloud-registration.service` | Factory Enrollment                                                               |
| `hub-pairing-ui`         | `kitluy-hub-pairing.service`        | the console where the installer types the Partner's one-time Hub pairing code    |
| `operational-tls`        | `kitluy-operational-tls.service`    | obtains the board's operational X.509 certificate                                |
| `health-reporter`        | `kitluy-health-reporter.service`    | heartbeats                                                                       |
| `update-agent`           | `kitluy-update-agent.service`       | update channel                                                                   |
| `hub-storage-provision`  | `kitluy-hub-storage.service`        | **LUKS2** container on NVMe, resolved by type (never a hardcoded `/dev/nvme0n1`) |
| `hub-database-provision` | `kitluy-hub-database.service`       | PostgreSQL 15 cluster + the 43 Hub migrations                                    |
| `hub-agent`              | `kitluy-hub-agent.service`          | the LAN server: mutual TLS on **:7443**, mDNS `_kitluy-edge._tcp`                |

Extra suite over the terminal tree: `storage-posture.test.sh`.

### 2.5 What the Store Hub actually serves to a terminal

`services/kitluy-hub-agent/src/hub/edge/routes.ts` — an `/edge/v1` surface over
pinned mutual TLS:

- discovery (`.well-known`, a **signed** discovery record)
- activation challenges / activation complete
- pairing sessions, pairing proof, pairing complete, pairing receipt
- runtime **authority time**, runtime **eligibility**, **current configuration**
- staff sessions: open / refresh / close
- customers: search / create / read / consent
- booking drafts: create / read / update / cancel
- terminal health heartbeats

The Hub is the store's authority for terminals. **POS terminals never write
directly to Supabase** — bypassing the Store Hub for normal Store operations is
a hard rule of the architecture.

### 2.6 Hardware bring-up: the dated record

| Date           | Milestone                                                                                                                                                                                                                    | Status recorded                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 2026-08-31     | A physical Pi 5 registered, was approved in the Admin Portal, enrolled, and **paired from the Partner Portal** — the whole admission chain through the UI for the first time                                                 | PARTIAL — certificate issuance stranded |
| 2026-09-01     | **Store Hub reaches `active`** on hardware: `manufactured → enrolled → awaiting_trust → active` in six seconds, unassisted, with two portal clicks and a typed code                                                          | done                                    |
| 2026-09-01     | **Store Hub edge runtime foundation**: a Pi 5 served a signed discovery record over mutual TLS on :7443 — LUKS2 volume, PostgreSQL, 42 migrations, agent listening, signature verifying against the board's own identity key | GATE A ACHIEVED                         |
| 2026-09-03     | **Factory Enrollment becomes the terminal's first stage**; proven on a Pi 5 the same evening: registered, approved, "Approved / Store Unassigned" on screen, survives reboot                                                 | PARTIAL                                 |
| 2026-09-07     | The Pi Terminal image gets a screen that can take a pairing code: `cage` kiosk compositor + pinned Electron arm64 in the image. Full image built (QEMU cross-build, exit 0, 8.9 GB raw / 734 MB compressed) and inspected    | PARTIAL                                 |
| 2026-09-08     | Terminal **Settings screen** + root config broker; Admin can tell an online Pi from an unplugged one                                                                                                                         | TESTED-IN-DEV                           |
| 2026-09-10     | The Store Hub serves terminals — three image defects found and fixed; a terminal dials its Hub and is recognised                                                                                                             | PROVEN ON HARDWARE, partial by design   |
| **2026-09-11** | **A Pi Terminal is served by its Store Hub, end to end**                                                                                                                                                                     | **PROVEN ON HARDWARE**                  |

The 2026-09-11 result, from a completely clean slate (cloud fleet truncated,
both boards on new SD cards with freshly built images, new device records, new
certificates):

```text
terminal-edge   SERVING: connected to Store Hub c00ce1a3-… at 172.16.13.203:7443
pairing session paired, receipt written

edge:discovery              200  SIGNED_RECORD
edge:runtime-authority-time 200  AUTHORITY_TIME
edge:runtime-eligibility    200  ELIGIBLE
edge:configuration-current  200  CONFIGURATION_DELIVERY
```

### 2.7 Defect classes worth knowing about (they recur)

These are recorded because each cost real time and each generalises:

- **A device holds two keys doing two jobs.** An RSA-2048 _operational_ key
  carries mutual TLS; an Ed25519 _device identity_ key signs pairing proofs.
  Binding the wrong one in a transcript makes the handshake unsatisfiable from
  both sides. Hub migration `0042` binds the **signing** credential.
- **DER serial padding.** `certificate_x509_serial` stored the DER integer
  bytes, and DER pads a positive integer whose high bit is set
  (`008fc0…` stored vs `8fc0…` seen by OpenSSL, Node and the Hub). It therefore
  **failed on roughly half of all serials, at random** — one day's serial began
  `0x3F` and passed, the next began `0x8F` and failed.
- **`concat_ws` silently drops NULL arguments.** A device class written into a
  trust-level column went NULL, so the database built 16 canonical
  to-be-signed fields where the application built 17. The bytes could never
  match, and nothing said which field diverged. Any nullable field in such a
  list reproduces it.
- **A CHECK constraint that could permanently brick a terminal (fixed in 0042).**
  `(terminal_proof_verified_at is not null) = (state in ('terminal_proof_verified','paired'))`
  made the expiry sweep throw for a session that had recorded a proof — and the
  sweep is the only thing that clears an outstanding handshake, so that terminal
  could never open another session on that Hub, with a governance trigger
  refusing any hand-edit. Replaced by two implications.
- **A read-only erofs root changes what init does.** `systemd-tmpfiles-setup` is
  condition-skipped, so `postgresql-common`'s tmpfiles rule never created
  `/run/postgresql`; the fallback `install -d -m 2775` was then blocked by the
  unit's own `RestrictSUIDSGID=yes`, because 2775 carries setgid.
- **An upstream generator created its `.wants` symlink once after both loops**
  using the leftover variable — with ssh and wifi declared, wifi won and SSH was
  dead forever. Fixed by owning our own `kitluy-ssh-hostkeys.service` rather
  than patching the pinned upstream checkout.

---

## 3. Part B — the portals and on-device UI

All three portals are React + Vite PWAs using **hash routing** (a history router
needs the serving origin to rewrite unknown paths to `index.html`; a control
plane that 404s on refresh because a static host was misconfigured is a failure
mode worth designing out). All are **Khmer-default, bilingual km-KH / en-US**.

Three rules hold across every portal:

1. **Authorization is backend + RLS truth.** Hiding a control in the UI is never
   authorization; the API re-decides permission and Store scope per request.
2. **Every data surface fails closed.** A `200` with an unexpected body is
   "unavailable", never an empty list. An unconfigured deployment says so.
   No synthetic operational values, ever.
3. **No portal reads the device or core schemas directly.** `kitluy_devices`
   and `kitluy_core` are closed to the data API; every governed door is granted
   to a service identity only. A browser attempting a direct device query gets
   `permission denied`, which is the _correct_ outcome.

### 3.1 Admin PWA Portal — `apps/kitluy-admin-pwa-portal`

**Status: BUILT** for the fleet and store surfaces. HET-internal privileged
control plane — never exposed to Partners, Chains, Store staff or customers,
and never reachable through public Partner signup.

Routes: `#/devices` · `#/pending` · `#/devices/{id}` · `#/stores` · `#/stores/new` · `#/login`

Against the Management API (`/management/v1`):

| Screen                       | Endpoint                                |
| ---------------------------- | --------------------------------------- |
| signed-in identity           | `GET /me`                               |
| fleet list                   | `GET /devices`                          |
| device detail                | `GET /devices/{id}`                     |
| **verify-and-approve queue** | `GET /devices-pending`                  |
| approve a board              | `POST /devices/{id}/approve-enrollment` |
| Digital Stores list          | `GET /digital-stores`                   |
| create-store options         | `GET /digital-stores/options`           |
| create a Digital Store       | `POST /digital-stores`                  |

Built behaviour worth noting:

- **Nine lifecycle labels**, in both locales, mirroring the nine values of
  `kitluy_devices.device_lifecycle_state` (`manufactured`, `enrolled`,
  `awaiting_trust`, `active`, `quarantined`, `restricted_investigation`,
  `suspended`, `retired`, `replaced`). A test asserts the count, so a value
  added to the enum without a label is noticed rather than shown raw. The raw
  words are misleading on their own — `enrolled` is displayed as "Approved, not
  assigned to a Store"; `awaiting_trust` as "Assigned to a Store, awaiting
  activation".
- **Approval queue as a separate route**, because it is a separate job: a person
  works through it with the hardware physically in front of them.
- **Online vs unplugged.** Device freshness was reading only enrolment-time
  hardware evidence, so every device read `NEVER_SEEN`. Migration `0216` added
  a registration-sightings table fed by the registration poll the boards were
  already making, and a definer door that never raises.
- **Create a Digital Store**: a DRAFT Store under a Tenant with an ACTIVE
  vertical from the registry, optionally its first Location, optionally a scope
  for the Tenant's existing Partner staff, one audit row, and **four-eyes
  approval outside development**.

### 3.2 Partner PWA Portal — `apps/kitluy-partner-pwa-portal`

**Status: BUILT** for two screens per Store. The merchant's back office for one
active Digital Store context.

Routes: `#/stores/{storeId}/hub` · `#/stores/{storeId}/terminals`
The Store id lives **in the hash** — the Partner's "one active Store context"
made reload-safe without browser storage, which a pairing code must never touch.

**Screen 1 — Store Hub pairing.** `GET /partner/stores`,
`POST /hub-pairing-codes`, `GET /hub-pairing-codes/{sessionId}`.

**Screen 2 — Provisioning → Terminals.** `GET|POST /partner/stores/{id}/terminals`,
`POST /partner/terminals`, `POST /terminal-pairing-sessions`,
`GET /terminal-pairing-sessions/{id}`, `POST /terminal-pairing-sessions/{id}/cancel`.

A terminal **seat** is defined first (name optional, role short codes from the
laundry vertical, a Location), then a one-time code is issued for it: one code
per seat, fifteen minutes, five attempts, single use, and an **active Store Hub
required**. The code is shown once with a countdown, and is never logged,
stored, put in a URL or drawn from one. **There is no QR** — the installer types
the code on the device (owner clarification, 2026-09-04).

**The eight-rung provisioning ladder** reports and never infers:
`hubActive → issued → redeemed → hubPaired → activated → appInstalled → pinSet → active`.
A rung is `done` only when something reported it, `not_reported` otherwise; no
rung is inferred from an earlier one, and a done rung is never demoted when the
Hub later regresses. One rung — `hubPaired` — is currently in `UNREPORTABLE_RUNGS`
and rendered as _unbuildable_ rather than _awaited_, because nothing in the
build can report it yet (the device now knows the answer; nothing carries it to
the cloud and the API has no field for it).

**The Store Hub is the visible precondition of every terminal.** When the API
reports the Hub as anything but `active` — or does not report it at all — the
Pair action is replaced by the reason. Nothing is inferred.

### 3.3 Chain PWA Portal — `apps/kitluy-chain-pwa-portal`

**Status: SCAFFOLDED.** A buildable branded shell with the locale toggle, a
structural signed-out/authenticated route separation, an error boundary, and
fail-closed data surfaces. **No business functionality is implemented**, and
there is deliberately no fake login — the Supabase Auth contract for this portal
is a pending canonical spec, so it fails closed and says so. Its boundary:
multi-store governance for chain, brand, regional, franchise, finance and
compliance users — **not** a POS and **not** a second operational ledger.

### 3.4 Pi Terminal Device Shell — `apps/kitluy-device-shell`

Not a portal — this is the screen **on the device**. A hardened kiosk (Electron
on Wayland under `cage`, one application with no desktop behind it).

Screen flow: `booting` → `waiting for approval` (not registered / registering /
awaiting approval / unreachable, with a "no network" note) → `halted` (trust
review or contained) → `approved, not assigned` (the pairing keypad) →
`assigned`. The screen names the board by the **same `KL-…` asset tag the Admin
Portal lists**, so the person at the Pi and the person at the portal agree about
which board they are discussing.

- `src/model/code-entry.ts` — a **pure** keypad reducer (Crockford Base32,
  length 8), shared by the on-screen keypad and a USB keyboard-wedge scanner.
- `src/model/shell-state.ts` — a **pure** screen derivation from a snapshot; it
  mirrors the firstboot agent's phase unions and is guarded by a compile-time
  **and** runtime drift test, so the two cannot diverge silently.
- `electron/main.ts` — the hardened window and a **read-only** IPC surface.
- `src/settings.tsx` — four tabs in both locales: **Network, Printer, Device,
  Display**. It is explicitly not a Linux administration surface: a fixed set of
  controls, and every privileged verb goes through the root broker (§2.3).

It carries **no Store authority** and offers **no path to a business
application** before activation.

### 3.5 Shared design system — `@kitluy/web-ui`

Both the Admin and Partner portals render inside one shared `AppShell`: a
deep-slate left sidebar (brand, navigation, account), a sticky top bar with
language and theme toggles, and a card-based content area. Refined enterprise
blue; theme-aware light **and** dark, following the OS with an in-app toggle
persisted to `localStorage`. Design tokens resolve to CSS custom properties
(`var(--kl-*)`), so the redesign was pure presentation — no data path changed.

---

## 4. Part C — what joins the images to the portals

```text
  Pi Terminal (image)                Store Hub (image)
        │                                   │
        │ mDNS _kitluy-edge._tcp            │ serves :7443 mutual TLS
        │ mutual TLS + Ed25519 pairing      │ PostgreSQL 15 on LUKS2 NVMe
        └──────────── LAN ──────────────────┘
                        │
                        │ (Hub ⇄ cloud; terminals never write to Supabase directly)
                        ▼
        ┌───────────────────────────────────────────┐
        │  Supabase cloud  ·  119 migrations → 0220 │
        │  edge function: device-registration       │
        └───────────────────────────────────────────┘
                        ▲
                        │ /management/v1  (services/kitluy-management-api)
        ┌───────────────┴───────────────┐
        │                               │
   Admin Portal                   Partner Portal          Chain Portal (scaffold)
```

The Management API (`services/kitluy-management-api`) is the single governed
door for both working portals: `fleet`, `device-approval`,
`partner-authorization`, `digital-stores`, `hub-pairing-issuance`,
`terminal-provisioning`, behind `authorization.ts`.

A board's very first network call goes to the **`device-registration` Supabase
edge function** — the only unauthenticated door — which is why Factory
Enrollment can work before any credential exists.

---

## 5. Status summary

| Capability                                                              | Status                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------- |
| Store Hub image builds and flashes                                      | **PROVEN ON HARDWARE**                          |
| Store Hub reaches `active` via the portals                              | **PROVEN ON HARDWARE** (2026-09-01)             |
| Store Hub serves the LAN over mutual TLS :7443                          | **PROVEN ON HARDWARE**                          |
| Pi Terminal image builds and flashes                                    | **PROVEN ON HARDWARE**                          |
| Pi Terminal Factory Enrollment (register → Admin approval → `enrolled`) | **PROVEN ON HARDWARE** (2026-09-03)             |
| Pi Terminal graphical kiosk shell in the image                          | **BUILT**, image built and inspected            |
| Terminal discovers, pairs with and is served by its Store Hub           | **PROVEN ON HARDWARE, END TO END** (2026-09-11) |
| Admin Portal: fleet, approval queue, device detail, Digital Stores      | **BUILT**                                       |
| Partner Portal: Hub pairing, terminal seats, one-time codes, ladder     | **BUILT**                                       |
| Chain Portal                                                            | **SCAFFOLDED**                                  |
| POS business application on a terminal                                  | **not started in this program**                 |
| Deployment to pilot or production                                       | **NONE**                                        |

---

## 6. Open items, honestly stated

1. **The `hubPaired` rung is unreportable.** The device side now exists
   (`edge-status.json` carries the phase), but nothing carries it to the cloud
   and the Management API has no field for it. Newly worth doing, because the
   honest value is finally `SERVING`.
2. **Every Store Hub reflash breaks storage.** The
   `DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED` marker lives on the SD card while
   the encrypted volume lives on the NVMe, so a reflashed Hub must be
   re-authorized by hand. A rough edge worth closing in the image.
3. **`isHubDatabaseReachable()` still swallows every error**, so a database
   fault reports as a generic unreachability.
4. **`lan-client.ts` in the POS desktop app** cannot pass its own
   server-identity check against a URI-SAN device certificate.
5. **BLK-005 — image signing key custody is unresolved.** Pilot and stable
   release channels therefore **refuse**, and everything built today is
   development-only and not promotable. The Hub's LAN listener and the
   DEVELOPMENT-UNBOUND storage posture are likewise development-gated by design.
6. **Secure element model** is an open production BOM decision, and the Debian
   snapshot pin for reproducible apt state is an open owner decision.
7. **Working-tree state.** A large part of the work described here — the
   terminal edge client, Hub migration `0042`, the provisioning script, the
   three newest handoff records — is **present and uncommitted** on branch
   `claude/fix-firstboot-esm-and-ssh-hostkeys`.
8. **Documentation drift to be aware of.** `infra/kitluy-os-image/README.md`
   still describes the graphical Device Shell as arriving "in the next slice"
   and lists the last physical boot as 2026-08-13. Both are stale — the shell is
   in the image and the tree has been booted since. The dated records in
   `00_AI_HANDOFF/` are the newer truth.

---

## 7. Evidence, and what this report does **not** claim

Test numbers quoted from the records that produced them, **not re-run for this
report**:

| Recorded   | Result                                                                                                                                        | Source                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 2026-09-11 | `services/kitluy-hub-agent` — 176 passed, 0 failed, 271 skipped (no local hub database)                                                       | handoff 38 §5          |
| 2026-09-07 | terminal image 294/0/1 · Store Hub image 291/0/1 · device shell 66/66 · firstboot agent 455 passed / 9 skipped · secret scan over 2 089 files | `KL-P1-TERM-SHELL-002` |
| 2026-09-07 | built-rootfs `image-contents` 83/0/1 · `systemd-runtime` 171/0 · device shell 70/70                                                           | `KL-P1-TERM-SHELL-003` |

**No command was executed to produce this document, and no status here was
advanced on its own authority.** `pnpm verify` was not run — nothing in the
repository was changed except the addition of this file. The 271 skipped Hub
tests are skipped for want of a local Hub database, and a skipped suite is
**no evidence**, not a pass.

---

## 8. Glossary for an outside reader

| Term                   | Meaning                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **KitLuy Suite**       | the product name                                                                                                          |
| **HET KitLuy Project** | the project; `het-kitluy-project` is its repository                                                                       |
| **Store Hub**          | one Raspberry Pi per store; holds the store's encrypted local PostgreSQL and serves that store's terminals over the LAN   |
| **Pi Terminal**        | the Raspberry Pi at the counter; a kiosk screen, no local database, no Store authority                                    |
| **Factory Enrollment** | a flashed board registers itself and then **waits for an explicit Admin approval**; pending is its designed resting state |
| **Digital Store**      | the cloud record of a store, created by an Admin and assigned to a Partner                                                |
| **Partner**            | the merchant — the customer who operates stores                                                                           |
| **Chain**              | multi-store governance above the Partner                                                                                  |
| **T1–T4**              | the owner-locked Phase 1 Laundry terminal model; a three-terminal mapping is rejected                                     |
| **Four-eyes**          | a second authorized person must approve; cannot be relaxed                                                                |
| **RLS**                | PostgreSQL row-level security — the real authorization boundary                                                           |
| **`enrolled`**         | approved by an Admin, **not** yet assigned to a Store                                                                     |
| **`awaiting_trust`**   | assigned to a Store, awaiting activation                                                                                  |
| **`active`**           | fully activated; for a Hub, the only state in which it can serve terminals                                                |
| **erofs / dm-verity**  | read-only, integrity-checked root filesystem — nothing on a booted device's root can be edited                            |
| **`cage`**             | a Wayland kiosk compositor that shows exactly one application with no desktop behind it                                   |

---

_Written 2026-09-11 from the repository at commit `bde3490` plus the uncommitted
working tree on `claude/fix-firstboot-esm-and-ssh-hostkeys`._
