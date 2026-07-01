import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getPoolStats } from '../services/api';
import { formatHashrate, formatNumber, formatTimeAgo, shortenHash } from '../utils/format';
import HashrateChart from '../components/HashrateChart';

function CoinStats() {
  const { coin } = useParams();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPoolStats(coin)
      .then(res => { setStats(res.data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [coin]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!stats) return <div className="empty-state"><h3>Coin not found</h3></div>;

  const { coin: coinInfo, current, hashrateHistory, recentBlocks, topMiners } = stats;

  return (
    <div>
      <div className="page-header">
        <h1>{coinInfo.name} ({coinInfo.symbol})</h1>
        <p>Algorithm: {coinInfo.algorithm.toUpperCase()} | Stratum Port: {coinInfo.stratumPort} | Block Reward: {coinInfo.reward} {coinInfo.symbol}</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card accent">
          <div className="label">Pool Hashrate</div>
          <div className="value">{formatHashrate(current?.hashrate)}</div>
        </div>
        <div className="stat-card green">
          <div className="label">Active Miners</div>
          <div className="value">{current?.miners || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Workers</div>
          <div className="value">{current?.workers || 0}</div>
        </div>
        <div className="stat-card">
          <div className="label">Network Difficulty</div>
          <div className="value">{formatNumber(current?.difficulty)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Network Hashrate</div>
          <div className="value">{formatHashrate(current?.network_hashrate)}</div>
        </div>
        <div className="stat-card">
          <div className="label">Block Height</div>
          <div className="value">{formatNumber(current?.block_height, 0)}</div>
        </div>
      </div>

      {/* Hashrate chart */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h2>Pool Hashrate</h2>
        </div>
        <HashrateChart data={hashrateHistory} label={`${coinInfo.symbol} Pool Hashrate`} />
      </div>

      {/* Connection info */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h2>Connection Details</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>STRATUM URL</div>
            <code style={{ color: 'var(--accent)', fontSize: 14 }}>stratum+tcp://{window.location.hostname}:{coinInfo.stratumPort}</code>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>WORKER FORMAT</div>
            <code style={{ color: 'var(--accent)', fontSize: 14 }}>username.workerName</code>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>ALGORITHM</div>
            <code style={{ color: 'var(--text-primary)', fontSize: 14 }}>{coinInfo.algorithm.toUpperCase()}</code>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>REWARD SCHEME</div>
            <code style={{ color: 'var(--text-primary)', fontSize: 14 }}>PPLNS (1% fee)</code>
          </div>
        </div>
      </div>

      {/* Top miners */}
      {topMiners && topMiners.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2>Top Miners</h2>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Miner</th>
                  <th>Hashrate</th>
                  <th>Workers</th>
                </tr>
              </thead>
              <tbody>
                {topMiners.map((m, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.username}</td>
                    <td className="mono">{formatHashrate(m.total_hashrate)}</td>
                    <td>{m.worker_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent blocks */}
      <div className="card">
        <div className="card-header">
          <h2>Recent Blocks</h2>
        </div>
        {recentBlocks.length === 0 ? (
          <div className="empty-state"><h3>No blocks found yet</h3></div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Height</th>
                  <th>Hash</th>
                  <th>Reward</th>
                  <th>Finder</th>
                  <th>Confirmations</th>
                  <th>Status</th>
                  <th>Found</th>
                </tr>
              </thead>
              <tbody>
                {recentBlocks.map(b => (
                  <tr key={b.id}>
                    <td className="mono">{b.height}</td>
                    <td className="mono">{shortenHash(b.hash)}</td>
                    <td className="mono">{b.reward} {coinInfo.symbol}</td>
                    <td>{b.finder_name || 'Unknown'}</td>
                    <td className="mono">{b.confirmations}</td>
                    <td><span className={`status-badge ${b.status}`}>{b.status}</span></td>
                    <td>{formatTimeAgo(b.created_at)}</td>
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

export default CoinStats;
