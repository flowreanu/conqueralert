import { generateDeltaMap } from "../map/gameMap";
import { World, nearestPassable } from "./world";

/**
 * Scenariul demo S1: fiecare facțiune are cele 6 clădiri (statice, pentru verificarea scării)
 * și câteva unități. Jucătorul 0 = SUA (controlabil), jucătorul 1 = URSS.
 */
export function createDemoWorld(seed = 1337): World {
  const map = generateDeltaMap(seed);
  const w = new World(map, [
    { index: 0, faction: "usa", name: "Tu" },
    { index: 1, faction: "ussr", name: "Bot" },
  ]);
  const cs = map.cellSize;

  const layout: [string, number, number][] = [
    ["conyard", -2, -2],
    ["power", -6, 3],
    ["power", -6, 0],
    ["refinery", 3, 3],
    ["barracks", 3, -3],
    ["factory", -2, -8],
    ["turret", 7, 0],
  ];
  for (const base of map.bases) {
    const owner = base.faction === "usa" ? 0 : 1;
    const mirror = owner === 0 ? 1 : -1; // URSS: baza în oglindă, cu fața spre vest
    for (const [type, dx, dy] of layout) {
      const cells = type === "conyard" || type === "factory" ? 4 : type === "power" || type === "turret" ? 2 : 3;
      const cx = mirror === 1 ? base.cx + dx : base.cx - dx - cells;
      w.placeBuilding(type, owner, cx, base.cy + dy);
    }
  }

  const army = (owner: number, types: string[], cx: number, cy: number, facing: number) => {
    const cols = 4;
    types.forEach((t, i) => {
      const p = nearestPassable(map, (cx + (i % cols) * 3.2) * cs, (cy + Math.floor(i / cols) * 3.2) * cs);
      w.spawnUnit(t, owner, p.x, p.z, facing);
    });
  };
  army(0, ["liberty", "liberty", "liberty", "sentinel", "ranger", "ranger", "ranger", "ranger", "harvUsa"], 22, 54, 0);
  army(1, ["ursus", "ursus", "katiusa", "katiusa", "conscript", "conscript", "conscript", "conscript", "harvUssr"], 64, 52, Math.PI);
  return w;
}

/**
 * Scenariul S3 (skirmish): SUA pornește doar cu Centrul de Construcție, câteva unități și 5000 de credite —
 * își construiește singur baza. URSS are baza completă (fără bot până în S4), cu recoltorul la lucru.
 */
export function createSkirmishWorld(seed = 1337): World {
  const map = generateDeltaMap(seed);
  const w = new World(map, [
    { index: 0, faction: "usa", name: "Tu" },
    { index: 1, faction: "ussr", name: "Bot" },
  ]);
  const cs = map.cellSize;
  const usa = map.bases.find((b) => b.faction === "usa")!;
  w.placeBuilding("conyard", 0, usa.cx - 2, usa.cy - 2);
  [["liberty", 6, -4], ["liberty", 6, -1], ["ranger", 4, 3], ["ranger", 5.5, 3], ["ranger", 7, 3]].forEach(([t, dx, dy]) =>
    w.spawnUnit(t as string, 0, (usa.cx + (dx as number)) * cs, (usa.cy + (dy as number)) * cs, 0));

  const ussr = map.bases.find((b) => b.faction === "ussr")!;
  const layout: [string, number, number][] = [
    ["conyard", -2, -2], ["power", -6, 3], ["power", -6, 0], ["refinery", 3, -8], ["barracks", 3, 3], ["factory", -2, -9], ["turret", 7, 0], ["turret", 7, -6],
  ];
  for (const [type, dx, dy] of layout) {
    const cells = type === "conyard" || type === "factory" ? 4 : type === "power" || type === "turret" ? 2 : 3;
    w.placeBuilding(type, 1, ussr.cx - dx - cells, ussr.cy + dy);
  }
  const ref = [...w.buildings.values()].find((b) => b.owner === 1 && b.type === "refinery")!;
  const h = w.spawnUnit("harvUssr", 1, ref.x - 6, ref.z, Math.PI);
  h.harv!.auto = true;
  h.harv!.mode = "toOre";
  [["ursus", -1, 8], ["ursus", -4, 8], ["conscript", 0, 11], ["conscript", -2, 11], ["katiusa", -6, 5]].forEach(([t, dx, dy]) =>
    w.spawnUnit(t as string, 1, (ussr.cx + (dx as number)) * cs, (ussr.cy + (dy as number)) * cs, Math.PI));
  return w;
}

export type Difficulty = "easy" | "normal" | "hard";

export interface MatchOptions {
  /** facțiunea jucătorului uman (0); botul (1) primește cealaltă */
  faction: "usa" | "ussr";
  difficulty: Difficulty;
  seed?: number;
}

/** Unitățile de start, per rol (tanc, infanterie). */
const START_ARMY: Record<string, string[]> = {
  usa: ["liberty", "liberty", "ranger", "ranger", "ranger"],
  ussr: ["ursus", "ursus", "conscript", "conscript", "conscript"],
};

/**
 * Meciul skirmish (S4): ambii jucători pornesc la fel — Centrul de Construcție, 2 tancuri, 3 soldați, 5000 $.
 * SUA e mereu la vest și URSS la est (bazele hărții); jucătorul uman e indexul 0.
 */
export function createMatchWorld(opts: MatchOptions): World {
  const seed = opts.seed ?? 1337;
  const map = generateDeltaMap(seed);
  const botFaction = opts.faction === "usa" ? "ussr" : "usa";
  const w = new World(map, [
    { index: 0, faction: opts.faction, name: "Tu" },
    { index: 1, faction: botFaction, name: "Bot" },
  ], seed);
  const cs = map.cellSize;
  w.players.forEach((p) => {
    const base = map.bases.find((b) => b.faction === p.faction)!;
    const dir = base.cx < map.width / 2 ? 1 : -1; // spre centrul hărții
    w.placeBuilding("conyard", p.index, base.cx - 2, base.cy - 2);
    const heading = dir === 1 ? 0 : Math.PI;
    const spots: [number, number][] = [[6, -4], [6, -1], [4, 3], [5.5, 3], [7, 3]];
    START_ARMY[p.faction].forEach((t, i) => {
      const [dx, dy] = spots[i];
      w.spawnUnit(t, p.index, (base.cx + dx * dir) * cs, (base.cy + dy) * cs, heading);
    });
  });
  return w;
}
