"""One-time: load the My Permit Dash JSONL store (data/permits/{city}/{year}.jsonl)
into the database, keeping first_seen and coordinates.

    python engine/load_history.py "/path/to/My Permit Dash/data/permits"
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import db                      # noqa: E402
from extras import to_row      # noqa: E402
from sources import SOURCES_BY_CITY  # noqa: E402


def main(store: str) -> int:
    con = db.connect()
    total = 0
    for shard in sorted(Path(store).glob("*/*.jsonl")):
        cfg = SOURCES_BY_CITY.get(shard.parent.name)
        if not cfg:
            print("skip unknown source", shard.parent.name)
            continue
        rows = []
        for line in shard.open():
            line = line.strip()
            if line:
                rows.append(to_row(json.loads(line), cfg))
        db.upsert(con, rows)
        con.commit()
        total += len(rows)
    print(f"loaded {total} permits")
    for r in con.execute("SELECT source,count(*) n,max(issued_date) d FROM permits GROUP BY source ORDER BY n DESC"):
        print(f"  {r['source']:22} {r['n']:7}  newest {r['d']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
