import unitsData from "../data/units.json";
import buildingsData from "../data/buildings.json";
import scaleData from "../data/scale.json";
import { GameMap, inBounds, idx, isPassableCell, isPassableWorld, worldToCell } from "../map/gameMap";

export const TICK_RATE = 15;
export const DT = 1 / TICK_RATE;

export type UnitTypeId = keyof typeof unitsData;
export type BuildingTypeId = keyof typeof buildingsData;
export interface UnitDef {
  faction: string;
  name: string;
  role: string;
  model: string;
  scale: string;
  speed: number;
  turnRate: number;
  radius: number;
}
export const UNIT_DEFS = unitsData as Record<string, UnitDef>;

export interface Unit {
  id: number;
  type: string;
  owner: number; // index jucător
  faction: string;
  x: number;
  z: number;
  heading: number; // radiani, 0 = +x, π/2 = +z
  prevX: number;
  prevZ: number;
  prevHeading: number;
  moving: boolean;
  target: { x: number; z: number } | null;
}

export interface Building {
  id: number;
  type: string;
  owner: number;
  faction: string;
  cx: number; // colțul celulei stânga-jos
  cy: number;
  cells: number;
}

export interface Player {
  index: number;
  faction: string;
  name: string;
}

/** Comenzile sunt singura cale de a modifica lumea — pregătit pentru lockstep (S8). */
export type Command = { kind: "move"; player: number; unitIds: number[]; x: number; z: number } | { kind: "stop"; player: number; unitIds: number[] };

export class World {
  tick = 0;
  units = new Map<number, Unit>();
  buildings = new Map<number, Building>();
  private nextId = 1;
  private pending: Command[] = [];

  constructor(public map: GameMap, public players: Player[]) {}

  spawnUnit(type: string, owner: number, x: number, z: number, heading = 0): Unit {
    const def = UNIT_DEFS[type];
    if (!def) throw new Error(`Tip de unitate necunoscut: ${type}`);
    const u: Unit = {
      id: this.nextId++,
      type,
      owner,
      faction: this.players[owner].faction,
      x, z, heading,
      prevX: x, prevZ: z, prevHeading: heading,
      moving: false,
      target: null,
    };
    this.units.set(u.id, u);
    return u;
  }

  /** Clădire statică (S1: doar decor + ocupă celule). Întoarce null dacă locul nu e liber. */
  placeBuilding(type: string, owner: number, cx: number, cy: number): Building | null {
    const def = (buildingsData as Record<string, { size: string }>)[type];
    const cells = (scaleData.buildings as Record<string, { cells: number }>)[def.size].cells;
    for (let y = cy; y < cy + cells; y++)
      for (let x = cx; x < cx + cells; x++) if (!isPassableCell(this.map, x, y)) return null;
    for (let y = cy; y < cy + cells; y++) for (let x = cx; x < cx + cells; x++) this.map.blocked[idx(this.map, x, y)] = 2;
    const b: Building = { id: this.nextId++, type, owner, faction: this.players[owner].faction, cx, cy, cells };
    this.buildings.set(b.id, b);
    return b;
  }

  issue(cmd: Command) {
    this.pending.push(cmd);
  }

  step() {
    for (const cmd of this.pending) this.apply(cmd);
    this.pending.length = 0;
    for (const u of this.units.values()) {
      u.prevX = u.x;
      u.prevZ = u.z;
      u.prevHeading = u.heading;
      this.moveUnit(u);
    }
    this.tick++;
  }

  private apply(cmd: Command) {
    const units = cmd.unitIds.map((id) => this.units.get(id)).filter((u): u is Unit => !!u && u.owner === cmd.player);
    if (cmd.kind === "stop") {
      for (const u of units) { u.target = null; u.moving = false; }
      return;
    }
    const slots = formationSlots(this.map, units, cmd.x, cmd.z);
    units.forEach((u, i) => { u.target = slots[i]; });
  }

  private moveUnit(u: Unit) {
    if (!u.target) { u.moving = false; return; }
    const def = UNIT_DEFS[u.type];
    const dx = u.target.x - u.x, dz = u.target.z - u.z;
    const dist = Math.hypot(dx, dz);
    const step = def.speed * DT;
    if (dist < 0.05) { u.target = null; u.moving = false; return; }

    const want = Math.atan2(dz, dx);
    const diff = angleDiff(want, u.heading);
    const maxTurn = (def.turnRate * Math.PI / 180) * DT;
    u.heading = normAngle(u.heading + clamp(diff, -maxTurn, maxTurn));
    const remaining = Math.abs(angleDiff(want, u.heading));
    // Vehiculele se întorc pe loc dacă unghiul e mare, apoi accelerează; infanteria merge direct.
    const factor = def.role === "infantry" ? 1 : remaining > Math.PI / 4 ? 0 : Math.cos(remaining);
    if (factor <= 0) { u.moving = false; return; }

    const s = Math.min(step * factor, dist);
    const mx = (dx / dist) * s, mz = (dz / dist) * s;
    const m = this.map;
    if (isPassableWorld(m, u.x + mx, u.z + mz)) { u.x += mx; u.z += mz; }
    else if (Math.abs(mx) > 1e-4 && isPassableWorld(m, u.x + Math.sign(mx) * s, u.z)) u.x += Math.sign(mx) * s; // alunecă pe margine
    else if (Math.abs(mz) > 1e-4 && isPassableWorld(m, u.x, u.z + Math.sign(mz) * s)) u.z += Math.sign(mz) * s;
    else { u.target = null; u.moving = false; return; } // blocat — A* vine în S2
    u.moving = true;
    if (dist - s < 0.05) { u.x = u.target.x; u.z = u.target.z; u.target = null; }
  }

  /** Hash al stării — pentru teste de determinism / desincronizare în multiplayer. */
  stateHash(): number {
    let h = 2166136261 ^ this.tick;
    for (const u of this.units.values()) {
      for (const v of [u.id, Math.round(u.x * 1000), Math.round(u.z * 1000), Math.round(u.heading * 1000)]) {
        h ^= v;
        h = Math.imul(h, 16777619);
      }
    }
    return h >>> 0;
  }
}

/**
 * Sloturi de formație în jurul țintei: grilă cu pas = cel mai mare diametru, ordonată după
 * distanța de centru; doar sloturi trecibile. Fiecare unitate (cea mai depărtată alege prima)
 * ia slotul liber cel mai apropiat de poziția ei relativă în grup.
 */
export function formationSlots(m: GameMap, units: Unit[], tx: number, tz: number): { x: number; z: number }[] {
  if (units.length === 0) return [];
  if (units.length === 1) return [nearestPassable(m, tx, tz)];
  const spacing = Math.max(...units.map((u) => UNIT_DEFS[u.type].radius)) * 2 + 0.6;
  const cand: { x: number; z: number; d: number }[] = [];
  const R = Math.ceil(Math.sqrt(units.length)) + 3;
  for (let j = -R; j <= R; j++)
    for (let i = -R; i <= R; i++) {
      const x = tx + i * spacing, z = tz + j * spacing;
      if (!clearAround(m, x, z, spacing * 0.4)) continue;
      cand.push({ x, z, d: Math.hypot(i, j) + (j * 0.001 + i * 0.0001) });
    }
  cand.sort((a, b) => a.d - b.d);
  const slots = cand.slice(0, units.length);
  while (slots.length < units.length) slots.push(nearestPassable(m, tx, tz) as { x: number; z: number; d: number });

  // centrul grupului → păstrăm aranjamentul relativ
  const cx = units.reduce((s, u) => s + u.x, 0) / units.length;
  const cz = units.reduce((s, u) => s + u.z, 0) / units.length;
  const scx = slots.reduce((s, p) => s + p.x, 0) / slots.length;
  const scz = slots.reduce((s, p) => s + p.z, 0) / slots.length;
  const order = units.map((u, i) => ({ i, d: Math.hypot(u.x - cx, u.z - cz) })).sort((a, b) => b.d - a.d || a.i - b.i);
  const taken = new Array(slots.length).fill(false);
  const out: { x: number; z: number }[] = new Array(units.length);
  for (const { i } of order) {
    const rx = units[i].x - cx, rz = units[i].z - cz;
    let best = -1, bd = Infinity;
    slots.forEach((s, k) => {
      if (taken[k]) return;
      const d = Math.hypot(s.x - scx - rx, s.z - scz - rz);
      if (d < bd) { bd = d; best = k; }
    });
    taken[best] = true;
    out[i] = { x: slots[best].x, z: slots[best].z };
  }
  return out;
}

function clearAround(m: GameMap, x: number, z: number, r: number) {
  return isPassableWorld(m, x, z) && isPassableWorld(m, x + r, z) && isPassableWorld(m, x - r, z) && isPassableWorld(m, x, z + r) && isPassableWorld(m, x, z - r);
}

export function nearestPassable(m: GameMap, x: number, z: number): { x: number; z: number } {
  const [cx, cy] = worldToCell(m, x, z);
  if (isPassableCell(m, cx, cy)) return { x, z };
  for (let r = 1; r < 20; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = cx + dx, ny = cy + dy;
        if (inBounds(m, nx, ny) && isPassableCell(m, nx, ny)) return { x: (nx + 0.5) * m.cellSize, z: (ny + 0.5) * m.cellSize };
      }
  return { x, z };
}

export const normAngle = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const angleDiff = (a: number, b: number) => normAngle(a - b);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
