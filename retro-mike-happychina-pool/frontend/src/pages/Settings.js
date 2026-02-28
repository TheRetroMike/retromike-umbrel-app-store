import React, { useState, useEffect } from 'react';
import { getProfile, updateProfile, regenerateApiKey, getCoins, getAddresses, updateAddresses } from '../services/api';
import { useAuth } from '../hooks/useAuth';

function Settings() {
  const { setUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ email: '', wallet_address: '', payout_threshold: '' });
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [coins, setCoins] = useState([]);
  const [addresses, setAddresses] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [addrMessage, setAddrMessage] = useState('');
  const [addrError, setAddrError] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingAddrs, setSavingAddrs] = useState(false);

  useEffect(() => {
    Promise.all([
      getProfile().then(res => res.data),
      getCoins().then(res => res.data || []).catch(() => []),
      getAddresses().then(res => res.data || {}).catch(() => ({}))
    ]).then(([prof, coinList, addrs]) => {
      setProfile(prof);
      setForm({
        email: prof.email,
        wallet_address: prof.wallet_address || '',
        payout_threshold: prof.payout_threshold || 0.01
      });
      setCoins(coinList);
      setAddresses(addrs);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      await updateProfile(form);
      setMessage('Profile updated successfully');
    } catch (err) {
      setError(err.response?.data?.error || 'Update failed');
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (passwords.new_password !== passwords.confirm_password) {
      return setError('Passwords do not match');
    }

    try {
      await updateProfile({
        current_password: passwords.current_password,
        new_password: passwords.new_password
      });
      setPasswords({ current_password: '', new_password: '', confirm_password: '' });
      setMessage('Password changed successfully');
    } catch (err) {
      setError(err.response?.data?.error || 'Password change failed');
    }
  };

  const handleRegenerateKey = async () => {
    try {
      const res = await regenerateApiKey();
      setProfile({ ...profile, api_key: res.data.api_key });
      setMessage('API key regenerated');
    } catch {
      setError('Failed to regenerate API key');
    }
  };

  const handleSaveAddresses = async (e) => {
    e.preventDefault();
    setSavingAddrs(true);
    setAddrError('');
    setAddrMessage('');
    try {
      await updateAddresses(addresses);
      setAddrMessage('Wallet addresses saved');
    } catch (err) {
      setAddrError(err.response?.data?.error || 'Failed to save addresses');
    } finally {
      setSavingAddrs(false);
    }
  };

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!profile) return <div className="empty-state"><h3>Failed to load profile</h3></div>;

  // Group coins: parent/standalone first, then merged
  const parentCoins = coins.filter(c => !c.mergeMinedWith);
  const mergedCoins = coins.filter(c => c.mergeMinedWith);
  const orderedCoins = [...parentCoins, ...mergedCoins];

  return (
    <div>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Manage your account and mining preferences</p>
      </div>

      {message && <div className="success-message">{message}</div>}
      {error && <div className="error-message">{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Profile */}
        <div className="card">
          <div className="card-header"><h2>Profile</h2></div>
          <form onSubmit={handleUpdate}>
            <div className="form-group">
              <label>Username</label>
              <input type="text" className="form-input" value={profile.username} disabled />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="form-input" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Default Wallet Address</label>
              <input type="text" className="form-input" value={form.wallet_address} onChange={e => setForm({ ...form, wallet_address: e.target.value })} placeholder="Fallback address for all coins" />
              <small style={{ color: 'var(--text-muted)', fontSize: 12 }}>Used when no coin-specific address is set below</small>
            </div>
            <div className="form-group">
              <label>Payout Threshold</label>
              <input type="number" step="0.001" className="form-input" value={form.payout_threshold} onChange={e => setForm({ ...form, payout_threshold: parseFloat(e.target.value) })} />
            </div>
            <button type="submit" className="btn btn-primary">Save Changes</button>
          </form>
        </div>

        {/* Password */}
        <div className="card">
          <div className="card-header"><h2>Change Password</h2></div>
          <form onSubmit={handlePasswordChange}>
            <div className="form-group">
              <label>Current Password</label>
              <input type="password" className="form-input" value={passwords.current_password} onChange={e => setPasswords({ ...passwords, current_password: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>New Password</label>
              <input type="password" className="form-input" value={passwords.new_password} onChange={e => setPasswords({ ...passwords, new_password: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Confirm New Password</label>
              <input type="password" className="form-input" value={passwords.confirm_password} onChange={e => setPasswords({ ...passwords, confirm_password: e.target.value })} required />
            </div>
            <button type="submit" className="btn btn-primary">Change Password</button>
          </form>
        </div>
      </div>

      {/* Per-coin wallet addresses */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header"><h2>Coin Wallet Addresses</h2></div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>
          Set a payout address for each coin. Merge-mined coins earn rewards automatically — set addresses here to receive payouts.
          If no address is set for a coin, the default wallet address above is used as fallback.
        </p>
        {addrMessage && <div className="success-message">{addrMessage}</div>}
        {addrError && <div className="error-message">{addrError}</div>}
        <form onSubmit={handleSaveAddresses}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {orderedCoins.map(coin => (
              <div key={coin.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg-input)', border: '1px solid var(--border)'
              }}>
                <div style={{ minWidth: 80, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`coin-dot coin-${coin.symbol?.toLowerCase()}`} />
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{coin.symbol}</span>
                  {coin.mergeMinedWith && (
                    <span style={{ fontSize: 10, color: 'var(--green)', fontWeight: 500 }}>MERGED</span>
                  )}
                </div>
                <input
                  type="text"
                  className="form-input"
                  placeholder={`${coin.name} address`}
                  value={addresses[coin.id] || ''}
                  onChange={e => setAddresses({ ...addresses, [coin.id]: e.target.value })}
                  style={{ flex: 1, margin: 0, padding: '6px 10px', fontSize: 12 }}
                />
              </div>
            ))}
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingAddrs} style={{ marginTop: 16 }}>
            {savingAddrs ? 'Saving...' : 'Save Addresses'}
          </button>
        </form>
      </div>

      {/* API Key */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h2>API Key</h2>
          <button className="btn btn-sm btn-secondary" onClick={handleRegenerateKey}>Regenerate</button>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 12 }}>
          Use this key in the <code>X-API-Key</code> header for authenticated API requests.
        </p>
        <div style={{ background: 'var(--bg-input)', padding: '12px 16px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <code style={{ color: 'var(--accent)', fontSize: 14, wordBreak: 'break-all' }}>{profile.api_key}</code>
        </div>
      </div>

      {/* Account info */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header"><h2>Account Info</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 14 }}>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Member since: </span>
            <span>{new Date(profile.created_at).toLocaleDateString()}</span>
          </div>
          <div>
            <span style={{ color: 'var(--text-muted)' }}>Last login: </span>
            <span>{profile.last_login ? new Date(profile.last_login).toLocaleString() : 'N/A'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
