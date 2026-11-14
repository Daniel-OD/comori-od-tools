"""Test cap-la-cap pe PostgreSQL + pgvector real, cu embedder de test (hash, NU semantic).
Se omite automat dacă TEST_DATABASE_URL nu e setat."""
import json
import os

import pytest

URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not URL, reason="setează TEST_DATABASE_URL pentru testul cu baza de date")

ART = [
    ("lepadare-1", "Lepădarea de sine", "traian-dorz", "Traian Dorz", "carte-a", "Carte A",
     "Cine vrea să vină după Mine să se lepede de sine și să-și ia crucea. Lepădarea de sine înseamnă renunțarea la voia proprie, "
     "răstignirea firii pământești și urmarea lui Hristos. Omul cel vechi trebuie răstignit. Matei 16, 24."),
    ("lepadare-copie", "Lepădarea de sine (copie)", "traian-dorz", "Traian Dorz", "carte-a", "Carte A",
     "Cine vrea să vină după Mine să se lepede de sine și să-și ia crucea. Lepădarea de sine înseamnă renunțarea la voia proprie, "
     "răstignirea firii pământești și urmarea lui Hristos. Omul cel vechi trebuie răstignit. Matei 16, 24."),
    ("lepadare-2", "Voia lui Dumnezeu", "iosif-trifa", "Pr. Iosif Trifa", "carte-b", "Carte B",
     "Renunțarea la voia proprie și supunerea voinței omului față de Dumnezeu, lupta cu omul cel vechi și răstignirea firii. Matei 16, 24."),
    ("rugaciune-1", "Stăruința în rugăciune", "traian-dorz", "Traian Dorz", "carte-a", "Carte A",
     "Rugăciunea de dimineață și stăruința în rugăciune sunt comuniune cu Dumnezeu. Mijlocirea pentru frați. Luca 18, 1."),
    ("pamant-1", "Despre grădină", "iosif-trifa", "Pr. Iosif Trifa", "carte-b", "Carte B",
     "Grădina are pomi, flori și o fântână cu apă rece. Primăvara pământul se încălzește și semințele încolțesc."),
]


@pytest.fixture(scope="module")
def conn(tmp_path_factory):
    d = tmp_path_factory.mktemp("data")
    os.environ.update(DATABASE_URL=URL, EMBEDDER="fake", DATA_DIR=str(d), IDEA_MIN_SIM="0.45")
    from comori.config import get_settings
    get_settings.cache_clear()
    s = get_settings()
    from comori.db import connect, init_schema
    with connect(register_vector=False) as c:
        c.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        c.commit()
    init_schema()
    lines = []
    for i, (slug, title, aslug, aname, bslug, btitle, text) in enumerate(ART):
        lines.append(json.dumps({
            "url": f"https://comori-od.ro/article/{slug}", "slug": slug, "title": title, "author_slug": aslug, "author_name": aname,
            "author_url": None, "book_slug": bslug, "book_title": btitle, "book_url": None, "volume_slug": "vol", "volume_title": "Vol",
            "volume_url": None, "position": i + 1, "total_in_book": 5, "category": None, "published_at": None, "text": text,
            "bible_refs": [], "content_hash": None}, ensure_ascii=False))
    s.articles_jsonl.write_text("\n".join(lines), encoding="utf-8")
    from comori.indexing.build_bm25 import build
    from comori.indexing.embed import embed_missing
    from comori.indexing.embedder import get_embedder
    from comori.indexing.ingest import ingest
    from comori.indexing.keywords import compute
    c = connect()
    st = ingest(c, s.articles_jsonl, log=lambda *_: None)
    compute(c, log=lambda *_: None)
    embed_missing(c, get_embedder(s), log=lambda *_: None)
    build(c, log=lambda *_: None)
    c.stats = st
    yield c
    c.close()


def test_ingest_dedup_and_idempotent(conn):
    assert conn.stats["new"] == 5 and conn.stats["duplicates"] == 1
    n = conn.execute("SELECT count(*) n FROM articles WHERE duplicate_of IS NOT NULL").fetchone()["n"]
    assert n == 1
    from comori.config import get_settings
    from comori.indexing.ingest import ingest
    assert ingest(conn, get_settings().articles_jsonl, log=lambda *_: None)["unchanged"] == 5


def test_text_keeps_diacritics_and_passage_spans(conn):
    r = conn.execute("SELECT a.text, p.start_char, p.end_char, p.text AS pt FROM passages p JOIN articles a ON a.id=p.article_id LIMIT 1").fetchone()
    assert "ă" in r["text"] and r["text"][r["start_char"]:r["end_char"]] == r["pt"]


def test_hybrid_and_lexical_find_relevant_and_hide_duplicate(conn):
    from comori.search.engine import Searcher
    s = Searcher(conn)
    res = s.search("lepadare de sine", "hybrid")
    titles = [r["title"] for r in res["results"]]
    assert "Lepădarea de sine" in titles and "Lepădarea de sine (copie)" not in titles
    assert "Despre grădină" not in titles[:2]
    lex = s.search("rugaciune", "lexical")
    assert lex["results"][0]["title"] == "Stăruința în rugăciune"
    assert any("Cuvinte comune" in x for x in lex["results"][0]["reasons"])


def test_phrase_and_filters(conn):
    from comori.search.engine import Filters, Searcher
    s = Searcher(conn)
    ph = s.search('"voia proprie"', "phrase")
    assert {r["title"] for r in ph["results"]} == {"Lepădarea de sine", "Voia lui Dumnezeu"}
    assert all("exact" in r["reasons"][0] for r in ph["results"])
    f = s.search("lepadare de sine", "lexical", Filters(author="iosif-trifa"))
    assert {r["author_slug"] for r in f["results"]} == {"iosif-trifa"}


def test_idea_search_threshold_and_no_garbage(conn):
    from comori.search.engine import Searcher
    s = Searcher(conn)
    res = s.idea_search("Renunțarea la voia proprie și răstignirea firii pământești, lupta cu omul cel vechi")
    assert res["results"] and res["results"][0]["title"] in {"Lepădarea de sine", "Voia lui Dumnezeu"}
    assert res["results"][0]["similarity"] >= 0.45 and res["results"][0]["reasons"]
    none = s.idea_search("tehnologie spațială și motoare rachetă cuantică")
    assert none["total"] == 0 and "message" in none


def test_related_articles(conn):
    from comori.search.engine import Searcher
    s = Searcher(conn)
    aid = conn.execute("SELECT id FROM articles WHERE slug='lepadare-1'").fetchone()["id"]
    rel = s.related(aid)
    assert [r["title"] for r in rel["results"]][:1] == ["Voia lui Dumnezeu"]
    assert all(r["article_id"] != aid for r in rel["results"])


def test_api(conn):
    from fastapi.testclient import TestClient
    from comori.api.main import app
    c = TestClient(app)
    assert c.get("/").status_code == 200
    j = c.get("/api/search", params={"q": "rugaciune", "mode": "lexical"}).json()
    assert j["total"] >= 1 and j["disclaimer"]
    aid = j["results"][0]["article_id"]
    a = c.get(f"/api/article/{aid}").json()
    assert a["text"] and a["url"].startswith("https://comori-od.ro/article/")
    assert c.post("/api/idea", json={"text": "voia proprie și omul cel vechi răstignit"}).status_code == 200
    assert c.get("/api/facets").json()["authors"]
    assert c.get("/api/stats").json()["articles"] == 4
    assert c.get("/api/search", params={"q": "x", "mode": "nu"}).status_code == 400


def test_cors_allows_pages_origin(conn):
    from fastapi.testclient import TestClient
    from comori.api.main import app
    r = TestClient(app).get("/api/stats", headers={"Origin": "https://daniel-od.github.io"})
    assert r.headers.get("access-control-allow-origin") == "https://daniel-od.github.io"
    r2 = TestClient(app).get("/api/stats", headers={"Origin": "https://exemplu-rau.ro"})
    assert "access-control-allow-origin" not in r2.headers
