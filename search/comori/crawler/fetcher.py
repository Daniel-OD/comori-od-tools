"""Client HTTP politicos: robots.txt, limită de rată, cache pe disc, fără ocolirea blocajelor."""
from __future__ import annotations

import hashlib
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser

import httpx


class AccessBlocked(Exception):
    """Site-ul a refuzat accesul (robots.txt sau 401/403). Nu se încearcă ocolirea."""


class NotFound(Exception):
    pass


class PoliteFetcher:
    def __init__(self, user_agent: str, interval: float, cache_dir: Path, respect_robots: bool = True,
                 timeout: float = 30.0):
        self.ua = user_agent
        self.interval = interval
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.respect_robots = respect_robots
        self.client = httpx.Client(headers={"User-Agent": user_agent, "Accept-Language": "ro,en;q=0.5"},
                                   timeout=timeout, follow_redirects=True)
        self._robots: dict[str, RobotFileParser | None] = {}
        self._last = 0.0

    # ----------------------------------------------------------- robots
    def _robots_for(self, url: str) -> RobotFileParser | None:
        host = "{0.scheme}://{0.netloc}".format(urlsplit(url))
        if host in self._robots:
            return self._robots[host]
        rp: RobotFileParser | None = RobotFileParser()
        try:
            r = self.client.get(host + "/robots.txt")
            if r.status_code == 200:
                rp.parse(r.text.splitlines())
            elif r.status_code in (404, 410):
                rp = None  # fără robots.txt = fără restricții declarate
            else:  # 401/403/5xx: prudență
                rp.parse(["User-agent: *", "Disallow: /"])
        except httpx.HTTPError:
            rp.parse(["User-agent: *", "Disallow: /"])
        self._robots[host] = rp
        if rp is not None:
            delay = rp.crawl_delay(self.ua)
            if delay:
                self.interval = max(self.interval, float(delay))
        return rp

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        rp = self._robots_for(url)
        return True if rp is None else rp.can_fetch(self.ua, url)

    def sitemaps(self, url: str) -> list[str]:
        rp = self._robots_for(url)
        return list(rp.site_maps() or []) if rp else []

    # -------------------------------------------------------------- get
    def _cache_path(self, url: str) -> Path:
        return self.cache_dir / (hashlib.sha1(url.encode()).hexdigest() + ".html")

    def get(self, url: str, use_cache: bool = True) -> str:
        cp = self._cache_path(url)
        if use_cache and cp.exists():
            return cp.read_text(encoding="utf-8")
        if not self.allowed(url):
            raise AccessBlocked(f"robots.txt interzice accesul la {url}")
        for attempt in range(4):
            wait = self.interval - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                r = self.client.get(url)
            except httpx.HTTPError:
                time.sleep(2 ** attempt)
                continue
            if r.status_code == 200:
                cp.write_text(r.text, encoding="utf-8")
                return r.text
            if r.status_code in (401, 403):
                raise AccessBlocked(f"{r.status_code} la {url}: accesul e refuzat; opresc, nu încerc ocolirea.")
            if r.status_code in (404, 410):
                raise NotFound(url)
            if r.status_code == 429 or r.status_code >= 500:
                ra = r.headers.get("Retry-After", "")
                time.sleep(int(ra) if ra.isdigit() else 5 * (attempt + 1))
                continue
            raise NotFound(f"{r.status_code} {url}")
        raise NotFound(f"fără răspuns valid după reîncercări: {url}")
