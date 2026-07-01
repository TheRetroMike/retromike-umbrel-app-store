import React from 'react';
import './Footer.css';

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-section">
          <h4>MiningPool</h4>
          <p>Multi-algorithm, multi-coin mining pool with PPLNS rewards. Low fees, reliable payouts, and 24/7 uptime.</p>
        </div>
        <div className="footer-section">
          <h4>Pool Info</h4>
          <ul>
            <li>Fee: 1%</li>
            <li>Payout: PPLNS</li>
            <li>Min Payout: 0.01</li>
            <li>Payout Interval: 1h</li>
          </ul>
        </div>
        <div className="footer-section">
          <h4>Algorithms</h4>
          <ul>
            <li>Scrypt (Litecoin, Dogecoin, Pepecoin, Bells, Luckycoin, Junkcoin, Dingocoin, Shibacoin, TrumPOW)</li>
          </ul>
        </div>
        <div className="footer-section">
          <h4>Connect</h4>
          <ul>
            <li>Stratum: stratum+tcp://POOL_IP:PORT</li>
            <li>API: /api/pool/info</li>
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <p>&copy; {new Date().getFullYear()} MiningPool. All rights reserved.</p>
      </div>
    </footer>
  );
}

export default Footer;
