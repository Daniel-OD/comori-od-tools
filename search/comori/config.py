from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

KNOWN_DIMS = {
    "intfloat/multilingual-e5-small": 384,
    "intfloat/multilingual-e5-base": 768,
    "intfloat/multilingual-e5-large": 1024,
    "BAAI/bge-m3": 1024,
}


def _load_dotenv() -> None:
    p = ROOT / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


@dataclass(frozen=True)
class Settings:
    base_url: str
    user_agent: str
    request_interval: float
    database_url: str
    embedder: str
    embed_model: str
    embed_dim: int
    idea_min_sim: float
    idea_rel_drop: float
    data_dir: Path

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def articles_jsonl(self) -> Path:
        return self.data_dir / "articles.jsonl"

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "index"


@lru_cache
def get_settings() -> Settings:
    _load_dotenv()
    e = os.environ.get
    model = e("EMBED_MODEL", "intfloat/multilingual-e5-base")
    embedder = e("EMBEDDER", "st")
    dim = int(e("EMBED_DIM", "0")) or (256 if embedder == "fake" else KNOWN_DIMS.get(model, 768))
    return Settings(
        base_url=e("BASE_URL", "https://comori-od.ro").rstrip("/"),
        user_agent=e("USER_AGENT", "ComoriSearchBot/0.1 (proiect personal de studiu)"),
        request_interval=float(e("REQUEST_INTERVAL", "1.5")),
        database_url=e("DATABASE_URL", "postgresql://comori:comori@localhost:5432/comori"),
        embedder=embedder,
        embed_model=model,
        embed_dim=dim,
        idea_min_sim=float(e("IDEA_MIN_SIM", "0.80")),
        idea_rel_drop=float(e("IDEA_REL_DROP", "0.07")),
        data_dir=Path(e("DATA_DIR", str(ROOT / "data"))),
    )
