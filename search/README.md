# Comori Search

Motor de cercetare pentru biblioteca [Comori OD](https://comori-od.ro): căutare după cuvinte, expresii și **idei**,
cu explicația fiecărui rezultat și legătură directă către sursa originală.

> **Stare:** codul rulează cap-la-cap pe PostgreSQL + pgvector real (22 de teste, inclusiv API), dar cu un embedder de
> test (hash de cuvinte, *nu semantic*). Încă **nu a fost rulat pe site-ul real** și nici cu modelul de embeddings real:
> mediul în care a fost scris nu avea acces la comori-od.ro. Parserul HTML a fost scris după structura unei pagini reale
> de articol (linkuri `/author/`, `/book/`, `/volume/`, `/bible/`, anterior/următor, „Articol N din M”), dar trebuie
> verificat pe paginile reale — vezi „Primii pași”.

## Ce face

| Funcție | Cum |
|---|---|
| Căutare lexicală | BM25 pe pasaje, stemming românesc, fără diacritice, toleranță la greșeli (`rugacuine` → rugăciune), extindere cu tezaur (`data/thesaurus.yaml`) |
| Expresii exacte | `"între ghilimele"` sau modul „Expresie exactă” (fără diacritice, ș/ş/ț/ţ unificate) |
| Căutare semantică | embeddings multilingve + pgvector (HNSW, cosinus) |
| Hibrid | Reciprocal Rank Fusion (BM25 + semantic + fraze), agregat pe articol |
| **Căutare după idee** | paragraf/propoziție → pasaje apropiate ca sens; prag minim + prag relativ; se afișează „nimic suficient de apropiat” în loc de rezultate slabe |
| **Articole înrudite** | buton pe fiecare rezultat/articol: caută pasajele articolului în toată biblioteca |
| Explicații | fiecare rezultat spune *de ce*: pasaj apropiat (cu scor), cuvinte comune, versete comune, teme comune; dacă ideea e exprimată cu alte cuvinte, spune asta |
| Metadate | autor, carte, volum, poziție în carte, referințe biblice, cuvinte-cheie (TF-IDF), expresii (bigrame), teme |
| Dedublare | `content_hash`; duplicatele rămân în bază (`duplicate_of`) dar sunt excluse din căutare |
| Actualizare | crawlerul e reluabil; `ingest` e idempotent (doar articolele modificate se reindexează) |

Scorurile sunt **orientative**, nu afirmații doctrinare; interfața o spune explicit.

## Arhitectură

```
comori-od.ro ──crawler──▶ data/raw (HTML cache) + data/articles.jsonl
                              │ ingest (chunking, dedup, referințe biblice)
                              ▼
                   PostgreSQL + pgvector ◀── embed (passage embeddings)
                              │             keywords / teme
                              ├── build-bm25 ─▶ data/index (BM25 pe disc)
                              ▼
                   FastAPI (/api/*) ──▶ web/ (interfață în română)
```

- `comori/crawler/` — `fetcher.py` (robots.txt, rată limitată, cache, se oprește la 401/403), `parsers.py`, `crawl.py`, `discover.py`
- `comori/indexing/` — `ingest.py`, `keywords.py`, `embedder.py`, `embed.py`, `build_bm25.py`
- `comori/search/` — `lexical.py` (BM25), `engine.py` (hibrid/idee/înrudite), `explain.py`, `thesaurus.py`
- `comori/api/main.py` — API; `web/` — interfață; `eval/` — evaluare; `sql/schema.sql` — schema

Pasajele (~170 de cuvinte, respectă paragrafele/propozițiile) păstrează `start_char/end_char` în textul articolului,
deci pasajul găsit se evidențiază exact în articolul integral.

## Instalare

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # editează USER_AGENT (pune un contact real) și, la nevoie, DATABASE_URL
docker compose up -d            # PostgreSQL + pgvector  (sau vezi „Supabase” mai jos)
python -m comori.cli init-db
```

## Primii pași (lot-pilot de 100–200 de articole — recomandat înainte de tot restul)

```bash
# 1. Există un API/sitemap mai eficient? (doar citește pagina, robots.txt și fișierele JS publice)
python -m comori.cli discover https://comori-od.ro/article/-crezi-tu-hristos-vindecatorul-nostru-traian-dorz

# 2. Verifică parserul pe o pagină reală: titlu, autor, carte, text curat, versete, anterior/următor
python -m comori.cli inspect https://comori-od.ro/article/-crezi-tu-hristos-vindecatorul-nostru-traian-dorz

# 3. Lot-pilot, divers (alternează între cărți/autori); urmează și lanțul anterior/următor
python -m comori.cli crawl --limit 150
#    dacă listele (autori/cărți) se încarcă din JavaScript și nu găsește linkuri:
python -m comori.cli crawl --limit 150 --seed https://comori-od.ro/article/-crezi-tu-hristos-vindecatorul-nostru-traian-dorz

# 4. Indexare
python -m comori.cli index        # ingest + keywords + embed + build-bm25
python -m comori.cli stats
python -m comori.cli serve        # http://127.0.0.1:8000
```

Dacă `inspect` arată text greșit (meniuri în text, titlu dublat, text gol), ajustează `parse_article` în
`comori/crawler/parsers.py` (are un parametru `body_selector`). Aceasta este singura parte care depinde de HTML-ul exact.

### Calibrarea calității (înainte de indexarea integrală)

1. Pornește aplicația și încearcă 20–30 de căutări reale, în special **„După idee”**.
2. `python -m comori.cli eval --csv rezultate.csv` scrie rezultatele pentru etichetare manuală (coloana „relevant?”).
3. Completează `expect:`/`avoid:` în `eval/queries.yaml` cu fragmente de URL → `eval` raportează hit@k și MRR.
4. Ajustează în `.env`: `IDEA_MIN_SIM` (prag absolut de cosinus) și `IDEA_REL_DROP` (cât sub cel mai bun rezultat se mai acceptă).
   Valorile cosinus diferă mult între modele (e5 produce valori mari, în jur de 0,8–0,9), de aceea sunt configurabile, nu fixe.
5. Compară modelele (`EMBED_MODEL`: `multilingual-e5-base` / `-large` / `BAAI/bge-m3`) pe aceleași întrebări.
   Schimbarea modelului cere `init-db` pe o bază goală (dimensiunea vectorului se schimbă) și re-`embed`.
6. Completează `data/thesaurus.yaml` cu expresiile pe care le folosești în studiu.

Abia apoi: `python -m comori.cli crawl` (fără `--limit`) și `index` pe întreaga bibliotecă.

## Politețe și limite

- Respectă `robots.txt` (inclusiv `Crawl-delay`), 1,5 s între cereri implicit, cache pe disc, `User-Agent` identificabil.
- La `401/403` sau interdicție în robots.txt **se oprește**; nu încearcă să ocolească protecțiile.
- Dacă există un export oficial sau un API permis, e preferabil crawlerului; cere-l administratorilor Comori OD.
- Textele aparțin autorilor/editorilor: aplicația e pentru studiu personal; păstrează mereu linkul spre sursă.

## Supabase în loc de Docker

Supabase este PostgreSQL cu `pgvector`, deci schema funcționează neschimbată: pune în `.env` șirul de conexiune
(`DATABASE_URL=postgresql://postgres:…@db.<ref>.supabase.co:5432/postgres`) și rulează `init-db`.
Atenție la spațiu: un vector de 768 de dimensiuni ocupă ~3 KB per pasaj, plus indexul HNSW; pentru zeci de mii de pasaje
verifică limita planului. Dacă e prea mult, folosește `intfloat/multilingual-e5-small` (384 de dimensiuni).

## API

`GET /api/search?q=&mode=hybrid|lexical|semantic|idea|phrase&author=&book=&volume=&category=&limit=&offset=` ·
`POST /api/idea {text}` · `GET /api/related/{id}` · `GET /api/article/{id}` · `GET /api/facets` · `GET /api/stats`

Un rezultat conține: titlu, autor, carte, volum, fragment, `relevance`, `similarity`, `confidence`, `reasons[]`, `url`.

## Teste

```bash
pytest -q                                                         # 15 teste offline (parser, chunking, BM25, explicații…)
TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/test pytest -q   # + 7 teste cap-la-cap pe Postgres/pgvector
```
Atenție: testul cu baza de date **șterge schema `public`** din baza indicată; folosește o bază separată.

## Ce nu este (încă) verificat

- Parserul pe HTML-ul real al site-ului și paginarea listelor.
- Calitatea semantică a modelului real pe textele Comori OD (de aceea calibrarea de mai sus).
- Performanța pe ~10.000 de articole (estimat ~100.000+ pasaje; HNSW și BM25 sparse ar trebui să fie fără probleme, dar nu e măsurat).
