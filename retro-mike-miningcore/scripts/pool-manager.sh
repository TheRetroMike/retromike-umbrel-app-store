#!/usr/bin/env bash
set -euo pipefail

RPC_HOST_DEFAULT="127.0.0.1"
RPC_USER_DEFAULT="pooluser"
RPC_PASS_DEFAULT="poolpassword"

MININGCORE_CONTAINER="retro-mike-miningcore_server_1"

MC_DIR="/home/umbrel/.miningcore"
POOLS_DIR="${MC_DIR}/pools.d"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER_SCRIPT="${SCRIPT_DIR}/render-config.py"

log() { echo "[pool-manager] $*"; }
die() { echo "[pool-manager] ERROR: $*" >&2; exit 1; }

rpc_call() {
  local url="$1" method="$2" params="${3:-[]}"
  curl -sS --connect-timeout 2 --max-time 15 \
    --user "${RPC_USER}:${RPC_PASS}" \
    -H 'content-type: text/plain;' \
    --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"pm\",\"method\":\"${method}\",\"params\":${params}}" \
    "${url}"
}

rpc_error_code() {
  python3 - <<'PY'
import sys, json
try:
    d=json.load(sys.stdin)
except Exception:
    print("")
    sys.exit(0)
err=d.get("error")
if not err:
    print("")
else:
    print(err.get("code",""))
PY
}

rpc_result() {
  python3 - <<'PY'
import sys, json
try:
    d=json.load(sys.stdin)
except Exception:
    print("")
    sys.exit(0)
r=d.get("result")
if r is None:
    print("")
elif isinstance(r, (str,int,float)):
    print(r)
else:
    print(json.dumps(r))
PY
}

wait_for_rpc() {
  local url="http://${RPC_HOST}:${RPC_PORT}/"
  local tries=180
  for ((i=1;i<=tries;i++)); do
    if rpc_call "${url}" "getblockchaininfo" "[]" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  die "RPC not reachable on ${url} after ${tries}s"
}

ensure_wallet_loaded() {
  local wallet="${1:-}"
  [[ -z "${wallet}" ]] && return 0

  local url_root="http://${RPC_HOST}:${RPC_PORT}/"

  local resp code
  resp="$(rpc_call "${url_root}" "loadwallet" "[\"${wallet}\"]" || true)"
  code="$(printf '%s' "${resp}" | rpc_error_code)"

  if [[ "${code}" == "-18" ]]; then
    resp="$(rpc_call "${url_root}" "createwallet" "[\"${wallet}\"]" || true)"
    code="$(printf '%s' "${resp}" | rpc_error_code)"
    if [[ -n "${code}" && "${code}" != "-4" && "${code}" != "-35" ]]; then
      log "createwallet response: ${resp}"
      die "createwallet failed (code=${code})"
    fi
    resp="$(rpc_call "${url_root}" "loadwallet" "[\"${wallet}\"]" || true)"
    code="$(printf '%s' "${resp}" | rpc_error_code)"
    if [[ -n "${code}" && "${code}" != "-35" ]]; then
      log "loadwallet response: ${resp}"
      die "loadwallet failed (code=${code})"
    fi
  else
    if [[ -n "${code}" && "${code}" != "-35" ]]; then
      log "loadwallet response: ${resp}"
      die "loadwallet failed (code=${code})"
    fi
  fi
}

get_pool_address() {
  local wallet="${RPC_WALLET:-}"
  local params="${GETNEWADDRESS_PARAMS:-[]}"

  local url
  if [[ -n "${wallet}" ]]; then
    url="http://${RPC_HOST}:${RPC_PORT}/wallet/${wallet}"
  else
    url="http://${RPC_HOST}:${RPC_PORT}/"
  fi

  local resp addr
  resp="$(rpc_call "${url}" "getnewaddress" "${params}")"
  addr="$(printf '%s' "${resp}" | rpc_result)"
  [[ -n "${addr}" && "${addr}" != "null" ]] || { log "getnewaddress response: ${resp}"; die "getnewaddress returned empty"; }
  printf '%s\n' "${addr}"
}

write_pool_fragment() {
  mkdir -p "${POOLS_DIR}"
  POOL_FILE="${POOLS_DIR}/${POOL_ID}.json"

  export POOL_ID COIN ADDRESS STRATUM_PORT RPC_PORT ZMQ_PORT DAEMON_HOST APP_ID MFLEX_ENABLED POOL_FILE
  python3 - <<'PY'
import os, json, pathlib

pool_id=os.environ["POOL_ID"]
coin=os.environ["COIN"]
address=os.environ["ADDRESS"]
stratum_port=int(os.environ["STRATUM_PORT"])
rpc_port=int(os.environ["RPC_PORT"])
zmq_port=int(os.environ["ZMQ_PORT"])
daemon_host=os.environ["DAEMON_HOST"]
app_id=os.environ["APP_ID"]
mflex_enabled=os.environ.get("MFLEX_ENABLED","false").lower() in ("1","true","yes","on")
out_path=pathlib.Path(os.environ["POOL_FILE"])

pool = {
  "id": pool_id,
  "enabled": True,
  "coin": coin,
  "address": address,
  "rewardRecipients": [],
  "banning": {
    "enabled": True,
    "time": 600,
    "invalidPercent": 50,
    "checkThreshold": 50
  },
  "ports": {
    str(stratum_port): {
      "listenAddress": "0.0.0.0",
      "difficulty": 1024,
      "varDiff": {
        "minDiff": 512,
        "maxDiff": 131072,
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
      "ssl": False
    }
  ],
  "paymentProcessing": {
    "enabled": True,
    "payoutScheme": "SOLO",
    "minimumPayment": 0.00000001,
    "payoutInterval": 86400
  },
  "metadata": {
    "appId": app_id,
    "zmqPort": zmq_port
  }
}

if mflex_enabled:
  pool["mflex"] = {"enabled": True}

out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(pool, indent=2) + "\n", encoding="utf-8")
print(f"Wrote {out_path}")
PY
}

render_and_restart() {
  python3 "${RENDER_SCRIPT}"

  if docker ps -a --format '{{.Names}}' | grep -q "^${MININGCORE_CONTAINER}$"; then
    docker restart "${MININGCORE_CONTAINER}" >/dev/null 2>&1 || true
  else
    log "WARN: MiningCore container '${MININGCORE_CONTAINER}' not found (skipping restart)"
  fi
}

register_bitcoin() {
  [[ -n "${POOL_ID}" ]] || die "--pool-id missing"
  [[ -n "${COIN}" ]] || die "--coin missing"
  [[ -n "${APP_ID}" ]] || die "--app-id missing"
  [[ -n "${RPC_PORT}" ]] || die "--rpc-port missing"
  [[ -n "${ZMQ_PORT}" ]] || die "--zmq-port missing"
  [[ -n "${STRATUM_PORT}" ]] || die "--stratum-port missing"
  [[ -n "${DAEMON_HOST}" ]] || die "--daemon-host missing"

  wait_for_rpc
  ensure_wallet_loaded "${RPC_WALLET:-}"

  ADDRESS="$(get_pool_address)"
  log "Pool address: ${ADDRESS}"

  write_pool_fragment
  render_and_restart
}

unregister() {
  [[ -n "${POOL_ID}" ]] || die "--pool-id missing"

  rm -f "${POOLS_DIR}/${POOL_ID}.json"
  log "Removed ${POOLS_DIR}/${POOL_ID}.json"

  render_and_restart
}

usage() {
  cat <<'EOF'
Usage:
  pool-manager.sh register-bitcoin --pool-id <id> --coin <coinKey> --app-id <umbrelAppId> \
    --rpc-port <port> --zmq-port <port> --stratum-port <port> --daemon-host <docker-hostname> \
    [--rpc-host <host>] \
    [--rpc-user <user>] [--rpc-pass <pass>] \
    [--rpc-wallet <walletname>] \
    [--address-type <legacy|...>] \
    [--getnewaddress-params <json-array-string>] \
    [--mflex-enabled]

  pool-manager.sh unregister --pool-id <id>
EOF
}

CMD="${1:-}"; shift || true

POOL_ID=""
COIN=""
APP_ID=""
RPC_HOST="${RPC_HOST_DEFAULT}"
RPC_USER="${RPC_USER_DEFAULT}"
RPC_PASS="${RPC_PASS_DEFAULT}"
RPC_PORT=""
ZMQ_PORT=""
STRATUM_PORT=""
DAEMON_HOST=""
RPC_WALLET=""
ADDRESS_TYPE=""
GETNEWADDRESS_PARAMS="[]"
MFLEX_ENABLED="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pool-id) POOL_ID="$2"; shift 2;;
    --coin) COIN="$2"; shift 2;;
    --app-id) APP_ID="$2"; shift 2;;
    --rpc-host) RPC_HOST="$2"; shift 2;;
    --rpc-user) RPC_USER="$2"; shift 2;;
    --rpc-pass) RPC_PASS="$2"; shift 2;;
    --rpc-port) RPC_PORT="$2"; shift 2;;
    --zmq-port) ZMQ_PORT="$2"; shift 2;;
    --stratum-port) STRATUM_PORT="$2"; shift 2;;
    --daemon-host) DAEMON_HOST="$2"; shift 2;;
    --rpc-wallet) RPC_WALLET="$2"; shift 2;;
    --address-type) ADDRESS_TYPE="$2"; shift 2;;
    --getnewaddress-params) GETNEWADDRESS_PARAMS="$2"; shift 2;;
    --mflex-enabled) MFLEX_ENABLED="true"; shift 1;;
    -h|--help) usage; exit 0;;
    *) die "Unknown arg: $1";;
  esac
done

if [[ "${GETNEWADDRESS_PARAMS}" == "[]" && -n "${ADDRESS_TYPE}" ]]; then
  GETNEWADDRESS_PARAMS="[\"\",\"${ADDRESS_TYPE}\"]"
fi

case "${CMD}" in
  register-bitcoin) register_bitcoin;;
  unregister) unregister;;
  ""|-h|--help) usage; exit 0;;
  *) die "Unknown command: ${CMD}";;
esac
