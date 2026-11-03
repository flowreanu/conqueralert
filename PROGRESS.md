# ConquerAlert — PROGRESS

## Stare curentă
- [x] S0: concept, vizualizări, alegerea stack-ului (Babylon.js), asset-uri CC0 descărcate și convertite în `.glb` în `public/models/`
- [x] S1: setup + cameră + selecție + mișcare
- [x] S2: pathfinding + separare + luptă
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

## Ce s-a făcut în S2
- **Pathfinding** (`src/sim/pathfinding.ts`): A* pe grilă, 8 direcții, cost diagonal √2, fără tăierea colțurilor, heap determinist. Tancurile (rază > 1,2 m) folosesc o hartă de „spațiu liber” (celula + cei 8 vecini liberi) ca să nu se înghesuie între copaci; dacă nu există cale, se reîncearcă fără restricție. Calea e netezită („string pulling”). Harta de spațiu liber se recalculează când apare/dispare o clădire (`paths.invalidate()`).
- **Separare**: coliziuni cerc-cerc pe `radius`, cu grilă spațială. Cine stă pe loc se dă la o parte (85% din împingere), două unități în mers se împart egal și alunecă lateral (se ocolesc); vehiculele grele se împing greu. Blocaj > 1,3 s → recalculează calea; lângă destinație acceptă sosirea.
- **Luptă** (`src/data/weapons.json` + câmpuri noi `hp`, `armor`, `weapon`, `sight` în `units.json`, `hp`/`weapon` în `buildings.json`):
  - armuri `infantry / light / heavy / building` × damage `bullet / ap / he / rocket` (tabelul `versus`);
  - arme cu rază, cooldown, rafale (Ursus 2 tunuri, Katiușa 4 rachete cu împrăștiere), rază minimă la artilerie, explozii cu rază (Sentinel, Katiușa);
  - proiectile simulate (gloanțe, obuze care urmăresc ținta, obuze în arc / rachete trase în punctul de pe sol → pot rata ținte mobile);
  - comanda `attack` (click dreapta pe unitate/clădire inamică), urmărirea țintei cu repath; unitățile inactive trag singure în ce intră în rază și ripostează la atacatori până la `sight + 6` m; turelele (clădire) apără baza;
  - moartea unităților, distrugerea clădirilor (eliberează celulele); evenimente `fire / impact / death` pentru efecte.
  - Recoltorul ignoră ordinul de atac.
- **Randare**: bare de viață (selectat / avariat / sub cursor; verde-galben-roșu, peste modele), proiectile interpolate, flăcări la țeavă, explozii, fum, urme arse pe sol (`src/render/effects.ts`, totul din instanțe). Cursor roșu de atac + marker roșu pe țintă. HUD: numărul de unități per facțiune și viața totală a selecției.
- **Modele noi** (Quaternius, CC0, convertite OBJ → GLB cu `obj2gltf`): Liberty = `q_Tank2`, Ursus = `q_Tank` (se recolorează: Main / Main_Light / Main_Dark / Main_Details / Wheels → culorile facțiunii), Recoltor = `q_SUV` (provizoriu).
- 24 de teste (A* peste pod, ocolirea pădurii, separare, multiplicatori, atac, auto-țintire, tanc vs. infanterie, rază minimă, explozie cu rază, distrugerea clădirii + turelă, determinism cu luptă).

## Note pentru sesiunea următoare (S3)
- Economie: minereu pe celulele `Terrain.Ore` (cantitate per celulă), recoltorul (are deja HP și nu luptă) merge la câmp → rafinărie → credite.
- Plasare clădiri pe grid (`World.placeBuilding` există; apelează deja `paths.invalidate()`), energie, cozi de producție, sidebar RA2.
- Unitățile produse ies din Barăci / Fabrică — punct de adunare.
- Idei rămase din S2: attack-move (tastă dedicată; A e ocupat de cameră), turnulețe care se rotesc separat de șasiu (modelele sunt contopite într-un singur mesh acum), sunet (S7).

## Asset-uri Google Drive (folderul `Game_Assets`, id `1P1ejCJeLKS07emjhAMhW3KSCczENVXzu`)
- ✅ `…124331Z…` (Tank Pack) și `…124642Z…` (Car Pack) — integrate în S2.
- ❌ `…124408Z…` (9 MB, Turrets) și `…124508Z…` (21,6 MB, Toon Shooter) — conectorul Google Drive nu poate descărca fișiere peste ~5–10 MB. **Andrei:** urcă-le direct în repo (de ex. `assets-src/`) sau împarte-le în arhive < 4 MB, și le integrez în S3 (Turelă, Ranger/Conscript cu siluete diferite).
- `Sci-Fi Essentials Kit[Standard].zip` (167 MB) — pentru Japonia (S5); aceeași problemă de mărime.

## Probleme cunoscute / provizorii
- Katiușa (`artillery1`) e un tun vechi cu roți — provizoriu.
- Recoltorul e acum un SUV (`q_SUV`) — măcar e vehicul de sol, dar nu arată a utilaj minier; de înlocuit când găsim un camion.
- Infanteria are aceeași siluetă pentru Ranger și Conscript (diferă doar culorile) — se rezolvă cu Toon Shooter.
- Turela de bază nu se rotește vizual spre țintă (trage corect în simulare).
- Liberty și Ursus vin din același pachet → silueta e asemănătoare; diferă prin mărime (5,5 vs 6,5 m) și culoare.

## Feedback de la Andrei
- Unitățile păreau disproporționate în randări → s-a aplicat tabelul de scară din SPEC.md (S1).
- Test S1: unele unități mergeau cu spatele → reparat după S1 (infanterie `yaw` 90, recoltor `yaw` 180; tancurile, Sentinel și Katiușa erau corecte).
- Test S1: unitățile se suprapun / se lipesc în mers, fără „hitbox” → rezolvat în S2 (separare cerc-cerc).
- Test S1: doar unitățile albastre sunt controlabile → intenționat (URSS e botul). Din S2: click dreapta pe o unitate roșie = atac.
