"""Detectarea referințelor biblice: linkuri /bible/Carte/cap#verse-N și text de tip „Ioan 9, 35”."""
from __future__ import annotations

import re
from urllib.parse import unquote

from .text import strip_diacritics

BOOKS = [
    "Geneza", "Exodul", "Leviticul", "Numeri", "Deuteronomul", "Iosua", "Judecătorii", "Rut",
    "1 Samuel", "2 Samuel", "1 Regi", "2 Regi", "1 Cronici", "2 Cronici", "Ezra", "Neemia", "Estera",
    "Iov", "Psalmii", "Proverbe", "Eclesiastul", "Cântarea Cântărilor", "Isaia", "Ieremia",
    "Plângerile", "Ezechiel", "Daniel", "Osea", "Ioel", "Amos", "Obadia", "Iona", "Mica", "Naum",
    "Habacuc", "Țefania", "Hagai", "Zaharia", "Maleahi", "Matei", "Marcu", "Luca", "Ioan",
    "Faptele Apostolilor", "Romani", "1 Corinteni", "2 Corinteni", "Galateni", "Efeseni",
    "Filipeni", "Coloseni", "1 Tesaloniceni", "2 Tesaloniceni", "1 Timotei", "2 Timotei", "Tit",
    "Filimon", "Evrei", "Iacov", "1 Petru", "2 Petru", "1 Ioan", "2 Ioan", "3 Ioan", "Iuda",
    "Apocalipsa",
]
_ALIASES = {
    "psalm": "Psalmii", "psalmul": "Psalmii", "psalmi": "Psalmii", "ps": "Psalmii",
    "fapte": "Faptele Apostolilor", "faptele": "Faptele Apostolilor",
    "cantarea cantarilor": "Cântarea Cântărilor", "tefania": "Țefania", "tefania ": "Țefania",
    "apoc": "Apocalipsa", "mat": "Matei",
}


def _key(s: str) -> str:
    return re.sub(r"\s+", " ", strip_diacritics(s).lower()).strip()


_CANON = {_key(b): b for b in BOOKS}
_CANON.update({_key(k): v for k, v in _ALIASES.items()})

_names = sorted({_key(k) for k in _CANON}, key=len, reverse=True)
_book_pat = "|".join(re.escape(n).replace(r"\ ", r"\s+") for n in _names)
# acceptă diacritice în text: lucrăm pe o copie fără diacritice, cu aceleași poziții
_REF_RE = re.compile(
    rf"(?<![\w])((?:{_book_pat}))\s+(\d{{1,3}})\s*[,:.]\s*(\d{{1,3}})(?:\s*[-–]\s*(\d{{1,3}}))?",
    re.IGNORECASE,
)


def canonical_book(name: str) -> str | None:
    return _CANON.get(_key(unquote(name)))


def _ref(book: str, ch: int, v1: int, v2: int | None) -> dict:
    v2 = v2 if v2 and v2 >= v1 else v1
    txt = f"{book} {ch},{v1}" + (f"-{v2}" if v2 != v1 else "")
    return {"book": book, "chapter": ch, "verse_start": v1, "verse_end": v2, "ref_text": txt}


def refs_from_link(href: str) -> dict | None:
    m = re.search(r"/bible/([^/#?]+)/(\d+)(?:#verse-(\d+))?", href)
    if not m:
        return None
    book = canonical_book(m.group(1))
    if not book:
        return None
    v = int(m.group(3)) if m.group(3) else 0
    return _ref(book, int(m.group(2)), v, v)


def refs_from_text(text: str) -> list[dict]:
    plain = strip_diacritics(text)  # lungimea se păstrează 1:1 pentru ăâîșț
    out = []
    for m in _REF_RE.finditer(plain):
        book = _CANON.get(_key(m.group(1)))
        if book:
            out.append(_ref(book, int(m.group(2)), int(m.group(3)), int(m.group(4)) if m.group(4) else None))
    return out


def merge_refs(*lists: list[dict]) -> list[dict]:
    seen, res = set(), []
    for lst in lists:
        for r in lst:
            k = (r["book"], r["chapter"], r["verse_start"], r["verse_end"])
            if k not in seen:
                seen.add(k)
                res.append(r)
    return res


def ref_keys(refs: list[dict]) -> set[tuple[str, int, int]]:
    """Set (carte, capitol, verset) pentru comparații de suprapunere."""
    keys = set()
    for r in refs:
        for v in range(r["verse_start"], min(r["verse_end"], r["verse_start"] + 60) + 1):
            keys.add((r["book"], r["chapter"], v))
    return keys
