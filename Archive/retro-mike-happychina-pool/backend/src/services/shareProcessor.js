const db = require('../models/database');
const config = require('../config');
const { coins } = require('../config/coins');

class ShareProcessor {
  constructor() {
    this.windowSize = 10000;
  }

  processBlock(blockId) {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
    if (!block) return;
    const coin = coins[block.coin];
    if (!coin) return;
    const reward = block.reward;
    const fee = reward * (config.pool.fee / 100);
    const minerReward = reward - fee;
    const shares = db.prepare(
      "SELECT user_id, SUM(difficulty) as total_diff FROM shares WHERE coin = ? AND is_valid = 1 AND id <= (SELECT MAX(id) FROM shares WHERE is_block = 1 AND coin = ?) ORDER BY id DESC LIMIT ?"
    ).all(block.coin, block.coin, this.windowSize);
    if (shares.length === 0) return;
    const totalDifficulty = shares.reduce((sum, s) => sum + s.total_diff, 0);
    const distribute = db.transaction(() => {
      for (const share of shares) {
        const proportion = share.total_diff / totalDifficulty;
        const amount = minerReward * proportion;
        const existing = db.prepare('SELECT id FROM balances WHERE user_id = ? AND coin = ?').get(share.user_id, block.coin);
        if (existing) {
          db.prepare('UPDATE balances SET pending = pending + ? WHERE user_id = ? AND coin = ?').run(amount, share.user_id, block.coin);
        } else {
          db.prepare('INSERT INTO balances (user_id, coin, pending) VALUES (?, ?, ?)').run(share.user_id, block.coin, amount);
        }
      }
    });
    distribute();
    console.log('[ShareProcessor] Block ' + blockId + ' rewards distributed: ' + minerReward + ' ' + coin.symbol + ' across ' + shares.length + ' contributors');
  }

  confirmBlock(blockId) {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
    if (!block || block.status !== 'pending') return;
    db.prepare("UPDATE blocks SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = ?").run(blockId);
    const coin = coins[block.coin];
    if (!coin) return;
    const balances = db.prepare('SELECT * FROM balances WHERE coin = ? AND pending > 0').all(block.coin);
    const confirm = db.transaction(() => {
      for (const balance of balances) {
        db.prepare('UPDATE balances SET confirmed = confirmed + pending, pending = 0 WHERE id = ?').run(balance.id);
      }
    });
    confirm();
    console.log('[ShareProcessor] Block ' + blockId + ' confirmed');
  }

  orphanBlock(blockId) {
    const block = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
    if (!block) return;
    db.prepare("UPDATE blocks SET status = 'orphaned' WHERE id = ?").run(blockId);
    db.prepare('UPDATE balances SET pending = 0 WHERE coin = ? AND pending > 0').run(block.coin);
    console.log('[ShareProcessor] Block ' + blockId + ' orphaned');
  }

  calculateHashrates() {
    // Mark stale workers as offline (no share in last 10 minutes)
    db.prepare("UPDATE workers SET is_online = 0 WHERE is_online = 1 AND last_share < datetime('now', '-10 minutes')").run();

    for (const coinId of Object.keys(coins)) {
      const coin = coins[coinId];
      if (coin.mergeMinedWith) continue;

      const workers = db.prepare('SELECT id, user_id FROM workers WHERE coin = ? AND is_online = 1').all(coinId);
      let poolHashrate = 0;

      for (const worker of workers) {
        const result = db.prepare(
          "SELECT SUM(difficulty) as total_diff, COUNT(*) as share_count FROM shares WHERE worker_id = ? AND created_at >= datetime('now', '-5 minutes') AND is_valid = 1"
        ).get(worker.id);

        // For scrypt: diff 1 = 2^16 hashes. For SHA256: diff 1 = 2^32 hashes.
        var diffMultiplier = coin.algorithm === 'scrypt' ? 65536 : 4294967296;
        var hashrate = result && result.total_diff ? (result.total_diff * diffMultiplier) / 300 : 0;
        db.prepare('UPDATE workers SET hashrate = ? WHERE id = ?').run(hashrate, worker.id);
        poolHashrate += hashrate;
      }

      // Per-user hashrate history
      var userHashrates = db.prepare('SELECT user_id, SUM(hashrate) as total_hashrate FROM workers WHERE coin = ? AND is_online = 1 GROUP BY user_id').all(coinId);
      for (const uh of userHashrates) {
        db.prepare('INSERT INTO hashrate_history (user_id, coin, hashrate) VALUES (?, ?, ?)').run(uh.user_id, coinId, uh.total_hashrate);
      }

      // Pool hashrate history
      db.prepare('INSERT INTO hashrate_history (user_id, coin, hashrate) VALUES (NULL, ?, ?)').run(coinId, poolHashrate);

      // Update pool stats
      var onlineMiners = db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM workers WHERE coin = ? AND is_online = 1').get(coinId);
      var onlineWorkers = db.prepare('SELECT COUNT(*) as count FROM workers WHERE coin = ? AND is_online = 1').get(coinId);
      db.prepare('INSERT INTO pool_stats (coin, hashrate, miners, workers, blocks_found) VALUES (?, ?, ?, ?, (SELECT COUNT(*) FROM blocks WHERE coin = ?))').run(coinId, poolHashrate, onlineMiners.count, onlineWorkers.count, coinId);

      // Propagate to merge-mined children
      for (const [childId, childCoin] of Object.entries(coins)) {
        if (childCoin.mergeMinedWith === coinId && poolHashrate > 0) {
          db.prepare('INSERT INTO pool_stats (coin, hashrate, miners, workers, blocks_found) VALUES (?, ?, ?, ?, (SELECT COUNT(*) FROM blocks WHERE coin = ?))').run(childId, poolHashrate, onlineMiners.count, onlineWorkers.count, childId);
          db.prepare('INSERT INTO hashrate_history (user_id, coin, hashrate) VALUES (NULL, ?, ?)').run(childId, poolHashrate);
        }
      }
    }
    console.log('[ShareProcessor] Hashrates calculated');
  }
}

module.exports = ShareProcessor;
