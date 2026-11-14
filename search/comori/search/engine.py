"""Motorul de căutare: lexical (BM25), semantic (pgvector), hibrid (RRF), după idee, articole înrudite."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from ..bible import refs_from_text
from ..config import Settings, get_settings
from ..indexing.embedder import Embedder, get_embedder
from ..text import analyze, chunk_text, search_form, words
from . import thesaurus
from .explain import confidence, reasons
from .lexical import BM25Index

RRF_K = 60
DISCLAIMER = ("Scorurile sunt calcule automat și sunt orientative; nu sunt afirmații doctrinare. "
              "Verifică întotdeauna textul în sursa originală.")


@dataclass
class Filters:
    author: str | None = None   # slug
    book: str | None = None
    volume: str | None = None
    category: str | None = None

    def sql(self) -> tuple[str, list]:
        c, p = ["a.duplicate_of IS NULL"], []
        for col, val in (("au.slug", self.author), ("bk.slug", self.book), ("vo.slug", self.volume), ("a.category", self.category)):
            if val:
                c.append(f"{col}=%s")
                p.append(val)
        return " AND ".join(c), p


FROM = ("FROM passages p JOIN articles a ON a.id=p.article_id LEFT JOIN authors au ON au.id=a.author_id "
        "LEFT JOIN books bk ON bk.id=a.book_id LEFT JOIN volumes vo ON vo.id=a.volume_id")
COLS = ("p.id AS pid, p.text AS ptext, p.start_char, p.end_char, a.id AS aid, a.title, a.url, a.keywords, a.themes, "
        "au.name AS author, au.slug AS author_slug, bk.title AS book, bk.slug AS book_slug, vo.title AS volume, vo.slug AS volume_slug, a.category")


def quoted_phrases(q: str) -> tuple[list[str], str]:
    phrases = re.findall(r"[\"„“”«]([^\"„“”»]{3,})[\"”“»]", q)
    rest = re.sub(r"[\"„“”«»]([^\"„“”»]{3,})[\"”“»]", " ", q)
    return phrases, rest.strip()


class Searcher:
    def __init__(self, conn, settings: Settings | None = None, embedder: Embedder | None = None,
                 bm25: BM25Index | None = None):
        self.conn, self.s = conn, settings or get_settings()
        self._embedder, self._bm25 = embedder, bm25

    @property
    def embedder(self) -> Embedder:
        if self._embedder is None:
            self._embedder = get_embedder(self.s)
        return self._embedder

    @property
    def bm25(self) -> BM25Index:
        if self._bm25 is None:
            self._bm25 = BM25Index.load(self.s.index_dir)
        return self._bm25

    # --------------------------------------------------------------- retrievers
    def semantic_passages(self, vec, f: Filters, k: int = 200, exclude_article: int | None = None):
        where, params = f.sql()
        if exclude_article:
            where += " AND a.id<>%s"
            params = params + [exclude_article]
        try:
            self.conn.execute("SET hnsw.ef_search = 200")
            self.conn.execute("SET hnsw.iterative_scan = relaxed_order")
        except Exception:
            self.conn.rollback()
        cur = self.conn.execute(
            f"SELECT p.id AS pid, 1-(p.embedding <=> %s) AS sim {FROM} WHERE p.embedding IS NOT NULL AND {where} "
            f"ORDER BY p.embedding <=> %s LIMIT %s", [vec, *params, vec, k])
        return [(r["pid"], float(r["sim"])) for r in cur.fetchall()]

    def phrase_passages(self, phrases: list[str], f: Filters, k: int = 300):
        where, params = f.sql()
        out: dict[int, float] = {}
        for ph in phrases:
            sf = search_form(ph)
            like = "%" + sf.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_") + "%"
            cur = self.conn.execute(f"SELECT p.id AS pid, p.text_search {FROM} WHERE p.text_search LIKE %s AND {where} LIMIT %s",
                                    [like, *params, k])
            for r in cur.fetchall():
                out[r["pid"]] = out.get(r["pid"], 0) + r["text_search"].count(sf)
        return sorted(out.items(), key=lambda x: -x[1])

    def _meta(self, pids: list[int], f: Filters) -> dict[int, dict]:
        if not pids:
            return {}
        where, params = f.sql()
        cur = self.conn.execute(f"SELECT {COLS} {FROM} WHERE p.id = ANY(%s) AND {where}", [pids, *params])
        return {r["pid"]: r for r in cur.fetchall()}

    def _refs(self, aids: list[int]) -> dict[int, list[dict]]:
        out: dict[int, list[dict]] = {a: [] for a in aids}
        if aids:
            for r in self.conn.execute("SELECT article_id, book, chapter, verse_start, verse_end FROM bible_refs WHERE article_id=ANY(%s)", [aids]):
                out[r["article_id"]].append(r)
        return out

    # ------------------------------------------------------------------ search
    def search(self, q: str, mode: str = "hybrid", f: Filters | None = None, limit: int = 20, offset: int = 0) -> dict:
        f = f or Filters()
        q = q.strip()
        if not q:
            return self._resp([], 0, q, mode)
        if mode in ("idea", "semantic"):
            return self.idea_search(q, f, limit, offset, strict=(mode == "idea"), mode=mode)
        phrases, rest = quoted_phrases(q)
        if mode == "phrase" and not phrases:
            phrases, rest = [q], ""
        text_for_terms = rest or " ".join(phrases)
        stems = analyze(text_for_terms)
        lists: list[tuple[list[tuple[int, float]], float, str]] = []
        if phrases:
            lists.append((self.phrase_passages(phrases, f), 1.5, "phrase"))
        if mode in ("hybrid", "lexical") and stems:
            terms = thesaurus.expand_query(stems)  # extindere conceptuală (tezaur), cu pondere mai mică
            lists.append((self.bm25.score(terms, k=500 if (f.author or f.book or f.volume or f.category) else 300), 1.0, "bm25"))
        sem: dict[int, float] = {}
        if mode == "hybrid" and (rest or q):
            sem = dict(self.semantic_passages(self.embedder.embed_query(rest or q), f, 200))
            lists.append((sorted(sem.items(), key=lambda x: -x[1]), 1.0, "sem"))
        fused: dict[int, float] = {}
        sig: dict[int, dict] = {}
        for lst, w, name in lists:
            for rank, (pid, sc) in enumerate(lst):
                fused[pid] = fused.get(pid, 0) + w / (RRF_K + rank + 1)
                sig.setdefault(pid, {})[name] = sc
        meta = self._meta(list(fused), f)
        # protecție: pasaje găsite doar semantic, sub prag, fără nicio potrivire lexicală, se elimină
        floor = self.s.idea_min_sim - 0.05
        for pid in list(fused):
            sg = sig[pid]
            if pid not in meta or ("sem" in sg and len(sg) == 1 and sg["sem"] < floor and mode == "hybrid" and stems):
                fused.pop(pid, None)
        hits = self._aggregate(fused, sig, meta, set(stems), q, mode)
        return self._resp(hits, len(hits), q, mode, limit, offset)

    def _aggregate(self, fused, sig, meta, qstems: set[str], q: str, mode: str) -> list[dict]:
        by_art: dict[int, list[int]] = {}
        for pid in sorted(fused, key=lambda p: -fused[p]):
            by_art.setdefault(meta[pid]["aid"], []).append(pid)
        scored = []
        for aid, pids in by_art.items():
            s = fused[pids[0]] + 0.25 * sum(fused[p] for p in pids[1:3])
            scored.append((s, aid, pids))
        scored.sort(reverse=True)
        top = scored[0][0] if scored else 1.0
        refs = self._refs([a for _, a, _ in scored[:200]])
        qrefs, qthemes = refs_from_text(q), thesaurus.themes_in(qstems, 1)
        hits = []
        for s, aid, pids in scored:
            m, g = meta[pids[0]], sig[pids[0]]
            sim = g.get("sem")
            hits.append(self._hit(m, score=s / top, sim=sim, bm25=g.get("bm25"), n_support=len(pids),
                                  reasons=reasons(query_stems=qstems, passage=m["ptext"], sim=sim, n_support=len(pids),
                                                  query_refs=qrefs, article_refs=refs.get(aid), query_themes=qthemes,
                                                  article_themes=m["themes"], phrase="phrase" in g)))
        return hits

    def _hit(self, m: dict, score: float, sim: float | None, bm25: float | None, n_support: int, reasons: list[str], **extra) -> dict:
        return {"article_id": m["aid"], "title": m["title"], "author": m["author"], "author_slug": m["author_slug"],
                "book": m["book"], "volume": m["volume"], "category": m["category"], "url": m["url"],
                "snippet": m["ptext"], "passage_start": m["start_char"], "passage_end": m["end_char"],
                "relevance": round(float(score), 4), "similarity": None if sim is None else round(float(sim), 4),
                "bm25": None if bm25 is None else round(float(bm25), 3),
                "confidence": confidence(sim, self.s.idea_min_sim), "supporting_passages": n_support,
                "keywords": m["keywords"], "themes": [thesaurus.label(t) for t in (m["themes"] or []) if t in thesaurus.load()],
                "reasons": reasons, **extra}

    def _resp(self, hits, total, q, mode, limit=20, offset=0, **extra) -> dict:
        return {"query": q, "mode": mode, "total": total, "results": hits[offset:offset + limit],
                "query_terms": [w for w in words(q) if len(w) > 2], "disclaimer": DISCLAIMER, **extra}

    # -------------------------------------------------------------- după idee
    def idea_search(self, text: str, f: Filters | None = None, limit: int = 20, offset: int = 0,
                    strict: bool = True, mode: str = "idea") -> dict:
        f = f or Filters()
        parts = [text]
        if len(text.split()) > 200:
            parts = [text[a:b] for a, b in chunk_text(text, target=150, max_words=220)[:5]]
        sims: dict[int, float] = {}
        for part in parts:
            for pid, sim in self.semantic_passages(self.embedder.embed_query(part), f, 200):
                sims[pid] = max(sims.get(pid, 0.0), sim)
        if not sims:
            return self._resp([], 0, text, mode, message="Indexul semantic este gol. Rulează `embed`.")
        top = max(sims.values())
        if top < self.s.idea_min_sim:
            return self._resp([], 0, text, mode, top_similarity=round(top, 4),
                              message="Nu există pasaje suficient de apropiate ca sens. (Pragul se poate regla în .env: IDEA_MIN_SIM.)")
        floor = max(self.s.idea_min_sim, top - self.s.idea_rel_drop) if strict else self.s.idea_min_sim
        keep = {p: s for p, s in sims.items() if s >= floor}
        meta = self._meta(list(keep), f)
        qstems = set(analyze(text))
        qrefs, qthemes = refs_from_text(text), thesaurus.themes_in(qstems, 1)
        by_art: dict[int, list[int]] = {}
        for pid in sorted(keep, key=lambda p: -keep[p]):
            if pid in meta:
                by_art.setdefault(meta[pid]["aid"], []).append(pid)
        scored = sorted(((keep[p[0]] + 0.02 * min(len(p) - 1, 3), aid, p) for aid, p in by_art.items()), reverse=True)
        refs = self._refs([a for _, a, _ in scored])
        hits = []
        for sc, aid, pids in scored:
            m = meta[pids[0]]
            hits.append(self._hit(m, score=(sc - floor) / max(scored[0][0] - floor, 1e-6) if scored[0][0] > floor else 1.0,
                                  sim=keep[pids[0]], bm25=None, n_support=len(pids),
                                  reasons=reasons(query_stems=qstems, passage=m["ptext"], sim=keep[pids[0]], n_support=len(pids),
                                                  query_refs=qrefs, article_refs=refs.get(aid), query_themes=qthemes,
                                                  article_themes=m["themes"])))
        return self._resp(hits, len(hits), text, mode, top_similarity=round(top, 4))

    # ------------------------------------------------------------------ înrudite
    def related(self, article_id: int, limit: int = 10, max_src: int = 12, per_passage: int = 8) -> dict:
        src = self.conn.execute("SELECT id, ord, text, embedding FROM passages WHERE article_id=%s AND embedding IS NOT NULL ORDER BY ord",
                                [article_id]).fetchall()
        a = self.conn.execute("SELECT title, themes FROM articles WHERE id=%s", [article_id]).fetchone()
        if not src or not a:
            return {"article_id": article_id, "total": 0, "results": [], "message": "Articol inexistent sau fără embeddings.", "disclaimer": DISCLAIMER}
        if len(src) > max_src:
            step = len(src) / max_src
            src = [src[int(i * step)] for i in range(max_src)]
        matches: dict[int, list[tuple[int, int, float]]] = {}  # aid -> [(src_pid, tgt_pid, sim)]
        for sp in src:
            for pid, sim in self.semantic_passages(sp["embedding"], Filters(), per_passage, exclude_article=article_id):
                matches.setdefault(pid, []).append((sp["id"], pid, sim))
        meta = self._meta(list(matches), Filters())
        by_art: dict[int, list[tuple[int, int, float]]] = {}
        for pid, ms in matches.items():
            if pid in meta:
                by_art.setdefault(meta[pid]["aid"], []).extend(ms)
        srefs = self._refs([article_id])[article_id]
        from ..bible import ref_keys
        sk = ref_keys(srefs)
        scored = []
        for aid, ms in by_art.items():
            ms.sort(key=lambda x: -x[2])
            top3 = [m[2] for m in ms[:3]]
            cov = len({m[0] for m in ms})
            scored.append((sum(top3) / len(top3) + 0.02 * min(cov, 5), aid, ms))
        scored.sort(reverse=True)
        if not scored or scored[0][0] < self.s.idea_min_sim:
            return {"article_id": article_id, "total": 0, "results": [], "disclaimer": DISCLAIMER,
                    "message": "Nu am găsit articole suficient de apropiate ca sens."}
        floor = max(self.s.idea_min_sim, scored[0][0] - self.s.idea_rel_drop)
        scored = [x for x in scored if x[0] >= floor][:limit]
        trefs = self._refs([aid for _, aid, _ in scored])
        srcmap = {r["id"]: r["text"] for r in src}
        hits = []
        for sc, aid, ms in scored:
            best = ms[0]
            m = meta[best[1]]
            rs = [f"Pasaj apropiat ca sens (similaritate {best[2]:.2f}); {len({x[0] for x in ms})} pasaje ale articolului sursă au potriviri aici."]
            inter = sk & ref_keys(trefs.get(aid, []))
            if inter:
                rs.append(f"Versete biblice comune: {len(inter)}.")
            both = [t for t in (a["themes"] or []) if t in (m["themes"] or [])]
            if both:
                rs.append("Teme comune: " + ", ".join(thesaurus.label(t) for t in both[:3]) + ".")
            if best[2] > 0.985:
                rs.append("Atenție: text aproape identic (posibil duplicat sau variantă a aceluiași text).")
            hits.append(self._hit(m, score=sc, sim=best[2], bm25=None, n_support=len(ms), reasons=rs,
                                  source_passage=srcmap.get(best[0], "")))
        return {"article_id": article_id, "title": a["title"], "total": len(hits), "results": hits, "disclaimer": DISCLAIMER}
