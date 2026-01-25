#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MC_HOME="/home/umbrel/.miningcore"
POOLS_DIR="${MC_HOME}/pools.d"
RENDER_PY="${SCRIPT_DIR}/render-config.py"
MININGCORE_CONTAINER="retro-mike-miningcore_server_1"

RPC_USER="pooluser"
RPC_PASS="poolpassword"
RPC_HOST="127.0.0.1"

log() { echo "[pool-manager] $*"; }
die() { echo "[pool-manager] ERROR: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"; }

rpc_url() {
  local port="$1"
  local wallet="${2:-}"
  if [ -n "${wallet}" ]; then
    echo "http://${RPC_HOST}:${port}/wallet/${wallet}"
  else
    echo "http://${RPC_HOST}:${port}/"
  fi
}

rpc_call() {
  local port="$1"; shift
  local method="$1"; shift
  local params="${1:-[]}"; shift || true
  local wallet="${1:-}"; shift || true

  local url
  url="$(rpc_url "${port}" "${wallet}")"

  local body
  body="$(printf '{"jsonrpc":"1.0","id":"umbrel","method":"%s","params":%s}' "${method}" "${params}")"

  curl -sS --user "${RPC_USER}:${RPC_PASS}" \
    -H 'content-type: text/plain;' \
    --data-binary "${body}" \
    "${url}" || true
}

rpc_ok() {
  python3 - <<'PY'
import sys, json
try:
    d=json.load(sys.stdin)
    ok = isinstance(d, dict) and d.get("error") is None
    sys.exit(0 if ok else 1)
except Exception:
    sys.exit(1)
PY
}

rpc_result() {
  python3 - <<'PY'
import sys, json
d=json.load(sys.stdin)
print(d.get("result"))
PY
}

wait_for_rpc() {
  local port="$1"
  local tries="${2:-120}"
  for _i in $(seq 1 "${tries}"); do
    local out
    out="$(rpc_call "${port}" getblockchaininfo '[]')"
    if [ -n "${out}" ] && echo "${out}" | rpc_ok >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_wallet_loaded() {
  local port="$1"
  local wallet="$2"

  # createwallet / loadwallet sind am root-endpoint (nicht /wallet/<name>)
  rpc_call "${port}" createwallet "[\"${wallet}\"]" >/dev/null 2>&1 || true
  rpc_call "${port}" loadwallet   "[\"${wallet}\"]" >/dev/null 2>&1 || true
}

write_pool_fragment() {
  local pool_id="$1"
  local coin="$2"
  local address="$3"
  local rpc_port="$4"
  local zmq_port="$5"
  local stratum_port="$6"
  local daemon_host="$7"
  local address_type="${8:-}"
  local mflex_enabled="${9:-false}"
  local app_id="${10:-}"

  mkdir -p "${POOLS_DIR}"

  POOL_ID="${pool_id}" COIN="${coin}" ADDR="${address}" \
  RPC_PORT="${rpc_port}" ZMQ_PORT="${zmq_port}" STRATUM_PORT="${stratum_port}" \
  DAEMON_HOST="${daemon_host}" ADDRESS_TYPE="${address_type}" MFLEX_ENABLED="${mflex_enabled}" \
  APP_ID="${app_id}" \
  python3 - <<'PY'
import os, json
from pathlib import Path

pool_id=os.environ["POOL_ID"]
coin=os.environ["COIN"]
addr=os.environ["ADDR"]
rpc_port=int(os.environ["RPC_PORT"])
zmq_port=int(os.environ["ZMQ_PORT"])
stratum_port=os.environ["STRATUM_PORT"]
daemon_host=os.environ["DAEMON_HOST"]
address_type=os.environ.get("ADDRESS_TYPE","").strip()
mflex_enabled=os.environ.get("MFLEX_ENABLED","false").lower()=="true"
app_id=os.environ.get("APP_ID","").strip()

pool={
  "id": pool_id,
  "enabled": True,
  "coin": coin,
  "address": addr,

  "enableAsicBoost": True,
  "blockRefreshInterval": 0,
  "jobRebroadcastTimeout": 10,
  "clientConnectionTimeout": 600,

  "banning": {
    "enabled": True,
    "time": 600,
    "invalidPercent": 50,
    "checkThreshold": 50
  },

  "ports": {
    stratum_port: {
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
      "host": daemon_host,
      "port": rpc_port,
      "user": "pooluser",
      "password": "poolpassword",
      "zmqBlockNotifySocket": f"tcp://{daemon_host}:{zmq_port}"
    }
  ],

  "paymentProcessing": {
    "enabled": True,
    "minimumPayment": 0.001,
    "payoutScheme": "SOLO",
    "payoutSchemeConfig": { "factor": 2 }
  }
}

if address_type:
  pool["addressType"]=address_type

if mflex_enabled:
  pool["mflex"]={"enabled": True}

# fees.json optional -> rewardRecipients überall einfügen
fees_path = Path("/home/umbrel/.miningcore/fees.json")
if fees_path.exists():
  try:
    fees = json.loads(fees_path.read_text())
    rr = fees.get("rewardRecipients")
    if isinstance(rr, list) and rr:
      pool["rewardRecipients"] = rr
  except Exception:
    pass

if app_id:
  pool["_umbrel"] = {
    "appId": app_id,
    "rpcPort": rpc_port,
    "zmqPort": zmq_port,
    "stratumPort": stratum_port
  }

out=Path("/home/umbrel/.miningcore/pools.d")/f"{pool_id}.json"
out.write_text(json.dumps(pool, indent=2))
print("Wrote", out)
PY
}

render_config() {
  if [ -f "${RENDER_PY}" ]; then
    python3 "${RENDER_PY}" >/dev/null 2>&1 || true
  else
    log "WARN: render-config.py not found: ${RENDER_PY}"
  fi
}

restart_miningcore() {
  if docker ps --format '{{.Names}}' | grep -qx "${MININGCORE_CONTAINER}"; then
    docker restart "${MININGCORE_CONTAINER}" >/dev/null || true
  else
    log "WARN: MiningCore container not running: ${MININGCORE_CONTAINER}"
  fi
}

cmd_register_bitcoin() {
  local pool_id="" coin="" app_id="" rpc_port="" zmq_port="" stratum_port="" daemon_host=""
  local address_type=""
  local getnewaddress_params="[]"
  local rpc_wallet=""
  local mflex_enabled="false"

  while [ $# -gt 0 ]; do
    case "$1" in
      --pool-id) pool_id="$2"; shift 2;;
      --coin) coin="$2"; shift 2;;
      --app-id) app_id="$2"; shift 2;;
      --rpc-port) rpc_port="$2"; shift 2;;
      --zmq-port) zmq_port="$2"; shift 2;;
      --stratum-port) stratum_port="$2"; shift 2;;
      --daemon-host) daemon_host="$2"; shift 2;;
      --address-type) address_type="$2"; shift 2;;
      --getnewaddress-params) getnewaddress_params="$2"; shift 2;;
      --rpc-wallet) rpc_wallet="$2"; shift 2;;
      --mflex-enabled) mflex_enabled="true"; shift 1;;
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

  need curl
  need python3
  mkdir -p "${MC_HOME}" "${POOLS_DIR}"

  log "Waiting for RPC on ${RPC_HOST}:${rpc_port} ..."
  wait_for_rpc "${rpc_port}" 120 || die "RPC not ready on port ${rpc_port}"

  if [ -n "${rpc_wallet}" ]; then
    ensure_wallet_loaded "${rpc_port}" "${rpc_wallet}"
  fi

  local out addr
  out="$(rpc_call "${rpc_port}" getnewaddress "${getnewaddress_params}" "${rpc_wallet}")"
  addr="$(echo "${out}" | rpc_result | tr -d '\r\n')"
  [ -n "${addr}" ] && [ "${addr}" != "null" ] || die "getnewaddress failed: ${out}"

  log "Pool address: ${addr}"

  write_pool_fragment "${pool_id}" "${coin}" "${addr}" "${rpc_port}" "${zmq_port}" "${stratum_port}" "${daemon_host}" "${address_type}" "${mflex_enabled}" "${app_id}"
  render_config
  restart_miningcore
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

  rm -f "${POOLS_DIR}/${pool_id}.json" || true
  render_config
  restart_miningcore
}

usage() {
  cat <<EOF
usage() {
  cat <<EOF
Usage:
  pool-manager.sh register-bitcoin --pool-id <id> --coin <coinKey> --app-id <umbrelAppId> \\
    --rpc-port <port> --zmq-port <port> --stratum-port <port> --daemon-host <docker-hostname> \\
    [--address-type <bcash|bechsegwit|...>] \\
    [--getnewaddress-params <json-array-string>] \\
    [--rpc-wallet <walletname>] \\
    [--mflex-enabled]

  pool-manager.sh unregister --pool-id <id>
EOF
}

main() {
  local cmd="${1:-}"
  shift || true
  case "${cmd}" in
    register-bitcoin) cmd_register_bitcoin "$@";;
    unregister) cmd_unregister "$@";;
    * ) usage; exit 1;;
  esac
}

main "$@"
EOF
