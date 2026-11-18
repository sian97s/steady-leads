"""Per-city PDF report parsers.

Each city gets its own reader because the layouts are genuinely different.
What they share is the x-band approach from pdf_base: find the column
boundaries once, then read each field out of its own band.

Column boundaries were measured from real reports; they are recorded as
named constants so that when a city re-styles its report the fix is obvious.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime

import classify
from pdf_base import (NotAPermitReport, UnreadablePDF, band, bands_from,
                      check_readable,
                      discover, discover_labeled, fetch_pdf, find_header,
                      group_nearest, page_rows, row_text, split_before)
from schema import Permit, clean_str, parse_date, parse_value

log = logging.getLogger(__name__)

MONEY = re.compile(r"\$?\s?([\d,]+(?:\.\d{2})?)")

# Page furniture -- titles, column headings, filter echoes. Nearest-anchor
# grouping would otherwise fold these into whichever record sits closest to
# the top of the page.
FURNITURE = re.compile(
    r"^(City of |Report$|Issued Building|Permits Issued|Building Permits Issued|"
    r"Permit Number|People Name|Folder|Property|Est |Type$|Status$|Desc$|"
    r"Occupancy|Construction|Site Address|Legal Description|Current /|"
    r"FOLDER NUMBER|Filters|ISSUED |SUB TYPE|Run Type|Issued Between|"
    r"\$Construction|Number$|Value$|Date$|Permit$|Work$)", re.I)


def _is_furniture(text: str) -> bool:
    return not text or bool(FURNITURE.match(text.strip()))


def _money(text: str) -> int | None:
    m = MONEY.search(text or "")
    return parse_value(m.group(1)) if m else None


# --------------------------------------------------------------------------
# Burnaby -- one PDF per business day, rolling ~1 year.
# Record blocks keyed on the permit number; label rows split the sub-sections.
# --------------------------------------------------------------------------

BBY_ADDR, BBY_LEGAL, BBY_PERMIT, BBY_TYPE, BBY_VALUE = 0, 166, 310, 400, 495
# 3-4 letters: BLD26-00599, BYL..., and DEMO25-00210. A 3-letter-only pattern silently
# dropped every demolition permit (2026-11 merge audit).
BBY_PERMIT_RX = re.compile(r"\b([A-Z]{3,4}\d{2}-\d{4,6})\b")
BBY_DATE_RX = re.compile(r"Permits Issued On:\s*(.+)", re.I)


def burnaby(cfg: dict) -> list[Permit]:
    urls = discover(cfg["index_url"], r"/\w+-\d+-\d{4}\.pdf$")
    log.info("  %d daily reports listed", len(urls))
    return _harvest(cfg, urls, _burnaby_parse,
                    stored_count=cfg.get("_stored", -1))


def _burnaby_parse(lines, cfg, url) -> list[Permit]:
    issued = None
    for ln in lines[:6]:
        m = BBY_DATE_RX.search(ln.text)
        if m:
            issued = parse_date(
                _try_dates(m.group(1).strip(), ["%B %d, %Y", "%b %d, %Y"]))
            break

    # Every record is preceded by this two-line column header; the second line
    # is a far more reliable delimiter than the permit number, whose row does
    # not always carry the first line of the address.
    blocks = split_before(lines, lambda ln: ln.text.startswith("Current /"))

    permits = []
    for block in blocks:
        rec = {"permit": None, "addr": [], "type": [], "value": [],
               "applicant": [], "contractor": [], "desc": []}
        section = "head"
        for ln in block:
            text = ln.text
            if not text or text.startswith(("Site Address", "Legal Description")):
                continue
            if text.startswith("Applicant Name"):
                section = "applicant"; continue
            if text.startswith("Contractor Name"):
                section = "contractor"; continue
            if text.startswith("Description"):
                section = "desc"; continue

            if rec["permit"] is None:
                pm = BBY_PERMIT_RX.search(band(ln, BBY_PERMIT, BBY_TYPE))
                if pm:
                    rec["permit"] = pm.group(1)

            if section == "head":
                rec["addr"].append(band(ln, BBY_ADDR, BBY_LEGAL))
                rec["type"].append(band(ln, BBY_TYPE, BBY_VALUE))
                rec["value"].append(band(ln, BBY_VALUE, 9999))
            elif section == "applicant":
                rec["applicant"].append(band(ln, BBY_ADDR, BBY_LEGAL))
            elif section == "contractor":
                # Name sits left of ~300, the contractor's own address right of it.
                rec["contractor"].append(band(ln, BBY_ADDR, 300))
            elif section == "desc":
                rec["desc"].append(text)

        if rec["permit"]:
            permits.append(_burnaby_build(rec, issued, cfg))
    # The city occasionally leaves its own system-test rows in the report ("EnerGov Test ONLY").
    return [p for p in permits if p and not re.search(r"\btest only\b", p.description or "", re.I)]


# The legal description occasionally bleeds into the address column, giving
# "210 - 2250 LOT: BOUNDARY RD PLAN: 1310-3708. M5" where the civic address is
# "210 - 2250 BOUNDARY RD". Left in, the geocoder fuzzy-matches the noise.
# No leading word boundary: the marker sometimes runs straight onto the end of
# the street name ("HOLDOM AVE NLOT:"), where \b would refuse to match.
BBY_LEGAL_NOISE = re.compile(r"(?:DISTRICT\s+)?LOT:\s*", re.I)
BBY_LEGAL_TAIL = re.compile(r"\b(?:PLAN|PID|TOGETHER|EXCEPT|GROUP)\b.*$", re.I)


def _clean_burnaby_address(text: str | None) -> str | None:
    if not text:
        return None
    text = BBY_LEGAL_NOISE.sub("", text)
    text = BBY_LEGAL_TAIL.sub("", text)
    return clean_str(text)


def _burnaby_build(rec, issued, cfg) -> Permit | None:
    types_block = " ".join(t for t in rec["type"] if t)
    return Permit(
        source_city=cfg["city"],
        permit_id=rec["permit"],
        record_type=cfg["record_type"],
        issue_date=issued,
        address=_clean_burnaby_address(" ".join(a for a in rec["addr"] if a)),
        work_type=classify.work_type(types_block),
        use_class=classify.use_class(types_block),
        value=_money(" ".join(rec["value"])),
        applicant=clean_str(" ".join(rec["applicant"])),
        contractor=clean_str(" ".join(rec["contractor"])),
        description=clean_str(" ".join(rec["desc"])),
        raw={"permit": rec["permit"], "type_block": types_block,
             "value_block": " ".join(rec["value"]),
             "address_block": " ".join(rec["addr"]),
             "applicant": " ".join(rec["applicant"]),
             "contractor": " ".join(rec["contractor"]),
             "description": " ".join(rec["desc"]), "issued": issued},
    )


# --------------------------------------------------------------------------
# Richmond -- monthly + weekly "bldg" and "demo" issuance reports.
# --------------------------------------------------------------------------

# Labels differ between report generations ("FOLDER NUMBER" vs
# "FOLDER_NUMBER"), so each column lists every spelling seen.
RCH_COLUMNS = [
    ("folder", ["FOLDER", "FOLDERNUMBER"]),
    ("work", ["WORK", "WORKPROPOSED"]),
    ("status", ["STATUS"]),
    # Also mid: on demolition reports the value column is absent, leaving a
    # wide gap in which the address sits far left of its own header.
    ("date", ["ISSUE", "ISSUEDATE"], "mid"),
    # These three end at the midpoint: the money column is right-aligned, and
    # in the 2026 generation the name and applicant data start left of their
    # own headers.
    ("value", ["CONSTR", "CONSTRVALUE"], "mid"),
    ("name", ["FOLDERNAME", "NAME"], "mid"),
    ("applicant", ["APPLICANT"], "mid"),
    ("contractor", ["CONTRACTOR"]),
]
RCH_FOLDER_RX = re.compile(r"^(\d{2})\D{0,3}(\d{4,6})\b")
RCH_FULL_RX = re.compile(r"(\d{2})\D{0,3}(\d{4,6})\D{0,3}(\d{3})\D{0,3}(\d{2})")
RCH_SUBTYPE_RX = re.compile(r"SUB.?TYPE:\s*(.+)", re.I)


def richmond(cfg: dict) -> list[Permit]:
    urls = []
    for idx in cfg["index_urls"]:
        urls += discover(idx, r"/(bldg|demo|building|demolition)[a-z0-9\-]*\.pdf$")
    urls = [u for u in urls if "bldgsum" not in u.lower()]
    log.info("  %d issuance reports listed", len(urls))
    return _harvest(cfg, urls, _richmond_parse,
                    stored_count=cfg.get("_stored", -1))


def _richmond_parse(lines, cfg, url) -> list[Permit]:
    check_readable(lines)
    head = " ".join(ln.text for ln in lines[:6])
    # Summary reports share the "bldg"/"buildingreport" name prefix but hold
    # aggregate counts by category, not individual permits.
    if re.search(r"Issuance Summary Report|COL_1\s+COL_2", head, re.I):
        raise NotAPermitReport("aggregate summary, not a per-permit report")
    if re.search(r"No results returned", " ".join(ln.text for ln in lines[:8]), re.I):
        raise NotAPermitReport("report states 'No results returned' (nothing issued that week)")
    hdr = find_header(lines, ["FOLDER", "STATUS", "APPLICANT", "CONTRACTOR"])
    if not hdr:
        raise RuntimeError("no recognisable column header")
    # Demolition reports omit the construction value column entirely.
    bands = bands_from(hdr[1], RCH_COLUMNS, optional={"value"})
    if not bands:
        raise RuntimeError("header found but columns incomplete")

    subtype_at = []
    for ln in lines:
        m = RCH_SUBTYPE_RX.search(ln.text)
        if m:
            subtype_at.append((ln.page, ln.top, clean_str(m.group(1))))

    def sub_for(ln):
        best = None
        for page, top, val in subtype_at:
            if page < ln.page or (page == ln.page and top <= ln.top):
                best = val
        return best

    def is_row(ln):
        return bool(RCH_FOLDER_RX.match(band(ln, *bands["folder"])))

    permits = []
    for group in group_nearest(lines, is_row, max_above=12, max_below=26):
        anchor = next(ln for ln in group if is_row(ln))
        rec = {k: [] for k in ("folder", "work", "date", "value",
                               "name", "applicant", "contractor")}
        rec["subtype"] = sub_for(anchor)
        for ln in group:
            if _is_furniture(ln.text):
                continue
            for key in ("folder", "work", "date", "value",
                        "name", "applicant", "contractor"):
                if key in bands:
                    rec[key].append(band(ln, *bands[key]))
        permits.append(_richmond_build(rec, cfg))
    return [p for p in permits if p]


def _richmond_build(cur, cfg) -> Permit | None:
    joined = lambda k: " ".join(x for x in cur[k] if x).strip()  # noqa: E731
    name = joined("name")
    work = joined("work")
    # "6500 Minoru Boulevard - Firestopping" and
    # "8671 Hazelbridge Way--Galleria #2": address first, purpose after. The
    # double-dash form has no surrounding spaces, so a plain " - " split leaves
    # the purpose text in the address and sends the geocoder wandering.
    parts = re.split(r"\s*--+\s*|\s+-\s+", name, maxsplit=1)
    address = parts[0]
    extra = parts[1] if len(parts) > 1 else ""
    # The 2026 generation splits the folder number and the issue date across
    # two lines ("2026/06" then "/26"), so both are matched on de-spaced text.
    # Richmond's reports are generated with "INCLUDE TEST FOLDERS? = No", but a
    # few test rows leak through anyway and geocode to wherever the dummy text
    # lands. They are not permits.
    if re.match(r"\s*TEST(POP|ING)?\b", name, re.I):
        return None

    folder_flat = re.sub(r"\s+", " ", joined("folder"))
    fm = RCH_FULL_RX.search(folder_flat) or RCH_FOLDER_RX.match(folder_flat)
    if not fm:
        return None
    permit_id = "-".join(fm.groups())
    date_txt = re.sub(r"\s+", "", joined("date"))
    dm = re.search(r"\d{4}/\d{2}/\d{2}", date_txt)

    return Permit(
        source_city=cfg["city"],
        permit_id=permit_id,
        record_type=cfg["record_type"],
        issue_date=parse_date(dm.group(0).replace("/", "-")) if dm else None,
        address=clean_str(address),
        work_type=classify.work_type(work, extra),
        use_class=classify.use_class(cur["subtype"] or "", extra),
        value=_money(joined("value")),
        applicant=clean_str(re.sub(r"\(\d{3}\)[\d\-]+", "", joined("applicant"))),
        contractor=clean_str(re.sub(r"\(\d{3}\)[\d\-]+", "", joined("contractor"))),
        description=clean_str(extra or work),
        raw={"folder": permit_id, "sub_type": cur["subtype"], "work": work,
             "folder_name": name, "value": joined("value"), "date": date_txt,
             "applicant": joined("applicant"), "contractor": joined("contractor")},
    )


# --------------------------------------------------------------------------
# Coquitlam -- a single "current" PDF, refreshed monthly.
# Only permits over $200,000 are published.
# --------------------------------------------------------------------------

COQ_PERMIT, COQ_FOLDER, COQ_ADDR = 18, 330, 392
COQ_VALUE, COQ_STATUS, COQ_SUB, COQ_WORK, COQ_DATE = 480, 552, 590, 650, 722
COQ_ROW_RX = re.compile(r"^(\d{2})\s+(\d{5,6})\s+(\d{2})\b")


def coquitlam(cfg: dict) -> list[Permit]:
    return _harvest(cfg, [cfg["url"]], _coquitlam_parse, always_refetch=True)


def _coquitlam_parse(lines, cfg, url) -> list[Permit]:
    def is_row(ln):
        return bool(COQ_ROW_RX.match(band(ln, COQ_PERMIT, COQ_FOLDER)))

    permits = []
    for group in group_nearest(lines, is_row, max_above=10, max_below=48):
        anchor = next(ln for ln in group if is_row(ln))
        m = COQ_ROW_RX.match(band(anchor, COQ_PERMIT, COQ_FOLDER))
        rec = {"permit": "-".join(m.groups()), "folder": [], "addr": [],
               "value": [], "sub": [], "work": [], "date": [], "people": []}
        for ln in group:
            text = ln.text
            if _is_furniture(text):
                continue
            rec["folder"].append(band(ln, COQ_FOLDER, COQ_ADDR))
            rec["addr"].append(band(ln, COQ_ADDR, COQ_VALUE))
            rec["value"].append(band(ln, COQ_VALUE, COQ_STATUS))
            rec["sub"].append(band(ln, COQ_SUB, COQ_WORK))
            rec["work"].append(band(ln, COQ_WORK, COQ_DATE))
            rec["date"].append(band(ln, COQ_DATE, 9999))
            if text.startswith("Contractor"):
                # Strip the trailing "Primary :" role marker the report appends.
                rec["people"].append(
                    re.sub(r",?\s*(Primary|Secondary)\s*:?\s*$", "",
                           band(ln, 60, COQ_FOLDER)))
        permits.append(_coquitlam_build(rec, cfg))
    return [p for p in permits if p]


def _coquitlam_build(cur, cfg) -> Permit | None:
    joined = lambda k: " ".join(x for x in cur[k] if x).strip()  # noqa: E731
    folder, work, sub = joined("folder"), joined("work"), joined("sub")
    dm = re.search(r"\d{2}/\d{2}/\d{2}", joined("date"))
    return Permit(
        source_city=cfg["city"],
        permit_id=cur["permit"],
        record_type=cfg["record_type"],
        issue_date=parse_date(_try_dates(dm.group(0), ["%m/%d/%y"])) if dm else None,
        address=clean_str(joined("addr")),
        work_type=classify.work_type(work, folder),
        use_class=classify.use_class(folder, sub),
        value=_money(joined("value")),
        contractor=clean_str(joined("people")),
        description=clean_str(f"{sub} {work}".strip()),
        raw={"permit": cur["permit"], "folder_type": folder, "sub_code": sub,
             "work_code": work, "address": joined("addr"),
             "value": joined("value"), "date": joined("date"),
             "people": joined("people")},
    )


# --------------------------------------------------------------------------
# City of North Vancouver -- one monthly "Issued Building Permit(s) Report".
# --------------------------------------------------------------------------

# North Vancouver changed its report wholesale around 2020: the modern one is
# "Permit Number / Site Address / Occupancy", the older one "Case # / Location
# Address / Bldg Type". Both are supported; each report picks whichever header
# it matches.
CNV_MODERN = [
    ("permit", ["PERMIT"]),
    ("address", ["SITE"]),
    ("occ", ["OCCUPANCY"]),
    ("work", ["WORK"]),
    ("value", ["CONSTRUCTION"], "mid"),
    ("issued", ["DATE"]),
    ("received", ["DATE2"]),
    ("contractor", ["CONTRACTOR"]),
    ("caddr", ["CONTRACTOR2"]),
]
CNV_LEGACY = [
    ("permit", ["CASE"]),
    ("address", ["LOCATION"]),
    ("occ", ["BLDG"]),
    ("work", ["WORK"]),
    ("value", ["VALUE"], "mid"),
    # The column headed "Elapsed days" actually carries the issued date on the
    # record's first line and the received date underneath it.
    ("issued", ["ELAPSED"]),
    ("contractor", ["CONTRACTOR"]),
    ("applicant", ["APPLICANT"]),
]
# A third generation heads the permit column "APNO" and puts every label on a
# single line. Same fields as the modern report, different spellings.
CNV_APNO = [
    ("permit", ["APNO"]),
    ("address", ["SITE"]),
    ("occ", ["OCCUPANCY"]),
    ("work", ["WORK"]),
    ("value", ["CONST", "CONSTRUCTION"], "mid"),
    ("issued", ["DATE"]),
    ("received", ["DATE2"]),
    ("contractor", ["CONTRACTOR"]),
    ("caddr", ["CONTRACTOR2"]),
]
CNV_VARIANTS = [
    (["APNO", "SITE", "CONTRACTOR"], CNV_APNO),
    (["PERMIT", "SITE", "CONTRACTOR"], CNV_MODERN),
    (["CASE", "LOCATION", "CONTRACTOR"], CNV_LEGACY),
]
# Not every generation carries these; the rest are required.
CNV_OPTIONAL = {"received", "caddr"}
CNV_PERMIT_RX = re.compile(r"\b((?:BLD|BP)\d{4}-\d{3,5})\b")


def north_vancouver_city(cfg: dict) -> list[Permit]:
    urls = discover(cfg["index_url"], r"Issued-Building-Permits?-Report\.pdf$")
    log.info("  %d monthly reports listed", len(urls))
    return _harvest(cfg, urls, _cnv_parse,
                    stored_count=cfg.get("_stored", -1))


def _cnv_parse(lines, cfg, url) -> list[Permit]:
    check_readable(lines)
    bands = None
    for required, columns in CNV_VARIANTS:
        hdr = find_header(lines, required)
        if hdr:
            bands = bands_from(hdr[1], columns, optional=CNV_OPTIONAL)
            if bands:
                break
    if not bands:
        raise RuntimeError("no recognisable column header")

    def is_row(ln):
        return bool(CNV_PERMIT_RX.search(band(ln, *bands["permit"])))

    permits = []
    for group in group_nearest(lines, is_row, max_above=13, max_below=30):
        anchor = next(ln for ln in group if is_row(ln))
        pm = CNV_PERMIT_RX.search(band(anchor, *bands["permit"]))
        rec = {"permit": pm.group(1), "addr": [], "occ": [], "work": [],
               "value": [], "contractor": []}
        for ln in group:
            if _is_furniture(ln.text):
                continue
            for key in ("addr", "occ", "work", "value", "contractor"):
                src = {"addr": "address"}.get(key, key)
                if src in bands:
                    rec[key].append(band(ln, *bands[src]))
        # Only the anchor line's date is the issue date -- the received date
        # sits in the same column one line down.
        rec["issued"] = band(anchor, *bands["issued"])
        permits.append(_cnv_build(rec, cfg))
    return [p for p in permits if p]


def _cnv_build(cur, cfg) -> Permit | None:
    joined = lambda k: " ".join(x for x in cur[k] if x).strip()  # noqa: E731
    occ, work = joined("occ"), joined("work")
    issued = cur["issued"]
    # Modern reports write "Jul 3, 2026"; the pre-2020 ones write "4/30/2019".
    dm = re.search(r"([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})", issued)
    if dm:
        date = _try_dates(f"{dm.group(1)} {dm.group(2)} {dm.group(3)}", ["%b %d %Y"])
    else:
        sm = re.search(r"(\d{1,2}/\d{1,2}/\d{4})", issued)
        date = _try_dates(sm.group(1), ["%m/%d/%Y"]) if sm else None
    return Permit(
        source_city=cfg["city"],
        permit_id=cur["permit"],
        record_type=cfg["record_type"],
        issue_date=date,
        address=clean_str(joined("addr")),
        work_type=classify.work_type(work),
        use_class=classify.use_class(occ),
        value=_money(joined("value")),
        contractor=clean_str(joined("contractor")),
        description=clean_str(f"{occ} {work}".strip()),
        raw={"permit": cur["permit"], "occupancy": occ, "work": work,
             "address": joined("addr"), "value": joined("value"),
             "issued": issued, "contractor": joined("contractor")},
    )


# --------------------------------------------------------------------------
# Delta -- weekly "Building Permits BCA Submittal" reports. Only the weekly
# links carry per-permit rows; the monthly ones are aggregate highlights.
# --------------------------------------------------------------------------

DELTA_COLUMNS = [
    ("date", ["ISSUED"]),
    ("permit", ["PERMIT"]),
    ("builder", ["BUILDER"]),
    ("area", ["AREA"], "mid"),
    ("value", ["VALUE"], "mid"),
]
DELTA_PERMIT_RX = re.compile(r"\b([A-Z]{2}\d{5,6})\b")
DELTA_DATE_RX = re.compile(r"([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})")


def delta(cfg: dict) -> list[Permit]:
    urls = discover_labeled(cfg["index_url"], r"^Week of\b")
    log.info("  %d weekly reports listed", len(urls))
    return _harvest(cfg, urls, _delta_parse,
                    stored_count=cfg.get("_stored", -1))


def _delta_parse(lines, cfg, url) -> list[Permit]:
    check_readable(lines)
    hdr = find_header(lines, ["ISSUED", "PERMIT", "BUILDER"],
                      merge_above=False, merge_below=True)
    if not hdr:
        raise RuntimeError("no recognisable column header")
    bands = bands_from(hdr[1], DELTA_COLUMNS)
    if not bands:
        raise RuntimeError("header found but columns incomplete")

    def is_row(ln):
        return bool(DELTA_PERMIT_RX.search(band(ln, *bands["permit"]))
                    and DELTA_DATE_RX.search(band(ln, *bands["date"])))

    groups: list[list] = []
    sink: list | None = None
    for ln in lines:
        if is_row(ln):
            groups.append([ln])
            sink = groups[-1]
        elif DELTA_DATE_RX.match(band(ln, *bands["date"])) and re.search(r"\b[A-Z]{2,4}\d{4,6}\b", band(ln, *bands["permit"])):
            sink = []        # a plumbing/other permit row (PBG14434): its lines must not leak into the building permit above
        elif sink is not None:
            sink.append(ln)

    permits = []
    for group in groups:
        anchor = group[0]
        pm = DELTA_PERMIT_RX.search(band(anchor, *bands["permit"]))
        dm = DELTA_DATE_RX.search(band(anchor, *bands["date"]))
        rec = {"permit": pm.group(1),
               "date": _try_dates(f"{dm.group(1)} {dm.group(2)} {dm.group(3)}",
                                  ["%b %d %Y"]) if dm else None,
               "builder": band(anchor, *bands["builder"]),
               "value": band(anchor, *bands["value"]),
               "type": [], "purpose": [], "address": []}
        for ln in group[1:]:
            text = ln.text
            # A second builder line directly under the permit row (owner above, company below).
            if (not rec["type"] and 0 < ln.top - anchor.top < 16 and ln.page == anchor.page
                    and not text.startswith(("Type", "Purpose", "Folio"))):
                extra = band(ln, *bands["builder"])
                if extra and extra == text:
                    company = r"\b(LTD|INC|CORP|HOMES|CONSTRUCTION|DEVELOPMENTS?|CONTRACTING|BUILDERS?)\b"
                    rec["builder"] = extra if re.search(company, extra, re.I) and not re.search(company, rec["builder"], re.I) \
                        else rec["builder"] or extra
                continue
            if text.startswith("Type"):
                rec["type"].append(text[4:].strip())
            elif text.startswith("Purpose"):
                rec["purpose"].append(text[7:].strip())
            elif "Civic Address:" in text:
                rec["address"].append(text.split("Civic Address:", 1)[1].strip())
        permits.append(_delta_build(rec, cfg))
    return [p for p in permits if p]


def _delta_build(rec, cfg) -> Permit | None:
    joined = lambda k: " ".join(x for x in rec[k] if x).strip()  # noqa: E731
    kind, purpose = joined("type"), joined("purpose")
    # The civic address repeats across the folio lines, sometimes with a unit
    # prefix ("6 3800 72 ST") and sometimes without ("3800 72 ST"). Keep the
    # fullest form of each and drop the ones it already contains.
    #
    # Note: no attempt is made to strip a leading unit number. Delta's streets
    # are themselves numbered, so "3800 72 ST" is house 3800 on 72 ST -- a rule
    # that removes a number before a number would delete the house number.
    seen_a = []
    for a in rec["address"]:
        a = clean_str(a)
        if a:
            seen_a.append(a)
    addrs = []
    for a in sorted(set(seen_a), key=len, reverse=True):
        if not any(a != b and a in b for b in addrs):
            addrs.append(a)
    return Permit(
        source_city=cfg["city"],
        permit_id=rec["permit"],
        record_type=cfg["record_type"],
        issue_date=rec["date"],
        address=clean_str("; ".join(addrs)),
        work_type=classify.work_type(purpose, kind),
        use_class=classify.use_class(kind, purpose),
        value=_money(rec["value"]),
        contractor=clean_str(rec["builder"]),
        description=clean_str(purpose or kind),
        raw={"permit": rec["permit"], "type": kind, "purpose": purpose,
             "builder": rec["builder"], "value": rec["value"],
             "addresses": addrs, "issued": rec["date"]},
    )


# --------------------------------------------------------------------------


def _try_dates(text: str, formats: list[str]) -> str | None:
    for fmt in formats:
        try:
            return datetime.strptime(text.strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _harvest(cfg, urls, parse, always_refetch: bool = False,
             stored_count: int = -1) -> list[Permit]:
    """Download each report we have not already parsed and normalize it.

    Published reports are immutable, so a URL seen on a previous run is skipped
    -- that is what keeps a daily run to a handful of requests instead of 269.
    A single failed report is logged and skipped; it must not cost us the city.
    """
    from pdf_base import load_seen, save_seen

    seen = load_seen()
    city = cfg["city"]
    seen.setdefault(city, {})

    # The cache records that a URL was parsed; the store holds what came out of
    # it. If the cache claims work but the store has nothing, the cache is
    # lying -- which is exactly what happened when two runs raced and one
    # overwrote the other's shards. Trust the store and re-fetch.
    if stored_count == 0 and seen[city]:
        log.warning("  %d reports cached but no records stored; re-reading them",
                    len(seen[city]))
        seen[city] = {}
    permits, fetched, skipped, failed, empty, not_permits = [], 0, 0, 0, 0, 0
    budget = cfg.get("pdf_budget", 60)

    for url in urls:
        if not always_refetch and url in seen[city]:
            skipped += 1
            continue
        if fetched >= budget:
            log.info("  pdf budget reached; %d reports deferred to next run",
                     len(urls) - skipped - fetched)
            break
        try:
            rows = page_rows(fetch_pdf(url))
            got = parse(rows, cfg, url)
        except (NotAPermitReport, UnreadablePDF) as e:
            # Both are permanent properties of the file, not transient errors:
            # a summary report will never contain permits and a font with no
            # ToUnicode map will never gain one. Remember them so we do not
            # re-download the same dead weight every morning.
            log.info("    skipped: %s (%s)", url.rsplit("/", 1)[-1], e)
            seen[city][url] = {"records": 0, "skipped": str(e)}
            not_permits += 1
            continue
        except Exception as e:                       # noqa: BLE001
            log.warning("    failed: %s (%s)", url.rsplit("/", 1)[-1], e)
            failed += 1
            continue
        if not got:
            # A report that parses to nothing is almost always a layout change,
            # not an empty month. Say so rather than silently banking a zero.
            log.warning("    no records: %s", url.rsplit("/", 1)[-1])
            empty += 1
        permits += got
        seen[city][url] = {"records": len(got)}
        fetched += 1

    save_seen(seen)
    log.info("  %d reports parsed (%d cached, %d not permit reports, "
             "%d failed, %d empty) -> %d permits",
             fetched, skipped, not_permits, failed, empty, len(permits))
    if empty and fetched and empty / fetched > 0.3:
        log.warning("  %d/%d reports yielded nothing -- check the layout",
                    empty, fetched)
    return permits


# --------------------------------------------------------------------------
# Chilliwack -- weekly "Building Permits Front Counter Report by Issued Date".
# Tempest-generated, with category headings (MULTI-FAMILY, SINGLE FAMILY...)
# that apply to every row beneath them.
# --------------------------------------------------------------------------

CWK_COLUMNS = [
    ("code", ["CODE", "REPORT"]),
    ("permit", ["NUMBER", "FOLDER"]),
    ("status", ["STATUS"]),
    ("date", ["DATE", "ISSUED"], "mid"),
    ("address", ["CIVIC"], "mid"),
    ("applicant", ["APPLICANT"], "mid"),
    ("value", ["VALUE", "BUILDING"]),
]
CWK_PERMIT_RX = re.compile(r"\b([A-Z]{2}\d{4,7})\b")
# Chilliwack's report runs the house number straight into the street name
# ("46723YALE RD"). The geocoder cannot match that at all -- it returns nothing
# for every single address until the space is restored. Two or more letters are
# required so unit suffixes like "12A" survive.
CWK_RUNON_RX = re.compile(r"^(\d+)([A-Za-z]{2,})")
CWK_CATEGORY_RX = re.compile(r"^[A-Z][A-Z &/\-]{3,}$")


def chilliwack(cfg: dict) -> list[Permit]:
    urls = discover_labeled(cfg["index_url"], r"Issued\s+Permits",
                            href_pattern=r"attachView\.cfm\?attachID=\d+")
    log.info("  %d weekly reports listed", len(urls))
    return _harvest(cfg, urls, _chilliwack_parse,
                    stored_count=cfg.get("_stored", -1))


def _chilliwack_parse(lines, cfg, url) -> list[Permit]:
    check_readable(lines)
    hdr = find_header(lines, ["CODE", "NUMBER", "STATUS", "CIVIC"], merge_above=True)
    if not hdr:
        raise RuntimeError("no recognisable column header")
    bands = bands_from(hdr[1], CWK_COLUMNS)
    if not bands:
        raise RuntimeError("header found but columns incomplete")

    # Category headings sit alone in the left-most column.
    cats = []
    for ln in lines:
        t = ln.text.strip()
        if CWK_CATEGORY_RX.match(t) and not CWK_PERMIT_RX.search(t) and len(ln.words) <= 3:
            cats.append((ln.page, ln.top, t))

    def cat_for(ln):
        best = None
        for page, top, val in cats:
            if page < ln.page or (page == ln.page and top <= ln.top):
                best = val
        return best

    def is_row(ln):
        return bool(CWK_PERMIT_RX.search(band(ln, *bands["permit"])))

    permits = []
    for group in group_nearest(lines, is_row, max_above=10, max_below=22):
        anchor = next(ln for ln in group if is_row(ln))
        pm = CWK_PERMIT_RX.search(band(anchor, *bands["permit"]))
        rec = {k: [] for k in ("code", "date", "address", "applicant", "value")}
        for ln in group:
            if _is_furniture(ln.text) or CWK_CATEGORY_RX.match(ln.text.strip()):
                continue
            for k in rec:
                rec[k].append(band(ln, *bands[k]))
        j = lambda k: " ".join(x for x in rec[k] if x).strip()  # noqa: E731
        code, category = j("code"), cat_for(anchor)
        dm = re.search(r"([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})", j("date"))
        permits.append(Permit(
            source_city=cfg["city"],
            permit_id=pm.group(1),
            record_type=cfg["record_type"],
            issue_date=_try_dates(f"{dm.group(1)} {dm.group(2)} {dm.group(3)}",
                                  ["%b %d %Y"]) if dm else None,
            address=clean_str(CWK_RUNON_RX.sub(r"\1 \2", j("address"))),
            work_type=classify.work_type(code, category or ""),
            use_class=classify.use_class(category or "", code),
            value=_money(j("value")),
            applicant=clean_str(j("applicant")),
            description=clean_str(f"{category or ''} {code}".strip()),
            raw={"permit": pm.group(1), "report_code": code, "category": category,
                 "address": j("address"), "applicant": j("applicant"),
                 "value": j("value"), "date": j("date")},
        ))
    return [p for p in permits if p]


# --------------------------------------------------------------------------
# Mission -- monthly "Approved Permit Report", landscape, one row per permit
# with the builder and address wrapping onto following lines.
# --------------------------------------------------------------------------

# Mission's data sits noticeably left of its own headers, so most boundaries
# are midpoints. "Description of Work" is two columns, not one: the dwelling
# form ("Garden Cottage") and the work itself ("New").
MIS_COLUMNS = [
    ("date", ["ISSUED"], "mid"),
    ("permit", ["#", "PERMIT"], "mid"),
    ("builder", ["BUILDER"], "mid"),
    ("civic", ["CIVIC"]),
    ("street", ["STREET"], "mid"),
    ("btype", ["TYPE"], "mid"),
    ("description", ["DESCRIPTION"], "mid"),
    ("work", ["WORK"], "mid"),
    ("suite", ["SECONDARY"], "mid"),
    ("value", ["CONSTRUCTION"], "mid"),
    ("units", ["UNITS"], "mid"),
]
MIS_PERMIT_RX = re.compile(r"\b(\d{2}[-/]?\d{3,6})\b")
MIS_DATE_RX = re.compile(r"([A-Z][a-z]{2})[a-z]*\s+(\d{1,2}),?\s*(\d{4})")


def mission(cfg: dict) -> list[Permit]:
    urls = discover_labeled(cfg["index_url"], href_pattern=r"/media/file/",
                            exclude_text=r"year\s*to\s*date|\bytd\b")
    log.info("  %d month-end reports listed", len(urls))
    return _harvest(cfg, urls, _mission_parse,
                    stored_count=cfg.get("_stored", -1))


def _mission_parse(lines, cfg, url) -> list[Permit]:
    check_readable(lines)
    hdr = find_header(lines, ["ISSUED", "BUILDER", "CIVIC", "STREET"], merge_above=True)
    if not hdr:
        raise RuntimeError("no recognisable column header")
    bands = bands_from(hdr[1], MIS_COLUMNS,
                       optional={"suite", "units", "btype", "work"})
    if not bands:
        raise RuntimeError("header found but columns incomplete")

    def is_row(ln):
        return bool(MIS_DATE_RX.search(band(ln, *bands["date"]))
                    and band(ln, *bands["permit"]).strip())

    permits = []
    for group in group_nearest(lines, is_row, max_above=8, max_below=34):
        anchor = next(ln for ln in group if is_row(ln))
        pid = clean_str(band(anchor, *bands["permit"]))
        if not pid:
            continue
        rec = {k: [] for k in bands}
        for ln in group:
            if _is_furniture(ln.text):
                continue
            for k in bands:
                rec[k].append(band(ln, *bands[k]))
        j = lambda k: " ".join(x for x in rec.get(k, []) if x).strip()  # noqa: E731
        dm = MIS_DATE_RX.search(j("date"))
        # Address comes from the anchor line alone. The builder block below it
        # ("Tap 2 Drain" / "8051 Wade Terrace" / "Mission BC") overlaps the
        # civic and street bands, and joining the group splices the builder's
        # own address into the permit's -- "31500 Burnham Ltd Place" -- which
        # then fails to geocode.
        addr = " ".join(x for x in (band(anchor, *bands["civic"]),
                                    band(anchor, *bands["street"])) if x).strip()
        # The builder block is name / street / city on three lines; only the
        # first is the company. The rest is the builder's own mailing address,
        # which would otherwise read as part of their name.
        builder = next((x for x in rec.get("builder", []) if x.strip()), None)
        btype, desc, work = j("btype"), j("description"), j("work")
        permits.append(Permit(
            source_city=cfg["city"],
            permit_id=pid,
            record_type=cfg["record_type"],
            issue_date=_try_dates(f"{dm.group(1)} {dm.group(2)} {dm.group(3)}",
                                  ["%b %d %Y"]) if dm else None,
            address=clean_str(addr),
            work_type=classify.work_type(work, desc, btype),
            use_class=classify.use_class(btype, desc),
            value=_money(j("value")),
            contractor=clean_str(builder),
            description=clean_str(" ".join(x for x in (desc, work) if x) or btype),
            raw={"permit": pid, "builder": j("builder"), "builder_name": builder,
                 "civic_line": band(anchor, *bands["civic"]),
                 "street_line": band(anchor, *bands["street"]),
                 "civic": j("civic"),
                 "street": j("street"), "type": btype, "description": desc,
                 "work": work, "value": j("value"), "units": j("units"),
                 "date": j("date")},
        ))
    return [p for p in permits if p]
