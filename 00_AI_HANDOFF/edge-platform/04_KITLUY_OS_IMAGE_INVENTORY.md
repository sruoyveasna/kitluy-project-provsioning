# `kitluy-os-image` inventory (baseline)

**Date:** 2026-08-07

## 1. Baseline at intake

One file, seven lines: `infra/kitluy-os-image/README.md`.

It specified the target — Raspberry Pi OS 64-bit, KitLuy-signed boot chain,
dm-verity read-only system partition, encrypted data partition, A/B slots
(Hub spec §6.8) — and recorded three `[REQUIRED]` blockers: Pi OS release pin,
signing key custody, secure-element model.

There was no build system, no configuration, no overlay, no firstboot service,
no enrollment agent and no test.

> The README carried an unrelated uncommitted modification at intake. It was
> **preserved untouched**; this mission added files alongside it and did not
> edit it.

## 2. Authority consulted before building

| Source                            | What it fixed                                                    |
| --------------------------------- | ---------------------------------------------------------------- |
| `infra/kitluy-os-image/README.md` | partition model, boot chain, the three blockers                  |
| `000_ACTIVE_PHASE.md` §10         | the locked provisioning chain; BLK-005 allowed/blocked lists     |
| `000_ACTIVE_PHASE.md` §2          | T1–T4 terminal roles and hard boundaries                         |
| `KLD-2026-07-28-002`              | PKI hierarchy, signing purposes, trusted time, replacement       |
| `@kitluy/device-identity`         | THE IDENTITY RULE; the fail-closed provider default              |
| `kitluy-hub-agent`                | `_kitluy-edge._tcp.local`, `/edge/v1`, TLS 1.3                   |
| WS-11-T006 close record           | A/B install, health gate (5 min / 20 s / 3 probes), one rollback |
| CLAUDE.md hard rule 6             | terminals never write directly to Supabase                       |

No new platform was invented. The build system implements the approach the
existing specification already fixed.

## 3. What the two profiles must not share

The most consequential structural decision, and the one the test suite pins:

|                     | STORE_HUB                                                                       | PI_TERMINAL          |
| ------------------- | ------------------------------------------------------------------------------- | -------------------- |
| Local PostgreSQL    | yes (NVMe)                                                                      | **no**               |
| Hub agent / LAN API | yes                                                                             | **must not have it** |
| Kiosk runtime       | **must not have it** (headless)                                                 | yes (Electron)       |
| mDNS                | advertises                                                                      | listens              |
| Shared base         | firstboot, enrollment agent, health reporter, update agent, hardening, journald | identical            |

A terminal that shipped the Hub agent would be able to act as local Store
authority, and a Hub that shipped a kiosk would put a POS surface on the
appliance that owns the database. Both are asserted negatively in
`test/build-gates.test.sh`.

## 4. What the image must never contain

- Any secret at all — images are **zero-secret by construction**.
- A service-role key or any private key (build-time gate + test).
- A terminal profile, Tenant, Digital Store, Location or Hub endpoint. All of
  these are delivered by governed configuration **after** cloud-authorised
  assignment. Baking any of them would make the image a source of assignment
  truth, which the locked provisioning chain forbids (build-time test).
- A local database DSN — that is a credential in an image.

See `11_KITLUY_OS_IMAGE_IMPLEMENTATION.md` for what was built and what is still
blocked.
