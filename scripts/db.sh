#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DB_SERVICE="${DB_SERVICE:-postgres}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-bags_rewards}"

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if ! docker compose ps --status running "$DB_SERVICE" >/dev/null 2>&1; then
  echo "Starting ${DB_SERVICE} service..."
  docker compose up -d "$DB_SERVICE" >/dev/null
fi

exec docker compose exec "$DB_SERVICE" psql -U "$DB_USER" -d "$DB_NAME" "$@"
