"""Crawler modular și reluabil. Scrie un rând JSON per articol în data/articles.jsonl."""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Callable

from .fetcher import AccessBlocked, NotFound, PoliteFetcher
from .parsers import canon_url, classify, parse_article, parse_listing


def _seen_urls(path: Path) -> set[str]:
    if not path.exists():
        return set()
    out = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            out.add(json.loads(line)["url"])
    return out


def round_robin(groups: dict[str, list[str]], limit: int | None) -> list[str]:
    """Alege articole alternând între grupuri (cărți/autori), ca lotul-pilot să fie divers."""
    order, seen = [], set()
    iters = [iter(v) for v in groups.values()]
    while iters and (limit is None or len(order) < limit):
        nxt = []
        for it in iters:
            for u in it:
                if u not in seen:
                    seen.add(u)
                    order.append(u)
                    nxt.append(it)
                    break
            if limit is not None and len(order) >= limit:
                break
        iters = nxt
    return order


def discover_listings(f: PoliteFetcher, seeds: list[str], want_articles: int | None, max_listings: int,
                      log: Callable[[str], None]) -> dict[str, list[str]]:
    q, seen = deque(seeds), set()
    groups: dict[str, list[str]] = {}
    total = 0
    while q and len(seen) < max_listings:
        u = q.popleft()
        if u in seen:
            continue
        seen.add(u)
        try:
            L = parse_listing(f.get(u), u)
        except NotFound:
            continue
        arts = [a for a, _ in L.articles]
        if arts:
            groups[u] = arts
            total += len(arts)
        q.extend(L.pages + L.books + L.volumes + L.authors)
        log(f"listare {len(seen)}: {u} -> {len(arts)} articole")
        if want_articles and total >= want_articles * 3 and len(groups) >= 10:
            break
    return groups


def crawl(f: PoliteFetcher, base_url: str, out_path: Path, limit: int | None = None,
          seeds: list[str] | None = None, follow_chain: bool = True, max_listings: int = 5000,
          log: Callable[[str], None] = print) -> int:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    done = _seen_urls(out_path)
    seed_urls = [canon_url(base_url, s) for s in (seeds or [base_url])]
    article_seeds = [s for s in seed_urls if classify(s)[0] == "article"]
    listing_seeds = [s for s in seed_urls if classify(s)[0] != "article"]

    groups = discover_listings(f, listing_seeds, limit, max_listings, log) if listing_seeds else {}
    queue = deque(article_seeds + round_robin(groups, limit))
    if not queue:
        log("Nu am găsit linkuri către articole în pagini de listare (posibil conținut încărcat din JavaScript). "
            "Folosește --seed URL_ARTICOL ca să pornești lanțul anterior/următor.")
    queued = set(queue)
    n_new = 0
    with out_path.open("a", encoding="utf-8") as fh:
        try:
            while queue and (limit is None or n_new < limit):
                u = queue.popleft()
                if u in done:
                    continue
                try:
                    rec = parse_article(f.get(u), u)
                except NotFound:
                    log(f"404: {u}")
                    continue
                if len(rec["text"].split()) < 5:
                    log(f"text prea scurt/gol (verifică selectorii): {u}")
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                fh.flush()
                done.add(u)
                n_new += 1
                if n_new % 10 == 0:
                    log(f"{n_new} articole salvate")
                if follow_chain:
                    for nb in (rec["next_url"], rec["prev_url"]):
                        if nb and nb not in done and nb not in queued and (limit is None or limit > len(queued)):
                            queued.add(nb)
                            queue.append(nb)
        except AccessBlocked as e:
            log(f"OPRIT: {e}")
    log(f"Gata: {n_new} articole noi în {out_path}")
    return n_new
