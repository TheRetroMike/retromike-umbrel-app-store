#!/usr/bin/env bash
set -euo pipefail

# Central pool fragment manager for MiningCore on Umbrel.
#
# Usage:
#   pool-manager.sh register-bitcoin \ 
#     --pool-id btc --coin bitcoin --app-id retro-mike-btc-node \ 
#     --rpc-port 9004 --zmq-port 7004 --stratum-port 6004 \ 
#     --daemon-host retro-mike-btc-node_node_1
#
#   pool-manager.sh unregister --pool-id btc
#
# For XMR (CryptoNote), use:
#   pool-manager.sh register-xmr \
#     --pool-id xmr --coin monero --app-id retro-mike-xmr-wallet \
#     --stratum-port 6009 \
#     --node-host retro-mike-xmr-node_node_1 --node-rpc-port 9009 \
#     --wallet-rpc-port 18082 --wallet-host retro-mike-xmr-wallet_wallet_1

MC_HOME="/home/umbrel/.miningcore"
POOLS_DIR="${MC_HOME}/pools.d"
MININGCORE_APP_ID="retro-mike-miningcore"
MININGCORE_APP_DATA_DIR="/home/umbrel/umbrel/app-data/${MININGCORE_APP_ID}"
RENDER_SCRIPT="${MININGCORE_APP_DATA_DIR}/scripts/render-config.py"

RPC_USER="pooluser"
RPC_PASS="poolpassword"

log() {
  echo "[pool-manager] $*"
}

die() {
  echo "[pool-manager] ERROR: $*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

py() {
  # Executes python with stdin support. Uses host python3 if available, otherwise a short-lived python container.
  if have python3; then
    python3 "$@"
  else
    docker run --rm -i python:3.12-alpine python "$@"
  fi
}

json_get_result() {
  # Reads a JSON-RPC response from stdin and prints .result or empty.
  py -c 'import sys, json; d=json.load(sys.stdin); print(d.get("result") if isinstance(d, dict) else "")'
}

rpc_call() {
  local rpc_port="$1"; shift
  local method="$1"; shift
  local params="${1:-[]}"; shift || true

  curl -sS --user "${RPC_USER}:${RPC_PASS}" \
    -H 'content-type: text/plain;' \
    --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"umbrel\",\"method\":\"${method}\",\"params\":${params}}" \
    "http://127.0.0.1:${rpc_port}/" \
    || true
}

wait_for_rpc() {
  local rpc_port="$1"
  for _i in $(seq 1 120); do
    local out
    out=$(rpc_call "${rpc_port}" getblockchaininfo '[]')
    if [ -n "${out}" ] && echo "${out}" | py -c 'import sys,json; 
import sys
try:
  d=json.load(sys.stdin)
  sys.exit(0 if d.get("error") is None else 1)
except Exception:
  sys.exit(1)
' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

restart_miningcore() {
  # Restart the MiningCore server container so it reloads config.
  local cid
  cid=$(docker ps -q --filter "label=com.docker.compose.project=${MININGCORE_APP_ID}" --filter "label=com.docker.compose.service=server" | head -n 1 || true)
  if [ -n "${cid}" ]; then
    log "Restarting MiningCore container ${cid}"
    docker restart "${cid}" >/dev/null
  else
    log "WARN: MiningCore container not running; nothing to restart"
  fi
}

render_config() {
  if [ ! -x "${RENDER_SCRIPT}" ]; then
    log "WARN: render script not found at ${RENDER_SCRIPT}"
    return 0
  fi

  export MININGCORE_HOME="${MC_HOME}"

  if have python3; then
    python3 "${RENDER_SCRIPT}" >/dev/null 2>&1 || true
  else
    docker run --rm \
      -v "${MC_HOME}":/work \
      -v "${MININGCORE_APP_DATA_DIR}/scripts":/scripts:ro \
      -w /work \
      python:3.12-alpine \
      python "/scripts/render-config.py" >/dev/null 2>&1 || true
  fi
}

write_fragment() {
  local pool_id="$1"; shift
  local tmp
  tmp=$(mktemp)
  cat > "${tmp}"
  mkdir -p "${POOLS_DIR}"
  mv "${tmp}" "${POOLS_DIR}/${pool_id}.json"
}

cmd_register_bitcoin() {
  local pool_id="" coin="" app_id="" rpc_port="" zmq_port="" stratum_port="" daemon_host=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --pool-id) pool_id="$2"; shift 2;;
      --coin) coin="$2"; shift 2;;
      --app-id) app_id="$2"; shift 2;;
      --rpc-port) rpc_port="$2"; shift 2;;
      --zmq-port) zmq_port="$2"; shift 2;;
      --stratum-port) stratum_port="$2"; shift 2;;
      --daemon-host) daemon_host="$2"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done

  [ -n "${pool_id}" ] || die "--pool-id missing"
  [ -n "${coin}" ] || die "--coin missing"
  [ -n "${app_id}" ] || die "--app-id missing"
  [ -n "${rpc_port}" ] || die "--rpc-port missing"
  [ -n "${zmq_port}" ] || die "--zmq-port missing"
  [ -n "${stratum_port}" ] || die "--stratum-port missing"
  [ -n "${daemon_host}" ] || die "--daemon-host missing"

  mkdir -p "${POOLS_DIR}"

  local frag_path="${POOLS_DIR}/${pool_id}.json"
  if [ -f "${frag_path}" ]; then
    log "Pool fragment already exists: ${frag_path} (skip)"
    render_config
    restart_miningcore
    exit 0
  fi

  log "Waiting for RPC on 127.0.0.1:${rpc_port} ..."
  if ! wait_for_rpc "${rpc_port}"; then
    die "RPC not ready on port ${rpc_port}"
  fi

  # Ensure wallet exists (best effort). Some nodes may not support this RPC; ignore errors.
  rpc_call "${rpc_port}" createwallet '["default", false, false, "", false, false]' >/dev/null 2>&1 || true

  local addr
  addr=$(rpc_call "${rpc_port}" getnewaddress '[]' | json_get_result)
  if [ -z "${addr}" ] || [ "${addr}" = "null" ]; then
    die "Could not obtain pool address via getnewaddress"
  fi

  log "Got pool address: ${addr}"

  write_fragment "${pool_id}" <<JSON
{
  "id": "${pool_id}",
  "enabled": true,
  "coin": "${coin}",
  "address": "${addr}",
  "enableAsicBoost": true,
  "blockRefreshInterval": 0,
  "jobRebroadcastTimeout": 10,
  "clientConnectionTimeout": 600,
  "banning": {
    "enabled": true,
    "time": 600,
    "invalidPercent": 50,
    "checkThreshold": 50
  },
  "ports": {
    "${stratum_port}": {
      "name": "General",
      "listenAddress": "0.0.0.0",
      "difficulty": 1024,
      "varDiff": {
        "minDiff": 1,
        "targetTime": 15,
        "retargetTime": 90,
        "variancePercent": 30
      }
    }
  },
  "daemons": [
    {
      "host": "${daemon_host}",
      "port": ${rpc_port},
      "user": "${RPC_USER}",
      "password": "${RPC_PASS}",
      "zmqBlockNotifySocket": "tcp://${daemon_host}:${zmq_port}"
    }
  ],
  "paymentProcessing": {
    "enabled": true,
    "minimumPayment": 0.001,
    "payoutScheme": "SOLO",
    "payoutSchemeConfig": {
      "factor": 2
    }
  },
  "_umbrel": {
    "appId": "${app_id}",
    "rpcPort": ${rpc_port},
    "zmqPort": ${zmq_port},
    "stratumPort": ${stratum_port}
  }
}
JSON

  chown -R 1000:1000 "${MC_HOME}" || true

  render_config
  restart_miningcore
  log "Registered ${pool_id} (${coin})"
}

cmd_register_xmr() {
  local pool_id="" coin="" app_id="" stratum_port="" node_host="" node_rpc_port="" wallet_host="" wallet_rpc_port=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --pool-id) pool_id="$2"; shift 2;;
      --coin) coin="$2"; shift 2;;
      --app-id) app_id="$2"; shift 2;;
      --stratum-port) stratum_port="$2"; shift 2;;
      --node-host) node_host="$2"; shift 2;;
      --node-rpc-port) node_rpc_port="$2"; shift 2;;
      --wallet-host) wallet_host="$2"; shift 2;;
      --wallet-rpc-port) wallet_rpc_port="$2"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done

  [ -n "${pool_id}" ] || die "--pool-id missing"
  [ -n "${coin}" ] || die "--coin missing"
  [ -n "${app_id}" ] || die "--app-id missing"
  [ -n "${stratum_port}" ] || die "--stratum-port missing"
  [ -n "${node_host}" ] || die "--node-host missing"
  [ -n "${node_rpc_port}" ] || die "--node-rpc-port missing"
  [ -n "${wallet_host}" ] || die "--wallet-host missing"
  [ -n "${wallet_rpc_port}" ] || die "--wallet-rpc-port missing"

  mkdir -p "${POOLS_DIR}"
  local frag_path="${POOLS_DIR}/${pool_id}.json"
  if [ -f "${frag_path}" ]; then
    log "Pool fragment already exists: ${frag_path} (skip)"
    render_config
    restart_miningcore
    exit 0
  fi

  log "Waiting for Monero wallet RPC on 127.0.0.1:${wallet_rpc_port} ..."
  for _i in $(seq 1 120); do
    if curl -sS "http://127.0.0.1:${wallet_rpc_port}/json_rpc" -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":"0","method":"get_address","params":{"account_index":0}}' >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  local addr
  addr=$(curl -sS "http://127.0.0.1:${wallet_rpc_port}/json_rpc" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":"0","method":"get_address","params":{"account_index":0}}' \
    | py -c 'import sys,json; d=json.load(sys.stdin); 
res=d.get("result",{}); addrs=res.get("addresses") or []; 
print(addrs[0].get("address") if addrs else "")'
  )

  if [ -z "${addr}" ]; then
    die "Could not obtain Monero address from wallet RPC"
  fi

  log "Got XMR pool address: ${addr}"

  write_fragment "${pool_id}" <<JSON
{
  "id": "${pool_id}",
  "enabled": true,
  "coin": "${coin}",
  "randomXRealm": "${pool_id}",
  "address": "${addr}",
  "blockRefreshInterval": 500,
  "clientConnectionTimeout": 600,
  "banning": {
    "enabled": true,
    "time": 600,
    "invalidPercent": 50,
    "checkThreshold": 50
  },
  "ports": {
    "${stratum_port}": {
      "name": "RandomX",
      "listenAddress": "0.0.0.0",
      "difficulty": 7500,
      "varDiff": {
        "minDiff": 100,
        "maxDiff": 200000,
        "targetTime": 15,
        "retargetTime": 90,
        "variancePercent": 30
      }
    }
  },
  "daemons": [
    {
      "host": "${node_host}",
      "port": ${node_rpc_port},
      "user": "${RPC_USER}",
      "password": "${RPC_PASS}"
    },
    {
      "host": "${wallet_host}",
      "port": ${wallet_rpc_port},
      "user": "${RPC_USER}",
      "password": "${RPC_PASS}",
      "category": "wallet"
    }
  ],
  "paymentProcessing": {
    "enabled": true,
    "minimumPayment": 0.25,
    "payoutScheme": "SOLO",
    "payoutSchemeConfig": {
      "factor": 2
    }
  },
  "_umbrel": {
    "appId": "${app_id}",
    "stratumPort": ${stratum_port}
  }
}
JSON

  chown -R 1000:1000 "${MC_HOME}" || true
  render_config
  restart_miningcore
  log "Registered ${pool_id} (${coin})"
}

cmd_unregister() {
  local pool_id=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --pool-id) pool_id="$2"; shift 2;;
      *) die "Unknown arg: $1";;
    esac
  done
  [ -n "${pool_id}" ] || die "--pool-id missing"

  local frag_path="${POOLS_DIR}/${pool_id}.json"
  if [ -f "${frag_path}" ]; then
    rm -f "${frag_path}"
    log "Removed ${frag_path}"
  else
    log "No fragment to remove for ${pool_id}"
  fi

  render_config
  restart_miningcore
}

main() {
  local cmd="${1:-}"
  shift || true
  case "${cmd}" in
    register-bitcoin) cmd_register_bitcoin "$@";;
    register-xmr) cmd_register_xmr "$@";;
    unregister) cmd_unregister "$@";;
    *)
      cat <<EOF
Usage:
  $0 register-bitcoin --pool-id <id> --coin <coinKey> --app-id <umbrelAppId> \
     --rpc-port <900x> --zmq-port <700x> --stratum-port <600x> --daemon-host <containerName>

  $0 register-xmr --pool-id xmr --coin monero --app-id retro-mike-xmr-wallet \
     --stratum-port <600x> --node-host <containerName> --node-rpc-port <9009> \
     --wallet-host <containerName> --wallet-rpc-port <18082>

  $0 unregister --pool-id <id>
EOF
      exit 1
      ;;
  esac
}

main "$@"
