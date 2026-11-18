"""API adapters (ArcGIS, Opendatasoft) against REAL records each city's API returned
(saved verbatim in tests/fixtures/api/<city>.json with what the engine made of them)."""
import json
import pytest
from conftest import FIX
from adapters import arcgis, opendatasoft
from sources import SOURCES_BY_CITY

CITIES = ["vancouver", "maple_ridge", "new_westminster", "port_moody", "surrey", "squamish"]
CHECK = ["permit_id", "record_type", "issue_date", "address", "work_type", "use_class", "value", "applicant", "contractor", "description"]


@pytest.mark.parametrize("city", CITIES)
def test_normalize_real_records(city):
    cfg = SOURCES_BY_CITY[city]
    rows = json.loads((FIX / "api" / f"{city}.json").read_text())
    assert len(rows) >= 20
    for want in rows:
        if cfg["adapter"] == "opendatasoft":
            p = opendatasoft._normalize(want["raw"], cfg)
        else:
            p = arcgis._normalize({"attributes": want["raw"]}, cfg, cfg["fields"])
        got = p.to_dict()
        for k in CHECK:
            assert got[k] == want[k], f"{city} {want['permit_id']} field {k}"
        assert got["uid"] == want["uid"]            # dedup key is stable across the merge


def test_surrey_compact_dates_parse_on_every_python():
    # Surrey publishes "20260202"; this broke silently on Python 3.10.
    rows = json.loads((FIX / "api" / "surrey.json").read_text())
    assert all(r["raw"]["IssuedDate"] and r["issue_date"] for r in rows)
    from schema import parse_date
    assert parse_date("20260202") == "2026-02-02"
    assert parse_date("Jan 11 2012 12:00AM") == "2012-01-11"
    assert parse_date(1780315200000) == "2026-06-01"


def test_every_source_config_is_wired():
    import ingest
    from sources import MAX_AGE_DAYS, SOURCES
    cities = [s["city"] for s in SOURCES]
    assert len(cities) == len(set(cities))
    for s in SOURCES:
        assert s["adapter"] in ingest.ADAPTERS
        assert s["city"] in MAX_AGE_DAYS
        assert s["record_type"] in ("issued", "application")
        if s["adapter"] == "arcgis":
            assert s["url"].startswith("https://") and s["fields"]["permit_id"]
