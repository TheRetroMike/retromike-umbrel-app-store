#!/usr/bin/env bash
set -euo pipefail

MOUNT='      - /home/umbrel/.miningcore/wallet-backups:/backups'

for f in retro-mike-*-node/docker-compose.yml; do
  [ -f "$f" ] || continue
  # skip if already present
  if grep -q "/home/umbrel/.miningcore/wallet-backups:/backups" "$f"; then
    echo "OK (already): $f"
    continue
  fi

  # only patch if there is a "node:" service
  if ! grep -qE '^[[:space:]]*node:[[:space:]]*$' "$f"; then
    echo "SKIP (no node service): $f"
    continue
  fi

  # insert mount after the first volumes: under node:
  awk -v mount="$MOUNT" '
    BEGIN{in_node=0; inserted=0}
    /^[[:space:]]*node:[[:space:]]*$/ {in_node=1; print; next}
    in_node && /^[[:space:]]*[a-zA-Z0-9_]+:[[:space:]]*$/ { # next service starts
      in_node=0; print; next
    }
    in_node && !inserted && /^[[:space:]]*volumes:[[:space:]]*$/ {
      print
      print mount
      inserted=1
      next
    }
    {print}
  ' "$f" > "${f}.tmp" && mv "${f}.tmp" "$f"

  echo "PATCHED: $f"
done
