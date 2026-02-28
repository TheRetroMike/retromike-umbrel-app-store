const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');
const db = require('../models/database');
const { coins } = require('../config/coins');
const config = require('../config');
const DaemonRPC = require('../services/daemonRPC');
const auxpow = require('./auxpow');

// Reverse bytes of a hex string (for Bitcoin endianness)
function reverseHex(hex) {
  return Buffer.from(hex, 'hex').reverse().toString('hex');
}

// Double SHA-256
function sha256d(buffer) {
  return crypto.createHash('sha256').update(
    crypto.createHash('sha256').update(buffer).digest()
  ).digest();
}

// Scrypt hash using Node.js crypto (RFC 7914 - correct for Litecoin)
function scryptHash(buffer) {
  return crypto.scryptSync(buffer, buffer, 32, { N: 1024, r: 1, p: 1 });
}

// Yiimp ser_string_be: swap bytes within each 4-byte (8 hex char) group
// Equivalent to be32enc on binary data
function serStringBe(hex) {
  let out = '';
  for (let i = 0; i < hex.length; i += 8) {
    const g = hex.substring(i, i + 8);
    out += g[6]+g[7] + g[4]+g[5] + g[2]+g[3] + g[0]+g[1];
  }
  return out;
}

// Yiimp ser_string_be2: reverse ORDER of 4-byte (8 hex char) groups
// Used to convert display prevhash to stratum prevhash format
function serStringBe2(hex) {
  let out = '';
  const groups = hex.length / 8;
  for (let i = groups - 1; i >= 0; i--) {
    out += hex.substring(i * 8, i * 8 + 8);
  }
  return out;
}

// Build block header using Yiimp's method (produces wire format)
// Takes stratum-format fields, returns 80-byte binary header
function buildHeaderYiimp(version, prevhashStratum, merkleRootHex, ntime, nbits, nonce) {
  const merkleBe = serStringBe(merkleRootHex);
  const headerHex = version + prevhashStratum + merkleBe + ntime + nbits + nonce;
  const headerBeHex = serStringBe(headerHex);
  return Buffer.from(headerBeHex, 'hex');
}

// Verify scrypt at startup against known Litecoin block 3060500
(() => {
  const knownHeader = Buffer.from('000000200b1fc195e4edace423c8ebe30f3ccfd74ca6c9deeed907409b3694d4438be8f1eee9338b7e503ccd60e77527f42502f3f21864e2eab7713094f2f8f33f5b99128da89a697d512919c59c99e6', 'hex');
  const hash = scryptHash(knownHeader);
  const hashRev = Buffer.from(hash).reverse().toString('hex');
  const ok = hashRev.startsWith('000000000000000');
  console.log(`[Stratum] scrypt verification: ${ok ? 'PASS' : 'FAIL'} hash=${hashRev.substring(0,24)}...`);
})();

// Compute merkle root from coinbase hash and merkle branches
function computeMerkleRoot(coinbaseHash, merkleBranches) {
  let hash = Buffer.from(coinbaseHash, 'hex');
  for (const branch of merkleBranches) {
    const branchBuf = Buffer.from(branch, 'hex');
    hash = sha256d(Buffer.concat([hash, branchBuf]));
  }
  return hash.toString('hex');
}

// Max targets for difficulty calculation
// Bitcoin (SHA-256): 0x00000000ffff0000...
// Scrypt: 0x0000ffff00000000... (256x larger - Litecoin uses different base difficulty)
const MAX_TARGET_SHA256 = BigInt('0x00000000ffff0000000000000000000000000000000000000000000000000000');
const MAX_TARGET_SCRYPT = BigInt('0x0000ffff00000000000000000000000000000000000000000000000000000000');

// Difficulty to target (256-bit) for comparison
function difficultyToTarget(difficulty, algorithm) {
  const maxTargetBig = algorithm === 'scrypt' ? MAX_TARGET_SCRYPT : MAX_TARGET_SHA256;
  let targetBig = maxTargetBig / BigInt(Math.max(1, Math.floor(difficulty)));
  const targetHex = targetBig.toString(16).padStart(64, '0');
  return Buffer.from(targetHex, 'hex');
}

// Convert nbits (compact target) to a 256-bit target buffer
function nbitsToTarget(nbits) {
  const nbitsBuf = Buffer.from(nbits, 'hex');
  const exponent = nbitsBuf[0];
  const mantissa = (nbitsBuf[1] << 16) | (nbitsBuf[2] << 8) | nbitsBuf[3];
  const target = Buffer.alloc(32, 0);
  const byteOffset = exponent - 3;
  if (byteOffset >= 0 && byteOffset < 30) {
    target[32 - byteOffset - 3] = (mantissa >> 16) & 0xff;
    target[32 - byteOffset - 2] = (mantissa >> 8) & 0xff;
    target[32 - byteOffset - 1] = mantissa & 0xff;
  }
  return target;
}

// Compare two 32-byte buffers (hash <= target means valid)
function hashMeetsTarget(hash, target) {
  for (let i = 0; i < 32; i++) {
    if (hash[i] < target[i]) return true;
    if (hash[i] > target[i]) return false;
  }
  return true; // equal
}

// Build a coinbase transaction (for SegWit block submission - includes witness data)
function buildCoinbaseTx(template, extraNonce1, extraNonce2Hex, coinId, mergeCommitment) {
  const coin = coins[coinId];
  // Coinbase script: block height (BIP34) + extranonce1 + extranonce2 + arbitrary data
  const height = template.height;

  // Serialize height as script number (BIP34)
  let heightScript;
  if (height <= 16) {
    heightScript = Buffer.from([0x51 + height - 1]);
  } else if (height <= 0x7f) {
    heightScript = Buffer.from([0x01, height]);
  } else if (height <= 0x7fff) {
    heightScript = Buffer.from([0x02, height & 0xff, (height >> 8) & 0xff]);
  } else if (height <= 0x7fffff) {
    heightScript = Buffer.from([0x03, height & 0xff, (height >> 8) & 0xff, (height >> 16) & 0xff]);
  } else {
    heightScript = Buffer.from([0x04, height & 0xff, (height >> 8) & 0xff, (height >> 16) & 0xff, (height >> 24) & 0xff]);
  }

  const poolTag = Buffer.from('/NodePool/', 'ascii');
  const extraNonce1Buf = Buffer.from(extraNonce1, 'hex');
  const extraNonce2Buf = Buffer.from(extraNonce2Hex, 'hex');

  const scriptParts = [heightScript, extraNonce1Buf, extraNonce2Buf, poolTag];
  if (mergeCommitment) {
    scriptParts.push(mergeCommitment);
  }
  const coinbaseScript = Buffer.concat(scriptParts);

  // Coinbase value = sum of template coinbasevalue
  const coinbaseValue = template.coinbasevalue;

  // Default address from template (coinbasetxn) or use a pool address placeholder
  const outputScript = template.coinbasetxn?.data
    ? null // We'll use the default_witness_commitment if available
    : null;

  // Build raw transaction
  const parts = [];

  // Version (4 bytes LE)
  const version = Buffer.alloc(4);
  version.writeUInt32LE(coin.segwit ? 2 : 1);
  parts.push(version);

  // SegWit marker + flag
  if (coin.segwit) {
    parts.push(Buffer.from([0x00, 0x01]));
  }

  // Input count (varint: 1)
  parts.push(Buffer.from([0x01]));

  // Input: prev tx hash (32 bytes of zeros for coinbase)
  parts.push(Buffer.alloc(32, 0));
  // Input: prev output index (0xffffffff)
  parts.push(Buffer.from('ffffffff', 'hex'));
  // Input: script length + script
  const scriptLen = writeVarInt(coinbaseScript.length);
  parts.push(scriptLen);
  parts.push(coinbaseScript);
  // Input: sequence
  parts.push(Buffer.from('ffffffff', 'hex'));

  // Outputs
  const hasWitnessCommitment = coin.segwit && template.default_witness_commitment;
  const outputCount = hasWitnessCommitment ? 2 : 1;
  parts.push(Buffer.from([outputCount]));

  // Output 1: Block reward to coinbase address
  // Value (8 bytes LE)
  const valueBuf = Buffer.alloc(8);
  valueBuf.writeBigUInt64LE(BigInt(coinbaseValue));
  parts.push(valueBuf);

  // Output script: Use coinbaseaux/scriptPubKey from template, or pool address
  const scriptPubKey = template.coinbasetxn?.scriptPubKey
    ? Buffer.from(template.coinbasetxn.scriptPubKey, 'hex')
    : (template._poolScriptPubKey || Buffer.from('51', 'hex'));
  const pubKeyLen = writeVarInt(scriptPubKey.length);
  parts.push(pubKeyLen);
  parts.push(scriptPubKey);

  // Output 2: SegWit commitment (if applicable)
  if (hasWitnessCommitment) {
    const commitValue = Buffer.alloc(8, 0); // 0 value
    parts.push(commitValue);
    const commitScript = Buffer.from(template.default_witness_commitment, 'hex');
    const commitLen = writeVarInt(commitScript.length);
    parts.push(commitLen);
    parts.push(commitScript);
  }

  // SegWit witness data for coinbase
  if (coin.segwit) {
    // Witness stack count: 1
    parts.push(Buffer.from([0x01]));
    // Witness item: 32 bytes of zeros (witness reserved value)
    parts.push(Buffer.from([0x20]));
    parts.push(Buffer.alloc(32, 0));
  }

  // Locktime (4 bytes)
  parts.push(Buffer.alloc(4, 0));

  return Buffer.concat(parts);
}

function writeVarInt(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(n, 1);
    return buf;
  }
  const buf = Buffer.alloc(5);
  buf[0] = 0xfe;
  buf.writeUInt32LE(n, 1);
  return buf;
}

// Split coinbase tx into coinbase1 and coinbase2 around extranonce placeholders
function splitCoinbaseTx(template, coinId, mergeCommitment) {
  const coin = coins[coinId];
  const height = template.height;

  // Height serialization (BIP34)
  let heightScript;
  if (height <= 16) {
    heightScript = Buffer.from([0x51 + height - 1]);
  } else if (height <= 0x7f) {
    heightScript = Buffer.from([0x01, height]);
  } else if (height <= 0x7fff) {
    heightScript = Buffer.from([0x02, height & 0xff, (height >> 8) & 0xff]);
  } else if (height <= 0x7fffff) {
    heightScript = Buffer.from([0x03, height & 0xff, (height >> 8) & 0xff, (height >> 16) & 0xff]);
  } else {
    heightScript = Buffer.from([0x04, height & 0xff, (height >> 8) & 0xff, (height >> 16) & 0xff, (height >> 24) & 0xff]);
  }

  const poolTag = Buffer.from('/NodePool/', 'ascii');
  const extranonceSize = 8; // 4 bytes extranonce1 + 4 bytes extranonce2
  const mergeCommitSize = mergeCommitment ? mergeCommitment.length : 0;
  const totalScriptLen = heightScript.length + extranonceSize + poolTag.length + mergeCommitSize;

  // Build coinbase1: everything before extranonce placeholder
  const cb1Parts = [];

  // Version
  const version = Buffer.alloc(4);
  version.writeUInt32LE(coin.segwit ? 2 : 1);
  cb1Parts.push(version);

  // SegWit marker + flag for serialization (NOT included in coinbase1/2 for stratum)
  // Stratum sends non-witness serialization; witness is only for submitblock

  // Input count
  cb1Parts.push(Buffer.from([0x01]));
  // Previous hash (zeros)
  cb1Parts.push(Buffer.alloc(32, 0));
  // Previous index
  cb1Parts.push(Buffer.from('ffffffff', 'hex'));
  // Script length
  cb1Parts.push(writeVarInt(totalScriptLen));
  // Height script (part of coinbase script before extranonce)
  cb1Parts.push(heightScript);

  const coinbase1 = Buffer.concat(cb1Parts).toString('hex');

  // Build coinbase2: everything after extranonce placeholder
  const cb2Parts = [];
  // Pool tag (rest of coinbase script after extranonce)
  cb2Parts.push(poolTag);
  // Merge mining commitment (if any)
  if (mergeCommitment) {
    cb2Parts.push(mergeCommitment);
  }
  // Sequence
  cb2Parts.push(Buffer.from('ffffffff', 'hex'));

  // Outputs
  const coinbaseValue = template.coinbasevalue;
  const hasWitnessCommitment = coin.segwit && template.default_witness_commitment;
  const outputCount = hasWitnessCommitment ? 2 : 1;
  cb2Parts.push(Buffer.from([outputCount]));

  // Output 1: reward
  const valueBuf = Buffer.alloc(8);
  valueBuf.writeBigUInt64LE(BigInt(coinbaseValue));
  cb2Parts.push(valueBuf);

  // Script pubkey from template or pool address
  let scriptPubKey;
  if (template.coinbasetxn && template.coinbasetxn.scriptPubKey) {
    scriptPubKey = Buffer.from(template.coinbasetxn.scriptPubKey, 'hex');
  } else if (template._poolScriptPubKey) {
    scriptPubKey = template._poolScriptPubKey;
  } else {
    // FATAL: No pool address configured - block reward would be unspendable
    console.error('[CRITICAL] No pool scriptPubKey! Coinbase will use OP_TRUE - block reward at risk!');
    scriptPubKey = Buffer.from('51', 'hex');
  }
  cb2Parts.push(writeVarInt(scriptPubKey.length));
  cb2Parts.push(scriptPubKey);

  // Witness commitment output
  if (hasWitnessCommitment) {
    cb2Parts.push(Buffer.alloc(8, 0)); // 0 value
    const commitScript = Buffer.from(template.default_witness_commitment, 'hex');
    cb2Parts.push(writeVarInt(commitScript.length));
    cb2Parts.push(commitScript);
  }

  // Locktime
  cb2Parts.push(Buffer.alloc(4, 0));

  const coinbase2 = Buffer.concat(cb2Parts).toString('hex');

  return { coinbase1, coinbase2 };
}

class StratumServer extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.servers = new Map();
    this.daemons = new Map();
    this.jobCounter = 0;
    this.jobs = new Map();         // jobId -> job data (for share validation)
    this.templates = new Map();     // coinId -> current block template
    this.extraNonce1Counter = 0;
    this.templatePollers = new Map();
    // Merge mining
    this.mergeGroups = new Map();    // parentCoinId -> { children: Map<coinId, { coin, daemon, auxBlock, address }> }
    this.auxBlocks = new Map();      // coinId -> current aux block data from daemon
    this.auxTreeParams = new Map();  // parentCoinId -> { treeSize, depth, nonce, slots }
    this.auxMerkleData = new Map();  // parentCoinId -> { merkleRoot, branches, commitment }
    this.poolScriptPubKeys = new Map(); // coinId -> Buffer (scriptPubKey for pool wallet)
  }

  // Convert bech32/legacy address to scriptPubKey
  async getScriptPubKey(daemon, address) {
    try {
      const info = await daemon.call('validateaddress', [address]);
      if (info && info.scriptPubKey) return Buffer.from(info.scriptPubKey, 'hex');
    } catch (e) {}
    try {
      const info = await daemon.call('getaddressinfo', [address]);
      if (info && info.scriptPubKey) return Buffer.from(info.scriptPubKey, 'hex');
    } catch (e) {}
    // Manual bech32 P2WPKH decode as last resort
    if (address.startsWith('ltc1q') && address.length === 43) {
      try {
        const { bech32 } = require('bech32') || {};
        // Simple fallback: can't decode without bech32 lib
      } catch (e) {}
    }
    return null;
  }

  async initPoolAddress(coinId) {
    const daemon = this.daemons.get(coinId);
    if (!daemon) return;
    try {
      // Try to load/create wallet and get address
      try { await daemon.ensureWalletLoaded(); } catch (e) {}
      let address;
      try { address = await daemon.getNewAddress(); } catch (e) {
        try { address = await daemon.call('getnewaddress', ['pool']); } catch (e2) {}
      }
      if (address) {
        const spk = await this.getScriptPubKey(daemon, address);
        if (spk) {
          this.poolScriptPubKeys.set(coinId, spk);
          console.log(`[Pool] ${coins[coinId].symbol} pool address: ${address} scriptPubKey: ${spk.toString('hex')}`);
          return;
        }
      }
      console.warn(`[Pool] WARNING: No pool address for ${coins[coinId].symbol} - blocks will use OP_TRUE!`);
    } catch (err) {
      console.error(`[Pool] Failed to get pool address for ${coins[coinId].symbol}:`, err.message);
    }
  }

  start() {
    // Initialize merge mining groups
    this.initMergeMining();

    for (const [coinId, coin] of Object.entries(coins)) {
      this.daemons.set(coinId, new DaemonRPC(coin.daemon));
      // Only start standalone stratum servers for parent chains and non-merged coins
      if (!coin.mergeMinedWith) {
        this.startCoinServer(coinId, coin);
        this.startTemplatePolling(coinId, coin);
        // Initialize pool address for coinbase output (async, retries in background)
        this.initPoolAddress(coinId).catch(e => console.error(`[Pool] initPoolAddress ${coinId}:`, e.message));
      }
    }
    console.log('[Stratum] All coin servers started');
  }

  initMergeMining() {
    // Group merge-mined children by their parent chain
    for (const [coinId, coin] of Object.entries(coins)) {
      if (coin.mergeMinedWith) {
        const parentId = coin.mergeMinedWith;
        if (!this.mergeGroups.has(parentId)) {
          this.mergeGroups.set(parentId, new Map());
        }
        const daemon = new DaemonRPC(coin.daemon);
        this.mergeGroups.get(parentId).set(coinId, {
          coin,
          daemon,
          auxBlock: null,
          address: null // Will be fetched on first aux block request
        });
        this.daemons.set(coinId, daemon);
        daemon.setChainId(coin.chainId || 0);
        console.log(`[MergeMining] ${coin.name} (chainId=${coin.chainId}) will merge-mine with ${parentId}`);
      }
    }

    // Log merge mining groups
    for (const [parentId, children] of this.mergeGroups) {
      const childNames = [...children.values()].map(c => c.coin.symbol).join(', ');
      console.log(`[MergeMining] ${coins[parentId].symbol} parent chain merge-mines: ${childNames}`);
    }
  }

  startCoinServer(coinId, coin) {
    // Support multiple difficulty ports per coin
    const ports = coin.stratumPorts || [{ port: coin.stratumPort, diff: null, label: 'Default' }];

    for (const portConfig of ports) {
      const server = net.createServer((socket) => {
        this.handleConnection(socket, coinId, coin, portConfig.diff, portConfig.fixedDiff);
      });

      server.listen(portConfig.port, config.stratum.host, () => {
        const diffLabel = portConfig.diff ? ` diff=${portConfig.diff.toLocaleString()}` : '';
        console.log(`[Stratum] ${coin.name} (${coin.algorithm}) listening on port ${portConfig.port}${diffLabel} - ${portConfig.label || ''}`);
      });

      server.on('error', (err) => {
        console.error(`[Stratum] ${coin.name} port ${portConfig.port} error:`, err.message);
      });

      this.servers.set(`${coinId}_${portConfig.port}`, server);
    }
  }

  // Poll daemon for new block templates
  startTemplatePolling(coinId, coin) {
    const poll = async () => {
      try {
        const daemon = this.daemons.get(coinId);
        const rules = [];
        if (coin.segwit) rules.push('segwit');
        if (coin.mweb) rules.push('mweb');
        const template = await daemon.getBlockTemplate(rules);

        // Attach pool scriptPubKey to template for coinbase output
        const poolSpk = this.poolScriptPubKeys.get(coinId);
        if (poolSpk) {
          template._poolScriptPubKey = poolSpk;
        }

        const existing = this.templates.get(coinId);
        const isNew = !existing || existing.previousblockhash !== template.previousblockhash;

        this.templates.set(coinId, template);

        // Refresh aux blocks for merge mining if this is a parent chain
        if (this.mergeGroups.has(coinId)) {
          await this.refreshAuxBlocks(coinId);
        }

        if (isNew) {
          console.log(`[Stratum] New block template for ${coin.name}: height=${template.height} txs=${template.transactions.length}`);
          this.broadcastJob(coinId, true);
        }
      } catch (err) {
        if (!err.message.includes('ECONNREFUSED')) {
          const errKey = `${coinId}_pollErr`;
          const lastMsg = this._lastPollError?.get(errKey);
          if (lastMsg !== err.message) {
            if (!this._lastPollError) this._lastPollError = new Map();
            this._lastPollError.set(errKey, err.message);
            console.error(`[Stratum] Template poll error for ${coin.name}:`, err.message);
          }
        }
      }
    };

    // Initial fetch
    poll();
    // Poll every 5 seconds
    const interval = setInterval(poll, 5000);
    this.templatePollers.set(coinId, interval);

    // Periodic job refresh: send new jobs every 30s even without new blocks
    // This keeps ASIC miners (especially Antminer) connected by providing fresh work
    const refreshInterval = setInterval(() => {
      const template = this.templates.get(coinId);
      if (!template) return;
      let clientCount = 0;
      for (const client of this.clients.values()) {
        if (client.coin === coinId && client.subscribed && client.authorized) {
          this.sendJob(client, false); // cleanJobs=false so miner keeps working on current shares
          clientCount++;
        }
      }
      if (clientCount > 0) {
        // Only log occasionally to avoid spam
        if (!this._refreshLogCount) this._refreshLogCount = {};
        if (!this._refreshLogCount[coinId]) this._refreshLogCount[coinId] = 0;
        this._refreshLogCount[coinId]++;
        if (this._refreshLogCount[coinId] % 10 === 1) {
          console.log(`[Stratum] Periodic job refresh for ${coin.name}: ${clientCount} clients`);
        }
      }
    }, 30000);
    // Store so we can clean up
    if (!this.refreshPollers) this.refreshPollers = new Map();
    this.refreshPollers.set(coinId, refreshInterval);
  }

  // Fetch/refresh aux blocks from all merge-mined children of a parent chain
  async refreshAuxBlocks(parentCoinId) {
    const children = this.mergeGroups.get(parentCoinId);
    if (!children || children.size === 0) return;

    const activeAuxBlocks = new Map();
    const chainIds = [];

    for (const [childId, child] of children) {
      try {
        let auxBlock;
        if (child.coin.auxpowApi === 'getauxblock') {
          auxBlock = await child.daemon.getAuxBlock();
        } else {
          // createauxblock needs an address
          if (!child.address) {
            // Use configured payout address first
            if (child.coin.payoutAddress) {
              child.address = child.coin.payoutAddress;
              console.log(`[MergeMining] Using configured payout address for ${child.coin.symbol}: ${child.address}`);
            } else {
              try {
                await child.daemon.ensureWalletLoaded();
                child.address = await child.daemon.getNewAddress();
                console.log(`[MergeMining] Got payout address for ${child.coin.symbol}: ${child.address}`);
              } catch (e) {
                // If getnewaddress fails, try getauxblock as fallback
                try {
                  auxBlock = await child.daemon.getAuxBlock();
                  child.coin.auxpowApi = 'getauxblock';
                } catch (e2) {
                  if (!child._addressWarnShown) {
                    console.error(`[MergeMining] Cannot get address for ${child.coin.symbol}: ${e.message}. Set ${child.coin.symbol}_PAYOUT_ADDRESS in .env`);
                    child._addressWarnShown = true;
                  }
                  continue;
                }
              }
            }
          }
          if (!auxBlock && child.address) {
            auxBlock = await child.daemon.createAuxBlock(child.address);
          }
        }

        if (auxBlock && auxBlock.hash) {
          // Update chain ID if it was 0 (runtime detection)
          if (child.coin.chainId === 0 && auxBlock.chainid) {
            child.coin.chainId = auxBlock.chainid;
            console.log(`[MergeMining] Detected chainId=${auxBlock.chainid} for ${child.coin.symbol}`);
          }
          child.auxBlock = auxBlock;
          activeAuxBlocks.set(childId, auxBlock);
          chainIds.push(child.coin.chainId || auxBlock.chainid || 0);
        }
      } catch (err) {
        if (!err.message.includes('ECONNREFUSED') && !err.message.includes('downloading blocks')) {
          console.error(`[MergeMining] Aux block error for ${child.coin.symbol}:`, err.message);
        }
      }
    }

    if (activeAuxBlocks.size === 0) return;

    // Compute tree params and build aux merkle tree
    try {
      const treeParams = auxpow.findTreeParams(chainIds);
      this.auxTreeParams.set(parentCoinId, treeParams);

      const { merkleRoot, branches } = auxpow.buildAuxMerkleTree(activeAuxBlocks, treeParams);
      const commitment = auxpow.buildMergeCommitment(merkleRoot, treeParams.treeSize, treeParams.nonce);

      this.auxMerkleData.set(parentCoinId, { merkleRoot, branches, commitment, auxBlocks: activeAuxBlocks });

      // Log on first successful merge or when aux chain count changes
      const prevCount = this.auxBlocks.get(parentCoinId + '_count') || 0;
      if (activeAuxBlocks.size !== prevCount) {
        const names = [...activeAuxBlocks.entries()].map(([id]) => coins[id]?.symbol || id).join(', ');
        console.log(`[MergeMining] ${coins[parentCoinId].symbol} merge-mining ${activeAuxBlocks.size} aux chains: ${names}`);
        this.auxBlocks.set(parentCoinId + '_count', activeAuxBlocks.size);
      }
    } catch (err) {
      console.error(`[MergeMining] Tree build error for ${coins[parentCoinId].symbol}:`, err.message);
    }
  }

  handleConnection(socket, coinId, coin, portDifficulty, fixedDiff) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
    const client = {
      id: clientId,
      socket,
      coin: coinId,
      algorithm: coin.algorithm,
      subscribed: false,
      authorized: false,
      userId: null,
      workerName: null,
      workerId: null,
      difficulty: portDifficulty || this.getDefaultDifficulty(coin.algorithm),
      extraNonce1: this.getExtraNonce1(),
      shares: { valid: 0, invalid: 0, stale: 0 },
      lastActivity: Date.now(),
      buffer: '',
      // Vardiff tracking
      shareTimestamps: [],
      lastDiffAdjust: Date.now(),
      // mining.configure extensions
      versionRollingMask: null,
      minDifficulty: null
    };

    // Store the port starting difficulty as the floor for this client
    client.portDifficulty = portDifficulty || this.getDefaultDifficulty(coin.algorithm);
    client.fixedDiff = fixedDiff || false;

    this.clients.set(clientId, client);
    console.log(`[Stratum] New connection: ${clientId} for ${coin.name}`);

    // Track extraNonce1 per client for job validation
    client._jobExtraNonces = new Map(); // jobId -> extraNonce1 used when job was sent

    socket.on('data', (data) => {
      client.buffer += data.toString();
      const lines = client.buffer.split('\n');
      client.buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        const cleanLine = line.replace(/\r/g, ""); if (cleanLine.trim()) {
          try {
            const message = JSON.parse(cleanLine);
            // Log raw messages from L9 for debugging
            if (!client._logCount) client._logCount = 0;
            if (client._logCount < 20) {
              client._logCount++;
              console.log(`[RAW-IN] ${clientId}: ${line.substring(0, 200)}`);
            }
            this.handleMessage(client, message);
          } catch (err) {
            if (err instanceof SyntaxError) { console.error(`[Stratum] Invalid JSON from ${clientId}:`, cleanLine); } else { console.error(`[Stratum] Handler error from ${clientId}:`, err.message, "for:", cleanLine.substring(0,100)); }
          }
        }
      }
    });

    socket.on('error', (err) => {
      console.error(`[Stratum] Client error ${clientId}:`, err.message);
    });

    socket.on('close', () => {
      this.handleDisconnect(client);
    });

    socket.setKeepAlive(true);
    socket.setTimeout(1800000); // 30 min timeout - ASIC miners need longer

    socket.on('timeout', () => {
      console.log(`[Stratum] Client timeout: ${clientId}`);
      socket.end();
    });
  }

  handleMessage(client, message) {
    const { id, method, params } = message;
    // Reduced debug logging
    if (!client._msgLog || client._msgLog < 3) { console.log(`[Stratum] ${client.id} method=${method}`); client._msgLog = (client._msgLog || 0) + 1; }

    switch (method) {
      case 'mining.subscribe':
        this.handleSubscribe(client, id, params);
        break;
      case 'mining.authorize':
        this.handleAuthorize(client, id, params);
        break;
      case 'mining.submit':
        this.handleSubmit(client, id, params);
        break;
      case 'mining.configure':
        this.handleConfigure(client, id, params);
        break;
      case 'mining.extranonce.subscribe':
        this.sendResponse(client, id, true);
        break;
      case 'login':
        if (message.params && message.params.login) {
          this.handleSubscribe(client, id, [message.params.agent || 'miner']);
          this.handleAuthorize(client, id, [message.params.login, message.params.pass || 'x']);
        } else {
          this.sendResponse(client, id, null, [20, 'Invalid login']);
        }
        break;
      default:
        console.log(`[Stratum] Unknown method from ${client.id}: ${method}`);
        this.sendResponse(client, id, null, [20, 'Unknown method']);
    }
  }

  handleConfigure(client, id, params) {
    if (!params || params.length < 2) {
      this.sendResponse(client, id, {});
      return;
    }

    const [extensions, extensionParams] = params;
    const result = {};

    if (extensions.includes('version-rolling')) {
      const requestedMask = extensionParams['version-rolling.mask'] || 'ffffffff';
      // BIP320 safe bits: 1fffe000
      const poolMask = 0x1fffe000;
      const clientMask = parseInt(requestedMask, 16);
      const negotiatedMask = (poolMask & clientMask) >>> 0;

      client.versionRollingMask = negotiatedMask;
      result['version-rolling'] = true;
      result['version-rolling.mask'] = negotiatedMask.toString(16).padStart(8, '0');
    }

    if (extensions.includes('minimum-difficulty')) {
      const minDiff = extensionParams['minimum-difficulty.value'];
      if (minDiff && minDiff > 0) {
        client.minDifficulty = minDiff;
      }
      result['minimum-difficulty'] = true;
    }

    this.sendResponse(client, id, result);
    console.log(`[Stratum] mining.configure from ${client.id}: extensions=${extensions.join(',')}`);
  }

  handleSubscribe(client, id, params) {
    client.subscribed = true;
    const extraNonce2Size = 4;

    this.sendResponse(client, id, [
      [
        ['mining.set_difficulty', client.id],
        ['mining.notify', client.id]
      ],
      client.extraNonce1,
      extraNonce2Size
    ]);

    // Send initial difficulty
    this.sendToClient(client, {
      id: null,
      method: 'mining.set_difficulty',
      params: [client.difficulty]
    });

    // Send a job
    this.sendJob(client);
  }

  handleAuthorize(client, id, params) {
    if (!params || params.length < 1) {
      this.sendResponse(client, id, false, [24, 'Invalid params']);
      return;
    }

    const [workerFullName, password] = params;
    const parts = workerFullName.split('.');
    const username = parts[0];
    const workerName = parts[1] || 'default';

    // Look up user by username or wallet address
    const user = db.prepare(
      'SELECT id, username FROM users WHERE username = ? OR wallet_address = ? OR INSTR(wallet_address, ?) > 0'
    ).get(username, username, username);

    if (!user) {
      // Auto-register with wallet address if it looks like one
      if (this.isValidAddress(username, client.coin)) {
        const bcrypt = require('bcryptjs');
        const { v4: uuidv4 } = require('uuid');
        const hashedPass = bcrypt.hashSync(password || 'x', 10);
        const result = db.prepare(
          'INSERT OR IGNORE INTO users (username, email, password, wallet_address, api_key) VALUES (?, ?, ?, ?, ?)'
        ).run(username.substring(0, 20), `${username.substring(0, 10)}@pool.local`, hashedPass, username, uuidv4());

        if (result.changes > 0) {
          client.userId = result.lastInsertRowid;
          client.workerName = workerName;
          client.authorized = true;
          this.registerWorker(client);
          this.sendResponse(client, id, true);
          console.log(`[Stratum] Auto-registered wallet miner: ${username}/${workerName}`);
          return;
        }
      }
      this.sendResponse(client, id, false, [24, 'Unauthorized']);
      return;
    }

    client.userId = user.id;
    client.workerName = workerName;
    client.authorized = true;

    this.registerWorker(client);
    this.sendResponse(client, id, true);
    console.log(`[Stratum] Authorized: ${user.username}/${workerName} on ${coins[client.coin].name}`);
  }

  // Validate address using known prefixes or fallback to RPC
  isValidAddress(address, coinId) {
    const coin = coins[coinId];
    if (!coin || !coin.addressPrefixes) {
      return address.length >= 26 && address.length <= 90;
    }
    return coin.addressPrefixes.some(prefix => address.startsWith(prefix)) && address.length >= 26;
  }

  registerWorker(client) {
    console.log('[Stratum] registerWorker:', client.userId, client.workerName, client.coin, 'remoteAddr:', client.socket?.remoteAddress);
    const existing = db.prepare(
      'SELECT id, difficulty FROM workers WHERE user_id = ? AND name = ? AND coin = ?'
    ).get(client.userId, client.workerName, client.coin);

    if (existing) {
      db.prepare(
        'UPDATE workers SET is_online = 1, connected_at = CURRENT_TIMESTAMP, ip_address = ?, algorithm = ? WHERE id = ?'
      ).run(client.socket.remoteAddress, client.algorithm, existing.id);
      client.workerId = existing.id;

      // Restore difficulty from previous session, but cap at 16x the starting difficulty
      // to avoid restoring an old high difficulty that causes reconnect loops
      const maxRestoreDiff = client.difficulty * 4;
      if (existing.difficulty && existing.difficulty > client.difficulty && existing.difficulty <= maxRestoreDiff) {
        client.difficulty = existing.difficulty;
        // Send difficulty change - but do NOT send a duplicate job here.
        // The miner already received a job from handleSubscribe.
        // Sending a second job during authorize confuses Antminer firmware and causes disconnects.
        // The difficulty will take effect on the NEXT job (from broadcastJob or template poll).
        this.sendToClient(client, { id: null, method: 'mining.set_difficulty', params: [client.difficulty] });
        console.log(`[Stratum] Restored difficulty ${client.difficulty.toFixed(2)} for ${client.workerName} on ${client.coin}`);
      }
    } else {
      const result = db.prepare(
        'INSERT INTO workers (user_id, name, coin, algorithm, is_online, connected_at, ip_address) VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, ?)'
      ).run(client.userId, client.workerName, client.coin, client.algorithm, client.socket.remoteAddress);
      client.workerId = result.lastInsertRowid;
    }
  }

  handleSubmit(client, id, params) {
    try {
    if (!client.authorized) {
      this.sendResponse(client, id, false, [24, 'Unauthorized']);
      return;
    }

    client.lastActivity = Date.now();

    // params: [workerName, jobId, extraNonce2, nTime, nonce, ?versionBits]
    const [workerName, jobId, extraNonce2, nTime, nonce, versionBits] = params;

    // Look up the job
    const job = this.jobs.get(jobId);
    if (!job) {
      client.shares.stale++; // Accept stale silently to avoid MRR bad shares flag
      console.log(`[Stratum] Stale share from ${client.workerName}: job ${jobId} not found`); this.sendResponse(client, id, true); // Accept stale to prevent MRR flagging
      return;
    }

    if (job.coinId !== client.coin) {
      this.sendResponse(client, id, false, [20, 'Wrong coin for job']);
      return;
    }

    // Validate the share
    const result = this.validateShare(client, job, extraNonce2, nTime, nonce, versionBits);
    console.log(`[Stratum] Share from ${client.workerName}: valid=${result.valid} shareDiff=${result.shareDiff?.toFixed(2)||0} ${result.reason||''}`);

    if (result.valid) {
      client.shares.valid++;

      // Record vardiff timestamp
      client.shareTimestamps.push(Date.now());
      if (client.shareTimestamps.length > 20) {
        client.shareTimestamps.shift();
      }
      if (!client.fixedDiff) this.adjustDifficulty(client);

      db.prepare(
        'INSERT INTO shares (user_id, worker_id, coin, algorithm, difficulty, share_diff, is_valid, is_block) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
      ).run(client.userId, client.workerId, client.coin, client.algorithm, client.difficulty, result.shareDiff, result.isBlock ? 1 : 0);

      db.prepare(
        'UPDATE workers SET shares_valid = shares_valid + 1, last_share = CURRENT_TIMESTAMP, difficulty = ?, best_share = MAX(best_share, ?) WHERE id = ?'
      ).run(client.difficulty, result.shareDiff, client.workerId);

      if (result.isBlock) {
        this.handleBlockFound(client, job, result, extraNonce2, nTime, nonce, versionBits);
      }

      // Check merge-mined aux chains
      if (job.auxData && result.hash) {
        this.checkAuxTargets(client, job, result, extraNonce2, nTime, nonce, versionBits);
      }

      this.sendResponse(client, id, true);
      this.emit('share', { client, valid: true, isBlock: result.isBlock });
    } else {
      client.shares.invalid++;

      // Batch update invalid share count (reduces DB load)
      if (client.shares.invalid % 100 === 0) {
        db.prepare('UPDATE workers SET shares_invalid = shares_invalid + 100 WHERE id = ?').run(client.workerId);
      }


      this.sendResponse(client, id, false, [23, result.reason || 'Low difficulty share']);
      this.emit('share', { client, valid: false, isBlock: false });
    }
    } catch (err) {
      console.error(`[Stratum] handleSubmit CRASH:`, err.message, err.stack);
      this.sendResponse(client, id, false, [20, 'Internal error']);
    }
  }

  validateShare(client, job, extraNonce2, nTime, nonce, versionBits) {
    try {
      // Reconstruct coinbase
      let effectiveExtraNonce1 = client.extraNonce1;
      if (client._jobExtraNonces && client._jobExtraNonces.has(job.id)) {
        effectiveExtraNonce1 = client._jobExtraNonces.get(job.id);
      }
      const coinbaseHex = job.coinbase1 + effectiveExtraNonce1 + extraNonce2 + job.coinbase2;
      const coinbaseBuffer = Buffer.from(coinbaseHex, 'hex');
      const coinbaseHash = sha256d(coinbaseBuffer).toString('hex');

      // Compute merkle root
      const merkleRoot = computeMerkleRoot(coinbaseHash, job.merkleBranches);

      let versionHex = job.version;
      if (versionBits && client.versionRollingMask) {
        let versionInt = parseInt(job.version, 16);
        const rolledBits = parseInt(versionBits, 16);
        versionInt = (versionInt & ~client.versionRollingMask) | (rolledBits & client.versionRollingMask);
        versionHex = versionInt.toString(16).padStart(8, '0');
      }

      const maxTarget = job.algorithm === 'scrypt' ? MAX_TARGET_SCRYPT : MAX_TARGET_SHA256;

      // Build header using Yiimp's method (hex string → ser_string_be → binlify)
      // This produces wire format and matches what cgminer/ASIC miners compute
      const header = buildHeaderYiimp(versionHex, job.prevHashStratum, merkleRoot, nTime, job.nbits, nonce);

      let hashBuffer;
      if (job.algorithm === 'sha256') {
        hashBuffer = sha256d(header);
      } else if (job.algorithm === 'scrypt') {
        hashBuffer = scryptHash(header);

        // Diagnostic for first 2 scrypt shares
        if (!this._diagCount) this._diagCount = 0;
        if (this._diagCount < 2) {
          this._diagCount++;
          const scRev = Buffer.from(hashBuffer).reverse().toString('hex');
          const diagBig = BigInt('0x' + scRev);
          const diagDiff = diagBig > 0n ? Number(maxTarget / diagBig) : 0;
          console.log(`[DIAG] Share #${this._diagCount}: jobId=${job.id} en1=${client.extraNonce1} en2=${extraNonce2} nTime=${nTime} nonce=${nonce}`);
          console.log(`[DIAG] prevHash=${job.prevHash} prevHashStratum=${job.prevHashStratum}`);
          console.log(`[DIAG] header=${header.toString('hex')}`);
          console.log(`[DIAG] scryptHash=${scRev} shareDiff=${diagDiff.toFixed(4)}`);
        }
      } else {
        return { valid: false, reason: 'Unsupported algorithm' };
      }

      const hashReversed = Buffer.from(hashBuffer).reverse();
      const hashBig = BigInt('0x' + hashReversed.toString('hex'));
      // Use algorithm-appropriate max target for shareDiff
      const shareDiff = hashBig > 0n ? Number(MAX_TARGET_SHA256 / hashBig) : 0;

      const shareTarget = difficultyToTarget(client.difficulty, job.algorithm);
      const meetsShareTarget = hashMeetsTarget(hashReversed, shareTarget);

      if (!meetsShareTarget) {
        return { valid: false, shareDiff, reason: 'Low difficulty share' };
      }

      const networkTarget = nbitsToTarget(job.nbits);
      const isBlock = hashMeetsTarget(hashReversed, networkTarget);
      if (shareDiff > 10000000) {
        const nTargetHex = networkTarget.toString("hex");
        const hashHex = hashReversed.toString("hex");
      }

      return { valid: true, shareDiff, isBlock, hash: hashReversed.toString('hex') };
    } catch (err) {
      console.error(`[Stratum] Share validation error:`, err.message, err.stack);
      return { valid: false, reason: 'Validation error' };
    }
  }

  async handleBlockFound(client, job, result, extraNonce2, nTime, nonce, versionBits) {
    const coin = coins[client.coin];
    const template = job.template;
    const blockHash = result.hash;

    console.log(`[Stratum] BLOCK FOUND! ${coin.name} height=${template.height} by user ${client.userId}/${client.workerName} - hash: ${blockHash.substring(0, 16)}...`);

    try {
      // Reconstruct the full block for submission
      const blockHex = this.buildBlockForSubmission(client, job, extraNonce2, nTime, nonce, versionBits);

      const daemon = this.daemons.get(client.coin);
      const submitResult = await daemon.submitBlock(blockHex);

      if (submitResult === null || submitResult === undefined || submitResult === '' || submitResult === 'inconclusive') {
        // Success - null/empty means accepted
        console.log(`[Stratum] Block ACCEPTED by ${coin.name} daemon!`);

        // Get the actual reward from template
        const reward = template.coinbasevalue / 1e8;

        const dbResult = db.prepare(
          'INSERT INTO blocks (coin, height, hash, reward, difficulty, finder_id, worker_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(client.coin, template.height, blockHash, reward, template.difficulty || 0, client.userId, client.workerName, 'pending');

        this.emit('block', {
          id: dbResult.lastInsertRowid,
          coin: client.coin,
          height: template.height,
          hash: blockHash,
          finder: client.userId,
          worker: client.workerName
        });
      } else {
        console.error(`[Stratum] Block REJECTED by ${coin.name} daemon: ${submitResult}`);
      }
    } catch (err) {
      console.error(`[Stratum] Block submission error for ${coin.name}:`, err.message);
    }
  }

  buildBlockForSubmission(client, job, extraNonce2, nTime, nonce, versionBits) {
    const coin = coins[client.coin];
    const template = job.template;

    // Reconstruct coinbase (includes merge commitment if present via coinbase2)
    let blockEN1 = client.extraNonce1;
    if (client._jobExtraNonces && client._jobExtraNonces.has(job.id)) blockEN1 = client._jobExtraNonces.get(job.id);
    const coinbaseHex = job.coinbase1 + blockEN1 + extraNonce2 + job.coinbase2;
    const coinbaseBuffer = Buffer.from(coinbaseHex, 'hex');
    const coinbaseHash = sha256d(coinbaseBuffer).toString('hex');
    const merkleRoot = computeMerkleRoot(coinbaseHash, job.merkleBranches);

    // Build block header using Yiimp approach (produces wire format)
    let versionHex = job.version;
    if (versionBits && client.versionRollingMask) {
      let versionInt = parseInt(job.version, 16);
      const rolledBits = parseInt(versionBits, 16);
      versionInt = (versionInt & ~client.versionRollingMask) | (rolledBits & client.versionRollingMask);
      versionHex = versionInt.toString(16).padStart(8, '0');
    }

    const header = buildHeaderYiimp(versionHex, job.prevHashStratum, merkleRoot, nTime, job.nbits, nonce);

    // Build full block: header + tx count + coinbase tx + other transactions
    const parts = [header];

    // Transaction count (coinbase + template transactions)
    const txCount = 1 + template.transactions.length;
    parts.push(writeVarInt(txCount));

    // Full coinbase transaction (with witness data for segwit)
    if (coin.segwit) {
      const mergeCommit = job.auxData ? job.auxData.commitment : null;
      const coinbaseTx = buildCoinbaseTx(template, blockEN1, extraNonce2, client.coin, mergeCommit);
      parts.push(coinbaseTx);
    } else {
      parts.push(coinbaseBuffer);
    }

    // Append template transactions
    for (const tx of template.transactions) {
      parts.push(Buffer.from(tx.data, 'hex'));
    }

    // Append MWEB extension block data if present (Litecoin)
    if (coin.mweb && template.mweb) {
      parts.push(Buffer.from(template.mweb, 'hex'));
    }
    return Buffer.concat(parts).toString('hex');
  }

  handleDisconnect(client) {
    console.log(`[Stratum] Disconnected: ${client.id}`);
    this.clients.delete(client.id);

    if (client.workerId) {
      const workerId = client.workerId;
      // Delay offline check by 15s to handle rapid reconnect cycles
      setTimeout(() => {
        // Check if another client has taken over this worker
        let stillOnline = false;
        for (const [, c] of this.clients) {
          if (c.workerId === workerId && c.authorized) {
            stillOnline = true;
            break;
          }
        }
        if (!stillOnline) {
          // Also check if worker was recently connected (within 30s) - if so, it's likely reconnecting
          const worker = db.prepare('SELECT connected_at FROM workers WHERE id = ?').get(workerId);
          if (worker && worker.connected_at) {
            const connectedAge = (Date.now() - new Date(worker.connected_at + 'Z').getTime()) / 1000;
            if (connectedAge < 30) {
              // Recently connected, probably just reconnecting - don't mark offline yet
              return;
            }
          }
          db.prepare('UPDATE workers SET is_online = 0, disconnected_at = CURRENT_TIMESTAMP WHERE id = ?').run(workerId);
        }
      }, 15000);
    }
  }

  sendJob(client, cleanJobs = true) {
    if (!client.subscribed) return;

    const template = this.templates.get(client.coin);
    if (!template) {
      // No template yet - send a dummy job that will be replaced once template arrives
      console.log(`[Stratum] No template available for ${client.coin}, deferring job`);
      return;
    }

    const coin = coins[client.coin];
    this.jobCounter++;
    const jobId = this.jobCounter.toString(16).padStart(8, '0');

    // Get merge mining commitment if this is a parent chain
    const auxData = this.auxMerkleData.get(client.coin);
    const mergeCommitment = auxData ? auxData.commitment : null;

    // Split coinbase into parts around extranonce
    const { coinbase1, coinbase2 } = splitCoinbaseTx(template, client.coin, mergeCommitment);

    // Compute merkle branches from template transactions
    const merkleBranches = [];
    if (template.transactions && template.transactions.length > 0) {
      // Build list of transaction hashes
      const txHashes = template.transactions.map(tx => tx.txid || tx.hash);
      // Compute merkle branches (we only need branches, not full tree)
      let hashes = [...txHashes];
      while (hashes.length > 0) {
        merkleBranches.push(hashes[0]);
        if (hashes.length === 1) break;
        // Pair up and hash
        const newHashes = [];
        for (let i = 0; i < hashes.length; i += 2) {
          const left = hashes[i];
          const right = i + 1 < hashes.length ? hashes[i + 1] : hashes[i];
          const combined = Buffer.concat([
            Buffer.from(left, 'hex'),
            Buffer.from(right, 'hex')
          ]);
          newHashes.push(sha256d(combined).toString('hex'));
        }
        hashes = newHashes;
      }
      // Actually, the merkle branches for stratum are just the sibling hashes
      // Let me recalculate properly
      merkleBranches.length = 0;
      this.computeMerkleBranches(template.transactions.map(tx => tx.hash || tx.txid), merkleBranches);
    }

    // prevhash: Yiimp ser_string_be2 format (reverse order of 4-byte groups)
    // This matches what cgminer/ASIC miners expect for stratum
    const prevHash = template.previousblockhash;
    const prevHashStratum = serStringBe2(prevHash);

    const version = template.version.toString(16).padStart(8, '0');
    const nbits = template.bits;
    const ntime = template.curtime.toString(16);

    // Store job for share validation
    const job = {
      id: jobId,
      coinId: client.coin,
      algorithm: coin.algorithm,
      template,
      coinbase1,
      coinbase2,
      merkleBranches,
      version,
      prevHash,
      prevHashStratum,
      nbits,
      ntime,
      createdAt: Date.now(),
      // Merge mining data (if parent chain)
      auxData: auxData ? {
        auxBlocks: auxData.auxBlocks,
        branches: auxData.branches,
        commitment: auxData.commitment
      } : null
    };
    this.jobs.set(jobId, job);

    // Track which extraNonce1 was used when this job was sent to this client
    if (client._jobExtraNonces) {
      client._jobExtraNonces.set(jobId, client.extraNonce1);
      if (client._jobExtraNonces.size > 20) {
        const keys = [...client._jobExtraNonces.keys()];
        for (let ki = 0; ki < keys.length - 20; ki++) client._jobExtraNonces.delete(keys[ki]);
      }
    }

    // Clean old jobs (keep last 10 per coin)
    this.cleanOldJobs(client.coin);

    this.sendToClient(client, {
      id: null,
      method: 'mining.notify',
      params: [
        jobId,
        prevHashStratum,
        coinbase1,
        coinbase2,
        merkleBranches,
        version,
        nbits,
        ntime,
        cleanJobs
      ]
    });
  }

  // Compute merkle branches for stratum (sibling hashes needed to reconstruct merkle root)
  computeMerkleBranches(txHashes, branches) {
    if (txHashes.length === 0) return;

    let level = txHashes.map(h => h);
    while (level.length > 1) {
      branches.push(level[0]);
      level.shift();
      // Hash pairs at this level
      const nextLevel = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : level[i];
        nextLevel.push(sha256d(Buffer.concat([
          Buffer.from(left, 'hex'),
          Buffer.from(right, 'hex')
        ])).toString('hex'));
      }
      level = nextLevel;
    }
    if (level.length === 1 && txHashes.length > 1) {
      branches.push(level[0]);
    }
  }

  cleanOldJobs(coinId) {
    const jobEntries = [...this.jobs.entries()]
      .filter(([, job]) => job.coinId === coinId)
      .sort((a, b) => b[1].createdAt - a[1].createdAt);

    // Keep last 100 jobs per coin
    for (let i = 100; i < jobEntries.length; i++) {
      this.jobs.delete(jobEntries[i][0]);
    }
  }

  // Update connected_at for all active authorized clients (heartbeat)
  // This prevents the stale worker cron from marking connected workers as offline
  updateWorkerHeartbeats() {
    const workerIds = [];
    for (const client of this.clients.values()) {
      if (client.authorized && client.workerId) {
        workerIds.push(client.workerId);
      }
    }
    if (workerIds.length > 0) {
      const placeholders = workerIds.map(() => '?').join(',');
      db.prepare(
        `UPDATE workers SET connected_at = CURRENT_TIMESTAMP, is_online = 1 WHERE id IN (${placeholders})`
      ).run(...workerIds);
    }
  }

  // Variable difficulty adjustment - bulletproof implementation
  adjustDifficulty(client) {
    const now = Date.now();
    const timeSinceAdjust = (now - client.lastDiffAdjust) / 1000;
    const connectionAge = (now - client.lastActivity + 1) / 1000; // rough proxy

    // Fast ramp: first 5 minutes, adjust every 10s with up to 16x jumps
    // Steady state: after 5 min, adjust every 60s with max 2x changes
    const isFastRamp = client.shares.valid < 50;
    const minInterval = isFastRamp ? 10 : 60;
    const minShares = isFastRamp ? 3 : 4;

    if (timeSinceAdjust < minInterval) return;
    if (client.shareTimestamps.length < minShares) return;

    // Calculate average time between shares using recent window
    const timestamps = client.shareTimestamps;
    const windowStart = timestamps[0];
    const windowEnd = timestamps[timestamps.length - 1];
    const windowDuration = (windowEnd - windowStart) / 1000;
    const shareCount = timestamps.length - 1;

    if (windowDuration <= 0 || shareCount <= 0) return;

    const avgInterval = windowDuration / shareCount;

    // Target: one share every 15 seconds
    const targetInterval = 15;
    const ratio = targetInterval / avgInterval;

    // Fast ramp: allow aggressive jumps; Steady: require >50% deviation
    const threshold = isFastRamp ? 1.5 : 2.0;
    if (ratio < (1/threshold) || ratio > threshold) {
      // Fast ramp: jump directly to target; Steady: move 50% toward target
      let adjustRatio;
      if (isFastRamp) {
        // Direct jump to target ratio, clamped to 16x
        adjustRatio = Math.max(0.25, Math.min(4, ratio));
      } else {
        // Smooth: move 50% toward target, max 2x
        adjustRatio = 1 + (ratio - 1) * 0.5;
        adjustRatio = Math.max(0.5, Math.min(2.0, adjustRatio));
      }

      let newDifficulty = client.difficulty * adjustRatio;

      // Respect minimum difficulty from mining.configure
      if (client.minDifficulty && newDifficulty < client.minDifficulty) {
        newDifficulty = client.minDifficulty;
      }

      // Minimum difficulty floor (algorithm-specific, not port-locked so vardiff can go lower)
      const portFloor = 1;
      newDifficulty = Math.max(portFloor, newDifficulty);

      // Algorithm-specific upper bounds
      const maxBounds = { sha256: 1e15, scrypt: 1e12 };
      newDifficulty = Math.min(maxBounds[client.algorithm] || 1e15, newDifficulty);

      // Round to avoid floating point noise
      newDifficulty = Math.round(newDifficulty * 100) / 100;

      if (Math.abs(newDifficulty - client.difficulty) / client.difficulty > 0.05) {
        const oldDiff = client.difficulty;
        client.difficulty = newDifficulty;
        client.lastDiffAdjust = now;
        // Keep last 3 timestamps for continuity instead of clearing
        client.shareTimestamps = timestamps.slice(-3);

        this.sendToClient(client, {
          id: null,
          method: 'mining.set_difficulty',
          params: [client.difficulty]
        });

        // Save to DB immediately so reconnects get the right difficulty
        if (client.workerId) {
          db.prepare('UPDATE workers SET difficulty = ? WHERE id = ?').run(client.difficulty, client.workerId);
        }

        console.log(`[Vardiff] ${client.workerName}/${client.coin}: ${oldDiff.toFixed(0)} -> ${newDifficulty.toFixed(0)} (avg ${avgInterval.toFixed(1)}s, ${shareCount} shares in ${windowDuration.toFixed(0)}s)`);
      }
    }
  }

  // Check if a share from a parent chain also solves any merge-mined aux chains
  checkAuxTargets(client, job, shareResult, extraNonce2, nTime, nonce, versionBits) {
    const hashReversed = Buffer.from(shareResult.hash, 'hex');

    for (const [auxCoinId, auxBlock] of job.auxData.auxBlocks) {
      try {
        // Check if the parent hash meets this aux chain's target
        if (auxpow.hashMeetsAuxTarget(hashReversed, auxBlock.bits)) {
          console.log(`[MergeMining] AUX BLOCK FOUND! ${coins[auxCoinId].symbol} height=${auxBlock.height} via ${coins[client.coin].symbol} share`);
          this.submitAuxProof(client, job, auxCoinId, auxBlock, extraNonce2, nTime, nonce, versionBits);
        }
      } catch (err) {
        console.error(`[MergeMining] Aux target check error for ${coins[auxCoinId]?.symbol}:`, err.message);
      }
    }
  }

  // Build and submit AuxPoW proof to an auxiliary chain daemon
  async submitAuxProof(client, job, auxCoinId, auxBlock, extraNonce2, nTime, nonce, versionBits) {
    try {
      const auxCoin = coins[auxCoinId];
      const children = this.mergeGroups.get(client.coin);
      const child = children?.get(auxCoinId);
      if (!child) return;

      // Reconstruct the non-witness coinbase transaction
      let auxEN1 = client.extraNonce1;
      if (client._jobExtraNonces && client._jobExtraNonces.has(job.id)) auxEN1 = client._jobExtraNonces.get(job.id);
      const coinbaseHex = job.coinbase1 + auxEN1 + extraNonce2 + job.coinbase2;
      const coinbaseBuf = Buffer.from(coinbaseHex, 'hex');
      const coinbaseHash = sha256d(coinbaseBuf).toString('hex');

      // Build parent block header (80 bytes)
      const merkleRoot = computeMerkleRoot(coinbaseHash, job.merkleBranches);

      let versionHex = job.version;
      if (versionBits && client.versionRollingMask) {
        const rolledBits = parseInt(versionBits, 16);
        const vi = (parseInt(job.version, 16) & ~client.versionRollingMask) | (rolledBits & client.versionRollingMask);
        versionHex = vi.toString(16).padStart(8, '0');
      }

      const header = buildHeaderYiimp(versionHex, job.prevHashStratum, merkleRoot, nTime, job.nbits, nonce);

      // Compute coinbase merkle branch (path from coinbase to parent merkle root)
      const txHashes = job.template.transactions.map(tx => tx.txid || tx.hash);
      const coinbaseMerkleBranch = auxpow.computeCoinbaseMerkleBranch(coinbaseHash, txHashes);

      // Get aux merkle branch for this specific chain
      const auxBranchData = job.auxData.branches.get(auxCoinId);
      if (!auxBranchData) {
        console.error(`[MergeMining] No aux merkle branch for ${auxCoin.symbol}`);
        return;
      }

      // Build the AuxPoW proof
      const proof = auxpow.buildAuxPoWProof(
        coinbaseBuf,
        header,
        coinbaseMerkleBranch,
        auxBranchData.branch,
        auxBranchData.index
      );
      const proofHex = proof.toString('hex');

      // Submit to aux chain daemon
      let submitResult;
      if (auxCoin.auxpowApi === 'getauxblock') {
        submitResult = await child.daemon.getAuxBlock(auxBlock.hash, proofHex);
      } else {
        submitResult = await child.daemon.submitAuxBlock(auxBlock.hash, proofHex);
      }

      if (submitResult === true || submitResult === null || submitResult === undefined || submitResult === '' || false) {
        console.log(`[MergeMining] Aux block ACCEPTED by ${auxCoin.symbol} daemon! height=${auxBlock.height}`);

        // Record the block in the database
        const reward = (auxBlock.coinbasevalue || 0) / 1e8;
        db.prepare(
          'INSERT INTO blocks (coin, height, hash, reward, difficulty, finder_id, worker_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(auxCoinId, auxBlock.height, auxBlock.hash, reward, 0, client.userId, client.workerName, 'pending');

        this.emit('block', {
          coin: auxCoinId,
          height: auxBlock.height,
          hash: auxBlock.hash,
          finder: client.userId,
          worker: client.workerName,
          merged: true,
          parentCoin: client.coin
        });
      } else {
        console.error(`[MergeMining] Aux block REJECTED by ${auxCoin.symbol}: ${JSON.stringify(submitResult)}`);
      }
    } catch (err) {
      console.error(`[MergeMining] Aux proof submit error for ${coins[auxCoinId]?.symbol}:`, err.message);
    }
  }

  sendResponse(client, id, result, error = null) {
    this.sendToClient(client, { id, result, error });
  }

  sendToClient(client, data) {
    try {
      const json = JSON.stringify(data);
      // Log first job sent for debugging
      if (!client._outLogCount) client._outLogCount = 0;
      if (client._outLogCount < 3 && (data.method === 'mining.notify' || data.method === 'mining.set_difficulty' || (data.result && Array.isArray(data.result)))) {
        client._outLogCount++;
        console.log(`[RAW-OUT] ${client.id}: ${json.substring(0, 2000)}`);
      }
      if (data.id && data.id > 0 && !data.method) { console.log(`[SUBMIT-RESP] ${client.id}: ${json}`); }
      client.socket.write(json + '\n');
    } catch (err) {
      console.error(`[Stratum] Send error to ${client.id}:`, err.message);
    }
  }

  getExtraNonce1() {
    this.extraNonce1Counter++;
    return this.extraNonce1Counter.toString(16).padStart(8, '0');
  }

  getDefaultDifficulty(algorithm) {
    // Fallback only - used when coin has no stratumPorts config
    // Port-specific difficulty from coins.js takes priority
    const defaults = {
      sha256: 65536,   // 64K - low start, vardiff ramps up quickly for any miner
      scrypt: 65536    // 64K - low start, vardiff ramps up quickly for any miner
    };
    return defaults[algorithm] || 1;
  }

  broadcastJob(coinId, cleanJobs = true) {
    for (const client of this.clients.values()) {
      if (client.coin === coinId && client.subscribed && client.authorized) {
        this.sendJob(client, cleanJobs);
      }
    }
  }

  getStats() {
    const stats = {};
    for (const coinId of Object.keys(coins)) {
      stats[coinId] = { miners: 0, workers: 0, connections: 0 };
    }

    for (const client of this.clients.values()) {
      if (client.authorized && stats[client.coin]) {
        stats[client.coin].connections++;
      }
    }

    return stats;
  }

  stop() {
    for (const [coinId, server] of this.servers) {
      server.close();
      console.log(`[Stratum] Stopped ${coinId} server`);
    }
    for (const interval of this.templatePollers.values()) {
      clearInterval(interval);
    }
    for (const client of this.clients.values()) {
      client.socket.destroy();
    }
    this.clients.clear();
    this.templatePollers.clear();
  }
}

module.exports = StratumServer;
