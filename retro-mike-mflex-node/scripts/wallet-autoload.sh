#!/usr/bin/env sh
# Wallet autoloader for MFLEX node
# - Creates wallet if missing
# - Loads wallet if not loaded
# Runs forever (so the wallet stays loaded after restarts)

RPC_USER="${RPC_USER:-pooluser}"
RPC_PASSWORD="${RPC_PASSWORD:-poolpassword}"
RPC_PORT="${RPC_PORT:-9010}"
WALLET_NAME="${WALLET_NAME:-pool}"

RPC="http://127.0.0.1:${RPC_PORT}"

rpc() {
  curl -s --connect-timeout 2 --max-time 10     --user "${RPC_USER}:${RPC_PASSWORD}"     -H 'content-type: text/plain;'     --data-binary "$1"     "${RPC}/" 2>/dev/null
}

has_wallet_loaded() {
  rpc '{"jsonrpc":"1.0","id":"lw","method":"listwallets","params":[]}'     | grep -q ""${WALLET_NAME}"" 2>/dev/null
}

echo "[wallet-autoload] ensuring wallet '${WALLET_NAME}' is created+loaded ..."

while true; do
  if has_wallet_loaded; then
    sleep 30
    continue
  fi

  # try createwallet (ignore errors if exists)
  rpc "{"jsonrpc":"1.0","id":"cw","method":"createwallet","params":["${WALLET_NAME}"]}" >/dev/null 2>&1 || true

  # try loadwallet (ignore errors if already loaded)
  rpc "{"jsonrpc":"1.0","id":"lw","method":"loadwallet","params":["${WALLET_NAME}"]}" >/dev/null 2>&1 || true

  sleep 5
done
