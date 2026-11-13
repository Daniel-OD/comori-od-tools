from __future__ import annotations

from ..config import get_settings
from ..search.lexical import BM25Index
from ..text import analyze


def build(conn, log=print) -> BM25Index:
    with conn.cursor() as cur:
        cur.execute("SELECT p.id, a.title || ' ' || p.text AS t FROM passages p JOIN articles a ON a.id=p.article_id WHERE a.duplicate_of IS NULL ORDER BY p.id")
        rows = cur.fetchall()
    idx = BM25Index().fit([r["id"] for r in rows], [analyze(r["t"]) for r in rows])
    idx.save(get_settings().index_dir)
    log(f"BM25: {len(rows)} pasaje, {len(idx.vocab)} termeni")
    return idx
