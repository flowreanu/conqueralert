import { describe, expect, it } from "vitest";
import { World, TICK_RATE, UNIT_DEFS, BUILDING_DEFS } from "../src/sim/world";
import { createSkirmishWorld } from "../src/sim/scenario";
import { generateDeltaMap, Terrain, idx } from "../src/map/gameMap";
import { availability, buildTime, canPlace, isLowPower, START_CREDITS, findOre } from "../src/sim/economy";

const run = (w: World, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) w.step(); };
const mine = (w: World, p: number, type?: string) => [...w.buildings.values()].filter((b) => b.owner === p && (!type || b.type === type));
const units = (w: World, p: number, type?: string) => [...w.units.values()].filter((u) => u.owner === p && (!type || u.type === type));

/** Construiește + plasează o clădire pentru jucătorul 0, în primul loc valid lângă bază. */
function build(w: World, item: string): boolean {
  w.issue({ kind: "produce", player: 0, item });
  const cat = BUILDING_DEFS[item].category as "structure" | "defense";
  for (let i = 0; i < TICK_RATE * 120 && !w.eco[0].queues[cat][0]?.ready; i++) w.step();
  const { cx, cy } = w.map.bases[0];
  for (let r = 3; r < 14; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (canPlace(w, 0, item, cx + dx, cy + dy)) { w.issue({ kind: "place", player: 0, item, cx: cx + dx, cy: cy + dy }); w.step(); return true; }
      }
  return false;
}

describe("economie — minereu și recoltor", () => {
  it("harta are minereu cu cantitate pe fiecare celulă Ore", () => {
    const m = generateDeltaMap();
    let cells = 0;
    for (let i = 0; i < m.terrain.length; i++) if (m.terrain[i] === Terrain.Ore) { cells++; expect(m.ore[i]).toBeGreaterThanOrEqual(200); }
    expect(cells).toBeGreaterThan(100);
  });

  it("recoltorul URSS aduce credite la rafinărie", () => {
    const w = createSkirmishWorld();
    const c0 = w.eco[1].credits;
    run(w, 45);
    expect(w.eco[1].credits).toBeGreaterThanOrEqual(c0 + 2000);
    expect(w.eco[1].harvested).toBeGreaterThanOrEqual(2000);
  });

  it("minereul scade când e recoltat", () => {
    const w = createSkirmishWorld();
    const total = () => w.map.ore.reduce((s, v) => s + v, 0);
    const t0 = total();
    run(w, 25);
    expect(total()).toBeLessThan(t0 - 300); // recoltat ~1000, crescut înapoi puțin
  });

  it("ordin manual: click pe minereu → recoltează, mișcare simplă → se oprește", () => {
    const w = createSkirmishWorld();
    const h = units(w, 1, "harvUssr")[0];
    w.issue({ kind: "move", player: 1, unitIds: [h.id], x: h.x - 20, z: h.z + 30 });
    w.step();
    expect(h.harv!.auto).toBe(false);
    const f = w.map.oreFields[1];
    const i = findOre(w.map, (f.cx + 0.5) * 2, (f.cy + 0.5) * 2);
    w.issue({ kind: "move", player: 1, unitIds: [h.id], x: ((i % w.map.width) + 0.5) * 2, z: (((i / w.map.width) | 0) + 0.5) * 2 });
    w.step();
    expect(h.harv!.auto).toBe(true);
    run(w, 20);
    expect(h.harv!.load + w.eco[1].harvested).toBeGreaterThan(0);
  });
});

describe("economie — construcție și producție", () => {
  it("SUA începe doar cu Centrul de Construcție și 5000 de credite", () => {
    const w = createSkirmishWorld();
    expect(mine(w, 0).map((b) => b.type)).toEqual(["conyard"]);
    expect(w.eco[0].credits).toBe(START_CREDITS);
  });

  it("cerințe: rafinăria cere centrală, fabrica cere rafinărie + barăci", () => {
    const w = createSkirmishWorld();
    expect(availability(w, 0, "power").ok).toBe(true);
    expect(availability(w, 0, "refinery").missing).toEqual(["power"]);
    expect(availability(w, 0, "factory").ok).toBe(false);
    expect(availability(w, 0, "liberty").ok).toBe(false);
    expect(availability(w, 0, "ursus").ok).toBe(false); // altă facțiune
    w.issue({ kind: "produce", player: 0, item: "refinery" });
    run(w, 1);
    expect(w.eco[0].queues.structure.length).toBe(0);
  });

  it("construcția costă progresiv și durează cost / rată", () => {
    const w = createSkirmishWorld();
    w.issue({ kind: "produce", player: 0, item: "power" });
    run(w, buildTime(600) / 2);
    const q = w.eco[0].queues.structure[0];
    expect(q.progress).toBeGreaterThan(0.45);
    expect(q.progress).toBeLessThan(0.55);
    expect(w.eco[0].credits).toBeCloseTo(START_CREDITS - 600 * q.progress, 0);
    run(w, buildTime(600) / 2 + 0.2);
    expect(q.ready).toBe(true);
    expect(w.eco[0].credits).toBeCloseTo(START_CREDITS - 600, 3);
  });

  it("plasare: respinsă pe apă, departe de bază sau peste unități; acceptată lângă bază", () => {
    const w = createSkirmishWorld();
    w.issue({ kind: "produce", player: 0, item: "power" });
    run(w, buildTime(600) + 0.5);
    const { cx, cy } = w.map.bases[0];
    // departe de bază
    expect(canPlace(w, 0, "power", 60, 80)).toBe(false);
    // peste o unitate proprie
    const r = units(w, 0, "ranger")[0];
    expect(canPlace(w, 0, "power", Math.floor(r.x / 2) - 1, Math.floor(r.z / 2) - 1)).toBe(false);
    // pe apă: celula de râu cea mai apropiată
    let wx = -1;
    for (let x = 30; x < 60 && wx < 0; x++) if (w.map.terrain[idx(w.map, x, cy)] === Terrain.Water) wx = x;
    expect(canPlace(w, 0, "power", wx, cy)).toBe(false);
    // comandă invalidă → nimic
    w.issue({ kind: "place", player: 0, item: "power", cx: 60, cy: 80 });
    w.step();
    expect(mine(w, 0, "power").length).toBe(0);
    expect(build(w, "power")).toBe(true);
    expect(mine(w, 0, "power").length).toBe(1);
    expect(w.eco[0].queues.structure.length).toBe(0);
    expect(cx).toBeGreaterThan(0);
  });

  it("rafinăria vine cu un recoltor gratuit care începe să lucreze", () => {
    const w = createSkirmishWorld();
    w.eco[0].credits = 20000;
    build(w, "power");
    build(w, "refinery");
    const h = units(w, 0, "harvUsa");
    expect(h.length).toBe(1);
    expect(h[0].harv!.auto).toBe(true);
    const c = w.eco[0].credits;
    run(w, 40);
    expect(w.eco[0].credits).toBeGreaterThan(c + 900);
  });

  it("baza completă: barăci + fabrică produc unități care merg la punctul de adunare", () => {
    const w = createSkirmishWorld();
    w.eco[0].credits = 30000;
    for (const b of ["power", "refinery", "barracks", "power", "factory"]) expect(build(w, b)).toBe(true);
    const fac = mine(w, 0, "factory")[0];
    w.issue({ kind: "rally", player: 0, buildingId: fac.id, x: fac.x + 16, z: fac.z });
    const r0 = units(w, 0, "ranger").length, l0 = units(w, 0, "liberty").length;
    w.issue({ kind: "produce", player: 0, item: "ranger" });
    w.issue({ kind: "produce", player: 0, item: "ranger" });
    w.issue({ kind: "produce", player: 0, item: "liberty" });
    w.step();
    expect(w.eco[0].queues.infantry.length).toBe(2);
    run(w, buildTime(700) + 8);
    expect(units(w, 0, "ranger").length).toBe(r0 + 2);
    const tanks = units(w, 0, "liberty");
    expect(tanks.length).toBe(l0 + 1);
    const t = tanks[tanks.length - 1];
    expect(Math.hypot(t.x - (fac.x + 16), t.z - fac.z)).toBeLessThan(3);
  });

  it("anularea returnează banii plătiți", () => {
    const w = createSkirmishWorld();
    w.issue({ kind: "produce", player: 0, item: "power" });
    run(w, 3);
    expect(w.eco[0].credits).toBeLessThan(START_CREDITS);
    w.issue({ kind: "cancel", player: 0, item: "power" });
    w.step();
    expect(w.eco[0].credits).toBeCloseTo(START_CREDITS, 6);
    expect(w.eco[0].queues.structure.length).toBe(0);
  });

  it("fără bani, producția stă în așteptare", () => {
    const w = createSkirmishWorld();
    w.eco[0].credits = 100;
    w.issue({ kind: "produce", player: 0, item: "power" });
    run(w, 20);
    const q = w.eco[0].queues.structure[0];
    expect(q.ready).toBe(false);
    expect(w.eco[0].credits).toBeGreaterThanOrEqual(0);
    expect(q.paid).toBeLessThanOrEqual(100 + 1e-6);
  });
});

describe("economie — energie, vânzare, reparare", () => {
  it("energie insuficientă: producția merge la jumătate și turela nu trage", () => {
    const w = createSkirmishWorld();
    w.eco[0].credits = 30000;
    build(w, "power"); // +100
    build(w, "barracks"); // -20
    build(w, "refinery"); // -40
    expect(isLowPower(w.eco[0])).toBe(false);
    build(w, "turret"); // -30
    build(w, "turret"); // -30 → 120 > 100
    w.step();
    expect(isLowPower(w.eco[0])).toBe(true);
    w.issue({ kind: "produce", player: 0, item: "ranger" });
    run(w, buildTime(200) * 0.5);
    const q = w.eco[0].queues.infantry[0];
    expect(q.progress).toBeGreaterThan(0.2);
    expect(q.progress).toBeLessThan(0.3);
    // turela: un inamic în rază nu primește damage
    const tur = mine(w, 0, "turret")[0];
    for (const u of units(w, 0)) w.units.delete(u.id); // doar turela poate trage
    const e = w.spawnUnit("conscript", 1, tur.x + 10, tur.z, Math.PI);
    run(w, 4);
    expect(e.hp).toBe(e.maxHp);
    // mai multă energie → trage
    build(w, "power");
    run(w, 4);
    expect(w.units.has(e.id) ? e.hp : 0).toBeLessThan(e.maxHp);
  });

  it("vânzarea dă 50% din cost și eliberează celulele", () => {
    const w = createSkirmishWorld();
    build(w, "power");
    const b = mine(w, 0, "power")[0];
    const c = w.eco[0].credits;
    w.issue({ kind: "sell", player: 0, buildingId: b.id });
    w.step();
    expect(w.buildings.has(b.id)).toBe(false);
    expect(w.eco[0].credits).toBeCloseTo(c + 300, 0);
    expect(w.map.blocked[idx(w.map, b.cx, b.cy)]).toBe(0);
  });

  it("repararea reface viața și costă credite", () => {
    const w = createSkirmishWorld();
    const cy = mine(w, 0, "conyard")[0];
    cy.hp = cy.maxHp * 0.5;
    const c = w.eco[0].credits;
    w.issue({ kind: "repair", player: 0, buildingId: cy.id });
    run(w, 40);
    expect(cy.hp).toBe(cy.maxHp);
    expect(cy.repairing).toBe(false);
    expect(c - w.eco[0].credits).toBeCloseTo(BUILDING_DEFS.conyard.cost * 0.5 * 0.5, 0);
  });

  it("nu poți comanda clădirile altui jucător", () => {
    const w = createSkirmishWorld();
    const enemy = mine(w, 1)[0];
    w.issue({ kind: "sell", player: 0, buildingId: enemy.id });
    w.step();
    expect(w.buildings.has(enemy.id)).toBe(true);
  });

  it("determinism: aceleași comenzi → același hash (cu economie)", () => {
    const go = () => {
      const w = createSkirmishWorld();
      w.eco[0].credits = 20000;
      build(w, "power");
      build(w, "refinery");
      build(w, "barracks");
      for (let i = 0; i < 4; i++) w.issue({ kind: "produce", player: 0, item: "ranger" });
      run(w, 30);
      return w.stateHash();
    };
    expect(go()).toBe(go());
  });

  it("datele: fiecare unitate are cost și producător existent", () => {
    for (const [k, u] of Object.entries(UNIT_DEFS)) {
      expect(u.cost, k).toBeGreaterThan(0);
      expect(BUILDING_DEFS[u.producer], k).toBeTruthy();
    }
  });
});
