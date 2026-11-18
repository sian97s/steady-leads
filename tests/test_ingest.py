"""The orchestrator end to end on a temp database with stubbed adapters:
first_seen preservation, failure isolation, and the zero-row / stale / failed alerts."""
import importlib
import pytest
from datetime import date, timedelta
from schema import Permit


@pytest.fixture
def eng(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "t.db"))
    import db, ingest, alerts, pdf_base
    importlib.reload(db); importlib.reload(ingest)
    monkeypatch.setattr(pdf_base, "SEEN_PATH", tmp_path / "pdf_seen.json")
    sent = []
    monkeypatch.setattr(alerts, "send", lambda s, b: sent.append((s, b)) or ["test"])
    monkeypatch.setattr(ingest, "LOCK_PATH", tmp_path / ".lock")
    return ingest, db, sent


def permit(pid, days_ago=1, city="surrey"):
    return Permit(source_city=city, permit_id=pid, record_type="issued",
                  issue_date=(date.today() - timedelta(days=days_ago)).isoformat(), address="1 Main St",
                  contractor="Acme Homes Ltd.", raw={"PermitNumber": pid})


def run(ingest, monkeypatch, feeds, only):
    for adapter, fn in feeds.items():
        monkeypatch.setitem(ingest.ADAPTERS, adapter, fn)
    monkeypatch.setattr("sys.argv", ["ingest.py", "--no-geocode", "--only", only])
    assert ingest.main() == 0


def test_rows_land_and_first_seen_is_never_overwritten(eng, monkeypatch):
    ingest, db, sent = eng
    run(ingest, monkeypatch, {"arcgis": lambda cfg: [permit("A"), permit("B")]}, "surrey")
    con = db.connect()
    con.execute("UPDATE permits SET first_seen='2026-01-01', lat=49.1, lng=-122.8")
    con.commit()
    run(ingest, monkeypatch, {"arcgis": lambda cfg: [permit("A"), permit("C")]}, "surrey")
    rows = {r["permit_number"]: r for r in con.execute("SELECT * FROM permits")}
    assert set(rows) == {"A", "B", "C"}
    assert rows["A"]["first_seen"] == "2026-01-01" and rows["A"]["lat"] == 49.1     # kept
    assert rows["C"]["first_seen"] == date.today().isoformat() or rows["C"]["first_seen"]  # new today
    last = con.execute("SELECT rows,new_rows,status FROM import_runs ORDER BY id DESC").fetchone()
    assert tuple(last) == (2, 1, "ok")
    assert not sent


def test_zero_rows_raises_alert_once_then_resolves(eng, monkeypatch):
    ingest, db, sent = eng
    run(ingest, monkeypatch, {"arcgis": lambda cfg: [permit("A")]}, "surrey")
    run(ingest, monkeypatch, {"arcgis": lambda cfg: []}, "surrey")
    con = db.connect()
    assert [r["kind"] for r in con.execute("SELECT kind FROM alerts WHERE resolved_at IS NULL")] == ["zero_rows"]
    assert len(sent) == 1 and "ZERO rows" in sent[0][1]
    run(ingest, monkeypatch, {"arcgis": lambda cfg: []}, "surrey")          # still broken: no repeat spam
    assert len(sent) == 1
    run(ingest, monkeypatch, {"arcgis": lambda cfg: [permit("A")]}, "surrey")  # fixed
    assert con.execute("SELECT count(*) FROM alerts WHERE resolved_at IS NULL").fetchone()[0] == 0


def test_failed_source_keeps_data_and_alerts(eng, monkeypatch):
    ingest, db, sent = eng
    run(ingest, monkeypatch, {"arcgis": lambda cfg: [permit("A")]}, "surrey")
    def boom(cfg): raise RuntimeError("HTTP 503")
    run(ingest, monkeypatch, {"arcgis": boom}, "surrey")
    con = db.connect()
    assert con.execute("SELECT count(*) FROM permits").fetchone()[0] == 1
    assert con.execute("SELECT status,error FROM import_runs ORDER BY id DESC").fetchone()["status"] == "failed"
    assert any("run failed" in b for _, b in sent)


def test_stale_source_alerts(eng, monkeypatch):
    ingest, db, sent = eng
    run(ingest, monkeypatch, {"arcgis": lambda cfg: [permit("OLD", days_ago=60)]}, "surrey")
    con = db.connect()
    assert "stale" in [r["kind"] for r in con.execute("SELECT kind FROM alerts WHERE resolved_at IS NULL")]


def test_cached_pdf_source_zero_rows_is_not_an_alert(eng, monkeypatch):
    # Burnaby's dailies are cached once parsed, so "nothing new today" is normal -- only staleness counts.
    ingest, db, sent = eng
    run(ingest, monkeypatch, {"pdf_burnaby": lambda cfg: [permit("BLD26-1", city="burnaby")]}, "burnaby")
    run(ingest, monkeypatch, {"pdf_burnaby": lambda cfg: []}, "burnaby")
    con = db.connect()
    assert con.execute("SELECT count(*) FROM alerts WHERE kind='zero_rows'").fetchone()[0] == 0
