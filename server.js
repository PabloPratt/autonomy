const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { defaults, validate } = require('./model');
const ROOT = __dirname;
const DATA_DIR = process.env.AUTONOMY_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TTL = 12 * 60 * 60 * 1000;
const attempts = new Map();
const allowedFiles = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'], '/model.js': ['model.js', 'text/javascript'] };
function readDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(DB_FILE)) writeDb({ owner: null, sessions: {}, audit: [], plan: defaults(), revision: 0 });
  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  // Upgrade the original local MVP without discarding its plan or password hash.
  if (Array.isArray(db.users)) {
    db.owner = db.users[0] || null;
    delete db.users;
    db.revision = 0;
    db.sessions = {};
    db.plan = validate(db.plan);
    writeDb(db);
  }
  return db;
}
function writeDb(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail('JSON required.', 415);
  let bytes = 0, parts = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 256000) fail('Request is too large.', 413);
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { fail('Invalid JSON.'); }
}
function publicUser(u) { return u ? { id: u.id, email: u.email, role: 'owner' } : null; }
function token(req) { return /(?:^|;\s*)autonomy_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1]; }
function key(t) { return crypto.createHash('sha256').update(t).digest('hex'); }
function audit(db, action) { db.audit.unshift({ at: new Date().toISOString(), action }); db.audit = db.audit.slice(0, 200); }
function session(res, db) {
  const t = crypto.randomBytes(32).toString('hex');
  db.sessions[key(t)] = { expiresAt: Date.now() + TTL };
  res.setHeader('Set-Cookie', 'autonomy_session=' + t + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200');
}
function rateLimit(req) {
  const address = req.socket.remoteAddress;
  const now = Date.now();
  const record = attempts.get(address);
  if (!record || now >= record.until) attempts.set(address, { count: 1, until: now + 15 * 60000 });
  else if (++record.count > 15) fail('Too many login attempts. Try again in 15 minutes.', 429);
}
function passwordHash(value, salt) { return crypto.pbkdf2Sync(value, salt, 210000, 32, 'sha256').toString('hex'); }
async function handleApi(req, res, route) {
  try {
    // This server is intentionally local-only; reject LAN/DNS rebinding and cross-origin writes.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) fail('Invalid host.', 403);
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) fail('Invalid origin.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') fail('Invalid origin.', 403);
    }
    if (req.method === 'GET' && route === '/api/health') return json(res, 200, { ok: true, mode: 'local' });
    const payload = ['POST', 'PUT'].includes(req.method) ? await body(req) : {};
    // Read only after await: concurrent requests must see the latest revision/owner.
    const db = readDb();
    const now = Date.now();
    for (const [k, s] of Object.entries(db.sessions)) if (s.expiresAt <= now) delete db.sessions[k];
    const t = token(req);
    const user = t && db.sessions[key(t)] ? db.owner : null;
    if (route === '/api/session' && req.method === 'GET') return json(res, 200, { user: publicUser(user), setupRequired: !db.owner, mode: 'local' });
    if (['/api/setup', '/api/login'].includes(route) && req.method === 'POST') {
      rateLimit(req);
      if (typeof payload.email !== 'string' || typeof payload.password !== 'string' || payload.password.length > 256 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || payload.email.length > 254) fail('Enter a valid email and password.');
      const email = payload.email.trim().toLowerCase();
      if (route === '/api/setup') {
        if (db.owner) fail('Owner already exists.', 409);
        if (payload.password.length < 12) fail('Password must contain at least 12 characters.');
        const salt = crypto.randomBytes(16).toString('hex');
        db.owner = { id: crypto.randomUUID(), email, password: { salt, hash: passwordHash(payload.password, salt) } };
        audit(db, 'owner_created');
      } else {
        const salt = db.owner?.password.salt || 'missing-account-salt';
        const hash = passwordHash(payload.password, salt);
        if (!db.owner || email !== db.owner.email || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(db.owner.password.hash, 'hex'))) fail('Invalid login.', 401);
        audit(db, 'login');
      }
      session(res, db);
      writeDb(db);
      return json(res, 200, { user: publicUser(db.owner) });
    }
    if (!user) fail('Login required.', 401);
    if (route === '/api/logout' && req.method === 'POST') {
      delete db.sessions[key(t)];
      audit(db, 'logout');
      writeDb(db);
      res.setHeader('Set-Cookie', 'autonomy_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return json(res, 200, { ok: true });
    }
    if (route === '/api/plan' && req.method === 'GET') return json(res, 200, { plan: db.plan, revision: db.revision, user: publicUser(user) });
    if (route === '/api/plan' && req.method === 'PUT') {
      if (payload.revision !== db.revision) fail('Another tab saved a newer plan. Export your changes, then reload before saving.', 409);
      try { db.plan = validate(payload.plan); } catch (error) { fail(error.message); }
      db.plan.updatedAt = new Date().toISOString();
      db.revision++;
      audit(db, 'plan_saved');
      writeDb(db);
      return json(res, 200, { plan: db.plan, revision: db.revision });
    }
    if (route === '/api/audit' && req.method === 'GET') return json(res, 200, { audit: db.audit });
    fail('Not found.', 404);
  } catch (error) {
    if (!error.status) console.error('AUTONOMY request failed:', error.code || error.name);
    json(res, error.status || 500, { error: error.status ? error.message : 'Unable to read or save your data. Check the local server.' });
  }
}
function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route.startsWith('/api/')) return handleApi(req, res, route);
    const file = allowedFiles[route];
    if (!file || !['GET', 'HEAD'].includes(req.method)) return json(res, 404, { error: 'Not found.' });
    fs.readFile(path.join(ROOT, file[0]), (err, data) => {
      if (err) return json(res, 404, { error: 'Not found.' });
      res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}
if (require.main === module) {
  readDb();
  createServer().listen(Number(process.env.PORT || 8081), '127.0.0.1', () => console.log('AUTONOMY: http://127.0.0.1:' + (process.env.PORT || 8081)));
}
module.exports = { createServer };

