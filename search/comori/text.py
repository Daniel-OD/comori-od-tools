"""Normalizare, analiză lexicală și fragmentare (chunking) pentru texte românești."""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

import snowballstemmer

_CEDILLA = str.maketrans({"ş": "ș", "Ş": "Ș", "ţ": "ț", "Ţ": "Ț"})
_DIA = str.maketrans("ăâîșțĂÂÎȘȚ", "aaistAAIST")

# Cuvinte frecvente fără valoare de căutare (fără diacritice)
STOPWORDS = set(
    """a ai al ale alta altul am ar as asa asta astfel at atat atunci au aua avea aveti avem aceasta
    acest acesta aceste acestea acestei acestui acel acea acele acelea acolo ca cand care carei carui
    caror cat cate catre cei cel cele ci cine cu cum da daca dar de deci despre din dintre doar dupa
    e ea ei el ele era este esti eu fara fi fie fiind fiecare fost i ii il in inca intr intre insa l la
    le li lui m ma mai mi mie mult multa multe multi ne nici nimic noi nostru noastra nu o or ori pe
    pana peste pentru poate prin sa sai sale sau se si sa sunt sub sunt ta te tau tot toata toate
    totul toti tu ti un una unde unei unor unui va vei voi vom vor vostru vreo va vi iar ar fii fiu
    sunteti suntem suntem cei cele ceea ceva cineva fiecare lor lui mea meu mei mele noastre noastra
    nostri tale tai tau vostri voastra voastre""".split()
)

_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)
_stemmer = snowballstemmer.stemmer("romanian")


def normalize_ro(text: str) -> str:
    """NFC + diacritice românești cu virgulă (ș, ț) + spații curate. Păstrează diacriticele."""
    t = unicodedata.normalize("NFC", text).translate(_CEDILLA)
    return t.replace(" ", " ").replace("​", "").replace("﻿", "")


def strip_diacritics(text: str) -> str:
    t = normalize_ro(text).translate(_DIA)
    t = unicodedata.normalize("NFKD", t)
    return "".join(c for c in t if not unicodedata.combining(c))


def search_form(text: str) -> str:
    """Formă pentru căutare exactă/fuzzy: minuscule, fără diacritice, spații normalizate."""
    return re.sub(r"\s+", " ", strip_diacritics(text).lower()).strip()


def words(text: str) -> list[str]:
    return _WORD_RE.findall(normalize_ro(text).lower())


@lru_cache(maxsize=200_000)
def stem_word(word: str) -> str:
    return strip_diacritics(_stemmer.stemWord(word))


def is_stop(word: str) -> bool:
    return strip_diacritics(word) in STOPWORDS or len(word) < 2


def analyze(text: str) -> list[str]:
    """Text -> listă de stem-uri fără diacritice, fără cuvinte-gol."""
    return [stem_word(w) for w in words(text) if not is_stop(w)]


# ---------------------------------------------------------------- chunking

_SENT_RE = re.compile(r"[^.!?…]+(?:[.!?…]+[\"”»')\]]*)?\s*")


def _n_words(s: str) -> int:
    return len(s.split())


def _units(text: str, max_words: int) -> list[tuple[int, int]]:
    """Unități = rânduri (paragrafe/versuri); rândurile lungi sunt sparte pe propoziții."""
    spans: list[tuple[int, int]] = []
    for m in re.finditer(r"[^\n]+", text):
        s, e = m.span()
        line = text[s:e]
        if not line.strip():
            continue
        if _n_words(line) <= max_words:
            spans.append((s, e))
            continue
        for sm in _SENT_RE.finditer(line):
            a, b = sm.span()
            if line[a:b].strip():
                spans.append((s + a, s + b))
    return spans


def chunk_text(
    text: str, target: int = 170, max_words: int = 260, min_words: int = 40, overlap_words: int = 40
) -> list[tuple[int, int]]:
    """Împarte textul în pasaje coerente. Returnează span-uri (start, end) în `text`.

    Pasajele respectă limitele paragrafelor/propozițiilor; ultima unitate a unui pasaj
    se repetă la începutul următorului dacă e scurtă (context). Textul pasajului este
    exact text[start:end], deci poate fi evidențiat în articolul integral.
    """
    units = _units(text, max_words)
    if not units:
        return []
    chunks: list[list[tuple[int, int]]] = []
    cur: list[tuple[int, int]] = []
    cur_w = 0
    for u in units:
        w = _n_words(text[u[0] : u[1]])
        if cur and cur_w + w > max_words:
            chunks.append(cur)
            last = cur[-1]
            cur = [last] if _n_words(text[last[0] : last[1]]) <= overlap_words and len(cur) > 1 else []
            cur_w = sum(_n_words(text[a:b]) for a, b in cur)
        cur.append(u)
        cur_w += w
        if cur_w >= target:
            chunks.append(cur)
            last = cur[-1]
            cur = [last] if _n_words(text[last[0] : last[1]]) <= overlap_words and len(cur) > 1 else []
            cur_w = sum(_n_words(text[a:b]) for a, b in cur)
    if cur and (not chunks or any(u not in chunks[-1] for u in cur)):
        chunks.append(cur)
    # unește coada prea scurtă cu pasajul anterior
    spans = [(c[0][0], c[-1][1]) for c in chunks]
    if len(spans) >= 2 and _n_words(text[spans[-1][0] : spans[-1][1]]) < min_words:
        s0, _ = spans[-2]
        _, e1 = spans[-1]
        if _n_words(text[s0:e1]) <= max_words * 1.3:
            spans[-2:] = [(s0, e1)]
    return spans
