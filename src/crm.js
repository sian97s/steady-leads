// Sales workflow on top of the permit data: activity log (notes, calls, emails, tasks), quotes,
// watched builders, and the rep's Today feed. Installed after auth, so every route has req.user.
const { db } = require('./db');

const STAGES = ['new', 'contacted', 'quoted', 'won', 'lost'];
const rank = s => STAGES.indexOf(s);
const str = (v, max = 4000) => (v == null ? null : String(v).trim().slice(0, max) || null);

// Put a lead in the pipeline, or move it forward to `atLeast`. Never moves a lead backwards or out of won/lost.
function ensureStage(permitId, atLeast, userId) {
  const cur = db.prepare('SELECT stage FROM pipeline WHERE permit_id=?').get(permitId);
  if (!cur) {
    db.prepare('INSERT INTO pipeline (permit_id,stage,notes) VALUES (?,?,?)').run(permitId, atLeast, '');
    logStage(permitId, null, atLeast, userId);
    return atLeast;
  }
  if (cur.stage === 'won' || cur.stage === 'lost' || rank(cur.stage) >= rank(atLeast)) return cur.stage;
  db.prepare("UPDATE pipeline SET stage=?, updated_at=datetime('now') WHERE permit_id=?").run(atLeast, permitId);
  logStage(permitId, cur.stage, atLeast, userId);
  return atLeast;
}
function logStage(permitId, from, to, userId, extra) {
  if (from === to) return;
  const body = (from ? `Moved to ${to}` : to === 'new' ? 'Saved to pipeline' : `Saved as ${to}`) + (extra ? ` · ${extra}` : '');
  db.prepare("INSERT INTO activity (permit_id,user_id,kind,body) VALUES (?,?,'stage',?)").run(permitId, userId, body);
}

function install(app) {
  const permitExists = id => !!db.prepare('SELECT 1 FROM permits WHERE id=?').get(id);

  // ---- activity ----
  app.get('/api/activity', (req, res) => {
    res.json(db.prepare(`SELECT a.*, coalesce(u.name,u.email) AS who FROM activity a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.permit_id=? ORDER BY a.created_at DESC, a.id DESC LIMIT 200`).all(String(req.query.permit || '')));
  });
  // Open tasks for the whole team, plus the ones finished in the last week. The client sorts them into overdue / today / later.
  app.get('/api/tasks', (req, res) => {
    res.json(db.prepare(`SELECT a.*, coalesce(u.name,u.email) AS who, p.address, p.city, coalesce(p.contractor,p.applicant) AS builder
      FROM activity a LEFT JOIN users u ON u.id=a.user_id LEFT JOIN permits p ON p.id=a.permit_id
      WHERE a.kind='task' AND (a.done_at IS NULL OR a.done_at >= datetime('now','-7 days')) ORDER BY a.due_at`).all());
  });
  app.post('/api/activity', (req, res) => {
    const b = req.body || {}, kind = String(b.kind || '');
    if (!['note', 'call', 'email', 'task'].includes(kind)) return res.status(400).json({ error: 'Unknown activity type' });
    const pid = b.permit_id ? String(b.permit_id) : null;
    if (pid && !permitExists(pid)) return res.status(404).json({ error: 'No such permit' });
    if (!pid && kind !== 'task') return res.status(400).json({ error: 'Pick a lead first' });
    const body = str(b.body);
    if (!body) return res.status(400).json({ error: 'Nothing to save' });
    const due = kind === 'task' ? str(b.due_at, 16) : null;
    if (kind === 'task' && !/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(due || '')) return res.status(400).json({ error: 'Pick a date and time' });
    let stage = null;
    db.transaction(() => {
      db.prepare('INSERT INTO activity (permit_id,user_id,kind,body,due_at) VALUES (?,?,?,?,?)').run(pid, req.user.id, kind, body, due);
      if (pid) {
        // A call that reached someone, or any email, counts as contact. Everything else just saves the lead.
        const contacted = kind === 'email' || (kind === 'call' && !/^no answer/i.test(body));
        stage = ensureStage(pid, contacted ? 'contacted' : 'new', req.user.id);
        const f = b.follow_up;
        if (f && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(String(f.due_at || '')) && str(f.body))
          db.prepare("INSERT INTO activity (permit_id,user_id,kind,body,due_at) VALUES (?,?,'task',?,?)").run(pid, req.user.id, str(f.body), f.due_at);
      }
    })();
    res.json({ ok: true, stage });
  });
  app.put('/api/activity/:id', (req, res) => {
    const a = db.prepare('SELECT * FROM activity WHERE id=?').get(req.params.id), b = req.body || {};
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (a.kind === 'stage') return res.status(400).json({ error: 'Stage history cannot be edited' });
    const body = b.body === undefined ? a.body : str(b.body) || a.body;
    const due = b.due_at === undefined ? a.due_at : (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(String(b.due_at)) ? b.due_at : a.due_at);
    const done = b.done === undefined ? a.done_at : b.done ? (a.done_at || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null;
    db.prepare('UPDATE activity SET body=?, due_at=?, done_at=? WHERE id=?').run(body, due, done, a.id);
    res.json({ ok: true });
  });
  app.delete('/api/activity/:id', (req, res) => {
    db.prepare("DELETE FROM activity WHERE id=? AND kind<>'stage'").run(req.params.id); res.json({ ok: true });
  });

  // ---- quotes ----
  const quoteOut = q => ({ ...q, data: JSON.parse(q.data || '{}') });
  const quoteTotal = d => (Array.isArray(d.items) ? d.items : []).reduce((s, i) => s + (+i.qty || 0) * (+i.rate || 0), 0);
  app.get('/api/quotes', (req, res) => {
    const rows = req.query.permit
      ? db.prepare('SELECT * FROM quotes WHERE permit_id=? ORDER BY id DESC').all(String(req.query.permit))
      : db.prepare(`SELECT q.*, p.address, p.city, coalesce(p.contractor,p.applicant) AS builder FROM quotes q
          LEFT JOIN permits p ON p.id=q.permit_id ORDER BY q.updated_at DESC LIMIT 300`).all();
    res.json(rows.map(quoteOut));
  });
  app.post('/api/quotes', (req, res) => {
    const pid = String(req.body?.permit_id || ''), d = req.body?.data || {};
    if (!permitExists(pid)) return res.status(404).json({ error: 'No such permit' });
    let id;
    db.transaction(() => {
      id = db.prepare('INSERT INTO quotes (permit_id,user_id,total,data) VALUES (?,?,?,?)').run(pid, req.user.id, quoteTotal(d), JSON.stringify(d)).lastInsertRowid;
      db.prepare('UPDATE quotes SET number=? WHERE id=?').run('Q-' + (1000 + Number(id)), id);
      ensureStage(pid, 'new', req.user.id);
    })();
    res.json(quoteOut(db.prepare('SELECT * FROM quotes WHERE id=?').get(id)));
  });
  app.put('/api/quotes/:id', (req, res) => {
    const q = db.prepare('SELECT * FROM quotes WHERE id=?').get(req.params.id), b = req.body || {};
    if (!q) return res.status(404).json({ error: 'Not found' });
    const d = b.data || JSON.parse(q.data || '{}');
    const status = ['draft', 'sent', 'accepted', 'declined'].includes(b.status) ? b.status : q.status;
    db.transaction(() => {
      db.prepare("UPDATE quotes SET data=?, total=?, status=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(d), quoteTotal(d), status, q.id);
      if (status !== q.status && status === 'sent') ensureStage(q.permit_id, 'quoted', req.user.id);   // sending a quote moves the lead
    })();
    res.json(quoteOut(db.prepare('SELECT * FROM quotes WHERE id=?').get(q.id)));
  });
  app.delete('/api/quotes/:id', (req, res) => { db.prepare('DELETE FROM quotes WHERE id=?').run(req.params.id); res.json({ ok: true }); });

  // ---- watched builders (per rep) ----
  app.get('/api/watches', (req, res) => {
    res.json(db.prepare(`SELECT w.builder_key AS k, w.builder_name AS name,
        (SELECT count(*) FROM permits p WHERE (p.contractor_key=w.builder_key OR p.applicant_key=w.builder_key) AND p.kind<>'trade' AND p.issued_date >= date('now','-30 days')) AS recent
      FROM watches w WHERE w.user_id=? ORDER BY w.builder_name`).all(req.user.id));
  });
  app.put('/api/watches/:key', (req, res) => {
    db.prepare('INSERT OR REPLACE INTO watches (user_id,builder_key,builder_name) VALUES (?,?,?)').run(req.user.id, req.params.key, str(req.body?.name, 200) || req.params.key);
    res.json({ ok: true });
  });
  app.delete('/api/watches/:key', (req, res) => {
    db.prepare('DELETE FROM watches WHERE user_id=? AND builder_key=?').run(req.user.id, req.params.key); res.json({ ok: true });
  });

  // ---- today: what is new since the rep last looked ----
  app.get('/api/today', (req, res) => {
    const cols = 'p.id,p.address,p.city,p.value,p.work_type,p.use_type,p.contractor,p.applicant,p.contractor_key,p.applicant_key,p.issued_date,p.score,p.lat,p.lng';
    res.json({
      hot: db.prepare(`SELECT ${cols} FROM permits p LEFT JOIN pipeline pl ON pl.permit_id=p.id
        WHERE pl.permit_id IS NULL AND p.kind<>'trade' AND p.score>=70 AND p.issued_date >= date('now','-10 days')
        ORDER BY p.score DESC, p.issued_date DESC LIMIT 8`).all(),
      watched: db.prepare(`SELECT ${cols}, pl.stage FROM permits p LEFT JOIN pipeline pl ON pl.permit_id=p.id
        WHERE p.kind<>'trade' AND p.issued_date >= date('now','-45 days')
          AND (p.contractor_key IN (SELECT builder_key FROM watches WHERE user_id=@u) OR p.applicant_key IN (SELECT builder_key FROM watches WHERE user_id=@u))
        ORDER BY p.issued_date DESC LIMIT 12`).all({ u: req.user.id }),
      week: db.prepare("SELECT count(*) n FROM permits WHERE kind<>'trade' AND score>=70 AND issued_date >= date('now','-7 days')").get().n,
    });
  });

  // ---- scoreboard: this week's points per rep, from the activity log ----
  // from / prev are UTC 'YYYY-MM-DD HH:MM:SS' for the start of this week and last week in the rep's own time zone.
  const POINTS = { reached: 3, call: 1, email: 1, save: 1, followup: 1, quote: 5, win: 15 };
  const tally = (from, to) => db.prepare(`SELECT a.user_id AS id,
      sum(a.kind='call' AND a.body LIKE 'Reached%') reached,
      sum(a.kind='call' AND a.body NOT LIKE 'Reached%') calls,
      sum(a.kind='email') emails,
      sum(a.kind='stage' AND a.body LIKE 'Saved%') saves,
      sum(a.kind='stage' AND (a.body LIKE 'Moved to quoted%' OR a.body LIKE 'Saved as quoted%')) quotes,
      sum(a.kind='stage' AND (a.body LIKE 'Moved to won%' OR a.body LIKE 'Saved as won%')) wins
    FROM activity a WHERE a.user_id IS NOT NULL AND a.created_at >= @from AND a.created_at < @to GROUP BY a.user_id`).all({ from, to });
  const doneTasks = (from, to) => db.prepare(`SELECT user_id AS id, count(*) n FROM activity
    WHERE kind='task' AND done_at >= @from AND done_at < @to AND user_id IS NOT NULL GROUP BY user_id`).all({ from, to });
  const points = (t, f) => (t?.reached || 0) * POINTS.reached + (t?.calls || 0) * POINTS.call + (t?.emails || 0) * POINTS.email + (t?.saves || 0) * POINTS.save
    + (t?.quotes || 0) * POINTS.quote + (t?.wins || 0) * POINTS.win + (f || 0) * POINTS.followup;
  app.get('/api/scoreboard', (req, res) => {
    const ok = v => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(String(v || ''));
    if (!ok(req.query.from) || !ok(req.query.prev)) return res.status(400).json({ error: 'Bad week range' });
    const from = req.query.from, prev = req.query.prev, far = '9999-12-31 00:00:00';
    const now = tally(from, far), was = tally(prev, from), dn = doneTasks(from, far), dw = doneTasks(prev, from);
    const by = (l, id) => l.find(x => x.id === id);
    const reps = db.prepare('SELECT id, coalesce(name,email) AS name FROM users WHERE disabled=0').all().map(u => {
      const t = by(now, u.id) || {}, f = by(dn, u.id)?.n || 0;
      return { id: u.id, name: u.name, reached: t.reached || 0, calls: t.calls || 0, emails: t.emails || 0, saves: t.saves || 0, quotes: t.quotes || 0, wins: t.wins || 0,
        followups: f, points: points(t, f), last_week: points(by(was, u.id), by(dw, u.id)?.n || 0) };
    }).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    res.json({ me: req.user.id, points: POINTS, reps,
      // the rep's own call and email times for the last 45 days; the app turns them into a working-day streak in local time
      touches: db.prepare(`SELECT created_at FROM activity WHERE user_id=? AND kind IN ('call','email') AND created_at >= datetime('now','-45 days') ORDER BY created_at DESC`).all(req.user.id).map(r => r.created_at) });
  });

  // ---- one builder: contact card, totals, their permits ----
  const findContractor = db.prepare('SELECT * FROM contractors WHERE name_key = ? LIMIT 1');
  app.get('/api/builders/:key', (req, res) => {
    const k = req.params.key;
    const permits = db.prepare(`SELECT p.id,p.address,p.city,p.value,p.work_type,p.use_type,p.contractor,p.applicant,p.issued_date,p.score,p.lat,p.lng,pl.stage
      FROM permits p LEFT JOIN pipeline pl ON pl.permit_id=p.id
      WHERE (p.contractor_key=@k OR p.applicant_key=@k) AND p.kind<>'trade' ORDER BY p.issued_date DESC LIMIT 60`).all({ k });
    if (!permits.length && !findContractor.get(k)) return res.status(404).json({ error: 'No such builder' });
    const t = db.prepare(`SELECT count(*) permits, sum(value) total_value, max(issued_date) last_permit, count(DISTINCT city) cities,
        sum(issued_date >= date('now','-365 days')) year
      FROM permits WHERE (contractor_key=@k OR applicant_key=@k) AND kind<>'trade'`).get({ k });
    const c = findContractor.get(k) || null;
    const name = c?.name || permits.find(p => p.contractor)?.contractor || permits[0]?.applicant || k;
    res.json({ k, name, contact: c, ...t, permits,
      watched: !!db.prepare('SELECT 1 FROM watches WHERE user_id=? AND builder_key=?').get(req.user.id, k) });
  });
}

module.exports = { install, ensureStage, logStage, STAGES };
