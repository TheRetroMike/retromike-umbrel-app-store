const db = require('../models/database');
const { coins } = require('../config/coins');
const DaemonRPC = require('./daemonRPC');
const ShareProcessor = require('./shareProcessor');

class BlockMonitor {
  constructor() {
    this.shareProcessor = new ShareProcessor();
    this.intervals = new Map();
    this.daemonStatus = new Map(); // coinId -> { online, syncing, syncProgress, blockHeight, difficulty, networkHashrate }
  }

  // Check if a coin is enabled in the settings DB
  isCoinEnabled(coinId) {
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`coin_${coinId}_enabled`);
      return row ? row.value === 'true' : false; // default disabled
    } catch { return false; }
  }

  start() {
    for (const [coinId, coin] of Object.entries(coins)) {
      const enabled = this.isCoinEnabled(coinId);
      // Initialize status
      this.daemonStatus.set(coinId, {
        online: false,
        syncing: false,
        syncProgress: 0,
        blockHeight: 0,
        difficulty: 0,
        networkHashrate: 0,
        lastChecked: null,
        enabled: enabled
      });
      if (enabled) {
        this.monitorCoin(coinId, coin);
      } else {
        console.log(`[BlockMonitor] ${coin.name} is disabled, skipping`);
      }
    }
    const enabledCount = [...this.daemonStatus.values()].filter(s => s.enabled).length;
    console.log(`[BlockMonitor] Started monitoring ${enabledCount}/${Object.keys(coins).length} enabled coins`);

    // Re-check enabled status every 60 seconds (so admin changes take effect)
    this._enabledCheckInterval = setInterval(() => this._recheckEnabled(), 60000);
  }

  _recheckEnabled() {
    for (const [coinId, coin] of Object.entries(coins)) {
      const enabled = this.isCoinEnabled(coinId);
      const status = this.daemonStatus.get(coinId);
      const wasEnabled = status.enabled;
      status.enabled = enabled;

      if (enabled && !wasEnabled) {
        // Coin was just enabled - start monitoring
        console.log(`[BlockMonitor] ${coin.name} enabled, starting monitor`);
        this.monitorCoin(coinId, coin);
      } else if (!enabled && wasEnabled) {
        // Coin was just disabled - stop monitoring
        console.log(`[BlockMonitor] ${coin.name} disabled, stopping monitor`);
        const interval = this.intervals.get(coinId);
        if (interval) { clearInterval(interval); this.intervals.delete(coinId); }
        status.online = false;
        status.syncing = false;
      }
    }
  }

  monitorCoin(coinId, coin) {
    const doCheck = async () => {
      try {
        await this.checkCoin(coinId, coin);
      } catch (err) {
        const status = this.daemonStatus.get(coinId);
        if (err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT')) {
          status.online = false;
          status.syncing = false;
          status.lastChecked = new Date().toISOString();
        } else {
          console.error(`[BlockMonitor] Error checking ${coin.name}:`, err.message);
          status.online = false;
          status.lastChecked = new Date().toISOString();
        }
        this.daemonStatus.set(coinId, status);
      }
    };

    // Immediate first check
    doCheck();

    const checkInterval = setInterval(doCheck, Math.min(coin.blockTime * 500, 30000));
    this.intervals.set(coinId, checkInterval);
  }

  async checkCoin(coinId, coin) {
    const daemon = new DaemonRPC(coin.daemon);
    const status = this.daemonStatus.get(coinId);

    // Get blockchain info (includes sync status)
    const info = await daemon.getInfo();

    status.online = true;
    status.lastChecked = new Date().toISOString();

    // Check sync progress
    const verificationProgress = info.verificationprogress || 1;
    status.syncProgress = Math.min(verificationProgress * 100, 100);
    status.syncing = verificationProgress < 0.9999;

    const blockHeight = info.blocks || info.headers || 0;
    status.blockHeight = blockHeight;

    // Get difficulty
    let difficulty = 0;
    try {
      difficulty = await daemon.getDifficulty();
      // Some coins return an object { proof-of-work: ..., proof-of-stake: ... }
      if (typeof difficulty === 'object') {
        difficulty = difficulty['proof-of-work'] || 0;
      }
    } catch {
      difficulty = info.difficulty || 0;
    }
    status.difficulty = difficulty;

    // Get network hashrate
    let networkHashrate = 0;
    try {
      networkHashrate = await daemon.getNetworkHashPS();
    } catch {
      // Some coins don't support this
    }
    status.networkHashrate = networkHashrate;

    this.daemonStatus.set(coinId, status);

    // Update pool stats with network info (upsert - INSERT if no row exists)
    const existingRow = db.prepare(
      'SELECT id FROM pool_stats WHERE coin = ? ORDER BY id DESC LIMIT 1'
    ).get(coinId);

    if (existingRow) {
      db.prepare(
        'UPDATE pool_stats SET difficulty = ?, network_hashrate = ?, block_height = ? WHERE id = ?'
      ).run(difficulty, networkHashrate, blockHeight, existingRow.id);
    } else {
      db.prepare(
        'INSERT INTO pool_stats (coin, difficulty, network_hashrate, block_height, hashrate, miners, workers, blocks_found) VALUES (?, ?, ?, ?, 0, 0, 0, 0)'
      ).run(coinId, difficulty, networkHashrate, blockHeight);
    }

    // Check pending blocks for confirmations
    const pendingBlocks = db.prepare(
      "SELECT * FROM blocks WHERE coin = ? AND status = 'pending'"
    ).all(coinId);

    for (const block of pendingBlocks) {
      try {
        const blockData = await daemon.getBlock(block.hash);
        const confirmations = blockData.confirmations || 0;

        db.prepare('UPDATE blocks SET confirmations = ? WHERE id = ?').run(confirmations, block.id);

        if (confirmations >= coin.confirmations) {
          this.shareProcessor.confirmBlock(block.id);
        }

        if (confirmations < 0) {
          this.shareProcessor.orphanBlock(block.id);
        }
      } catch {
        // Block might not be found - could be orphaned
      }
    }
  }

  getDaemonStatus() {
    const result = {};
    for (const [coinId, status] of this.daemonStatus) {
      const coin = coins[coinId];
      result[coinId] = {
        name: coin.name,
        symbol: coin.symbol,
        ...status
      };
    }
    return result;
  }

  stop() {
    if (this._enabledCheckInterval) clearInterval(this._enabledCheckInterval);
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
    console.log('[BlockMonitor] Stopped');
  }
}

module.exports = BlockMonitor;
