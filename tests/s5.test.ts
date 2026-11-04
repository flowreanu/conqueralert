import { describe, expect, it } from "vitest";
import { generateDeltaMap, isPassableWorld } from "../src/map/gameMap";
import { createMatchWorld, createSkirmishWorld } from "../src/sim/scenario";
import { Bot } from "../src/sim/bot";
import { BUILDING_DEFS, ELITE_REGEN, NEUTRAL, RANK_HP, RANK_XP, TICK_RATE, UNIT_DEFS, Unit, World } from "../src/sim/world";

const run = (w: World, seconds: number) => { for (let i = 0; i < Math.round(seconds * TICK_RATE) && w.winner < 0; i++) w.step(); };
const civ = (w: World, type = "civHouse") => [...w.buildings.values()].filter((b) => b.type === type);
const units = (w: World, p: number) => [...w.units.values()].filter((u) => u.owner === p);

/** Lume fără unitățile de start; păstrează harta (case, puțuri) și clădirile. */
function emptyWorld(): World {
  const w = createSkirmishWorld();
  for (const id of [...w.units.keys()]) w.units.delete(id);
  return w;
}
/** Un punct liber lângă clădire (în afara amprentei). */
function near(w: World, b: { x: number; z: number; cw: number; ch: number }, extra = 2) {
  const r = (Math.max(b.cw, b.ch) * w.map.cellSize) / 2 + extra;
  for (let a = 0; a < 32; a++) {
    const x = b.x + Math.cos((a / 32) * Math.PI * 2) * r, z = b.z + Math.sin((a / 32) * Math.PI * 2) * r;
    if (isPassableWorld(w.map, x, z)) return { x, z };
  }
  throw new Error("niciun loc liber lângă clădire");
}
/** Casa cea mai îndepărtată de baze (să nu tragă turelele). */
const quietHouse = (w: World) => civ(w).sort((a, b) => {
  const d = (h: typeof a) => Math.min(...w.map.bases.map((s) => Math.hypot(h.x / 2 - s.cx, h.z / 2 - s.cy)));
  return d(b) - d(a);
})[0];

describe("S5 — harta în oglindă", () => {
  const m = generateDeltaMap();
  const N = m.width * m.height;
  it("terenul, minereul și obstacolele sunt identice după rotirea la 180°", () => {
    for (let i = 0; i < N; i++) {
      expect(m.terrain[i]).toBe(m.terrain[N - 1 - i]);
      expect(m.ore[i]).toBe(m.ore[N - 1 - i]);
      expect(m.blocked[i]).toBe(m.blocked[N - 1 - i]);
    }
  });
  it("bazele, podurile, câmpurile de minereu, casele și puțurile sunt perechi rotite", () => {
    const [a, b] = m.bases;
    expect([a.cx + b.cx, a.cy + b.cy]).toEqual([m.width, m.height]);
    const [p, q] = m.bridges;
    expect([p.x0 + q.x1, p.y0 + q.y1]).toEqual([m.width - 1, m.height - 1]);
    expect(m.oreFields[0].cx + m.oreFields[1].cx).toBeCloseTo(m.width);
    expect(m.oreFields[2].cy + m.oreFields[3].cy).toBeCloseTo(m.height);
    expect(m.civ.length).toBeGreaterThanOrEqual(16);
    expect(m.civ.length % 2).toBe(0);
    for (let i = 0; i < m.civ.length; i += 2) {
      const c = m.civ[i], d = m.civ[i + 1];
      expect(c.cx + c.cw + d.cx).toBe(m.width);
      expect(c.cy + c.ch + d.cy).toBe(m.height);
      expect(c.model).toBe(d.model);
    }
    expect(m.tech).toHaveLength(2);
    expect(m.tech[0].cx + m.tech[1].cx).toBe(m.width - 2);
  });
  it("meciul pornește identic pentru ambele baze (poziții rotite)", () => {
    const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
    const W = m.width * m.cellSize, H = m.height * m.cellSize;
    const a = units(w, 0).map((u) => [u.x, u.z]), b = units(w, 1).map((u) => [W - u.x, H - u.z]);
    expect(b).toEqual(a);
  });
});

describe("S5 — infanteria în case", () => {
  it("casele sunt clădiri neutre; nimeni nu le atacă singur", () => {
    const w = emptyWorld();
    const h = quietHouse(w);
    expect(h.owner).toBe(NEUTRAL);
    const p = near(w, h, 4);
    const r = w.spawnUnit("ranger", 0, p.x, p.z);
    run(w, 3);
    expect(r.attackId).toBe(0);
    expect(h.hp).toBe(h.maxHp);
  });

  it("soldatul intră, casa devine a lui, trage mai departe decât pușca și iese când casa e distrusă", () => {
    const w = emptyWorld();
    const h = quietHouse(w);
    const p = near(w, h, 6);
    const r = w.spawnUnit("ranger", 0, p.x, p.z);
    w.issue({ kind: "enter", player: 0, unitIds: [r.id], targetId: h.id });
    run(w, 8);
    expect(w.units.has(r.id)).toBe(false);
    expect(h.garrison.map((u) => u.id)).toEqual([r.id]);
    expect(h.owner).toBe(0);
    // un tanc inamic, mai departe decât raza puștii, dar în raza casei (rază + bonus)
    const ang = Math.atan2(p.z - h.z, p.x - h.x);
    let spot: { x: number; z: number } | null = null;
    for (let d = 17; d < 22 && !spot; d += 0.5)
      for (let k = 0; k < 24 && !spot; k++) {
        const a = ang + (k / 24) * Math.PI * 2;
        const x = h.x + Math.cos(a) * d, z = h.z + Math.sin(a) * d;
        if (isPassableWorld(w.map, x, z)) spot = { x, z };
      }
    const t = w.spawnUnit("conscript", 1, spot!.x, spot!.z);
    w.issue({ kind: "stop", player: 1, unitIds: [t.id] });
    const hp0 = t.hp;
    run(w, 4);
    expect(w.rangeTo(r, t)).toBeGreaterThan(14);
    expect(!w.units.has(t.id) || t.hp < hp0).toBe(true);
    // gloanțele aproape nu zgârie casa; artileria (HE) o distruge → soldatul iese viu
    const hp1 = h.hp;
    w.damage(h, 100, "bullet", 0, 1);
    expect(hp1 - h.hp).toBeLessThan(20);
    w.damage(h, 5000, "he", 0, 1);
    expect(w.buildings.has(h.id)).toBe(false);
    expect(w.units.get(r.id)?.hp).toBe(r.maxHp);
    expect(w.inside.has(r.id)).toBe(false);
  });

  it("încap cel mult 5 soldați; inamicul nu poate intra; „ieșiți” îi scoate afară", () => {
    const w = emptyWorld();
    const h = quietHouse(w);
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) { const p = near(w, h, 3 + i * 0.7); ids.push(w.spawnUnit("ranger", 0, p.x, p.z).id); }
    w.issue({ kind: "enter", player: 0, unitIds: ids, targetId: h.id });
    run(w, 12);
    expect(h.garrison).toHaveLength(BUILDING_DEFS.civHouse.garrison!);
    expect(units(w, 0)).toHaveLength(1);
    const p = near(w, h, 3);
    const enemy = w.spawnUnit("conscript", 1, p.x, p.z);
    expect(w.enterAction(enemy, h)).toBeNull();
    w.issue({ kind: "evacuate", player: 0, buildingId: h.id });
    w.step();
    expect(h.garrison).toHaveLength(0);
    expect(h.owner).toBe(NEUTRAL);
    expect(units(w, 0)).toHaveLength(6);
    for (const u of units(w, 0)) expect(isPassableWorld(w.map, u.x, u.z)).toBe(true);
  });

  it("vehiculele și inginerii nu intră în case", () => {
    const w = emptyWorld();
    const h = quietHouse(w);
    const p = near(w, h, 4);
    expect(w.enterAction(w.spawnUnit("liberty", 0, p.x, p.z), h)).toBeNull();
    expect(w.enterAction(w.spawnUnit("engUsa", 0, p.x, p.z), h)).toBeNull();
  });
});

describe("S5 — inginerul", () => {
  it("capturează o clădire inamică (și dispare)", () => {
    const w = emptyWorld();
    const pp = [...w.buildings.values()].find((b) => b.owner === 1 && b.type === "power")!;
    const p = near(w, pp, 3);
    const e = w.spawnUnit("engUsa", 0, p.x, p.z);
    w.issue({ kind: "enter", player: 0, unitIds: [e.id], targetId: pp.id });
    run(w, 6);
    expect(pp.owner).toBe(0);
    expect(pp.faction).toBe("usa");
    expect(w.units.has(e.id)).toBe(false);
    expect(w.eco[0].powerOut).toBeGreaterThan(0);
  });

  it("repară complet o clădire proprie", () => {
    const w = emptyWorld();
    const cy = [...w.buildings.values()].find((b) => b.owner === 0 && b.type === "conyard")!;
    cy.hp = 300;
    const p = near(w, cy, 3);
    const e = w.spawnUnit("engUsa", 0, p.x, p.z);
    w.issue({ kind: "enter", player: 0, unitIds: [e.id], targetId: cy.id });
    run(w, 6);
    expect(cy.hp).toBe(cy.maxHp);
    expect(w.units.has(e.id)).toBe(false);
  });

  it("puțul de petrol capturat aduce credite", () => {
    const w = emptyWorld();
    const d = civ(w, "derrick")[0];
    const p = near(w, d, 3);
    const e = w.spawnUnit("engUsa", 0, p.x, p.z);
    w.issue({ kind: "enter", player: 0, unitIds: [e.id], targetId: d.id });
    run(w, 6);
    expect(d.owner).toBe(0);
    const c0 = w.eco[0].credits;
    run(w, 10);
    expect(w.eco[0].credits - c0).toBeCloseTo(BUILDING_DEFS.derrick.income! * 10, 0);
  });

  it("puțul și casele nu țin în viață un jucător fără bază și fără armată", () => {
    const w = emptyWorld();
    const d = civ(w, "derrick")[0];
    d.owner = 1;
    for (const b of [...w.buildings.values()]) if (b.owner === 1 && b !== d) w.removeBuilding(b);
    for (const u of units(w, 1)) w.units.delete(u.id);
    run(w, 2);
    expect(w.defeated[1]).toBe(true);
  });
});

describe("S5 — ranguri", () => {
  it("experiența = valoarea țintelor distruse; pragurile cresc viața maximă", () => {
    const w = emptyWorld();
    const r = w.spawnUnit("ranger", 0, 40, 40);
    const cost = UNIT_DEFS.ranger.cost;
    w.giveXp(r, cost * RANK_XP[1] - 1);
    expect(r.rank).toBe(0);
    w.giveXp(r, 1);
    expect(r.rank).toBe(1);
    expect(r.maxHp).toBeCloseTo(UNIT_DEFS.ranger.hp * RANK_HP[1]);
    w.giveXp(r, cost * 100);
    expect(r.rank).toBe(4);
  });

  it("uciderea unui inamic dă experiență celui care a tras", () => {
    const w = emptyWorld();
    const r = w.spawnUnit("liberty", 0, 40, 40);
    const v = w.spawnUnit("ursus", 1, 60, 40);
    w.damage(v, 1e5, "ap", r.id, 0);
    expect(w.units.has(v.id)).toBe(false);
    expect(r.xp).toBe(UNIT_DEFS.ursus.cost);
  });

  it("veteranii fac mai mult damage, iar elita se repară singură", () => {
    const shoot = (rank: number) => {
      const w = createSkirmishWorld();
      for (const id of [...w.units.keys()]) w.units.delete(id);
      for (const b of [...w.buildings.values()]) if (b.owner < 0) w.removeBuilding(b);
      w.map.blocked.forEach((v, i) => { if (v === 1) w.map.blocked[i] = 0; });
      w.paths.invalidate();
      const a = w.spawnUnit("liberty", 0, 60, 60, 0);
      if (rank) w.giveXp(a, UNIT_DEFS.liberty.cost * RANK_XP[rank]);
      const t = w.spawnUnit("ursus", 1, 75, 60, Math.PI);
      w.issue({ kind: "stop", player: 1, unitIds: [t.id] });
      t.lastAttacker = 0;
      w.issue({ kind: "attack", player: 0, unitIds: [a.id], targetId: t.id });
      // ursus nu ripostează: îl ținem pe loc fără armă
      const def = UNIT_DEFS.ursus; const wpn = def.weapon; def.weapon = undefined;
      try { run(w, 8); } finally { def.weapon = wpn; }
      return t.maxHp - t.hp;
    };
    expect(shoot(4)).toBeGreaterThan(shoot(0) * 1.3);
    const w = emptyWorld();
    const e = w.spawnUnit("ranger", 0, 40, 40);
    w.giveXp(e, 1e6);
    e.hp = 10;
    run(w, 2);
    expect(e.hp).toBeCloseTo(10 + e.maxHp * ELITE_REGEN * 2, 0);
  });

  it("soldații din case primesc și ei experiență", () => {
    const w = emptyWorld();
    const h = quietHouse(w);
    const p = near(w, h, 4);
    const r: Unit = w.spawnUnit("ranger", 0, p.x, p.z);
    w.issue({ kind: "enter", player: 0, unitIds: [r.id], targetId: h.id });
    run(w, 8);
    const q = near(w, h, 9);
    const t = w.spawnUnit("conscript", 1, q.x, q.z);
    t.hp = 5;
    run(w, 4);
    expect(w.units.has(t.id)).toBe(false);
    expect(r.xp).toBe(UNIT_DEFS.conscript.cost);
  });
});

describe("S5 — unități noi", () => {
  const duel = (a: [string, number], b: [string, number]) => {
    const w = createSkirmishWorld();
    for (const id of [...w.units.keys()]) w.units.delete(id);
    for (const bb of [...w.buildings.values()]) if (bb.owner < 0) w.removeBuilding(bb);
    w.map.blocked.forEach((v, i) => { if (v === 1) w.map.blocked[i] = 0; });
    w.paths.invalidate();
    for (let i = 0; i < a[1]; i++) w.spawnUnit(a[0], 0, 30, 76 + i * 3, 0);
    for (let i = 0; i < b[1]; i++) w.spawnUnit(b[0], 1, 62, 76 + i * 3, Math.PI);
    w.issue({ kind: "amove", player: 0, unitIds: units(w, 0).map((u) => u.id), x: 70, z: 82 });
    w.issue({ kind: "amove", player: 1, unitIds: units(w, 1).map((u) => u.id), x: 20, z: 82 });
    for (let i = 0; i < 90 * TICK_RATE && units(w, 0).length && units(w, 1).length; i++) w.step();
    return [units(w, 0).length, units(w, 1).length];
  };
  it("infanteria antitanc bate tancurile la cost egal (2100 $)", () => {
    expect(duel(["bazooka", 7], ["liberty", 3])[1]).toBe(0);
    expect(duel(["ursus", 3], ["rpg", 9])[0]).toBe(0);
  });
  it("…dar pierde contra infanteriei obișnuite și a cercetașilor", () => {
    expect(duel(["bazooka", 4], ["conscript", 11])[0]).toBe(0);
    expect(duel(["rpg", 4], ["humvee", 2])[0]).toBe(0);
  });
  it("cercetașul e cel mai rapid și vede cel mai departe", () => {
    for (const f of ["usa", "ussr"]) {
      const list = Object.values(UNIT_DEFS).filter((d) => d.faction === f);
      const scout = list.find((d) => d.role === "scout")!;
      for (const d of list) { expect(scout.speed).toBeGreaterThanOrEqual(d.speed); expect(scout.sight).toBeGreaterThanOrEqual(d.sight); }
    }
  });
});

describe("S5 — botul", () => {
  it("pe Normal capturează un puț de petrol și ocupă o casă; rămâne determinist", () => {
    const play = () => {
      const w = createMatchWorld({ faction: "usa", difficulty: "normal" });
      w.controllers.push(new Bot(1, "normal"));
      run(w, 330);
      return w;
    };
    const w = play();
    const mine = [...w.buildings.values()].filter((b) => b.owner === 1);
    expect(mine.some((b) => b.type === "derrick")).toBe(true);
    expect(mine.some((b) => BUILDING_DEFS[b.type].garrison && b.garrison.length > 0)).toBe(true);
    expect(play().stateHash()).toBe(w.stateHash());
  });
});
