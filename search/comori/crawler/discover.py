"""Verifică dacă există o sursă de date mai eficientă decât HTML-ul, fără a ocoli ceva.

Citește doar resurse publice, pe care browserul le încarcă oricum: pagina de articol, robots.txt,
sitemap-urile declarate și fișierele JS statice (pentru a găsi adrese de API). NU încearcă
autentificare, chei sau endpoint-uri nedocumentate: doar raportează ce a găsit.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup

from .fetcher import PoliteFetcher

_API_RE = re.compile(r"https?://[\w.-]*api[\w.-]*\.[a-z]{2,}[^\s\"'`)<>]*|[\"'`](/api/[\w/\-\.]+)", re.I)


def discover(f: PoliteFetcher, sample_article_url: str) -> dict:
    report: dict = {"sample": sample_article_url, "robots": {}, "api_candidates": [], "next_data": False,
                    "sitemaps": [], "notes": []}
    base = "{0.scheme}://{0.netloc}".format(urlsplit(sample_article_url))
    report["robots"]["article_allowed"] = f.allowed(sample_article_url)
    report["sitemaps"] = f.sitemaps(base + "/")
    html = f.get(sample_article_url)
    soup = BeautifulSoup(html, "lxml")
    report["next_data"] = bool(soup.find("script", id="__NEXT_DATA__"))
    cands: set[str] = set(m.group(0).strip("\"'`") for m in _API_RE.finditer(html))
    scripts = [urljoin(sample_article_url, s["src"]) for s in soup.find_all("script", src=True)]
    for src in scripts[:25]:
        if urlsplit(src).netloc != urlsplit(base).netloc:
            continue
        try:
            js = f.get(src)
        except Exception:
            continue
        cands.update(m.group(0).strip("\"'`") for m in _API_RE.finditer(js))
    report["api_candidates"] = sorted(c for c in cands if len(c) < 200)[:50]
    for c in report["api_candidates"]:
        if c.startswith("http"):
            report.setdefault("api_robots", {})[c] = f.allowed(c)
    report["notes"] += [
        "Folosește un API doar dacă este documentat/permis de site (termeni, robots.txt) și nu cere autentificare.",
        "Dacă nu e clar, cere un export de la administratorii Comori OD: e cea mai curată cale pentru toată arhiva.",
    ]
    return report


def dump(report: dict) -> str:
    return json.dumps(report, ensure_ascii=False, indent=2)
