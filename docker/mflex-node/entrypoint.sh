#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-/data}"
CONF="${CONF:-${DATA_DIR}/multiflex.conf}"

RPC_PORT="${RPC_PORT:-9010}"
ZMQ_PORT="${ZMQ_PORT:-7010}"
P2P_PORT="${P2P_PORT:-24200}"

RPC_USER="${RPC_USER:-pooluser}"
RPC_PASSWORD="${RPC_PASSWORD:-poolpassword}"

mkdir -p "${DATA_DIR}"

# Generate a default config only if missing (user may edit later)
if [ ! -f "${CONF}" ]; then
  cat > "${CONF}" <<CFG
server=1
daemon=0
printtoconsole=1

# P2P
port=${P2P_PORT}

# RPC (MiningCore + pool-manager)
rpcbind=0.0.0.0
rpcallowip=0.0.0.0/0
rpcport=${RPC_PORT}
rpcuser=${RPC_USER}
rpcpassword=${RPC_PASSWORD}

# ZMQ
zmqpubhashblock=tcp://0.0.0.0:${ZMQ_PORT}

# prune to keep disk usage small
prune=550

# IMPORTANT: legacy addresses for pool wallets
addresstype=legacy
changetype=legacy
CFG
fi

exec multiflexd \
  -datadir="${DATA_DIR}" \
  -conf="${CONF}" \
  -printtoconsole \
  -rpcbind=0.0.0.0 -rpcallowip=0.0.0.0/0 \
  -rpcport="${RPC_PORT}" \
  -rpcuser="${RPC_USER}" -rpcpassword="${RPC_PASSWORD}" \
  -port="${P2P_PORT}" \
  -zmqpubhashblock="tcp://0.0.0.0:${ZMQ_PORT}" \
  -prune=550 \
  -addresstype=legacy -changetype=legacy
