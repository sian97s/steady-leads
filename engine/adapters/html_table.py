"""Adapter for cities that publish permits as a plain HTML table.

Port Coquitlam posts a rolling weekly table with no download link, so the page
itself is the feed. Parsing is deliberately done with regex over the markup
rather than a DOM library: the table is flat, and it keeps the dependency list
to requests + pdfplumber.
"""
from __future__ import annotations

import html as htmllib
import logging
import re

import classify
from http_client import get_text
from datetime import datetime

from schema import Permit, clean_str, parse_date, parse_value

log = logging.getLogger(__name__)

TABLE_RX = re.compile(r"<table.*?</table>", re.S | re.I)
ROW_RX = re.compile(r"<tr.*?</tr>", re.S | re.I)
CELL_RX = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S | re.I)


def _cells(row: str) -> list[str]:
    out = []
    for raw in CELL_RX.findall(row):
        text = htmllib.unescape(re.sub(r"<[^>]+>", " ", raw))
        out.append(re.sub(r"[\s ]+", " ", text).strip())
    return out


def _date(text: str | None, fmt: str | None) -> str | None:
    """Parse with the source's declared format.

    Falls back to the generic parser only when no format is declared -- for
    "8/11/2026" the generic parser cannot know whether that is August or
    November, and a silent wrong guess mis-sorts the record forever.
    """
    text = clean_str(text)
    if not text:
        return None
    if fmt:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            log.warning("  date %r does not match %r", text, fmt)
    return parse_date(text)


def fetch(cfg: dict) -> list[Permit]:
    tables = TABLE_RX.findall(get_text(cfg["url"]))
    if not tables:
        raise RuntimeError("no <table> found -- page structure changed")

    # The permit table is the biggest one on the page; the others are nav.
    rows = ROW_RX.findall(max(tables, key=len))
    if len(rows) < 2:
        raise RuntimeError("permit table has no data rows")

    header = [h.upper() for h in _cells(rows[0])]
    idx = {name: i for i, name in enumerate(header)}
    fmap = cfg["columns"]

    def col(cells, name):
        """Value of a column by its literal header name."""
        i = idx.get((name or "").upper())
        return cells[i] if i is not None and i < len(cells) else None

    def get(cells, key):
        """Value of a mapped schema field."""
        return col(cells, fmap.get(key))

    # One permit can appear on several rows -- Port Coquitlam repeats it per
    # unit and per trade. Merge them, preferring rows that name a builder.
    merged: dict[str, dict] = {}
    for row in rows[1:]:
        cells = _cells(row)
        if not any(cells):
            continue
        pid = clean_str(get(cells, "permit_id"))
        if not pid:
            continue
        rec = merged.setdefault(pid, {"cells": cells, "addresses": set(), "people": {}})
        parts = [clean_str(col(cells, p)) for p in fmap.get("address_parts", [])]
        addr = " ".join(p for p in parts if p)
        if addr:
            rec["addresses"].add(addr)
        person = clean_str(get(cells, "person_type")) or "OTHER"
        name = clean_str(get(cells, "contractor"))
        if name:
            rec["people"][person.upper()] = name

    permits = []
    for pid, rec in merged.items():
        cells = rec["cells"]
        ptype = clean_str(get(cells, "permit_type")) or ""
        code = clean_str(get(cells, "work_code")) or ""
        # Prefer the general contractor over a trade sub when both are listed.
        people = rec["people"]
        contractor = (people.get("BUILDER") or people.get("CONTRACTOR")
                      or next(iter(people.values()), None))
        permits.append(Permit(
            source_city=cfg["city"],
            permit_id=pid,
            record_type=cfg["record_type"],
            issue_date=_date(get(cells, "issue_date"), cfg.get("date_format")),
            address=clean_str("; ".join(sorted(rec["addresses"]))),
            work_type=classify.work_type(code, ptype),
            use_class=classify.use_class(ptype),
            value=parse_value(get(cells, "value")),
            contractor=contractor,
            description=clean_str(f"{ptype} {code}".strip()),
            raw={h: (cells[i] if i < len(cells) else None)
                 for i, h in enumerate(header)} | {"units": sorted(rec["addresses"]),
                                                   "people": people},
        ))

    log.info("  %d rows -> %d permits", len(rows) - 1, len(permits))
    return permits
