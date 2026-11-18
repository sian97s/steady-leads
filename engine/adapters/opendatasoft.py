"""Opendatasoft Explore v2.1 adapter (Vancouver).

The records endpoint caps offset at 10000, which Vancouver's 50k+ permits blow
straight through, so bulk pulls go through the exports endpoint instead.
"""
from __future__ import annotations

import logging

import classify
from http_client import get_json
from schema import Permit, clean_str, parse_coord, parse_date, parse_value

log = logging.getLogger(__name__)


def _base(cfg: dict) -> str:
    return f"https://{cfg['domain']}/api/explore/v2.1/catalog/datasets/{cfg['dataset']}"


def fetch(cfg: dict) -> list[Permit]:
    params = {"limit": -1}
    where = cfg.get("where")
    if where:
        params["where"] = where
        log.info("  where: %s", where)

    rows = get_json(f"{_base(cfg)}/exports/json", params=params, timeout=180)
    if isinstance(rows, dict):  # error payloads come back as an object
        raise RuntimeError(f"Opendatasoft error: {rows.get('message', rows)}")
    log.info("  %d rows", len(rows))

    permits = []
    for row in rows:
        p = _normalize(row, cfg)
        if p is not None:
            permits.append(p)
    return permits


def _flatten(v) -> str | None:
    """Vancouver publishes propertyuse and specificusecategory as arrays."""
    if isinstance(v, list):
        return clean_str("; ".join(str(x) for x in v if x))
    return clean_str(v)


def _normalize(row: dict, cfg: dict) -> Permit | None:
    fmap = cfg["fields"]
    permit_id = clean_str(row.get(fmap["permit_id"]))
    if not permit_id:
        return None

    lat = lon = None
    pt = row.get(cfg.get("geo_field", "geo_point_2d"))
    if isinstance(pt, dict):
        lat, lon = parse_coord(pt.get("lat"), pt.get("lon"))

    def g(key):
        f = fmap.get(key)
        return row.get(f) if f else None

    return Permit(
        source_city=cfg["city"],
        permit_id=permit_id,
        record_type=cfg["record_type"],
        issue_date=parse_date(g("issue_date")),
        address=clean_str(g("address")),
        lat=lat,
        lon=lon,
        work_type=classify.work_type(_flatten(g("work_type"))),
        use_class=classify.use_class(_flatten(g("use_class")),
                                     _flatten(g("use_class_detail"))),
        value=parse_value(g("value")),
        applicant=_flatten(g("applicant")),
        contractor=_flatten(g("contractor")),
        description=clean_str(g("description")),
        raw=row,
    )
