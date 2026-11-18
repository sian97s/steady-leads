"""The one ingestion engine. Scrape every source, write to SQLite, raise alerts.

    python engine/ingest.py                      # daily incremental
    python engine/ingest.py --full               # full history where the source has one
    python engine/ingest.py --only surrey,delta
    python engine/ingest.py --no-geocode

Invariants carried over from the original scraper: a source failing never
fails the run, and first_seen is never overwritten.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "adapters"))

import alerts                                                   # noqa: E402
import db                                                       # noqa: E402
import pdf_base                                                 # noqa: E402
from adapters import arcgis, html_table, opendatasoft, pdf_cities  # noqa: E402
from extras import to_row                                       # noqa: E402
from geocode import GeocodeCache                                # noqa: E402
from schema import today                                        # noqa: E402
from sources import ALWAYS_RETURNS_ROWS, MAX_AGE_DAYS, SOURCES  # noqa: E402

ADAPTERS = {
    "arcgis": arcgis.fetch, "opendatasoft": opendatasoft.fetch, "html_table": html_table.fetch,
    "pdf_burnaby": pdf_cities.burnaby, "pdf_richmond": pdf_cities.richmond,
    "pdf_coquitlam": pdf_cities.coquitlam, "pdf_cnv": pdf_cities.north_vancouver_city,
    "pdf_delta": pdf_cities.delta, "pdf_chilliwack": pdf_cities.chilliwack, "pdf_mission": pdf_cities.mission,
}
LOOKBACK_DAYS = 45
GEOCODE_BUDGET = 1500
CACHE_PATH = db.ROOT / "data" / "geocode_cache.json"
LOCK_PATH = db.ROOT / "data" / ".ingest.lock"
log = logging.getLogger("ingest")


def scrape(cfg: dict, full: bool, stored: int, last_date: str | None) -> list:
    cfg = dict(cfg)
    cfg["_stored"] = stored
    gap = (date.today() - date.fromisoformat(last_date)).days if last_date else 9999
    # Maple Ridge: the daily layer only covers 90 days. If we have been away
    # longer than that, the rolling layer would leave a hole -- use full history.
    if cfg.get("full_url") and (full or gap > 80):
        cfg["url"] = cfg["full_url"]
        log.info("  using full-history layer (gap %s days)", gap if gap < 9999 else "n/a")
    if not full and cfg.get("incremental_where") and last_date:
        # Look back 45 days, or to a week before our newest record if we have
        # been down longer, so an outage heals itself.
        since = min(date.today() - timedelta(days=LOOKBACK_DAYS), date.fromisoformat(last_date) - timedelta(days=7))
        cfg["where"] = cfg["incremental_where"].format(since=since.isoformat())
    permits = ADAPTERS[cfg["adapter"]](cfg)
    keep = cfg.get("keep")
    return [p for p in permits if keep(p.raw)] if keep else permits


def run_source(con, cfg: dict, full: bool, cache, geocode_left: int) -> tuple[dict, int]:
    city = cfg["city"]
    log.info("--- %s (%s) ---", city, cfg["adapter"])
    stored, last_date = con.execute(
        "SELECT count(*), max(issued_date) FROM permits WHERE source=?", (city,)).fetchone()
    run_id = con.execute("INSERT INTO import_runs (source,started_at) VALUES (?,datetime('now'))", (city,)).lastrowid
    con.commit()
    seen_before = dict(pdf_base.load_seen().get(city, {})) if cfg["adapter"].startswith("pdf_") else None

    res = {"city": city, "status": "ok", "rows": 0, "new": 0, "error": None, "notes": []}
    try:
        permits = scrape(cfg, full, stored, last_date)
    except Exception as e:  # noqa: BLE001 - isolation is the point
        log.error("  FAILED: %s -- keeping %d existing records", e, stored)
        res.update(status="failed", error=str(e)[:500])
        permits = []

    known = {r[0] for r in con.execute("SELECT id FROM permits WHERE source=?", (city,))}
    rows, run_date = [], today()
    for p in permits:
        try:
            p.validate()
        except ValueError as e:
            log.warning("  skipping invalid record: %s", e)
            continue
        d = p.to_dict()
        d["first_seen"] = run_date
        row = to_row(d, cfg)
        if row["id"] not in known:
            res["new"] += 1
        rows.append(row)
    res["rows"] = len(rows)
    db.upsert(con, rows)

    # Geocode whatever still has no coordinate, newest first, within budget.
    used = 0
    if cache is not None and cfg.get("locality"):
        todo = con.execute("SELECT id,address FROM permits WHERE source=? AND lat IS NULL AND address IS NOT NULL "
                           "ORDER BY issued_date DESC", (city,)).fetchall()
        for r in todo:
            if used >= geocode_left:
                log.info("  geocode budget reached; %d deferred to next run", len(todo) - used)
                break
            hit = cache.key(r["address"], cfg["locality"]) in cache.entries
            lat, lon = cache.lookup(r["address"], cfg["locality"])
            used += 0 if hit else 1
            if lat is not None:
                con.execute("UPDATE permits SET lat=?, lng=? WHERE id=?", (lat, lon, r["id"]))

    # ---- alerts ----
    n, newest = con.execute("SELECT count(*), max(issued_date) FROM permits WHERE source=?", (city,)).fetchone()
    if res["status"] == "failed":
        res["notes"].append(("failed", f"{cfg['label']}: run failed: {res['error']}"))
    else:
        alerts.resolve(con, city, ["failed"])
        if res["rows"] == 0 and cfg["adapter"] in ALWAYS_RETURNS_ROWS:
            res["notes"].append(("zero_rows", f"{cfg['label']}: source returned ZERO rows (it is re-read in full every run, so this is a break)."))
        else:
            alerts.resolve(con, city, ["zero_rows"])
        if seen_before is not None:
            now_seen = pdf_base.load_seen().get(city, {})
            empties = [u for u, v in now_seen.items() if u not in seen_before and not v.get("records") and not v.get("skipped")]
            if empties:
                res["notes"].append(("empty_report", f"{cfg['label']}: {len(empties)} newly published report(s) parsed to zero rows "
                                     f"(layout change?): " + ", ".join(u.rsplit('/', 1)[-1] for u in empties[:5])))
    limit = MAX_AGE_DAYS.get(city, 30)
    age = (date.today() - date.fromisoformat(newest)).days if newest else None
    if age is None or age > limit:
        res["notes"].append(("stale", f"{cfg['label']}: newest permit is {newest or 'none'} "
                             f"({age if age is not None else '?'} days old; limit {limit})."))
    else:
        alerts.resolve(con, city, ["stale"])
    res["fresh_alerts"] = [msg for kind, msg in res["notes"] if alerts.record(con, city, kind, msg)]

    con.execute("UPDATE import_runs SET finished_at=datetime('now'), rows=?, new_rows=?, status=?, error=? WHERE id=?",
                (res["rows"], res["new"], res["status"], res["error"], run_id))
    con.commit()
    res.update(total=n, newest=newest)
    log.info("  %d fetched, %d new, %d stored, newest %s%s", res["rows"], res["new"], n, newest,
             "".join(f"\n  ALERT {k}: {m}" for k, m in res["notes"]))
    return res, used


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--no-geocode", action="store_true")
    ap.add_argument("--geocode-budget", type=int, default=int(os.environ.get("GEOCODE_BUDGET", GEOCODE_BUDGET)))
    ap.add_argument("--no-alert-send", action="store_true", help="record alerts but do not push them out")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)

    if LOCK_PATH.exists():
        try:
            os.kill(int(LOCK_PATH.read_text().strip()), 0)
            raise SystemExit(f"another ingest is running; delete {LOCK_PATH} if that is wrong")
        except (ValueError, OSError):
            log.warning("clearing stale lock")
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    LOCK_PATH.write_text(str(os.getpid()))
    try:
        con = db.connect()
        cache = None if args.no_geocode else GeocodeCache(CACHE_PATH)
        wanted = set(args.only.split(",")) if args.only else None
        left, report = args.geocode_budget, []
        for cfg in SOURCES:
            if wanted and cfg["city"] not in wanted:
                continue
            res, used = run_source(con, cfg, args.full, cache, left)
            left -= used
            report.append(res)
        if cache is not None:
            cache.save()
        con.close()
    finally:
        LOCK_PATH.unlink(missing_ok=True)

    print("\n%-22s %-7s %7s %6s %8s  %s" % ("source", "status", "fetched", "new", "stored", "newest"))
    for r in report:
        print("%-22s %-7s %7d %6d %8d  %s" % (r["city"], r["status"], r["rows"], r["new"], r["total"], r["newest"]))
    (db.DB_PATH.parent / "last_run.json").write_text(json.dumps(
        {"finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
         "sources": [{k: v for k, v in r.items() if k != "notes"} for r in report]}, indent=1))

    fresh = [m for r in report for m in r["fresh_alerts"]]
    if fresh and not args.no_alert_send:
        alerts.send(f"Leadyard: {len(fresh)} source alert(s)", "\n".join("- " + m for m in fresh))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
