"""Geocoding via the BC Address Geocoder.

Free, no API key, government-run, and it understands BC address formats.
Results are cached by address string on disk so we never pay for the same
address twice -- the cache is committed to the repo alongside the data.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from http_client import FetchError, get_json

log = logging.getLogger(__name__)

ENDPOINT = "https://geocoder.api.gov.bc.ca/addresses.json"

# Below this the geocoder is guessing at the block or the street centroid
# rather than locating the parcel, and a wrong pin is worse than no pin.
MIN_SCORE = 65

# Precision coarser than this places the pin on the town centre, which reads on
# the map as a real location. Rejected outright.
TOO_COARSE = {"LOCALITY", "PROVINCE", "REGIONAL_DISTRICT", "OCCUPANT_NAME"}


def _norm_locality(name: str | None) -> str:
    """Compare locality names ignoring case and the City/District prefix."""
    if not name:
        return ""
    n = re.sub(r"^(city|district|town|village|township|corporation) of\s+", "",
               name.strip(), flags=re.I)
    return re.sub(r"[^a-z]", "", n.lower())


class GeocodeCache:
    def __init__(self, path: Path):
        self.path = path
        self.entries: dict[str, dict] = {}
        self.hits = 0
        self.misses = 0
        self.failures = 0
        if path.exists():
            try:
                self.entries = json.loads(path.read_text())
                log.info("geocode cache: %d addresses", len(self.entries))
            except (json.JSONDecodeError, OSError) as e:
                log.warning("geocode cache unreadable (%s), starting empty", e)

    @staticmethod
    def key(address: str, city: str) -> str:
        """Normalize so casing and spacing variants share one cache slot."""
        return re.sub(r"\s+", " ", f"{address}, {city}, BC").strip().lower()

    def lookup(self, address: str | None, city: str) -> tuple[float | None, float | None]:
        """Return (lat, lon), consulting the cache first.

        Negative results are cached too -- an address the geocoder cannot place
        today will not place tomorrow either, and re-asking daily is rude.
        """
        from schema import parse_coord

        if not address:
            return None, None
        k = self.key(address, city)
        if k in self.entries:
            self.hits += 1
            e = self.entries[k]
            return e.get("lat"), e.get("lon")

        self.misses += 1
        lat = lon = None
        try:
            # `localities` constrains the search to the municipality instead of
            # letting the geocoder roam the province. Without it the matcher
            # will happily fuzz "Burnaby" into "Carnaby Rd, Hazelton Rural" --
            # scoring 78, and landing the pin 743 km north.
            data = get_json(ENDPOINT, params={
                "addressString": address,
                "localities": city,
                "maxResults": 1,
                "outputSRS": 4326,
                "provinceCode": "BC",
            }, timeout=30)
            features = data.get("features") or []
            if features:
                f = features[0]
                props = f.get("properties") or {}
                score = props.get("score", 0)
                precision = (props.get("matchPrecision") or "").upper()
                got_city = _norm_locality(props.get("localityName"))
                coords = (f.get("geometry") or {}).get("coordinates") or []
                # Belt and braces: the constraint should make the locality
                # check redundant, but a mismatch here is exactly the failure
                # that put permits in the wrong half of the province.
                if (score >= MIN_SCORE and precision not in TOO_COARSE
                        and got_city == _norm_locality(city) and len(coords) >= 2):
                    lat, lon = parse_coord(coords[1], coords[0])
        except (FetchError, KeyError, TypeError, ValueError) as e:
            # A geocoder blip must not fail the city; leave it uncached so the
            # next run retries rather than baking in a false negative.
            self.failures += 1
            log.warning("  geocode failed for %r: %s", address, e)
            return None, None

        self.entries[k] = {"lat": lat, "lon": lon}
        return lat, lon

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.entries, indent=0, sort_keys=True))
        tmp.replace(self.path)
        log.info("geocode cache: %d entries (%d hits, %d lookups, %d failures)",
                 len(self.entries), self.hits, self.misses, self.failures)
