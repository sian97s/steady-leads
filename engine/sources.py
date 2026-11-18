"""Source registry.

Every endpoint here was probed directly before its adapter was written.
Where the build spec and reality disagreed, reality won -- see the notes.

Licence: all sources below publish under an Open Government Licence
(municipal variants). Attribution is rendered in the frontend footer.
"""

SOURCES = [
    {
        # Largest source by volume, refreshed daily, and the only one that
        # ships its own coordinates -- no geocoding needed.
        "city": "vancouver",
        "locality": "Vancouver",
        "label": "City of Vancouver",
        "adapter": "opendatasoft",
        "record_type": "issued",
        "domain": "opendata.vancouver.ca",
        "dataset": "issued-building-permits",
        "licence": "Open Government Licence - Vancouver",
        "attribution_url": "https://opendata.vancouver.ca/explore/dataset/issued-building-permits/",
        "geo_field": "geo_point_2d",
        # Incremental runs only pull recent issue dates; the first run, or a
        # FULL_REFRESH, pulls everything.
        "incremental_where": "issuedate >= date'{since}'",
        "fields": {
            "permit_id": "permitnumber",
            "issue_date": "issuedate",
            "address": "address",
            "work_type": "typeofwork",
            "use_class": "propertyuse",
            "use_class_detail": "specificusecategory",
            "value": "projectvalue",
            "applicant": "applicant",
            "contractor": "buildingcontractor",
            "description": "projectdescription",
        },
    },
    {
        # Spec pointed at the Hub portal; the live data actually sits on the
        # city's own ArcGIS Server. Layer 1 is the rolling 90-day view, which
        # is what a daily run wants. Layer 0 is the full 2013-> set (67k).
        "city": "maple_ridge",
        "locality": "Maple Ridge",
        "label": "City of Maple Ridge",
        "adapter": "arcgis",
        "record_type": "issued",
        "url": "https://geoservices.mapleridge.ca/server/rest/services/DataCatalog/EconomicDevelopment/MapServer/1",
        "full_url": "https://geoservices.mapleridge.ca/server/rest/services/DataCatalog/EconomicDevelopment/MapServer/0",
        "licence": "Open Government Licence - Maple Ridge",
        "attribution_url": "https://www.mapleridge.ca/302/Open-Data",
        "fields": {
            "permit_id": "PermitNumber",
            "issue_date": ["IssueDate", "InDate"],
            "address": None,
            "address_parts": ["Unit", "House", "Street"],
            "work_type": "WorkDescription",
            "use_class": ["FolderDesc", "SubDescription"],
            "value": "ConstructionValue",
            "applicant": None,
            "contractor": "ContractorName",
            "description": ["SubDescription", "WorkDescription"],
        },
    },
    {
        # Non-spatial table -- geocoded from CIVIC_ADDRESS.
        "city": "new_westminster",
        "locality": "New Westminster",
        "label": "City of New Westminster",
        "adapter": "arcgis",
        "record_type": "issued",
        "url": "https://services3.arcgis.com/A7O8YnTNtzRPIn7T/arcgis/rest/services/Permits_Buildings/FeatureServer/0",
        "licence": "Open Government Licence - New Westminster",
        "attribution_url": "https://opendata.newwestcity.ca/",
        "fields": {
            "permit_id": "FOLDER_NUMBER",
            "issue_date": ["ISSUED_DATE", "ISSUEDATE"],
            "address": "CIVIC_ADDRESS",
            "work_type": "REPORT_CODE",
            "use_class": "FOLDER_CATEGORY",
            "value": "PROJECT_VALUE",
            "applicant": None,
            "contractor": "CONTRACTOR",
            "description": "REPORT_CODE",
        },
    },
    {
        # Applications, not issued permits -- record_type reflects that, and
        # issue_date carries the application date per the schema note.
        # Non-spatial table, and this feed publishes no construction value.
        "city": "port_moody",
        "locality": "Port Moody",
        "label": "City of Port Moody",
        "adapter": "arcgis",
        "record_type": "application",
        "url": "https://services9.arcgis.com/XMHGoEc3tdJ8TphG/arcgis/rest/services/Building%20Permits/FeatureServer/0",
        "licence": "Open Government Licence - Port Moody",
        "attribution_url": "https://data.portmoody.ca/",
        "fields": {
            "permit_id": "application_number",
            "issue_date": ["issued_date", "application_date"],
            "address": "civic_street_address",
            "work_type": "application_type",
            "use_class": "report_code",
            "value": None,
            "applicant": None,
            "contractor": None,
            "description": "application_subject",
        },
    },
    {
        # Spec guessed Opendatasoft; Surrey is in fact ArcGIS.
        # Non-spatial table -- geocoded from ProjectAddress.
        "city": "surrey",
        "locality": "Surrey",
        "label": "City of Surrey",
        "adapter": "arcgis",
        "record_type": "issued",
        "url": "https://services5.arcgis.com/YRpe0VKTJytZSSIB/arcgis/rest/services/IssuedBuildingPermits/FeatureServer/0",
        "licence": "Open Government Licence - Surrey",
        "attribution_url": "https://data.surrey.ca/",
        "fields": {
            "permit_id": "PermitNumber",
            "issue_date": "IssuedDate",
            "address": "ProjectAddress",
            "work_type": "WorkDescription",
            "use_class": "SubDescription",
            "value": "ValueOfConstruction",
            "applicant": "ApplicantOrganization",
            "contractor": "BuildingGeneralContractorOrganization",
            "description": "WorkDescription",
        },
    },
    {
        # Layer id is 33, not 0. Refreshed monthly only, so a daily run will
        # usually find nothing new here -- that is expected, not a failure.
        "city": "squamish",
        "locality": "Squamish",
        "label": "District of Squamish",
        "adapter": "arcgis",
        "record_type": "issued",
        "url": "https://services.arcgis.com/YCM10gnCAvCoAhpj/arcgis/rest/services/Building_Permits/FeatureServer/33",
        "licence": "Open Government Licence - Squamish",
        "attribution_url": "https://data.squamish.ca/",
        "fields": {
            "permit_id": ["Folder_Number", "Project_Number"],
            "issue_date": ["Issued_Date", "Application_Date"],
            "address": None,
            "address_parts": ["Unit", "House", "Street"],
            # Folder_Category is the constant "BUILDING PERMITS" and carries
            # no signal; Report_Code (NEW/ALT/DEMO) is the real work type.
            "work_type": ["Report_Code", "Folder_Type"],
            "use_class": ["Folder_Type"],
            "value": "Construction_Value",
            "applicant": "Applicant_Owner",
            "contractor": None,
            "description": ["Project_Name", "Report_Code"],
        },
    },
    # ---- PDF-only sources -------------------------------------------------
    # These four publish no API. See adapters/pdf_cities.py for the layouts.
    {
        # Largest municipality with no machine-readable feed. One PDF per
        # business day, rolling ~1 year; older reports require contacting the
        # city, so history starts from whatever is listed today.
        "city": "burnaby",
        "locality": "Burnaby",
        "label": "City of Burnaby",
        "adapter": "pdf_burnaby",
        "record_type": "issued",
        "index_url": "https://www.burnaby.ca/services-and-payments/permits-and-applications/building-permits-issued-and-tabulation-reports",
        "licence": "City of Burnaby open information",
        "attribution_url": "https://www.burnaby.ca/services-and-payments/permits-and-applications/building-permits-issued-and-tabulation-reports",
        "pdf_budget": 300,
    },
    {
        # The city's permit *portal* needs a login, but the issuance reports
        # are published openly as PDFs -- monthly plus weekly, ~12 months
        # retained. Only the public reports are read.
        "city": "richmond",
        "locality": "Richmond",
        "label": "City of Richmond",
        "adapter": "pdf_richmond",
        "record_type": "issued",
        "index_urls": [
            "https://www.richmond.ca/business-development/building-approvals/reports/reports.htm",
            "https://www.richmond.ca/business-development/building-approvals/reports/weeklyreports.htm",
        ],
        "licence": "City of Richmond open information",
        "attribution_url": "https://www.richmond.ca/business-development/building-approvals/reports/reports.htm",
        "pdf_budget": 120,
    },
    {
        # A single "current" PDF replaced each month, so it is always refetched.
        # Caveat: Coquitlam publishes only permits over $200,000.
        "city": "coquitlam",
        "locality": "Coquitlam",
        "label": "City of Coquitlam",
        "adapter": "pdf_coquitlam",
        "record_type": "issued",
        "url": "https://www.coquitlam.ca/DocumentCenter/View/9571/Issued-Building-Permits-PDF",
        "licence": "City of Coquitlam open information",
        "attribution_url": "https://www.coquitlam.ca/478/Building-Construction",
        "value_floor": 200000,
    },
    {
        # Fraser Valley, outside Metro Vancouver proper. Weekly Tempest report,
        # category headings carry the use class.
        "city": "chilliwack",
        "locality": "Chilliwack",
        "label": "City of Chilliwack",
        "adapter": "pdf_chilliwack",
        "record_type": "issued",
        "index_url": "https://www.chilliwack.com/main/page.cfm?id=2186",
        "licence": "City of Chilliwack open information",
        "attribution_url": "https://www.chilliwack.com/main/page.cfm?id=2185",
        "pdf_budget": 120,
    },
    {
        # Fraser Valley. The index mixes per-permit "month end" reports with
        # aggregate "year to date" ones; only the former are read.
        "city": "mission",
        "locality": "Mission",
        "label": "City of Mission",
        "adapter": "pdf_mission",
        "record_type": "issued",
        "index_url": "https://www.mission.ca/planning-building-business/building-statistics",
        "licence": "City of Mission open information",
        "attribution_url": "https://www.mission.ca/planning-building-business/building-statistics",
        "pdf_budget": 80,
    },
    {
        # Only the *weekly* links carry per-permit rows; the monthly ones on
        # the same page are aggregate highlights. Roughly a month is listed at
        # a time, so history accumulates through first_seen.
        "city": "delta",
        "locality": "Delta",
        "label": "City of Delta",
        "adapter": "pdf_delta",
        "record_type": "issued",
        "index_url": "https://www.delta.ca/building-development/building-renovating",
        "licence": "City of Delta open information",
        "attribution_url": "https://www.delta.ca/building-development/building-renovating",
        "pdf_budget": 40,
    },
    {
        # Publishes no file at all -- the weekly table on the page *is* the
        # feed, and it only shows the current week. History therefore
        # accumulates through first_seen rather than arriving all at once.
        # No construction value is published.
        "city": "port_coquitlam",
        "locality": "Port Coquitlam",
        "label": "City of Port Coquitlam",
        "adapter": "html_table",
        "record_type": "issued",
        "url": "https://www.portcoquitlam.ca/node/4804",
        # Declared, not guessed: "8/11/2026" is ambiguous on its own.
        "date_format": "%m/%d/%Y",
        "licence": "City of Port Coquitlam open information",
        "attribution_url": "https://www.portcoquitlam.ca/node/4804",
        "columns": {
            "permit_id": "PERMIT NUMBER",
            "issue_date": "ISSUE DATE",
            "address_parts": ["UNIT", "HOUSE", "STREET"],
            "permit_type": "PERMIT TYPE",
            "work_code": "REPORT CODE",
            "contractor": "NAME",
            "person_type": "PERSON TYPE",
        },
    },
    {
        "city": "north_vancouver_city",
        "locality": "North Vancouver",
        "label": "City of North Vancouver",
        "adapter": "pdf_cnv",
        "record_type": "issued",
        "index_url": "https://www.cnv.org/Business-Development/Permits-Inspections/building-permit-statistical-reports",
        "licence": "City of North Vancouver open information",
        "attribution_url": "https://www.cnv.org/Business-Development/Permits-Inspections/building-permit-statistical-reports",
        "pdf_budget": 100,
    },
]

# Probed and deliberately excluded. Kept here so nobody re-researches them.
# Every entry was checked directly -- ArcGIS Online, the city's own GIS server,
# and its open-data / reports pages -- not assumed.
#
# Publishes only AGGREGATES (counts and value by category, no per-permit rows):
#   west_vancouver   - the static summary PDFs are fetchable, but contain
#                      nothing to normalize. Its per-permit "by date range"
#                      reports sit behind Cloudflare bot protection, which is
#                      not worked around.
#   abbotsford       - the public SSRS report at
#                      services.abbotsford.ca/OnlineReporting is an "Issued
#                      Building Permits Summary": permits, new units and
#                      construction value per category. Per-property detail is
#                      behind the authenticated portal.
#   langley_city     - "Monthly Reports" are Statistics Canada aggregates.
#
# Publishes nothing per-permit in any form:
#   langley_township - apps.tol.ca/permit.aspx only materializes its table
#                      after an ASP.NET viewstate postback, and the public
#                      building-statistics page carries no per-permit report.
#   dnv              - building footprints only.
#   pitt_meadows,    - checked ArcGIS Online, their own GIS servers and their
#   bowen_island,      open-data pages; nothing published.
#   anmore, belcarra,
#   lions_bay
#   white_rock       - only "2010 to 2014 Building Permits Issued"; dead.
#
# Never touched, by rule:
#   burnaby_mypermits- authenticated portals. Burnaby is covered through its
#   richmond_portal    public daily PDF reports instead, and Richmond through
#                      its public issuance reports.
#
#   victoria         - outside the Lower Mainland; enable by adding a row above.


# ---------------------------------------------------------------------------
# Sources ported from the retired LeadYaRd Node importers (2026-11). Same
# ArcGIS adapter, one config row each. `keep` filters records client-side.
# Development applications are record_type "application": early-stage leads,
# not issued building permits.
# ---------------------------------------------------------------------------
_OGL = "Municipal open data"
SOURCES += [
    {
        "city": "victoria", "locality": "Victoria", "label": "City of Victoria",
        "adapter": "arcgis", "record_type": "issued",
        "url": "https://maps.victoria.ca/server/rest/services/OpenData/OpenData_PermitsAndLicences/MapServer/3",
        "licence": _OGL, "attribution_url": "https://opendata.victoria.ca/",
        "keep": lambda a: str(a.get("type") or a.get("PermitNo") or "").startswith("BP"),
        "fields": {"permit_id": "PermitNo", "issue_date": ["IssuedDate", "CREATED_DATE"],
                   "address": None, "address_parts": ["Unit", "House", "Street"],
                   "work_type": ["SUBJECT", "type", "Purpose"], "use_class": ["ActualUse", "PermitType"],
                   "value": "BldgValue", "applicant": "Name", "contractor": None, "description": "Purpose"},
    },
    {
        "city": "prince_george", "locality": "Prince George", "label": "City of Prince George",
        "adapter": "arcgis", "record_type": "issued",
        "url": "https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/Building_Permit_Applications/FeatureServer/3",
        "licence": _OGL, "attribution_url": "https://data-cityofpg.opendata.arcgis.com/",
        "fields": {"permit_id": "FolderNumber", "issue_date": ["DateIssued", "DateApproved"],
                   "address": None, "address_parts": ["Unit", "Address", "StreetName"],
                   "work_type": ["ReportCode", "Subject"], "use_class": ["Type", "Subject"],
                   "value": "Value", "applicant": None, "contractor": None, "description": "Subject"},
    },
    {
        "city": "kamloops", "locality": "Kamloops", "label": "City of Kamloops",
        "adapter": "arcgis", "record_type": "issued",
        "url": "https://maps.kamloops.ca/arcgis/rest/services/OpenData/OpenDataDevelopment/MapServer/19",
        "licence": _OGL, "attribution_url": "https://mydata-kamloops.opendata.arcgis.com/",
        "keep": lambda a: "BUILDING" in str(a.get("CATEGORY") or "").upper(),
        "fields": {"permit_id": "FOLDER_NUMBER", "issue_date": "COMPLETED_DATE", "address": "ADDRESS",
                   "work_type": ["TYPE", "DESCRIPTION"], "use_class": ["TYPE", "DESCRIPTION"],
                   "value": None, "applicant": None, "contractor": None, "description": "DESCRIPTION"},
    },
    {
        "city": "pemberton", "locality": "Pemberton", "label": "Village of Pemberton",
        "adapter": "arcgis", "record_type": "issued",
        "url": "https://services5.arcgis.com/YdvAKihFVMKJfTGm/arcgis/rest/services/Building_Permits/FeatureServer/35",
        "licence": _OGL, "attribution_url": "https://www.pemberton.ca/",
        "fields": {"permit_id": "BP_BP", "issue_date": ["BP_Date_Issued", "BP_Application_Date"],
                   "address": ["BP_Civic_Address", "Parcel_FullAddress"],
                   "work_type": "BP_Permit_Description", "use_class": "BP_Permit_Description",
                   "value": "BP_Construction_Value", "applicant": "BP_Permit_Contact", "contractor": None,
                   "description": "BP_Permit_Description"},
    },
    {
        "city": "csrd", "locality": None, "label": "Columbia Shuswap RD",
        "adapter": "arcgis", "record_type": "issued",
        "url": "https://services5.arcgis.com/wjH30HL7rqC55zVw/arcgis/rest/services/Building_Permits/FeatureServer/0",
        "licence": _OGL, "attribution_url": "https://www.csrd.bc.ca/",
        "fields": {"permit_id": ["CSRDFile", "CVFile"], "issue_date": ["DateIssued", "DateEntered"],
                   "address": "Location", "work_type": ["Type", "ConstructionType", "Title"],
                   "use_class": ["SubType", "Title"], "value": None, "applicant": "Contact",
                   "contractor": None, "description": "Title"},
    },
    {
        "city": "abbotsford", "locality": "Abbotsford", "label": "City of Abbotsford (development applications)",
        "adapter": "arcgis", "record_type": "application", "kind": "development",
        "url": "https://services8.arcgis.com/ZYlQy38aWlfDG1Qh/arcgis/rest/services/Development_Applications_(Public)/FeatureServer/0",
        "licence": _OGL, "attribution_url": "https://opendata-abbotsford.hub.arcgis.com/",
        "fields": {"permit_id": "REFERENCEFILE", "issue_date": "Application_Received_Date",
                   "address": "Civic_Address", "work_type": "FOLDERDESCRIPTION", "use_class": "FOLDERDESCRIPTION",
                   "value": None, "applicant": "Name", "contractor": None, "description": "FOLDERDESCRIPTION"},
    },
    {
        "city": "langley_township", "locality": "Langley", "label": "Township of Langley (development applications)",
        "adapter": "arcgis", "record_type": "application", "kind": "development",
        "url": "https://services5.arcgis.com/frpHL0Fv8koQRVWY/arcgis/rest/services/DevelopmentActivity_WebApp2018_(Public_view)/FeatureServer/0",
        "licence": _OGL, "attribution_url": "https://data-tol.opendata.arcgis.com/",
        "fields": {"permit_id": ["Folder_number", "Project_Number"], "issue_date": "Application_Date",
                   "address": "Subject", "work_type": "PURPOSE", "use_class": "PURPOSE",
                   "value": None, "applicant": "Name_1", "contractor": None, "description": "PURPOSE"},
    },
    {
        "city": "white_rock", "locality": "White Rock", "label": "City of White Rock (major developments)",
        "adapter": "arcgis", "record_type": "application", "kind": "development",
        "url": "https://services8.arcgis.com/w7ryoLvLDXUgqcf1/arcgis/rest/services/Major_Development/FeatureServer/0",
        "licence": _OGL, "attribution_url": "https://www.whiterockcity.ca/",
        "fields": {"permit_id": "OBJECTID", "issue_date": "StartDate", "address": "Location",
                   "work_type": ["Title", "Descript"], "use_class": ["Title", "Descript"],
                   "value": None, "applicant": None, "contractor": None, "description": ["Descript", "Title"]},
    },
]

# How old a source's newest permit may get before it is flagged stale, by how
# often the city publishes. API feeds and dailies: 14 days; weekly reports: 21;
# monthly reports: 75 (a month's report can land weeks after month end).
MAX_AGE_DAYS = {
    "vancouver": 14, "surrey": 21, "burnaby": 14, "maple_ridge": 14, "new_westminster": 21,
    "richmond": 21, "chilliwack": 21, "delta": 21, "port_coquitlam": 14,
    "coquitlam": 75, "north_vancouver_city": 75, "mission": 75, "squamish": 75,
    "port_moody": 45, "victoria": 21, "prince_george": 30, "kamloops": 30,
    "pemberton": 90, "csrd": 45, "abbotsford": 45, "langley_township": 45, "white_rock": 365,
}
# Sources that are re-read in full every run: zero rows from these is a break.
ALWAYS_RETURNS_ROWS = {"arcgis", "opendatasoft", "html_table", "pdf_coquitlam"}

SOURCES_BY_CITY = {s["city"]: s for s in SOURCES}
