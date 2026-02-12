#!/usr/bin/env bash
set -euo pipefail

cd /repo

<<<<<<< HEAD
export CLAWDBOT_STATE_DIR="/tmp/verso-test"
export CLAWDBOT_CONFIG_PATH="${CLAWDBOT_STATE_DIR}/verso.json"
=======
export OPENCLAW_STATE_DIR="/tmp/openclaw-test"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_STATE_DIR}/openclaw.json"

echo "==> Build"
pnpm build
>>>>>>> upstream/main

echo "==> Seed state"
mkdir -p "${OPENCLAW_STATE_DIR}/credentials"
mkdir -p "${OPENCLAW_STATE_DIR}/agents/main/sessions"
echo '{}' >"${OPENCLAW_CONFIG_PATH}"
echo 'creds' >"${OPENCLAW_STATE_DIR}/credentials/marker.txt"
echo 'session' >"${OPENCLAW_STATE_DIR}/agents/main/sessions/sessions.json"

echo "==> Reset (config+creds+sessions)"
pnpm verso reset --scope config+creds+sessions --yes --non-interactive

test ! -f "${OPENCLAW_CONFIG_PATH}"
test ! -d "${OPENCLAW_STATE_DIR}/credentials"
test ! -d "${OPENCLAW_STATE_DIR}/agents/main/sessions"

echo "==> Recreate minimal config"
mkdir -p "${OPENCLAW_STATE_DIR}/credentials"
echo '{}' >"${OPENCLAW_CONFIG_PATH}"

echo "==> Uninstall (state only)"
pnpm verso uninstall --state --yes --non-interactive

test ! -d "${OPENCLAW_STATE_DIR}"

echo "OK"
