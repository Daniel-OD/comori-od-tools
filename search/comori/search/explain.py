"""Motivul pentru care un rezultat a fost ales, în limba română, din semnale verificabile."""
from __future__ import annotations

from ..bible import ref_keys
from ..text import is_stop, stem_word, words
from . import thesaurus


def shared_words(query_stems: set[str], passage: str, limit: int = 6) -> list[str]:
    seen, out = set(), []
    for w in words(passage):
        if is_stop(w):
            continue
        s = stem_word(w)
        if s in query_stems and s not in seen:
            seen.add(s)
            out.append(w)
            if len(out) >= limit:
                break
    return out


def _fmt_keys(keys: set[tuple[str, int, int]], limit: int = 3) -> str:
    items = sorted(keys)[:limit]
    s = "; ".join(f"{b} {c},{v}" for b, c, v in items)
    return s + (" …" if len(keys) > limit else "")


def reasons(*, query_stems: set[str], passage: str, sim: float | None, n_support: int,
            query_refs: list[dict] | None = None, article_refs: list[dict] | None = None,
            query_themes: list[str] | None = None, article_themes: list[str] | None = None,
            bm25: float | None = None, phrase: bool = False) -> list[str]:
    out: list[str] = []
    if phrase:
        out.append("Conține exact expresia căutată.")
    common = shared_words(query_stems, passage)
    if sim is not None:
        txt = f"Pasaj apropiat ca sens (similaritate {sim:.2f})"
        if n_support > 1:
            txt += f"; încă {n_support - 1} pasaje din același articol sunt apropiate"
        out.append(txt + ".")
        if len(common) <= 1:
            out.append("Ideea apare exprimată cu alte cuvinte decât în căutare."
                       if not common else f"Un singur cuvânt comun cu căutarea: {common[0]}.")
    if common and (sim is None or len(common) > 1):
        out.append("Cuvinte comune: " + ", ".join(common) + ".")
    elif common and sim is None:
        out.append("Cuvânt comun: " + common[0] + ".")
    if query_refs and article_refs:
        inter = ref_keys(query_refs) & ref_keys(article_refs)
        if inter:
            out.append("Versete biblice comune: " + _fmt_keys(inter) + ".")
    if query_themes and article_themes:
        both = [t for t in query_themes if t in set(article_themes)]
        if both:
            out.append("Teme comune: " + ", ".join(thesaurus.label(t) for t in both[:3]) + ".")
    return out


def confidence(sim: float | None, min_sim: float) -> str | None:
    if sim is None:
        return None
    if sim >= min_sim + 0.06:
        return "ridicată"
    if sim >= min_sim:
        return "medie"
    return "scăzută"
