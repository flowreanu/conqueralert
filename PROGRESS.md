# ConquerAlert — PROGRESS

## Stare curentă
- [x] S0: concept, vizualizări, alegerea stack-ului (Babylon.js), asset-uri CC0 descărcate și convertite în `.glb` în `public/models/`
- [ ] S1: setup + cameră + selecție + mișcare
- [ ] S2: pathfinding + luptă
- [ ] S3: economie + construcție + producție + sidebar
- [ ] S4: bot + ceață + victorie + meniu + deploy → **Demo v0.1**

## Note pentru sesiunea următoare (S1)
- Modelele sunt în `public/models/{units,buildings,nature}`.
- Recolorarea pe facțiune se face la runtime după numele materialului:
  - modelele Cimpletoon (armor, mechinf, howitzer, artillery1, helicopter02, fighter, bomber01, marines01, spy1, destroyer1) au materiale albe, cu nume ca `body`, `wheels`, `metal barrel`, `glass`, `skin`. Se vopsesc: `body` = culoarea principală, `wheels/metal/barrel` = culoarea închisă, `glass/window` = albastru deschis, `skin` = piele;
  - modelele Kenney space-kit au materialul `metalRed` (portocaliu), care devine culoarea facțiunii;
  - modelele Kenney city-kit folosesc textura `Textures/colormap.png` și rămân cu culorile originale;
  - `.obj` (Tank3, AntiAirTank2) se înlocuiesc complet cu materialul facțiunii (au texturi lipsă).
- Axele modelelor diferă. Se normalizează automat (axa lungă pe X, centrat, baza la y=0), apoi se aplică o corecție `yaw` per model în `src/data/models.json`.
- Mapare propusă pentru demo:
  - Tanc Liberty → `units/armor.glb`
  - Tanc Ursus → `units/Tank3.obj` (provizoriu)
  - Sentinel → `units/howitzer.glb`
  - Katiușa → `units/artillery1.glb` (provizoriu)
  - Ranger / Conscript → `units/marines01.glb`
  - Recoltor → `units/craft_miner.glb`
  - Centru de Construcție → `buildings/hangar_largeA.glb`
  - Centrală → `buildings/machine_generatorLarge.glb`
  - Rafinărie → `buildings/detail-tank-large.glb` + `buildings/building-c.glb`
  - Barăci → `buildings/building-k.glb`
  - Fabrică → `buildings/building-a.glb` (SUA) / `buildings/building-f.glb` (URSS)
  - Turelă → `buildings/turret_double.glb`

## Feedback de la Andrei
- Unitățile păreau disproporționate în randări → se aplică tabelul de scară din SPEC.md.
