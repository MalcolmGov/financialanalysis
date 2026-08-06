#!/usr/bin/env bash
# Apply the Drizzle migrations to the Railway Postgres over its PUBLIC TCP proxy.
#
# Prereqs:
#   • railway CLI logged in and linked to the results-studio project + Postgres
#     service  (railway link -p <project> -e <env> -s <postgres-service>)
#   • The Postgres service has a public TCP proxy enabled, so the Railway var
#     DATABASE_PUBLIC_URL resolves to a host like *.proxy.rlwy.net:PORT
#   • psql on PATH
#
# The connection string is read straight into a local variable and is never
# echoed. Safe to re-run only against a fresh database (initial push).
set -euo pipefail
cd "$(dirname "$0")/.."

SVC="${RAILWAY_PG_SERVICE:-Postgres}"
URL="$(railway variables --service "$SVC" --json | jq -r '.DATABASE_PUBLIC_URL // empty')"

if [ -z "$URL" ] || printf '%s' "$URL" | grep -q '@:'; then
  echo "DATABASE_PUBLIC_URL is missing or unresolved (proxy host/port empty)." >&2
  echo "Enable the public TCP proxy on the Postgres service, then retry:" >&2
  echo "  Railway dashboard → Postgres → Settings → Networking → Public Networking → TCP Proxy (port 5432)" >&2
  exit 1
fi

for f in drizzle/0000_init.sql drizzle/0001_blueprint_immutability.sql; do
  echo "Applying $f …"
  psql "$URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

echo -n "Tables in public schema: "
psql "$URL" -At -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
