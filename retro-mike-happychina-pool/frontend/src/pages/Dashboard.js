import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getDashboard, getMinerHashrate, getDaemonStatus } from '../services/api';
import { formatHashrate, formatCoin, formatTimeAgo } from '../utils/format';
import HashrateChart from '../components/HashrateChart';

function Dashboard() {
  const [data, setData] = useState(null);
  const [hashHistory, setHashHistory] = useState([]);
  const [daemonStatus, setDaemonStatus] = useState(null);
  const [period, setPeriod] = useState('24h');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getDashboard()
      .then(res => { setData(res.data); setLoading(false); })
      .catch(() => setLoading(false));
    getDaemonStatus()
      .then(res => setDaemonStatus(res.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getMinerHashrate(null, period)
      .then(res => setHashHistory(res.data))
      .catch(() => {});
  }, [period]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!data) return <div className="empty-state"><h3>Failed to load dashboard</h3></div>;

  const coins = Object.keys(data.totalHashrate);

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <p>Overview of your mining operations</p>
      </div>

      {/* Stats cards */}
      <div className="stats-grid">
        {coins.map(coin => (
          <div className="stat-card accent" key={coin}>
            <div className="label">{coin} Hashrate</div>
            <div className="value">{formatHashrate(data.totalHashrate[coin])}</div>
            <div className="sub">{data.onlineWorkers[coin] || 0} workers online</div>
          </div>
        ))}
        {coins.length === 0 && (
          <div className="stat-card">
            <div className="label">Total Hashrate</div>
            <div className="value">0 H/s</div>
            <div className="sub">No active workers</div>
          </div>
        )}
        <div className="stat-card">
          <div className="label">Total Workers</div>
          <div className="value">{data.workerCount}</div>
        </div>
        <div className="stat-card green">
          <div className="label">Blocks Found</div>
          <div className="value">{data.blocksFound?.reduce((s, b) => s + b.count, 0) || 0}</div>
        </div>
      </div>

      {/* Daemon Status */}
      {daemonStatus && Object.keys(daemonStatus).length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2>Coin Status</h2>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Status</th>
                  <th>Block Height</th>
                  <th>Sync Progress</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(daemonStatus).map(([coinId, status]) => (
                  <tr key={coinId}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                      <span className={`coin-dot coin-${status.symbol?.toLowerCase()}`} />
                      {status.name} ({status.symbol})
                    </td>
                    <td>
                      <span className={`status-badge ${status.online ? (status.syncing ? 'pending' : 'online') : 'offline'}`}>
                        {status.online ? (status.syncing ? 'Syncing' : 'Synced') : 'Offline'}
                      </span>
                    </td>
                    <td className="mono">{status.blockHeight ? status.blockHeight.toLocaleString() : '-'}</td>
                    <td>
                      {status.online ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, maxWidth: 120 }}>
                            <div style={{
                              width: `${Math.min(status.syncProgress, 100)}%`,
                              height: '100%',
                              background: status.syncProgress >= 99.99 ? 'var(--green)' : 'var(--orange)',
                              borderRadius: 3
                            }} />
                          </div>
                          <span className="mono" style={{ fontSize: 12 }}>{status.syncProgress.toFixed(2)}%</span>
                        </div>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hashrate chart */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h2>Hashrate History</h2>
          <div className="tab-bar">
            {['1h', '6h', '24h', '7d', '30d'].map(p => (
              <button key={p} className={`tab-btn ${period === p ? 'active' : ''}`} onClick={() => setPeriod(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <HashrateChart data={hashHistory} />
      </div>

      {/* Balances */}
      {data.balances.length > 0 && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <h2>Balances</h2>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Pending</th>
                  <th>Confirmed</th>
                  <th>Total Paid</th>
                </tr>
              </thead>
              <tbody>
                {data.balances.map(b => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.coin}</td>
                    <td className="mono" style={{ color: 'var(--orange)' }}>{parseFloat(b.pending).toFixed(8)}</td>
                    <td className="mono" style={{ color: 'var(--green)' }}>{parseFloat(b.confirmed).toFixed(8)}</td>
                    <td className="mono">{parseFloat(b.paid).toFixed(8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent workers */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h2>Workers</h2>
          <Link to="/workers" className="btn btn-sm btn-secondary">View All</Link>
        </div>
        {data.workers.length === 0 ? (
          <div className="empty-state">
            <h3>No workers connected</h3>
            <p>Configure your miner to connect to our stratum server</p>
            <Link to="/getting-started" className="btn btn-primary" style={{ marginTop: 12 }}>Getting Started</Link>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Coin</th>
                  <th>Hashrate</th>
                  <th>Shares (V/I)</th>
                  <th>Last Share</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.workers.slice(0, 10).map(w => (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{w.name}</td>
                    <td>{w.coin}</td>
                    <td className="mono">{formatHashrate(w.hashrate)}</td>
                    <td className="mono">
                      <span style={{ color: 'var(--green)' }}>{w.shares_valid}</span>
                      {' / '}
                      <span style={{ color: 'var(--red)' }}>{w.shares_invalid}</span>
                    </td>
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

      {/* Recent payments */}
      {data.recentPayments.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2>Recent Payments</h2>
            <Link to="/payments" className="btn btn-sm btn-secondary">View All</Link>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Amount</th>
                  <th>TX Hash</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPayments.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 500 }}>{p.coin}</td>
                    <td className="mono">{parseFloat(p.amount).toFixed(8)}</td>
                    <td className="mono">{p.tx_hash ? `${p.tx_hash.substring(0, 16)}...` : '-'}</td>
                    <td><span className={`status-badge ${p.status}`}>{p.status}</span></td>
                    <td>{new Date(p.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
