/**
 * Docker Control - Create/start/stop coin daemon containers via Docker socket
 * Uses the Docker Engine API directly (no external dependencies)
 * Containers are created on-demand when admin enables a coin
 */
const http = require('http');

const PROJECT = process.env.DOCKER_PROJECT || 'happychina-pool';
const NETWORK = `${PROJECT}_default`;

// Coin daemon container configurations (real images from VPS)
const DAEMON_CONFIGS = {
  litecoin: {
    service: 'litecoind',
    image: 'uphold/litecoin-core:0.21',
    dataDir: '/home/litecoin/.litecoin',
    cmd: ['litecoind', '-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=9332', '-port=9333', '-txindex=1', '-printtoconsole', '-dbcache=512']
  },
  dogecoin: {
    service: 'dogecoind',
    image: 'btcpayserver/dogecoin:1.14.9-amd64',
    dataDir: '/home/dogecoin/.dogecoin',
    cmd: ['dogecoind', '-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=22555', '-port=22556', '-txindex=1', '-printtoconsole']
  },
  pepecoin: {
    service: 'pepecoind',
    image: 'pepeenthusiast/pepecoin-core:latest',
    dataDir: '/home/pepecoin/.pepecoin',
    cmd: ['pepecoind', '-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=29373', '-port=29374', '-printtoconsole']
  },
  bells: {
    service: 'bellsd',
    image: 'ghcr.io/bobparkerbob888-tech/bellscoin:3.0',
    dataDir: '/root/.bells',
    cmd: ['-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=19918', '-port=19919', '-printtoconsole', '-dbcache=512']
  },
  luckycoin: {
    service: 'luckycoind',
    image: 'btccom/luckycoin:4.0.1',
    dataDir: '/root/.luckycoin',
    cmd: ['/bin/luckycoind', '-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=9918', '-port=9917', '-printtoconsole']
  },
  junkcoin: {
    service: 'junkcoind',
    image: 'btccom/junkcoin:latest',
    dataDir: '/root/.junkcoin',
    cmd: ['/usr/local/bin/junkcoind', '-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=9772', '-port=9771', '-printtoconsole']
  },
  dingocoin: {
    service: 'dingocoind',
    image: 'ghcr.io/bobparkerbob888-tech/dingocoin:v1.18.0.0',
    dataDir: '/root/.dingocoin',
    cmd: ['-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=34646', '-port=33117', '-printtoconsole', '-dbcache=512']
  },
  shibacoin: {
    service: 'shibacoind',
    image: 'ghcr.io/bobparkerbob888-tech/shibacoin:1.2.1',
    dataDir: '/root/.shibacoin',
    cmd: ['-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=33863', '-port=33864', '-printtoconsole', '-dbcache=512']
  },
  trumpow: {
    service: 'trumpowd',
    image: 'ghcr.io/bobparkerbob888-tech/trumpow:1.0',
    dataDir: '/root/.trumpow',
    cmd: ['-server=1', '-rpcuser=umbrel', '-rpcpassword=umbrel', '-rpcallowip=0.0.0.0/0', '-rpcbind=0.0.0.0', '-rpcport=33883', '-port=33884', '-printtoconsole', '-dbcache=512']
  }
};

function dockerRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      socketPath: '/var/run/docker.sock',
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: data ? JSON.parse(data) : null });
        } catch {
          resolve({ statusCode: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Find existing container by name
async function findContainer(serviceName) {
  try {
    const containerName = `${PROJECT}_${serviceName}_1`;
    const filters = JSON.stringify({ name: [containerName] });
    const res = await dockerRequest('GET', `/containers/json?all=true&filters=${encodeURIComponent(filters)}`);
    if (res.statusCode === 200 && res.data && res.data.length > 0) {
      // Exact match
      for (const c of res.data) {
        if (c.Names && c.Names.some(n => n === `/${containerName}`)) return c;
      }
      return res.data[0];
    }
    return null;
  } catch (err) {
    console.error(`[Docker] Error finding container ${serviceName}:`, err.message);
    return null;
  }
}

// Pull an image
async function pullImage(imageName) {
  console.log(`[Docker] Pulling image ${imageName}...`);
  const res = await dockerRequest('POST', `/images/create?fromImage=${encodeURIComponent(imageName)}`);
  if (res.statusCode === 200) {
    console.log(`[Docker] Image ${imageName} pulled successfully`);
    return true;
  }
  console.error(`[Docker] Failed to pull ${imageName}: ${res.statusCode}`);
  return false;
}

// Create and start a daemon container
async function startCoinDaemon(coinId) {
  const cfg = DAEMON_CONFIGS[coinId];
  if (!cfg) throw new Error(`Unknown coin: ${coinId}`);

  // Check if container already exists
  let container = await findContainer(cfg.service);

  if (container) {
    // Container exists - just start it if stopped
    if (container.State === 'running') {
      return { success: true, action: 'already_running', service: cfg.service };
    }
    const res = await dockerRequest('POST', `/containers/${container.Id}/start`);
    if (res.statusCode === 204 || res.statusCode === 304) {
      console.log(`[Docker] Started existing ${cfg.service}`);
      return { success: true, action: 'started', service: cfg.service };
    }
    throw new Error(`Failed to start ${cfg.service}: ${res.statusCode} ${JSON.stringify(res.data)}`);
  }

  // Pull image first
  await pullImage(cfg.image);

  // Create the container
  const containerName = `${PROJECT}_${cfg.service}_1`;
  const volumeName = `${PROJECT}_${coinId}-data`;

  const createConfig = {
    Image: cfg.image,
    Cmd: cfg.cmd,
    HostConfig: {
      Binds: [`${volumeName}:${cfg.dataDir}`],
      RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 },
      NetworkMode: NETWORK
    },
    NetworkingConfig: {
      EndpointsConfig: {
        [NETWORK]: {
          Aliases: [cfg.service]
        }
      }
    }
  };

  const res = await dockerRequest('POST', `/containers/create?name=${encodeURIComponent(containerName)}`, createConfig);

  if (res.statusCode === 201) {
    // Start it
    const startRes = await dockerRequest('POST', `/containers/${res.data.Id}/start`);
    if (startRes.statusCode === 204) {
      console.log(`[Docker] Created and started ${cfg.service}`);
      return { success: true, action: 'created', service: cfg.service };
    }
    throw new Error(`Created but failed to start ${cfg.service}: ${startRes.statusCode}`);
  } else if (res.statusCode === 409) {
    // Container name conflict - try to start existing
    container = await findContainer(cfg.service);
    if (container) {
      await dockerRequest('POST', `/containers/${container.Id}/start`);
      return { success: true, action: 'started', service: cfg.service };
    }
  }

  throw new Error(`Failed to create ${cfg.service}: ${res.statusCode} ${JSON.stringify(res.data)}`);
}

async function stopCoinDaemon(coinId) {
  const cfg = DAEMON_CONFIGS[coinId];
  if (!cfg) throw new Error(`Unknown coin: ${coinId}`);

  const container = await findContainer(cfg.service);
  if (!container) {
    return { success: true, action: 'not_found', service: cfg.service };
  }

  if (container.State !== 'running') {
    return { success: true, action: 'already_stopped', service: cfg.service };
  }

  const res = await dockerRequest('POST', `/containers/${container.Id}/stop?t=30`);
  if (res.statusCode === 204 || res.statusCode === 304) {
    console.log(`[Docker] Stopped ${cfg.service}`);
    return { success: true, action: 'stopped', service: cfg.service };
  }

  throw new Error(`Failed to stop ${cfg.service}: ${res.statusCode} ${JSON.stringify(res.data)}`);
}

async function getCoinDaemonStatus(coinId) {
  const cfg = DAEMON_CONFIGS[coinId];
  if (!cfg) return { running: false, exists: false };

  const container = await findContainer(cfg.service);
  if (!container) return { running: false, exists: false };

  return {
    running: container.State === 'running',
    exists: true,
    state: container.State,
    status: container.Status
  };
}

module.exports = { startCoinDaemon, stopCoinDaemon, getCoinDaemonStatus, DAEMON_CONFIGS };
