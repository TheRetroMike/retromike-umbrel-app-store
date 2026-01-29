#!/usr/bin/env bash
set -euo pipefail

# Umbrel helper to register/unregister a Bitcoin-family coin daemon with Miningcore
# by creating a pool fragment in /home/umbrel/.miningcore/pools.d and rendering
# /home/umbrel/.miningcore/config.json.

MC_HOME="/home/umbrel/.miningcore"
POOLS_DIR="${MC_HOME}/pools.d"
RENDER_SCRIPT="/home/umbrel/umbrel/app-data/retro-mike-miningcore/scripts/render-config.py"

RPC_HOST="127.0.0.1"
RPC_USER="pooluser"
RPC_PASS="poolpassword"
RPC_PROTO="http"

log() { echo "[pool-manager] $*"; }
die() { echo "[pool-manager] ERROR: $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage:
  pool-manager.sh register-bitcoin --pool-id <id> --coin <coinKey> --app-id <umbrelAppId> \
    --rpc-port <port> --zmq-port <port> --stratum-port <port> --daemon-host <docker-hostname> \
    [--address-type <legacy|...>] \
    [--getnewaddress-params <json-array-string>] \
    [--rpc-wallet <walletname>] \
    [--mflex-enabled]

  pool-manager.sh unregister --pool-id <id>
USAGE
}

fix_mc_perms() {
  [ -d "${MC_HOME}" ] || return 0

  if [ "$(id -u)" -eq 0 ]; then
    chown -R umbrel:umbrel "${MC_HOME}" 2>/dev/null || true
  fi

  # Directories MUST have execute-bit, otherwise Permission denied on pools.d
  find "${MC_HOME}" -type d -exec chmod 755 {} + 2>/dev/null || true
  find "${MC_HOME}" -type f -exec chmod 644 {} + 2>/dev/null || true
}

# Always try to repair ownership/permissions, even when a command fails.
trap 'fix_mc_perms >/dev/null 2>&1 || true' EXIT

rpc_call() {
  local port="$1"; shift
  local method="$1"; shift
  local params="${1:-[]}"
  local wallet="${2:-}"

  local url="${RPC_PROTO}://${RPC_HOST}:${port}/"
  if [ -n "${wallet}" ]; then
    url="${RPC_PROTO}://${RPC_HOST}:${port}/wallet/${wallet}"
  fi

  curl -sS --user "${RPC_USER}:${RPC_PASS}" -H 'content-type: text/plain;' \
    --data-binary "{\"jsonrpc\":\"1.0\",\"id\":\"pm\",\"method\":\"${method}\",\"params\":${params}}" \
    "${url}" || true
}

rpc_ok() {
  python3 - <<'PY'
import sys, json
raw = sys.stdin.read()
if not raw.strip():
    sys.exit(1)
try:
    d = json.loads(raw)
except Exception:
    sys.exit(1)
sys.exit(0 if d.get("error") is None else 1)
PY
}

rpc_result() {
  python3 - <<'PY'
import sys, json
raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)
try:
    d = json.loads(raw)
except Exception:
    sys.exit(0)
r = d.get("result")
if r is None:
    sys.exit(0)
# Print strings without quotes, keep others as JSON
if isinstance(r, str):
    print(r)
else:
    import json as _j
    print(_j.dumps(r))
PY
}

rpc_error() {
  python3 - <<'PY'
import sys, json
raw = sys.stdin.read()
if not raw.strip():
    sys.exit(0)
try:
    d = json.loads(raw)
except Exception:
    sys.exit(0)
e = d.get("error") or {}
msg = e.get("message")
code = e.get("code")
if msg is None and code is None:
    sys.exit(0)
print(f"code={code} message={msg}")
PY
}

wait_for_rpc() {
  local port="$1"
  log "Waiting for RPC on ${RPC_HOST}:${port} ..."
  while true; do
    if rpc_call "${port}" getblockchaininfo '[]' | rpc_ok; then
      break
    fi
    sleep 1
  done
}

wallet_is_loaded() {
  local port="$1"
  local wallet="$2"
  rpc_call "${port}" listwallets '[]' | python3 - "${wallet}" <<'PY'
import sys, json
wallet=sys.argv[1]
try:
    d=json.load(sys.stdin)
except Exception:
    print("0"); sys.exit(0)
lst=d.get("result") or []
print("1" if wallet in lst else "0")
PY
}

ensure_wallet_loaded() {
  local port="$1"
  local wallet="$2"
  [ -n "${wallet}" ] || return 0

  local last_lw="" last_cw=""

  for _ in 1 2 3; do
    if [ "$(wallet_is_loaded "${port}" "${wallet}")" = "1" ]; then
      return 0
    fi

    # Try loadwallet first
    last_lw="$(rpc_call "${port}" loadwallet "[\"${wallet}\"]")"
    if [ "$(wallet_is_loaded "${port}" "${wallet}")" = "1" ]; then
      return 0
    fi

    # Then try createwallet (if missing)
    last_cw="$(rpc_call "${port}" createwallet "[\"${wallet}\"]")"
    if [ "$(wallet_is_loaded "${port}" "${wallet}")" = "1" ]; then
      return 0
    fi

    sleep 1
  done

  log "loadwallet response: ${last_lw}"
  log "createwallet response: ${last_cw}"
  die "Wallet \"${wallet}\" konnte nicht geladen/erstellt werden (siehe Antworten oben)."
}

get_pool_address() {
  local port="$1"
  local wallet="$2"
  local getnewaddress_params="$3"

  local out addr err
  out="$(rpc_call "${port}" getnewaddress "${getnewaddress_params}" "${wallet}")"
  addr="$(printf '%s' "${out}" | rpc_result | tr -d '"')"

  if [ -z "${addr}" ] || [ "${addr}" = "None" ]; then
    err="$(printf '%s' "${out}" | rpc_error)"
    die "getnewaddress returned empty. ${err:-raw=${out}}"
  fi

  echo "${addr}"
}

write_pool_json() {
  local pool_id="$1"
  local coin="$2"
  local daemon_host="$3"
  local rpc_port="$4"
  local zmq_port="$5"
  local stratum_port="$6"
  local address="$7"
  local address_type="$8"
  local mflex_enabled="$9"
  local app_id="${10}"

  mkdir -p "${POOLS_DIR}"

  ADDR="${address}" \
  POOL_ID="${pool_id}" \
  COIN="${coin}" \
  DAEMON_HOST="${daemon_host}" \
  RPC_PORT="${rpc_port}" \
  ZMQ_PORT="${zmq_port}" \
  STRATUM_PORT="${stratum_port}" \
  ADDRESS_TYPE="${address_type}" \
  MFLEX_ENABLED="${mflex_enabled}" \
  APP_ID="${app_id}" \
  python3 - <<'PY'
import os, json
from pathlib import Path

mc_home = Path("/home/umbrel/.miningcore")
pools_dir = mc_home / "pools.d"
fees_path = mc_home / "fees.json"

pool_id = os.environ["POOL_ID"]
coin = os.environ["COIN"]
daemon_host = os.environ["DAEMON_HOST"]
rpc_port = int(os.environ["RPC_PORT"])
zmq_port = int(os.environ["ZMQ_PORT"])
stratum_port = os.environ["STRATUM_PORT"]
address = os.environ["ADDR"]
address_type = os.environ.get("ADDRESS_TYPE","legacy")
mflex_enabled = os.environ.get("MFLEX_ENABLED","false").lower() == "true"
app_id = os.environ.get("APP_ID","")

reward_recipients = []
if fees_path.exists():
    try:
        reward_recipients = json.loads(fees_path.read_text())
    except Exception:
        reward_recipients = []

pool = {
    "id": pool_id,
    "enabled": True,
    "coin": coin,
    "address": address,
    "addressType": address_type,
    "rewardRecipients": reward_recipients,
    "paymentProcessing": {
        "enabled": True,
        "minimumPayment": 0.001,
        "payoutScheme": "SOLO",
    },
    "ports": {
        stratum_port: {
            "listenAddress": "0.0.0.0",
            "ssl": False,
            "difficulty": 0.5,
            "varDiff": {
                "minDiff": 0.05,
                "maxDiff": 2048,
                "targetTime": 15,
                "retargetTime": 90,
                "variancePercent": 30,
            },
        }
    },
    "daemons": [{
        "host": daemon_host,
        "port": rpc_port,
        "user": "pooluser",
        "password": "poolpassword",
        "zmqBlockNotifySocket": f"tcp://{daemon_host}:{zmq_port}",
    }],
    "features": {
        "enableAsicBoost": True,
        "blockNotify": True,
    },
    "_umbrel": {
        "appId": app_id
    }
}

if mflex_enabled:
    pool["mflex"] = {"enabled": True}

pools_dir.mkdir(parents=True, exist_ok=True)
out_path = pools_dir / f"{pool_id}.json"
out_path.write_text(json.dumps(pool, indent=2) + "\n")
PY
}

render_config() {
  [ -x "${RENDER_SCRIPT}" ] || die "render-config.py not found at ${RENDER_SCRIPT}"

  python3 "${RENDER_SCRIPT}" \
    --base "${MC_HOME}/config.base.json" \
    --coins "${MC_HOME}/coins.json" \
    --pools "${POOLS_DIR}" \
    --out  "${MC_HOME}/config.json"
}

restart_miningcore() {
  # Miningcore container name on Umbrel
  if docker ps -a --format '{{.Names}}' | grep -q '^retro-mike-miningcore_server_1$'; then
    docker restart retro-mike-miningcore_server_1 >/dev/null 2>&1 || true
  else
    log "WARN: retro-mike-miningcore_server_1 not found (skipping restart)"
  fi
}

cmd="${1:-}"
shift || true

case "${cmd}" in
  register-bitcoin)
    pool_id="" coin="" app_id="" rpc_port="" zmq_port="" stratum_port="" daemon_host=""
    address_type="legacy"
    getnewaddress_params='["","legacy"]'
    rpc_wallet=""
    mflex_enabled="false"

    while [ "$#" -gt 0 ]; do
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
        -h|--help) usage; exit 0;;
        *) die "Unknown argument: $1";;
      esac
    done

    [ -n "${pool_id}" ] || die "--pool-id missing"
    [ -n "${coin}" ] || die "--coin missing"
    [ -n "${app_id}" ] || die "--app-id missing"
    [ -n "${rpc_port}" ] || die "--rpc-port missing"
    [ -n "${zmq_port}" ] || die "--zmq-port missing"
    [ -n "${stratum_port}" ] || die "--stratum-port missing"
    [ -n "${daemon_host}" ] || die "--daemon-host missing"

    mkdir -p "${MC_HOME}" "${POOLS_DIR}"

    wait_for_rpc "${rpc_port}"
    ensure_wallet_loaded "${rpc_port}" "${rpc_wallet}"

    addr="$(get_pool_address "${rpc_port}" "${rpc_wallet}" "${getnewaddress_params}")"
    log "Pool address: ${addr}"

    write_pool_json "${pool_id}" "${coin}" "${daemon_host}" "${rpc_port}" "${zmq_port}" "${stratum_port}" "${addr}" "${address_type}" "${mflex_enabled}" "${app_id}"
    log "Wrote ${POOLS_DIR}/${pool_id}.json"

    render_config
    restart_miningcore

    log "Done."
    ;;

  unregister)
    pool_id=""
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --pool-id) pool_id="$2"; shift 2;;
        -h|--help) usage; exit 0;;
        *) die "Unknown argument: $1";;
      esac
    done
    [ -n "${pool_id}" ] || die "--pool-id missing"

    rm -f "${POOLS_DIR}/${pool_id}.json" || true
    render_config
    restart_miningcore
    log "Removed ${pool_id}"
    ;;

  ""|-h|--help)
    usage
    ;;

  *)
    die "Unknown command: ${cmd}"
    ;;
esac