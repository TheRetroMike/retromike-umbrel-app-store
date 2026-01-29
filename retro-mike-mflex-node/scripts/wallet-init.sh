#!/usr/bin/env sh
set -eu

RPC_HOST="${RPC_HOST:-node}"
RPC_PORT="${RPC_PORT:-9010}"
RPC_USER="${RPC_USER:-pooluser}"
RPC_PASS="${RPC_PASS:-poolpassword}"
WALLET_NAME="${WALLET_NAME:-pool}"

WAIT_SECS="${WAIT_SECS:-120}"
SLEEP_SECS="${SLEEP_SECS:-30}"

RPC="http://${RPC_HOST}:${RPC_PORT}"
AUTH="${RPC_USER}:${RPC_PASS}"

log() { echo "[wallet-init] $*"; }

rpc() {
  method="$1"
  params="$2"
  path="${3:-/}"

  curl -sS --user "${AUTH}" \
    -H 'content-type: text/plain;' \
    --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"w\",\"method\":\"${method}\",\"params\":${params}}" \
    "${RPC}${path}" 2>/dev/null || true
}

wait_rpc() {
  i=0
  while [ "$i" -lt "$WAIT_SECS" ]; do
    out="$(rpc getblockchaininfo '[]' '/')"
    echo "$out" | grep -q '"error":null' && return 0
    i=$((i+1))
    sleep 1
  done
  return 1
}

ensure_wallet_loaded() {
  # createwallet/loadwallet müssen am Root-Endpoint passieren
  rpc createwallet "[\"${WALLET_NAME}\"]" "/" >/dev/null 2>&1 || true
  rpc loadwallet   "[\"${WALLET_NAME}\"]" "/" >/dev/null 2>&1 || true

  out="$(rpc listwallets '[]' '/')"
  echo "$out" | grep -q "\"${WALLET_NAME}\""
}

log "Starting wallet watchdog: wallet='${WALLET_NAME}' rpc='${RPC_HOST}:${RPC_PORT}'"
last_state="unknown"

while true; do
  if wait_rpc; then
    if ensure_wallet_loaded; then
      if [ "$last_state" != "loaded" ]; then
        log "OK: wallet '${WALLET_NAME}' is loaded"
        last_state="loaded"
      fi
    else
      if [ "$last_state" != "not_loaded" ]; then
        log "WARN: wallet '${WALLET_NAME}' not loaded yet (will retry)"
        last_state="not_loaded"
      fi
    fi
  else
    if [ "$last_state" != "rpc_down" ]; then
      log "WARN: RPC not ready yet (will retry)"
      last_state="rpc_down"
    fi
  fi

  sleep "$SLEEP_SECS"
done
