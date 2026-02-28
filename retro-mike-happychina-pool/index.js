require("dotenv").config();
process.on("uncaughtException", (err) => { console.error("[FATAL] Uncaught exception:", err.message); });
process.on("unhandledRejection", (err) => { console.error("[FATAL] Unhandled rejection:", err); });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const cron = require("node-cron");

const config = require("./config");
const db = require("./models/database");
const StratumServer = require("./stratum/server");
const ShareProcessor = require("./services/shareProcessor");
const PaymentProcessor = require("./services/paymentProcessor");
const BlockMonitor = require("./services/blockMonitor");

// API Routes
const authRoutes = require("./api/routes/auth");
const poolRoutes = require("./api/routes/pool");
const minerRoutes = require("./api/routes/miner");
const adminRoutes = require("./api/routes/admin");

const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// UTC Timestamp fix - converts all SQLite timestamps to ISO 8601 with Z suffix
const { utcTimestamps } = require("./middleware/utcTimestamps");
app.use(utcTimestamps);

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/pool", poolRoutes);
app.use("/api/miner", minerRoutes);
app.use("/api/admin", adminRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Serve frontend in production
const frontendPath = path.join(__dirname, "../../frontend/build");
app.use(express.static(frontendPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
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
  const savedSettings = db.prepare("SELECT key, value FROM settings").all();
  for (const { key, value } of savedSettings) {
    switch (key) {
      case "pool_name": config.pool.name = value; break;
      case "pool_fee": config.pool.fee = parseFloat(value); break;
      case "payout_threshold": config.pool.payoutThreshold = parseFloat(value); break;
      case "payout_interval": config.pool.payoutInterval = parseInt(value); break;
    }
  }
  if (savedSettings.length) console.log("[Pool] Loaded " + savedSettings.length + " settings from database");
} catch (e) { /* settings table may not exist yet on first run */ }

// Handle new shares and blocks from stratum
stratumServer.on("block", (blockData) => {
  console.log("[Pool] New block found: " + blockData.coin + " - " + blockData.hash);
  shareProcessor.processBlock(blockData.id);
});

// Scheduled tasks
// Calculate hashrates every 5 minutes
cron.schedule("*/5 * * * *", () => {
  shareProcessor.calculateHashrates();
});

// Process payments every hour
cron.schedule("0 * * * *", () => {
  paymentProcessor.processPayments();
});

// Clean stale workers every 10 minutes
// FIX: Use SQLite datetime() for proper comparison instead of JS Date ISO format
// which caused format mismatch (ISO "T" vs SQLite space) marking ALL workers offline
cron.schedule("*/10 * * * *", () => {
  db.prepare(
    "UPDATE workers SET is_online = 0 WHERE is_online = 1 AND (last_share IS NULL OR last_share < datetime(\"now\", \"-15 minutes\")) AND (connected_at IS NULL OR connected_at < datetime(\"now\", \"-15 minutes\"))"
  ).run();
});


// Prune old shares every 10 minutes (keep last 2 hours to prevent DB bloat)
cron.schedule("*/10 * * * *", () => {
  try {
    const cutoff = new Date(Date.now() - 2 * 3600000).toISOString().slice(0, 19).replace("T", " ");
    const result = db.prepare("DELETE FROM shares WHERE created_at < ?").run(cutoff);
    if (result.changes > 0) {
      console.log("[Cleanup] Pruned " + result.changes + " old shares (before " + cutoff + ")");
      db.pragma("wal_checkpoint(TRUNCATE)");
    }
  } catch (err) {
    console.error("[Cleanup] Share prune error:", err.message);
  }
});

// Prune old hashrate_history and pool_stats (keep last 7 days)
cron.schedule("0 */6 * * *", () => {
  try {
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace("T", " ");
    const r1 = db.prepare("DELETE FROM hashrate_history WHERE created_at < ?").run(cutoff);
    const r2 = db.prepare("DELETE FROM pool_stats WHERE created_at < ?").run(cutoff);
    if (r1.changes + r2.changes > 0) {
      console.log("[Cleanup] Pruned " + r1.changes + " hashrate_history, " + r2.changes + " pool_stats rows");
    }
  } catch (err) {
    console.error("[Cleanup] History prune error:", err.message);
  }
});

// Start HTTP server
app.listen(config.port, config.host, () => {
  console.log("[Pool] HTTP API running on http://" + config.host + ":" + config.port);
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
process.on("SIGINT", () => {
  console.log("[Pool] Shutting down...");
  stratumServer.stop();
  blockMonitor.stop();
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[Pool] Shutting down...");
  stratumServer.stop();
  blockMonitor.stop();
  db.close();
  process.exit(0);
});

console.log("[Pool] Mining Pool Started - API: http://" + config.host + ":" + config.port + " Stratum: " + config.stratum.host + ":" + config.stratum.port + " Fee: " + config.pool.fee + "%");
