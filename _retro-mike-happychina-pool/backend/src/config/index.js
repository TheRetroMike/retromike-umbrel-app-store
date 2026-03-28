require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT) || 8080,
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-change-me',
  pool: {
    name: process.env.POOL_NAME || 'MiningPool',
    fee: parseFloat(process.env.POOL_FEE) || 1.0,
    payoutThreshold: parseFloat(process.env.PAYOUT_THRESHOLD) || 0.01,
    payoutInterval: parseInt(process.env.PAYOUT_INTERVAL) || 3600,
  },
  stratum: {
    host: process.env.STRATUM_HOST || '0.0.0.0',
    port: parseInt(process.env.STRATUM_PORT) || 3333,
  },
  db: {
    path: process.env.DB_PATH || './data/pool.db',
  },
};

module.exports = config;
