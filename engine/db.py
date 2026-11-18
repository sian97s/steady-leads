"""SQLite sink. One database (data/leadyard.db) shared with the Node web app."""
from __future__ import annotations

import json
import os
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("DB_PATH") or ROOT / "data" / "leadyard.db")

COLS = ["id", "source", "permit_number", "city", "record_type", "kind", "address", "lat", "lng",
        "value", "work_type", "use_type", "category", "description",
        "applicant", "applicant_address", "applicant_key",
        "contractor", "contractor_address", "contractor_key",
        "contact_phone", "contact_email", "status", "filed_date", "issued_date", "first_seen", "raw"]


def connect(path: Path | None = None) -> sqlite3.Connection:
    path = Path(path or DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=60)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=60000")
    con.executescript((ROOT / "schema.sql").read_text())
    return con


_SUFFIX = re.compile(r"\b(ltd|limited|inc|incorporated|corp|corporation|co|company|llp|ltee)\b")


def name_key(s: str | None) -> str:
    """Normalize a company name so 'East West Excavating 2022 Ltd.' matches
    'EAST WEST EXCAVATING 2022 LTD'. Same rules the app has always used."""
    if not s:
        return ""
    n = str(s).lower()
    dba = re.split(r"\bdba:?\s*", n)          # "Jane Doe DBA: Acme Homes" -> "acme homes"
    if len(dba) > 1:
        n = dba[-1]
    n = re.sub(r"\([^)]*\)", " ", n)          # "(Tim Weng)", "(604)", "(Parkside)"
    n = n.replace("&", " and ")
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = _SUFFIX.sub(" ", n)
    n = re.sub(r"\s+", " ", n).strip()
    n = re.sub(r" (lt|lim|limite)$", "", n)    # Burnaby truncates names at 31 characters
    return re.sub(r"^the ", "", n)


_UPSERT = (
    f"INSERT INTO permits ({','.join(COLS)},updated_at) VALUES ({','.join(':' + c for c in COLS)},datetime('now')) "
    "ON CONFLICT(id) DO UPDATE SET "
    + ", ".join(f"{c}=excluded.{c}" for c in COLS if c not in ("id", "first_seen", "lat", "lng"))
    # never overwrite first_seen; never lose a coordinate already paid for
    + ", lat=COALESCE(excluded.lat, permits.lat), lng=COALESCE(excluded.lng, permits.lng)"
    + ", first_seen=COALESCE(permits.first_seen, excluded.first_seen), updated_at=datetime('now')"
)


def upsert(con: sqlite3.Connection, rows: list[dict]) -> None:
    for r in rows:
        r = dict(r)
        if not isinstance(r.get("raw"), (str, type(None))):
            r["raw"] = json.dumps(r["raw"], separators=(",", ":"), default=str)
        con.execute(_UPSERT, {c: r.get(c) for c in COLS})
