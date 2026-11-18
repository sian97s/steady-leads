// Re-scores every permit (freshness points decay daily). Run after each ingest: node src/rescore.js
const { db } = require('./db');
const { score } = require('./score');
const rows = db.prepare('SELECT id,value,work_type,use_type,kind,issued_date,contractor,applicant,score FROM permits').all();
const up = db.prepare('UPDATE permits SET score=? WHERE id=?');
let n = 0;
db.transaction(() => { for (const p of rows) { const s = score(p); if (s !== p.score) { up.run(s, p.id); n++; } } })();
console.log(`rescored ${rows.length} permits (${n} changed)`);
