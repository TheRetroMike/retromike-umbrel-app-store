import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getPoolInfo, getCoins } from '../services/api';
import { formatHashrate, formatNumber } from '../utils/format';
import './Home.css';

function Home() {
  const [poolInfo, setPoolInfo] = useState(null);
  const [coinList, setCoinList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getPoolInfo().catch(() => ({ data: null })),
      getCoins().catch(() => ({ data: [] }))
    ]).then(([infoRes, coinsRes]) => {
      setPoolInfo(infoRes.data);
      setCoinList(coinsRes.data || []);
      setLoading(false);
    });
  }, []);

  const totalMiners = coinList.reduce((sum, c) => sum + (c.miners || 0), 0);
  const totalCoins = coinList.length;

  return (
    <div className="home-page">
      {/* Hero */}
      <section className="hero">
        <div className="hero-content">
          <h1>Multi-Coin <span className="accent">Mining Pool</span></h1>
          <p className="hero-sub">
            Mine Litecoin, Dogecoin, and 8 more Scrypt coins with merge mining. Low 1% fee, PPLNS rewards, automatic payouts.
          </p>
          <div className="hero-actions">
            <Link to="/getting-started" className="btn btn-primary btn-lg">Start Mining</Link>
            <Link to="/stats" className="btn btn-secondary btn-lg">View Statistics</Link>
          </div>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="hero-stat-value">{totalCoins}</div>
            <div className="hero-stat-label">Supported Coins</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-value">{totalMiners}</div>
            <div className="hero-stat-label">Active Miners</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-value">1%</div>
            <div className="hero-stat-label">Pool Fee</div>
          </div>
          <div className="hero-stat">
            <div className="hero-stat-value">PPLNS</div>
            <div className="hero-stat-label">Reward System</div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="features">
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">&#9889;</div>
            <h3>Scrypt Mining</h3>
            <p>Scrypt algorithm supported across 10 coins including Litecoin, Dogecoin, and more with merge mining.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">&#128176;</div>
            <h3>Low Fees</h3>
            <p>Only 1% pool fee. Maximize your mining profits with our efficient infrastructure.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">&#128200;</div>
            <h3>Real-time Stats</h3>
            <p>Monitor your hashrate, workers, shares, and earnings in real-time with detailed charts.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">&#128274;</div>
            <h3>Automatic Payouts</h3>
            <p>PPLNS reward system with automatic hourly payouts. Low minimum payout threshold.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">&#127760;</div>
            <h3>Global Servers</h3>
            <p>Distributed stratum servers for low latency connections from anywhere in the world.</p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">&#128295;</div>
            <h3>API Access</h3>
            <p>Full REST API for monitoring and managing your mining operations programmatically.</p>
          </div>
        </div>
      </section>

      {/* Coins */}
      <section className="home-coins">
        <div className="section-header">
          <h2>Supported Coins</h2>
          <Link to="/stats" className="btn btn-sm btn-secondary">View All</Link>
        </div>
        <div className="coin-grid">
          {coinList.map(coin => (
            <Link to={`/stats/${coin.id}`} key={coin.id} className="coin-card">
              <div className="coin-header">
                <div className="coin-symbol">{coin.symbol}</div>
                <div>
                  <div className="coin-name">{coin.name}</div>
                  <div className="coin-algo">{coin.algorithm.toUpperCase()}</div>
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
                  <div className="coin-stat-label">Net Difficulty</div>
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
      </section>

      {/* How it works */}
      <section className="how-it-works">
        <h2>How To Start Mining</h2>
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <h3>Create Account</h3>
            <p>Register with your username and wallet address.</p>
          </div>
          <div className="step-arrow">&rarr;</div>
          <div className="step">
            <div className="step-num">2</div>
            <h3>Configure Miner</h3>
            <p>Point your mining software to our stratum server.</p>
          </div>
          <div className="step-arrow">&rarr;</div>
          <div className="step">
            <div className="step-num">3</div>
            <h3>Start Earning</h3>
            <p>Watch your earnings grow on the dashboard.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default Home;
