#!/usr/bin/env bash
set -euo pipefail

XHS_MCP_DIR="${XHS_MCP_DIR:-/Users/veso/Documents/xiaohongshu-mcp}"
COMPOSE_FILE="$XHS_MCP_DIR/docker/docker-compose.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "Missing docker-compose.yml at: $COMPOSE_FILE" >&2
  exit 1
fi

docker compose -f "$COMPOSE_FILE" down
echo "xiaohongshu-mcp stopped."
