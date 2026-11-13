"""BM25 pe pasaje: stemming românesc fără diacritice, toleranță la greșeli (fuzzy), fraze exacte."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import scipy.sparse as sp
from rapidfuzz import fuzz, process

from ..text import analyze


class BM25Index:
    def __init__(self, k1: float = 1.2, b: float = 0.75):
        self.k1, self.b = k1, b
        self.ids: np.ndarray = np.array([], dtype=np.int64)
        self.vocab: dict[str, int] = {}
        self.W: sp.csc_matrix | None = None
        self._vocab_list: list[str] | None = None

    def fit(self, ids: list[int], token_lists: list[list[str]]) -> "BM25Index":
        vocab: dict[str, int] = {}
        rows, cols, data = [], [], []
        for r, toks in enumerate(token_lists):
            counts: dict[int, int] = {}
            for t in toks:
                j = vocab.setdefault(t, len(vocab))
                counts[j] = counts.get(j, 0) + 1
            for j, c in counts.items():
                rows.append(r); cols.append(j); data.append(c)
        n, v = len(token_lists), len(vocab)
        tf = sp.csr_matrix((np.array(data, dtype=np.float32), (rows, cols)), shape=(n, max(v, 1)))
        dl = np.asarray(tf.sum(axis=1)).ravel()
        avgdl = float(dl.mean()) if n else 1.0
        df = np.asarray((tf > 0).sum(axis=0)).ravel()
        idf = np.log(1 + (n - df + 0.5) / (df + 0.5)).astype(np.float32)
        tf = tf.tocoo()
        denom = tf.data + self.k1 * (1 - self.b + self.b * dl[tf.row] / avgdl)
        w = tf.data * (self.k1 + 1) / denom * idf[tf.col]
        self.W = sp.csc_matrix((w.astype(np.float32), (tf.row, tf.col)), shape=tf.shape)
        self.ids, self.vocab, self._vocab_list = np.array(ids, dtype=np.int64), vocab, None
        return self

    def _fix(self, term: str) -> str | None:
        if term in self.vocab:
            return term
        if len(term) < 5:
            return None
        if self._vocab_list is None:
            self._vocab_list = list(self.vocab)
        m = process.extractOne(term, self._vocab_list, scorer=fuzz.ratio, score_cutoff=84)
        return m[0] if m else None

    def score(self, terms: dict[str, float], k: int = 100, fuzzy: bool = True) -> list[tuple[int, float]]:
        if self.W is None or not len(self.ids):
            return []
        scores = np.zeros(len(self.ids), dtype=np.float32)
        hit = False
        for t, w in terms.items():
            real, wt = t, w
            if t not in self.vocab:
                real = self._fix(t) if fuzzy else None
                wt = w * 0.8
            if real is None:
                continue
            col = self.W[:, self.vocab[real]]
            scores[col.indices] += wt * col.data
            hit = True
        if not hit:
            return []
        k = min(k, len(scores))
        top = np.argpartition(-scores, k - 1)[:k]
        top = top[scores[top] > 0]
        top = top[np.argsort(-scores[top])]
        return [(int(self.ids[i]), float(scores[i])) for i in top]

    def query(self, text: str, k: int = 100, extra: dict[str, float] | None = None) -> list[tuple[int, float]]:
        terms = {t: 1.0 for t in analyze(text)}
        if extra:
            for t, w in extra.items():
                terms.setdefault(t, w)
        return self.score(terms, k)

    # ------------------------------------------------------------ persistență (fără pickle)
    def save(self, d: Path) -> None:
        d.mkdir(parents=True, exist_ok=True)
        sp.save_npz(d / "bm25_w.npz", self.W)
        np.save(d / "bm25_ids.npy", self.ids)
        (d / "bm25_vocab.json").write_text(json.dumps(self.vocab, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def load(cls, d: Path) -> "BM25Index":
        o = cls()
        o.W = sp.load_npz(d / "bm25_w.npz").tocsc()
        o.ids = np.load(d / "bm25_ids.npy")
        o.vocab = json.loads((d / "bm25_vocab.json").read_text(encoding="utf-8"))
        return o
