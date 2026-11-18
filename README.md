# Steady Leads — BC permit leads for building-supply sales (2026-11)

Formerly Leadyard. The product name in the interface is Steady Leads; internal names (`leadyard.db`, `/opt/leadyard`, the `ly_session` cookie) are unchanged so existing deployments keep working.

One product, three parts:

| Part | What | Where |
|---|---|---|
| Ingestion engine | Python. The scrapers from *My Permit Dash* (adapters untouched) writing to SQLite, plus the 8 API sources that only the old Node importers had. | `engine/` |
| Database | One SQLite file. Schema in `schema.sql`, read by both sides. | `data/leadyard.db` |
| Web app | Node/Express API (`src/server.js` permits, pipeline, builders, sources; `src/crm.js` activity, follow-ups, quotes, watched builders, Today) and a no-build front end (`public/index.html`, `app.css`, `js/`). No ingestion code. | `src/`, `public/` |

The old Node importers (`src/importers`, `src/ingest.js`) are retired; a copy of the pre-merge app is in `../_archive/`.

## Run locally
    python3 -m venv .venv && .venv/bin/pip install -r engine/requirements.txt && npm install
    bin/daily.sh                       # ingest all sources + rescore (first run back-fills from the newest stored permit)
    node src/users.js add you@example.com --admin     # prints a temporary password
    INSECURE_COOKIES=1 npm start       # http://localhost:3000

    .venv/bin/python engine/ingest.py --only surrey,delta      # some sources
    .venv/bin/python engine/ingest.py --full                   # full history where a source has one
    .venv/bin/python engine/import_builders.py data/builders.xlsx   # reload contractor list
    .venv/bin/python engine/match_report.py                    # contractor match rate + samples
    .venv/bin/python engine/load_history.py "<My Permit Dash>/data/permits"   # one-time history load (already done)

## Deploy (DigitalOcean / any Ubuntu VPS)
    bash deploy/deploy.sh root@VPS_IP leads.example.com you@example.com
Installs to `/opt/leadyard`, runs the app as a systemd service behind Caddy (automatic HTTPS), and a systemd
timer that runs `bin/daily.sh` at 05:30 Pacific. It creates the first admin account and prints a temporary password; the alert topic is generated into `/opt/leadyard/.env`.

## Accounts
Each person signs in with their own email and password (`src/auth.js`: scrypt hashes, 30-day sessions, lockout after 8
failed attempts). Admins add, disable, reset and remove accounts in the Users tab, or with `node src/users.js` on the server.
New and reset accounts get a temporary password that must be changed at first sign-in.

## Alerts
Each run, per source: **zero_rows** (a source that is re-read in full returned nothing), **failed**, **empty_report**
(a newly published PDF parsed to nothing = layout change), **stale** (newest permit older than the source's publishing
cadence allows; limits in `engine/sources.py`). Alerts show in the app's Sources tab and are pushed once when they open
(`ALERT_WEBHOOK`, optional SMTP — see `engine/alerts.py`).

## Tests
    .venv/bin/pip install pytest && .venv/bin/python -m pytest tests -q
API adapters run against real saved API records; PDF/HTML parsers against real saved reports in
`tests/fixtures/reports/` (`tools/save_fixtures.py` fetches them, `tools/snapshot_reports.py` pins expectations).

## Adding a source
ArcGIS/Opendatasoft: one config row in `engine/sources.py` (+ a `MAX_AGE_DAYS` entry, and an `extras.py` branch if the
feed has phone/email/category). PDF city: a reader in `engine/adapters/pdf_cities.py`.

## Scoring (0–100)
Value (up to 35) + work type (new 30, addition/alteration 18, demolition 14) + freshness (up to 20)
+ named builder (10) / applicant (5) + residential (5). Trade permits (electrical, plumbing, gas, signs) are capped at 15
and hidden unless "Include trade permits" is ticked.

## The app (redesigned 2026-11-16)
Screens: **Today** (follow-ups due, new hot permits, watched builders), **Leads** (list + map over one filtered result),
**Pipeline** (board on desktop, stage tabs on phones), **Builders**, **Lead Agent** (plain-language queries answered from
the database; rule-based, no outside AI service), plus Data sources and Team. A lead opens in a side panel.

Workflow rules live on the server (`src/crm.js`): a note or follow-up saves the lead; a call that reached someone or any
email moves it to Contacted; marking a quote sent moves it to Quoted. Leads never move backwards automatically. Every
change is written to the `activity` table with the rep's name. The pipeline, activity and quotes are shared by the team;
watched builders are per rep; route stops, email templates and yard details are kept in the browser on each device.

New tables (`activity`, `quotes`, `watches`) are created automatically from `schema.sql` the next time the server starts.
The previous interface is in `../_archive/app-ui-before-redesign-2026-11-16/`.

### Polish pass (2026-11-17)
- JSON responses are gzipped by the server (no proxy setting needed), and lead lists use `?slim=1`, which returns only the
  fields a row or map dot needs: a 500-lead list went from about 670 KB to about 43 KB.
- Stage changes and follow-up ticks show at once and are confirmed by the server afterwards. Deleting a note or follow-up,
  and removing a lead from the pipeline, can be undone from the message that appears. Deleting a quote or an account asks
  for a second tap.
- Keyboard: `/` jumps to search, the up and down arrows walk the Leads list, Esc closes the lead or the open sheet.
- Pipeline has a CSV export (the share button in its header).
- Layouts: sidebar from 900 px, list-and-map with a tab bar from 700 px, single column below that.

### Design pass (2026-11-17)
- Look: built around a rep's measuring and marking tools. The logo is a spirit-level vial ("Steady"), a lead's score is read
  off a tape measure, the action colour is chalk-line blue, and hot leads use flagging-tape orange. Headlines use Barlow Semi
  Condensed from Google Fonts; everything else uses the system font. Design tokens are at the top of `public/app.css`.
- Colour language for leads, the same everywhere (list, map, panel, pipeline): a filled mark means nobody has picked the lead
  up and its colour says how hard to chase it (orange hot 70+, yellow warm 45+, grey low); an outlined mark means it is already
  in the pipeline, with a tag saying Saved, Reached out, Quoted, Won or Lost. The filter "Hide leads already in the pipeline"
  (`/api/permits?saved=0`) shows only untouched leads.
- Map (`public/js/map.js`): each lead is a price-tag pin with its value; nearby leads merge into a count bubble that splits as
  you zoom. Hovering a list row lights its pin. Moving the map offers "Search this area" (`/api/permits?bbox=s,w,n,e`). On a
  phone, tapping a pin shows a preview card first.
- Pipeline race: `/api/scoreboard` totals this week's points per rep from the activity log (reached call 3, call or email 1,
  lead saved 1, follow-up done 1, quote sent 5, order won 15; weeks start Monday in the rep's time zone). The Pipeline and
  Today screens show the ranking, the gap to the next rep, a working-day streak and each rep's weekly goal, plus one
  "next move" picked from overdue follow-ups, leads going cold and the best fresh permit.
- The app's CSS and JS are gzipped by the server and revalidated with ETags.
