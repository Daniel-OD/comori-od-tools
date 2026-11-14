from __future__ import annotations

import hashlib
from typing import Protocol

import numpy as np

from ..config import Settings, get_settings
from ..text import analyze


class Embedder(Protocol):
    dim: int

    def embed_passages(self, texts: list[str]) -> np.ndarray: ...
    def embed_query(self, text: str) -> np.ndarray: ...


class SentenceTransformerEmbedder:
    def __init__(self, model: str, dim: int):
        from sentence_transformers import SentenceTransformer

        self.model_name, self.dim = model, dim
        self.model = SentenceTransformer(model)
        low = model.lower()
        self.q_prefix, self.p_prefix = ("query: ", "passage: ") if "e5" in low else ("", "")

    def _enc(self, texts: list[str]) -> np.ndarray:
        return np.asarray(self.model.encode(texts, batch_size=32, normalize_embeddings=True,
                                            show_progress_bar=len(texts) > 64), dtype=np.float32)

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        return self._enc([self.p_prefix + t for t in texts])

    def embed_query(self, text: str) -> np.ndarray:
        return self._enc([self.q_prefix + text])[0]


class HashEmbedder:
    """NU este semantic: hashing de stem-uri. Doar pentru teste/fum-test fără model."""

    def __init__(self, dim: int = 256):
        self.dim = dim

    def _one(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        for tok in analyze(text):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            v[h % self.dim] += 1.0 if (h >> 64) & 1 else -1.0
        n = np.linalg.norm(v)
        return v / n if n else v

    def embed_passages(self, texts: list[str]) -> np.ndarray:
        return np.stack([self._one(t) for t in texts])

    def embed_query(self, text: str) -> np.ndarray:
        return self._one(text)


_cache: dict[str, Embedder] = {}


def get_embedder(s: Settings | None = None) -> Embedder:
    s = s or get_settings()
    key = f"{s.embedder}:{s.embed_model}"
    if key not in _cache:
        _cache[key] = HashEmbedder(s.embed_dim) if s.embedder == "fake" else SentenceTransformerEmbedder(s.embed_model, s.embed_dim)
    return _cache[key]
