/**
 * AuxPoW (Auxiliary Proof of Work) Merge Mining Module
 *
 * Implements the merged mining protocol used by Namecoin, Dogecoin, and other
 * AuxPoW-capable chains. Allows mining a parent chain (BTC/LTC) and simultaneously
 * solving blocks on auxiliary chains that share the same PoW algorithm.
 *
 * Protocol references:
 * - Namecoin merged mining spec
 * - BIP (draft) for merged mining
 * - Dogecoin AuxPoW implementation
 */

const crypto = require('crypto');

// Magic bytes identifying merge mining commitment in coinbase scriptSig
const MERGE_MINING_MAGIC = Buffer.from('fabe6d6d', 'hex');

// Double SHA-256
function sha256d(buffer) {
  return crypto.createHash('sha256').update(
    crypto.createHash('sha256').update(buffer).digest()
  ).digest();
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

/**
 * Compute the expected slot index for a chain in the aux merkle tree.
 * Uses the deterministic pseudo-random algorithm from Namecoin's CAuxPow::getExpectedIndex.
 *
 * @param {number} nonce - Merkle nonce (from coinbase commitment)
 * @param {number} chainId - Chain ID of the auxiliary chain
 * @param {number} treeSize - Size of the aux merkle tree (must be power of 2)
 * @returns {number} Slot index in the tree
 */
function getExpectedIndex(nonce, chainId, treeSize) {
  // Use unsigned 32-bit arithmetic (>>> 0 forces unsigned)
  let rand = (Math.imul(nonce >>> 0, 1103515245) + 12345) >>> 0;
  rand = (Math.imul((rand + chainId) >>> 0, 1103515245) + 12345) >>> 0;
  return rand % treeSize;
}

/**
 * Find the smallest tree size and merkle nonce that avoids slot collisions
 * for the given set of chain IDs.
 *
 * @param {number[]} chainIds - Array of chain IDs to place in the tree
 * @returns {{ treeSize: number, depth: number, nonce: number, slots: Map<number, number> }}
 */
function findTreeParams(chainIds) {
  if (chainIds.length === 0) {
    return { treeSize: 1, depth: 0, nonce: 0, slots: new Map() };
  }
  if (chainIds.length === 1) {
    const slot = getExpectedIndex(0, chainIds[0], 1);
    return { treeSize: 1, depth: 0, nonce: 0, slots: new Map([[chainIds[0], slot]]) };
  }

  for (let depth = 1; depth <= 16; depth++) {
    const treeSize = 1 << depth;
    for (let nonce = 0; nonce < 100000; nonce++) {
      const slots = new Map();
      let collision = false;
      for (const chainId of chainIds) {
        const slot = getExpectedIndex(nonce, chainId, treeSize);
        if (slots.has(slot)) {
          collision = true;
          break;
        }
        slots.set(slot, chainId);
      }
      if (!collision) {
        // Reverse map: chainId -> slot
        const chainSlots = new Map();
        for (const [slot, cid] of slots) {
          chainSlots.set(cid, slot);
        }
        return { treeSize, depth, nonce, slots: chainSlots };
      }
    }
  }
  throw new Error(`Cannot find collision-free tree params for ${chainIds.length} chains`);
}

/**
 * Build the aux merkle tree from aux block hashes and compute merkle branches.
 *
 * @param {Map<string, { hash: string, chainid: number }>} auxBlocks - coinId -> aux block data
 * @param {{ treeSize: number, depth: number, nonce: number, slots: Map<number, number> }} treeParams
 * @returns {{ merkleRoot: Buffer, branches: Map<string, { branch: Buffer[], index: number }> }}
 */
function buildAuxMerkleTree(auxBlocks, treeParams) {
  const { treeSize, nonce, slots } = treeParams;

  // Initialize leaves with zeros
  const leaves = [];
  for (let i = 0; i < treeSize; i++) {
    leaves.push(Buffer.alloc(32, 0));
  }

  // Map from coinId to slot index
  const coinSlots = new Map();

  // Place each aux block hash at its computed slot
  for (const [coinId, auxBlock] of auxBlocks) {
    const slot = getExpectedIndex(nonce, auxBlock.chainid, treeSize);
    // The hash from getauxblock/createauxblock is in big-endian hex
    // For the merkle tree, we need it in internal byte order (little-endian)
    leaves[slot] = Buffer.from(auxBlock.hash, 'hex').reverse();
    coinSlots.set(coinId, slot);
  }

  // Handle single-leaf case
  if (treeSize === 1) {
    const merkleRoot = leaves[0];
    const branches = new Map();
    for (const [coinId, slot] of coinSlots) {
      branches.set(coinId, { branch: [], index: 0 });
    }
    return { merkleRoot, branches };
  }

  // Build merkle tree level by level
  const tree = [leaves.slice()]; // level 0 = leaves
  let currentLevel = leaves.slice();

  while (currentLevel.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : currentLevel[i];
      nextLevel.push(sha256d(Buffer.concat([left, right])));
    }
    tree.push(nextLevel);
    currentLevel = nextLevel;
  }

  const merkleRoot = tree[tree.length - 1][0];

  // Compute merkle branches for each aux chain
  const branches = new Map();
  for (const [coinId, slot] of coinSlots) {
    const branch = [];
    let idx = slot;
    for (let level = 0; level < tree.length - 1; level++) {
      // Sibling index (XOR with 1 flips the last bit: left<->right)
      const siblingIdx = idx ^ 1;
      if (siblingIdx < tree[level].length) {
        branch.push(tree[level][siblingIdx]);
      }
      idx = idx >> 1;
    }
    branches.set(coinId, { branch, index: slot });
  }

  return { merkleRoot, branches };
}

/**
 * Build the merge mining commitment to embed in the coinbase scriptSig.
 * Format: magic(4) + auxMerkleRoot(32) + treeSize(4 LE) + nonce(4 LE) = 44 bytes
 *
 * @param {Buffer} auxMerkleRoot - 32-byte aux merkle root
 * @param {number} treeSize - Size of the aux merkle tree
 * @param {number} nonce - Merkle nonce
 * @returns {Buffer} 44-byte commitment
 */
function buildMergeCommitment(auxMerkleRoot, treeSize, nonce) {
  const buf = Buffer.alloc(44);
  MERGE_MINING_MAGIC.copy(buf, 0);       // 4 bytes magic
  // Daemon reverses computed root before searching coinbase, so store in big-endian
  const reversedRoot = Buffer.from(auxMerkleRoot).reverse();
  reversedRoot.copy(buf, 4);             // 32 bytes merkle root
  buf.writeUInt32LE(treeSize, 36);        // 4 bytes tree size
  buf.writeUInt32LE(nonce, 40);           // 4 bytes nonce
  return buf;
}

/**
 * Build AuxPoW proof for submission to an auxiliary chain daemon.
 *
 * The proof structure (CAuxPow serialization):
 * 1. Parent coinbase transaction (non-witness serialization)
 * 2. Parent block hash (32 bytes)
 * 3. Coinbase merkle branch (path from coinbase to parent merkle root)
 * 4. Coinbase merkle index (bitmask, always 0 for coinbase)
 * 5. Aux chain merkle branch (path from chain hash to aux merkle root)
 * 6. Aux chain merkle index (slot in aux tree)
 * 7. Parent block header (80 bytes)
 *
 * @param {Buffer} parentCoinbaseTx - Non-witness serialized parent coinbase tx
 * @param {Buffer} parentHeader - 80-byte parent block header
 * @param {Buffer[]} coinbaseMerkleBranch - Merkle path from coinbase to parent merkle root
 * @param {Buffer[]} auxMerkleBranch - Merkle path from aux hash to aux merkle root
 * @param {number} auxMerkleIndex - Slot index in aux merkle tree
 * @returns {Buffer} Serialized AuxPoW proof
 */
function buildAuxPoWProof(parentCoinbaseTx, parentHeader, coinbaseMerkleBranch, auxMerkleBranch, auxMerkleIndex) {
  const parts = [];

  // 1. Parent coinbase transaction
  parts.push(parentCoinbaseTx);

  // 2. Parent block hash
  const parentHash = sha256d(parentHeader);
  parts.push(parentHash);

  // 3. Coinbase merkle branch
  parts.push(writeVarInt(coinbaseMerkleBranch.length));
  for (const hash of coinbaseMerkleBranch) {
    parts.push(hash);
  }
  // Coinbase index bitmask (always 0 - coinbase is first tx)
  const coinbaseIndexBuf = Buffer.alloc(4);
  coinbaseIndexBuf.writeInt32LE(0);
  parts.push(coinbaseIndexBuf);

  // 4. Aux chain merkle branch
  parts.push(writeVarInt(auxMerkleBranch.length));
  for (const hash of auxMerkleBranch) {
    parts.push(hash);
  }
  // Aux chain index bitmask
  const auxIndexBuf = Buffer.alloc(4);
  auxIndexBuf.writeInt32LE(auxMerkleIndex);
  parts.push(auxIndexBuf);

  // 5. Parent block header (80 bytes)
  parts.push(parentHeader);

  return Buffer.concat(parts);
}

/**
 * Compute the merkle branch from the coinbase (index 0) in a list of transaction hashes.
 * This is the path needed to reconstruct the parent block's merkle root from the coinbase hash.
 *
 * @param {string} coinbaseHash - Hex hash of the coinbase transaction
 * @param {string[]} txHashes - Array of all tx hashes (excluding coinbase) from the block template
 * @returns {Buffer[]} Array of 32-byte sibling hashes forming the merkle branch
 */
function computeCoinbaseMerkleBranch(coinbaseHash, txHashes) {
  if (txHashes.length === 0) return [];

  // Full list: coinbase + all other txs
  let hashes = [Buffer.from(coinbaseHash, 'hex')];
  for (const h of txHashes) {
    hashes.push(Buffer.from(h, 'hex'));
  }

  const branch = [];
  while (hashes.length > 1) {
    // The sibling of index 0 at this level is index 1
    if (hashes.length > 1) {
      branch.push(hashes[1]);
    }

    // Compute next level
    const nextLevel = [];
    for (let i = 0; i < hashes.length; i += 2) {
      const left = hashes[i];
      const right = i + 1 < hashes.length ? hashes[i + 1] : hashes[i];
      nextLevel.push(sha256d(Buffer.concat([left, right])));
    }
    hashes = nextLevel;
  }

  return branch;
}

/**
 * Check if a hash (as BigInt) meets a target specified by compact bits.
 *
 * @param {Buffer} hashReversed - 32-byte hash in big-endian (display order)
 * @param {string} bits - Compact target representation (hex string)
 * @returns {boolean}
 */
function hashMeetsAuxTarget(hashReversed, bits) {
  const target = nbitsToTarget(bits);
  for (let i = 0; i < 32; i++) {
    if (hashReversed[i] < target[i]) return true;
    if (hashReversed[i] > target[i]) return false;
  }
  return true; // equal
}

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

module.exports = {
  MERGE_MINING_MAGIC,
  getExpectedIndex,
  findTreeParams,
  buildAuxMerkleTree,
  buildMergeCommitment,
  buildAuxPoWProof,
  computeCoinbaseMerkleBranch,
  hashMeetsAuxTarget,
  sha256d,
  writeVarInt
};
