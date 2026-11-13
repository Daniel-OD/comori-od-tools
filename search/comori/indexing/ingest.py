"""JSONL -> PostgreSQL: autori/cărți/volume/articole, dedublare, pasaje, referințe biblice."""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..text import chunk_text, normalize_ro, search_form


def _upsert_simple(cur, table: str, slug: str, name_col: str, name: str, url: str | None, extra: dict | None = None) -> int | None:
    if not slug:
        return None
    cols = {"slug": slug, name_col: name or slug, "url": url, **(extra or {})}
    names = ", ".join(cols)
    ph = ", ".join(f"%({c})s" for c in cols)
    upd = ", ".join(f"{c}=EXCLUDED.{c}" for c in cols if c != "slug")
    cur.execute(f"INSERT INTO {table} ({names}) VALUES ({ph}) ON CONFLICT (slug) DO UPDATE SET {upd} RETURNING id", cols)
    return cur.fetchone()["id"]


def ingest(conn, jsonl: Path, log=print) -> dict:
    stats = {"new": 0, "updated": 0, "unchanged": 0, "duplicates": 0, "passages": 0}
    with conn.cursor() as cur:
        for line in jsonl.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            r = json.loads(line)
            text = normalize_ro(r["text"])
            if not text.strip() or not r.get("title"):
                continue
            aid = _upsert_simple(cur, "authors", r["author_slug"], "name", r["author_name"], r.get("author_url"))
            bid = _upsert_simple(cur, "books", r["book_slug"], "title", r["book_title"], r.get("book_url"), {"author_id": aid})
            vid = _upsert_simple(cur, "volumes", r["volume_slug"], "title", r["volume_title"], r.get("volume_url"))
            chash = r.get("content_hash") or re.sub(r"\s+", " ", search_form(text))
            cur.execute("SELECT id, content_hash FROM articles WHERE url=%s", (r["url"],))
            ex = cur.fetchone()
            if ex and ex["content_hash"] == chash:
                stats["unchanged"] += 1
                continue
            cur.execute("SELECT id FROM articles WHERE content_hash=%s AND url<>%s AND duplicate_of IS NULL ORDER BY id LIMIT 1",
                        (chash, r["url"]))
            dup = cur.fetchone()
            vals = dict(slug=r["slug"], url=r["url"], title=normalize_ro(r["title"]), author_id=aid, book_id=bid, volume_id=vid,
                        position=r.get("position"), total=r.get("total_in_book"), category=r.get("category"),
                        published=r.get("published_at"), text=text, chash=chash, dup=dup["id"] if dup else None)
            if ex:
                cur.execute("""UPDATE articles SET slug=%(slug)s,title=%(title)s,author_id=%(author_id)s,book_id=%(book_id)s,
                    volume_id=%(volume_id)s,position=%(position)s,total_in_book=%(total)s,category=%(category)s,
                    published_at=%(published)s,text=%(text)s,content_hash=%(chash)s,duplicate_of=%(dup)s,fetched_at=now()
                    WHERE id=%(id)s""", {**vals, "id": ex["id"]})
                art_id = ex["id"]
                cur.execute("DELETE FROM passages WHERE article_id=%s", (art_id,))
                cur.execute("DELETE FROM bible_refs WHERE article_id=%s", (art_id,))
                stats["updated"] += 1
            else:
                cur.execute("""INSERT INTO articles (slug,url,title,author_id,book_id,volume_id,position,total_in_book,category,
                    published_at,text,content_hash,duplicate_of) VALUES (%(slug)s,%(url)s,%(title)s,%(author_id)s,%(book_id)s,
                    %(volume_id)s,%(position)s,%(total)s,%(category)s,%(published)s,%(text)s,%(chash)s,%(dup)s) RETURNING id""", vals)
                art_id = cur.fetchone()["id"]
                stats["new"] += 1
            if dup:
                stats["duplicates"] += 1
            for i, (s, e) in enumerate(chunk_text(text)):
                p = text[s:e]
                cur.execute("INSERT INTO passages (article_id,ord,start_char,end_char,text,text_search,n_words) VALUES (%s,%s,%s,%s,%s,%s,%s)",
                            (art_id, i, s, e, p, search_form(p), len(p.split())))
                stats["passages"] += 1
            for br in r.get("bible_refs", []):
                cur.execute("INSERT INTO bible_refs (article_id,book,chapter,verse_start,verse_end,ref_text) VALUES (%s,%s,%s,%s,%s,%s)",
                            (art_id, br["book"], br["chapter"], br["verse_start"], br["verse_end"], br["ref_text"]))
    conn.commit()
    log(f"ingest: {stats}")
    return stats
