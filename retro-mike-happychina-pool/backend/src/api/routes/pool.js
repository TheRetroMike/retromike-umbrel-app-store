const express = require('express');
const db = require('../../models/database');
const config = require('../../config');
const { coins, algorithms } = require('../../config/coins');

const router = express.Router();

// Strip sensitive fields (daemon credentials) from coin config before sending to clients
function sanitizeCoin(coin) {
  const { daemon, ...safe } = coin;
  return safe;
}

// Get pool info
router.get('/info', (req, res) => {
  const coinStats = {};

  for (const [coinId, coin] of Object.entries(coins)) {
    const stats = db.prepare(
      'SELECT * FROM pool_stats WHERE coin = ? ORDER BY created_at DESC LIMIT 1'
    ).get(coinId);

    // For merge-mined coins, count miners/workers from the parent chain
    const minerCoinId = coin.mergeMinedWith || coinId;
    const totalMiners = db.prepare(
      'SELECT COUNT(DISTINCT user_id) as count FROM workers WHERE coin = ? AND is_online = 1'
    ).get(minerCoinId);

    const totalWorkers = db.prepare(
      'SELECT COUNT(*) as count FROM workers WHERE coin = ? AND is_online = 1'
    ).get(minerCoinId);

    const blocksFound = db.prepare(
      'SELECT COUNT(*) as count FROM blocks WHERE coin = ?'
    ).get(coinId);

    const lastBlock = db.prepare(
      'SELECT * FROM blocks WHERE coin = ? ORDER BY created_at DESC LIMIT 1'
    ).get(coinId);

    coinStats[coinId] = {
      ...sanitizeCoin(coin),
      pool: {
        hashrate: stats?.hashrate || 0,
        miners: totalMiners?.count || 0,
        workers: totalWorkers?.count || 0,
        blocksFound: blocksFound?.count || 0,
        lastBlock: lastBlock?.created_at || null,
        fee: config.pool.fee
      },
      network: {
        difficulty: stats?.difficulty || 0,
        hashrate: stats?.network_hashrate || 0,
        blockHeight: stats?.block_height || 0
      }
    };
  }

  res.json({
    name: config.pool.name,
    fee: config.pool.fee,
    payoutThreshold: config.pool.payoutThreshold,
    coins: coinStats,
    algorithms
  });
});

// Get stats for a specific coin
router.get('/stats/:coin', (req, res) => {
  const { coin } = req.params;

  if (!coins[coin]) {
    return res.status(404).json({ error: 'Coin not found' });
  }

  const currentStats = db.prepare(
    'SELECT * FROM pool_stats WHERE coin = ? ORDER BY created_at DESC LIMIT 1'
  ).get(coin);

  const hashHistory = db.prepare(
    'SELECT hashrate, created_at FROM hashrate_history WHERE coin = ? AND user_id IS NULL ORDER BY created_at DESC LIMIT 288'
  ).all(coin).reverse();

  const recentBlocks = db.prepare(`
    SELECT b.*, u.username as finder_name
    FROM blocks b
    LEFT JOIN users u ON b.finder_id = u.id
    WHERE b.coin = ?
    ORDER BY b.created_at DESC
    LIMIT 20
  `).all(coin);

  const topMiners = db.prepare(`
    SELECT u.username, SUM(w.hashrate) as total_hashrate, COUNT(w.id) as worker_count
    FROM workers w
    JOIN users u ON w.user_id = u.id
    WHERE w.coin = ? AND w.is_online = 1
    GROUP BY w.user_id
    ORDER BY total_hashrate DESC
    LIMIT 10
  `).all(coin);

  res.json({
    coin: sanitizeCoin(coins[coin]),
    current: currentStats || {},
    hashrateHistory: hashHistory,
    recentBlocks,
    topMiners
  });
});

// Get all blocks
router.get('/blocks', (req, res) => {
  const { coin, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = `
    SELECT b.*, u.username as finder_name
    FROM blocks b
    LEFT JOIN users u ON b.finder_id = u.id
  `;
  let countQuery = 'SELECT COUNT(*) as total FROM blocks';
  const params = [];

  if (coin) {
    query += ' WHERE b.coin = ?';
    countQuery += ' WHERE coin = ?';
    params.push(coin);
  }

  query += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';

  const blocks = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));
  const { total } = db.prepare(countQuery).get(...params);
  const coins = db.prepare('SELECT DISTINCT coin FROM blocks ORDER BY coin').all().map(r => r.coin);

  res.json({
    blocks,
    coins,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// Get pool hashrate history
router.get('/hashrate/:coin', (req, res) => {
  const { coin } = req.params;
  const { period = '24h' } = req.query;

  let limit;
  switch (period) {
    case '1h': limit = 12; break;
    case '6h': limit = 72; break;
    case '24h': limit = 288; break;
    case '7d': limit = 2016; break;
    case '30d': limit = 8640; break;
    default: limit = 288;
  }

  const history = db.prepare(
    'SELECT hashrate, created_at FROM hashrate_history WHERE coin = ? AND user_id IS NULL ORDER BY created_at DESC LIMIT ?'
  ).all(coin, limit).reverse();

  res.json(history);
});

// Get daemon status for all coins
router.get('/daemon-status', (req, res) => {
  const blockMonitor = req.app.locals.blockMonitor;
  if (!blockMonitor) {
    return res.json({});
  }
  res.json(blockMonitor.getDaemonStatus());
});

// Get algorithms list
router.get('/algorithms', (req, res) => {
  res.json(algorithms);
});

// Get merge mining info
router.get('/merge-mining', (req, res) => {
  const groups = {};
  for (const [coinId, coin] of Object.entries(coins)) {
    if (coin.mergeMinedWith) {
      const parentId = coin.mergeMinedWith;
      if (!groups[parentId]) {
        const parent = coins[parentId];
        groups[parentId] = {
          parent: { id: parentId, name: parent.name, symbol: parent.symbol, algorithm: parent.algorithm, stratumPort: parent.stratumPort },
          children: []
        };
      }
      groups[parentId].children.push({ id: coinId, name: coin.name, symbol: coin.symbol, chainId: coin.chainId });
    }
  }
  res.json(groups);
});

// Get supported coins
router.get('/coins', (req, res) => {
  const coinList = Object.entries(coins).map(([id, coin]) => {
    const stats = db.prepare(
      'SELECT * FROM pool_stats WHERE coin = ? ORDER BY created_at DESC LIMIT 1'
    ).get(id);

    // For merge-mined coins, count miners from the parent chain
    const minerCoin = coin.mergeMinedWith || id;
    const miners = db.prepare(
      'SELECT COUNT(DISTINCT user_id) as count FROM workers WHERE coin = ? AND is_online = 1'
    ).get(minerCoin);

    return {
      id,
      ...sanitizeCoin(coin),
      poolHashrate: stats?.hashrate || 0,
      miners: miners?.count || 0,
      networkDifficulty: stats?.difficulty || 0,
      networkHashrate: stats?.network_hashrate || 0,
      blockHeight: stats?.block_height || 0
    };
  });

  res.json(coinList);
});

module.exports = router;
