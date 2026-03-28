import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getCoins } from '../services/api';
import { formatHashrate, formatNumber } from '../utils/format';

function PoolStats() {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCoins()
      .then(res => { setCoins(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  const totalMiners = coins.reduce((s, c) => s + (c.miners || 0), 0);

  // Group by algorithm
  const algos = {};
  for (const coin of coins) {
    if (!algos[coin.algorithm]) algos[coin.algorithm] = [];
    algos[coin.algorithm].push(coin);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Pool Statistics</h1>
        <p>{coins.length} coins supported across {Object.keys(algos).length} algorithms - {totalMiners} active miners</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card accent">
          <div className="label">Supported Coins</div>
          <div className="value">{coins.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Algorithms</div>
          <div className="value">{Object.keys(algos).length}</div>
        </div>
        <div className="stat-card green">
          <div className="label">Active Miners</div>
          <div className="value">{totalMiners}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pool Fee</div>
          <div className="value">1%</div>
        </div>
      </div>

      {Object.entries(algos).map(([algo, algoCoins]) => (
        <div key={algo} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16, color: 'var(--accent)' }}>
            {algo.toUpperCase()}
          </h2>
          <div className="coin-grid">
            {algoCoins.map(coin => (
              <Link to={`/stats/${coin.id}`} key={coin.id} className="coin-card">
                <div className="coin-header">
                  <div className="coin-symbol">{coin.symbol}</div>
                  <div>
                    <div className="coin-name">{coin.name}</div>
                    <div className="coin-algo">Port: {coin.stratumPort}</div>
                  </div>
                </div>
                <div className="coin-stats">
                  <div>
                    <div className="coin-stat-label">Pool Hashrate</div>
                    <div className="coin-stat-value">{formatHashrate(coin.poolHashrate)}</div>
                  </div>
                  <div>
                    <div className="coin-stat-label">Miners</div>
                    <div className="coin-stat-value">{coin.miners}</div>
                  </div>
                  <div>
                    <div className="coin-stat-label">Network Diff</div>
                    <div className="coin-stat-value">{formatNumber(coin.networkDifficulty)}</div>
                  </div>
                  <div>
                    <div className="coin-stat-label">Block Height</div>
                    <div className="coin-stat-value">{formatNumber(coin.blockHeight, 0)}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default PoolStats;
