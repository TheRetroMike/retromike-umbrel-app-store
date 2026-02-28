import React, { useState, useEffect } from 'react';
import { getPoolBlocks } from '../services/api';
import { formatTimeAgo, shortenHash } from '../utils/format';

function Blocks() {
  const [blocks, setBlocks] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [coinFilter, setCoinFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getPoolBlocks({ page, coin: coinFilter || undefined })
      .then(res => {
        setBlocks(res.data.blocks);
        setPagination(res.data.pagination);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, coinFilter]);

  const coins = [...new Set(blocks.map(b => b.coin))];
  const confirmed = blocks.filter(b => b.status === 'confirmed').length;
  const pending = blocks.filter(b => b.status === 'pending').length;
  const orphaned = blocks.filter(b => b.status === 'orphaned').length;

  return (
    <div>
      <div className="page-header">
        <h1>Blocks Found</h1>
        <p>All blocks discovered by the pool</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card accent">
          <div className="label">Total Blocks</div>
          <div className="value">{pagination.total || 0}</div>
        </div>
        <div className="stat-card green">
          <div className="label">Confirmed</div>
          <div className="value">{confirmed}</div>
        </div>
        <div className="stat-card">
          <div className="label">Pending</div>
          <div className="value">{pending}</div>
        </div>
        <div className="stat-card">
          <div className="label">Orphaned</div>
          <div className="value" style={{ color: 'var(--red)' }}>{orphaned}</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2>Block List</h2>
          <div className="tab-bar">
            <button className={`tab-btn ${coinFilter === '' ? 'active' : ''}`} onClick={() => { setCoinFilter(''); setPage(1); }}>All</button>
            {coins.map(c => (
              <button key={c} className={`tab-btn ${coinFilter === c ? 'active' : ''}`} onClick={() => { setCoinFilter(c); setPage(1); }}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="loading-screen"><div className="spinner" /></div>
        ) : blocks.length === 0 ? (
          <div className="empty-state"><h3>No blocks found</h3></div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th>Height</th>
                    <th>Hash</th>
                    <th>Reward</th>
                    <th>Finder</th>
                    <th>Worker</th>
                    <th>Confirmations</th>
                    <th>Status</th>
                    <th>Found</th>
                  </tr>
                </thead>
                <tbody>
                  {blocks.map(b => (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.coin}</td>
                      <td className="mono">{b.height}</td>
                      <td className="mono">{shortenHash(b.hash)}</td>
                      <td className="mono">{b.reward}</td>
                      <td>{b.finder_name || '-'}</td>
                      <td>{b.worker_name || '-'}</td>
                      <td className="mono">{b.confirmations}</td>
                      <td><span className={`status-badge ${b.status}`}>{b.status}</span></td>
                      <td>{formatTimeAgo(b.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pagination.pages > 1 && (
              <div className="pagination">
                <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}>Prev</button>
                <span>Page {page} of {pagination.pages}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= pagination.pages}>Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Blocks;
