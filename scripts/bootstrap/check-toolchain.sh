#!/usr/bin/env bash
# Reports the local toolchain against repository requirements. Read-only.
set -uo pipefail
echo "Node (need >=22.12 <23):   $(node -v 2>/dev/null || echo MISSING)"
echo "pnpm (need >=9.15):        $(pnpm -v 2>/dev/null || echo MISSING — enable via: corepack enable pnpm)"
echo "git:                       $(git --version 2>/dev/null || echo MISSING)"
echo "supabase CLI (optional):   $(supabase --version 2>/dev/null | head -1 || echo MISSING — needed for local DB + RLS tests)"
echo "docker (optional):         $(docker --version 2>/dev/null || echo MISSING — needed for supabase start + container builds)"
echo "terraform (optional):      $(terraform --version 2>/dev/null | head -1 || echo MISSING — needed for infra fmt/validate)"
