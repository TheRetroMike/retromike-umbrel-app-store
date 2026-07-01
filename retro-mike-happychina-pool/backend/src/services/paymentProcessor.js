const db = require('../models/database');
const config = require('../config');
const { coins } = require('../config/coins');
const DaemonRPC = require('./daemonRPC');

class PaymentProcessor {
  constructor() {
    this.processing = false;
  }

  async processPayments() {
    if (this.processing) {
      console.log('[Payment] Already processing, skipping');
      return;
    }

    this.processing = true;
    console.log('[Payment] Starting payment processing');

    try {
      for (const [coinId, coin] of Object.entries(coins)) {
        await this.processCoinPayments(coinId, coin);
      }
    } catch (err) {
      console.error('[Payment] Error:', err);
    } finally {
      this.processing = false;
    }
  }

  async processCoinPayments(coinId, coin) {
    // Get all users with confirmed balance above threshold
    // Use per-coin address from user_addresses, fall back to user's default wallet_address
    const balances = db.prepare(`
      SELECT b.*,
        COALESCE(ua.address, u.wallet_address) as payout_address,
        u.payout_threshold
      FROM balances b
      JOIN users u ON b.user_id = u.id
      LEFT JOIN user_addresses ua ON ua.user_id = b.user_id AND ua.coin = b.coin
      WHERE b.coin = ? AND b.confirmed >= COALESCE(u.payout_threshold, ?)
      AND (ua.address IS NOT NULL AND ua.address != '' OR u.wallet_address != '')
    `).all(coinId, config.pool.payoutThreshold);

    if (balances.length === 0) return;

    console.log(`[Payment] Processing ${balances.length} ${coin.symbol} payments`);

    const daemon = new DaemonRPC(coin.daemon);

    for (const balance of balances) {
      try {
        const amount = balance.confirmed;
        // No manual fee deduction - the daemon handles network tx fees via sendtoaddress
        const sendAmount = amount;

        if (sendAmount <= 0) continue;

        // Create payment record
        const payment = db.prepare(
          "INSERT INTO payments (user_id, coin, amount, fee, status) VALUES (?, ?, ?, ?, 'pending')"
        ).run(balance.user_id, coinId, sendAmount, 0);

        // Try to send via daemon
        try {
          const txHash = await daemon.sendToAddress(balance.payout_address, sendAmount);

          // Update payment with tx hash
          db.prepare(
            "UPDATE payments SET tx_hash = ?, status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?"
          ).run(txHash, payment.lastInsertRowid);

          // Update balance
          db.prepare(
            'UPDATE balances SET confirmed = confirmed - ?, paid = paid + ? WHERE user_id = ? AND coin = ?'
          ).run(amount, sendAmount, balance.user_id, coinId);

          console.log(`[Payment] Sent ${sendAmount} ${coin.symbol} to ${balance.payout_address} - tx: ${txHash}`);
        } catch (rpcErr) {
          // Mark payment as failed but don't deduct balance
          db.prepare(
            "UPDATE payments SET status = 'failed' WHERE id = ?"
          ).run(payment.lastInsertRowid);

          console.error(`[Payment] RPC error for user ${balance.user_id}:`, rpcErr.message);
        }
      } catch (err) {
        console.error(`[Payment] Error processing payment for user ${balance.user_id}:`, err);
      }
    }
  }
}

module.exports = PaymentProcessor;
