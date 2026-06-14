#!/usr/bin/env bash
# RevenueTwin deploy (S70): race-free, health-gated. Requires a .env file (see .env.example).
set -euo pipefail

cd "$(dirname "$0")"

# 1. Refuse to deploy without a .env (fail-closed on secrets).
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and set real secrets." >&2
  exit 1
fi

# 2. Refuse the default placeholder password.
if grep -q "CHANGE_ME_STRONG_RANDOM" .env; then
  echo "ERROR: .env still contains the placeholder password. Set a real POSTGRES_PASSWORD." >&2
  exit 1
fi

# 3. Build + start (compose reads .env automatically).
echo "Building and starting RevenueTwin..."
docker compose up -d --build

# 4. Health-gate: wait for the API to report healthy before declaring success.
PORT=$(grep API_PORT= .env | head -n1 | cut -d= -f2)
PORT="${PORT:-8787}"
URL="http://127.0.0.1:${PORT}/api/health"
echo "Waiting for ${URL} ..."
for i in $(seq 1 30); do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "RevenueTwin is healthy at ${URL}"
    exit 0
  fi
  sleep 2
done

echo "ERROR: API did not become healthy in time. Recent logs:" >&2
docker compose logs --tail=40 api >&2 || true
exit 1
