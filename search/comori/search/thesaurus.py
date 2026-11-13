from __future__ import annotations

from functools import lru_cache

import yaml

from ..config import ROOT
from ..text import analyze


@lru_cache
def load() -> dict[str, dict]:
    raw = yaml.safe_load((ROOT / "data" / "thesaurus.yaml").read_text(encoding="utf-8"))["themes"]
    out = {}
    for tid, t in raw.items():
        terms = []
        for phrase in t["terms"]:
            st = tuple(analyze(phrase))
            if st:
                terms.append((phrase, st))
        out[tid] = {"label": t["label"], "terms": terms}
    return out


def themes_in(stems: set[str] | list[str], min_hits: int = 3) -> list[str]:
    """Teme ale căror expresii (toate stem-urile) apar în text; ≥ min_hits expresii distincte."""
    s = set(stems)
    res = []
    for tid, t in load().items():
        hits = sum(1 for _, st in t["terms"] if all(x in s for x in st))
        if hits >= min_hits:
            res.append((hits, tid))
    return [tid for _, tid in sorted(res, reverse=True)]


def label(tid: str) -> str:
    return load()[tid]["label"]


def expand_query(stems: list[str], weight: float = 0.5) -> dict[str, float]:
    """Interogare -> {stem: pondere}. Adaugă stem-urile temelor declanșate (cu pondere mai mică)."""
    q = {s: 1.0 for s in stems}
    sset = set(stems)
    for t in load().values():
        if any(all(x in sset for x in st) for _, st in t["terms"]):
            for _, st in t["terms"]:
                for x in st:
                    q.setdefault(x, weight)
    return q
