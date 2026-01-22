#!/usr/bin/env bash
set -euo pipefail

# Pool Manager
# - Creates/updates per-coin pool fragments in /home/umbrel/.miningcore/pools.d/
# - Renders a single /home/umbrel/.miningcore/config.json from base template + fragments
# - Optionally restarts Miningcore to apply config

APP_DATA_DIR="/home/umbrel/.miningcore"
POOLS_DIR="${APP_DATA_DIR}/pools.d"
RENDER_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER_SCRIPT="${RENDER_SCRIPT_DIR}/render-config.py"

# Umbrel's Miningcore container name (app-id + service + index)
MININGCORE_CONTAINER_NAME="retro-mike-miningcore_server_1"

log() {
  echo "[pool-manager] $*" >&2
}

die() {
  echo "[pool-manager] ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

ensure_dirs() {
  mkdir -p "${APP_DATA_DIR}" "${POOLS_DIR}"
}

json_get_result() {
  # Reads JSON from stdin, extracts .result (raw)
  python3 - <<'PY'
import sys, json
data=json.load(sys.stdin)
print(data.get("result",""))
PY
}

rpc_call() {
  local rpc_port="$1"
  local method="$2"
  local params_json="${3:-[]}"

  # NOTE: we call RPC via host-mapped ports (127.0.0.1:<rpc_port>)
  curl -sS --fail \
    -H 'content-type: text/plain;' \
    --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"pool-manager\",\"method\":\"${method}\",\"params\":${params_json}}" \
    "http://127.0.0.1:${rpc_port}/" || return 1
}

wait_for_rpc() {
  local rpc_port="$1"
  local tries="${2:-60}"
  local i=0
  while (( i < tries )); do
    if rpc_call "${rpc_port}" getblockchaininfo '[]' >/dev/null 2>&1; then
      return 0
    fi
    i=$((i+1))
    sleep 2
  done
  return 1
}

render_config() {
  require_cmd python3
  if [[ ! -f "${RENDER_SCRIPT}" ]]; then
    die "render-config.py not found at ${RENDER_SCRIPT}"
  fi
  python3 "${RENDER_SCRIPT}"
}

restart_miningcore_if_running() {
  # Restart is the simplest way to apply updated config.json
  if sudo docker ps --format '{{.Names}}' | grep -q "^${MININGCORE_CONTAINER_NAME}$"; then
    log "Restarting Miningcore (${MININGCORE_CONTAINER_NAME}) to apply config changes..."
    sudo docker restart "${MININGCORE_CONTAINER_NAME}" >/dev/null
  else
    log "Miningcore container not running; no restart performed."
  fi
}

cmd_register_bitcoin() {
  # Required args
  local pool_id="" coin="" app_id="" rpc_port="" zmq_port="" stratum_port="" daemon_host=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pool-id) pool_id="$2"; shift 2 ;;
      --coin) coin="$2"; shift 2 ;;
      --app-id) app_id="$2"; shift 2 ;;
      --rpc-port) rpc_port="$2"; shift 2 ;;
      --zmq-port) zmq_port="$2"; shift 2 ;;
      --stratum-port) stratum_port="$2"; shift 2 ;;
      --daemon-host) daemon_host="$2"; shift 2 ;;
      *) break ;;
    esac
  done

  [[ -n "${pool_id}" && -n "${coin}" && -n "${app_id}" && -n "${rpc_port}" && -n "${zmq_port}" && -n "${stratum_port}" && -n "${daemon_host}" ]] \
    || die "Missing required args for register-bitcoin"

  # Optional args
  local address_type=""
  local getnewaddress_params='[]'
  local mflex_enabled="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --address-type) address_type="$2"; shift 2 ;;
      --getnewaddress-params) getnewaddress_params="$2"; shift 2 ;;
      --mflex-enabled) mflex_enabled="true"; shift 1 ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  require_cmd curl
  ensure_dirs

  log "Waiting for RPC on port ${rpc_port} (${app_id})..."
  if ! wait_for_rpc "${rpc_port}" 120; then
    die "RPC not responding on port ${rpc_port}. Is ${app_id} running?"
  fi

  # Ensure wallet exists (idempotent)
  rpc_call "${rpc_port}" createwallet '["pool", true, true, "", false, false]' >/dev/null 2>&1 || true

  # Create a pool address
  local pool_address
  pool_address="$(rpc_call "${rpc_port}" getnewaddress "${getnewaddress_params}" 2>/dev/null | json_get_result || true)"
  if [[ -z "${pool_address}" || "${pool_address}" == "null" ]]; then
    log "getnewaddress with params ${getnewaddress_params} failed; falling back to []"
    pool_address="$(rpc_call "${rpc_port}" getnewaddress '[]' | json_get_result)"
  fi

  [[ -n "${pool_address}" ]] || die "Failed to obtain pool address from ${app_id} RPC"

  # Build optional JSON snippets for pool fragment
  local ADDRTYPE_JSON=""
  if [[ -n "${address_type}" ]]; then
    ADDRTYPE_JSON="  \"addressType\": \"${address_type}\","$'\n'
  fi

  local MFLEX_JSON=""
  if [[ "${mflex_enabled}" == "true" ]]; then
    # Must live inside the pool object (picked up via JsonExtensionData / pc.Extra)
    MFLEX_JSON="  \"mflex\": { \"enabled\": true },"$'\n'
  fi

  local pool_file="${POOLS_DIR}/${pool_id}.json"

  cat > "${pool_file}.tmp" <<JSON
{
  "id": "${pool_id}",
  "enabled": true,
  "coin": "${coin}",
  "address": "${pool_address}",
${ADDRTYPE_JSON}${MFLEX_JSON}  "rewardRecipients": [],
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
      "name": "${pool_id} stratum",
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
      "user": "pooluser",
      "password": "poolpassword",
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
  }
}
JSON

  mv "${pool_file}.tmp" "${pool_file}"

  log "Wrote pool fragment: ${pool_file}"
  render_config
  restart_miningcore_if_running
  log "Done."
}

cmd_unregister() {
  local pool_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --pool-id) pool_id="$2"; shift 2 ;;
      *) die "Unknown option: $1" ;;
    esac
  done

  [[ -n "${pool_id}" ]] || die "Missing --pool-id"

  ensure_dirs
  local pool_file="${POOLS_DIR}/${pool_id}.json"
  if [[ -f "${pool_file}" ]]; then
    rm -f "${pool_file}"
    log "Removed pool fragment: ${pool_file}"
  else
    log "Pool fragment not found (nothing to remove): ${pool_file}"
  fi

  render_config
  restart_miningcore_if_running
  log "Done."
}

usage() {
  cat <<'USAGE'
Usage:
  pool-manager.sh register-bitcoin --pool-id <id> --coin <coin-template> --app-id <umbrel-app-id> \
    --rpc-port <port> --zmq-port <port> --stratum-port <port> --daemon-host <docker-hostname> \
    [--address-type <bcash|bechsegwit|...>] \
    [--getnewaddress-params <json-array-string>] \
    [--mflex-enabled]

  pool-manager.sh unregister --pool-id <id>
USAGE
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  local cmd="$1"; shift
  case "${cmd}" in
    register-bitcoin) cmd_register_bitcoin "$@" ;;
    unregister) cmd_unregister "$@" ;;
    -h|--help|help) usage ;;
    *) die "Unknown command: ${cmd}" ;;
  esac
}

main "$@"
