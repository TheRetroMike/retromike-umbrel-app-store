#!/bin/sh

RPC_PORT="${RPC_PORT:-9010}"
RPC_USER="${RPC_USER:-pooluser}"
RPC_PASS="${RPC_PASS:-poolpassword}"
WALLET_NAME="${WALLET_NAME:-pool}"
WAIT_SECS="${WAIT_SECS:-180}"
SLEEP_SECS="${SLEEP_SECS:-30}"

RPC="http://127.0.0.1:${RPC_PORT}"

rpc() {
  # $1 json payload, $2 path (optional)
  _payload="$1"
  _path="${2:-/}"
  curl -sS --user "${RPC_USER}:${RPC_PASS}" \
    -H 'content-type: text/plain;' \
    --data-binary "${_payload}" \
    "${RPC}${_path}" 2>/dev/null
}

echo "[wallet-autoload] waiting for RPC on ${RPC} ..."
i=0
while [ "$i" -lt "$WAIT_SECS" ]; do
  out="$(rpc '{"jsonrpc":"1.0","id":"t","method":"getblockchaininfo","params":[]}' '/')"
  echo "$out" | grep -q '"error":null' && break
  i=$((i+1))
  sleep 1
done

echo "[wallet-autoload] ensuring wallet '${WALLET_NAME}' exists & is loaded (loop every ${SLEEP_SECS}s)"

while true; do
  # createwallet/loadwallet laufen am Root-Endpoint
  rpc "{\"jsonrpc\":\"1.0\",\"id\":\"cw\",\"method\":\"createwallet\",\"params\":[\"${WALLET_NAME}\"]}" "/" >/dev/null || true
  rpc "{\"jsonrpc\":\"1.0\",\"id\":\"lw\",\"method\":\"loadwallet\",\"params\":[\"${WALLET_NAME}\"]}" "/" >/dev/null || true
  sleep "$SLEEP_SECS"
done
