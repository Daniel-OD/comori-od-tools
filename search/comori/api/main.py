from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from ..config import ROOT, get_settings
from ..db import connect
from ..search.engine import Filters, Searcher
from ..search.lexical import BM25Index

app = FastAPI(title="Comori Search", version="0.1.0")
# Interfața statică de pe GitHub Pages apelează acest API din browser; lista se poate schimba din .env
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "https://daniel-od.github.io").split(",") if o.strip()],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
_bm25: BM25Index | None = None


@contextmanager
def searcher():
    global _bm25
    conn = connect()
    try:
        s = Searcher(conn, bm25=_bm25)
        yield s
        _bm25 = s._bm25 or _bm25
    finally:
        conn.close()


def _filters(author, book, volume, category) -> Filters:
    return Filters(author or None, book or None, volume or None, category or None)


@app.get("/api/search")
def search(q: str = Query(..., min_length=1), mode: str = "hybrid", author: str = "", book: str = "", volume: str = "",
           category: str = "", limit: int = Query(20, le=100), offset: int = 0):
    if mode not in {"hybrid", "lexical", "semantic", "idea", "phrase"}:
        raise HTTPException(400, "mod necunoscut")
    with searcher() as s:
        return s.search(q, mode, _filters(author, book, volume, category), limit, offset)


class IdeaIn(BaseModel):
    text: str
    author: str = ""
    book: str = ""
    volume: str = ""
    category: str = ""
    limit: int = 20
    offset: int = 0


@app.post("/api/idea")
def idea(body: IdeaIn):
    if len(body.text.split()) < 3:
        raise HTTPException(400, "Introdu cel puțin o propoziție scurtă sau câteva cuvinte.")
    with searcher() as s:
        return s.idea_search(body.text, _filters(body.author, body.book, body.volume, body.category),
                             min(body.limit, 100), body.offset)


@app.get("/api/related/{article_id}")
def related(article_id: int, limit: int = Query(10, le=50)):
    with searcher() as s:
        return s.related(article_id, limit)


@app.get("/api/article/{article_id}")
def article(article_id: int):
    with searcher() as s:
        r = s.conn.execute(
            """SELECT a.id, a.title, a.url, a.text, a.keywords, a.phrases, a.themes, a.category, a.position, a.total_in_book,
                      au.name AS author, bk.title AS book, vo.title AS volume
               FROM articles a LEFT JOIN authors au ON au.id=a.author_id LEFT JOIN books bk ON bk.id=a.book_id
               LEFT JOIN volumes vo ON vo.id=a.volume_id WHERE a.id=%s""", [article_id]).fetchone()
        if not r:
            raise HTTPException(404, "articol inexistent")
        r["bible_refs"] = [x["ref_text"] for x in s.conn.execute("SELECT ref_text FROM bible_refs WHERE article_id=%s ORDER BY id", [article_id])]
        return r


@app.get("/api/facets")
def facets():
    with searcher() as s:
        q = s.conn.execute
        return {
            "authors": q("SELECT slug, name FROM authors ORDER BY name").fetchall(),
            "books": q("SELECT slug, title FROM books ORDER BY title").fetchall(),
            "volumes": q("SELECT slug, title FROM volumes ORDER BY title").fetchall(),
            "categories": [r["category"] for r in q("SELECT DISTINCT category FROM articles WHERE category IS NOT NULL ORDER BY 1")],
        }


@app.get("/api/stats")
def stats():
    with searcher() as s:
        q = s.conn.execute
        return {"articles": q("SELECT count(*) n FROM articles WHERE duplicate_of IS NULL").fetchone()["n"],
                "duplicates": q("SELECT count(*) n FROM articles WHERE duplicate_of IS NOT NULL").fetchone()["n"],
                "passages": q("SELECT count(*) n FROM passages").fetchone()["n"],
                "embedded": q("SELECT count(*) n FROM passages WHERE embedding IS NOT NULL").fetchone()["n"],
                "embed_model": get_settings().embed_model}


WEB = ROOT / "web"
app.mount("/static", StaticFiles(directory=WEB), name="static")


@app.get("/")
def index():
    return FileResponse(WEB / "index.html")
