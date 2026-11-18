"""Shared HTTP client: one request per second, real user agent, back off on errors."""
from __future__ import annotations

import logging
import random
import re
import threading
import time
from typing import Any

import requests

log = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (compatible; bc-permit-dash/1.0; open data aggregator; "
    "+https://github.com/) requests"
)

MIN_INTERVAL = 1.0  # seconds between requests, per the politeness rule
MAX_RETRIES = 4


class RateLimiter:
    """One request per second per host, shared across adapters."""

    def __init__(self, min_interval: float = MIN_INTERVAL):
        self.min_interval = min_interval
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, host: str) -> None:
        with self._lock:
            now = time.monotonic()
            gap = now - self._last.get(host, 0.0)
            if gap < self.min_interval:
                time.sleep(self.min_interval - gap)
            self._last[host] = time.monotonic()


_limiter = RateLimiter()
_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})


class FetchError(RuntimeError):
    pass


def _request(method: str, url: str, params=None, data=None, timeout: int = 60) -> Any:
    """Rate-limited JSON request with exponential backoff.

    Raises FetchError once retries are exhausted so the caller can decide to
    skip this city rather than fail the whole run.
    """
    host = requests.utils.urlparse(url).netloc
    last_err: Exception | None = None

    for attempt in range(MAX_RETRIES):
        _limiter.wait(host)
        try:
            if method == "POST":
                r = _session.post(url, data=data, timeout=timeout)
            else:
                r = _session.get(url, params=params, timeout=timeout)
            # 429/5xx are worth waiting out; 4xx otherwise is our bug, not theirs.
            if r.status_code == 429 or r.status_code >= 500:
                raise FetchError(f"HTTP {r.status_code} from {host}")
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, FetchError, ValueError) as e:
            last_err = e
            if attempt == MAX_RETRIES - 1:
                break
            backoff = (2 ** attempt) + random.uniform(0, 0.5)
            log.warning("  %s (attempt %d/%d), retrying in %.1fs",
                        _brief(e), attempt + 1, MAX_RETRIES, backoff)
            time.sleep(backoff)

    raise FetchError(f"{method} {url[:120]} failed after {MAX_RETRIES} attempts: {_brief(last_err)}")


def _brief(e) -> str:
    """Object-id queries produce multi-kilobyte URLs; keep logs readable."""
    return re.sub(r"(https?://[^\s]{100})[^\s]*", r"\1...", str(e))


def get_json(url: str, params: dict[str, Any] | None = None, timeout: int = 60) -> Any:
    return _request("GET", url, params=params, timeout=timeout)


def get_bytes(url: str, timeout: int = 90) -> bytes:
    """Fetch a binary document (PDF), rate-limited like everything else."""
    host = requests.utils.urlparse(url).netloc
    last_err: Exception | None = None
    for attempt in range(MAX_RETRIES):
        _limiter.wait(host)
        try:
            r = _session.get(url, timeout=timeout, headers={"Accept": "application/pdf,*/*"})
            if r.status_code == 429 or r.status_code >= 500:
                raise FetchError(f"HTTP {r.status_code} from {host}")
            r.raise_for_status()
            return r.content
        except (requests.RequestException, FetchError) as e:
            last_err = e
            if attempt == MAX_RETRIES - 1:
                break
            time.sleep((2 ** attempt) + random.uniform(0, 0.5))
    raise FetchError(f"GET {url[:120]} failed: {_brief(last_err)}")


def get_text(url: str, timeout: int = 60) -> str:
    """Fetch an HTML page (for scraping links out of a report index)."""
    host = requests.utils.urlparse(url).netloc
    _limiter.wait(host)
    r = _session.get(url, timeout=timeout, headers={"Accept": "text/html,*/*"})
    r.raise_for_status()
    return r.text


def post_json(url: str, data: dict[str, Any], timeout: int = 60) -> Any:
    """ArcGIS /query with a long objectIds list must go over POST -- servers
    reject or 404 the equivalent GET once the URL passes ~4KB."""
    return _request("POST", url, data=data, timeout=timeout)
