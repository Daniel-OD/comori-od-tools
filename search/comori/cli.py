"""Linia de comandă: python -m comori.cli <comandă>"""
from __future__ import annotations

import argparse
import json
import sys

from .config import get_settings


def _fetcher(respect_robots: bool = True):
    from .crawler.fetcher import PoliteFetcher

    s = get_settings()
    return PoliteFetcher(s.user_agent, s.request_interval, s.raw_dir, respect_robots)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="comori")
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("discover", help="verifică API/sitemap/robots (doar citire)")
    d.add_argument("url", nargs="?", help="URL de articol-exemplu")
    i = sub.add_parser("inspect", help="parsează o pagină și afișează rezultatul (pentru ajustarea selectorilor)")
    i.add_argument("url")
    c = sub.add_parser("crawl", help="descarcă articole în data/articles.jsonl (reluabil)")
    c.add_argument("--limit", type=int, default=None, help="ex. 150 pentru lotul-pilot")
    c.add_argument("--seed", action="append", help="URL de pornire (listă sau articol); repetabil")
    c.add_argument("--no-chain", action="store_true", help="nu urma anterior/următor")
    sub.add_parser("init-db", help="creează schema PostgreSQL + pgvector")
    sub.add_parser("ingest", help="încarcă JSONL în baza de date (idempotent)")
    sub.add_parser("keywords", help="cuvinte-cheie, expresii, teme")
    sub.add_parser("embed", help="calculează embeddings lipsă")
    sub.add_parser("build-bm25", help="construiește indexul BM25")
    sub.add_parser("index", help="ingest + keywords + embed + build-bm25")
    sub.add_parser("stats")
    sv = sub.add_parser("serve")
    sv.add_argument("--host", default="127.0.0.1")
    sv.add_argument("--port", type=int, default=8000)
    e = sub.add_parser("eval", help="evaluează căutarea pe eval/queries.yaml")
    e.add_argument("--csv", help="scrie rezultatele pentru etichetare manuală")
    a = ap.parse_args(argv)
    s = get_settings()

    if a.cmd == "discover":
        from .crawler.discover import discover, dump

        url = a.url or input("URL articol-exemplu: ").strip()
        rep = discover(_fetcher(), url)
        (s.data_dir).mkdir(parents=True, exist_ok=True)
        (s.data_dir / "discovery.json").write_text(dump(rep), encoding="utf-8")
        print(dump(rep))
    elif a.cmd == "inspect":
        from .crawler.parsers import parse_article

        rec = parse_article(_fetcher().get(a.url), a.url)
        rec["text"] = rec["text"][:1500] + ("…" if len(rec["text"]) > 1500 else "")
        print(json.dumps(rec, ensure_ascii=False, indent=2))
    elif a.cmd == "crawl":
        from .crawler.crawl import crawl

        crawl(_fetcher(), s.base_url, s.articles_jsonl, a.limit, a.seed, not a.no_chain)
    elif a.cmd == "init-db":
        from .db import init_schema

        init_schema()
        print(f"schema creată (vector({s.embed_dim}))")
    elif a.cmd in ("ingest", "keywords", "embed", "build-bm25", "index", "stats"):
        from .db import connect

        with connect() as conn:
            if a.cmd in ("ingest", "index"):
                from .indexing.ingest import ingest

                ingest(conn, s.articles_jsonl)
            if a.cmd in ("keywords", "index"):
                from .indexing.keywords import compute

                compute(conn)
            if a.cmd in ("embed", "index"):
                from .indexing.embed import embed_missing
                from .indexing.embedder import get_embedder

                embed_missing(conn, get_embedder(s))
            if a.cmd in ("build-bm25", "index"):
                from .indexing.build_bm25 import build

                build(conn)
            if a.cmd == "stats":
                q = conn.execute
                print({"articole": q("SELECT count(*) n FROM articles WHERE duplicate_of IS NULL").fetchone()["n"],
                       "duplicate": q("SELECT count(*) n FROM articles WHERE duplicate_of IS NOT NULL").fetchone()["n"],
                       "pasaje": q("SELECT count(*) n FROM passages").fetchone()["n"],
                       "cu_embedding": q("SELECT count(*) n FROM passages WHERE embedding IS NOT NULL").fetchone()["n"]})
    elif a.cmd == "serve":
        import uvicorn

        uvicorn.run("comori.api.main:app", host=a.host, port=a.port)
    elif a.cmd == "eval":
        from eval.run_eval import run

        run(a.csv)
    return 0


if __name__ == "__main__":
    sys.exit(main())
