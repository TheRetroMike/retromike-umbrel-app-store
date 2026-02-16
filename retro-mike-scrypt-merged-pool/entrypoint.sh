#!/bin/bash
set -e

echo "════════════════════════════════════════════════"
echo "  LTC + DOGE Merged Mining Pool — Umbrel"
echo "════════════════════════════════════════════════"

# ─── Wait for PostgreSQL ──────────────────────────────────────────────────────
echo "[*] Waiting for PostgreSQL..."
MAX_TRIES=60
COUNT=0
until pg_isready -h "${DB_HOST}" -U "${DB_USER}" -q 2>/dev/null; do
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge $MAX_TRIES ]; then
        echo "[!] PostgreSQL not ready after ${MAX_TRIES} attempts."
        exit 1
    fi
    sleep 2
done
echo "[+] PostgreSQL is ready."

# ─── Initialize database schemas ──────────────────────────────────────────────
echo "[*] Checking database schemas..."
export PGPASSWORD="${DB_PASS}"
TABLE_COUNT=$(psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ')

if [ "$TABLE_COUNT" = "0" ] || [ -z "$TABLE_COUNT" ]; then
    echo "[*] Initializing database..."
    for sql_file in /opt/pool/schemas/*.sql; do
        if [ -f "$sql_file" ]; then
            echo "  → Importing: $(basename $sql_file)"
            psql -h "${DB_HOST}" -U "${DB_USER}" -d "${DB_NAME}" -f "$sql_file" 2>/dev/null || true
        fi
    done
    echo "[+] Database initialized."
else
    echo "[+] Database already has ${TABLE_COUNT} tables."
fi
unset PGPASSWORD

# ─── Wait for Litecoin node ──────────────────────────────────────────────────
echo "[*] Waiting for Litecoin node RPC..."
COUNT=0
until curl -s --user "${LTC_RPC_USER}:${LTC_RPC_PASS}" \
    --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
    -H 'content-type: text/plain;' \
    "http://${LTC_RPC_HOST}:${LTC_RPC_PORT}/" > /dev/null 2>&1; do
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge 120 ]; then
        echo "[!] Litecoin node not ready. Starting anyway (will retry)..."
        break
    fi
    echo "[*] Waiting for Litecoin RPC... ($COUNT/120)"
    sleep 5
done

# ─── Wait for Dogecoin node ──────────────────────────────────────────────────
echo "[*] Waiting for Dogecoin node RPC..."
COUNT=0
until curl -s --user "${DOGE_RPC_USER}:${DOGE_RPC_PASS}" \
    --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
    -H 'content-type: text/plain;' \
    "http://${DOGE_RPC_HOST}:${DOGE_RPC_PORT}/" > /dev/null 2>&1; do
    COUNT=$((COUNT + 1))
    if [ $COUNT -ge 120 ]; then
        echo "[!] Dogecoin node not ready. Starting anyway (will retry)..."
        break
    fi
    echo "[*] Waiting for Dogecoin RPC... ($COUNT/120)"
    sleep 5
done

# ─── Generate pool config from template ──────────────────────────────────────
echo "[*] Generating pool configuration..."
envsubst < /opt/pool/config.template.json > /data/config.json

# If user has a custom config, use that instead
if [ -f /data/custom-config.json ]; then
    echo "[*] Using custom config from /data/custom-config.json"
    cp /data/custom-config.json /data/config.json
fi

# ─── Generate dashboard info page ────────────────────────────────────────────
cat > /var/www/html/config.js << EOJS
window.POOL_CONFIG = {
    apiUrl: "/api",
    poolName: "${POOL_NAME:-Umbrel LTC+DOGE Pool}",
    stratumHost: "${STRATUM_HOST:-your-umbrel-ip}",
    stratumPort: 3333,
    ltcAddress: "${LTC_POOL_ADDRESS:-not-configured}",
    dogeAddress: "${DOGE_POOL_ADDRESS:-not-configured}"
};
EOJS

echo "[+] Configuration ready."
echo ""
echo "  Dashboard:   http://your-umbrel-ip:8891"
echo "  Stratum:     stratum+tcp://your-umbrel-ip:3333"
echo "  Miner login: YOUR_LTC_ADDRESS-YOUR_DOGE_ADDRESS.rigname"
echo ""
echo "════════════════════════════════════════════════"

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
