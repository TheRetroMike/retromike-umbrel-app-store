const express = require('express');
const db = require('../../models/database');
const { authMiddleware } = require('../../middleware/auth');
const { coins } = require('../../config/coins');

const router = express.Router();

// Get miner dashboard summary
router.get('/dashboard', authMiddleware, (req, res) => {
  const userId = req.user.id;

  const workers = db.prepare(
    'SELECT * FROM workers WHERE user_id = ? ORDER BY coin, name'
  ).all(userId);

  const balances = db.prepare(
    'SELECT * FROM balances WHERE user_id = ?'
  ).all(userId);

  const recentPayments = db.prepare(
    'SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10'
  ).all(userId);

  const totalHashrate = {};
  const onlineWorkers = {};

  for (const worker of workers) {
    if (!totalHashrate[worker.coin]) {
      totalHashrate[worker.coin] = 0;
      onlineWorkers[worker.coin] = 0;
    }
    if (worker.is_online) {
      totalHashrate[worker.coin] += worker.hashrate;
      onlineWorkers[worker.coin]++;
    }
  }

  // Merge-mined coins share the parent chain's hashrate
  for (const [coinId, coin] of Object.entries(coins)) {
    if (coin.mergeMinedWith && totalHashrate[coin.mergeMinedWith] && !totalHashrate[coinId]) {
      totalHashrate[coinId] = totalHashrate[coin.mergeMinedWith];
      onlineWorkers[coinId] = onlineWorkers[coin.mergeMinedWith] || 0;
    }
  }

  const blocksFound = db.prepare(
    'SELECT coin, COUNT(*) as count FROM blocks WHERE finder_id = ? GROUP BY coin'
  ).all(userId);

  res.json({
    workers,
    balances,
    recentPayments,
    totalHashrate,
    onlineWorkers,
    blocksFound,
    workerCount: workers.length
  });
});

// Get miner workers
router.get('/workers', authMiddleware, (req, res) => {
  const { coin } = req.query;
  let query = 'SELECT * FROM workers WHERE user_id = ?';
  const params = [req.user.id];

  if (coin) {
    query += ' AND coin = ?';
    params.push(coin);
  }

  query += ' ORDER BY coin, name';
  const workers = db.prepare(query).all(...params);
  res.json(workers);
});

// Get miner hashrate history
router.get('/hashrate', authMiddleware, (req, res) => {
  const { coin, period = '24h' } = req.query;

  let limit;
  switch (period) {
    case '1h': limit = 12; break;
    case '6h': limit = 72; break;
    case '24h': limit = 288; break;
    case '7d': limit = 2016; break;
    case '30d': limit = 8640; break;
    default: limit = 288;
  }

  let query = 'SELECT hashrate, coin, created_at FROM hashrate_history WHERE user_id = ?';
  const params = [req.user.id];

  if (coin) {
    query += ' AND coin = ?';
    params.push(coin);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const history = db.prepare(query).all(...params).reverse();
  res.json(history);
});

// Get miner payments
router.get('/payments', authMiddleware, (req, res) => {
  const { coin, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM payments WHERE user_id = ?';
  let countQuery = 'SELECT COUNT(*) as total FROM payments WHERE user_id = ?';
  const params = [req.user.id];

  if (coin) {
    query += ' AND coin = ?';
    countQuery += ' AND coin = ?';
    params.push(coin);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const payments = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));
  const { total } = db.prepare(countQuery).get(...params);

  res.json({
    payments,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});

// Get miner balances
router.get('/balances', authMiddleware, (req, res) => {
  const balances = db.prepare('SELECT * FROM balances WHERE user_id = ?').all(req.user.id);
  res.json(balances);
});

// Get miner shares
router.get('/shares', authMiddleware, (req, res) => {
  const { coin, period = '24h' } = req.query;

  let timeFilter;
  switch (period) {
    case '1h': timeFilter = "datetime('now', '-1 hour')"; break;
    case '6h': timeFilter = "datetime('now', '-6 hours')"; break;
    case '24h': timeFilter = "datetime('now', '-24 hours')"; break;
    case '7d': timeFilter = "datetime('now', '-7 days')"; break;
    default: timeFilter = "datetime('now', '-24 hours')";
  }

  let query = `
    SELECT coin,
           SUM(CASE WHEN is_valid = 1 THEN 1 ELSE 0 END) as valid,
           SUM(CASE WHEN is_valid = 0 THEN 1 ELSE 0 END) as invalid,
           SUM(difficulty) as total_difficulty
    FROM shares
    WHERE user_id = ? AND created_at >= ${timeFilter}
  `;
  const params = [req.user.id];

  if (coin) {
    query += ' AND coin = ?';
    params.push(coin);
  }

  query += ' GROUP BY coin';

  const shares = db.prepare(query).all(...params);
  res.json(shares);
});

// Get miner earnings estimate
router.get('/earnings', authMiddleware, (req, res) => {
  const { coin } = req.query;

  let query = `
    SELECT w.coin, SUM(w.hashrate) as hashrate
    FROM workers w
    WHERE w.user_id = ? AND w.is_online = 1
  `;
  const params = [req.user.id];

  if (coin) {
    query += ' AND w.coin = ?';
    params.push(coin);
  }

  query += ' GROUP BY w.coin';

  const workerStats = db.prepare(query).all(...params);

  const earnings = workerStats.map(stat => {
    const coinConfig = coins[stat.coin];
    if (!coinConfig) return null;

    const poolStats = db.prepare(
      'SELECT * FROM pool_stats WHERE coin = ? ORDER BY created_at DESC LIMIT 1'
    ).get(stat.coin);

    const networkDiff = poolStats?.difficulty || 1;
    const blockReward = coinConfig.reward;
    const blockTime = coinConfig.blockTime;

    // Simplified earning estimate
    const dailyBlocks = 86400 / blockTime;
    const poolHashrate = poolStats?.hashrate || 1;
    const minerShare = poolHashrate > 0 ? stat.hashrate / poolHashrate : 0;
    const dailyEarnings = dailyBlocks * blockReward * minerShare * (1 - (require('../../config').pool.fee / 100));

    return {
      coin: stat.coin,
      symbol: coinConfig.symbol,
      hashrate: stat.hashrate,
      daily: dailyEarnings,
      weekly: dailyEarnings * 7,
      monthly: dailyEarnings * 30
    };
  }).filter(Boolean);

  res.json(earnings);
});

module.exports = router;
