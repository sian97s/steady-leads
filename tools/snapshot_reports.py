"""Pin what each saved real report parses to (tests/fixtures/reports/expected.json).
Review the printed table before committing: this is the 'known good' the tests enforce."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests")); sys.path.insert(0, str(ROOT / "engine")); sys.path.insert(0, str(ROOT / "engine" / "adapters"))
import test_report_parsers as t
from adapters import html_table
from sources import SOURCES_BY_CITY
exp = {}
for url, rel in t.PDFS:
    city, rx, permits, skipped = t.parse_fixture(url, rel)
    ids = [p.permit_id for p in permits]
    dated = sum(1 for p in permits if p.issue_date) / len(permits) if permits else 0
    e = {"count": len(permits), "skipped": skipped}
    if permits:
        e["first_last"] = [ids[0], ids[-1]]
        if len(set(ids)) != len(ids): e["dupes_ok"] = True
        if dated < 0.9: e["min_dated"] = round(dated - 0.01, 2)
    exp[rel] = e
    print(f"{rel:70} {len(permits):4} permits  dated {dated:.0%}  {skipped or ''}")
for url, rel in t.INDEX.items():
    if rel.startswith("portcoquitlam.ca/"):
        html_table.get_text = lambda u, **k: (t.REP / rel).read_text()
        n = len(html_table.fetch(dict(SOURCES_BY_CITY["port_coquitlam"]))); exp[rel] = {"count": n}; print(f"{rel:70} {n:4} permits")
(t.REP / "expected.json").write_text(json.dumps(exp, indent=1, sort_keys=True))
