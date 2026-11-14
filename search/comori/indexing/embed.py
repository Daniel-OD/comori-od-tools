from __future__ import annotations

from .embedder import Embedder


def embed_missing(conn, embedder: Embedder, batch: int = 128, log=print) -> int:
    total = 0
    while True:
        with conn.cursor() as cur:
            cur.execute("""SELECT p.id, p.text, a.title FROM passages p JOIN articles a ON a.id=p.article_id
                           WHERE p.embedding IS NULL AND a.duplicate_of IS NULL ORDER BY p.id LIMIT %s""", (batch,))
            rows = cur.fetchall()
            if not rows:
                break
            vecs = embedder.embed_passages([f"{r['title']}\n{r['text']}" for r in rows])
            cur.executemany("UPDATE passages SET embedding=%s WHERE id=%s", [(v, r["id"]) for v, r in zip(vecs, rows)])
        conn.commit()
        total += len(rows)
        log(f"embeddings: {total}")
    return total
