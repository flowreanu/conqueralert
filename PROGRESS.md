# ConquerAlert — PROGRESS

## Stare curentă
- [x] S0: concept, vizualizări, alegerea stack-ului (Babylon.js), asset-uri CC0 descărcate și convertite în `.glb` în `public/models/`
- [x] S1: setup + cameră + selecție + mișcare
- [x] S2: pathfinding + separare + luptă
- [x] S3: economie + construcție + producție + sidebar
- [x] S4: bot + ceață + victorie + meniu + deploy → **Demo v0.1**
- [x] S4.1: echilibrare (infanterie, bot Ușor, urmărire, minereu)
- [x] S4.2: aspect vizual — drumuri, orășele, texturi de teren, V3, recoltor nou
- [x] UI: sidebar nou, pictograme 3D, steaguri, sunet și muzică
- [x] S5: unități noi, case ocupabile, ingineri + puțuri de petrol, ranguri, hartă în oglindă, auto-deploy
- [ ] S6: multiplayer cu prietenii (WebRTC, link de invitație, lockstep)
- [ ] S7: facțiunea Japonia

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

## S4.2 — aspect vizual (hartă, texturi, V3, recoltor)
Andrei a urcat în `assets_src/` patru kituri Kenney (Car Kit, City Kit Roads / Suburban / Commercial) și cinci texturi ambientCG.
- **Harta** (`src/map/decor.ts`): două șosele est–vest care trec peste cele două poduri, câte un drum nord–sud pe fiecare mal și intrări spre baze; plăci Kenney de 6 m (întinse ca să se potrivească exact între intersecții), felinare. Patru **orășele** la intersecțiile de pe maluri: clădiri comerciale lângă piață (pavaj), case cu garduri mai departe, mașini pe alei, copaci în curți. Casele și mașinile blochează celulele (ca un copac); drumurile sunt doar vizuale. Fără clădiri civile lângă baze (20 de celule), poduri și minereu. `GameMap.roads` / `GameMap.plazas` noi; `Prop.sx` = întindere pe X.
- **Teren** (`src/render/terrainSplat.ts`): plugin de material care amestecă texturile în shader. Iarba (Ground068) e doar *detaliu* peste culorile stilizate (păstrează aspectul low-poly, la două scări ca să nu se vadă repetiția); peste ea, după o hartă de ponderi pe celule: pietriș în baze / pe acostamente / lângă minereu, pietre pe maluri și în albie, sol de pădure sub copaci, pavaj în piețe.
- **Katiușa → Lansator V3**: camion Kenney (`truck-flat`) în culoarea facțiunii + rachetă modelată în cod (corp, vârf roșu, aripioare, rampă). Racheta apare când e reîncărcată, se ridică la ~45° când are țintă și dispare la lansare; zboară în arc înalt, cu dâră de fum. Arma `v3`: 105 damage (rocket), explozie 3,5 m, rază 8–40 m, 7 s reîncărcare (în loc de 4 rachete × 24).
- **Recoltor**: încărcător frontal Kenney (`tractor-shovel`) în culorile facțiunii, în locul SUV-ului.
- **Modele Kenney**: `scripts/prepare-kenney.mjs` copiază ce folosim în `public/models/{roads,suburban,commercial,cars}/` (cu `Textures/colormap.png` — modelele citesc paleta din fișier extern) și recolorează căsuțele paletei (grilă 16×4 de degradeuri) pentru vehiculele de facțiune și pentru cele 3 variante de culoare ale caselor (`suburban1..3`, `commercial1..3`). `models.json`: câmp nou `unitScale` (metri per unitate Kenney: drumuri 6, case 5, comerciale 7, mașini 1,55).
- Testele de mișcare / luptă caută acum teren liber (pe hartă sunt și orășele); 60 de teste trec. Meciuri bot contra bot după schimbări: Greu bate Ușor, oglinzile ~egale.
- Idei pentru mai departe: clădiri civile distructibile / ocupabile de infanterie (ca în RA2), mașini civile care se pot strivi, poduri distructibile.

## UI + sunet (după S4.2)
Andrei a trimis o schiță de UI (panouri metalice, credite aurii, radar, pictograme 3D izometrice). Am păstrat stilul, dar cu layout-ul compact din RA2: o singură coloană îngustă (276 px), grilă de 2 coloane, un singur indicator de progres.
- **Sidebar** (`src/ui/sidebar.ts`, `src/style.css`): rame teșite (`clip-path`), accente cyan / auriu, font condensat; antet cu logo + **steagul facțiunii** + buton de sunet; credite mari aurii + bara de energie „segmentată”; **radar** = minimap-ul real cu grilă, cercuri, rază care se rotește și colțuri cyan; taburi cu tabul activ în culoarea facțiunii; „cameo”-uri pe o placă de tip hologramă.
- **Pictograme 3D** (`src/render/icons.ts`): la începutul meciului, fiecare clădire / unitate a facțiunii e randată într-o scenă separată (același Engine, cameră ortografică izometrică, fundal transparent, `CreateScreenshotUsingRenderTargetAsync`) și înlocuiește desenul SVG. Pluginul de ceață se aplică acum doar în scena jocului (`FogPlugin.active`).
- **Steaguri** (`src/ui/flags.ts`, SVG): SUA și URSS, în sidebar, pe cardurile din meniu și pe ecranul de final.
- **Meniu / pauză / final** în aceeași temă; glisoare de volum (muzică / efecte) în meniu și în pauză; **M** = sunet pornit/oprit. Setările se țin minte (`localStorage`, `ca-audio`).
- **Sunet** (`src/audio/`), totul sintetizat cu WebAudio (fără fișiere, fără licențe):
  - `audio.ts` — motorul: magistrale muzică / efecte, compresor, reverb generat, efecte cu limită de repetare (nu „explodează” la 30 de puști). Efecte: 2 tipuri de pușcă, tunuri, turelă, obuzier, lansare V3, explozii mici / mari / clădire, moarte infanterie, confirmări de ordin, click-uri, „construcție gata”, „unitate pregătită”, alarmă la atac, vânzare, plasare, eroare, fanfară de victorie / înfrângere.
  - `gameSounds.ts` — efectele bătăliei poziționate față de centrul camerei (volum după distanță, stânga/dreapta), mai încet în ceață.
  - `music.ts` — un „band” sintetizat (tobe, chitară distorsionată, bas, alămuri, cor) și două piese originale: **SUA „Freedom Drive”** (rock, 132 BPM, Re minor, 28 de măsuri: intro / A / A' cu alămuri / B / break) și **URSS „Steel March”** (marș industrial, 112 BPM, Do minor, toba mare pe fiecare timp, „nicovală”, cor, corn; 30 de măsuri). În meniu se aude piesa facțiunii selectate.
  - Muzică proprie: dacă pui `public/audio/music_usa.mp3` / `music_ussr.mp3`, se folosesc fișierele (vezi `public/audio/README.md`).
- Verificat în Chromium headless: meniu, joc, pauză, pictograme (toate 7 generate), contextul audio pornește după primul click și muzica are semnal. 60 de teste trec.

## Ce s-a făcut în S5 — conținut + strategie
- **Hartă în oglindă** (`src/map/gameMap.ts`, `decor.ts`): se generează jumătatea de sud (rândurile 0–47) și se copiază rotită la 180° (`mirrorIndex`). Râul are meandre impare față de mijloc, deci continuă lin; delta se desparte la ambele capete (rândul 15 și 80). Podurile: rândurile 24–26 și 69–71 (destul de departe de baze ca să încapă orășelele). Bazele: (14,50) ↔ (82,46) = colțurile Centrului de Construcție, exact rotite. Câmpurile de minereu, copacii, casele, gardurile, mașinile sunt perechi; startul meciului (unitățile) e rotit și el. Test: 0 celule diferite între cele două jumătăți. (Doar felinarele nu sunt în oglindă — pur decorative.)
- **Unități noi** (câte 3 pe facțiune, modele CC0 deja în repo):
  - infanterie antitanc: **Bazooka** (SUA) / **Soldat RPG** (URSS), 300 $, rachete `at` (0,9 vs tancuri, 0,6 vs vehicule ușoare, 0,2 vs infanterie, rază 17 / 16 m). La cost egal bat tancurile, dar pierd contra infanteriei obișnuite și a cercetașilor. Modele: Toon Shooter cu `RocketLauncher` (`scripts/prepare-toon.mjs`).
  - cercetași: **Humvee** (SUA, Kenney `suv`, 12 m/s, vedere 32 m) / **BRDM** (URSS, Kenney `truck`, 11 m/s, vedere 30 m), 500 / 550 $, mitralieră grea pe acoperiș (modelată în cod, `rig: "mg"`), buni contra infanteriei. Recolorați în `scripts/prepare-kenney.mjs`.
  - **Inginer** (500 $, Toon Shooter Hazmat cu pistol, neînarmat): click dreapta pe o clădire inamică = o capturează (inginerul dispare), pe o clădire proprie avariată = o repară complet, pe un **puț de petrol** = îl capturează.
- **Puțuri de petrol** (2, simetrice, câte unul lângă fiecare bază): clădiri civile capturabile, +12 $/s pentru proprietar; model low-poly făcut în cod (turlă, balansier care se mișcă, rezervor).
- **Infanteria în case** (ca în RA2): casele și magazinele din orășele (26, adică 13 perechi) nu mai sunt decor, ci clădiri neutre (`owner = NEUTRAL = -1`, `civHouse` 700 HP / `civShop` 1000 HP) cu amprentă dreptunghiulară (`Building.cw/ch`).
  - Click dreapta pe casă cu infanterie selectată = intră (max. 5; cursor verde); casa devine a jucătorului; soldații trag pe ferestre, fiecare cu arma lui, cu **+6 m rază**; gloanțele aproape nu zgârie casa (0,15), artileria / rachetele / V3 o distrug → soldații ies vii (ca în RA2).
  - Buton „Ieșiți din clădire” în panoul casei selectate; inamicul nu poate intra într-o casă ocupată (trebuie s-o distrugă). Casele libere nu sunt atacate automat; **Ctrl + click dreapta** = atac forțat.
  - Indicator cu 5 „ferestre” deasupra casei (ocupate în culoarea facțiunii; ascuns pentru inamicii din ceață). Pe minimap casele ocupate au culoarea proprietarului.
  - Casele și puțurile nu țin un jucător „în viață” (doar soldații dinăuntru contează).
- **Ranguri** (`world.ts`: `RANK_XP`, `RANK_DAMAGE`, `RANK_COOLDOWN`, `RANK_HP`, `ELITE_REGEN`): experiența = costul a ce distruge unitatea (casa ocupată = 400); ranguri la 2× / 4× / 7× / 11× costul propriu (ca `VeteranRatio` din RA2, ca să nu „explodeze” unitățile ieftine). Bonusuri: damage ×1,1 / 1,2 / 1,3 / 1,5, reîncărcare ×0,92 / 0,85 / 0,78 / 0,7, viață ×1,1 / 1,2 / 1,3 / 1,5; elita (steluța) se repară singură (1,5%/s). Soldații din case primesc și ei experiență. Insignă aurie (1–3 săgeți / steluță) lângă bara de viață, vizibilă mereu; în panoul de selecție: rangul și câți $ mai trebuie distruși până la următorul. Notificare + sunet la promovare.
- **Botul**: amestecă infanterie antitanc (mai multă când inamicul are multe vehicule) și cercetași; pe Normal / Greu trimite un inginer la cel mai apropiat puț care nu e al lui și ține 1 / 2 case ocupate în fața bazei; casele ocupate de inamic lângă bază declanșează apărarea; nu mai încearcă să repare / vândă clădiri civile.
- **UI / sunet**: cursoare noi (intră / capturează), panouri pentru casa ocupată, puț și unitățile selectate (rang), notificări „capturat” / „capturat de inamic” / „reparat” / „promovat”, pictograme SVG pentru rolurile noi (pictogramele 3D se generează automat), sunete sintetizate noi: bazooka/RPG, mitralieră, capturare, promovare, ușa casei. Textul de ajutor și meniul actualizate.
- **Auto-deploy**: `.github/workflows/deploy.yml` — la fiecare push pe `main`: `npm ci` → `npm test` → build cu `--base=/conqueralert/` → publică `dist/` pe `gh-pages` (`peaceiris/actions-gh-pages`, același branch ca până acum; nu trebuie schimbat nimic în setările Pages).
- 79 de teste (19 noi în `tests/s5.test.ts`: simetria hărții și a startului, case neutre neatacate, intrare + rază mai mare + ieșire la distrugere, capacitate 5 / inamicul nu intră / „ieșiți”, vehiculele nu intră, capturare, reparare, venitul puțului, puțurile nu țin jucătorul în viață, praguri de rang, experiența din ucideri, damage-ul veteranilor + regenerarea elitei, experiența soldaților din case, contrele antitanc ↔ tancuri ↔ infanterie / cercetași, viteza / vederea cercetașilor, botul Normal capturează un puț + ocupă o casă și rămâne determinist). Testele de luptă / duel rulează acum pe teren curățat (nu mai depind de decor). Verificat în Chrome headless: case, indicatorul de ocupare, insignele, Humvee / BRDM, capturarea (fundația își schimbă culoarea), puțul.

## Note pentru S7 (Japonia)
- Japonia mai are nevoie de: steag în `flags.ts` (există deja un placeholder), o piesă în `SONGS` (`music.ts`), sunete de armă în `FIRE` (`gameSounds.ts`).
- Facțiunea nouă: adaugă intrările în `units.json` / `buildings.json` (modelele per facțiune), `START_ARMY` din `scenario.ts`, `FACTION_INFO` din `menu.ts`; botul alege singur unitățile după `role` (`infantry` / `antitank` / `engineer` / `tank` / `scout` / `support` / `economy`). Infanteria care intră în case are `"garrison": true`, inginerul `"engineer": true`.
- Harta are doar 2 baze (vest/est) → pentru SUA vs Japonia sau URSS vs Japonia, `createMatchWorld` trebuie să atribuie bazele după index, nu după facțiune.
- Deploy: automat la push pe `main` (GitHub Action); manual: `npm run build -- --base=/conqueralert/` și push al `dist/` pe `gh-pages`.
- Idei rămase: MCV (Centrul de Construcție mobil), clădiri care „clipesc” la energie insuficientă, botul ar putea folosi și el ceața, mașini civile care se pot strivi, poduri distructibile, alte clădiri „tech” capturabile (spital, aeroport).
- Multiplayer (S6): comenzile noi `enter` / `evacuate` trec prin `issue()` ca toate celelalte; `stateHash()` include acum rangul, experiența, proprietarul clădirilor și ocupanții.

## Asset-uri Google Drive (folderul `Game_Assets`, id `1P1ejCJeLKS07emjhAMhW3KSCczENVXzu`)
- ✅ `…124331Z…` (Tank Pack) și `…124642Z…` (Car Pack) — integrate în S2.
- ✅ Turrets și Toon Shooter — urcate de Andrei în `assets_src/`, integrate în S3.
- `Sci-Fi Essentials Kit[Standard].zip` (167 MB) — pentru Japonia (S5); aceeași problemă de mărime.

## Probleme cunoscute / provizorii
- Ambele facțiuni au aceleași modele pentru Centrală / Rafinărie / Barăci / Centrul de Construcție (diferă fundația colorată).
- Recoltorul descarcă oriunde lângă docul rafinăriei (nu „intră” în clădire).
- Liberty și Ursus vin din același pachet → silueta e asemănătoare; diferă prin mărime (5,5 vs 6,5 m) și culoare.
- Inginerul ține în mână un pistol (din pachetul Toon Shooter), deși nu trage.
- Puțul de petrol capturat nu are bordură în culoarea proprietarului (se vede doar pe minimap / în panou).

## Feedback de la Andrei
- Unitățile păreau disproporționate în randări → s-a aplicat tabelul de scară din SPEC.md (S1).
- Test S1: unele unități mergeau cu spatele → reparat după S1 (infanterie `yaw` 90, recoltor `yaw` 180; tancurile, Sentinel și Katiușa erau corecte).
- Test S1: unitățile se suprapun / se lipesc în mers, fără „hitbox” → rezolvat în S2 (separare cerc-cerc).
- Test S1: doar unitățile albastre sunt controlabile → intenționat (URSS e botul). Din S2: click dreapta pe o unitate roșie = atac. Din S4 poți alege și URSS din meniu.
