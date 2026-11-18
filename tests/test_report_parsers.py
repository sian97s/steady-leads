"""Every PDF/HTML report parser against REAL saved reports.

Fixtures live in tests/fixtures/reports/<host>/ with index.json (url -> file),
captured from the cities' sites by tools/save_fixtures.py or the live audit.
expected.json pins, per file, how many permits it must yield and the first and
last permit number -- regenerate deliberately with: python tools/snapshot_reports.py
"""
import json
import re
import pytest
from conftest import FIX
import pdf_base
from adapters import html_table, pdf_cities
from sources import SOURCES_BY_CITY

REP = FIX / "reports"
INDEX = json.loads((REP / "index.json").read_text()) if (REP / "index.json").exists() else {}
EXPECTED = json.loads((REP / "expected.json").read_text()) if (REP / "expected.json").exists() else {}

PARSERS = {  # host -> (city, parse fn, permit-number pattern)
    "burnaby.ca": ("burnaby", pdf_cities._burnaby_parse, r"^[A-Z]{3,4}\d{2}-\d{4,6}$"),
    "richmond.ca": ("richmond", pdf_cities._richmond_parse, r"^\d{2}-\d{4,6}"),
    "coquitlam.ca": ("coquitlam", pdf_cities._coquitlam_parse, r"^\d{2}-\d{5,6}-\d{2}"),
    "cnv.org": ("north_vancouver_city", pdf_cities._cnv_parse, r"^(BLD|BP)\d{4}-\d{3,5}$"),
    "admin.delta.ca": ("delta", pdf_cities._delta_parse, r"^[A-Z]{2}\d{5,6}$"),
    "chilliwack.com": ("chilliwack", pdf_cities._chilliwack_parse, r"^[A-Z]{2}\d{4,7}$"),
    "mission.ca": ("mission", pdf_cities._mission_parse, r"^\d{2,4}[-/]?\d{3,6}$"),
}


def parse_fixture(url, rel):
    host = rel.split("/")[0]
    city, parse, rx = PARSERS[host]
    data = (REP / rel).read_bytes()
    assert data[:5] == b"%PDF-", f"{rel} is not a PDF"
    try:
        lines = pdf_base.page_rows(data)
        pdf_base.check_readable(lines)
        return city, rx, parse(lines, dict(SOURCES_BY_CITY[city]), url), None
    except (pdf_base.NotAPermitReport, pdf_base.UnreadablePDF) as e:
        return city, rx, [], type(e).__name__          # permanent property of the file; engine skips it
    except Exception as e:  # noqa: BLE001
        # A layout the parser cannot read. Pinned in expected.json as a KNOWN GAP so it is visible,
        # and so the test fails (prompting a re-pin) the day the parser learns to read it.
        return city, rx, [], f"UNPARSED: {str(e)[:60]}"


PDFS = sorted((u, r) for u, r in INDEX.items() if r.split("/")[0] in PARSERS and not r.endswith((".html", ".json")))


def test_fixtures_present_for_every_pdf_city():
    if not INDEX:
        pytest.skip("no real reports saved yet -- run tools/save_fixtures.py (needs internet)")
    have = {r.split("/")[0] for _, r in PDFS}
    assert have == set(PARSERS), f"no saved report for: {sorted(set(PARSERS) - have)}"


@pytest.mark.parametrize("url,rel", PDFS, ids=[r for _, r in PDFS])
def test_pdf_report(url, rel):
    city, rx, permits, skipped = parse_fixture(url, rel)
    exp = EXPECTED.get(rel)
    assert exp is not None, f"{rel} has no pinned expectation; run tools/snapshot_reports.py and review it"
    assert skipped == exp.get("skipped")
    assert len(permits) == exp["count"]
    if not permits:
        return
    ids = [p.permit_id for p in permits]
    assert [ids[0], ids[-1]] == exp["first_last"]
    assert len(set(ids)) == len(ids) or exp.get("dupes_ok")
    assert all(re.search(rx, i) for i in ids), [i for i in ids if not re.search(rx, i)][:5]
    dated = sum(1 for p in permits if p.issue_date and re.fullmatch(r"20\d\d-\d\d-\d\d", p.issue_date))
    assert dated / len(permits) >= exp.get("min_dated", 0.9)
    assert sum(1 for p in permits if p.address) / len(permits) >= 0.9
    for p in permits:
        p.validate()
        assert p.value is None or 0 <= p.value < 2_000_000_000


def test_port_coquitlam_html_table(monkeypatch):
    rel = next((r for u, r in INDEX.items() if r.startswith("portcoquitlam.ca/")), None)
    if not rel:
        pytest.skip("no saved Port Coquitlam page")
    monkeypatch.setattr(html_table, "get_text", lambda url, **k: (REP / rel).read_text())
    permits = html_table.fetch(dict(SOURCES_BY_CITY["port_coquitlam"]))
    assert len(permits) == EXPECTED[rel]["count"] > 0
    assert all(re.match(r"^[A-Z]{2}\d{5,6}$", p.permit_id) and p.issue_date for p in permits)


def test_report_index_pages_still_yield_links(monkeypatch):
    """Link discovery against the saved index pages: a city renaming its files shows up here."""
    pages = {u: r for u, r in INDEX.items() if r.endswith(".html")}
    if not pages:
        pytest.skip("no saved index pages")
    monkeypatch.setattr(pdf_base, "get_text", lambda url, **k: (REP / pages[url]).read_text())
    burnaby = SOURCES_BY_CITY["burnaby"]["index_url"]
    if burnaby in pages:
        assert len(pdf_base.discover(burnaby, r"/\w+-\d+-\d{4}\.pdf$")) > 50
    cnv = SOURCES_BY_CITY["north_vancouver_city"]["index_url"]
    if cnv in pages:
        assert len(pdf_base.discover(cnv, r"Issued-Building-Permits?-Report\.pdf$")) >= 1
