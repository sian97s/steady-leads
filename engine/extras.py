"""Turn an engine Permit (schema.py) into an app row.

The adapters keep each city's original record in `raw`. The app wants a few
things the 16-field schema never carried -- contact phone/email, contractor
address, the city's own permit category -- so they are derived here from
`raw`, per source, without touching the adapters.
"""
from __future__ import annotations

import re

from db import name_key

PHONE = re.compile(r"\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
# Permit categories that are not building work. Maple Ridge and New
# Westminster publish every trade permit in the same feed.
TRADE = re.compile(r"electric|\bgas\b|plumb|sprinkler|\bsign\b|occupancy|suite registration|"
                   r"^services$|solid fuel|temporary residential|dwelling agreement|"
                   r"business licen|sewer|water connection|\bfire\b|tree|highway|blasting", re.I)


def _s(v):
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def _phone(*vals):
    for v in vals:
        m = PHONE.search(str(v or ""))
        if m:
            return m.group(0)
    return None


def _strip_phone(v):
    return _s(PHONE.sub("", str(v))) if v else None


def _org(v):
    """Surrey: 'MBM FRAMING LTD\\n9286 149 St\\nSurrey, ...' -> (name, address)."""
    if not v:
        return None, None
    parts = [p.strip() for p in re.split(r"\r?\n", str(v)) if p.strip()]
    return (_s(parts[0]) if parts else None), (_s(", ".join(parts[1:])) if len(parts) > 1 else None)


def _iso(v):
    from schema import parse_date
    return parse_date(v)


def to_row(d: dict, cfg: dict) -> dict:
    """d = Permit.to_dict(); cfg = its source row from sources.py."""
    raw = d.get("raw") or {}
    src = d["source_city"]
    r = {
        "id": f"{src}:{d['permit_id']}", "source": src, "permit_number": d["permit_id"],
        "city": re.sub(r"^(City|District|Village|Township) of ", "", cfg["label"]).split(" (")[0],
        "record_type": d["record_type"], "kind": cfg.get("kind", "building"),
        "address": d.get("address"), "lat": d.get("lat"), "lng": d.get("lon"),
        "value": d.get("value"), "work_type": d.get("work_type"), "use_type": d.get("use_class"),
        "category": None, "description": d.get("description"),
        "applicant": d.get("applicant"), "applicant_address": None,
        "contractor": d.get("contractor"), "contractor_address": None,
        "contact_phone": None, "contact_email": None, "status": None,
        "filed_date": None, "issued_date": d.get("issue_date"), "first_seen": d.get("first_seen"),
        "raw": raw,
    }
    g = raw.get
    if src == "vancouver":
        r.update(category=_s(g("permitcategory")), filed_date=_iso(g("permitnumbercreateddate")),
                 applicant_address=_s(g("applicantaddress")), contractor_address=_s(g("buildingcontractoraddress")))
    elif src == "surrey":
        r["contractor"], r["contractor_address"] = _org(g("BuildingGeneralContractorOrganization"))
        r["applicant"], r["applicant_address"] = _org(g("ApplicantOrganization"))
        r["category"] = _s(g("SubDescription"))
    elif src == "new_westminster":
        r.update(category=_s(g("FOLDER_CATEGORY")), status=_s(g("STATUS")), contractor_address=_s(g("CONTRACTOR_ADDRESS")))
    elif src == "maple_ridge":
        r.update(category=_s(g("FolderDesc")), status=_s(g("StatusDescription")), filed_date=_iso(g("InDate")))
    elif src == "port_moody":
        r.update(category=_s(g("application_type")), status=_s(g("application_status")), filed_date=_iso(g("application_date")))
    elif src == "squamish":
        r.update(category=_s(g("Folder_Type")), status=_s(g("Status")), filed_date=_iso(g("Application_Date")))
    elif src == "burnaby":
        r["category"] = _s(g("type_block"))
    elif src == "richmond":
        r.update(category=_s(g("sub_type")), contact_phone=_phone(g("contractor"), g("applicant")),
                 applicant=_strip_phone(r["applicant"]), contractor=_strip_phone(r["contractor"]))
    elif src == "coquitlam":
        r.update(category=_s(g("folder_type")), contact_phone=_phone(g("people")), contractor=_strip_phone(r["contractor"]))
    elif src == "north_vancouver_city":
        r.update(category=_s(g("occupancy")), contractor_address=_s(g("caddr") or g("contractor_address")),
                 filed_date=_iso(g("received")) if g("received") else None)
    elif src == "mission":
        b, n = _s(g("builder")), _s(g("builder_name"))
        if b and n and b.startswith(n) and len(b) > len(n):
            r["contractor_address"] = _s(b[len(n):])
        r["category"] = _s(g("type"))
    elif src == "chilliwack":
        r["category"] = _s(g("category")) or _s(g("report_code"))
    elif src == "delta":
        r["category"] = _s(g("type"))
    elif src == "port_coquitlam":
        r.update(category=_s(g("PERMIT TYPE")), contractor_address=_s(g("MAILING ADDRESS")))
    elif src == "victoria":
        r.update(category=_s(g("PermitType") or g("type")), status=_s(g("Status")),
                 applicant_address=_s(g("mailing_address")), contact_phone=_phone(g("phone"), g("cell")),
                 contact_email=_s(g("email")), filed_date=_iso(g("CREATED_DATE")))
        if r["lat"] is None and g("Y_LAT") and g("X_LONG"):
            from schema import parse_coord
            r["lat"], r["lng"] = parse_coord(g("Y_LAT"), g("X_LONG"))
    elif src == "prince_george":
        r.update(category=_s(g("Type")), status=_s(g("Status")))
    elif src == "kamloops":
        r["category"] = _s(g("CATEGORY"))
    elif src == "pemberton":
        r.update(status=_s(g("BP_Permit_Status")), filed_date=_iso(g("BP_Application_Date")))
    elif src == "csrd":
        r.update(category=_s(g("ConstructionType")), status=_s(g("StatusDetail")),
                 contact_phone=_phone(g("Phone")), contact_email=_s(g("Email")), filed_date=_iso(g("DateEntered")))
    elif src == "abbotsford":
        units = sum(int(g(k) or 0) for k in ("NewSFLots", "AptUnits", "MFUnits", "THUnits") if str(g(k) or "").isdigit())
        r.update(category="Development application", contact_phone=_phone(g("PHONE1")), contact_email=_s(g("EMAILADDRESS")))
        if units and r["description"]:
            r["description"] += f" ({units} units/lots)"
    elif src == "langley_township":
        people = [f"{_s(g(f'Name_{i}'))} ({_s(g(f'PERSON_TYPE_{i}')) or 'contact'})" for i in range(1, 7) if _s(g(f"Name_{i}"))]
        app = next((_s(g(f"Name_{i}")) for i in range(1, 7)
                    if re.search("APPLICANT|AGENT", str(g(f"PERSON_TYPE_{i}") or ""), re.I) and _s(g(f"Name_{i}"))), None)
        r.update(category="Development application", status=_s(g("FOLDER_STATUS")), contact_phone=_phone(g("Phone1")),
                 applicant=app or r["applicant"])
        if people:
            r["description"] = (r["description"] or "") + " — People: " + "; ".join(people)
    elif src == "white_rock":
        m = re.search(r"Builder:\s*([^,]+)", str(g("Descript") or ""), re.I)
        r.update(category="Major development", contractor=_s(m.group(1)) if m else None,
                 permit_number=f"MD-{d['permit_id']}")

    if r["contact_email"] and not EMAIL.fullmatch(r["contact_email"]):
        m = EMAIL.search(r["contact_email"]); r["contact_email"] = m.group(0) if m else None
    if r["kind"] == "building" and r["category"] and TRADE.search(r["category"]):
        r["kind"] = "trade"
    if r["record_type"] == "application" and r["kind"] == "building" and src != "port_moody":
        r["kind"] = "development"
    r["contractor_key"] = name_key(r["contractor"]) or None
    r["applicant_key"] = name_key(r["applicant"]) or None
    return r
