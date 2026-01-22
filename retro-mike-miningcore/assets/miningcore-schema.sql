-- MiningCore Postgres schema (idempotent)
-- Source: RetroMike guide; adjusted with IF NOT EXISTS for repeatable runs.

SET ROLE miningcore;

CREATE TABLE IF NOT EXISTS shares
(
  poolid TEXT NOT NULL,
  blockheight BIGINT NOT NULL,
  difficulty DOUBLE PRECISION NOT NULL,
  networkdifficulty DOUBLE PRECISION NOT NULL,
  miner TEXT NOT NULL,
  worker TEXT NULL,
  useragent TEXT NULL,
  ipaddress TEXT NOT NULL,
  source TEXT NULL,
  created TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_SHARES_POOL_MINER ON shares(poolid, miner);
CREATE INDEX IF NOT EXISTS IDX_SHARES_POOL_CREATED ON shares(poolid, created);
CREATE INDEX IF NOT EXISTS IDX_SHARES_POOL_MINER_DIFFICULTY ON shares(poolid, miner, difficulty);

CREATE TABLE IF NOT EXISTS blocks
(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  poolid TEXT NOT NULL,
  blockheight BIGINT NOT NULL,
  networkdifficulty DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  type TEXT NULL,
  confirmationprogress FLOAT NOT NULL DEFAULT 0,
  effort FLOAT NULL,
  minereffort FLOAT NULL,
  transactionconfirmationdata TEXT NOT NULL,
  miner TEXT NULL,
  reward decimal(28,12) NULL,
  source TEXT NULL,
  hash TEXT NULL,
  created TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_BLOCKS_POOL_BLOCK_STATUS ON blocks(poolid, blockheight, status);
CREATE INDEX IF NOT EXISTS IDX_BLOCKS_POOL_BLOCK_TYPE ON blocks(poolid, blockheight, type);

CREATE TABLE IF NOT EXISTS balances
(
  poolid TEXT NOT NULL,
  address TEXT NOT NULL,
  amount decimal(28,12) NOT NULL DEFAULT 0,
  created TIMESTAMPTZ NOT NULL,
  updated TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(poolid, address)
);

CREATE TABLE IF NOT EXISTS balance_changes
(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  poolid TEXT NOT NULL,
  address TEXT NOT NULL,
  amount decimal(28,12) NOT NULL DEFAULT 0,
  usage TEXT NULL,
  tags text[] NULL,
  created TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_BALANCE_CHANGES_POOL_ADDRESS_CREATED ON balance_changes(poolid, address, created desc);
CREATE INDEX IF NOT EXISTS IDX_BALANCE_CHANGES_POOL_TAGS ON balance_changes USING gin (tags);

CREATE TABLE IF NOT EXISTS miner_settings
(
  poolid TEXT NOT NULL,
  address TEXT NOT NULL,
  paymentthreshold decimal(28,12) NOT NULL,
  created TIMESTAMPTZ NOT NULL,
  updated TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(poolid, address)
);

CREATE TABLE IF NOT EXISTS payments
(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  poolid TEXT NOT NULL,
  coin TEXT NOT NULL,
  address TEXT NOT NULL,
  amount decimal(28,12) NOT NULL,
  transactionconfirmationdata TEXT NOT NULL,
  created TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_PAYMENTS_POOL_COIN_WALLET ON payments(poolid, coin, address);

CREATE TABLE IF NOT EXISTS poolstats
(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  poolid TEXT NOT NULL,
  connectedminers INT NOT NULL DEFAULT 0,
  poolhashrate DOUBLE PRECISION NOT NULL DEFAULT 0,
  sharespersecond DOUBLE PRECISION NOT NULL DEFAULT 0,
  networkhashrate DOUBLE PRECISION NOT NULL DEFAULT 0,
  networkdifficulty DOUBLE PRECISION NOT NULL DEFAULT 0,
  lastnetworkblocktime TIMESTAMPTZ NULL,
  blockheight BIGINT NOT NULL DEFAULT 0,
  connectedpeers INT NOT NULL DEFAULT 0,
  created TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_POOLSTATS_POOL_CREATED ON poolstats(poolid, created);

CREATE TABLE IF NOT EXISTS minerstats
(
  id BIGSERIAL NOT NULL PRIMARY KEY,
  poolid TEXT NOT NULL,
  miner TEXT NOT NULL,
  worker TEXT NOT NULL,
  hashrate DOUBLE PRECISION NOT NULL DEFAULT 0,
  sharespersecond DOUBLE PRECISION NOT NULL DEFAULT 0,
  created TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS IDX_MINERSTATS_POOL_CREATED ON minerstats(poolid, created);
CREATE INDEX IF NOT EXISTS IDX_MINERSTATS_POOL_MINER_CREATED ON minerstats(poolid, miner, created);
CREATE INDEX IF NOT EXISTS IDX_MINERSTATS_POOL_MINER_WORKER_CREATED_HASHRATE ON minerstats(poolid,miner,worker,created desc,hashrate);
