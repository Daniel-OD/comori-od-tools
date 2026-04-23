# Comori OD Tools

Instrument de analiza si interpretare AI pentru [comori-od.ro](https://comori-od.ro).

## Functionalitati
- Browser: Autori -> Carti -> Articole
- Cititor articole
- Chat AI specializat (Claude)
- Statistici vizuale

## Live
https://daniel-od.github.io/comori-od-tools/

## Utilizare
Deschide src/index.html in browser.

## Cloudflare Worker - secret ANTHROPIC_KEY
Configureaza cheia API in Worker ca secret:

```bash
wrangler secret put ANTHROPIC_KEY
```
