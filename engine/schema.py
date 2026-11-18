"""The permit record schema. Every source normalizes to exactly this.

This module is deliberately the only place that knows the field list, so that
swapping the GeoJSON sink for Postgres later is a change of sink, not a
migration of every adapter.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from typing import Any

# Column order is contractual: CSV export, the GeoJSON properties block and a
# future CREATE TABLE all read from here.
FIELDS = [
    "source_city",
    "permit_id",
    "uid",
    "record_type",
    "issue_date",
    "address",
    "lat",
    "lon",
    "work_type",
    "use_class",
    "value",
    "applicant",
    "contractor",
    "description",
    "first_seen",
    "raw",
]

RECORD_TYPES = ("issued", "application")

# Postgres DDL kept beside the dataclass so the two cannot drift apart.
POSTGRES_DDL = """
CREATE TABLE IF NOT EXISTS permits (
    uid          text PRIMARY KEY,
    source_city  text NOT NULL,
    permit_id    text NOT NULL,
    record_type  text NOT NULL CHECK (record_type IN ('issued','application')),
    issue_date   date,
    address      text,
    lat          double precision,
    lon          double precision,
    work_type    text,
    use_class    text,
    value        bigint,
    applicant    text,
    contractor   text,
    description  text,
    first_seen   date NOT NULL,
    raw          jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS permits_city_date ON permits (source_city, issue_date DESC);
CREATE INDEX IF NOT EXISTS permits_first_seen ON permits (first_seen DESC);
"""


def make_uid(source_city: str, permit_id: str) -> str:
    """The dedup key. sha1(source_city + permit_id), per spec."""
    return hashlib.sha1(f"{source_city}{permit_id}".encode("utf-8")).hexdigest()


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def clean_str(v: Any) -> str | None:
    """Collapse whitespace, drop empties and the placeholder junk cities emit."""
    if v is None:
        return None
    s = str(v).strip()
    s = re.sub(r"\s+", " ", s)
    if not s or s.lower() in {"n/a", "na", "none", "null", "-", "unknown", "tbd"}:
        return None
    return s


def parse_date(v: Any) -> str | None:
    """Accept the handful of date shapes municipal portals actually emit.

    ArcGIS hands back epoch milliseconds; Opendatasoft hands back ISO strings.
    Anything else we would rather drop than guess at.
    """
    if v is None or v == "":
        return None
    # ArcGIS epoch milliseconds (sometimes arrives as a numeric string).
    if isinstance(v, (int, float)) or (isinstance(v, str) and re.fullmatch(r"-?\d{10,}", v.strip())):
        ms = int(float(v))
        if ms == 0:
            return None
        try:
            return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat()
        except (OverflowError, OSError, ValueError):
            return None
    s = str(v).strip()
    # Surrey publishes "20260202". Python 3.11+ fromisoformat happens to accept
    # that; 3.10 (Ubuntu 22.04) does not, so handle it explicitly.
    if re.fullmatch(r"\d{8}", s):
        try:
            return datetime.strptime(s, "%Y%m%d").date().isoformat()
        except ValueError:
            return None
    # Kamloops: "Jan 11 2012 12:00AM"
    m = re.match(r"([A-Z][a-z]{2}) +(\d{1,2}) +(\d{4})", s)
    if m:
        try:
            return datetime.strptime(" ".join(m.groups()), "%b %d %Y").date().isoformat()
        except ValueError:
            return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s[: len(fmt) + 2].strip(), fmt).date().isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return None


def parse_value(v: Any) -> int | None:
    """Declared construction value in CAD.

    This is the applicant's own figure — not market value, not appraised value,
    and it excludes land and soft costs. Stored as an integer number of dollars.
    """
    if v is None or v == "":
        return None
    if isinstance(v, str):
        v = re.sub(r"[^0-9.\-]", "", v)
        if not v or v in {"-", ".", "-."}:
            return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    return int(round(n))


def parse_coord(lat: Any, lon: Any) -> tuple[float | None, float | None]:
    """Validate a coordinate pair against a generous BC bounding box.

    Guards against the 0/0 nulls and swapped lat/lon that several of these
    feeds emit for records the city failed to geocode on its own.
    """
    try:
        la, lo = float(lat), float(lon)
    except (TypeError, ValueError):
        return None, None
    if not (47.0 <= la <= 61.0 and -140.0 <= lo <= -113.0):
        return None, None
    return round(la, 6), round(lo, 6)


@dataclass
class Permit:
    source_city: str
    permit_id: str
    record_type: str
    issue_date: str | None = None
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    work_type: str | None = None
    use_class: str | None = None
    value: int | None = None
    applicant: str | None = None
    contractor: str | None = None
    description: str | None = None
    first_seen: str = field(default_factory=today)
    raw: dict = field(default_factory=dict)

    @property
    def uid(self) -> str:
        return make_uid(self.source_city, self.permit_id)

    def validate(self) -> None:
        if not self.source_city or not self.permit_id:
            raise ValueError("source_city and permit_id are required")
        if self.record_type not in RECORD_TYPES:
            raise ValueError(f"record_type must be one of {RECORD_TYPES}")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["uid"] = self.uid
        return {k: d[k] for k in FIELDS}


def to_feature(p: dict) -> dict:
    """One permit dict -> one GeoJSON Feature.

    Records that failed geocoding still ship, with null geometry. Dropping them
    would silently shrink the dataset and hide the geocoder regressing.
    """
    geom = None
    if p.get("lon") is not None and p.get("lat") is not None:
        geom = {"type": "Point", "coordinates": [p["lon"], p["lat"]]}
    # Slimmed records omit nulls and `raw` entirely; carry through whatever is
    # present rather than reintroducing the keys that were deliberately dropped.
    # uid rides as the feature id rather than being repeated in properties.
    props = {k: p[k] for k in FIELDS if k in p and k != "uid"}
    return {"type": "Feature", "id": p.get("uid"), "geometry": geom, "properties": props}
