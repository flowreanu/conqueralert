import { describe, expect, it } from "vitest";
import { generateDeltaMap, isPassableCell, reachable, idx, Terrain, isPassableWorld } from "../src/map/gameMap";
import { World, TICK_RATE, formationSlots } from "../src/sim/world";
import { createDemoWorld } from "../src/sim/scenario";
import { fitScale } from "../src/render/scaleMath";

const run = (w: World, seconds: number) => { for (let i = 0; i < seconds * TICK_RATE; i++) w.step(); };

describe("harta Delta Dunării", () => {
  const m = generateDeltaMap();
  it("are 96×96 celule de 2 m", () => {
    expect(m.width).toBe(96);
    expect(m.height).toBe(96);
    expect(m.cellSize).toBe(2);
  });
  it("e deterministă", () => {
    const b = generateDeltaMap();
    expect(Array.from(b.terrain)).toEqual(Array.from(m.terrain));
    expect(b.props.length).toBe(m.props.length);
  });
  it("are râu și exact 2 poduri", () => {
    expect(m.terrain.filter((t) => t === Terrain.Water).length).toBeGreaterThan(400);
    expect(m.bridges.length).toBe(2);
    for (const br of m.bridges) expect(br.x1 - br.x0).toBeGreaterThanOrEqual(5);
  });
  it("bazele sunt pe maluri opuse, legate doar prin poduri", () => {
    const [a, b] = m.bases;
    expect(isPassableCell(m, a.cx, a.cy)).toBe(true);
    const r = reachable(m, a.cx, a.cy);
    expect(r[idx(m, b.cx, b.cy)]).toBe(1);
    const noBridges = { ...m, terrain: m.terrain.map((t) => (t === Terrain.Bridge ? Terrain.Water : t)) };
    expect(reachable(noBridges, a.cx, a.cy)[idx(m, b.cx, b.cy)]).toBe(0);
  });
  it("are câmpuri de minereu accesibile din ambele baze", () => {
    const r = reachable(m, m.bases[0].cx, m.bases[0].cy);
    for (const f of m.oreFields) expect(r[idx(m, Math.round(f.cx), Math.round(f.cy))]).toBe(1);
  });
});

describe("simulare — mișcare", () => {
  it("un tanc ajunge la țintă", () => {
    const w = createDemoWorld();
    const tank = [...w.units.values()].find((u) => u.type === "liberty")!;
    w.issue({ kind: "move", player: 0, unitIds: [tank.id], x: tank.x + 20, z: tank.z + 6 });
    const tx = tank.x + 20, tz = tank.z + 6;
    run(w, 8);
    expect(Math.hypot(tank.x - tx, tank.z - tz)).toBeLessThan(0.1);
    expect(tank.target).toBeNull();
  });

  it("vehiculul se întoarce înainte să meargă înapoi", () => {
    const w = createDemoWorld();
    // caută un segment liber de 20 m pe un rând
    let sx = 0, sz = 0;
    search: for (let z = 21; z < 180; z += 2)
      for (let x = 40; x < 80; x += 2) {
        let ok = true;
        for (let d = -2; d <= 22 && ok; d += 0.5) ok = isPassableWorld(w.map, x - d, z) && isPassableWorld(w.map, x - d, z + 2.5) && isPassableWorld(w.map, x - d, z - 2.5);
        if (ok) { sx = x; sz = z; break search; }
      }
    const tank = w.spawnUnit("liberty", 0, sx, sz, 0); // privește spre +x
    const x0 = tank.x;
    w.issue({ kind: "move", player: 0, unitIds: [tank.id], x: tank.x - 15, z: tank.z });
    w.step(); w.step();
    expect(tank.x).toBeCloseTo(x0, 5); // încă se întoarce
    run(w, 6);
    expect(tank.x).toBeLessThan(x0 - 10);
  });

  it("nu poate comanda unitățile inamice", () => {
    const w = createDemoWorld();
    const enemy = [...w.units.values()].find((u) => u.owner === 1)!;
    const z0 = enemy.z;
    w.issue({ kind: "move", player: 0, unitIds: [enemy.id], x: enemy.x, z: enemy.z + 20 });
    run(w, 3);
    expect(enemy.z).toBe(z0);
  });

  it("apa blochează mișcarea (fără A* încă, se oprește la mal)", () => {
    const w = createDemoWorld();
    const r = [...w.units.values()].find((u) => u.type === "ranger")!;
    w.issue({ kind: "move", player: 0, unitIds: [r.id], x: 48 * 2, z: r.z });
    run(w, 30);
    expect(isPassableWorld(w.map, r.x, r.z)).toBe(true);
    for (const u of w.units.values()) expect(isPassableWorld(w.map, u.x, u.z)).toBe(true);
  });

  it("mișcarea de grup dă sloturi distincte, trecibile, la distanță suficientă", () => {
    const w = createDemoWorld();
    const mine = [...w.units.values()].filter((u) => u.owner === 0);
    const slots = formationSlots(w.map, mine, 30 * 2, 44 * 2);
    expect(slots.length).toBe(mine.length);
    for (let i = 0; i < slots.length; i++) {
      expect(isPassableWorld(w.map, slots[i].x, slots[i].z)).toBe(true);
      for (let j = i + 1; j < slots.length; j++) expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThan(2);
    }
    w.issue({ kind: "move", player: 0, unitIds: mine.map((u) => u.id), x: 30 * 2, z: 44 * 2 });
    run(w, 20);
    const arrived = mine.filter((u) => u.target === null).length;
    expect(arrived).toBe(mine.length);
  });

  it("e determinist (aceleași comenzi → același hash)", () => {
    const play = () => {
      const w = createDemoWorld();
      const ids = [...w.units.values()].filter((u) => u.owner === 0).map((u) => u.id);
      w.issue({ kind: "move", player: 0, unitIds: ids, x: 60, z: 70 });
      run(w, 4);
      w.issue({ kind: "move", player: 0, unitIds: ids.slice(0, 3), x: 30, z: 120 });
      run(w, 5);
      return w.stateHash();
    };
    expect(play()).toBe(play());
  });

  it("clădirile demo sunt plasate (6 roluri × 2 facțiuni) și blochează celule", () => {
    const w = createDemoWorld();
    const types = new Set([...w.buildings.values()].map((b) => `${b.owner}:${b.type}`));
    expect(types.size).toBe(12);
    const b = [...w.buildings.values()][0];
    expect(isPassableCell(w.map, b.cx, b.cy)).toBe(false);
  });
});

describe("scara", () => {
  it("vehiculele se scalează după lungime, infanteria după înălțime", () => {
    // tanc cu lungimea brută 10 → 5.5 m
    expect(fitScale({ x: 10, y: 3, z: 4 }, 5.5, "length")).toBeCloseTo(0.55);
    // soldat cu înălțimea brută 60 → 2.6 m
    expect(fitScale({ x: 9, y: 60, z: 7 }, 2.6, "height")).toBeCloseTo(2.6 / 60);
    // clădire 4×4 celule: latura cea mai lungă intră în 8 m × fill
    expect(fitScale({ x: 2, y: 1, z: 3 }, 8, "footprint")).toBeCloseTo(8 / 3);
  });
});
