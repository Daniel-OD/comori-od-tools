from pathlib import Path

import numpy as np

from comori.bible import refs_from_link, refs_from_text
from comori.crawler.crawl import round_robin
from comori.crawler.parsers import canon_url, classify, parse_article, parse_listing
from comori.indexing.embedder import HashEmbedder
from comori.search.engine import Filters, quoted_phrases
from comori.search.explain import confidence, reasons
from comori.search.lexical import BM25Index
from comori.search import thesaurus
from comori.text import analyze, chunk_text, normalize_ro, search_form, strip_diacritics

FIX = Path(__file__).parent / "fixtures"
URL = "https://comori-od.ro/article/-crezi-tu-hristos-vindecatorul-nostru-traian-dorz"


def test_normalize_keeps_diacritics_and_unifies_cedilla():
    assert normalize_ro("Şi ţine") == "Și ține"
    assert strip_diacritics("Fiul pleacă şi rupe") == "Fiul pleaca si rupe"
    assert search_form("  Lepădarea  DE sine ") == "lepadarea de sine"


def test_stemming_matches_inflections_with_and_without_diacritics():
    assert analyze("rugăciunea") == analyze("rugaciunea")
    assert set(analyze("lepădarea de sine")) & set(analyze("lepădare de sine"))


def test_chunks_are_exact_substrings_and_cover_text():
    text = "\n".join(f"Propoziția numărul {i} are câteva cuvinte în ea. " * 6 for i in range(30))
    spans = chunk_text(text)
    assert len(spans) > 3
    assert spans[0][0] == 0 and spans[-1][1] <= len(text)
    for s, e in spans:
        assert 0 <= s < e <= len(text)
        assert len(text[s:e].split()) <= 340
    covered = set()
    for s, e in spans:
        covered.update(range(s, e))
    assert all(i in covered for i, c in enumerate(text) if not c.isspace() and i < spans[-1][1])


def test_short_text_single_chunk():
    assert chunk_text("Un text scurt.") == [(0, 14)]


def test_bible_refs():
    refs = refs_from_text("vezi Ioan 9, 35 și 2 Corinteni 13, 5; Matei 12, 35-37. Rugăciune 3, 4")
    assert [r["ref_text"] for r in refs] == ["Ioan 9,35", "2 Corinteni 13,5", "Matei 12,35-37"]
    assert refs_from_link("/bible/2%20Corinteni/13#verse-5")["verse_start"] == 5


def test_parse_article_fixture():
    r = parse_article((FIX / "article.html").read_text(encoding="utf-8"), URL)
    assert r["title"] == "... Crezi tu?"
    assert r["author_slug"] == "traian-dorz" and r["author_name"] == "Traian Dorz"
    assert r["book_slug"] == "hristos-vindecatorul-nostru"
    assert r["volume_slug"] == "meditatii-la-ev-dupa-ioan"
    assert (r["position"], r["total_in_book"]) == (82, 99)
    assert r["prev_url"].endswith("mareata-i-stanca-sfanta-hristos-vindecatorul-nostru-traian-dorz")
    assert r["next_url"].endswith("daca-scriind-putin-hristos-vindecatorul-nostru-traian-dorz")
    assert "Articol 82" not in r["text"] and "săgeți" not in r["text"]
    assert "Traian Dorz - Hristos" not in r["text"]          # linia de breadcrumb
    assert r["text"].startswith("Domnul Isus Hristos te întreabă")
    assert "Comori OD 2026" not in r["text"]                 # footer
    refs = {x["ref_text"] for x in r["bible_refs"]}
    assert {"Ioan 9,35", "2 Corinteni 13,5", "Matei 12,35-37"} <= refs


def test_listing_and_classify():
    html = '<a href="/article/a-x">A</a><a href="/book/b">B</a><a href="/author/z">Z</a><a href="/book/b?page=2">2</a>'
    L = parse_listing(html, "https://comori-od.ro/book/b")
    assert L.articles == [("https://comori-od.ro/article/a-x", "A")]
    assert L.authors and L.pages == ["https://comori-od.ro/book/b?page=2"]
    assert classify("https://comori-od.ro/volume/x")[0] == "volume"
    assert canon_url("https://comori-od.ro/a", "/book/x/#y") == "https://comori-od.ro/book/x"


def test_round_robin_is_diverse():
    g = {"a": ["a1", "a2", "a3"], "b": ["b1", "b2"], "c": ["c1"]}
    assert round_robin(g, 4) == ["a1", "b1", "c1", "a2"]


def test_bm25_ranking_phrase_and_typos():
    docs = {1: "Lepădarea de sine și voia proprie", 2: "Rugăciunea de dimineață și stăruința", 3: "Pământul și cerul"}
    idx = BM25Index().fit(list(docs), [analyze(t) for t in docs.values()])
    assert idx.query("lepadare de sine")[0][0] == 1
    assert idx.query("rugacuine")[0][0] == 2          # toleranță la greșeli
    assert idx.query("zzzzzz") == []
    extra = thesaurus.expand_query(analyze("lepădare de sine"))
    assert idx.score(extra)[0][0] == 1


def test_bm25_save_load(tmp_path):
    idx = BM25Index().fit([10, 20], [analyze("credință și rugăciune"), analyze("jertfa Domnului")])
    idx.save(tmp_path)
    assert BM25Index.load(tmp_path).query("jertfa")[0][0] == 20


def test_thesaurus_themes():
    stems = set(analyze("Omul cel vechi și voia proprie trebuie răstignirea firii, firea pământească; urmarea lui Hristos"))
    assert "lepadare_de_sine" in thesaurus.themes_in(stems, 3)


def test_quoted_phrases():
    ph, rest = quoted_phrases('rugăciune "stăruința în rugăciune" credință')
    assert ph == ["stăruința în rugăciune"] and "rugăciune" in rest


def test_explanations_are_grounded():
    out = reasons(query_stems=set(analyze("rugăciune și stăruință")), passage="El stăruia în rugăciune zi și noapte.",
                  sim=0.88, n_support=3)
    joined = " ".join(out)
    assert "0.88" in joined and "rugăciune" in joined and "încă 2 pasaje" in joined
    out2 = reasons(query_stems={"x"}, passage="Alt text fără legătură lexicală.", sim=0.9, n_support=1)
    assert any("alte cuvinte" in o for o in out2)
    assert confidence(0.9, 0.8) == "ridicată" and confidence(0.81, 0.8) == "medie" and confidence(0.7, 0.8) == "scăzută"
    assert confidence(None, 0.8) is None


def test_hash_embedder_normalized_and_deterministic():
    e = HashEmbedder(64)
    v1, v2 = e.embed_query("rugăciune și credință"), e.embed_query("rugăciune și credință")
    assert np.allclose(v1, v2) and abs(np.linalg.norm(v1) - 1) < 1e-5


def test_filters_sql():
    sql, params = Filters(author="traian-dorz", category="x").sql()
    assert "au.slug=%s" in sql and "a.duplicate_of IS NULL" in sql and params == ["traian-dorz", "x"]
