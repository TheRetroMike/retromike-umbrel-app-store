require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const cron = require('node-cron');

const config = require('./config');
const db = require('./models/database');
const StratumServer = require('./stratum/server');
const ShareProcessor = require('./services/shareProcessor');
const PaymentProcessor = require('./services/paymentProcessor');
const BlockMonitor = require('./services/blockMonitor');

// API Routes
const authRoutes = require('./api/routes/auth');
const poolRoutes = require('./api/routes/pool');
const minerRoutes = require('./api/routes/miner');
const adminRoutes = require('./api/routes/admin');

const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// UTC Timestamp fix - converts all SQLite "YYYY-MM-DD HH:MM:SS" timestamps
// to proper ISO 8601 "YYYY-MM-DDTHH:MM:SSZ" so frontend Date() treats them as UTC
const { utcTimestamps } = require('./middleware/utcTimestamps');
app.use(utcTimestamps);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/pool', poolRoutes);
app.use('/api/miner', minerRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Serve frontend in production
const frontendPath = path.join(__dirname, '../../frontend/build');
app.use(express.static(frontendPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Start services
const stratumServer = new StratumServer();
const shareProcessor = new ShareProcessor();
const paymentProcessor = new PaymentProcessor();
const blockMonitor = new BlockMonitor();

// Make services accessible to routes
app.locals.blockMonitor = blockMonitor;
app.locals.paymentProcessor = paymentProcessor;

// Load saved settings from DB into runtime config
try {
  const savedSettings = db.prepare('SELECT key, value FROM settings').all();
  for (const { key, value } of savedSettings) {
    switch (key) {
      case 'pool_name': config.pool.name = value; break;
      case 'pool_fee': config.pool.fee = parseFloat(value); break;
      case 'payout_threshold': config.pool.payoutThreshold = parseFloat(value); break;
      case 'payout_interval': config.pool.payoutInterval = parseInt(value); break;
    }
  }
  if (savedSettings.length) console.log(`[Pool] Loaded ${savedSettings.length} settings from database`);
} catch (e) { /* settings table may not exist yet on first run */ }

// Handle new shares and blocks from stratum
stratumServer.on('block', (blockData) => {
  console.log(`[Pool] New block found: ${blockData.coin} - ${blockData.hash}`);
  shareProcessor.processBlock(blockData.id);
});

// Scheduled tasks
// Calculate hashrates every 5 minutes
cron.schedule('*/5 * * * *', () => {
  shareProcessor.calculateHashrates();
});

// Process payments every hour
cron.schedule('0 * * * *', () => {
  paymentProcessor.processPayments();
});

// Update heartbeats for connected stratum workers every 5 minutes
cron.schedule('*/5 * * * *', () => {
  stratumServer.updateWorkerHeartbeats();
});

// Clean stale workers every 10 minutes
cron.schedule('*/10 * * * *', () => {
  // Use SQLite datetime() for proper comparison (CURRENT_TIMESTAMP format: 'YYYY-MM-DD HH:MM:SS')
  // Only mark offline if both last_share AND connected_at are older than 15 minutes
  // This prevents marking workers offline that are connected but haven't submitted a share yet
  // (e.g. high difficulty coins where shares are infrequent)
  const staleWorkers = db.prepare(`
    UPDATE workers SET is_online = 0
    WHERE is_online = 1
      AND (last_share IS NULL OR last_share < datetime('now', '-15 minutes'))
      AND (connected_at IS NULL OR connected_at < datetime('now', '-15 minutes'))
  `).run();

  // Also cross-check with active stratum connections
  const onlineWorkerIds = [];
  for (const client of stratumServer.clients.values()) {
    if (client.authorized && client.workerId) {
      onlineWorkerIds.push(client.workerId);
    }
  }

  // Re-mark workers as online if they have an active stratum connection
  if (onlineWorkerIds.length > 0) {
    const placeholders = onlineWorkerIds.map(() => '?').join(',');
    db.prepare(
      `UPDATE workers SET is_online = 1 WHERE id IN (${placeholders}) AND is_online = 0`
    ).run(...onlineWorkerIds);
  }
});

// Start HTTP server
app.listen(config.port, config.host, () => {
  console.log(`[Pool] HTTP API running on http://${config.host}:${config.port}`);
});

// Start Stratum server
stratumServer.start();

// Start block monitor
blockMonitor.start();

// Initial hashrate calculation
setTimeout(() => {
  shareProcessor.calculateHashrates();
}, 5000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[Pool] Shutting down...');
  stratumServer.stop();
  blockMonitor.stop();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[Pool] Shutting down...');
  stratumServer.stop();
  blockMonitor.stop();
  db.close();
  process.exit(0);
});

console.log(`
╔══════════════════════════════════════════╗
║         Mining Pool Started              ║
║                                          ║
║  API:     http://${config.host}:${config.port}          ║
║  Stratum: ${config.stratum.host}:${config.stratum.port}+          ║
║  Fee:     ${config.pool.fee}%                          ║
╚══════════════════════════════════════════╝
`);
