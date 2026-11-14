"""Parsere HTML pentru Comori OD.

Structura a fost dedusă dintr-o pagină reală de articol (linkuri /author/, /book/, /volume/,
/bible/, anterior/următor, „Articol N din M”). Selectorii sunt euristici; dacă site-ul se schimbă,
rulează `python -m comori.cli inspect URL` și ajustează `parse_article`.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from ..bible import merge_refs, refs_from_link, refs_from_text
from ..text import normalize_ro, search_form

KINDS = ("article", "author", "book", "volume", "bible")
_BOILERPLATE = [
    re.compile(r"^articol\s+\d+\s+din\s+\d+$", re.I),
    re.compile(r"s[ăa]ge[țt]i", re.I),
    re.compile(r"^(anterior|urm[ăa]torul|precedent|înapoi|inapoi|comori od)$", re.I),
]
_INLINE = ["a", "span", "em", "strong", "b", "i", "u", "sup", "sub", "small", "mark", "font"]


def canon_url(base: str, href: str) -> str:
    u = urlsplit(urljoin(base, href))
    return urlunsplit((u.scheme, u.netloc, u.path.rstrip("/") or "/", u.query, ""))


def classify(url: str) -> tuple[str, str]:
    path = urlsplit(url).path
    for kind in KINDS:
        m = re.match(rf"^/{kind}/([^/]+)", path)
        if m:
            return kind, m.group(1)
    return "other", ""


def _slug_to_name(slug: str) -> str:
    return slug.replace("-", " ").strip().title()


def _clean_title(t: str) -> str:
    return normalize_ro(re.sub(r"\s*\|\s*Comori OD\s*$", "", t.strip()))


def _next_data(soup) -> dict | None:
    tag = soup.find("script", id="__NEXT_DATA__")
    if tag and tag.string:
        try:
            return json.loads(tag.string)
        except ValueError:
            return None
    return None


def _longest_body(obj, best=None):
    """Caută recursiv în JSON-ul Next.js cel mai lung șir sub chei de tip content/text/body."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and k.lower() in {"content", "text", "body", "html"} and len(v) > (len(best or "")):
                best = v
            else:
                best = _longest_body(v, best)
    elif isinstance(obj, list):
        for v in obj:
            best = _longest_body(v, best)
    return best


def _block_text(root) -> str:
    for br in root.find_all("br"):
        br.replace_with("\n")
    for t in root.find_all(_INLINE):
        t.unwrap()
    root.smooth()
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in root.get_text("\n").split("\n")]
    return "\n".join(ln for ln in lines if ln)


def _strip_boilerplate(text: str, title: str, author: str, book: str, extras: list[str]) -> str:
    drop = {search_form(x) for x in extras if x}
    t_norm = re.sub(r"\W+", "", search_form(title))
    out, first = [], True
    for ln in text.split("\n"):
        sf = search_form(ln)
        if any(p.search(ln.strip()) for p in _BOILERPLATE) or sf in drop:
            continue
        if first and re.sub(r"\W+", "", sf) == t_norm:
            first = False
            continue
        if author and book and sf.startswith(search_form(author)) and sf.endswith(search_form(book)):
            continue  # linia „Autor - Carte”
        first = False
        out.append(ln)
    return "\n".join(out).strip()


def parse_article(html: str, url: str, body_selector: str | None = None) -> dict:
    soup = BeautifulSoup(html, "lxml")
    kind, slug = classify(url)
    nd = _next_data(soup)

    h1 = soup.find("h1")
    title = _clean_title(h1.get_text(" ", strip=True)) if h1 else ""
    if not title:
        og = soup.find("meta", property="og:title")
        title = _clean_title(og["content"]) if og and og.get("content") else _clean_title(soup.title.string or "") if soup.title else ""

    meta: dict[str, dict] = {"author": {}, "book": {}, "volume": {}}
    prev_url = next_url = category = None
    bible_links = []
    for a in soup.find_all("a", href=True):
        u = canon_url(url, a["href"])
        k, s = classify(u)
        label = a.get_text(" ", strip=True) or (a.find("img")["alt"] if a.find("img") and a.find("img").get("alt") else "")
        if k in meta and (not meta[k] or (label and not meta[k].get("label"))):
            meta[k] = {"slug": s, "url": u, "label": label}
        elif k == "bible":
            r = refs_from_link(a["href"])
            if r:
                bible_links.append(r)
        elif k == "article" and u != url:
            hint = " ".join([label, a.get("aria-label", ""), a.get("title", ""), a.get("rel", [""])[0] if a.get("rel") else ""])
            if re.search(r"anterior|precedent|previous|prev", hint, re.I):
                prev_url = prev_url or u
            elif re.search(r"urm[ăa]tor|next", hint, re.I):
                next_url = next_url or u
        if "/category/" in u or "/categorie/" in u:
            category = category or label

    author = normalize_ro(meta["author"].get("label") or _slug_to_name(meta["author"].get("slug", "")))
    book = normalize_ro(meta["book"].get("label") or _slug_to_name(meta["book"].get("slug", "")))
    volume = normalize_ro(meta["volume"].get("label") or _slug_to_name(meta["volume"].get("slug", "")))

    text_page = soup.get_text(" ", strip=True)
    pm = re.search(r"Articol\s+(\d+)\s+din\s+(\d+)", text_page, re.I)
    position, total = (int(pm.group(1)), int(pm.group(2))) if pm else (None, None)

    published = None
    mt = soup.find("meta", property="article:published_time")
    tt = soup.find("time", attrs={"datetime": True})
    for cand in (mt["content"] if mt and mt.get("content") else None, tt["datetime"] if tt else None):
        if cand and re.match(r"\d{4}-\d{2}-\d{2}", cand):
            published = cand[:10]
            break

    # corp
    root = soup.select_one(body_selector) if body_selector else (soup.find("article") or soup.find("main") or soup.body)
    for t in root.find_all(["script", "style", "nav", "header", "footer", "aside", "noscript", "svg", "button", "form", "img"]):
        t.decompose()
    for a in root.find_all("a", href=True):  # linkuri de navigare nu fac parte din text
        if classify(canon_url(url, a["href"]))[0] in ("author", "book", "volume", "article"):
            a.decompose()
    body = _block_text(root)
    if nd:
        cand = _longest_body(nd)
        if cand and len(cand) > 1.3 * len(body):
            body = _block_text(BeautifulSoup(cand, "lxml")) if "<" in cand else cand
    extras = [meta[k].get("label", "") for k in meta] + [title]
    body = normalize_ro(_strip_boilerplate(body, title, author, book, extras))

    refs = merge_refs(bible_links, refs_from_text(body))
    return {
        "url": canon_url(url, url), "slug": slug, "title": title,
        "author_name": author, "author_slug": meta["author"].get("slug", ""), "author_url": meta["author"].get("url"),
        "book_title": book, "book_slug": meta["book"].get("slug", ""), "book_url": meta["book"].get("url"),
        "volume_title": volume, "volume_slug": meta["volume"].get("slug", ""), "volume_url": meta["volume"].get("url"),
        "position": position, "total_in_book": total, "category": category, "published_at": published,
        "prev_url": prev_url, "next_url": next_url, "text": body, "bible_refs": refs,
        "content_hash": hashlib.sha1(search_form(body).encode()).hexdigest(),
        "parser": "html+next_data" if nd else "html",
    }


@dataclass
class Listing:
    articles: list[tuple[str, str]] = field(default_factory=list)  # (url, titlu)
    authors: list[str] = field(default_factory=list)
    books: list[str] = field(default_factory=list)
    volumes: list[str] = field(default_factory=list)
    pages: list[str] = field(default_factory=list)  # paginare


def parse_listing(html: str, url: str) -> Listing:
    soup = BeautifulSoup(html, "lxml")
    L = Listing()
    seen: set[str] = set()
    base_path = urlsplit(url).path
    for a in soup.find_all("a", href=True):
        u = canon_url(url, a["href"])
        if urlsplit(u).netloc != urlsplit(url).netloc or u in seen:
            continue
        seen.add(u)
        k, _ = classify(u)
        if re.search(r"[?&]page=\d+", u) and k != "article":
            L.pages.append(u)  # paginare a aceleiași liste (carte/autor/volum)
        elif k == "article":
            L.articles.append((u, a.get_text(" ", strip=True)))
        elif k == "author":
            L.authors.append(u)
        elif k == "book":
            L.books.append(u)
        elif k == "volume":
            L.volumes.append(u)
    return L
