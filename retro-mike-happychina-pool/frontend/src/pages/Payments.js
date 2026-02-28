import React, { useState, useEffect } from 'react';
import { getPayments, getBalances } from '../services/api';
import { formatTimeAgo, shortenHash } from '../utils/format';

function Payments() {
  const [payments, setPayments] = useState([]);
  const [balances, setBalances] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getPayments({ page }),
      getBalances()
    ]).then(([payRes, balRes]) => {
      setPayments(payRes.data.payments);
      setPagination(payRes.data.pagination);
      setBalances(balRes.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [page]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div>
      <div className="page-header">
        <h1>Payments</h1>
        <p>Your payment history and current balances</p>
      </div>

      {/* Balances */}
      <div className="stats-grid">
        {balances.map(b => (
          <React.Fragment key={b.id}>
            <div className="stat-card">
              <div className="label">{b.coin} Pending</div>
              <div className="value" style={{ color: 'var(--orange)', fontSize: 20 }}>{parseFloat(b.pending).toFixed(8)}</div>
            </div>
            <div className="stat-card green">
              <div className="label">{b.coin} Confirmed</div>
              <div className="value" style={{ fontSize: 20 }}>{parseFloat(b.confirmed).toFixed(8)}</div>
            </div>
            <div className="stat-card">
              <div className="label">{b.coin} Total Paid</div>
              <div className="value" style={{ fontSize: 20 }}>{parseFloat(b.paid).toFixed(8)}</div>
            </div>
          </React.Fragment>
        ))}
        {balances.length === 0 && (
          <div className="stat-card">
            <div className="label">Balance</div>
            <div className="value">0.00000000</div>
            <div className="sub">No earnings yet</div>
          </div>
        )}
      </div>

      {/* Payment history */}
      <div className="card">
        <div className="card-header">
          <h2>Payment History</h2>
        </div>

        {payments.length === 0 ? (
          <div className="empty-state"><h3>No payments yet</h3><p>Payments are processed automatically when your balance reaches the minimum threshold.</p></div>
        ) : (
          <>
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Coin</th>
                    <th>Amount</th>
                    <th>Fee</th>
                    <th>TX Hash</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id}>
                      <td>{new Date(p.created_at).toLocaleString()}</td>
                      <td style={{ fontWeight: 600 }}>{p.coin}</td>
                      <td className="mono" style={{ color: 'var(--green)' }}>{parseFloat(p.amount).toFixed(8)}</td>
                      <td className="mono">{parseFloat(p.fee).toFixed(8)}</td>
                      <td className="mono">{p.tx_hash ? shortenHash(p.tx_hash) : '-'}</td>
                      <td><span className={`status-badge ${p.status}`}>{p.status}</span></td>
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

export default Payments;
