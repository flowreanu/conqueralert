# ConquerAlert — SPEC

RTS în browser, inspirat de Red Alert 2. Trei facțiuni: SUA, URSS, Japonia.
Acest fișier conține **deciziile fixe**. Progresul e în `PROGRESS.md`.

## Decizii (valorile implicite; se schimbă doar aici)

| Subiect | Decizie |
|---|---|
| Platformă | Browser (desktop), deploy pe Vercel |
| Stack | Vite + TypeScript + Babylon.js (`@babylonjs/core`, `@babylonjs/loaders`) |
| Control | Click stânga = selecție (click + drag-box), click dreapta = comandă (mișcare / atac / recoltare) |
| Cameră | Unghi fix (~55°), pan cu WASD / săgeți / marginile ecranului, zoom cu rotița, fără rotire |
| Hartă demo | 96×96 celule, 1 celulă = 2 m; harta „Delta Dunării” (râu + 2 poduri), 1v1 |
| Tick simulare | 15 tick/s, logică separată de randare (pregătită pentru lockstep multiplayer) |
| Date | Unități, clădiri, arme și scări în `src/data/*.json` |
| Stil grafic | Low-poly minimalist, modele CC0 recolorate la runtime pe facțiune |
| UI | Sidebar HTML/CSS în dreapta, gen RA2 (credite, minimap, taburi, cozi, energie) |

## Culori facțiuni

- SUA: `#3d7fe0` principal, `#cdd8e2` secundar, `#2c3a46` închis
- URSS: `#c23a2f` principal, `#8c8468` secundar, `#2d2a26` închis
- Japonia: `#ece6d6` principal, `#c2263a` accent, `#2b2b30` închis

## Scara de joc (exagerată intenționat, ca în RTS-uri)

Mărimi în metri pe hartă (lungime pentru vehicule, înălțime pentru infanterie):

| Tip | Mărime |
|---|---|
| Infanterie | 2.6 înălțime |
| Tanc ușor/mediu | 5.5 |
| Tanc greu | 6.5 |
| Artilerie | 5.5 |
| Recoltor | 6 |
| Clădire mică (turelă, centrală) | 2×2 celule |
| Clădire medie (barăci, rafinărie) | 3×3 celule |
| Clădire mare (centru construcție, fabrică) | 4×4 celule |

## Demo v0.1 — SUA vs URSS

**Clădiri (aceleași 6 roluri pentru ambele):** Centru de Construcție, Centrală, Rafinărie, Barăci, Fabrică de vehicule, Turelă.

| Rol | SUA | URSS |
|---|---|---|
| Infanterie | Ranger | Conscript |
| Tanc | Tanc Liberty (rapid, mediu) | Tanc Ursus (greu, lent, 2 tunuri) |
| Suport | Sentinel (artilerie) | Katiușa (rachete) |
| Economie | Recoltor | Recoltor |

**Mecanici:** selecție, mișcare cu pathfinding A*, luptă (armuri × tipuri de damage), minereu/credite, energie, cozi de producție, plasare clădiri pe grid, ceață de război simplă, bot, victorie/înfrângere, meniu cu alegerea facțiunii.

**Nu intră în v0.1:** multiplayer, Japonia, aviație, flotă, superarme, sunet.

## Roadmap

| # | Sesiune | Livrabil |
|---|---|---|
| S1 | Setup Vite/TS/Babylon, teren + râu, cameră RTS, încărcare modele + recolorare, tabel de scară, selecție, mișcare simplă | Selectezi și muți tancuri |
| S2 | Pathfinding A* pe grid, separare unități, arme, HP, proiectile, moarte, bare de viață | Luptă între unități plasate manual |
| S3 | Minereu + recoltor, credite, plasare clădiri, energie, producție, sidebar | Construiești baza și produci armată |
| S4 | Bot (build order, economie, valuri de atac), ceață, victorie, meniu, deploy | **Demo jucabil prin link** |
| S5 | Facțiunea Japonia (mecha, hover-tancuri, transformare sol ↔ aer) | 3 facțiuni |
| S6 | Aviație și AA, Turn Fulger, dirijabil, elicopter | Mai multe trupe |
| S7 | Balansare, efecte, sunet | Polish |
| S8 | Multiplayer lockstep (relay WebSocket, lobby, link de invitație) | Joc online |

## Reguli de lucru (economie de prompturi)

- Un chat nou pentru fiecare sesiune: „Continuăm ConquerAlert. Citește PROGRESS.md și fă S<n>.”
- O sesiune = un milestone complet, fără întrebări pe parcurs.
- Verificare prin build + teste pe simulare, fără screenshot-uri.
- Feedback-ul vine grupat, într-un singur mesaj la începutul sesiunii următoare.
- La final de sesiune se actualizează `PROGRESS.md`, apoi commit + **push direct pe `main`** în `github.com/flowreanu/conqueralert` (Andrei a cerut asta; nu e nevoie de confirmare).

## Asset-uri

Vezi `ASSETS.md`. Toate sunt CC0.
