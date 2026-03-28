/**
 * Coin configurations - Multi-Algorithm Pool (SHA-256 + Scrypt)
 * Each coin specifies its algorithm, daemon RPC settings, stratum port, and reward info.
 * Daemon credentials are loaded from environment variables (.env file).
 */
const coins = {
  litecoin: {
    name: 'Litecoin',
    symbol: 'LTC',
    algorithm: 'scrypt',
    stratumPort: 3333,
    // Multiple difficulty ports - vardiff ramps up from starting diff
    stratumPorts: [
      { port: 3333, diff: 1048576, fixedDiff: true, label: 'Fixed Diff 1M (ASIC miners)' },
      { port: 3344, diff: 8,    label: 'Low Diff (CPU/GPU miners)' }
    ],
    reward: 6.25,
    blockTime: 150,
    confirmations: 2,
    segwit: true,
    mweb: true,
    daemon: {
      host: process.env.LTC_RPC_HOST || '127.0.0.1',
      port: parseInt(process.env.LTC_RPC_PORT) || 9332,
      user: process.env.LTC_RPC_USER || 'rpcuser',
      pass: process.env.LTC_RPC_PASS || 'rpcuser'
    },
    explorer: 'https://blockchair.com/litecoin/transaction/',
    addressPrefixes: ['L', 'M', 'ltc1']
  },
  dogecoin: {
    name: 'Dogecoin',
    symbol: 'DOGE',
    algorithm: 'scrypt',
    stratumPort: 3334,
    reward: 10000,
    blockTime: 60,
    confirmations: 2,
    mergeMinedWith: 'litecoin',
    chainId: 98,
    auxpowApi: 'getauxblock',
    daemon: {
      host: process.env.DOGE_RPC_HOST || '127.0.0.1',
      port: parseInt(process.env.DOGE_RPC_PORT) || 22555,
      user: process.env.DOGE_RPC_USER || 'rpcuser',
      pass: process.env.DOGE_RPC_PASS || 'rpcuser'
    },
    explorer: 'https://blockchair.com/dogecoin/transaction/',
    addressPrefixes: ['D']
  },
  pepecoin: {
    name: 'Pepecoin',
    symbol: 'PEPE',
    algorithm: 'scrypt',
    stratumPort: 3335,
    reward: 0,
    blockTime: 60,
    confirmations: 2,
    mergeMinedWith: 'litecoin',
    chainId: 63,
    auxpowApi: 'createauxblock',
    daemon: {
      host: process.env.PEPE_RPC_HOST || '127.0.0.1',
      port: parseInt(process.env.PEPE_RPC_PORT) || 29373,
      user: process.env.PEPE_RPC_USER || 'rpcuser',
      pass: process.env.PEPE_RPC_PASS || 'rpcuser'
    },
    explorer: '',
    addressPrefixes: ['P']
  },
  bells: {
    name: 'Bells',
    symbol: 'BELLS',
    algorithm: 'scrypt',
    stratumPort: 3336,
    reward: 0,
    blockTime: 60,
    confirmations: 2,
    segwit: true,
    mergeMinedWith: 'litecoin',
    chainId: 16,
    auxpowApi: 'createauxblock',
    daemon: {
      host: process.env.BELLS_RPC_HOST || '127.0.0.1',
      port: parseInt(process.env.BELLS_RPC_PORT) || 19918,
      user: process.env.BELLS_RPC_USER || 'rpcuser',
      pass: process.env.BELLS_RPC_PASS || 'rpcuser'
    },
    explorer: '',
    addressPrefixes: ['B']
  },
  junkcoin: {
    name: 'Junkcoin',
    symbol: 'JKC',
    algorithm: 'scrypt',
    stratumPort: 3338,
    reward: 0,
    blockTime: 60,
    confirmations: 2,
    mergeMinedWith: 'litecoin',
    chainId: 8224,
    auxpowApi: 'createauxblock',
    payoutAddress: process.env.JKC_PAYOUT_ADDRESS || '',
    daemon: {
      host: process.env.JKC_RPC_HOST || '127.0.0.1',
      port: parseInt(process.env.JKC_RPC_PORT) || 9772,
      user: process.env.JKC_RPC_USER || 'rpcuser',
      pass: process.env.JKC_RPC_PASS || 'rpcuser'
    },
    explorer: '',
    addressPrefixes: ['J', '7']
  },
  dingocoin: {
    name: 'Dingocoin',
    symbol: 'DINGO',
    algorithm: 'scrypt',
    stratumPort: 3339,
    reward: 0,
    blockTime: 60,
    confirmations: 2,
    mergeMinedWith: 'litecoin',
    chainId: 50,
    auxpowApi: 'createauxblock',
    daemon: {
      host: process.env.DINGO_RPC_HOST || '127.0.0.1',
      port: parseInt(process.env.DINGO_RPC_PORT) || 34646,
      user: process.env.DINGO_RPC_USER || 'rpcuser',
      pass: process.env.DINGO_RPC_PASS || 'rpcuser'
    },
    explorer: '',
    addressPrefixes: ['D']
  },
  shibacoin: {
    name: 'Shibacoin',
    symbol: 'SHIC',
    algorithm: 'scrypt',
    stratumPort: 3340,
    reward: 0,
    blockTime: 60,
    confirmations: 2,
    mergeMinedWith: 'litecoin',
    chainId: 74,
    auxpowApi: 'createauxblock',
    daemon: {
      host: process.env.SHIC_RPC_HOST || '127.0.0.1',
      port: parseInt(process.env.SHIC_RPC_PORT) || 33863,
      user: process.env.SHIC_RPC_USER || 'rpcuser',
      pass: process.env.SHIC_RPC_PASS || 'rpcuser'
    },
    explorer: '',
    addressPrefixes: ['S']
  },
  trumpow: {
    name: 'TrumPOW',
    symbol: 'TRMP',
    algorithm: 'scrypt',
    stratumPort: 3341,
    reward: 0,
    blockTime: 60,
    confirmations: 2,
    mergeMinedWith: 'litecoin',
    chainId: 168,
    auxpowApi: 'createauxblock',
    daemon: {
      host: process.env.TRMP_RPC_HOST || '127.0.0.1',
      port: parseInt(process.env.TRMP_RPC_PORT) || 33883,
      user: process.env.TRMP_RPC_USER || 'rpcuser',
      pass: process.env.TRMP_RPC_PASS || 'rpcuser'
    },
    explorer: '',
    addressPrefixes: ['T']
  }
};

// Map algorithms to their display names and supported coins
const algorithms = {};
for (const [coinId, coin] of Object.entries(coins)) {
  if (!algorithms[coin.algorithm]) {
    algorithms[coin.algorithm] = {
      name: coin.algorithm.toUpperCase(),
      coins: []
    };
  }
  algorithms[coin.algorithm].coins.push(coinId);
}

module.exports = { coins, algorithms };
