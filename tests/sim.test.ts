import { describe, expect, it } from "vitest";
import { generateDeltaMap, isPassableCell, reachable, idx, Terrain, isPassableWorld } from "../src/map/gameMap";
import { World, TICK_RATE, formationSlots, UNIT_DEFS, VERSUS, WEAPONS } from "../src/sim/world";
import { createDemoWorld } from "../src/sim/scenario";
import { fitScale } from "../src/render/scaleMath";

/** Cel mai apropiat punct de (x,z) cu un disc liber de rază r (din S4.2 harta are și orășele). */
function openSpot(w: World, x: number, z: number, r: number) {
  for (let d = 0; d < 120; d += 2)
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a / 16) * Math.PI * 2) * d, pz = z + Math.sin((a / 16) * Math.PI * 2) * d;
      let ok = true;
      for (let dz = -r; dz <= r && ok; dz += 1) for (let dx = -r; dx <= r && ok; dx += 1) if (dx * dx + dz * dz <= r * r) ok = isPassableWorld(w.map, px + dx, pz + dz);
      if (ok) return { x: px, z: pz };
      if (d === 0) break;
    }
  throw new Error("niciun loc liber");
}

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
    const { x: tx, z: tz } = openSpot(w, tank.x + 20, tank.z + 6, 3);
    w.issue({ kind: "move", player: 0, unitIds: [tank.id], x: tx, z: tz });
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

  it("A*: infanteria trece râul pe pod și ajunge pe celălalt mal", () => {
    const w = createDemoWorld();
    for (const u of [...w.units.values()]) if (u.owner === 1) w.units.delete(u.id); // fără inamici pe drum
    for (const b of [...w.buildings.values()]) if (b.owner === 1) w.removeBuilding(b); // nici turele
    const r = [...w.units.values()].find((u) => u.type === "ranger")!;
    const tx = 70 * 2, tz = r.z;
    w.issue({ kind: "move", player: 0, unitIds: [r.id], x: tx, z: tz });
    w.step();
    expect(r.path.length).toBeGreaterThan(1);
    for (let i = 0; i < 90 * TICK_RATE && r.target; i++) {
      w.step();
      expect(isPassableWorld(w.map, r.x, r.z)).toBe(true);
    }
    expect(Math.hypot(r.x - tx, r.z - tz)).toBeLessThan(1);
  });

  it("A*: tancul ocolește pădurea și nu intră în apă", () => {
    const w = createDemoWorld();
    const t = [...w.units.values()].find((u) => u.type === "liberty")!;
    const path = w.paths.find(t.x, t.z, 70 * 2, 80 * 2, true);
    expect(path.length).toBeGreaterThan(1);
    let prev = { x: t.x, z: t.z };
    for (const p of path) {
      expect(w.paths.lineClear(prev, p, false)).toBe(true);
      prev = p;
    }
  });

  it("mișcarea de grup dă sloturi distincte, trecibile, la distanță suficientă", () => {
    const w = createDemoWorld();
    const mine = [...w.units.values()].filter((u) => u.owner === 0);
    const dest = openSpot(w, 30 * 2, 44 * 2, 12);
    const slots = formationSlots(w.map, mine, dest.x, dest.z);
    expect(slots.length).toBe(mine.length);
    for (let i = 0; i < slots.length; i++) {
      expect(isPassableWorld(w.map, slots[i].x, slots[i].z)).toBe(true);
      for (let j = i + 1; j < slots.length; j++) expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThan(2);
    }
    w.issue({ kind: "move", player: 0, unitIds: mine.map((u) => u.id), x: dest.x, z: dest.z });
    run(w, 45);
    const arrived = mine.filter((u) => u.target === null).length;
    expect(arrived).toBe(mine.length);
  });

  it("separare: după mișcarea de grup unitățile nu se suprapun", () => {
    const w = createDemoWorld();
    const mine = [...w.units.values()].filter((u) => u.owner === 0);
    // toți spre același punct, apoi încă o comandă care traversează grupul
    w.issue({ kind: "move", player: 0, unitIds: mine.map((u) => u.id), x: 60, z: 86 });
    run(w, 15);
    w.issue({ kind: "move", player: 0, unitIds: mine.slice(0, 4).map((u) => u.id), x: 40, z: 86 });
    run(w, 15);
    for (let i = 0; i < mine.length; i++)
      for (let j = i + 1; j < mine.length; j++) {
        const a = mine[i], b = mine[j];
        const min = (UNIT_DEFS[a.type].radius + UNIT_DEFS[b.type].radius) * 0.75;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(min);
      }
  });

  it("separare: o unitate oprită se dă la o parte când trece alta prin ea", () => {
    const w = createDemoWorld();
    const [a, b] = [...w.units.values()].filter((u) => u.type === "ranger");
    b.x = a.x + 6; b.z = a.z; b.prevX = b.x; b.prevZ = b.z;
    const bz0 = b.z;
    w.issue({ kind: "move", player: 0, unitIds: [a.id], x: a.x + 12, z: a.z });
    run(w, 8);
    expect(a.target).toBeNull();
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(0.9);
    expect(Math.abs(b.z - bz0) + Math.abs(b.x - (a.x - 6))).toBeGreaterThan(0.3);
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

describe("simulare — luptă", () => {
  /** Lume goală (fără unitățile demo), doar harta + clădirile. */
  const arena = () => {
    const w = createDemoWorld();
    for (const id of [...w.units.keys()]) w.units.delete(id);
    return w;
  };
  // un loc deschis pe malul vestic, departe de turele
  const spot = (w: World) => {
    const turrets = [...w.buildings.values()].filter((b) => b.type === "turret");
    for (let z = 30; z < 170; z += 2)
      for (let x = 20; x < 160; x += 2) {
        if (turrets.some((t) => Math.hypot(t.x - x, t.z - z) < 48)) continue;
        let ok = true;
        for (let dz = -14; dz <= 14 && ok; dz += 2) for (let dx = -14; dx <= 30 && ok; dx += 2) ok = isPassableWorld(w.map, x + dx, z + dz);
        if (ok) return { x, z };
      }
    throw new Error("niciun loc liber");
  };

  it("multiplicatorii armură × damage: gloanțele aproape nu zgârie tancurile", () => {
    expect(VERSUS.bullet.heavy).toBeLessThan(0.3);
    expect(VERSUS.ap.heavy).toBe(1);
    expect(VERSUS.he.infantry).toBe(1);
    const w = arena();
    const s = spot(w);
    const t = w.spawnUnit("ursus", 1, s.x, s.z);
    w.damage(t, 100, "bullet", 0);
    expect(t.hp).toBeCloseTo(UNIT_DEFS.ursus.hp - 100 * VERSUS.bullet.heavy);
  });

  it("comanda de atac: tancul se apropie, trage, ținta moare și dispare", () => {
    const w = arena();
    const s = spot(w);
    const tank = w.spawnUnit("liberty", 0, s.x, s.z, 0);
    const victim = w.spawnUnit("harvUssr", 1, s.x + 30, s.z); // neînarmat, nu ripostează
    w.issue({ kind: "attack", player: 0, unitIds: [tank.id], targetId: victim.id });
    let fired = 0;
    for (let i = 0; i < 40 * TICK_RATE && w.units.has(victim.id); i++) {
      w.step();
      fired += w.events.filter((e) => e.kind === "fire").length;
    }
    expect(w.units.has(victim.id)).toBe(false);
    w.step();
    expect(fired).toBeGreaterThan(5);
    expect(tank.attackId).toBe(0);
    expect(Math.hypot(tank.x - (s.x + 30), tank.z - s.z)).toBeLessThan(WEAPONS.cannon90.range + 4);
  });

  it("unitățile inactive trag singure în inamicii din rază", () => {
    const w = arena();
    const s = spot(w);
    const r = w.spawnUnit("ranger", 0, s.x, s.z);
    const c = w.spawnUnit("conscript", 1, s.x + 10, s.z);
    run(w, 30);
    // unul dintre ei trebuie să fi murit
    expect(w.units.has(r.id) && w.units.has(c.id)).toBe(false);
  });

  it("tancurile câștigă contra infanteriei 1v3, infanteria pierde", () => {
    const w = arena();
    const s = spot(w);
    const tank = w.spawnUnit("liberty", 0, s.x, s.z);
    for (let i = 0; i < 3; i++) w.spawnUnit("conscript", 1, s.x + 12, s.z - 3 + i * 3);
    run(w, 40);
    expect(w.units.has(tank.id)).toBe(true);
    expect([...w.units.values()].filter((u) => u.owner === 1).length).toBe(0);
  });

  it("artileria nu poate trage sub raza minimă", () => {
    const w = arena();
    const s = spot(w);
    const art = w.spawnUnit("sentinel", 0, s.x, s.z);
    const t = w.spawnUnit("harvUssr", 1, s.x + 4.5, s.z);
    w.issue({ kind: "attack", player: 0, unitIds: [art.id], targetId: t.id });
    run(w, 5);
    expect(t.hp).toBe(t.maxHp);
  });

  it("artileria are explozie cu rază (lovește mai multe ținte)", () => {
    const w = arena();
    const s = spot(w);
    const art = w.spawnUnit("sentinel", 0, s.x, s.z);
    const a = w.spawnUnit("harvUssr", 1, s.x + 30, s.z);
    const b = w.spawnUnit("harvUssr", 1, s.x + 30, s.z + 3.4);
    w.issue({ kind: "attack", player: 0, unitIds: [art.id], targetId: a.id });
    run(w, 6);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it("clădirea distrusă eliberează celulele; turela apără baza", () => {
    const w = arena();
    // (nu centrala: fără ea baza ar rămâne fără energie și turela n-ar mai trage — S3)
    const b = [...w.buildings.values()].find((x) => x.owner === 1 && x.type === "barracks")!;
    expect(isPassableCell(w.map, b.cx, b.cy)).toBe(false);
    w.damage(b, 1e6, "he", 0);
    expect(w.buildings.has(b.id)).toBe(false);
    expect(isPassableCell(w.map, b.cx, b.cy)).toBe(true);
    expect(w.events.some((e) => e.kind === "death" && e.entity === "building")).toBe(true);

    const turret = [...w.buildings.values()].find((x) => x.owner === 1 && x.type === "turret")!;
    const r = w.spawnUnit("ranger", 0, turret.x - 18, turret.z);
    run(w, 20);
    expect(w.units.has(r.id)).toBe(false);
  });

  it("lupta e deterministă (aceleași comenzi → același hash)", () => {
    const play = () => {
      const w = createDemoWorld();
      const mine = [...w.units.values()].filter((u) => u.owner === 0).map((u) => u.id);
      const enemy = [...w.units.values()].find((u) => u.owner === 1 && u.type === "ursus")!;
      w.issue({ kind: "attack", player: 0, unitIds: mine, targetId: enemy.id });
      run(w, 45);
      return w.stateHash();
    };
    const a = play();
    expect(a).toBe(play());
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
