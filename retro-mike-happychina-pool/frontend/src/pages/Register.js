import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './AuthPage.css';

function Register() {
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '', wallet_address: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      return setError('Passwords do not match');
    }

    setLoading(true);
    try {
      await register({
        username: form.username,
        email: form.email,
        password: form.password,
        wallet_address: form.wallet_address
      });
      navigate('/dashboard');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Register</h1>
        <p className="auth-sub">Create your mining pool account</p>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input type="text" name="username" className="form-input" value={form.username} onChange={handleChange} placeholder="Choose a username" required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" name="email" className="form-input" value={form.email} onChange={handleChange} placeholder="Enter email address" required />
          </div>
          <div className="form-group">
            <label>Wallet Address (optional)</label>
            <input type="text" name="wallet_address" className="form-input" value={form.wallet_address} onChange={handleChange} placeholder="Your payout wallet address" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" name="password" className="form-input" value={form.password} onChange={handleChange} placeholder="At least 8 characters" required />
          </div>
          <div className="form-group">
            <label>Confirm Password</label>
            <input type="password" name="confirmPassword" className="form-input" value={form.confirmPassword} onChange={handleChange} placeholder="Confirm your password" required />
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
