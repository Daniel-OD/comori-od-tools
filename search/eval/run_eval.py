"""Evaluare simplă: hit@k, MRR și export CSV pentru etichetare manuală."""
from __future__ import annotations

import csv

import yaml

from comori.config import ROOT
from comori.db import connect
from comori.search.engine import Searcher


def run(csv_path: str | None = None) -> None:
    cfg = yaml.safe_load((ROOT / "eval" / "queries.yaml").read_text(encoding="utf-8"))
    k = cfg.get("k", 10)
    rows, hit, rr, n_lab = [], 0, 0.0, 0
    with connect() as conn:
        s = Searcher(conn)
        for item in cfg["queries"]:
            res = s.search(item["query"], item.get("mode", "hybrid"), limit=k)
            urls = [r["url"] for r in res["results"]]
            print(f"\n== [{item.get('mode','hybrid')}] {item['query'][:80]}  (total {res['total']}, top sim {res.get('top_similarity')})")
            for i, r in enumerate(res["results"], 1):
                print(f"{i:2}. {r['similarity'] or '-':<7} {r['title'][:60]} | {r['author']} | {r['url']}")
                rows.append([item["query"], item.get("mode"), i, r["url"], r["title"], r["similarity"], r["relevance"], " ".join(r["reasons"]), ""])
            exp = item.get("expect") or []
            if exp:
                n_lab += 1
                pos = next((i for i, u in enumerate(urls, 1) if any(e in u for e in exp)), None)
                hit += pos is not None
                rr += 1 / pos if pos else 0
                bad = [u for u in urls if any(a in u for a in item.get("avoid") or [])]
                print(f"   -> prima potrivire corectă la poziția {pos}; apariții nedorite: {len(bad)}")
    if n_lab:
        print(f"\nhit@{k} = {hit}/{n_lab}   MRR = {rr / n_lab:.3f}")
    else:
        print("\nNu ai completat `expect` în eval/queries.yaml: afișez doar rezultatele (folosește --csv pentru etichetare).")
    if csv_path:
        with open(csv_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["query", "mode", "rank", "url", "title", "similarity", "relevance", "reasons", "relevant? (da/nu/parțial)"])
            w.writerows(rows)
        print(f"CSV scris: {csv_path}")
