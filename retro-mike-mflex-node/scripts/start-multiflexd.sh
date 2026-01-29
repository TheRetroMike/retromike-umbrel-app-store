#!/usr/bin/env bash
set -euo pipefail

DATADIR="/root/.multiflex"
WALLET_NAME="pool"

# Support both datadir/pool and datadir/wallets/pool
if [[ -d "${DATADIR}/${WALLET_NAME}" || -d "${DATADIR}/wallets/${WALLET_NAME}" ]]; then
  echo "[mflex-node] Wallet exists -> starting with -wallet=${WALLET_NAME}"
  WALLET_ARG=("-wallet=${WALLET_NAME}")
else
  echo "[mflex-node] No wallet yet -> starting WITHOUT -wallet (wallet will be created by installer)"
  WALLET_ARG=()
fi

exec multiflexd -printtoconsole \
  -datadir="${DATADIR}" \
  -rpcport=9010 -rpcbind=0.0.0.0 -rpcallowip=0.0.0.0/0 \
  -rpcuser=pooluser -rpcpassword=poolpassword -server=1 \
  -port=24200 -bind=0.0.0.0 -externalip="$(hostname -i)" \
  -zmqpubhashblock=tcp://0.0.0.0:7010 \
  -prune=550 \
  -addresstype=legacy -changetype=legacy \
  "${WALLET_ARG[@]}"
