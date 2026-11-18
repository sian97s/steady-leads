"""extras.to_row on real stored records from every source, and contractor-name matching."""
import json
import pytest
from conftest import FIX
import db
from extras import to_row
from sources import SOURCES_BY_CITY

SAMPLES = json.loads((FIX / "stored_samples.json").read_text())


@pytest.mark.parametrize("city", sorted(SAMPLES))
def test_to_row_real_records(city):
    for d in SAMPLES[city]:
        r = to_row(d, SOURCES_BY_CITY[city])
        assert r["id"] == f"{city}:{d['permit_id']}" and r["source"] == city
        assert set(db.COLS) <= set(r)
        assert r["kind"] in ("building", "trade", "development")
        assert r["issued_date"] == d["issue_date"] and r["first_seen"] == d["first_seen"]
        for k in ("contractor", "applicant", "contractor_address"):
            assert r[k] is None or "\n" not in r[k]
        if r["contractor"]:
            assert r["contractor_key"]


def test_surrey_contractor_split_from_address():
    d = {"source_city": "surrey", "permit_id": "X", "record_type": "issued", "issue_date": "2026-02-02", "first_seen": "2026-08-22",
         "contractor": "1374533 BC Ltd. 8327 120 St Delta", "raw": {"BuildingGeneralContractorOrganization": "1374533 BC Ltd.\n8327 120 St\nDelta, British Columbia, Canada"}}
    r = to_row(d, SOURCES_BY_CITY["surrey"])
    assert r["contractor"] == "1374533 BC Ltd." and r["contractor_address"].startswith("8327 120 St")


def test_richmond_phone_pulled_out_of_name():
    d = {"source_city": "richmond", "permit_id": "26-1", "record_type": "issued", "applicant": "Rob Gavin", "contractor": "Morningstar Refrigeration",
         "raw": {"applicant": "Rob Gavin (604)362-4333", "contractor": "Morningstar Refrigeration (604)362-4333", "sub_type": "Warehouse"}}
    r = to_row(d, SOURCES_BY_CITY["richmond"])
    assert r["contact_phone"] == "(604)362-4333" and r["contractor"] == "Morningstar Refrigeration"


def test_trade_permits_flagged():
    mk = lambda cat: to_row({"source_city": "maple_ridge", "permit_id": "1", "record_type": "issued", "raw": {"FolderDesc": cat}}, SOURCES_BY_CITY["maple_ridge"])["kind"]
    assert mk("Electrical Permit") == "trade" and mk("Gas Permit") == "trade" and mk("Building Permit") == "building"


@pytest.mark.parametrize("a,b", [
    ("East West Excavating 2022 Ltd.", "EAST WEST EXCAVATING 2022 LTD"),
    ("Jane Doe DBA: Acme Homes", "Acme Homes Inc."),
    ("Bona Development Ltd (Tim Weng)", "Bona Development Ltd."),
    ("PRO2 CONSTRUCTION MANAGEMENT LT", "Pro2 Construction Management Ltd."),
    ("PCM POMEROY CONSTRUCTION & MAINTENANCE LTD", "PCM Pomeroy Construction and Maintenance Ltd."),
])
def test_name_key_matches(a, b):
    assert db.name_key(a) == db.name_key(b) != ""


def test_name_key_keeps_different_companies_apart():
    assert db.name_key("Apex Homes Ltd") != db.name_key("Apex Home Builders Ltd")
    assert db.name_key(None) == ""
