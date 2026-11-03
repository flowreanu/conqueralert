# ConquerAlert

RTS în browser, inspirat de Red Alert 2, construit cu Babylon.js.

- `SPEC.md` — deciziile de design și roadmap-ul
- `PROGRESS.md` — ce e gata și ce urmează
- `ASSETS.md` — sursele și licențele modelelor 3D

## Rulare

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # teste pe simulare
npm run build    # dist/ (deploy pe Vercel)
```

## Joacă

Demo v0.1: https://flowreanu.github.io/conqueralert/ (SUA vs URSS, contra botului).

Comenzi: click = selectează · drag = dreptunghi · click dreapta = mută / atacă / recoltează ·
Ctrl+click dreapta sau F = attack-move · X = stop · Ctrl+1–9 = grup · WASD / margini = cameră · rotița = zoom · P = pauză.

## Deploy pe GitHub Pages

```bash
npm run build -- --base=/conqueralert/
# conținutul dist/ se publică pe ramura gh-pages
```
