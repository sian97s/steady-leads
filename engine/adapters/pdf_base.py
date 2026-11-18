"""Shared machinery for cities that publish permits only as PDF reports.

Four of the biggest Lower Mainland municipalities -- Burnaby, Richmond,
Coquitlam and the City of North Vancouver -- publish no API at all. They post
tabular PDFs. Those tables are laid out in fixed columns, so the reliable way
to read them is by x-coordinate band rather than by parsing extracted text,
which interleaves columns and loses the association between fields.

This module provides the plumbing: find the report links, download politely,
and turn a page into rows of positioned words. Each city's own layout lives in
pdf_cities.py, because the layouts genuinely differ -- a shared config-driven
parser would be more contorted than three small explicit ones.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

from http_client import get_bytes, get_text

log = logging.getLogger(__name__)

# Monthly and daily report PDFs are immutable once published, so a URL we have
# already parsed never needs fetching again. This index makes a daily run cheap:
# it downloads only the reports that appeared since yesterday.
SEEN_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "pdf_seen.json"


@dataclass
class Word:
    x0: float
    x1: float
    text: str


@dataclass
class Line:
    """One visual row of a page, with its vertical position kept.

    Position matters: in several of these reports a record's address wraps onto
    the line *above* its permit number, so rows cannot simply be accumulated in
    reading order -- they have to be assigned by proximity.
    """
    page: int
    top: float
    words: list

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words).strip()


def load_seen() -> dict:
    if SEEN_PATH.exists():
        try:
            return json.loads(SEEN_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_seen(seen: dict) -> None:
    SEEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    SEEN_PATH.write_text(json.dumps(seen, indent=0, sort_keys=True))


def discover(index_url: str, pattern: str) -> list[str]:
    """Absolute URLs of every PDF on an index page matching `pattern`.

    Report filenames carry cache-busting ids and inconsistent casing, so we
    read the index rather than trying to synthesise URLs.
    """
    html = get_text(index_url)
    hrefs = re.findall(r'href="([^"]+\.(?:pdf|PDF))"', html)
    rx = re.compile(pattern, re.I)
    out, seen = [], set()
    for h in hrefs:
        if not rx.search(h):
            continue
        url = urljoin(index_url, h)
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def discover_labeled(index_url: str, text_pattern: str = ".",
                     href_pattern: str | None = None,
                     exclude_text: str | None = None) -> list[str]:
    """URLs whose *link text* matches, for sites that serve PDFs from an
    extensionless path.

    Delta links its reports as /media/5229 with the week in the anchor text,
    so there is nothing in the URL to match on. It also mixes per-permit
    weekly reports with aggregate monthly highlights under the same path
    shape -- only the label distinguishes them.
    """
    html = get_text(index_url)
    rx = re.compile(text_pattern, re.I)
    hrx = re.compile(href_pattern, re.I) if href_pattern else None
    erx = re.compile(exclude_text, re.I) if exclude_text else None
    out, seen = [], set()
    for m in re.finditer(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S | re.I):
        href, label = m.group(1), re.sub(r"<[^>]+>", " ", m.group(2))
        label = re.sub(r"\s+", " ", label).strip()
        if hrx and not hrx.search(href):
            continue
        if not label or not rx.search(label):
            continue
        # Mission files aggregate "Year to Date" summaries under the same path
        # shape as its per-permit month-end reports.
        if erx and erx.search(label):
            continue
        url = urljoin(index_url, href)
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def page_rows(pdf_bytes: bytes, y_tol: float = 2.5) -> list[Line]:
    """Every page's words, grouped into visual lines, left to right.

    Lines are keyed on the vertical midpoint so that a superscript or a
    slightly taller glyph does not split one visual line into two.
    """
    import io

    import pdfplumber

    lines: list[Line] = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for pno, page in enumerate(pdf.pages):
            buckets: dict[int, list[Word]] = {}
            for w in page.extract_words():
                key = int((w["top"] + w["bottom"]) / 2 / y_tol)
                buckets.setdefault(key, []).append(
                    Word(w["x0"], w["x1"], w["text"]))
            for key in sorted(buckets):
                ws = sorted(buckets[key], key=lambda w: w.x0)
                lines.append(Line(pno, key * y_tol, ws))
    return lines


def band(line: Line, lo: float, hi: float) -> str:
    """Text of the words whose left edge falls inside [lo, hi)."""
    return " ".join(w.text for w in line.words if lo <= w.x0 < hi).strip()


def row_text(line: Line) -> str:
    return line.text


def group_nearest(lines: list[Line], is_anchor,
                  max_above: float = 14, max_below: float = 60) -> list[list[Line]]:
    """Group lines around anchor lines, assigning each line to its nearest one.

    Used where a record is identified by one distinctive line (the permit
    number) but its other fields wrap onto neighbouring lines, above as well
    as below. Assignment is per page so a record never absorbs rows from the
    next page's header.

    The distance bounds matter more than they look. A wrapped address sits
    about one line above its permit row, while the page title and column
    headings sit much further up -- without `max_above` every page's furniture
    lands in whichever record happens to be nearest the top of that page.
    """
    anchors = [i for i, ln in enumerate(lines) if is_anchor(ln)]
    if not anchors:
        return []
    groups: list[list[Line]] = [[] for _ in anchors]
    for ln in lines:
        best, best_d = None, None
        for gi, ai in enumerate(anchors):
            if lines[ai].page != ln.page:
                continue
            d = ln.top - lines[ai].top          # negative == above the anchor
            if best_d is None or abs(d) < abs(best_d):
                best, best_d = gi, d
        if best is None:
            continue
        if best_d < -max_above or best_d > max_below:
            continue
        groups[best].append(ln)
    return [g for g in groups if g]


def split_before(lines: list[Line], is_header) -> list[list[Line]]:
    """Split into blocks that each begin at a header line.

    Used where the report prints a repeating column header above every record,
    which is a far more reliable delimiter than any single field.
    """
    blocks: list[list[Line]] = []
    cur: list[Line] | None = None
    for ln in lines:
        if is_header(ln):
            if cur:
                blocks.append(cur)
            cur = []
            continue
        if cur is not None:
            cur.append(ln)
    if cur:
        blocks.append(cur)
    return blocks


def _norm(tok: str) -> str:
    # "#" survives normalization: Mission heads its permit-number column with
    # it alone, and stripping it leaves an empty key that matches nothing.
    return re.sub(r"[^a-z#]", "", tok.lower())


def find_header(lines: list[Line], required: list[str],
                merge_above: bool = True,
                merge_below: bool = False) -> tuple[Line, dict[str, float]] | None:
    """Locate the table's header row and the x position of each column label.

    Column positions are read from the report itself rather than hard-coded,
    because these cities re-style their reports without notice: Richmond's 2026
    generation renamed every header and moved every column, which silently
    produced zero rows against fixed offsets. Deriving the geometry from the
    header means a restyle keeps working as long as the labels survive.

    `merge_above` folds in the preceding line, since several reports stack a
    two-line header ("Occupancy" above "Type"). Delta stacks the other way --
    "Issued / Permit / Builder" with "Date / Number / Area" underneath -- so
    `merge_below` covers that.
    """
    need = [_norm(r) for r in required]
    for i, ln in enumerate(lines):
        toks = {_norm(w.text) for w in ln.words}
        if not all(any(n == t or t.startswith(n) for t in toks) for n in need):
            continue
        words = list(ln.words)
        if merge_above and i > 0 and abs(lines[i - 1].top - ln.top) < 26:
            words += lines[i - 1].words
        if merge_below and i + 1 < len(lines) and abs(lines[i + 1].top - ln.top) < 26:
            words += lines[i + 1].words
        # Repeated labels are recorded as "contractor", "contractor2", ... so a
        # spec can bound a column by the *second* occurrence -- North
        # Vancouver's header carries "Contractor" and "Contractor Address".
        pos: dict[str, float] = {}
        counts: dict[str, int] = {}
        for w in sorted(words, key=lambda w: w.x0):
            key = _norm(w.text)
            if not key:
                continue
            counts[key] = counts.get(key, 0) + 1
            pos[key if counts[key] == 1 else f"{key}{counts[key]}"] = w.x0
        return ln, pos
    return None


class UnreadablePDF(RuntimeError):
    """The PDF carries no extractable text.

    Two causes in practice: a font with no ToUnicode map (Richmond), or a
    scanned image with no text layer at all (about half of Chilliwack's weekly
    reports). Neither is recoverable without OCR.
    """


class NotAPermitReport(RuntimeError):
    """A valid report, but an aggregate summary with no per-permit rows.

    Richmond files these under the same name prefix as its per-permit reports,
    so they can only be told apart by content. Treated as "skipped", not
    "failed" -- counting them as failures would hide real breakage.
    """


def check_readable(lines: list[Line]) -> None:
    """Reject PDFs whose glyphs decode to (cid:N) rather than characters.

    A handful of Richmond's reports embed a subsetted font with no ToUnicode
    map, so every character extracts as its raw glyph id. Nothing downstream
    can recover that without OCR, and it is worth naming precisely rather than
    letting it surface as "no recognisable column header".
    """
    if not lines or sum(len(ln.words) for ln in lines[:40]) < 5:
        raise UnreadablePDF("no text layer (scanned image); OCR would be required")
    sample = " ".join(ln.text for ln in lines[:40])
    if sample.count("(cid:") > 20:
        raise UnreadablePDF("text not extractable (font lacks a ToUnicode map)")


def bands_from(pos: dict[str, float], columns: list,
               optional: set[str] | None = None,
               page_width: float = 9999) -> dict[str, tuple[float, float]] | None:
    """Turn header label positions into (lo, hi) bands, in left-to-right order.

    `columns` is [(field, [candidate label tokens])] or
    [(field, [tokens], "mid")]; the first token found wins, so one spec can
    cover a report whose labels were renamed between generations.

    The optional "mid" flag controls where this column *ends*. Text columns run
    up to the next header's left edge, because their content is left-aligned
    and can be wider than the gap between labels -- Richmond's folder number
    ("25 026609 000 00") spills well past the midpoint and would be truncated.
    Right-aligned columns (money) and columns whose data sits left of its own
    header instead split at the midpoint, which is the only boundary that keeps
    a dollar amount and the street number after it apart.
    """
    found: list[tuple[str, float, bool]] = []
    for spec in columns:
        field, tokens = spec[0], spec[1]
        mid = len(spec) > 2 and spec[2] == "mid"
        # Try the literal token first: the ordinal suffix in "CONTRACTOR2"
        # would be stripped by _norm and collapse back onto the first
        # occurrence, silently producing a zero-width band.
        x = next((pos[t.lower()] if t.lower() in pos else pos[_norm(t)]
                  for t in tokens if t.lower() in pos or _norm(t) in pos), None)
        if x is None:
            # Some report families legitimately omit a column -- Richmond's
            # demolition reports carry no construction value at all.
            if field in (optional or set()):
                continue
            return None
        found.append((field, x, mid))
    found.sort(key=lambda f: f[1])
    # Split on the midpoint between adjacent header labels rather than on the
    # label's own left edge. Columns are not uniformly aligned -- money is
    # right-aligned under its header while text starts left of it -- so a
    # left-edge boundary pulls the next column's first token into the money
    # band. The midpoint tolerates both alignments.
    PAD = 6.0
    edges = [0.0]
    for i in range(len(found) - 1):
        x, nxt, mid = found[i][1], found[i + 1][1], found[i][2]
        # The same pad applies to midpoints: in Richmond's older layout the
        # money string ends exactly where the street number begins, and an
        # unpadded midpoint lands one point to the right of it.
        edges.append((x + nxt) / 2 - PAD if mid else nxt - PAD)
    edges.append(page_width)
    return {found[i][0]: (edges[i], edges[i + 1]) for i in range(len(found))}


def fetch_pdf(url: str) -> bytes:
    log.info("    %s", url.rsplit("/", 1)[-1])
    return get_bytes(url)
