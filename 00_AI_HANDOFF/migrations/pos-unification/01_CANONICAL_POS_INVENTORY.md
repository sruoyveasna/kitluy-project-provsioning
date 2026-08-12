# Canonical POS Inventory — `apps/kitluy-pos-desktop-app`

**Filename:** `01_CANONICAL_POS_INVENTORY.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** EVIDENCE · **Authority:** IMPLEMENTATION-EVIDENCE · **Evidence status:** OBSERVED

## 1. Source (2,057 lines of TypeScript, excluding build output)

```text
electron/
├── main.ts                73 lines   window + lifecycle
├── t1-runtime.ts         388 lines   Hub bootstrap orchestration
├── terminal-identity.ts  308 lines   atomic protected identity writer
├── intake-ipc.ts         307 lines   narrow IPC surface (WS-12-T002)
├── mdns.ts               285 lines   _kitluy-edge._tcp.local, locked endpoint order
├── t1-intake-client.ts   203 lines   intake adapter
├── lan-client.ts         143 lines   mTLS /edge/v1 transport
└── terminal-store.ts      97 lines   encrypted SQLite, OS-wrapped key
src/
├── App.tsx / main.tsx / bootstrap-view.tsx
└── bootstrap/  ports.ts · machine.ts · states.ts · hub-time.ts · bridge-types.ts
```

## 2. Architecture — Hub-mediated by construction

| Property                    | Value                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase clients in the app | **0**                                                                                                                                         |
| Data path                   | terminal → mTLS `/edge/v1` → Store Hub                                                                                                        |
| Authority time              | Hub **database** transaction, never the host clock                                                                                            |
| Configuration               | Hub-attested **signed** envelope, cached encrypted                                                                                            |
| Terminal identity           | atomic protected writer; **user cannot select or override**                                                                                   |
| Key custody                 | `safeStorage` (DPAPI / Keychain / secret service); only the wrapped key on disk; refuses to start rather than fall back to an unprotected key |
| Discovery                   | mDNS with a locked six-source endpoint order, order-exact test-pinned                                                                         |

## 3. Authoritative configuration envelope

`ConfigurationDeliveryEnvelopeWire` carries `snapshotId`, `configurationVersion`,
`schemaVersion`, `tenantId`, `digitalStoreId`, `storeLocationId`, `environment`,
`hubDeviceId`, `terminalDeviceId`, `assignmentGeneration`, **`terminalProfileCode`**,
version bounds, validity window, hashes, `signingKeyId`, `correlationId`.

> **Recorded gap.** The envelope carries **no explicit vertical field**. The
> vertical is therefore derived from the Hub-signed `terminalProfileCode` prefix
> — see `06_POS_CONSOLIDATION_ARCHITECTURE.md`.

## 4. Tests (before this mission)

8 files, 58 passing + 1 skipped: `t1-bootstrap.acceptance` (24),
`t002-intake-machine` (10), `terminal-identity` (8), `hub-time` (6), `mdns` (5),
`t1-endpoint-order` (3), `smoke` (2); `t1-startup.e2e.integration` skips when the
local Hub database is unreachable.

## 5. Assessment

Not an empty scaffold — a **thin but architecturally correct** shell with real
WS-12 T001/T002 work. It is the architectural inverse of both donors, and per
owner decision §5 it is the canonical base.

**What it lacked:** any vertical-awareness. There was no way for one installed
application to become the correct terminal for a Digital Store's primary
vertical. That gap is what this mission closed.
