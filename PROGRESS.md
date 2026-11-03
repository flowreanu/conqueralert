# ConquerAlert — PROGRESS

## Stare curentă
- [x] S0: concept, vizualizări, alegerea stack-ului (Babylon.js), asset-uri CC0 descărcate și convertite în `.glb` în `public/models/`
- [x] S1: setup + cameră + selecție + mișcare
- [ ] S2: pathfinding + luptă
- [ ] S3: economie + construcție + producție + sidebar
- [ ] S4: bot + ceață + victorie + meniu + deploy → **Demo v0.1**

## Ce s-a făcut în S1
- Vite 8 + TypeScript + Babylon.js 9. Importuri Babylon „la bucată” prin `src/render/babylon.ts` (bundle principal ~390 KB gzip în loc de ~1,3 MB).
- `npm run dev` / `npm run build` / `npm test` (vitest, 13 teste pe hartă + simulare + scară). `vercel.json` pregătit.
- **Structură**
  - `src/data/*.json` — facțiuni, scară, modele, unități, clădiri.
  - `src/map/` — generator determinist al hărții „Delta Dunării” (96×96, celule de 2 m): râu care se desparte în deltă la sud, 2 poduri (rândurile 40 și 74), maluri de nisip, 4 câmpuri de minereu (vizuale; logica în S3), ~800 de copaci/stânci care blochează celule.
  - `src/sim/` — simulare separată de randare, 15 tick/s, modificată doar prin comenzi (`move`, `stop`) → pregătită pentru lockstep. `stateHash()` pentru detectarea desincronizării.
  - `src/render/` — teren (mesh cu culori pe vârfuri, netezit, fără aspect de „pixeli”), apă, poduri, copaci ca thin instances, umbre, cameră RTS, încărcare + normalizare + scalare + recolorare modele.
  - `src/ui/` — selecție și comenzi, HUD minimal.
- **Modele**: fiecare model e normalizat (axa lungă pe X, centrat, baza la y=0), scalat după tabelul din SPEC (vehicule după lungime, infanterie după înălțime, clădiri după amprentă × 0,92), contopit într-un singur mesh (MultiMaterial) și clonat per unitate (geometrie partajată). Corecții de orientare (`yaw`) și culori per material (`colors`) în `models.json`.
- **Clădiri**: cele 6 roluri pentru ambele facțiuni sunt plasate static în bazele demo (pentru verificarea scării); stau pe o fundație cu bordură în culoarea facțiunii (modelele city-kit nu se recolorează). Ocupă celule (blochează mișcarea).
- **Control**: click / drag-box / Shift (adaugă) / dublu-click (același tip pe ecran) / Esc; click dreapta = mută (formație care păstrează aranjamentul grupului, marker animat); X = stop; Ctrl+1–9 grup, 1–9 selectează, apăsat de 2 ori centrează camera; Ctrl+A toate unitățile.
- **Cameră**: 55°, fără rotire, WASD / săgeți / marginile ecranului, zoom cu rotița (22–130 m).
- **Mișcare (simplă)**: în linie dreaptă; vehiculele se întorc pe loc dacă unghiul > 45°, apoi pornesc; infanteria merge direct. Apa/obstacolele: alunecă pe margine, altfel se oprește (A* în S2).

## Note pentru sesiunea următoare (S2)
- Pathfinding A* pe grid (cost diagonal, evitare colțuri), urmărirea căii în `World.moveUnit`; păstrează `formationSlots`.
- Separare între unități (acum se pot suprapune în mers; sloturile finale nu se suprapun).
- Arme, HP, armuri × tipuri de damage în `src/data/weapons.json` + câmpuri noi în `units.json`; proiectile, moarte, bare de viață.
- Comanda de atac (click dreapta pe inamic) — selecția ignoră acum unitățile inamice.
- Clădirile au deja `id`/`owner` în `World.buildings` → pot primi HP în S2/S3.

## Asset-uri noi (Google Drive, folderul `Game_Assets`, id `1P1ejCJeLKS07emjhAMhW3KSCczENVXzu`)
Descărcate de Andrei de pe quaternius.com (CC0). Se citesc prin conectorul Google Drive, se convertesc în .glb și se integrează în S2:
- `drive-download-20261103T124331Z-1-001.zip` (3,6 MB)
- `drive-download-20261103T124408Z-1-001.zip` (9 MB)
- `drive-download-20261103T124508Z-1-001.zip` (21,6 MB)
- `drive-download-20261103T124642Z-1-001.zip` (2,8 MB)
- `Sci-Fi Essentials Kit[Standard].zip` (167 MB) — pentru Japonia (S5), nu e urgent
Țintă: Animated Tanks → Liberty/Ursus; Turrets → Turelă; Toon Shooter → Ranger/Conscript; Car Pack → Recoltor.

## Probleme cunoscute / provizorii
- Tanc Ursus (`Tank3.obj`) e o singură culoare (fără texturi); Katiușa (`artillery1`) e un tun vechi cu roți — ambele provizorii, cum s-a stabilit.
- Recoltorul (`craft_miner`) arată ca o navă; orientarea lui nu a fost verificată.
- Infanteria are aceeași siluetă pentru Ranger și Conscript (diferă doar culorile).

## Feedback de la Andrei
- Unitățile păreau disproporționate în randări → s-a aplicat tabelul de scară din SPEC.md (S1).
