import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './Navbar.css';

function Navbar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path) => location.pathname === path ? 'active' : '';

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-brand">
          <div className="brand-icon">MP</div>
          <span className="brand-text">MiningPool</span>
        </Link>

        <button className="mobile-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          <span /><span /><span />
        </button>

        <div className={`navbar-links ${menuOpen ? 'open' : ''}`}>
          <Link to="/" className={`nav-link ${isActive('/')}`} onClick={() => setMenuOpen(false)}>Home</Link>
          <Link to="/stats" className={`nav-link ${isActive('/stats')}`} onClick={() => setMenuOpen(false)}>Statistics</Link>
          <Link to="/blocks" className={`nav-link ${isActive('/blocks')}`} onClick={() => setMenuOpen(false)}>Blocks</Link>
          <Link to="/getting-started" className={`nav-link ${isActive('/getting-started')}`} onClick={() => setMenuOpen(false)}>Getting Started</Link>

          {user ? (
            <>
              <Link to="/dashboard" className={`nav-link ${isActive('/dashboard')}`} onClick={() => setMenuOpen(false)}>Dashboard</Link>
              <Link to="/workers" className={`nav-link ${isActive('/workers')}`} onClick={() => setMenuOpen(false)}>Workers</Link>
              <Link to="/payments" className={`nav-link ${isActive('/payments')}`} onClick={() => setMenuOpen(false)}>Payments</Link>
              {user.is_admin && (
                <Link to="/admin" className={`nav-link ${isActive('/admin')}`} onClick={() => setMenuOpen(false)}>Admin</Link>
              )}
              <div className="nav-user">
                <Link to="/settings" className="nav-username" onClick={() => setMenuOpen(false)}>{user.username}</Link>
                <button className="btn btn-sm btn-secondary" onClick={() => { logout(); setMenuOpen(false); }}>Logout</button>
              </div>
            </>
          ) : (
            <div className="nav-auth">
              <Link to="/login" className="btn btn-sm btn-secondary" onClick={() => setMenuOpen(false)}>Login</Link>
              <Link to="/register" className="btn btn-sm btn-primary" onClick={() => setMenuOpen(false)}>Register</Link>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
