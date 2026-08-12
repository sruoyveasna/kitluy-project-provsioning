# `kitluy-os-image` implementation

**Date:** 2026-08-07
**Status:** **SCAFFOLDED-EXECUTABLE** — the build system runs and is tested;
flashable image assembly is blocked and refuses honestly.

---

## 1. What was built

    infra/kitluy-os-image/
    ├── README.md                       (pre-existing, UNTOUCHED)
    ├── config/
    │   ├── image.conf                  shared config + 4 [REQUIRED] blockers
    │   └── profiles/{store-hub,pi-terminal}.conf
    ├── scripts/
    │   ├── build-image.sh              entrypoint
    │   ├── lib/common.sh               gates, config loading, overlay staging
    │   └── profiles/{base,store-hub,pi-terminal}.sh
    └── test/build-gates.test.sh        34 tests

> **The directory is `scripts/`, not `build/`, on purpose.** `.gitignore` line 7
> ignores `build/` repository-wide, so a build system placed there would have
> been silently untracked and never committed. Build OUTPUT goes to
> `infra/kitluy-os-image/out/<profile>`, which `.gitignore` line 9 correctly
> ignores. An `overlay/<profile>/` tree is supported by `stage_overlay` and is
> absent today — every staged file is currently written by the composition
> scripts, and empty directories are not tracked by git anyway.

Plus `services/kitluy-device-firstboot-agent` — the firstboot identity and
enrollment agent (see `06_DEVICE_AND_ENROLLMENT_MODEL.md`).

## 2. Test result — executed

    bash infra/kitluy-os-image/test/build-gates.test.sh
    → 34 passed, 0 failed

    cd services/kitluy-device-firstboot-agent && pnpm typecheck && pnpm test
    → typecheck clean; 31 passed (2 files)

## 3. The design decision that matters most

**A build that cannot produce a trustworthy image refuses, rather than producing
an untrustworthy one.**

`--stage-only` produces a real, inspectable staged root filesystem and a release
manifest. Without it, the build exits **3** with `BLOCKED-NOT-EXECUTED` and
produces no `.img`.

The alternative — emitting an unsigned `.img` — is worse than emitting nothing,
because an unsigned image file is indistinguishable at a glance from a
releasable artifact. Two tests pin this: the exit code, and the absence of any
`.img`.

The release manifest carries `"signed": false`, `"flashableImage": false`,
`"status": "STAGED-UNSIGNED"`. The `signature` field is **absent, not empty** —
an empty signature reads as "signed with nothing".

## 4. Gates implemented

| Gate                       | Behaviour                                                                |
| -------------------------- | ------------------------------------------------------------------------ |
| Unknown/missing profile    | refuse                                                                   |
| Unknown release channel    | refuse                                                                   |
| `pilot` / `stable` channel | **refuse**, naming BLK-005 — only `internal` is buildable                |
| Refused build              | produces **no output directory**                                         |
| Unpinned base OS           | loud warning; staged root still reproducible, image output stays blocked |
| Secret material in overlay | refuse (service-role key, `BEGIN … PRIVATE KEY`)                         |
| Assignment truth in image  | asserted absent by test                                                  |
| Determinism                | same inputs → same staged-root digest                                    |

The channel gate is the important one: the owner model is
`internal → pilot → stable` with no skips, and pilot/stable additionally require
a real signer and a certified secure-element SKU. Both are BLK-005
implementation work, so the build refuses rather than shipping a pilot artifact
signed with nothing.

## 5. Profiles

**Shared base** (both profiles): SSH hardening (no root login, no password
auth), sysctl hardening, persistent size-capped journald, and four systemd
units — `kitluy-firstboot`, `kitluy-enrollment-agent`, `kitluy-health-reporter`,
`kitluy-update-agent`. Identity is ordered **before** enrollment, because
enrollment has nothing to prove possession of until identity exists (pinned by
test).

**STORE_HUB** adds `kitluy-hub-agent` (LAN `/edge/v1`, TLS 1.3, requires local
PostgreSQL) and `kitluy-hub-discovery` (advertises `_kitluy-edge._tcp.local`).
Headless — no kiosk.

**PI_TERMINAL** adds `kitluy-terminal-client` (Electron kiosk, unprivileged
user, _requires_ the enrollment agent) and `kitluy-hub-discovery-client`
(listens; manual IP is fallback-only). No Hub agent, no local database.

Four tests assert the separation in both directions.

## 6. Zero-secret, and no assignment truth

`/etc/kitluy/image.env` carries only: image name, schema version, profile,
device class, release channel, enrollment base URL, timezone, locales, base-pin
status. Nothing there authenticates anything.

`/etc/kitluy/terminal.env` deliberately carries **no** terminal profile, Tenant,
Digital Store, Location or Hub endpoint. One image serves every terminal
profile; the profile arrives as governed configuration after cloud-authorised
assignment.

## 7. What is NOT built — and is not claimed

- **dm-verity system partition, encrypted data partition, A/B slot assembly.**
  Blocked on the base-image pin, signing key custody and secure-element SKU.
- **The executables the systemd units reference** (`/usr/lib/kitluy/firstboot-identity`,
  `enrollment-agent`, `health-reporter`, `update-agent`, `hub-agent`,
  `terminal-client`, `hub-discovery-*`). The units are staged and correct; the
  binaries are not built. The firstboot agent's _logic_ exists and is tested;
  packaging it into a device executable is the next unit.
- **Any hardware validation.** No Raspberry Pi has run any of this.
  **Nothing here is hardware-certified**, and the mission's §31 rule against
  claiming otherwise is honoured.

## 8. `[REQUIRED]` values blocking flashable output

    KITLUY_BASE_OS_RELEASE          Raspberry Pi OS release pin
    KITLUY_BASE_OS_IMAGE_SHA256     base image digest
    KITLUY_IMAGE_SIGNING_KEY_REF    signing key custody (BLK-005 implementation)
    KITLUY_SECURE_ELEMENT_MODEL     certified TPM 2.0 / secure-element SKU (BOM)

All four use the repository's `[REQUIRED: …]` marker so one grep finds them.
