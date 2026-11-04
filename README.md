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

Comenzi: click = selectează · drag = dreptunghi · click dreapta = mută / atacă / recoltează / intră în casă / capturează (inginer) ·
Ctrl+click dreapta sau F = attack-move (și atac forțat pe case) · X = stop · Ctrl+1–9 = grup · WASD / margini = cameră · rotița = zoom · P = pauză.

## Deploy pe GitHub Pages

Automat: la fiecare push pe `main`, GitHub Action-ul `.github/workflows/deploy.yml` rulează testele,
face build-ul (`--base=/conqueralert/`) și publică `dist/` pe ramura `gh-pages`. Manual (dacă e nevoie):

```bash
npm run build -- --base=/conqueralert/
# conținutul dist/ se publică pe ramura gh-pages
```
