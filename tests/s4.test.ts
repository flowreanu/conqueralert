import { describe, expect, it } from "vitest";
import { createMatchWorld, createSkirmishWorld } from "../src/sim/scenario";
import { Bot } from "../src/sim/bot";
import { Vision, Vis } from "../src/sim/vision";
import { TICK_RATE, World } from "../src/sim/world";

const run = (w: World, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE) && w.winner < 0; i++) w.step(); };
const blds = (w: World, p: number, type?: string) => [...w.buildings.values()].filter((b) => b.owner === p && (!type || b.type === type));
const units = (w: World, p: number) => [...w.units.values()].filter((u) => u.owner === p);

describe("S4 — meciul skirmish", () => {
  it("ambii jucători pornesc la fel, iar facțiunile se pot inversa", () => {
    for (const faction of ["usa", "ussr"] as const) {
      const w = createMatchWorld({ faction, difficulty: "normal" });
      expect(w.players[0].faction).toBe(faction);
      expect(w.players[1].faction).toBe(faction === "usa" ? "ussr" : "usa");
      for (const p of [0, 1]) {
        expect(blds(w, p).map((b) => b.type)).toEqual(["conyard"]);
        expect(units(w, p)).toHaveLength(5);
        expect(w.eco[p].credits).toBe(5000);
      }
      // clădirile privesc spre centrul hărții, indiferent de proprietar
      const west = blds(w, 0).concat(blds(w, 1)).find((b) => b.x < 96)!;
      expect(west.facing).toBe(0);
    }
  });
});

describe("S4 — bot", () => {
  it("își construiește baza în ordinea corectă și produce armată", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    w.controllers.push(new Bot(1, "normal"));
    run(w, 150);
    const types = blds(w, 1).map((b) => b.type);
    for (const t of ["power", "refinery", "barracks", "factory"]) expect(types).toContain(t);
    expect(units(w, 1).filter((u) => u.harv).length).toBeGreaterThanOrEqual(1);
    expect(units(w, 1).length).toBeGreaterThan(8);
    expect(w.eco[1].powerOut).toBeGreaterThanOrEqual(w.eco[1].powerUse);
  });

  it("plasează clădirile lăsând culoare între ele", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "hard" });
    w.controllers.push(new Bot(1, "hard"));
    run(w, 200);
    const bs = blds(w, 1);
    for (const a of bs)
      for (const b of bs) {
        if (a === b) continue;
        const gx = Math.max(b.cx - (a.cx + a.cells), a.cx - (b.cx + b.cells));
        const gy = Math.max(b.cy - (a.cy + a.cells), a.cy - (b.cy + b.cells));
        expect(Math.max(gx, gy)).toBeGreaterThanOrEqual(1);
      }
  });

  it("trimite valuri de atac (attack-move) spre baza inamică", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "hard" });
    const bot = new Bot(1, "hard");
    w.controllers.push(bot);
    run(w, 260);
    expect(bot.waves).toBeGreaterThanOrEqual(1);
    // jucătorul 0 (fără nimeni la comenzi) a fost atacat
    expect(w.stats[1].unitsKilled + w.stats[1].buildingsKilled).toBeGreaterThan(0);
  });

  it("un bot învinge un jucător pasiv → victorie / înfrângere", () => {
    const w = createMatchWorld({ faction: "ussr", difficulty: "hard" });
    w.controllers.push(new Bot(1, "hard"));
    run(w, 900);
    expect(w.winner).toBe(1);
    expect(w.defeated[0]).toBe(true);
    expect(w.stats[1].buildingsKilled).toBeGreaterThanOrEqual(1);
  }, 60000);

  it("Greu bate Ușor", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    w.controllers.push(new Bot(0, "easy"), new Bot(1, "hard"));
    run(w, 1200);
    expect(w.winner).toBe(1);
  }, 60000);

  it("botul se apără când e atacat în bază", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    w.controllers.push(new Bot(1, "normal"));
    run(w, 60);
    const ussr = blds(w, 1, "conyard")[0];
    const raid = units(w, 0).filter((u) => !u.harv).map((u) => u.id);
    w.issue({ kind: "amove", player: 0, unitIds: raid, x: ussr.x - 12, z: ussr.z });
    run(w, 40);
    expect(w.stats[1].unitsKilled).toBeGreaterThan(0);
  });

  it("e determinist (aceeași sămânță → aceeași stare)", () => {
    const sim = () => {
      const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
      w.controllers.push(new Bot(0, "normal"), new Bot(1, "hard"));
      run(w, 180);
      return w.stateHash();
    };
    expect(sim()).toBe(sim());
  });
});

describe("S4 — attack-move", () => {
  it("unitățile atacă inamicii întâlniți pe drum și apoi își continuă drumul", () => {
    const w = createSkirmishWorld();
    const tanks = units(w, 0).filter((u) => u.type === "liberty");
    const enemy = w.spawnUnit("conscript", 1, tanks[0].x + 30, tanks[0].z, Math.PI);
    w.issue({ kind: "amove", player: 0, unitIds: tanks.map((u) => u.id), x: tanks[0].x + 60, z: tanks[0].z });
    run(w, 3);
    expect(tanks.some((t) => t.attackId === enemy.id)).toBe(true);
    run(w, 12);
    expect(w.units.has(enemy.id)).toBe(false);
    expect(tanks.some((t) => t.amove || t.x > enemy.x)).toBe(true);
  });

  it("mișcarea simplă nu se oprește pentru inamici", () => {
    const w = createSkirmishWorld();
    const t = units(w, 0).find((u) => u.type === "liberty")!;
    w.spawnUnit("conscript", 1, t.x + 26, t.z + 6, Math.PI);
    w.issue({ kind: "move", player: 0, unitIds: [t.id], x: t.x + 50, z: t.z });
    run(w, 3);
    expect(t.attackId).toBe(0);
    expect(t.amove).toBeNull();
  });
});

describe("S4 — ceață de război", () => {
  it("la început se vede doar zona bazei; harta e neexplorată", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    const v = new Vision(w, 0);
    v.update();
    const enemyCy = blds(w, 1)[0];
    expect(v.isVisible(blds(w, 0)[0].x, blds(w, 0)[0].z)).toBe(true);
    expect(v.isVisible(enemyCy.x, enemyCy.z)).toBe(false);
    expect(v.buildingVisible(enemyCy)).toBe(false);
    const vis = [...v.state].filter((s) => s === Vis.Visible).length;
    expect(vis).toBeGreaterThan(100);
    expect(vis).toBeLessThan(v.state.length * 0.25);
  });

  it("zonele părăsite rămân explorate (ceață), clădirile văzute rămân pe hartă", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    const v = new Vision(w, 0);
    const enemy = blds(w, 1)[0];
    const scout = units(w, 0).find((u) => u.type === "liberty")!;
    scout.x = enemy.x - 14; scout.z = enemy.z;
    v.update();
    expect(v.buildingVisible(enemy)).toBe(true);
    expect(v.unitVisible(units(w, 1)[0])).toBe(true);
    scout.x = 60; scout.z = 100;
    v.update();
    const [cx, cy] = [Math.floor(enemy.x / 2), Math.floor(enemy.z / 2)];
    expect(v.cell(cx, cy)).toBe(Vis.Fogged);
    expect(v.buildingVisible(enemy)).toBe(true); // „fantoma” rămâne
    expect(v.unitVisible(units(w, 1)[0])).toBe(false); // unitățile din ceață nu
  });

  it("fără ceață (opțiune din meniu) se vede tot", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    const v = new Vision(w, 0, false);
    v.update();
    expect(v.buildingVisible(blds(w, 1)[0])).toBe(true);
    expect(v.unitVisible(units(w, 1)[0])).toBe(true);
  });
});

describe("S4 — victorie", () => {
  it("abandonul îl elimină pe jucător", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    w.surrender(0);
    expect(w.winner).toBe(1);
  });

  it("recoltoarele singure nu țin jucătorul în viață", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    for (const b of blds(w, 0)) w.removeBuilding(b);
    for (const u of units(w, 0)) w.units.delete(u.id);
    w.spawnUnit("harvUsa", 0, 40, 100);
    run(w, 2);
    expect(w.defeated[0]).toBe(true);
    expect(w.winner).toBe(1);
  });
});

describe("S4.1 — echilibrare", () => {
  const duel = (a: [string, number][], b: [string, number][]) => {
    const w = createSkirmishWorld();
    for (const u of [...w.units.values()]) w.units.delete(u.id);
    const place = (list: [string, number][], p: number, x0: number) => { let i = 0; for (const [t, n] of list) for (let k = 0; k < n; k++, i++) w.spawnUnit(t, p, x0 + Math.floor(i / 7) * 2.5 * (p ? 1 : -1), 80 + (i % 7) * 3, p ? Math.PI : 0); };
    place(a, 0, 22); place(b, 1, 60);
    const ids = (p: number) => units(w, p).map((u) => u.id);
    w.issue({ kind: "amove", player: 0, unitIds: ids(0), x: 75, z: 88 });
    w.issue({ kind: "amove", player: 1, unitIds: ids(1), x: 8, z: 88 });
    for (let i = 0; i < 120 * TICK_RATE && ids(0).length && ids(1).length; i++) w.step();
    return { usa: units(w, 0).length, ussr: units(w, 1).length };
  };

  it("infanteria la cost egal nu mai e câștigată la scor de URSS (1800 $ vs 1800 $)", () => {
    const r = duel([["ranger", 12]], [["conscript", 16]]); // 12×150 vs 16×110 ≈ 1800 $
    // fie câștigă Rangerii, fie Conscripții rămân cu foarte puțini
    expect(r.ussr).toBeLessThanOrEqual(4);
  });

  it("botul Ușor nu depășește plafonul armatei și produce rar", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "easy" });
    w.controllers.push(new Bot(1, "easy"));
    run(w, 360);
    const army = units(w, 1).filter((u) => !u.harv).length;
    expect(army).toBeLessThanOrEqual(13);
  });

  it("riposta nu urmărește un inamic care fuge la nesfârșit — unitatea se întoarce la post", () => {
    const w = createSkirmishWorld();
    const t = units(w, 1).find((u) => u.type === "ursus")!;
    const home = { x: t.x, z: t.z };
    const bait = w.spawnUnit("liberty", 0, t.x - 20, t.z, 0);
    run(w, 1.5); // Ursus îl atacă pe Liberty (sau ripostează)
    // momeala fuge departe, spre vest
    w.issue({ kind: "move", player: 0, unitIds: [bait.id], x: 20, z: bait.z });
    t.lastAttacker = bait.id; t.attackId = bait.id; t.attackOrdered = true; t.leash = { x: home.x, z: home.z };
    run(w, 25);
    expect(Math.hypot(t.x - home.x, t.z - home.z)).toBeLessThan(UNIT_DEFS_SIGHT(t.type) + 16);
    expect(t.attackId === bait.id && Math.hypot(t.x - home.x, t.z - home.z) > 40).toBe(false);
  });
});
import { UNIT_DEFS } from "../src/sim/world";
const UNIT_DEFS_SIGHT = (t: string) => UNIT_DEFS[t].sight;
