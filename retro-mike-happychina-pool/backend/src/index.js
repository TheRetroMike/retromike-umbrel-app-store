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

// Fix UTC timestamps: append Z so browsers parse them as UTC, not local time
const dateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (data) => {
    const fixDates = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(fixDates);
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' && dateRegex.test(v)) {
          result[k] = v.replace(' ', 'T') + 'Z';
        } else if (typeof v === 'object' && v !== null) {
          result[k] = fixDates(v);
        } else {
          result[k] = v;
        }
      }
      return result;
    };
    return origJson(fixDates(data));
  };
  next();
});

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
  if (savedSettings.length) console.log('[Pool] Loaded ' + savedSettings.length + ' settings from database');
} catch (e) { /* settings table may not exist yet on first run */ }

// Handle new shares and blocks from stratum
stratumServer.on('block', (blockData) => {
  console.log('[Pool] New block found: ' + blockData.coin + ' - ' + blockData.hash);
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

// Start HTTP server
app.listen(config.port, config.host, () => {
  console.log('[Pool] HTTP API running on http://' + config.host + ':' + config.port);
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

console.log('[Pool] Mining Pool Starting...');
