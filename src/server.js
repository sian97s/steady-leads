const express = require('express');
const path = require('path');
const { db } = require('./db');

const zlib = require('zlib');
const app = express();
app.use(express.json());
// Compress JSON answers (a lead list is ~600 KB raw, ~70 KB gzipped). No extra dependency.
app.use((req, res, next) => {
  const json = res.json.bind(res);
  res.json = obj => {
    const body = Buffer.from(JSON.stringify(obj) ?? 'null');
    if (body.length < 1400 || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return json(obj);
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
    return res.send(zlib.gzipSync(body, { level: 5 }));
  };
  next();
});

// Per-user accounts and sessions (src/auth.js). Everything registered after this needs a signed-in user.
require('./auth').install(app);
const { parts } = require('./score');
const crm = require('./crm');
crm.install(app);

// The app's own CSS and JS, gzipped once per file version and revalidated with an ETag (phones on cell data).
const PUBLIC = path.join(__dirname, '..', 'public'), packed = new Map();
app.use((req, res, next) => {
  if (req.method !== 'GET' || !/^\/(app\.css|js\/[\w.-]+\.js)$/.test(req.path) || !/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
  const file = path.join(PUBLIC, req.path);
  let st; try { st = require('fs').statSync(file); } catch { return next(); }
  let hit = packed.get(file);
  if (!hit || hit.mtime !== st.mtimeMs) { hit = { mtime: st.mtimeMs, etag: `"${st.size}-${Math.round(st.mtimeMs)}"`, body: zlib.gzipSync(require('fs').readFileSync(file), { level: 9 }) }; packed.set(file, hit); }
  res.set({ ETag: hit.etag, 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' });
  if (req.headers['if-none-match'] === hit.etag) return res.status(304).end();
  res.set({ 'Content-Type': req.path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Content-Encoding': 'gzip' });
  res.send(hit.body);
});
app.use(express.static(PUBLIC, { index: 'index.html' }));

const findContractor = db.prepare('SELECT * FROM contractors WHERE name_key = ? LIMIT 1');
function withContact(p) {
  const c = (p.contractor_key && findContractor.get(p.contractor_key)) ||
            (p.applicant_key && findContractor.get(p.applicant_key)) || null;
  return { ...p, raw: undefined, contact: c };
}
// The fields a list row or a map dot needs. ?slim=1 on /api/permits returns these instead of whole records.
const SLIM = ['id', 'address', 'city', 'value', 'work_type', 'use_type', 'record_type', 'issued_date', 'contractor', 'applicant',
  'contractor_key', 'applicant_key', 'contact_phone', 'contact_email', 'score', 'lat', 'lng', 'stage'];
function slim(p) {
  const o = {}; for (const k of SLIM) o[k] = p[k];
  const c = p.contact; o.contact = c ? { phone: c.phone, alt_phone: c.alt_phone, email: c.email, person: c.person } : null;
  return o;
}

// GET /api/permits?q=&city=&type=&use=&builder=<key>&saved=1&minValue=&maxValue=&from=&to=&minScore=&hasContact=&sort=score|fresh|value&limit=
app.get('/api/permits', (req, res) => {
  const q = req.query, where = ['1=1'], args = {};
  if (q.q) { where.push('(p.address LIKE @q OR p.description LIKE @q OR p.contractor LIKE @q OR p.applicant LIKE @q)'); args.q = `%${q.q}%`; }
  if (q.trade !== '1') where.push("kind <> 'trade'");          // electrical/plumbing/sign permits hidden by default
  if (q.week === '1') where.push("issued_date >= date('now','-7 days')");
  if (q.source) { where.push('source = @source'); args.source = q.source; }
  if (q.city) { where.push('city = @city'); args.city = q.city; }
  if (q.type) { where.push('work_type = @type'); args.type = q.type; }
  if (q.use) { where.push('use_type = @use'); args.use = q.use; }
  if (q.builder) { where.push('(contractor_key = @builder OR applicant_key = @builder)'); args.builder = q.builder; }
  if (q.saved === '1') where.push('pl.permit_id IS NOT NULL');
  if (q.saved === '0') where.push('pl.permit_id IS NULL');           // leads nobody has picked up yet
  if (q.bbox) {                                                      // south,west,north,east: "search this area" on the map
    const [s, w, n, e] = String(q.bbox).split(',').map(Number);
    if ([s, w, n, e].every(Number.isFinite)) { where.push('p.lat BETWEEN @s AND @n AND p.lng BETWEEN @w AND @e'); Object.assign(args, { s, w, n, e }); }
  }
  if (q.minValue) { where.push('value >= @minValue'); args.minValue = +q.minValue; }
  if (q.maxValue) { where.push('value <= @maxValue'); args.maxValue = +q.maxValue; }
  if (q.from) { where.push('issued_date >= @from'); args.from = q.from; }
  if (q.to) { where.push('issued_date <= @to'); args.to = q.to; }
  if (q.minScore) { where.push('score >= @minScore'); args.minScore = +q.minScore; }
  if (q.hasBuilder === '1') where.push('contractor IS NOT NULL');
  const order = { fresh: 'issued_date DESC', value: 'value DESC' }[q.sort] || 'score DESC, issued_date DESC';
  const limit = Math.min(+q.limit || 500, 2000);
  if (q.hasContact === '1') where.push(`(contractor_key IN (SELECT name_key FROM contractors) OR applicant_key IN (SELECT name_key FROM contractors))`);
  const rows = db.prepare(`SELECT p.*, pl.stage FROM permits p LEFT JOIN pipeline pl ON pl.permit_id=p.id
    WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`).all(args).map(withContact);
  res.json(q.slim === '1' ? rows.map(slim) : rows);
});

app.get('/api/permits/:id', (req, res) => {
  const p = db.prepare('SELECT p.*, pl.stage, pl.notes FROM permits p LEFT JOIN pipeline pl ON pl.permit_id=p.id WHERE p.id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const key = p.contractor_key || p.applicant_key;
  const history = key ? db.prepare(`SELECT id,address,city,value,work_type,issued_date FROM permits
     WHERE id<>? AND (contractor_key=? OR applicant_key=?) ORDER BY issued_date DESC LIMIT 20`).all(p.id, key, key) : [];
  res.json({ ...withContact(p), history, score_parts: parts(p),
    builder_key: key || null, watched: !!(key && db.prepare('SELECT 1 FROM watches WHERE user_id=? AND builder_key=?').get(req.user.id, key)) });
});

app.get('/api/meta', (req, res) => {
  res.json({
    total: db.prepare('SELECT count(*) n FROM permits').get().n,
    cities: db.prepare("SELECT city, count(*) n FROM permits WHERE kind<>'trade' GROUP BY city ORDER BY n DESC").all(),
    types: db.prepare("SELECT work_type, count(*) n FROM permits WHERE kind<>'trade' AND work_type IS NOT NULL GROUP BY work_type ORDER BY n DESC").all(),
    alerts: db.prepare('SELECT count(*) n FROM alerts WHERE resolved_at IS NULL').get().n,
    contractors: db.prepare('SELECT count(*) n FROM contractors').get().n,
    lastImport: db.prepare('SELECT * FROM import_runs ORDER BY id DESC LIMIT 1').get() || null,
  });
});

// Pipeline
const STAGES = ['new', 'contacted', 'quoted', 'won', 'lost'];
app.get('/api/pipeline', (req, res) => {
  // last_touch = the latest call, email or note; next_task = the earliest open follow-up. The app derives the next step from these.
  res.json(db.prepare(`SELECT p.*, pl.stage, pl.notes, pl.saved_at, pl.updated_at AS stage_updated,
      (SELECT max(created_at) FROM activity a WHERE a.permit_id=p.id AND a.kind IN ('call','email','note')) AS last_touch,
      (SELECT body FROM activity a WHERE a.permit_id=p.id AND a.kind='call' ORDER BY a.id DESC LIMIT 1) AS last_call,
      (SELECT min(due_at) FROM activity a WHERE a.permit_id=p.id AND a.kind='task' AND a.done_at IS NULL) AS next_task,
      (SELECT status FROM quotes q WHERE q.permit_id=p.id ORDER BY q.id DESC LIMIT 1) AS quote_status,
      (SELECT total FROM quotes q WHERE q.permit_id=p.id ORDER BY q.id DESC LIMIT 1) AS quote_total
    FROM pipeline pl JOIN permits p ON p.id=pl.permit_id ORDER BY pl.updated_at DESC`).all().map(withContact));
});
app.put('/api/pipeline/:id', (req, res) => {
  const stage = STAGES.includes(req.body.stage) ? req.body.stage : 'new';
  const before = db.prepare('SELECT stage FROM pipeline WHERE permit_id=?').get(req.params.id);
  db.prepare(`INSERT INTO pipeline (permit_id,stage,notes) VALUES (?,?,?)
    ON CONFLICT(permit_id) DO UPDATE SET stage=excluded.stage, notes=COALESCE(?,notes), updated_at=datetime('now')`)
    .run(req.params.id, stage, req.body.notes ?? '', req.body.notes ?? null);
  crm.logStage(req.params.id, before ? before.stage : null, stage, req.user.id, req.body.reason ? String(req.body.reason).slice(0, 200) : '');
  res.json({ ok: true });
});
app.delete('/api/pipeline/:id', (req, res) => {
  db.prepare('DELETE FROM pipeline WHERE permit_id=?').run(req.params.id); res.json({ ok: true });
});

// Contractors: search + top builders by permit activity
app.get('/api/builders', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : null;
  const rows = db.prepare(`SELECT contractor AS name, contractor_key AS k, count(*) permits, sum(value) total_value, max(issued_date) last_permit
    FROM permits WHERE contractor_key IS NOT NULL AND kind<>'trade' AND issued_date >= date('now','-365 days')
      AND (@q IS NULL OR contractor LIKE @q)
      AND (@build = 0 OR work_type IN ('new','addition'))
    GROUP BY contractor_key ORDER BY permits DESC LIMIT 200`).all({ q, build: req.query.scope === 'build' ? 1 : 0 });
  res.json(rows.map(r => ({ ...r, contact: findContractor.get(r.k) || null })));
});

// Source health: one row per ingestion source, with last run, this week's count and open alerts.
// Ingestion itself is NOT run by this server: the Python engine (engine/ingest.py) runs daily from a systemd timer.
app.get('/api/sources', (req, res) => {
  const rows = db.prepare(`SELECT source, max(city) city, count(*) total, max(issued_date) newest,
      sum(issued_date >= date('now','-7 days')) week, sum(first_seen >= date('now','-7 days')) new_week,
      sum(contractor IS NOT NULL) with_contractor, sum(value IS NOT NULL) with_value, sum(lat IS NOT NULL) located
    FROM permits GROUP BY source ORDER BY total DESC`).all();
  const lastRun = db.prepare(`SELECT * FROM import_runs WHERE id IN (SELECT max(id) FROM import_runs GROUP BY source)`).all();
  const alerts = db.prepare('SELECT * FROM alerts WHERE resolved_at IS NULL ORDER BY created_at DESC').all();
  res.json({ sources: rows.map(r => ({ ...r, run: lastRun.find(x => x.source === r.source) || null,
    alerts: alerts.filter(a => a.source === r.source) })),
    neverLoaded: lastRun.filter(x => !rows.some(r => r.source === x.source)).map(x => ({ source: x.source, run: x, alerts: alerts.filter(a => a.source === x.source) })) });
});

const port = process.env.PORT || 3000;
// Express 5 calls this with an error when the port cannot be opened, so check before announcing success.
app.listen(port, process.env.HOST || '127.0.0.1', err => {
  if (!err) return console.log(`Steady Leads on http://localhost:${port}`);
  console.error(err.code === 'EADDRINUSE'
    ? `Port ${port} is already in use: another copy of the server is still running. Stop it first, then start again.`
    : `Could not start the server: ${err.message}`);
  process.exit(1);
});
