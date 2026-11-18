"""ArcGIS FeatureServer / MapServer adapter.

One adapter, one config row per city. Several of these layers are non-spatial
tables (Surrey, New Westminster, Port Moody), so geometry is optional and the
run falls back to the BC geocoder for those.
"""
from __future__ import annotations

import logging

import classify
from http_client import get_json, post_json
from schema import Permit, clean_str, parse_coord, parse_date, parse_value

log = logging.getLogger(__name__)

# Paging by explicit object id works on every ArcGIS version we hit, including
# the older ArcGIS Server behind Maple Ridge which ignores resultOffset. The
# id list is POSTed -- as a GET it overruns the URL limit and 404s.
ID_CHUNK = 250


def _object_ids(layer_url: str, where: str) -> list[int]:
    data = get_json(f"{layer_url}/query", params={
        "where": where, "returnIdsOnly": "true", "f": "json",
    })
    if "error" in data:
        raise RuntimeError(f"ArcGIS error: {data['error'].get('message')}")
    return sorted(data.get("objectIds") or [])


def _fetch_chunk(layer_url: str, id_field: str, ids: list[int]) -> list[dict]:
    data = post_json(f"{layer_url}/query", data={
        "objectIds": ",".join(str(i) for i in ids),
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": 4326,
        "f": "json",
    })
    if "error" in data:
        raise RuntimeError(f"ArcGIS error: {data['error'].get('message')}")
    return data.get("features") or []


def fetch(cfg: dict) -> list[Permit]:
    """Pull every record from one ArcGIS layer and normalize it."""
    layer_url = cfg["url"]
    where = cfg.get("where", "1=1")
    fmap = cfg["fields"]

    ids = _object_ids(layer_url, where)
    log.info("  %d object ids", len(ids))

    permits: list[Permit] = []
    for start in range(0, len(ids), ID_CHUNK):
        chunk = ids[start:start + ID_CHUNK]
        for feat in _fetch_chunk(layer_url, cfg.get("id_field", "OBJECTID"), chunk):
            p = _normalize(feat, cfg, fmap)
            if p is not None:
                permits.append(p)
        log.info("  fetched %d/%d", min(start + ID_CHUNK, len(ids)), len(ids))

    return permits


def _collect(attrs: dict, spec) -> list[str | None]:
    """All values behind a mapping -- classification reads every candidate,
    not just the first non-empty one."""
    if spec is None:
        return []
    names = [spec] if isinstance(spec, str) else list(spec)
    return [clean_str(attrs.get(n)) for n in names]


def _pick(attrs: dict, spec) -> object:
    """Resolve a field mapping: a name, a list of fallback names, or None."""
    if spec is None:
        return None
    if isinstance(spec, str):
        return attrs.get(spec)
    for name in spec:
        v = attrs.get(name)
        if v not in (None, ""):
            return v
    return None


def _compose_address(attrs: dict, cfg: dict) -> str | None:
    """Some layers publish a single civic address; others publish parts."""
    spec = cfg["fields"].get("address")
    if spec:
        direct = clean_str(_pick(attrs, spec))
        if direct:
            return direct
    parts = cfg["fields"].get("address_parts")
    if not parts:
        return None
    bits = [clean_str(attrs.get(f)) for f in parts]
    joined = " ".join(b for b in bits if b)
    return clean_str(joined)


def _normalize(feat: dict, cfg: dict, fmap: dict) -> Permit | None:
    attrs = feat.get("attributes") or {}
    permit_id = clean_str(_pick(attrs, fmap.get("permit_id")))
    if not permit_id:
        return None  # without the city's own permit number there is no dedup key

    lat = lon = None
    geom = feat.get("geometry") or {}
    if "y" in geom and "x" in geom:
        lat, lon = parse_coord(geom.get("y"), geom.get("x"))

    return Permit(
        source_city=cfg["city"],
        permit_id=permit_id,
        record_type=cfg["record_type"],
        issue_date=parse_date(_pick(attrs, fmap.get("issue_date"))),
        address=_compose_address(attrs, cfg),
        lat=lat,
        lon=lon,
        work_type=classify.work_type(*_collect(attrs, fmap.get("work_type"))),
        use_class=classify.use_class(*_collect(attrs, fmap.get("use_class"))),
        value=parse_value(_pick(attrs, fmap.get("value"))),
        applicant=clean_str(_pick(attrs, fmap.get("applicant"))),
        contractor=clean_str(_pick(attrs, fmap.get("contractor"))),
        description=clean_str(_pick(attrs, fmap.get("description"))),
        raw=attrs,
    )
