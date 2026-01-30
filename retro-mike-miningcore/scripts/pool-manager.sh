#!/usr/bin/env bash
# Pool manager for Umbrel MiningCore app
# - Registers/unregisters coin pools by writing fragments into ~/.miningcore/pools.d
# - Renders ~/.miningcore/config.json
# - Restarts MiningCore container (best-effort)
#
# NOTE: We intentionally do NOT use `set -euo pipefail` here.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DATA_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

MC_HOME="/home/umbrel/.miningcore"
POOLS_DIR="${MC_HOME}/pools.d"

RPC_USER="pooluser"
RPC_PASSWORD="poolpassword"

log() { echo "[pool-manager] $*"; }
warn() { echo "[pool-manager] WARN: $*" >&2; }
die() { echo "[pool-manager] ERROR: $*" >&2; exit 1; }

need() {
  command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"
}

rpc_url() {
  local port="$1"
  local wallet="${2:-}"
  if [ -n "$wallet" ]; then
    echo "http://127.0.0.1:${port}/wallet/${wallet}"
  else
    echo "http://127.0.0.1:${port}/"
  fi
}

rpc_call() {
  local port="$1"
  local method="$2"
  local params_json="$3"   # must be a json array string, e.g. [] or ["","legacy"]
  local wallet="${4:-}"

  local url
  url="$(rpc_url "$port" "$wallet")"

  curl -s --connect-timeout 2 --max-time 10     --user "${RPC_USER}:${RPC_PASSWORD}"     -H 'content-type: text/plain;'     --data-binary "{"jsonrpc":"1.0","id":"pm","method":"${method}","params":${params_json}}"     "${url}" 2>/dev/null || true
}

rpc_result() {
  python3 - <<'PY'
import sys, json
s = sys.stdin.read().strip()
if not s:
    print("")
    raise SystemExit(0)
try:
    d = json.loads(s)
except Exception:
    print("")
    raise SystemExit(0)

if d.get("error") is not None:
    print("")
    raise SystemExit(0)

r = d.get("result")
if r is None:
    print("")
elif isinstance(r, (dict, list)):
    print(json.dumps(r))
else:
    print(str(r))
PY
}

rpc_error() {
  python3 - <<'PY'
import sys, json
s = sys.stdin.read().strip()
if not s:
    print("")
    raise SystemExit(0)
try:
    d = json.loads(s)
except Exception:
    print("")
    raise SystemExit(0)
e = d.get("error")
print("" if e is None else json.dumps(e))
PY
}

wait_for_rpc() {
  local port="$1"
  local tries="${2:-120}"

  local i
  for i in $(seq 1 "$tries"); do
    local out
    out="$(rpc_call "$port" "getblockchaininfo" "[]")"
    local err
    err="$(printf "%s" "$out" | rpc_error)"
    if [ -n "$out" ] && [ -z "$err" ]; then
      return 0
    fi
    sleep 1
  done

  return 1
}

ensure_wallet_loaded() {
  local port="$1"
  local wallet="$2"

  # listwallets is a root-only call
  local out wallets
  out="$(rpc_call "$port" "listwallets" "[]")"
  wallets="$(printf "%s" "$out" | rpc_result)"

  if printf "%s" "$wallets" | python3 - <<PY 2>/dev/null
import json, sys
s=sys.stdin.read().strip()
try:
  w=json.loads(s) if s else []
except Exception:
  w=[]
sys.exit(0 if "${wallet}" in w else 1)
PY
  then
    return 0
  fi

  # createwallet (ignore errors if already exists)
  rpc_call "$port" "createwallet" "["${wallet}"]" >/dev/null || true

  # loadwallet (ignore errors if already loaded)
  rpc_call "$port" "loadwallet" "["${wallet}"]" >/dev/null || true

  # verify
  out="$(rpc_call "$port" "listwallets" "[]")"
  wallets="$(printf "%s" "$out" | rpc_result)"

  if printf "%s" "$wallets" | python3 - <<PY 2>/dev/null
import json, sys
s=sys.stdin.read().strip()
try:
  w=json.loads(s) if s else []
except Exception:
  w=[]
sys.exit(0 if "${wallet}" in w else 1)
PY
  then
    return 0
  fi

  return 1
}

seed_mc_files_if_missing() {
  # Ensure ~/.miningcore has the base files so render-config works
  mkdir -p "${MC_HOME}" "${POOLS_DIR}" "${MC_HOME}/wallet-backups" 2>/dev/null || true

  for f in coins.json fees.json; do
    if [ ! -f "${MC_HOME}/${f}" ] && [ -f "${APP_DATA_DIR}/${f}" ]; then
      cp -a "${APP_DATA_DIR}/${f}" "${MC_HOME}/${f}" 2>/dev/null || true
    fi
  done

  if [ ! -f "${MC_HOME}/config.base.json" ]; then
    if [ -f "${APP_DATA_DIR}/assets/config.base.json" ]; then
      cp -a "${APP_DATA_DIR}/assets/config.base.json" "${MC_HOME}/config.base.json" 2>/dev/null || true
    fi
  fi
}

fix_mc_permissions() {
  # pool-manager is often run as root -> after changes, fix ownership for Umbrel user (uid/gid 1000)
  [ -d "${MC_HOME}" ] || return 0

  chown -R 1000:1000 "${MC_HOME}" 2>/dev/null || true
  find "${MC_HOME}" -type d -exec chmod 755 {} + 2>/dev/null || true
  find "${MC_HOME}" -type f -exec chmod 644 {} + 2>/dev/null || true
}

write_pool_fragment() {
  local pool_id="$1"
  local coin="$2"
  local address="$3"
  local rpc_port="$4"
  local zmq_port="$5"
  local stratum_port="$6"
  local daemon_host="$7"
  local mflex_enabled="$8"    # "true" or "false"

  seed_mc_files_if_missing

  python3 - <<PY
import json
from pathlib import Path

pool_id = ${pool_id!r}
coin = ${coin!r}
address = ${address!r}
rpc_port = int(${rpc_port!r})
zmq_port = int(${zmq_port!r})
stratum_port = int(${stratum_port!r})
daemon_host = ${daemon_host!r}
mflex_enabled = ${mflex_enabled!r}.lower() == "true"

pools_dir = Path(${POOLS_DIR!r})
pools_dir.mkdir(parents=True, exist_ok=True)

pool = {
  "id": pool_id,
  "enabled": True,
  "coin": coin,
  "address": address,
  "banning": {
    "enabled": True,
    "time": 600,
    "invalidPercent": 50,
    "checkThreshold": 50
  },
  "ports": {
    str(stratum_port): {
      "listenAddress": "0.0.0.0",
      "name": coin,
      "difficulty": 0.01,
      "varDiff": {
        "minDiff": 0.01,
        "maxDiff": None,
        "targetTime": 15,
        "retargetTime": 90,
        "variancePercent": 30
      }
    }
  },
  "daemons": [{
    "host": daemon_host,
    "port": rpc_port,
    "user": "pooluser",
    "password": "poolpassword",
    "zmqBlockNotifySocket": f"tcp://{daemon_host}:{zmq_port}"
  }],
  "paymentProcessing": {
    "enabled": True,
    "minimumPayment": 0.1,
    "payoutScheme": "SOLO",
    "payoutSchemeConfig": { "factor": 1 },
    "accounting": {
      "enabled": True,
      "shareRecoveryFile": "/app/share_recovery.json"
    }
  }
}

if mflex_enabled:
  pool["mflex"] = {"enabled": True}

out = pools_dir / f"{pool_id}.json"
out.write_text(json.dumps(pool, indent=2) + "\n")
print(f"Wrote {out}")
PY

  fix_mc_permissions
}

render_config() {
  seed_mc_files_if_missing

  if [ ! -f "${APP_DATA_DIR}/scripts/render-config.py" ]; then
    warn "render-config.py not found: ${APP_DATA_DIR}/scripts/render-config.py"
    return 0
  fi

  python3 "${APP_DATA_DIR}/scripts/render-config.py" >/dev/null 2>&1 || true
  fix_mc_permissions
}

restart_miningcore() {
  # Best-effort restart of miningcore server container
  local name="retro-mike-miningcore_server_1"
  if command -v docker >/dev/null 2>&1; then
    if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "${name}"; then
      docker restart "${name}" >/dev/null 2>&1 || true
    fi
  fi
}

cmd_register_bitcoin() {
  local pool_id=""
  local coin=""
  local app_id=""
  local rpc_port=""
  local zmq_port=""
  local stratum_port=""
  local daemon_host=""
  local rpc_wallet=""
  local getnewaddress_params='["","legacy"]'
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
      --rpc-wallet) rpc_wallet="$2"; shift 2;;
      --getnewaddress-params) getnewaddress_params="$2"; shift 2;;
      --mflex-enabled) mflex_enabled="true"; shift 1;;
      --address-type) shift 2;; # kept for backwards compatibility; not used (use --getnewaddress-params)
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

  mkdir -p "${MC_HOME}" "${POOLS_DIR}" 2>/dev/null || true

  log "Waiting for RPC on 127.0.0.1:${rpc_port} ..."
  if ! wait_for_rpc "${rpc_port}" 180; then
    die "RPC not reachable on 127.0.0.1:${rpc_port}"
  fi

  if [ -n "${rpc_wallet}" ]; then
    if ! ensure_wallet_loaded "${rpc_port}" "${rpc_wallet}"; then
      die "Wallet '${rpc_wallet}' could not be created/loaded"
    fi
  fi

  local out addr
  out="$(rpc_call "${rpc_port}" "getnewaddress" "${getnewaddress_params}" "${rpc_wallet}")"
  addr="$(printf "%s" "$out" | rpc_result | tr -d '
')"

  if [ -z "${addr}" ] || [ "${addr}" = "null" ]; then
    die "getnewaddress returned empty"
  fi

  log "Pool address: ${addr}"

  write_pool_fragment "${pool_id}" "${coin}" "${addr}" "${rpc_port}" "${zmq_port}" "${stratum_port}" "${daemon_host}" "${mflex_enabled}"
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

  rm -f "${POOLS_DIR}/${pool_id}.json" 2>/dev/null || true
  render_config
  restart_miningcore
}

usage() {
  cat <<EOF
Usage:
  pool-manager.sh register-bitcoin --pool-id <id> --coin <coinKey> --app-id <umbrelAppId> \
    --rpc-port <port> --zmq-port <port> --stratum-port <port> --daemon-host <docker-hostname> \
    [--address-type <legacy|...>] \
    [--getnewaddress-params <json-array-string>] \
    [--rpc-wallet <walletname>] \
    [--mflex-enabled]

  pool-manager.sh unregister --pool-id <id>
EOF
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    register-bitcoin) shift; cmd_register_bitcoin "$@";;
    unregister) shift; cmd_unregister "$@";;
    --help|-h|"") usage;;
    *) usage; die "Unknown command: ${cmd}";;
  esac
}

main "$@"
