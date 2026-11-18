// The web app's view of the one database. Schema lives in ../schema.sql (shared with engine/db.py).
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'leadyard.db'), { timeout: 60000 });
db.pragma('journal_mode = WAL');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));

module.exports = { db };
