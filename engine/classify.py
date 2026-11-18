"""Canonicalize work_type and use_class across cities.

Every city names these differently -- Squamish says "SUD-NEW", Vancouver says
"New Building", Surrey says "New Construction". Left verbatim, a cross-city
filter is useless, so values are mapped onto the small vocabulary the schema
describes. The city's original string is always preserved in `raw`.
"""
from __future__ import annotations

import re

WORK_TYPES = ["new", "addition", "alteration", "demolition", "repair",
              "temporary", "other"]
USE_CLASSES = ["residential", "commercial", "industrial", "institutional",
               "mixed", "other"]

# Order matters: the first pattern to match wins, so the more specific
# patterns are listed above the general ones.
_WORK_RULES = [
    ("demolition", r"\bdemo|\bdemolit|\bdeconstruct|\bremov(e|al) of building"),
    ("addition",   r"\badd(ition|n)?\b|\bextension\b|-add\b|\bad-|\bsecondary suite\b"),
    ("alteration", r"\balter|\brenovat|\bremodel|\bimprovement|\brepair.*alter|"
                   r"\binterior\b|\btenant\b|\bt\.?i\.?\b|\balt\b|-alt\b"),
    ("repair",     r"\brepair|\brestor|\bre-?roof|\bfoundation\b|\bupgrade\b"),
    ("temporary",  r"\btemporar|\btent\b|\bsales centre\b|\bconstruction trailer\b"),
    # Chilliwack's Tempest codes prefix the work type: NW-APT, NW-SFD, AD-SFD.
    ("new",        r"\bnew\b|\bconstruct|\bbuild\b|-new\b|\berect\b|\bnw-"),
]

_USE_RULES = [
    ("mixed",         r"\bmixed[ -]?use\b|\bcomm(ercial)?/res|\bres/comm"),
    ("institutional", r"\binstitution|\bschool\b|\bchurch\b|\bhospital\b|\bcivic\b|"
                      r"\bassembly\b|\bgovernment\b|\bpublic\b|\bcare facility\b"),
    ("industrial",    r"\bindustrial\b|\bwarehouse\b|\bmanufactur|\bfactory\b"),
    ("commercial",    r"\bcommercial\b|\bretail\b|\boffice\b|\bhotel\b|\bmotel\b|"
                      r"\brestaurant\b|\bbusiness\b|\bmercantile\b|\bstore\b"),
    ("residential",   r"\bresidential\b|\bdwelling\b|\bhouse\b|\bhome\b|\bsuite\b|"
                      r"\bapartment\b|\bcondo|\btownhouse\b|\bduplex\b|\bsud\b|"
                      r"\bmud\b|\btud\b|\bsingle famil|\bmulti[ -]?famil|\blaneway\b|"
                      # SFD / ESFD are how North Vancouver and Burnaby write
                      # "single family dwelling"; garden and coach houses too.
                      r"\be?sfd\b|\bcoach house\b|\bgarden suite\b|\browhouse\b"),
]


def _apply(rules: list[tuple[str, str]], *values: str | None) -> str | None:
    """Match the combined text of every candidate field against the rules."""
    text = " ".join(v for v in values if v).lower()
    if not text:
        return None
    for label, pattern in rules:
        if re.search(pattern, text):
            return label
    return "other"


def work_type(*values: str | None) -> str | None:
    return _apply(_WORK_RULES, *values)


def use_class(*values: str | None) -> str | None:
    return _apply(_USE_RULES, *values)
