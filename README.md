# Comori OD Tools

Instrumente pentru [comori-od.ro](https://comori-od.ro): un cititor cu chat AI și un **motor de căutare după cuvinte și idei**.

## Componente

| Folder | Ce este |
|---|---|
| `docs/` | Aplicația web statică (GitHub Pages): browser Autori → Cărți → Articole, cititor, marcaje, statistici, chat AI |
| `worker.js` | Cloudflare Worker: proxy CORS către comori-od.ro și apeluri către modelul AI (Groq) |
| `search/` | **Comori Search**: crawler, PostgreSQL + pgvector, căutare hibridă BM25 + embeddings, „căutare după idee”, „articole înrudite”, API FastAPI și interfață proprie. Vezi [`search/README.md`](search/README.md) |

## Cum se leagă

Chatul AI (`docs/js/modules/ai-chat.js`) cere context din `docs/js/modules/rag.js`, care apelează API-ul Comori Search.
Setează adresa API-ului în `docs/js/config.js` (`SEARCH_API_URL`). Până atunci chatul folosește doar articolul deschis și nu
inventează surse. API-ul trebuie să permită originea aplicației (`ALLOWED_ORIGINS` în `search/.env`).

## Pornire rapidă

- Aplicația web: deschide `docs/index.html` printr-un server local (modulele ES nu merg din `file://`), de exemplu `python -m http.server -d docs`.
- Motorul de căutare: urmează `search/README.md` (instalare, lot-pilot, calibrare).

## Verificări

`npm run check` verifică sintaxa; CI rulează și testele din `search/` pe PostgreSQL cu pgvector.

## Istoric

Indexarea anterioară (TF-IDF în browser, `scripts/build-rag-index.mjs` și fluxul de lucru asociat), copia veche din `src/` și
`comori-od-analyzer.html` au fost eliminate: `docs/` este versiunea publicată, iar căutarea este acum în `search/`.
