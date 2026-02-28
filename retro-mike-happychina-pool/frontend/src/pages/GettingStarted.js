import React, { useState, useEffect } from 'react';
import { getCoins, getMergeMiningInfo } from '../services/api';
import './GettingStarted.css';

const POOL_HOST = window.location.hostname;

function GettingStarted() {
  const [coins, setCoins] = useState([]);
  const [mergeInfo, setMergeInfo] = useState({});

  useEffect(() => {
    getCoins()
      .then(res => setCoins(res.data || []))
      .catch(() => {});
    getMergeMiningInfo()
      .then(res => setMergeInfo(res.data || {}))
      .catch(() => {});
  }, []);

  // Separate parent/standalone coins from merge-mined children
  const parentCoins = coins.filter(c => !c.mergeMinedWith);
  const mergedChildren = coins.filter(c => c.mergeMinedWith);

  // Group merged coins by parent
  const mergeGroups = {};
  mergedChildren.forEach(c => {
    if (!mergeGroups[c.mergeMinedWith]) mergeGroups[c.mergeMinedWith] = [];
    mergeGroups[c.mergeMinedWith].push(c);
  });

  return (
    <div className="getting-started">
      <div className="page-header">
        <h1>Getting Started</h1>
        <p>Follow these steps to start mining on our pool</p>
      </div>

      {/* Steps */}
      <div className="gs-steps">
        <div className="gs-step">
          <div className="gs-step-header">
            <div className="gs-step-num">1</div>
            <h2>Create an Account</h2>
          </div>
          <p>Register an account on the pool. You'll need a username, email, and your wallet address for payouts.</p>
          <div className="gs-note">
            You can also mine directly with your wallet address as the username - the pool will auto-register you.
          </div>
        </div>

        <div className="gs-step">
          <div className="gs-step-header">
            <div className="gs-step-num">2</div>
            <h2>Download Mining Software</h2>
          </div>
          <p>Choose mining software compatible with your hardware and the algorithm you want to mine:</p>
          <ul className="gs-list">
            <li><strong>Scrypt ASIC miners:</strong> Antminer L7/L9, Goldshell, or similar - use the built-in firmware configuration</li>
            <li><strong>GPU/CPU mining:</strong> CGMiner, BFGMiner for Scrypt coins</li>
          </ul>
        </div>

        <div className="gs-step">
          <div className="gs-step-header">
            <div className="gs-step-num">3</div>
            <h2>Configure Your Miner</h2>
          </div>
          <p>Connect to the <strong>parent chain</strong> port and all merge-mined coins are mined automatically:</p>
          <div className="gs-code-block">
            <div className="gs-code-label">General Format</div>
            <code>
              Pool: stratum+tcp://{POOL_HOST}:PORT<br />
              Worker: YOUR_WALLET_ADDRESS.WORKER_NAME<br />
              Password: x
            </code>
          </div>
        </div>

        <div className="gs-step">
          <div className="gs-step-header">
            <div className="gs-step-num">4</div>
            <h2>Start Mining & Monitor</h2>
          </div>
          <p>Launch your miner and check the Dashboard to see your hashrate, shares, and earnings in real-time. Workers should appear within a few minutes of submitting their first share.</p>
        </div>
      </div>

      {/* Merge Mining Groups */}
      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 48, marginBottom: 8 }}>Mining Ports</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 24, fontSize: 14 }}>
        Merge mining means you mine multiple coins simultaneously with a single miner connection.
        Connect to the parent chain port and all merged coins are mined automatically at no extra cost.
      </p>

      {parentCoins.map(parent => {
        const children = mergeGroups[parent.id] || [];
        const isMergeParent = children.length > 0;

        return (
          <div className="gs-coin-card" key={parent.id} style={{ marginBottom: 24 }}>
            <div className="gs-coin-header">
              <h3>
                <span className={`coin-dot coin-${parent.symbol?.toLowerCase()}`} />
                {parent.name} ({parent.symbol})
                {isMergeParent && <span style={{ fontSize: 12, color: 'var(--green)', marginLeft: 8, fontWeight: 500 }}>+ {children.length} merged coins</span>}
              </h3>
              <span className="gs-algo-badge">{parent.algorithm?.toUpperCase()}</span>
            </div>

            <div className="gs-coin-info">
              <div><span className="gs-info-label">Port:</span> <code style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>{parent.stratumPort}</code></div>
            </div>

            <div className="gs-code-block">
              <div className="gs-code-label">Connect</div>
              <code>{`-o stratum+tcp://${POOL_HOST}:${parent.stratumPort} -u YOUR_WALLET_ADDRESS.worker1 -p x`}</code>
            </div>

            {isMergeParent && (
              <div style={{ marginTop: 16, padding: '12px 16px', background: 'rgba(var(--green-rgb, 76, 175, 80), 0.08)', borderRadius: 8, border: '1px solid rgba(var(--green-rgb, 76, 175, 80), 0.2)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Merge-Mined Coins (automatic)
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {children.map(child => (
                    <span key={child.id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 12px', borderRadius: 16,
                      background: 'var(--card-bg)', border: '1px solid var(--border)',
                      fontSize: 13, fontWeight: 500
                    }}>
                      <span className={`coin-dot coin-${child.symbol?.toLowerCase()}`} style={{ width: 8, height: 8 }} />
                      {child.name} ({child.symbol})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Pool info */}
      <div className="card" style={{ marginTop: 32 }}>
        <div className="card-header">
          <h2>Pool Information</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>REWARD SYSTEM</div>
            <div style={{ fontWeight: 600 }}>PPLNS (Pay Per Last N Shares)</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>POOL FEE</div>
            <div style={{ fontWeight: 600 }}>1%</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>PAYOUT FREQUENCY</div>
            <div style={{ fontWeight: 600 }}>Every hour (automatic)</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>MINIMUM PAYOUT</div>
            <div style={{ fontWeight: 600 }}>Configurable per user</div>
          </div>
        </div>
      </div>

      {/* API */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <h2>API Access</h2>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16, fontSize: 14 }}>
          Access pool and miner data programmatically using our REST API. Authenticate with your API key (found in Settings).
        </p>
        <div className="gs-api-endpoints">
          <div className="gs-api-endpoint">
            <code className="gs-api-method">GET</code>
            <code>/api/pool/info</code>
            <span>Pool overview and all coin stats</span>
          </div>
          <div className="gs-api-endpoint">
            <code className="gs-api-method">GET</code>
            <code>/api/pool/coins</code>
            <span>List of supported coins</span>
          </div>
          <div className="gs-api-endpoint">
            <code className="gs-api-method">GET</code>
            <code>/api/pool/merge-mining</code>
            <span>Merge mining groups</span>
          </div>
          <div className="gs-api-endpoint">
            <code className="gs-api-method">GET</code>
            <code>/api/pool/stats/:coin</code>
            <span>Detailed stats for a specific coin</span>
          </div>
          <div className="gs-api-endpoint">
            <code className="gs-api-method">GET</code>
            <code>/api/pool/daemon-status</code>
            <span>Daemon sync status for all coins</span>
          </div>
          <div className="gs-api-endpoint">
            <code className="gs-api-method">GET</code>
            <code>/api/miner/dashboard</code>
            <span>Your mining dashboard (auth required)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default GettingStarted;
