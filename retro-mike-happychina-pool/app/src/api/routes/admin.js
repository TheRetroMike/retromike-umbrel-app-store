const express = require('express');
const db = require('../../models/database');
const config = require('../../config');
const { authMiddleware, adminMiddleware } = require('../../middleware/auth');
const { coins } = require('../../config/coins');
const { startCoinDaemon, stopCoinDaemon, getCoinDaemonStatus } = require('../../services/dockerControl');

const router = express.Router();

router.use(authMiddleware);
router.use(adminMiddleware);

// Helper: get a setting from DB, fall back to config/env
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

// Admin dashboard
router.get('/dashboard', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const totalWorkers = db.prepare('SELECT COUNT(*) as count FROM workers WHERE is_online = 1').get();
  const totalBlocks = db.prepare('SELECT COUNT(*) as count FROM blocks').get();
  const pendingPayments = db.prepare("SELECT COUNT(*) as count FROM payments WHERE status = 'pending'").get();

  const recentPayments = db.prepare(`
    SELECT p.*, u.username FROM payments p
    JOIN users u ON p.user_id = u.id
    ORDER BY p.created_at DESC LIMIT 10
  `).all();

  const coinBreakdown = {};
  for (const [coinId, coin] of Object.entries(coins)) {
    const stats = db.prepare(
      'SELECT * FROM pool_stats WHERE coin = ? ORDER BY created_at DESC LIMIT 1'
    ).get(coinId);
    const miners = db.prepare(
      'SELECT COUNT(DISTINCT user_id) as count FROM workers WHERE coin = ? AND is_online = 1'
    ).get(coinId);
    coinBreakdown[coinId] = {
      name: coin.name,
      symbol: coin.symbol,
      algorithm: coin.algorithm,
      hashrate: stats?.hashrate || 0,
      miners: miners?.count || 0,
      blocks: db.prepare('SELECT COUNT(*) as count FROM blocks WHERE coin = ?').get(coinId).count
    };
  }

  res.json({
    users: totalUsers.count,
    workers: totalWorkers.count,
    blocks: totalBlocks.count,
    pendingPayments: pendingPayments.count,
    recentPayments,
    coins: coinBreakdown
  });
});

// List users
router.get('/users', (req, res) => {
  const { page = 1, limit = 50, search = '' } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT id, username, email, wallet_address, created_at, last_login, is_admin FROM users';
  let countQuery = 'SELECT COUNT(*) as total FROM users';
  const params = [];

  if (search) {
    query += ' WHERE username LIKE ? OR email LIKE ?';
    countQuery += ' WHERE username LIKE ? OR email LIKE ?';
    params.push(`%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

  const users = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));
  const { total } = db.prepare(countQuery).get(...params);

  // Get worker counts and balances per user
  const enriched = users.map(u => {
    const workerCount = db.prepare('SELECT COUNT(*) as count FROM workers WHERE user_id = ? AND is_online = 1').get(u.id);
    const totalHashrate = db.prepare('SELECT COALESCE(SUM(hashrate), 0) as total FROM workers WHERE user_id = ? AND is_online = 1').get(u.id);
    return {
      ...u,
      activeWorkers: workerCount.count,
      hashrate: totalHashrate.total
    };
  });

  res.json({
    users: enriched,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
  });
});

// Ban/unban user
router.post('/users/:id/ban', (req, res) => {
  const { id } = req.params;
  db.prepare('UPDATE workers SET is_online = 0 WHERE user_id = ?').run(id);
  res.json({ message: 'User banned' });
});

// Toggle admin
router.post('/users/:id/toggle-admin', (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'Cannot change your own admin status' });
  }
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(user.is_admin ? 0 : 1, id);
  res.json({ message: user.is_admin ? 'Admin removed' : 'Admin granted', is_admin: !user.is_admin });
});

// Manual payment processing
router.post('/payments/process', (req, res) => {
  const pending = db.prepare("SELECT COUNT(*) as count FROM payments WHERE status = 'pending'").get();
  // Trigger the payment processor via app locals if available
  const paymentProcessor = req.app.locals.paymentProcessor;
  if (paymentProcessor) {
    paymentProcessor.processPayments().catch(err => console.error('[Admin] Payment error:', err));
    res.json({ message: `Triggered payment processing (${pending.count} pending)`, count: pending.count });
  } else {
    res.json({ message: `${pending.count} payments pending`, count: pending.count });
  }
});

// Get pool settings
router.get('/settings', (req, res) => {
  res.json({
    pool_name: getSetting('pool_name', config.pool.name),
    pool_fee: parseFloat(getSetting('pool_fee', config.pool.fee)),
    payout_threshold: parseFloat(getSetting('payout_threshold', config.pool.payoutThreshold)),
    payout_interval: parseInt(getSetting('payout_interval', config.pool.payoutInterval)),
    stratum_host: config.stratum.host
  });
});

// Update pool settings
router.put('/settings', (req, res) => {
  const { pool_name, pool_fee, payout_threshold, payout_interval } = req.body;

  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction(() => {
    if (pool_name !== undefined) {
      upsert.run('pool_name', String(pool_name));
      config.pool.name = String(pool_name);
    }
    if (pool_fee !== undefined) {
      const fee = parseFloat(pool_fee);
      if (fee < 0 || fee > 100) return res.status(400).json({ error: 'Fee must be 0-100' });
      upsert.run('pool_fee', String(fee));
      config.pool.fee = fee;
    }
    if (payout_threshold !== undefined) {
      const thresh = parseFloat(payout_threshold);
      if (thresh < 0) return res.status(400).json({ error: 'Threshold must be positive' });
      upsert.run('payout_threshold', String(thresh));
      config.pool.payoutThreshold = thresh;
    }
    if (payout_interval !== undefined) {
      const interval = parseInt(payout_interval);
      if (interval < 60) return res.status(400).json({ error: 'Interval must be at least 60 seconds' });
      upsert.run('payout_interval', String(interval));
      config.pool.payoutInterval = interval;
    }
  });

  transaction();
  res.json({ message: 'Settings updated' });
});

// Get per-coin settings
router.get('/coins', (req, res) => {
  const coinSettings = {};
  for (const [coinId, coin] of Object.entries(coins)) {
    const pruned = getSetting(`coin_${coinId}_pruned`, 'false');
    const enabled = getSetting(`coin_${coinId}_enabled`, 'false');
    coinSettings[coinId] = {
      name: coin.name,
      symbol: coin.symbol,
      algorithm: coin.algorithm,
      stratumPort: coin.mergeMinedWith ? coins[coin.mergeMinedWith].stratumPort : coin.stratumPort,
      mergeMinedWith: coin.mergeMinedWith || null,
      pruned: pruned === 'true',
      enabled: enabled === 'true'
    };
  }
  res.json(coinSettings);
});

// Update per-coin settings (enable/disable starts/stops daemon container)
router.put('/coins/:coinId', async (req, res) => {
  const { coinId } = req.params;
  if (!coins[coinId]) return res.status(404).json({ error: 'Coin not found' });

  const { pruned, enabled } = req.body;
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  if (pruned !== undefined) upsert.run(`coin_${coinId}_pruned`, String(pruned));
  if (enabled !== undefined) {
    upsert.run(`coin_${coinId}_enabled`, String(enabled));

    // Start or stop the daemon container
    try {
      if (enabled === true || enabled === 'true') {
        const result = await startCoinDaemon(coinId);
        console.log(`[Admin] Started daemon for ${coins[coinId].name}:`, result.action);
        return res.json({ message: `${coins[coinId].name} enabled - daemon ${result.action}`, daemon: result });
      } else {
        const result = await stopCoinDaemon(coinId);
        console.log(`[Admin] Stopped daemon for ${coins[coinId].name}:`, result.action);
        return res.json({ message: `${coins[coinId].name} disabled - daemon ${result.action}`, daemon: result });
      }
    } catch (err) {
      console.error(`[Admin] Docker control error for ${coinId}:`, err.message);
      return res.json({ message: `${coins[coinId].name} settings updated (daemon control failed: ${err.message})`, error: err.message });
    }
  }

  res.json({ message: `${coins[coinId].name} settings updated` });
});

// Reset all coin settings to defaults (all disabled, not pruned)
router.post('/coins/reset', (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction(() => {
    for (const coinId of Object.keys(coins)) {
      upsert.run(`coin_${coinId}_enabled`, 'false');
      upsert.run(`coin_${coinId}_pruned`, 'false');
    }
  });

  transaction();

  // Stop all daemon containers
  const stopPromises = Object.keys(coins).map(coinId =>
    stopCoinDaemon(coinId).catch(err => console.error(`[Admin] Error stopping ${coinId}:`, err.message))
  );

  Promise.all(stopPromises).then(() => {
    res.json({ message: 'All coin settings reset to defaults. All daemons stopped.' });
  }).catch(() => {
    res.json({ message: 'Settings reset. Some daemons may still be running.' });
  });
});

// Get recent payments list
router.get('/payments', (req, res) => {
  const { page = 1, limit = 50, status, coin } = req.query;
  const offset = (page - 1) * limit;

  let query = `SELECT p.*, u.username FROM payments p JOIN users u ON p.user_id = u.id`;
  let countQuery = 'SELECT COUNT(*) as total FROM payments p';
  const conditions = [];
  const params = [];

  if (status) { conditions.push('p.status = ?'); params.push(status); }
  if (coin) { conditions.push('p.coin = ?'); params.push(coin); }

  if (conditions.length) {
    const where = ' WHERE ' + conditions.join(' AND ');
    query += where;
    countQuery += where;
  }

  query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';

  const payments = db.prepare(query).all(...params, parseInt(limit), parseInt(offset));
  const { total } = db.prepare(countQuery).get(...params);

  res.json({
    payments,
    pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
  });
});

module.exports = router;
