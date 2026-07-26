# kitluy-pos-desktop-app

POS Desktop — Electron + React + TypeScript targeting Linux ARM64 (Raspberry
Pi OS 64-bit). One product implementing the owner-locked T1–T4 terminal
profiles through the Store Hub (POS spec v4.0.0; KLV4-DEC-005).

**Status:** SCAFFOLDED — branded renderer shell (fails closed: no device
assignment contract yet, every profile locked) + hardened Electron main
process scaffold. **No business functionality is implemented.**

## Rules

- Normal Store operations flow POS → Store Hub LAN API → local PostgreSQL →
  async cloud sync. Direct Supabase writes are prohibited.
- T3 and T4 may share hardware but remain separate modes, permissions,
  sessions, state machines and audit events.
- The electron binary download is skipped repository-wide
  (`pnpm.neverBuiltDependencies`) — see ADR-0004 for how to run the shell.
