#!/usr/bin/env bash
# Local Supabase lifecycle with environment guards. LOCAL ONLY — this script
# must never receive production credentials and refuses production-like env.
set -euo pipefail

if [[ "${KITLUY_ENV:-local}" != "local" && "${KITLUY_ENV:-local}" != "development" ]]; then
  echo "REFUSED: KITLUY_ENV='${KITLUY_ENV}' — this script only operates on local/development." >&2
  exit 1
fi
if [[ -n "${SUPABASE_DB_URL:-}" && ! "${SUPABASE_DB_URL}" =~ (localhost|127\.0\.0\.1) ]]; then
  echo "REFUSED: SUPABASE_DB_URL points at a non-local database." >&2
  exit 1
fi
if ! command -v supabase >/dev/null 2>&1; then
  echo "BLOCKED: the Supabase CLI is not installed. Install: https://supabase.com/docs/guides/local-development" >&2
  exit 3
fi

case "${1:-}" in
  start) exec supabase start ;;
  stop) exec supabase stop ;;
  reset)
    echo "Resetting LOCAL Supabase database (destructive to local dev data only)."
    exec supabase db reset ;;
  *) echo "Usage: supabase-local.sh start|stop|reset" >&2; exit 2 ;;
esac
