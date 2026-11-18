"""Invariant checks carried over from My Permit Dash tests/test_schema.py
(schema, uid stability, date/value parsing, PDF line grouping and header-derived columns).
The parts that tested the retired JSONL store / static dashboard were dropped."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "engine")); sys.path.insert(0, str(ROOT / "engine" / "adapters"))
import classify                                     # noqa: E402
from schema import (FIELDS, Permit, make_uid, parse_coord,  # noqa: E402
                    parse_date, parse_value, to_feature)


def check(label, got, want):
    status = "ok  " if got == want else "FAIL"
    print(f"  {status} {label}: {got!r}" + ("" if got == want else f" != {want!r}"))
    return got == want



def test_legacy_invariants():
    ok = True
    print("uid")
    # The dedup key must be stable across runs and machines -- if this changes,
    # every previously stored first_seen is orphaned.
    ok &= check("known digest", make_uid("vancouver", "BP-2016-04668"),
                "20a1a656154f6a7f24c71faa0a35f690b676d790")
    ok &= check("city-scoped", make_uid("surrey", "1") == make_uid("vancouver", "1"), False)

    print("parse_date")
    for label, given, want in [
        ("arcgis epoch ms", 1484524800000, "2017-01-16"),
        ("epoch as string", "1484524800000", "2017-01-16"),
        ("iso", "2017-01-16", "2017-01-16"),
        ("iso datetime", "2017-01-16T00:00:00Z", "2017-01-16"),
        ("epoch zero", 0, None),
        ("empty", "", None),
        ("garbage", "not a date", None),
        ("none", None, None),
    ]:
        ok &= check(label, parse_date(given), want)

    print("parse_value")
    for label, given, want in [
        ("plain", 57583.0, 57583),
        ("currency string", "$57,583.00", 57583),
        ("negative rejected", -5, None),
        ("empty", "", None),
        ("non-numeric", "N/A", None),
    ]:
        ok &= check(label, parse_value(given), want)

    print("parse_coord")
    ok &= check("valid BC", parse_coord(49.28, -123.11), (49.28, -123.11))
    ok &= check("null island", parse_coord(0, 0), (None, None))
    ok &= check("swapped", parse_coord(-123.11, 49.28), (None, None))
    ok &= check("strings", parse_coord("49.28", "-123.11"), (49.28, -123.11))

    print("classify")
    ok &= check("SUD-NEW", classify.work_type("SUD-NEW"), "new")
    ok &= check("DEMO", classify.work_type("DEMO"), "demolition")
    ok &= check("vancouver alteration", classify.work_type("Addition / Alteration"), "addition")
    ok &= check("office -> commercial", classify.use_class("Office Uses"), "commercial")
    ok &= check("SUD -> residential", classify.use_class("RESIDENTIAL (SUD/TUD)"), "residential")
    ok &= check("empty stays null", classify.work_type(None), None)

    print("Permit")
    p = Permit(source_city="surrey", permit_id="X1", record_type="issued")
    p.validate()
    ok &= check("to_dict key set", set(p.to_dict()), set(FIELDS))
    ok &= check("uid matches helper", p.to_dict()["uid"], make_uid("surrey", "X1"))
    try:
        Permit(source_city="surrey", permit_id="X1", record_type="bogus").validate()
        ok &= check("bad record_type rejected", False, True)
    except ValueError:
        ok &= check("bad record_type rejected", True, True)

    pass
    from pdf_base import Line, Word, band, group_nearest, split_before

    mk = lambda top, ws: Line(0, top, [Word(x, x + 8, t) for x, t in ws])  # noqa: E731
    lines = [
        mk(0,  [(50, "PAGE"), (60, "HEADER")]),          # page furniture, far above
        mk(40, [(120, "133"), (130, "W"), (140, "1ST")]),  # address, one line above
        mk(50, [(60, "BLD2026-00130"), (357, "$150,000")]),  # the anchor
        mk(60, [(120, "VANCOUVER")]),                     # address continuation
        mk(200, [(120, "999"), (130, "OTHER")]),          # next record's address
        mk(210, [(60, "BLD2026-00131"), (357, "$1")]),
    ]
    is_anchor = lambda ln: ln.text.startswith("BLD")      # noqa: E731
    groups = group_nearest(lines, is_anchor, max_above=14, max_below=30)
    ok &= check("two records", len(groups), 2)
    g0 = " ".join(ln.text for ln in groups[0])
    ok &= check("wrapped address kept", "133 W 1ST" in g0 and "VANCOUVER" in g0, True)
    ok &= check("page header excluded", "PAGE HEADER" in g0, False)
    ok &= check("next record not absorbed", "999 OTHER" in g0, False)
    ok &= check("band slices by x", band(lines[2], 300, 400), "$150,000")

    # split_before drops a trailing header with no content under it, so give
    # the second header a body line to prove both blocks are returned.
    blocks = split_before(lines + [mk(220, [(120, "TAIL")])],
                          lambda ln: ln.text.startswith("BLD"))
    ok &= check("split_before yields blocks", len(blocks), 2)
    ok &= check("block starts after its header",
                blocks[1][0].text, "TAIL")
    ok &= check("empty trailing block dropped",
                len(split_before(lines, lambda ln: ln.text.startswith("BLD"))), 1)

    print("header-derived columns")
    from pdf_base import UnreadablePDF, bands_from, check_readable, find_header

    hdr = mk(0, [(30, "FOLDER"), (60, "NUMBER"), (110, "WORK"), (170, "STATUS"),
                 (215, "ISSUE"), (275, "CONSTR"), (370, "NAME"),
                 (505, "APPLICANT"), (640, "CONTRACTOR")])
    found = find_header([hdr], ["FOLDER", "STATUS", "APPLICANT"])
    ok &= check("header located", found is not None, True)
    cols = [("folder", ["FOLDER"]), ("work", ["WORK"]), ("status", ["STATUS"]),
            ("date", ["ISSUE"], "mid"), ("value", ["CONSTR"], "mid"),
            ("name", ["NAME"], "mid"), ("applicant", ["APPLICANT"], "mid"),
            ("contractor", ["CONTRACTOR"])]
    bands = bands_from(found[1], cols)
    ok &= check("all columns resolved", sorted(bands), sorted(c[0] for c in cols))
    ok &= check("text column ends at next header", round(bands["folder"][1]), 104)
    ok &= check("mid column splits halfway", round(bands["value"][1]), 316)

    # Richmond's demolition reports omit the value column entirely.
    no_value = mk(0, [(30, "FOLDER"), (110, "WORK"), (170, "STATUS"),
                      (215, "ISSUE"), (370, "NAME"), (505, "APPLICANT"),
                      (640, "CONTRACTOR")])
    fv = find_header([no_value], ["FOLDER", "STATUS", "APPLICANT"])
    ok &= check("missing required column rejected", bands_from(fv[1], cols), None)
    partial = bands_from(fv[1], cols, optional={"value"})
    ok &= check("optional column skipped", "value" in (partial or {}), False)
    ok &= check("remaining columns still resolve", len(partial or {}), 7)

    # Repeated labels ("Contractor" / "Contractor Address") stay distinct.
    dup = mk(0, [(60, "PERMIT"), (550, "CONTRACTOR"), (640, "CONTRACTOR")])
    fd = find_header([dup], ["PERMIT"])
    fd = find_header([dup], ["PERMIT"])
    ok &= check("second occurrence addressable",
                round(bands_from(fd[1], [("a", ["CONTRACTOR"]),
                                         ("b", ["CONTRACTOR2"])])["a"][1]), 634)

    assert ok
