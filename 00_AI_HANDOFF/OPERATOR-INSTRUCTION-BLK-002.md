# Operator instruction — unblock local database execution (BLK-002)

Status: BLOCKED-INTERACTIVE-INSTALL (verified 2026-07-26: docker, colima,
orb, supabase CLI and Homebrew are ALL absent; macOS 26.5.2 arm64; no
non-interactive install path without sudo/GUI approval).

To unblock, run interactively (owner/operator, not the agent):

1. Install Homebrew (interactive; requires sudo): https://brew.sh
2. `brew install colima docker supabase/tap/supabase` (Colima = CLI-only
   container runtime, no GUI approval needed; Docker Desktop also acceptable)
3. `colima start` then verify: `docker version && supabase --version`
4. Tell the agent to re-run Cycle 3 §14 (the executable test sequence).

Until then: migrations/RLS/seeds/assertions are authored + reviewed as
SCAFFOLDED; every execution command reports BLOCKED-NOT-EXECUTED honestly.
