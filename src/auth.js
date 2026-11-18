// Per-user accounts: email + password, server-side sessions in SQLite, admin-managed users.
// No external dependencies: scrypt password hashes and random session tokens from node:crypto.
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const { db } = require('./db');

const COOKIE = 'ly_session';
const DAYS = 30;
const MIN_LEN = 10;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const tempPassword = () => crypto.randomBytes(12).toString('base64url');

function createUser(email, { name = null, role = 'user', password } = {}) {
  const pw = password || tempPassword();
  db.prepare('INSERT INTO users (email,name,role,pass_hash,must_change) VALUES (?,?,?,?,1)')
    .run(String(email).trim().toLowerCase(), name, role === 'admin' ? 'admin' : 'user', hashPassword(pw));
  return pw;
}
function setPassword(userId, pw, mustChange) {
  db.prepare('UPDATE users SET pass_hash=?, must_change=? WHERE id=?').run(hashPassword(pw), mustChange ? 1 : 0, userId);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);       // sign out everywhere
}

function cookieOf(req) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE + '=([A-Za-z0-9_-]+)'));
  return m ? m[1] : null;
}
function currentUser(req) {
  const t = cookieOf(req);
  if (!t) return null;
  return db.prepare(`SELECT u.id,u.email,u.name,u.role,u.must_change FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at > datetime('now') AND u.disabled=0`).get(sha(t)) || null;
}
function setCookie(res, value, maxAge) {
  const secure = process.env.INSECURE_COOKIES === '1' ? '' : ' Secure;';
  res.append('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`);
}

// Slow down password guessing: 8 failures per email or per IP in 15 minutes.
const fails = new Map();
function blocked(key) {
  const now = Date.now(), list = (fails.get(key) || []).filter(t => now - t < 15 * 60e3);
  fails.set(key, list);
  return list.length >= 8;
}
const fail = key => fails.set(key, [...(fails.get(key) || []), Date.now()]);

function install(app) {
  app.set('trust proxy', 'loopback');
  // State-changing requests must come from our own pages.
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const o = req.headers.origin;
    if (o && new URL(o).host !== req.headers.host) return res.status(403).json({ error: 'Cross-site request refused' });
    next();
  });

  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));
  app.post('/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase(), pw = String(req.body?.password || '');
    if (blocked('e:' + email) || blocked('i:' + req.ip)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    const u = db.prepare('SELECT * FROM users WHERE email=? AND disabled=0').get(email);
    if (!u || !checkPassword(pw, u.pass_hash)) {
      fail('e:' + email); fail('i:' + req.ip);
      return res.status(401).json({ error: 'Wrong email or password' });
    }
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+${DAYS} days'))`).run(sha(token), u.id);
    db.prepare(`UPDATE users SET last_login=datetime('now') WHERE id=?`).run(u.id);
    db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
    setCookie(res, token, DAYS * 86400);
    res.json({ ok: true, must_change: !!u.must_change });
  });
  app.post('/auth/logout', (req, res) => {
    const t = cookieOf(req);
    if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  // Everything below this line needs a signed-in user.
  app.use((req, res, next) => {
    req.user = currentUser(req);
    if (req.user) return next();
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return res.status(401).json({ error: 'Sign in required' });
    res.redirect('/login');
  });

  app.get('/auth/me', (req, res) => res.json(req.user));
  app.post('/auth/password', (req, res) => {
    const cur = String(req.body?.current || ''), next = String(req.body?.next || '');
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
    if (!checkPassword(cur, u.pass_hash)) return res.status(400).json({ error: 'Current password is wrong' });
    if (next.length < MIN_LEN) return res.status(400).json({ error: `New password must be at least ${MIN_LEN} characters` });
    setPassword(u.id, next, false);
    setCookie(res, '', 0);
    res.json({ ok: true });                                              // signs out; user signs in again
  });
  // A user holding a temporary password can do nothing but change it.
  app.use('/api', (req, res, next) => req.user.must_change ? res.status(403).json({ error: 'Change your temporary password first', must_change: true }) : next());

  const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' });
  app.get('/api/users', admin, (req, res) =>
    res.json(db.prepare('SELECT id,email,name,role,disabled,must_change,created_at,last_login FROM users ORDER BY email').all()));
  app.post('/api/users', admin, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(400).json({ error: 'That email already has an account' });
    const temp = createUser(email, { name: req.body?.name || null, role: req.body?.role });
    res.json({ ok: true, email, temp_password: temp });                  // shown once to the admin, to pass on
  });
  app.put('/api/users/:id', admin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'No such user' });
    const b = req.body || {}, out = { ok: true };
    const admins = db.prepare(`SELECT count(*) n FROM users WHERE role='admin' AND disabled=0`).get().n;
    const losesAdmin = u.role === 'admin' && !u.disabled && (b.disabled === true || (b.role && b.role !== 'admin'));
    if (losesAdmin && admins <= 1) return res.status(400).json({ error: 'This is the only admin' });
    if (b.role) db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role === 'admin' ? 'admin' : 'user', u.id);
    if (typeof b.disabled === 'boolean') {
      db.prepare('UPDATE users SET disabled=? WHERE id=?').run(b.disabled ? 1 : 0, u.id);
      if (b.disabled) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    }
    if (b.reset_password) { out.temp_password = tempPassword(); setPassword(u.id, out.temp_password, true); }
    res.json(out);
  });
  app.delete('/api/users/:id', admin, (req, res) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!u) return res.status(404).json({ error: 'No such user' });
    if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    res.json({ ok: true });
  });
}

module.exports = { install, createUser, setPassword, tempPassword, hashPassword, checkPassword };
