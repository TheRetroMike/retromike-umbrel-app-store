const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const dbDir = path.dirname(config.db.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.db.path);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    wallet_address TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_admin INTEGER DEFAULT 0,
    two_factor_secret TEXT,
    payout_threshold REAL DEFAULT 0.01,
    api_key TEXT UNIQUE
  );

  CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    coin TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    hashrate REAL DEFAULT 0,
    shares_valid INTEGER DEFAULT 0,
    shares_invalid INTEGER DEFAULT 0,
    shares_stale INTEGER DEFAULT 0,
    last_share DATETIME,
    is_online INTEGER DEFAULT 0,
    difficulty REAL DEFAULT 1,
    best_share REAL DEFAULT 0,
    connected_at DATETIME,
    disconnected_at DATETIME,
    ip_address TEXT,
    user_agent TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, name, coin)
  );

  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    worker_id INTEGER NOT NULL,
    coin TEXT NOT NULL,
    algorithm TEXT NOT NULL,
    difficulty REAL NOT NULL,
    share_diff REAL NOT NULL,
    is_valid INTEGER DEFAULT 1,
    is_block INTEGER DEFAULT 0,
    block_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (worker_id) REFERENCES workers(id)
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin TEXT NOT NULL,
    height INTEGER NOT NULL,
    hash TEXT NOT NULL,
    reward REAL NOT NULL,
    difficulty REAL NOT NULL,
    finder_id INTEGER,
    worker_name TEXT,
    confirmations INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    confirmed_at DATETIME,
    FOREIGN KEY (finder_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    coin TEXT NOT NULL,
    amount REAL NOT NULL,
    fee REAL DEFAULT 0,
    tx_hash TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    coin TEXT NOT NULL,
    pending REAL DEFAULT 0,
    confirmed REAL DEFAULT 0,
    paid REAL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, coin)
  );

  CREATE TABLE IF NOT EXISTS pool_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coin TEXT NOT NULL,
    hashrate REAL DEFAULT 0,
    miners INTEGER DEFAULT 0,
    workers INTEGER DEFAULT 0,
    blocks_found INTEGER DEFAULT 0,
    last_block_at DATETIME,
    difficulty REAL DEFAULT 0,
    network_hashrate REAL DEFAULT 0,
    block_height INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS hashrate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    coin TEXT NOT NULL,
    hashrate REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_shares_coin ON shares(coin, created_at);
  CREATE INDEX IF NOT EXISTS idx_shares_block ON shares(is_block);
  CREATE INDEX IF NOT EXISTS idx_blocks_coin ON blocks(coin, created_at);
  CREATE INDEX IF NOT EXISTS idx_blocks_status ON blocks(status);
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_workers_user ON workers(user_id);
  CREATE INDEX IF NOT EXISTS idx_hashrate_history ON hashrate_history(user_id, coin, created_at);
  CREATE INDEX IF NOT EXISTS idx_pool_stats_coin ON pool_stats(coin, created_at);

  CREATE TABLE IF NOT EXISTS user_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    coin TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, coin)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_user_addresses ON user_addresses(user_id, coin);
`);

module.exports = db;
