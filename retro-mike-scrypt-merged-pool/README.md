# LTC + DOGE Merged Mining Pool for Umbrel OS

Self-hosted Litecoin + Dogecoin merged mining pool running entirely on your Umbrel server. One hash, two coins.

## What Is Merged Mining?

Merged mining (AuxPoW) lets you mine Litecoin and Dogecoin simultaneously with the same Scrypt hashpower. Litecoin acts as the "parent" chain and Dogecoin as the "auxiliary" chain. When your miner finds a valid hash for Litecoin, that same proof-of-work is automatically checked against Dogecoin's difficulty — if it qualifies, you earn DOGE rewards too, at zero extra energy cost.

Since 2014, over 70% of Dogecoin's hashrate has come from merged mining with Litecoin.

## What's Included

| Container | Description | Disk Needed |
|-----------|-------------|-------------|
| **litecoind** | Litecoin Core full node (v0.21.3) | ~100 GB |
| **dogecoind** | Dogecoin Core full node (v1.14.7) | ~70 GB |
| **postgres** | PostgreSQL 16 database for pool stats | ~1 GB |
| **pool** | Stratum server + web dashboard | minimal |
| **app_proxy** | Umbrel auth proxy | minimal |

**Total disk needed: ~175 GB** (for fully synced chains)

## Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 6+ cores |
| RAM | 8 GB | 16+ GB |
| Storage | 250 GB SSD | 500 GB+ NVMe |
| Network | Stable broadband | Gigabit + static IP |

**Mining hardware:** You need a Scrypt ASIC miner (Antminer L7, L9, Goldshell LT6, etc.). GPU/CPU mining of Scrypt is no longer profitable against the network difficulty.

## Quick Start

### 1. SSH into your Umbrel

```bash
ssh umbrel@umbrel.local
```

### 2. Clone / copy files

```bash
mkdir -p ~/ltc-doge-pool && cd ~/ltc-doge-pool
# Copy all files from this package here
```

### 3. Configure your wallet addresses

```bash
cp .env.example .env
nano .env
```

**You MUST set these two values:**
```env
LTC_POOL_ADDRESS=Lyour_litecoin_address_here
DOGE_POOL_ADDRESS=Dyour_dogecoin_address_here
```

Use addresses from wallets you control (Litewallet, Dogecoin Core, etc.) — NOT exchange deposit addresses.

### 4. Build and start

```bash
docker compose up -d --build
```

### 5. Wait for blockchain sync

Both nodes need to fully sync with their networks. This takes **1–3 days** depending on your hardware and internet speed.

Monitor sync progress:
```bash
# Litecoin sync status
docker compose exec litecoind litecoin-cli -rpcuser=umbrelltc -rpcpassword=ltcpass12345 getblockchaininfo

# Dogecoin sync status
docker compose exec dogecoind dogecoin-cli -rpcuser=umbreldoge -rpcpassword=dogepass12345 getblockchaininfo
```

Look for `"initialblockdownload": false` to confirm sync is complete.

### 6. Point your miners

Once synced, configure your ASIC miner:

| Setting | Value |
|---------|-------|
| **Pool URL** | `stratum+tcp://YOUR_UMBREL_IP:3333` |
| **Username** | `YOUR_LTC_ADDRESS-YOUR_DOGE_ADDRESS.worker1` |
| **Password** | `x` |

**Example username:** `LgETtY86dfiWsgD3Mmcx1PtzhCde-DH5yaieqoXXY3CYzUHmg3ZbS29dmk.rig1`

### 7. Check the dashboard

Open `http://umbrel.local:8891` to see pool stats, hashrate, and block finds.

## Alternative: Install via Dockge

If you have [Dockge](https://apps.umbrel.com/app/dockge) installed:

1. Open Dockge from Umbrel dashboard
2. Create a new stack named `ltc-doge-pool`
3. Paste the docker-compose.yml contents
4. Replace all `${VAR}` references with actual values from `.env.example`
5. Deploy

## How It Works

```
Your ASIC Miner ──→ Stratum (port 3333) ──→ Litecoin Node (parent chain)
                         │                         │
                         │                         ├─→ Valid LTC block? → LTC reward!
                         │                         │
                         └──→ Dogecoin Node (aux)  ├─→ Valid DOGE block? → DOGE reward!
                                                   │
                                                PostgreSQL (stats, shares, payouts)
```

1. Your miner submits Scrypt hashes to the stratum server
2. The pool constructs block templates for both LTC and DOGE
3. Each valid share is checked against both chains' difficulty
4. If a hash meets LTC difficulty → LTC block found (6.25 LTC reward)
5. If a hash meets DOGE difficulty → DOGE block found (10,000 DOGE reward)
6. Both happen from the same computation

## Solo Mining Reality Check

With current network difficulties:

| Coin | Network Hashrate | Solo Block Time (1 GH/s) |
|------|-----------------|--------------------------|
| LTC | ~2 TH/s | ~140 days avg |
| DOGE | ~2.5 PH/s | ~3 years avg |

With a single Antminer L7 (~9.5 GH/s), you'd find an LTC block roughly every 2 weeks on average, and DOGE blocks more frequently. But variance is high — you might find a block in an hour or wait months.

**This is lottery-style mining.** It's great for privacy, supporting decentralization, learning, or if you have significant hashpower. For steady income, consider joining an established pool like litecoinpool.org.

## Persistent Data

```
data/
├── litecoin/       # Full LTC blockchain (~100 GB)
├── dogecoin/       # Full DOGE blockchain (~70 GB)
├── postgres/       # Pool database
├── pool/           # Pool config + state
│   ├── config.json        # Generated config
│   └── custom-config.json # Your overrides (optional)
└── pool-logs/      # Stratum & web server logs
```

## Configuration

### Custom Pool Config

After first run, you can create a custom config:
```bash
cp data/pool/config.json data/pool/custom-config.json
nano data/pool/custom-config.json
```

Then restart the pool:
```bash
docker compose restart pool
```

### Changing Stratum Difficulty

Edit `data/pool/custom-config.json` and change the `difficulty` field. Higher difficulty = fewer shares submitted = less network overhead (better for powerful ASICs). Lower difficulty = more shares = more granular stats.

### Port Conflicts

| Port | Service | Change in |
|------|---------|-----------|
| 8891 | Web Dashboard | `APP_LTC_DOGE_MINING_WEB_PORT` in `.env` |
| 3333 | Stratum (miners) | `docker-compose.yml` ports section |
| 9333 | LTC P2P | `docker-compose.yml` ports section |
| 22556 | DOGE P2P | `docker-compose.yml` ports section |

Internal ports (9332 LTC RPC, 22555 DOGE RPC, 5432 PostgreSQL) are not exposed to the host.

## Troubleshooting

**Nodes not syncing:**
```bash
docker compose logs litecoind --tail 50
docker compose logs dogecoind --tail 50
```

**Pool not starting:**
```bash
docker compose logs pool --tail 100
```

**Check if RPC is responding:**
```bash
# Litecoin
curl --user umbrelltc:ltcpass12345 \
  --data-binary '{"jsonrpc":"1.0","method":"getblockcount","params":[]}' \
  http://localhost:9332/

# Dogecoin
curl --user umbreldoge:dogepass12345 \
  --data-binary '{"jsonrpc":"1.0","method":"getblockcount","params":[]}' \
  http://localhost:22555/
```

**Reset everything:**
```bash
docker compose down -v
rm -rf data/
docker compose up -d --build
```

**Stratum not accepting miners:**
- Ensure both blockchains are fully synced first
- Check pool logs: `docker compose exec pool cat /var/log/pool/stratum.log`
- Verify ZMQ is working: pool needs block notifications from both nodes

## Security

- Change all default passwords in `.env` before deploying
- The RPC ports are only exposed internally between containers
- Stratum port 3333 needs to be reachable by your miners (local network or port-forwarded)
- The web dashboard is protected by Umbrel's auth proxy when accessed through Umbrel
- Don't expose RPC ports (9332, 22555) to the public internet

## Updating

```bash
cd ~/ltc-doge-pool
docker compose pull        # Pull latest node images
docker compose up -d --build  # Rebuild pool container
```

Your blockchain data and configs persist across updates.

## Credits

- [dreams-money/merged-mining-pool](https://github.com/dreams-money/merged-mining-pool) — Go-based merged mining stratum
- [Litecoin Core](https://litecoin.org/) — Parent chain node
- [Dogecoin Core](https://dogecoin.com/) — Auxiliary chain node
- [Umbrel](https://umbrel.com/) — Home server OS
