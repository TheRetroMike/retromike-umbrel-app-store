import React, { useState, useEffect } from 'react';
import { getWorkers, getPoolInfo } from '../services/api';
import { formatHashrate, formatTimeAgo, formatNumber } from '../utils/format';

function Workers() {
  const [workers, setWorkers] = useState([]);
  const [poolInfo, setPoolInfo] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getWorkers().then(res => setWorkers(res.data)),
      getPoolInfo().then(res => setPoolInfo(res.data)).catch(() => {})
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  const coins = [...new Set(workers.map(w => w.coin))];
  const filtered = filter === 'all' ? workers :
    filter === 'online' ? workers.filter(w => w.is_online) :
    filter === 'offline' ? workers.filter(w => !w.is_online) :
    workers.filter(w => w.coin === filter);

  const onlineCount = workers.filter(w => w.is_online).length;
  const totalHashrate = workers.filter(w => w.is_online).reduce((s, w) => s + w.hashrate, 0);
  const bestShare = Math.max(0, ...workers.map(w => w.best_share || 0));

  // Time to find block calculation per coin
  const formatTTF = (seconds) => {
    if (!seconds || !isFinite(seconds)) return 'N/A';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
    if (seconds < 86400 * 365) return `${(seconds / 86400).toFixed(1)}d`;
    return `${(seconds / (86400 * 365)).toFixed(1)}y`;
  };

  const getTimeToBlockByCoin = (coinId) => {
    if (!poolInfo) return 'N/A';
    const coinWorkers = workers.filter(w => w.coin === coinId && w.is_online);
    const coinHashrate = coinWorkers.reduce((s, w) => s + w.hashrate, 0);
    if (!coinHashrate) return 'N/A';
    const coinInfo = poolInfo.coins?.[coinId];
    if (!coinInfo?.network?.difficulty) return 'N/A';
    const netDiff = coinInfo.network.difficulty;
    // TTF = netDiff * 2^32 / hashrate (same formula for all algorithms)
    return formatTTF((netDiff * Math.pow(2, 32)) / coinHashrate);
  };

  // Per-coin hashrates
  const ltcHashrate = workers.filter(w => w.coin === 'litecoin' && w.is_online).reduce((s, w) => s + w.hashrate, 0);

  return (
    <div>
      <div className="page-header">
        <h1>Workers</h1>
        <p>Manage and monitor your mining workers</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card accent">
          <div className="label">Online Workers</div>
          <div className="value">{onlineCount}</div>
        </div>
        {ltcHashrate > 0 && (
          <div className="stat-card" style={{ borderLeft: '3px solid #bfbbbb' }}>
            <div className="label">⛏️ Litecoin (Scrypt)</div>
            <div className="value">{formatHashrate(ltcHashrate)}</div>
            <div className="label" style={{ marginTop: 4 }}>TTF Block: <strong>{getTimeToBlockByCoin('litecoin')}</strong></div>
          </div>
        )}
        <div className="stat-card">
          <div className="label">Best Share</div>
          <div className="value">{formatNumber(bestShare, 0)}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Worker List</h2>
          <div className="tab-bar">
            <button className={`tab-btn ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
            <button className={`tab-btn ${filter === 'online' ? 'active' : ''}`} onClick={() => setFilter('online')}>Online</button>
            <button className={`tab-btn ${filter === 'offline' ? 'active' : ''}`} onClick={() => setFilter('offline')}>Offline</button>
            {coins.map(c => (
              <button key={c} className={`tab-btn ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state"><h3>No workers found</h3></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Worker Name</th>
                  <th>Coin</th>
                  <th>Hashrate</th>
                  <th>Difficulty</th>
                  <th>Best Share</th>
                  <th>Valid Shares</th>
                  <th>Invalid Shares</th>
                  <th>Last Share</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(w => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{w.name}</td>
                    <td>{w.coin}</td>
                    <td className="mono">{formatHashrate(w.hashrate)}</td>
                    <td className="mono">{formatNumber(w.difficulty, 0)}</td>
                    <td className="mono">{formatNumber(w.best_share || 0, 0)}</td>
                    <td className="mono" style={{ color: 'var(--green)' }}>{w.shares_valid}</td>
                    <td className="mono" style={{ color: w.shares_invalid > 0 ? 'var(--red)' : 'var(--text-secondary)' }}>{w.shares_invalid}</td>
                    <td>{formatTimeAgo(w.last_share)}</td>
                    <td>
                      <span className={`status-badge ${w.is_online ? 'online' : 'offline'}`}>
                        {w.is_online ? 'Online' : 'Offline'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Workers;
