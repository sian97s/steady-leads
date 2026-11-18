"""Download real current reports for the parser tests (needs internet):
    python tools/save_fixtures.py [reports-per-city=2]
Saves the newest N reports per PDF city, the Port Coquitlam page and every report index page
into tests/fixtures/reports/, then run tools/snapshot_reports.py and review the table."""
import hashlib, json, re, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine")); sys.path.insert(0, str(ROOT / "engine" / "adapters"))
import http_client, pdf_base
from adapters import html_table, pdf_cities
from sources import SOURCES_BY_CITY
N = int(sys.argv[1]) if len(sys.argv) > 1 else 2
REP = ROOT / "tests" / "fixtures" / "reports"; REP.mkdir(parents=True, exist_ok=True)
idx_path = REP / "index.json"; index = json.loads(idx_path.read_text()) if idx_path.exists() else {}

def save(url, data, ext):
    host = re.sub(r"^www\.", "", url.split("/")[2]); (REP / host).mkdir(exist_ok=True)
    tail = re.sub(r"[^A-Za-z0-9._-]+", "_", url.split("?")[0].rstrip("/").rsplit("/", 1)[-1])[:70]
    rel = f"{host}/{hashlib.sha1(url.encode()).hexdigest()[:8]}-{tail}{'' if tail.lower().endswith(ext) else ext}"
    (REP / rel).write_bytes(data if isinstance(data, bytes) else data.encode()); index[url] = rel
    idx_path.write_text(json.dumps(index, indent=1, sort_keys=True))

gb, gt = http_client.get_bytes, http_client.get_text
def get_bytes(url, *a, **k): b = gb(url, *a, **k); save(url, b, ".pdf"); return b
def get_text(url, *a, **k): t = gt(url, *a, **k); save(url, t, ".html"); return t
pdf_base.get_bytes, pdf_base.get_text, html_table.get_text = get_bytes, get_text, get_text
pdf_base.SEEN_PATH = Path(tempfile.mkdtemp()) / "seen.json"          # ignore the real cache
for city, fn in [("burnaby", pdf_cities.burnaby), ("richmond", pdf_cities.richmond), ("coquitlam", pdf_cities.coquitlam),
                 ("north_vancouver_city", pdf_cities.north_vancouver_city), ("delta", pdf_cities.delta),
                 ("chilliwack", pdf_cities.chilliwack), ("mission", pdf_cities.mission), ("port_coquitlam", html_table.fetch)]:
    cfg = dict(SOURCES_BY_CITY[city]); cfg["pdf_budget"] = N; cfg["_stored"] = -1
    try: print(f"{city}: {len(fn(cfg))} permits from saved reports")
    except Exception as e: print(f"{city}: FAILED {e}")
print("saved", len(index), "files ->", REP)
