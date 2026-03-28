const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');
const db = require('../../models/database');
const { authMiddleware } = require('../../middleware/auth');

const router = express.Router();

// Simple in-memory rate limiter for auth endpoints
const loginAttempts = new Map();
const registerAttempts = new Map();

function rateLimit(store, maxAttempts, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const record = store.get(ip);
    if (record) {
      // Clean old entries
      if (now - record.firstAttempt > windowMs) {
        store.set(ip, { count: 1, firstAttempt: now });
        return next();
      }
      if (record.count >= maxAttempts) {
        const retryAfter = Math.ceil((record.firstAttempt + windowMs - now) / 1000);
        return res.status(429).json({ error: 'Too many attempts. Try again in ' + retryAfter + ' seconds.' });
      }
      record.count++;
    } else {
      store.set(ip, { count: 1, firstAttempt: now });
    }
    // Cleanup old entries periodically
    if (store.size > 10000) {
      for (const [key, val] of store) {
        if (now - val.firstAttempt > windowMs) store.delete(key);
      }
    }
    next();
  };
}

// 5 login attempts per 15 minutes per IP
const loginLimiter = rateLimit(loginAttempts, 5, 15 * 60 * 1000);
// 3 register attempts per hour per IP
const registerLimiter = rateLimit(registerAttempts, 3, 60 * 60 * 1000);

// Register
router.post('/register', registerLimiter, (req, res) => {
  try {
    const { username, email, password, wallet_address } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
    if (existing) {
      return res.status(400).json({ error: 'Username or email already taken' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const apiKey = uuidv4();

    // First registered user automatically becomes admin
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const isAdmin = userCount === 0 ? 1 : 0;

    const result = db.prepare(
      'INSERT INTO users (username, email, password, wallet_address, api_key, is_admin) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(username, email, hashedPassword, wallet_address || '', apiKey, isAdmin);

    const token = jwt.sign({ userId: result.lastInsertRowid }, config.jwtSecret, { expiresIn: '7d' });

    res.status(201).json({
      message: isAdmin ? 'Registration successful - you are the admin!' : 'Registration successful',
      token,
      user: {
        id: result.lastInsertRowid,
        username,
        email,
        is_admin: isAdmin,
        api_key: apiKey
      }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', loginLimiter, (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        wallet_address: user.wallet_address,
        is_admin: user.is_admin,
        api_key: user.api_key
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get profile
router.get('/profile', authMiddleware, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, wallet_address, created_at, last_login, is_admin, payout_threshold, api_key FROM users WHERE id = ?'
  ).get(req.user.id);
  res.json(user);
});

// Update profile
router.put('/profile', authMiddleware, (req, res) => {
  try {
    const { email, wallet_address, payout_threshold, current_password, new_password } = req.body;

    if (new_password) {
      if (!current_password) {
        return res.status(400).json({ error: 'Current password required to change password' });
      }
      const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
      if (!bcrypt.compareSync(current_password, user.password)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
      }
      if (new_password.length < 8) {
        return res.status(400).json({ error: 'New password must be at least 8 characters' });
      }
      const hashed = bcrypt.hashSync(new_password, 10);
      db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, req.user.id);
    }

    if (email) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ? AND id != ?').get(email, req.user.id);
      if (existing) {
        return res.status(400).json({ error: 'Email already in use' });
      }
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, req.user.id);
    }

    if (wallet_address !== undefined) {
      db.prepare('UPDATE users SET wallet_address = ? WHERE id = ?').run(wallet_address, req.user.id);
    }

    if (payout_threshold !== undefined) {
      db.prepare('UPDATE users SET payout_threshold = ? WHERE id = ?').run(payout_threshold, req.user.id);
    }

    res.json({ message: 'Profile updated' });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// Regenerate API key
router.post('/regenerate-api-key', authMiddleware, (req, res) => {
  const newKey = uuidv4();
  db.prepare('UPDATE users SET api_key = ? WHERE id = ?').run(newKey, req.user.id);
  res.json({ api_key: newKey });
});

// Get per-coin wallet addresses
router.get('/addresses', authMiddleware, (req, res) => {
  const addresses = db.prepare(
    'SELECT coin, address FROM user_addresses WHERE user_id = ?'
  ).all(req.user.id);
  const result = {};
  for (const row of addresses) {
    result[row.coin] = row.address;
  }
  res.json(result);
});

// Update per-coin wallet addresses
router.put('/addresses', authMiddleware, (req, res) => {
  const { addresses } = req.body;
  if (!addresses || typeof addresses !== 'object') {
    return res.status(400).json({ error: 'addresses object required' });
  }

  const upsert = db.prepare(
    'INSERT INTO user_addresses (user_id, coin, address, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id, coin) DO UPDATE SET address = excluded.address, updated_at = CURRENT_TIMESTAMP'
  );

  const remove = db.prepare('DELETE FROM user_addresses WHERE user_id = ? AND coin = ?');

  const transaction = db.transaction(() => {
    for (const [coin, address] of Object.entries(addresses)) {
      if (address && address.trim()) {
        upsert.run(req.user.id, coin, address.trim());
      } else {
        remove.run(req.user.id, coin);
      }
    }
  });

  transaction();
  res.json({ message: 'Addresses updated' });
});

module.exports = router;
