# Comori Search pe Supabase

Supabase este PostgreSQL cu `pgvector`, deci motorul rulează neschimbat. Proiectul tău: `uwmwegelxqiambeuqqbs`.

## Stare
Schema a fost deja aplicată în proiect (migrarea `comori_search_schema`: 6 tabele, `vector` 0.8.2 și `pg_trgm` în schema `extensions`,
indexuri HNSW și trigram, RLS activat). Dimensiunea vectorilor este **768** (`multilingual-e5-base`). Fișierul aplicat este
`sql/supabase_schema_768.sql`. Tabelele sunt goale: urmează lotul-pilot. Avertismentul „RLS enabled, no policy” din Supabase
este intenționat: tabelele nu se citesc prin API-ul REST, ci doar prin serverul Comori Search.

Dacă schimbi modelul (altă dimensiune), schimbă coloana `passages.embedding` și reface indexul HNSW.

## 1. Conexiunea
Supabase → **Connect** → copiază șirul de conexiune (direct sau *Session pooler*, port 5432) în `search/.env`:

```
DATABASE_URL=postgresql://postgres.<project_ref>:<PAROLA>@aws-0-<regiune>.pooler.supabase.com:5432/postgres
EMBED_MODEL=intfloat/multilingual-e5-base   # 768 dimensiuni (sau multilingual-e5-small = 384, mai puțin spațiu)
```

## 2. Schema
```bash
cd search
python -m comori.cli init-db
```
Comanda creează extensiile (`vector`, `pg_trgm`), tabelele și indexurile, și **activează RLS** pe toate tabelele,
ca să nu poată fi citite sau scrise prin API-ul REST Supabase cu cheia `anon`. Serverul Comori Search se conectează direct
cu rolul `postgres`, care ignoră RLS.

Alternativ, din SQL Editor: înlocuiește `{DIM}` cu `768` în `sql/schema.sql` și rulează-l.

## 3. Restul
Același flux ca local: `inspect` → `crawl --limit 150` → `index` → `serve` (vezi README.md).

## Spațiu
Planul gratuit are o limită de stocare a bazei de date. Un vector de 768 de dimensiuni ocupă ~3 KB per pasaj, la care se adaugă
indexul HNSW. Verifică `python -m comori.cli stats` după lotul-pilot și extrapolează înainte de indexarea integrală.
Dacă e prea mult: `multilingual-e5-small` (384) înjumătățește vectorii.

## Cu serverul MCP Supabase
Comenzile `claude mcp add …` și `claude /mcp` configurează Claude Code **pe computerul tău**; nu schimbă sesiunea unui agent din cloud.
Cu serverul MCP conectat local, Claude Code poate inspecta tabelele și rula interogări, dar crawlerul și embeddings se rulează oricum
unde ai acces la comori-od.ro.
