// Authentication: scrypt password hashes + server-side sessions in SQLite.
const crypto = require('crypto');
const { db } = require('./db');

const SESSION_DAYS = 30;
const COOKIE = 'be_session';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function userCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function createUser(username, displayName, password) {
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(username.trim(), displayName.trim(), hashPassword(password), Date.now());
  return Number(info.lastInsertRowid);
}

function setPassword(userId, password) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function cookieFlags(req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 864e5;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${cookieFlags(req)}`);
}

function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
}

// Attaches req.user (or null) to every request.
function sessionMiddleware(req, res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const row = db
      .prepare(`SELECT u.id, u.username, u.display_name, s.expires_at FROM sessions s
                JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
      .get(sha256(token));
    if (row && row.expires_at > Date.now()) req.user = { id: row.id, username: row.username, displayName: row.display_name };
    else if (row) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Please sign in again.' });
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

// Blocks cross-site form/API posts (on top of SameSite cookies).
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).send('Cross-site request blocked.');
    } catch { return res.status(403).send('Bad origin.'); }
  }
  next();
}

// Simple in-memory login throttling: 8 failed attempts per IP per 15 minutes.
const attempts = new Map();
function loginAllowed(ip) {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) return true;
  return a.count < 8;
}
function recordFailure(ip) {
  const a = attempts.get(ip);
  if (!a || a.reset < Date.now()) attempts.set(ip, { count: 1, reset: Date.now() + 15 * 60e3 });
  else a.count++;
}
function clearFailures(ip) { attempts.delete(ip); }

module.exports = {
  hashPassword, verifyPassword, userCount, createUser, setPassword,
  startSession, endSession, sessionMiddleware, requireAuth, sameOrigin,
  loginAllowed, recordFailure, clearFailures,
};
