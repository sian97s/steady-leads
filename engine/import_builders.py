"""Import the contractor list (BC Housing licensed builders .xlsx, or any CSV/XLSX
with a company-name column) into the contractors table, then report the match
rate against permits.

    python engine/import_builders.py data/builders.xlsx [--keep]   # default replaces the list
"""
from __future__ import annotations

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db  # noqa: E402

ALIASES = {
    "name": ["company / builder name", "name", "company", "company name", "business name", "business", "contractor", "builder"],
    "phone": ["phone", "phone number", "telephone", "tel", "mobile", "cell"],
    "alt_phone": ["alternate phone", "alt phone"],
    "email": ["email", "e-mail", "email address"],
    "website": ["website", "web", "url", "site"],
    "address": ["address", "street", "street address"],
    "city": ["city", "municipality", "town"],
    "trade": ["licence type", "trade", "category", "type", "specialty", "industry"],
    "notes": ["notes", "note", "comments", "all emails found"],
    "licence": ["licence #", "license #", "licence", "license"],
    "status": ["status category", "status"],
    "person": ["person(s) responsible", "contact", "contact name", "owner"],
}
FIELDS = list(ALIASES)


def read_rows(path: Path) -> list[dict]:
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        import openpyxl
        ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
        it = ws.iter_rows(values_only=True)
        head = [str(h or "").strip() for h in next(it)]
        return [dict(zip(head, r)) for r in it]
    import csv
    with path.open(newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def import_file(con, path: Path, replace: bool = True) -> int:
    rows = read_rows(path)
    if not rows:
        return 0
    lower = {h.strip().lower(): h for h in rows[0]}
    col = {f: next((lower[a] for a in al if a in lower), None) for f, al in ALIASES.items()}
    if not col["name"]:
        raise SystemExit("No company/name column found. Headers: " + ", ".join(rows[0]))
    if replace:
        con.execute("DELETE FROM contractors")
    n = 0
    for r in rows:
        def g(f):
            v = r.get(col[f]) if col[f] else None
            v = str(v).strip() if v is not None else ""
            return v or None
        name = g("name")
        if not name:
            continue
        con.execute(f"INSERT INTO contractors (name,name_key,{','.join(FIELDS[1:])}) VALUES ({','.join('?' * (len(FIELDS) + 1))})",
                    (name, db.name_key(name), *[g(f) for f in FIELDS[1:]]))
        n += 1
    con.commit()
    return n


if __name__ == "__main__":
    con = db.connect()
    print("imported", import_file(con, Path(sys.argv[1]), replace="--keep" not in sys.argv), "contractors")
