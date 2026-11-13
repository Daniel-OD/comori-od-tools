"""Cuvinte-cheie (TF-IDF pe stem-uri), expresii (bigrame) și teme (tezaur) per articol."""
from __future__ import annotations

import math
from collections import Counter

from ..search import thesaurus
from ..text import is_stop, stem_word, words


def compute(conn, n_kw: int = 12, n_ph: int = 8, log=print) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT id, text FROM articles WHERE duplicate_of IS NULL")
        rows = cur.fetchall()
    stems_by, bi_by, surf = {}, {}, {}
    df, df_bi = Counter(), Counter()
    for r in rows:
        ws = words(r["text"])
        toks = [(w, stem_word(w)) for w in ws if not is_stop(w)]
        c = Counter(s for _, s in toks)
        for w, s in toks:
            surf.setdefault(s, Counter())[w] += 1
        bi = Counter()
        prev = None
        for w in ws:
            if is_stop(w):
                prev = None
                continue
            s = stem_word(w)
            if prev:
                bi[(prev[0], prev[1], w, s)] += 1
            prev = (w, s)
        bic = Counter()
        for (w1, s1, w2, s2), n in bi.items():
            bic[(s1, s2, f"{w1} {w2}")] += n
        stems_by[r["id"]], bi_by[r["id"]] = c, bic
        df.update(c.keys())
        df_bi.update({(a, b) for (a, b, _) in bic})
    N = len(rows)
    with conn.cursor() as cur:
        for aid, c in stems_by.items():
            kw = sorted(((1 + math.log(n)) * (math.log((N + 1) / (df[s] + 1)) + 1), s) for s, n in c.items() if df[s] >= 1 and len(s) > 2)
            kws = [surf[s].most_common(1)[0][0] for _, s in kw[::-1][:n_kw]]
            ph = sorted(((n * (math.log((N + 1) / (df_bi[(a, b)] + 1)) + 1), txt) for (a, b, txt), n in bi_by[aid].items() if n >= 2), reverse=True)
            phs = [t for _, t in ph[:n_ph]]
            themes = thesaurus.themes_in(set(c))
            cur.execute("UPDATE articles SET keywords=%s, phrases=%s, themes=%s WHERE id=%s", (kws, phs, themes, aid))
    conn.commit()
    log(f"cuvinte-cheie calculate pentru {N} articole")
