from __future__ import annotations

import psycopg
from psycopg.rows import dict_row

from .config import ROOT, get_settings


def connect(register_vector: bool = True) -> psycopg.Connection:
    conn = psycopg.connect(get_settings().database_url, row_factory=dict_row)
    if register_vector:
        try:
            from pgvector.psycopg import register_vector as reg

            reg(conn)
        except psycopg.ProgrammingError:
            conn.rollback()  # extensia nu există încă (înainte de init-db)
    return conn


def init_schema() -> None:
    s = get_settings()
    sql = (ROOT / "sql" / "schema.sql").read_text(encoding="utf-8").replace("{DIM}", str(s.embed_dim))
    with connect(register_vector=False) as conn:
        conn.execute(sql)
        conn.commit()
