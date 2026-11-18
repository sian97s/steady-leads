-- Single source of truth for the Leadyard database. Read by engine/db.py and src/db.js.
CREATE TABLE IF NOT EXISTS permits (
  id TEXT PRIMARY KEY,              -- source:permit_number
  source TEXT NOT NULL,             -- engine source key, e.g. vancouver, north_vancouver_city
  permit_number TEXT,
  city TEXT,                        -- display name
  record_type TEXT,                 -- issued | application
  kind TEXT,                        -- building | trade | development
  address TEXT,
  lat REAL, lng REAL,
  value REAL,
  work_type TEXT,                   -- canonical: new, addition, alteration, demolition, repair, temporary, other
  use_type TEXT,                    -- canonical: residential, commercial, industrial, institutional, mixed, other
  category TEXT,                    -- the city's own permit type wording
  description TEXT,
  applicant TEXT, applicant_address TEXT, applicant_key TEXT,
  contractor TEXT, contractor_address TEXT, contractor_key TEXT,
  contact_phone TEXT, contact_email TEXT,
  status TEXT,
  filed_date TEXT,
  issued_date TEXT,
  first_seen TEXT,                  -- when our engine first saw it; never overwritten
  score INTEGER,
  raw TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_permits_issued ON permits(issued_date);
CREATE INDEX IF NOT EXISTS ix_permits_city ON permits(city);
CREATE INDEX IF NOT EXISTS ix_permits_source ON permits(source, issued_date);
CREATE INDEX IF NOT EXISTS ix_permits_score ON permits(score DESC, issued_date DESC);
CREATE INDEX IF NOT EXISTS ix_permits_ckey ON permits(contractor_key);
CREATE INDEX IF NOT EXISTS ix_permits_akey ON permits(applicant_key);

CREATE TABLE IF NOT EXISTS contractors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,           -- normalized for matching
  phone TEXT, email TEXT, website TEXT,
  address TEXT, city TEXT, trade TEXT, notes TEXT,
  licence TEXT, status TEXT, person TEXT, alt_phone TEXT
);
CREATE INDEX IF NOT EXISTS ix_contractors_key ON contractors(name_key);

CREATE TABLE IF NOT EXISTS pipeline (
  permit_id TEXT PRIMARY KEY REFERENCES permits(id),
  stage TEXT NOT NULL DEFAULT 'new', -- new | contacted | quoted | won | lost
  notes TEXT DEFAULT '',
  saved_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT, started_at TEXT, finished_at TEXT,
  rows INTEGER,                     -- records the source returned this run
  new_rows INTEGER, status TEXT,    -- ok | failed
  error TEXT
);
CREATE INDEX IF NOT EXISTS ix_runs_source ON import_runs(source, id);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT, kind TEXT,           -- zero_rows | failed | stale | empty_report
  message TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',     -- admin | user
  pass_hash TEXT NOT NULL,               -- scrypt: salt:hash (hex)
  must_change INTEGER NOT NULL DEFAULT 1, -- temp password issued by an admin
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,           -- sha256 of the cookie value; the raw token is never stored
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- Sales activity on a lead, shared by the team: notes, logged calls and emails, stage changes, and tasks
-- (follow-ups, site visits). Tasks carry due_at ('YYYY-MM-DD HH:MM', the rep's local time) and done_at.
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  permit_id TEXT REFERENCES permits(id),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,               -- note | call | email | task | stage
  body TEXT,
  due_at TEXT,
  done_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_activity_permit ON activity(permit_id, created_at);
CREATE INDEX IF NOT EXISTS ix_activity_open ON activity(kind, done_at, due_at);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  permit_id TEXT REFERENCES permits(id),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  number TEXT,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | sent | accepted | declined
  total REAL,                            -- before tax
  data TEXT,                             -- JSON: client, attn, items[], tax, terms
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_quotes_permit ON quotes(permit_id);

-- Builders a rep follows. New permits from them show up on that rep's Today screen.
CREATE TABLE IF NOT EXISTS watches (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  builder_key TEXT NOT NULL,
  builder_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, builder_key)
);
