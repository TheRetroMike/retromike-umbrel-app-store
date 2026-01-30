#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   tools/make-node-hooks.sh <appdir> <pool_id> <coin_key> <rpc_port> <zmq_port> <stratum_port> <daemon_host> [addressType] [rpcWallet] [getnewaddressParams] [extraFlag]
#
# extraFlag currently supports: mflex

appdir="$1"; pool_id="$2"; coin_key="$3"; rpc_port="$4"; zmq_port="$5"; stratum_port="$6"; daemon_host="$7"
address_type="${8:-}"
rpc_wallet="${9:-}"
getnewaddress_params="${10:-[]}"
extra_flag="${11:-}"

hooks_dir="${appdir}/hooks"
mkdir -p "${hooks_dir}"

post="${hooks_dir}/post-install"
pre="${hooks_dir}/pre-uninstall"

cat > "${post}" <<POST
#!/usr/bin/env bash
set -euo pipefail

PM="/home/umbrel/umbrel/app-data/retro-mike-miningcore/scripts/pool-manager.sh"
[ -x "\${PM}" ] || exit 0

ARGS=( register-bitcoin
  --pool-id "${pool_id}"
  --coin "${coin_key}"
  --app-id "$(basename "${appdir}")"
  --rpc-port "${rpc_port}"
  --zmq-port "${zmq_port}"
  --stratum-port "${stratum_port}"
  --daemon-host "${daemon_host}"
)

POST

if [ -n "${address_type}" ]; then
  echo "ARGS+=( --address-type \"${address_type}\" )" >> "${post}"
fi

if [ -n "${rpc_wallet}" ]; then
  echo "ARGS+=( --rpc-wallet \"${rpc_wallet}\" )" >> "${post}"
fi

if [ -n "${getnewaddress_params}" ]; then
  echo "ARGS+=( --getnewaddress-params '${getnewaddress_params}' )" >> "${post}"
fi

if [ "${extra_flag}" = "mflex" ]; then
  echo "ARGS+=( --mflex-enabled )" >> "${post}"
fi

cat >> "${post}" <<'POST'
"${PM}" "${ARGS[@]}"
POST

cat > "${pre}" <<PRE
#!/usr/bin/env bash
set -euo pipefail

PM="/home/umbrel/umbrel/app-data/retro-mike-miningcore/scripts/pool-manager.sh"
[ -x "\${PM}" ] || exit 0

"\${PM}" unregister --pool-id "${pool_id}"
PRE

chmod +x "${post}" "${pre}"
echo "OK hooks: ${appdir}"
