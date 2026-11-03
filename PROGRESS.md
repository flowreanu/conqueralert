# ConquerAlert — PROGRESS

## Stare curentă
- [x] S0: concept, vizualizări, alegerea stack-ului (Babylon.js), asset-uri CC0 descărcate și convertite în `.glb` în `public/models/`
- [x] S1: setup + cameră + selecție + mișcare
- [x] S2: pathfinding + separare + luptă
- [x] S3: economie + construcție + producție + sidebar
- [x] S4: bot + ceață + victorie + meniu + deploy → **Demo v0.1**
- [x] S4.1: echilibrare (infanterie, bot Ușor, urmărire, minereu)
- [ ] S5: facțiunea Japonia

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

## Ce s-a făcut în S3
- **Economie** (`src/sim/economy.ts`, totul prin comenzi → determinist, pregătit pentru lockstep):
  - minereu per celulă (`map.ore`, 200–500 credite/celulă, mai bogat spre centrul câmpului; crește înapoi foarte încet: +2 la 20 s);
  - recoltor cu stări `toOre → mining → toRef → unload` (1000 capacitate, 125 cr/s recoltare, 400 cr/s descărcare), BFS spre cel mai apropiat minereu, se întoarce unde a rămas, coadă la docul rafinăriei. Click dreapta pe minereu = recoltează, pe rafinăria proprie = descarcă, mișcare simplă = se oprește din lucru (X = stop). ≈ 1000 credite / 20 s per recoltor la câmpul de lângă bază;
  - credite: start 5000; afișaj care „curge” spre valoare, ca în RA2;
  - energie: Centrala +100 (proporțional cu viața), Rafinăria −40, Barăcile −20, Fabrica −40, Turela −30. Sub necesar: producția la 50% și turelele nu mai trag;
  - 4 cozi (Clădiri, Apărare, Infanterie, Vehicule), costul se plătește progresiv (timp = cost / 75 cr/s, minim 3 s); fără bani coada așteaptă; clădirile se opresc la „GATA” până le plasezi; unitățile: până la 15 în coadă (Shift+click = ×5), click dreapta = anulează (banii se returnează);
  - cerințe: Centrală → Rafinărie / Barăci → Fabrică (Rafinărie + Barăci) → Turelă (Barăci); unitățile cer clădirea producătoare (dacă e distrusă, coada stă);
  - plasare pe grid: doar lângă baza proprie (≤ 6 celule de o clădire), nu pe apă / pod / minereu / copaci / unități;
  - Rafinăria vine cu un recoltor gratuit; unitățile ies prin fața clădirii și merg la punctul de adunare;
  - vânzare (50% din cost × viață, cu confirmare) și reparare (3%/s, costă 50% din cost pentru 100%).
- **Sidebar RA2** (`src/ui/sidebar.ts`): credite, minimap (click/drag = cameră, click dreapta = mută selecția, trapezul vizibil al camerei), bara de energie, 4 taburi cu indicator „în lucru / gata”, pictograme SVG cu ceas de progres, procent, „GATA”/„PLASEAZĂ”/„FONDURI”, panou pentru clădirea selectată (Repară / Vinde) sau recoltor (încărcătură, stare), notificări (construcție gata, unitate pregătită, energie insuficientă, fonduri insuficiente).
- **Hartă/interacțiune**: „fantoma” de plasare cu celule verzi/roșii; click pe clădire proprie = selecție (cadru verde); click dreapta cu Barăci/Fabrică selectate = punct de adunare (steag).
- **Randare**: unitățile/clădirile noi apar automat; clădirile plasate „cresc” din fundație; cristale de minereu (thin instances) care se micșorează pe măsură ce sunt recoltate; turelele se rotesc spre țintă.
- **Asset-uri noi** (Quaternius, CC0): Ranger = `toon_soldier`, Conscript = `toon_enemy` (Toon Shooter, **animați**: Idle / Run_Gun / Idle_Shoot / Death — siluete diferite, moartea se vede); turele `turret_Gun_5` (SUA) și `turret_Cannon_4` (URSS) din pachetul Turrets. Convertite cu `@gltf-transform` (doar arma AK + 5 animații păstrate) și `obj2gltf`. `toon_hazmat.glb` e pregătit pentru un viitor inginer.
- **Reparat**: copacii/stâncile erau invizibili (șabloanele ascunse erau clonate tot ascunse); stâncile erau de ~4× prea mari față de celula pe care o blochează.
- **Robustețe**: dacă un model lipsește, se folosește o formă low-poly provizorie (jocul nu se mai blochează la încărcare).
- **Scenariu** (`createSkirmishWorld`): SUA pornește doar cu Centrul de Construcție + 2 Liberty + 3 Rangeri + 5000 $; URSS are baza completă (2 turele) și recoltorul la lucru, dar nu construiește nimic (botul vine în S4). `createDemoWorld` (S2) rămâne pentru teste.
- 42 de teste (18 noi: recoltare, epuizare, ordine manuale, cerințe, cost progresiv, plasare validă/invalidă, recoltor gratuit, producție + punct de adunare, anulare, lipsă de bani, energie insuficientă, vânzare, reparare, determinism cu economie).

## Ce s-a făcut în S4 — Demo v0.1
- **Meniu** (`src/ui/menu.ts`): alegi facțiunea (SUA / URSS), dificultatea botului (Ușor / Normal / Greu) și ceața de război (on/off); alegerile se țin minte. Pauză cu **P** sau butonul „☰ Meniu” (Continuă / Reîncepe / Abandonează / Meniul principal). „Joacă din nou” repornește cu aceleași setări (reload + `sessionStorage`).
- **Meci** (`createMatchWorld`): start simetric — Centru de Construcție, 2 tancuri, 3 soldați, 5000 $ fiecare. SUA e mereu la vest, URSS la est; clădirile privesc spre centrul hărții (`Building.facing`, nu mai depinde de proprietar). `createSkirmishWorld` (S3) rămâne pentru teste.
- **Bot** (`src/sim/bot.ts`): folosește doar comenzile jucătorului (determinist, gata de lockstep). Ordine de construcție Centrală → Rafinărie → Barăci → Fabrică, centrale la nevoie, a doua rafinărie, turele treptat (spre inamic, într-un inel în fața bazei), rafinăria lângă minereu, culoare de o celulă între clădiri. Recoltoare 1–2/rafinărie, rezervă de bani pentru clădirea în lucru. Armata se adună în fața bazei; valuri de atac (attack-move) la intervale fixe, din ce în ce mai mari, spre cea mai apropiată clădire inamică (preferă Rafinăria / Fabrica / Centrul); se apără când inamicul intră în bază; repară clădirile avariate.
  - Ușor: primul val la ~5:30, grupuri de 4, venit ×0,75. Normal: ~3:50, grupuri de 6. Greu: ~2:50, grupuri de 8+, 4 turele, venit ×1,3 (ca în RA2, botul greu are avantaj economic — `PlayerEco.incomeMul`). Testat bot-contra-bot: Greu > Normal > Ușor.
  - Botul vede tot (nu folosește ceața), ca boții RA2.
- **Attack-move** (comanda `amove`, `Unit.amove`): unitățile atacă tot ce întâlnesc în raza de vedere, apoi își continuă drumul. Jucătorul: **Ctrl + click dreapta** sau **F** apoi click. Marker portocaliu.
- **Ceață de război** (`src/sim/vision.ts` + `src/render/fog.ts`): per celulă neexplorat / ceață / vizibil, din `sight` (clădirile: jumătatea amprentei + 8 m). Nu intră în simulare/hash. Randare: un **plugin de material** injectat în toate materialele (Standard + PBR) înmulțește culoarea cu o textură de ceață (2 texeli/celulă, blur, tranziții line) → teren, copaci, clădiri și efecte se întunecă la fel. Unitățile inamice din ceață sunt ascunse; clădirile inamice văzute rămân pe hartă („fantome”, ca în RA2). Minimap-ul și țintirea (`pickEnemy`) respectă ceața.
- **Victorie / înfrângere**: pierzi când nu mai ai nicio clădire și nicio unitate de luptă (recoltoarele nu contează); abandonul = înfrângere. Ecran de final cu statistici (unități produse / pierdute / distruse, clădiri, credite recoltate, durata).
- **Notificări noi**: „Baza este atacată!” / „Recoltorul este atacat!” (cu ping pe minimap, max. o dată la 15 s), „Inamicul a fost învins!”.
- **Deploy**: build-ul e publicat pe GitHub Pages (ramura `gh-pages`, build cu `--base=/conqueralert/`) → https://flowreanu.github.io/conqueralert/ . `vercel.json` rămâne valabil dacă vrei Vercel (importă repo-ul în Vercel; fiecare push pe `main` = deploy automat).
- 57 de teste (15 noi: start simetric + inversarea facțiunilor, ordinea de construcție a botului, culoare între clădiri, valuri de atac, botul învinge un jucător pasiv, Greu bate Ușor, apărarea bazei, determinism cu 2 boți, attack-move vs. mișcare simplă, ceață inițială / explorat / fantome / dezactivată, abandon, recoltoarele nu țin în viață). Verificat și în Chromium headless: meniu, ceață (shader compilat fără erori), pauză, ecran de final.

## S4.1 — echilibrare (după primul test al lui Andrei)
Feedback: pe Ușor botul producea foarte mult și foarte repede; după ce a urmărit un tanc, armata lui Andrei a fost distrusă; URSS părea mult prea puternic.
- **Diagnostic** (simulări la cost egal + meciuri bot-contra-bot):
  - Conscriptul era de ~2× mai eficient decât Rangerul (18 Conscripți la 1800 $ îi băteau clar pe 9 Rangeri la 1800 $). Botul producea mai ales Conscripți → pe Ușor avea **55 de unități la minutul 6**.
  - Tancurile erau aproape echilibrate; Katiușa era prea ieftină în armatele mixte.
  - Unitățile care ripostau (sau din attack-move) urmăreau ținta **la nesfârșit** → intrau după ea în baza inamică, între turele și armata botului.
  - Harta favoriza baza de **vest**, indiferent de facțiune (SUA vs SUA: vestul câștiga 14 din 15); o cauză: al doilea câmp de minereu al estului avea ~6100 de credite față de ~11000 la vest.
- **Schimbări:**
  - Ranger 200 → **150 $**; Conscript 100 → **110 $**, viață 90 → **80**, damage 12 → **11**; Ursus 900 → **850 $**; Katiușa 800 → **900 $**, rachete 28 → **24**. La cost egal: infanteria ~egal, armatele mixte ~egal.
  - **Leash** (`Unit.leash`): riposta și attack-move-ul renunță la țintă dacă s-au depărtat cu mai mult de `sight + 10` m de locul de unde au pornit, iar riposta se întoarce la post. Ordinul explicit de atac (click dreapta pe inamic) urmărește în continuare oriunde.
  - Botul: **plafon de armată** (Ușor 12, Normal 24, Greu 45) și ritm de producție (Ușor pune ceva în coadă doar în 35% din „gânduri”, Normal 70%); venit Ușor ×0,6, Normal ×0,9, Greu ×1,25; primul val: Ușor ~7:00 (doar 4 unități pleacă, restul stau acasă), Normal ~4:30, Greu ~3:00.
  - Câmpul de minereu de sud-est (63,12) mărit (r 3,5 → 4,7) → ~10900 credite, cât cel din nord-vest. Acum SUA vs SUA (bot vs bot): vest 8 – est 5, 3 egaluri.
- 60 de teste (3 noi: infanteria la cost egal, plafonul botului Ușor, riposta care se întoarce la post).
- Rămas: harta nu e perfect simetrică (podurile la rândurile 40 și 74, bazele la 50 și 46). Pentru meciuri complet corecte ar trebui o hartă în oglindă / rotită la 180°.

## Note pentru sesiunea următoare (S5 — Japonia)
- Facțiunea nouă: adaugă intrările în `units.json` / `buildings.json` (modelele per facțiune), `START_ARMY` din `scenario.ts`, `FACTION_INFO` din `menu.ts`; botul alege singur unitățile după `role` (`infantry` / `tank` / `support` / `economy`).
- Harta are doar 2 baze (vest/est) → pentru SUA vs Japonia sau URSS vs Japonia, `createMatchWorld` trebuie să atribuie bazele după index, nu după facțiune.
- Pentru redeploy pe Pages: `npm run build -- --base=/conqueralert/` și push al `dist/` pe `gh-pages` (vezi README).
- Idei rămase: MCV (Centrul de Construcție mobil), clădiri care „clipesc” la energie insuficientă, sunet (S7), botul ar putea folosi și el ceața.

## Asset-uri Google Drive (folderul `Game_Assets`, id `1P1ejCJeLKS07emjhAMhW3KSCczENVXzu`)
- ✅ `…124331Z…` (Tank Pack) și `…124642Z…` (Car Pack) — integrate în S2.
- ✅ Turrets și Toon Shooter — urcate de Andrei în `assets_src/`, integrate în S3.
- `Sci-Fi Essentials Kit[Standard].zip` (167 MB) — pentru Japonia (S5); aceeași problemă de mărime.

## Probleme cunoscute / provizorii
- Katiușa (`artillery1`) e un tun vechi cu roți — provizoriu.
- Recoltorul e acum un SUV (`q_SUV`) — măcar e vehicul de sol, dar nu arată a utilaj minier; de înlocuit când găsim un camion.
- Ambele facțiuni au aceleași modele pentru Centrală / Rafinărie / Barăci / Centrul de Construcție (diferă fundația colorată).
- Recoltorul descarcă oriunde lângă docul rafinăriei (nu „intră” în clădire).
- Liberty și Ursus vin din același pachet → silueta e asemănătoare; diferă prin mărime (5,5 vs 6,5 m) și culoare.

## Feedback de la Andrei
- Unitățile păreau disproporționate în randări → s-a aplicat tabelul de scară din SPEC.md (S1).
- Test S1: unele unități mergeau cu spatele → reparat după S1 (infanterie `yaw` 90, recoltor `yaw` 180; tancurile, Sentinel și Katiușa erau corecte).
- Test S1: unitățile se suprapun / se lipesc în mers, fără „hitbox” → rezolvat în S2 (separare cerc-cerc).
- Test S1: doar unitățile albastre sunt controlabile → intenționat (URSS e botul). Din S2: click dreapta pe o unitate roșie = atac. Din S4 poți alege și URSS din meniu.
