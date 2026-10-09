#!/usr/bin/env bash
# Starts a local Postgres and creates the dev and test databases.
# Uses Docker when available, otherwise a local PostgreSQL 16+ install.
set -euo pipefail
if docker info >/dev/null 2>&1; then
  docker compose up -d db
  exit 0
fi
if command -v pg_ctlcluster >/dev/null 2>&1; then
  pg_ctlcluster 16 main start 2>/dev/null || true
  su postgres -c "psql -tc \"SELECT 1 FROM pg_roles WHERE rolname='dwrg'\" | grep -q 1 || psql -c \"CREATE ROLE dwrg LOGIN PASSWORD 'dwrg' CREATEDB\""
  for db in dwrg_dev dwrg_test; do
    su postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='$db'\" | grep -q 1 || psql -c \"CREATE DATABASE $db OWNER dwrg\""
  done
  echo "Postgres ready: postgres://dwrg:dwrg@localhost:5432/{dwrg_dev,dwrg_test}"
else
  echo "Install Docker or PostgreSQL 16+ first." >&2
  exit 1
fi
