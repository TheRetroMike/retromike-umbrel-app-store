import React, { useState, useEffect } from 'react';
import {
  getAdminDashboard, getAdminUsers, getAdminSettings, updateAdminSettings,
  banUser, toggleAdmin, processPayments, getAdminPayments, getDaemonStatus,
  getAdminCoins, updateAdminCoin
} from '../services/api';

function Admin() {
  const [tab, setTab] = useState('overview');

  return (
    <div>
      <div className="page-header">
        <h1>Admin Panel</h1>
        <p>Pool management and configuration</p>
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {['overview', 'settings', 'coins', 'users', 'payments'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              fontWeight: tab === t ? 600 : 400, fontSize: 14, textTransform: 'capitalize',
              marginBottom: -1
            }}
          >{t}</button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'coins' && <CoinsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'payments' && <PaymentsTab />}
    </div>
  );
}

function OverviewTab() {
  const [data, setData] = useState(null);
  const [daemonStatus, setDaemonStatus] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getAdminDashboard().then(r => r.data),
      getDaemonStatus().then(r => r.data).catch(() => ({}))
    ]).then(([dash, daemons]) => {
      setData(dash);
      setDaemonStatus(daemons);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!data) return <div className="empty-state"><h3>Failed to load admin data</h3></div>;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Users', value: data.users },
          { label: 'Online Workers', value: data.workers },
          { label: 'Blocks Found', value: data.blocks },
          { label: 'Pending Payments', value: data.pendingPayments }
        ].map(s => (
          <div className="card" key={s.label} style={{ textAlign: 'center', padding: 20 }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--accent)' }}>{s.value}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div className="card">
          <div className="card-header"><h2>Coin Status</h2></div>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr><th>Coin</th><th>Status</th><th>Height</th><th>Miners</th><th>Blocks</th></tr>
            </thead>
            <tbody>
              {Object.entries(data.coins).map(([id, coin]) => {
                const daemon = daemonStatus[id] || {};
                const status = !daemon.online ? 'offline' : daemon.syncing ? 'syncing' : 'synced';
                const statusColor = status === 'synced' ? 'var(--green)' : status === 'syncing' ? 'var(--warning, #ffa726)' : 'var(--red, #ef5350)';
                return (
                  <tr key={id}>
                    <td><span className={`coin-dot coin-${coin.symbol?.toLowerCase()}`} /> {coin.symbol}</td>
                    <td>
                      <span style={{ color: statusColor, fontWeight: 500, fontSize: 12 }}>
                        {status === 'syncing' ? `${(daemon.syncProgress || 0).toFixed(1)}%` : status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{(daemon.blockHeight || 0).toLocaleString()}</td>
                    <td>{coin.miners}</td>
                    <td>{coin.blocks}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header"><h2>Recent Payments</h2></div>
          {data.recentPayments?.length > 0 ? (
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr><th>User</th><th>Coin</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {data.recentPayments.map(p => (
                  <tr key={p.id}>
                    <td>{p.username}</td>
                    <td>{p.coin}</td>
                    <td style={{ fontFamily: 'var(--font-mono, monospace)' }}>{p.amount}</td>
                    <td>
                      <span style={{
                        padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                        background: p.status === 'completed' ? 'rgba(76,175,80,0.15)' : p.status === 'failed' ? 'rgba(239,83,80,0.15)' : 'rgba(255,167,38,0.15)',
                        color: p.status === 'completed' ? 'var(--green)' : p.status === 'failed' ? 'var(--red, #ef5350)' : 'var(--warning, #ffa726)'
                      }}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>No payments yet</div>}
        </div>
      </div>
    </>
  );
}

function SettingsTab() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getAdminSettings().then(res => {
      setSettings(res.data);
      setForm(res.data);
    }).catch(() => {});
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await updateAdminSettings(form);
      setSettings(form);
      setMessage('Settings saved successfully');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (!settings) return <div className="loading-screen"><div className="spinner" /></div>;

  const fields = [
    { key: 'pool_name', label: 'Pool Name', type: 'text', help: 'Display name of the pool' },
    { key: 'pool_fee', label: 'Pool Fee (%)', type: 'number', step: '0.1', help: 'Percentage fee deducted from block rewards' },
    { key: 'payout_threshold', label: 'Default Payout Threshold', type: 'number', step: '0.001', help: 'Minimum balance before automatic payout' },
    { key: 'payout_interval', label: 'Payout Interval (seconds)', type: 'number', step: '1', help: 'How often to process payouts (3600 = hourly)' },
  ];

  return (
    <div className="card" style={{ maxWidth: 600 }}>
      <div className="card-header"><h2>Pool Settings</h2></div>
      {message && <div className="success-message">{message}</div>}
      {error && <div className="error-message">{error}</div>}
      <form onSubmit={handleSave}>
        {fields.map(f => (
          <div className="form-group" key={f.key}>
            <label>{f.label}</label>
            <input
              type={f.type}
              step={f.step}
              className="form-input"
              value={form[f.key] ?? ''}
              onChange={e => setForm({ ...form, [f.key]: e.target.value })}
            />
            <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>{f.help}</small>
          </div>
        ))}
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const loadUsers = (p = page, s = search) => {
    setLoading(true);
    getAdminUsers({ page: p, limit: 25, search: s }).then(res => {
      setUsers(res.data.users);
      setPagination(res.data.pagination);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadUsers(1); }, []); // eslint-disable-line

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    loadUsers(1, search);
  };

  const handleBan = async (id, username) => {
    if (!window.confirm(`Ban user ${username}? This will disconnect all their workers.`)) return;
    await banUser(id);
    loadUsers();
  };

  const handleToggleAdmin = async (id, username, isAdmin) => {
    if (!window.confirm(`${isAdmin ? 'Remove admin from' : 'Grant admin to'} ${username}?`)) return;
    await toggleAdmin(id);
    loadUsers();
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Users ({pagination.total || 0})</h2>
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text" className="form-input" placeholder="Search users..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: 200, padding: '6px 12px', fontSize: 13 }}
          />
          <button type="submit" className="btn btn-sm btn-secondary">Search</button>
        </form>
      </div>

      {loading ? <div className="spinner" /> : (
        <>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr><th>Username</th><th>Email</th><th>Workers</th><th>Hashrate</th><th>Joined</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    {u.username}
                    {u.is_admin ? <span style={{ marginLeft: 6, padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, background: 'rgba(100,181,246,0.15)', color: '#64b5f6' }}>ADMIN</span> : null}
                  </td>
                  <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{u.email}</td>
                  <td>{u.activeWorkers}</td>
                  <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{formatHashrate(u.hashrate)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleToggleAdmin(u.id, u.username, u.is_admin)}>
                        {u.is_admin ? 'Remove Admin' : 'Make Admin'}
                      </button>
                      <button className="btn btn-sm" style={{ background: 'rgba(239,83,80,0.15)', color: '#ef5350', border: 'none', padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }} onClick={() => handleBan(u.id, u.username)}>
                        Ban
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => { setPage(page - 1); loadUsers(page - 1); }}>Prev</button>
              <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>Page {page} of {pagination.pages}</span>
              <button className="btn btn-sm btn-secondary" disabled={page >= pagination.pages} onClick={() => { setPage(page + 1); loadUsers(page + 1); }}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PaymentsTab() {
  const [payments, setPayments] = useState([]);
  const [pagination, setPagination] = useState({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [processing, setProcessing] = useState(false);
  const [processMsg, setProcessMsg] = useState('');

  const loadPayments = (p = page) => {
    setLoading(true);
    getAdminPayments({ page: p, limit: 25 }).then(res => {
      setPayments(res.data.payments);
      setPagination(res.data.pagination);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { loadPayments(1); }, []); // eslint-disable-line

  const handleProcess = async () => {
    setProcessing(true);
    setProcessMsg('');
    try {
      const res = await processPayments();
      setProcessMsg(res.data.message);
      setTimeout(() => loadPayments(1), 2000);
    } catch (err) {
      setProcessMsg('Failed to trigger payments');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Payments ({pagination.total || 0})</h2>
        <button className="btn btn-sm btn-primary" onClick={handleProcess} disabled={processing}>
          {processing ? 'Processing...' : 'Process Payouts Now'}
        </button>
      </div>
      {processMsg && <div className="success-message">{processMsg}</div>}

      {loading ? <div className="spinner" /> : (
        <>
          <table className="data-table" style={{ width: '100%' }}>
            <thead>
              <tr><th>User</th><th>Coin</th><th>Amount</th><th>TX Hash</th><th>Status</th><th>Date</th></tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No payments</td></tr>
              ) : payments.map(p => (
                <tr key={p.id}>
                  <td>{p.username}</td>
                  <td>{p.coin}</td>
                  <td style={{ fontFamily: 'var(--font-mono, monospace)' }}>{p.amount}</td>
                  <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.tx_hash ? p.tx_hash.substring(0, 16) + '...' : '-'}
                  </td>
                  <td>
                    <span style={{
                      padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                      background: p.status === 'completed' ? 'rgba(76,175,80,0.15)' : p.status === 'failed' ? 'rgba(239,83,80,0.15)' : 'rgba(255,167,38,0.15)',
                      color: p.status === 'completed' ? 'var(--green)' : p.status === 'failed' ? '#ef5350' : '#ffa726'
                    }}>{p.status}</span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(p.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <button className="btn btn-sm btn-secondary" disabled={page <= 1} onClick={() => { setPage(page - 1); loadPayments(page - 1); }}>Prev</button>
              <span style={{ padding: '6px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>Page {page} of {pagination.pages}</span>
              <button className="btn btn-sm btn-secondary" disabled={page >= pagination.pages} onClick={() => { setPage(page + 1); loadPayments(page + 1); }}>Next</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      style={{
        position: 'relative', width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
        background: checked ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
        transition: 'background 0.2s'
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: checked ? 20 : 2,
        width: 18, height: 18, borderRadius: '50%',
        background: checked ? '#fff' : 'rgba(255,255,255,0.4)',
        transition: 'left 0.2s'
      }} />
    </button>
  );
}

function CoinsTab() {
  const [coins, setCoins] = useState({});
  const [draft, setDraft] = useState({});
  const [daemonStatus, setDaemonStatus] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      getAdminCoins().then(r => r.data),
      getDaemonStatus().then(r => r.data).catch(() => ({}))
    ]).then(([c, d]) => {
      setCoins(c);
      setDraft(JSON.parse(JSON.stringify(c)));
      setDaemonStatus(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const toggleDraft = (coinId, field) => {
    setDraft(prev => ({
      ...prev,
      [coinId]: { ...prev[coinId], [field]: !prev[coinId][field] }
    }));
  };

  // Check if anything changed
  const hasChanges = Object.keys(draft).some(id =>
    draft[id].enabled !== coins[id]?.enabled
  );

  const changedCoins = Object.keys(draft).filter(id =>
    draft[id].enabled !== coins[id]?.enabled
  );

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      for (const id of changedCoins) {
        await updateAdminCoin(id, { enabled: draft[id].enabled });
      }
      setCoins(JSON.parse(JSON.stringify(draft)));
      setMessage(`Saved changes for ${changedCoins.map(id => draft[id].symbol).join(', ')}`);
    } catch {
      setError('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setDraft(JSON.parse(JSON.stringify(coins)));
    setMessage('');
    setError('');
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="card">
      <div className="card-header">
        <h2>Coin Configuration</h2>
        {hasChanges && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#ffa726' }}>{changedCoins.length} unsaved change{changedCoins.length > 1 ? 's' : ''}</span>
            <button className="btn btn-sm btn-secondary" onClick={handleDiscard}>Discard</button>
            <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save & Apply'}
            </button>
          </div>
        )}
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
        Enable coins to start their daemon and begin syncing. Disable to stop the daemon.
        All coins run as full nodes with transaction index for payment processing.
      </p>
      {message && <div className="success-message">{message}</div>}
      {error && <div className="error-message">{error}</div>}
      <table className="data-table" style={{ width: '100%' }}>
        <thead>
          <tr><th>Coin</th><th>Algorithm</th><th>Port</th><th>Status</th><th>Sync</th><th>Height</th><th>Enabled</th></tr>
        </thead>
        <tbody>
          {Object.entries(draft).map(([id, coin]) => {
            const daemon = daemonStatus[id] || {};
            const status = !daemon.online ? 'offline' : daemon.syncing ? 'syncing' : 'synced';
            const statusColor = status === 'synced' ? 'var(--green)' : status === 'syncing' ? '#ffa726' : '#ef5350';
            const changed = coin.enabled !== coins[id]?.enabled;
            return (
              <tr key={id} style={{ background: changed ? 'rgba(255,167,38,0.05)' : undefined }}>
                <td>
                  <span className={`coin-dot coin-${coin.symbol?.toLowerCase()}`} />
                  {coin.name} ({coin.symbol})
                  {coin.mergeMinedWith && <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>merged</span>}
                  {changed && <span style={{ fontSize: 10, color: '#ffa726', marginLeft: 6 }}>modified</span>}
                </td>
                <td style={{ textTransform: 'uppercase', fontSize: 12 }}>{coin.algorithm}</td>
                <td style={{ fontFamily: 'var(--font-mono, monospace)' }}>{coin.stratumPort}</td>
                <td><span style={{ color: statusColor, fontWeight: 500, fontSize: 12 }}>{status.toUpperCase()}</span></td>
                <td style={{ fontSize: 12 }}>{daemon.syncProgress ? `${daemon.syncProgress.toFixed(1)}%` : '-'}</td>
                <td style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}>{(daemon.blockHeight || 0).toLocaleString()}</td>
                <td><Toggle checked={coin.enabled} onChange={() => toggleDraft(id, 'enabled')} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatHashrate(h) {
  if (!h || h === 0) return '0 H/s';
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s'];
  let i = 0;
  while (h >= 1000 && i < units.length - 1) { h /= 1000; i++; }
  return h.toFixed(2) + ' ' + units[i];
}

export default Admin;
