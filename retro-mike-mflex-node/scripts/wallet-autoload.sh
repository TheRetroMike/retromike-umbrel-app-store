#!/bin/sh
set -eu

RPC_HOST="${RPC_HOST:-127.0.0.1}"
RPC_PORT="${RPC_PORT:-9010}"
RPC_USER="${RPC_USER:-pooluser}"
RPC_PASS="${RPC_PASS:-poolpassword}"
WALLET_NAME="${WALLET_NAME:-pool}"

rpc() {
  curl -sS --user "${RPC_USER}:${RPC_PASS}" \
    -H 'content-type: text/plain;' \
    --data-binary "$1" \
    "http://${RPC_HOST}:${RPC_PORT}/" || true
}

log() { echo "[wallet-autoload] $*"; }

log "starting (rpc=${RPC_HOST}:${RPC_PORT} wallet=${WALLET_NAME})"

while true; do
  # wait for daemon RPC
  out="$(rpc '{"jsonrpc":"1.0","id":"t","method":"getblockchaininfo","params":[]}')"
  echo "$out" | grep -q '"error":null' || { sleep 2; continue; }

  # already loaded?
  lw="$(rpc '{"jsonrpc":"1.0","id":"lw","method":"listwallets","params":[]}')"
  if echo "$lw" | grep -q "\"${WALLET_NAME}\""; then
    sleep 20
    continue
  fi

  log "wallet not loaded -> create/load: ${WALLET_NAME}"

  # create if missing (ignore errors)
  rpc "{\"jsonrpc\":\"1.0\",\"id\":\"cw\",\"method\":\"createwallet\",\"params\":[\"${WALLET_NAME}\"]}" >/dev/null 2>&1 || true
  # load (ignore errors)
  rpc "{\"jsonrpc\":\"1.0\",\"id\":\"lw\",\"method\":\"loadwallet\",\"params\":[\"${WALLET_NAME}\"]}"   >/dev/null 2>&1 || true

  sleep 3
done
