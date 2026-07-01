const db = require('../models/database');
const config = require('../config');
const { coins } = require('../config/coins');

class ShareProcessor {
  constructor() {
    this.windowSize = 10000; // PPLNS window size (last N shares)
  }

  /**
   * Process block reward distribution using PPLNS
   */
  processBlock(blockId) {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
    if (!block) return;

    const coin = coins[block.coin];
    if (!coin) return;

    const reward = block.reward;
    const fee = reward * (config.pool.fee / 100);
    const minerReward = reward - fee;

    // Get last N shares for PPLNS
    const shares = db.prepare(`
      SELECT user_id, SUM(difficulty) as total_diff
      FROM shares
      WHERE coin = ? AND is_valid = 1
      AND id <= (SELECT MAX(id) FROM shares WHERE is_block = 1 AND coin = ?)
      ORDER BY id DESC
      LIMIT ?
    `).all(block.coin, block.coin, this.windowSize);

    if (shares.length === 0) return;

    const totalDifficulty = shares.reduce((sum, s) => sum + s.total_diff, 0);

    // Distribute rewards
    const distribute = db.transaction(() => {
      for (const share of shares) {
        const proportion = share.total_diff / totalDifficulty;
        const amount = minerReward * proportion;

        // Update or create balance
        const existing = db.prepare(
          'SELECT id FROM balances WHERE user_id = ? AND coin = ?'
        ).get(share.user_id, block.coin);

        if (existing) {
          db.prepare(
            'UPDATE balances SET pending = pending + ? WHERE user_id = ? AND coin = ?'
          ).run(amount, share.user_id, block.coin);
        } else {
          db.prepare(
            'INSERT INTO balances (user_id, coin, pending) VALUES (?, ?, ?)'
          ).run(share.user_id, block.coin, amount);
        }
      }
    });

    distribute();
    console.log(`[ShareProcessor] Block ${blockId} rewards distributed: ${minerReward} ${coin.symbol} across ${shares.length} contributors`);
  }

  /**
   * Confirm block and move pending balance to confirmed
   */
  confirmBlock(blockId) {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
    if (!block || block.status !== 'pending') return;

    db.prepare("UPDATE blocks SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?").run(blockId);

    // Move pending to confirmed for all users who had shares
    const coin = coins[block.coin];
    if (!coin) return;

    const balances = db.prepare(
      'SELECT * FROM balances WHERE coin = ? AND pending > 0'
    ).all(block.coin);

    const confirm = db.transaction(() => {
      for (const balance of balances) {
        db.prepare(
          'UPDATE balances SET confirmed = confirmed + pending, pending = 0 WHERE id = ?'
        ).run(balance.id);
      }
    });

    confirm();
    console.log(`[ShareProcessor] Block ${blockId} confirmed`);
  }

  /**
   * Orphan a block and remove pending balances
   */
  orphanBlock(blockId) {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
    if (!block) return;

    db.prepare("UPDATE blocks SET status = 'orphaned' WHERE id = ?").run(blockId);

    // Reset pending balances for this coin
    db.prepare(
      'UPDATE balances SET pending = 0 WHERE coin = ? AND pending > 0'
    ).run(block.coin);

    console.log(`[ShareProcessor] Block ${blockId} orphaned`);
  }

  /**
   * Calculate hashrates for all miners and pool
   */
  calculateHashrates() {
    const fiveMinAgo = "datetime('now', '-5 minutes')";

    for (const coinId of Object.keys(coins)) {
      // Per-worker hashrate
      const workers = db.prepare(
        'SELECT id, user_id FROM workers WHERE coin = ? AND is_online = 1'
      ).all(coinId);

      let poolHashrate = 0;

      for (const worker of workers) {
        const result = db.prepare(`
          SELECT SUM(difficulty) as total_diff, COUNT(*) as share_count
          FROM shares
          WHERE worker_id = ? AND created_at >= ${fiveMinAgo} AND is_valid = 1
        `).get(worker.id);

        // Scrypt diff uses 2^16 base (maxTarget is 2^16x larger than Bitcoin's)
        const coin = coins[coinId];
        const diffMultiplier = coin?.algorithm === 'scrypt' ? Math.pow(2, 16) : Math.pow(2, 32);
        const hashrate = result?.total_diff ? (result.total_diff * diffMultiplier) / 300 : 0;

        db.prepare('UPDATE workers SET hashrate = ? WHERE id = ?').run(hashrate, worker.id);
        poolHashrate += hashrate;
      }

      // Per-user hashrate history
      const userHashrates = db.prepare(`
        SELECT user_id, SUM(hashrate) as total_hashrate
        FROM workers
        WHERE coin = ? AND is_online = 1
        GROUP BY user_id
      `).all(coinId);

      for (const uh of userHashrates) {
        db.prepare(
          'INSERT INTO hashrate_history (user_id, coin, hashrate) VALUES (?, ?, ?)'
        ).run(uh.user_id, coinId, uh.total_hashrate);
      }

      // Pool hashrate history
      db.prepare(
        'INSERT INTO hashrate_history (user_id, coin, hashrate) VALUES (NULL, ?, ?)'
      ).run(coinId, poolHashrate);

      // Update pool stats
      const onlineMiners = db.prepare(
        'SELECT COUNT(DISTINCT user_id) as count FROM workers WHERE coin = ? AND is_online = 1'
      ).get(coinId);

      const onlineWorkers = db.prepare(
        'SELECT COUNT(*) as count FROM workers WHERE coin = ? AND is_online = 1'
      ).get(coinId);

      db.prepare(`
        INSERT INTO pool_stats (coin, hashrate, miners, workers, blocks_found)
        VALUES (?, ?, ?, ?, (SELECT COUNT(*) FROM blocks WHERE coin = ?))
      `).run(coinId, poolHashrate, onlineMiners.count, onlineWorkers.count, coinId);
    }

    // Propagate parent chain hashrate to merge-mined coins
    for (const [coinId, coin] of Object.entries(coins)) {
      if (coin.mergeMinedWith) {
        const parentStats = db.prepare(
          'SELECT hashrate FROM pool_stats WHERE coin = ? ORDER BY created_at DESC LIMIT 1'
        ).get(coin.mergeMinedWith);
        if (parentStats && parentStats.hashrate > 0) {
          const existingStats = db.prepare(
            'SELECT hashrate FROM pool_stats WHERE coin = ? ORDER BY created_at DESC LIMIT 1'
          ).get(coinId);
          if (!existingStats || existingStats.hashrate === 0) {
            db.prepare(`
              INSERT INTO pool_stats (coin, hashrate, miners, workers, blocks_found)
              VALUES (?, ?,
                (SELECT COUNT(DISTINCT user_id) FROM workers WHERE coin = ? AND is_online = 1),
                (SELECT COUNT(*) FROM workers WHERE coin = ? AND is_online = 1),
                (SELECT COUNT(*) FROM blocks WHERE coin = ?))
            `).run(coinId, parentStats.hashrate, coin.mergeMinedWith, coin.mergeMinedWith, coinId);
          }
        }
      }
    }

    console.log('[ShareProcessor] Hashrates calculated');
  }
}

module.exports = ShareProcessor;
