import scaleData from "../data/scale.json";
import { GameMap, ORE_MAX, Terrain, idx, inBounds, isPassableCell } from "../map/gameMap";
import type { Building, Command, Unit, UnitDef, World } from "./world";
import { BUILDING_DEFS, DT, UNIT_DEFS, nearestPassable } from "./world";

/**
 * Economie (S3): minereu + recoltoare, credite, energie, cozi de producție, plasarea clădirilor,
 * vânzare / reparare. Totul determinist și modificat doar prin comenzi (lockstep).
 */

export type Category = "structure" | "defense" | "infantry" | "vehicle";
export const CATEGORIES: Category[] = ["structure", "defense", "infantry", "vehicle"];

export const START_CREDITS = 5000;
/** credite / secundă cheltuite de o coadă (timpul de construcție = cost / BUILD_RATE) */
export const BUILD_RATE = 75;
export const MIN_BUILD_TIME = 3;
/** la energie insuficientă, producția merge cu jumătate de viteză */
export const LOW_POWER_FACTOR = 0.5;
export const MAX_UNIT_QUEUE = 15;
/** distanța maximă (celule) dintre o clădire nouă și una existentă */
export const BUILD_GAP = 6;
export const HARVEST_RATE = 125; // credite / s
export const UNLOAD_RATE = 400; // credite / s
export const SELL_REFUND = 0.5;
export const REPAIR_RATE = 0.03; // fracțiune din HP / s
export const REPAIR_COST = 0.5; // fracțiune din cost pentru 100% HP
const ORE_REGROW_TICKS = 300;
const ORE_REGROW_AMOUNT = 2;

export interface QueueItem {
  type: string;
  progress: number; // 0..1
  paid: number;
  ready: boolean;
}

export interface PlayerEco {
  credits: number;
  powerOut: number;
  powerUse: number;
  queues: Record<Category, QueueItem[]>;
  /** credite strânse în total (statistică) */
  harvested: number;
}

export type HarvMode = "idle" | "toOre" | "mining" | "toRef" | "unload";
export interface HarvState {
  mode: HarvMode;
  load: number;
  /** celula de minereu țintă (index) sau -1 */
  oreCell: number;
  /** ultima celulă recoltată — recoltorul se întoarce acolo */
  lastCell: number;
  refId: number;
  /** true = lucrează singur (caută minereu); false = a primit ordin manual de mișcare */
  auto: boolean;
  wait: number;
}

export function newEco(): PlayerEco {
  return { credits: START_CREDITS, powerOut: 0, powerUse: 0, queues: { structure: [], defense: [], infantry: [], vehicle: [] }, harvested: 0 };
}

export function newHarv(auto: boolean): HarvState {
  return { mode: "idle", load: 0, oreCell: -1, lastCell: -1, refId: 0, auto, wait: 0 };
}

export const buildingCells = (type: string) => (scaleData.buildings as Record<string, { cells: number }>)[BUILDING_DEFS[type].size].cells;
export const buildTime = (cost: number) => Math.max(MIN_BUILD_TIME, cost / BUILD_RATE);
export const isLowPower = (e: PlayerEco) => e.powerUse > e.powerOut;

export function categoryOf(item: string): Category | null {
  if (BUILDING_DEFS[item]) return BUILDING_DEFS[item].category as Category;
  const u = UNIT_DEFS[item];
  if (u) return u.producer === "barracks" ? "infantry" : "vehicle";
  return null;
}
export const costOf = (item: string) => (BUILDING_DEFS[item]?.cost ?? UNIT_DEFS[item]?.cost ?? 0);

const owns = (w: World, player: number, type: string) => {
  for (const b of w.buildings.values()) if (b.owner === player && b.type === type) return true;
  return false;
};

/** Ce poate construi jucătorul (lista pentru sidebar), cu motivul pentru care e indisponibil. */
export function availability(w: World, player: number, item: string): { ok: boolean; missing: string[] } {
  const faction = w.players[player].faction;
  const bdef = BUILDING_DEFS[item];
  const missing: string[] = [];
  if (bdef) {
    if (bdef.buildable === false) return { ok: false, missing: ["—"] };
    if (!owns(w, player, "conyard")) missing.push("conyard");
    for (const p of bdef.prereq ?? []) if (!owns(w, player, p)) missing.push(p);
  } else {
    const udef = UNIT_DEFS[item];
    if (!udef || udef.faction !== faction) return { ok: false, missing: ["—"] };
    if (!owns(w, player, udef.producer)) missing.push(udef.producer);
    for (const p of udef.prereq ?? []) if (!owns(w, player, p) && !missing.includes(p)) missing.push(p);
  }
  return { ok: missing.length === 0, missing };
}

/** Lista de articole pentru o categorie (în ordinea din JSON), pentru facțiunea jucătorului. */
export function itemsFor(w: World, player: number, cat: Category): string[] {
  const faction = w.players[player].faction;
  if (cat === "structure" || cat === "defense")
    return Object.keys(BUILDING_DEFS).filter((k) => BUILDING_DEFS[k].category === cat && BUILDING_DEFS[k].buildable !== false);
  return Object.keys(UNIT_DEFS).filter((k) => UNIT_DEFS[k].faction === faction && categoryOf(k) === cat);
}

// ─────────────────────────── comenzi ───────────────────────────

export function applyEcoCommand(w: World, cmd: Command): boolean {
  const e = w.eco[(cmd as { player: number }).player];
  if (!e) return false;
  switch (cmd.kind) {
    case "produce": {
      const cat = categoryOf(cmd.item);
      if (!cat || !availability(w, cmd.player, cmd.item).ok) return true;
      const q = e.queues[cat];
      if (cat === "structure" || cat === "defense") { if (q.length === 0) q.push({ type: cmd.item, progress: 0, paid: 0, ready: false }); }
      else if (q.length < MAX_UNIT_QUEUE) q.push({ type: cmd.item, progress: 0, paid: 0, ready: false });
      return true;
    }
    case "cancel": {
      const cat = categoryOf(cmd.item);
      if (!cat) return true;
      const q = e.queues[cat];
      // ultimul articol de acest tip (cel în lucru e scos ultimul)
      for (let i = q.length - 1; i >= 0; i--)
        if (q[i].type === cmd.item) { e.credits += q[i].paid; q.splice(i, 1); break; }
      return true;
    }
    case "place": {
      const cat = categoryOf(cmd.item);
      if (cat !== "structure" && cat !== "defense") return true;
      const q = e.queues[cat];
      if (!q.length || q[0].type !== cmd.item || !q[0].ready) return true;
      if (!canPlace(w, cmd.player, cmd.item, cmd.cx, cmd.cy)) return true;
      const b = w.placeBuilding(cmd.item, cmd.player, cmd.cx, cmd.cy);
      if (!b) return true;
      q.shift();
      w.events.push({ kind: "placed", player: cmd.player, id: b.id, type: b.type });
      const free = BUILDING_DEFS[b.type].freeUnit?.[b.faction];
      if (free) {
        const u = spawnFrom(w, b, free);
        if (u) w.events.push({ kind: "spawned", player: cmd.player, id: u.id, type: u.type });
      }
      return true;
    }
    case "rally": {
      const b = w.buildings.get(cmd.buildingId);
      if (b && b.owner === cmd.player) b.rally = { x: cmd.x, z: cmd.z };
      return true;
    }
    case "sell": {
      const b = w.buildings.get(cmd.buildingId);
      if (!b || b.owner !== cmd.player) return true;
      e.credits += Math.floor(BUILDING_DEFS[b.type].cost * SELL_REFUND * (b.hp / b.maxHp));
      w.removeBuilding(b);
      w.events.push({ kind: "sold", player: cmd.player, id: b.id, type: b.type });
      return true;
    }
    case "repair": {
      const b = w.buildings.get(cmd.buildingId);
      if (b && b.owner === cmd.player) b.repairing = !b.repairing && b.hp < b.maxHp;
      return true;
    }
    default:
      return false;
  }
}

// ─────────────────────────── tick ───────────────────────────

export function stepEconomy(w: World) {
  // energie (centralele avariate produc proporțional cu viața)
  for (const e of w.eco) { e.powerOut = 0; e.powerUse = 0; }
  for (const b of w.buildings.values()) {
    const p = BUILDING_DEFS[b.type].power ?? 0;
    const e = w.eco[b.owner];
    if (p > 0) e.powerOut += Math.round(p * (b.hp / b.maxHp));
    else e.powerUse -= p;
  }
  // reparații
  for (const b of w.buildings.values()) {
    if (!b.repairing) continue;
    const e = w.eco[b.owner];
    const heal = Math.min(b.maxHp - b.hp, b.maxHp * REPAIR_RATE * DT);
    const cost = (BUILDING_DEFS[b.type].cost * REPAIR_COST * heal) / b.maxHp;
    if (heal <= 0 || e.credits < cost) { b.repairing = false; continue; }
    e.credits -= cost;
    b.hp += heal;
    if (b.hp >= b.maxHp) { b.hp = b.maxHp; b.repairing = false; }
  }
  // producție
  w.eco.forEach((e, player) => {
    const speed = isLowPower(e) ? LOW_POWER_FACTOR : 1;
    for (const cat of CATEGORIES) {
      const q = e.queues[cat];
      const it = q[0];
      if (!it || it.ready) continue;
      // fără clădirea producătoare (distrusă) → coada stă pe loc
      if (!availability(w, player, it.type).ok) continue;
      const cost = costOf(it.type);
      const dp = (DT * speed) / buildTime(cost);
      const dpPay = Math.min(dp, 1 - it.progress);
      const pay = Math.min(cost - it.paid, cost * dpPay);
      if (e.credits < pay) continue; // „în așteptare” până vin bani
      e.credits -= pay;
      it.paid += pay;
      it.progress = Math.min(1, it.progress + dpPay);
      if (it.progress < 1 - 1e-9) continue;
      it.progress = 1;
      if (cat === "structure" || cat === "defense") {
        it.ready = true;
        w.events.push({ kind: "ready", player, type: it.type });
      } else {
        const producer = primaryProducer(w, player, UNIT_DEFS[it.type].producer);
        if (!producer) { it.progress = 0.999; continue; }
        q.shift();
        const u = spawnFrom(w, producer, it.type);
        if (u) w.events.push({ kind: "spawned", player, id: u.id, type: u.type });
      }
    }
  });
  // minereul crește încet înapoi (doar celulele neepuizate)
  if (w.tick % ORE_REGROW_TICKS === 0) {
    const m = w.map;
    for (let i = 0; i < m.ore.length; i++) if (m.ore[i] > 0 && m.ore[i] < ORE_MAX) m.ore[i] = Math.min(ORE_MAX, m.ore[i] + ORE_REGROW_AMOUNT);
  }
}

function primaryProducer(w: World, player: number, type: string): Building | null {
  let best: Building | null = null;
  for (const b of w.buildings.values()) if (b.owner === player && b.type === type && (!best || b.id < best.id)) best = b;
  return best;
}

/** Punctul din fața clădirii (ieșirea fabricii / docul rafinăriei). */
export function exitPoint(w: World, b: Building, extra = 1.5): { x: number; z: number } {
  const half = (b.cells * w.map.cellSize) / 2;
  const x = b.x + Math.cos(b.heading) * (half + extra);
  const z = b.z + Math.sin(b.heading) * (half + extra);
  return nearestPassable(w.map, x, z);
}

/** Unitate nouă la ieșirea clădirii; merge la punctul de adunare (sau puțin în față). */
export function spawnFrom(w: World, b: Building, type: string): Unit | null {
  const p = exitPoint(w, b, 1.2);
  const u = w.spawnUnit(type, b.owner, p.x, p.z, b.heading);
  if (UNIT_DEFS[type].capacity) {
    u.harv!.auto = true;
    u.harv!.mode = "toOre";
    return u;
  }
  const r = b.rally ?? { x: p.x + Math.cos(b.heading) * 6, z: p.z + Math.sin(b.heading) * 6 };
  w.moveUnits([u], r.x, r.z);
  return u;
}

// ─────────────────────────── plasare ───────────────────────────

export function canPlace(w: World, player: number, type: string, cx: number, cy: number): boolean {
  return placementCells(w, player, type, cx, cy).every((c) => c.ok);
}

/** Validitatea fiecărei celule din amprentă (pentru „fantoma” verde/roșie). */
export function placementCells(w: World, player: number, type: string, cx: number, cy: number): { x: number; y: number; ok: boolean }[] {
  const m = w.map;
  const n = buildingCells(type);
  const near = nearOwnBase(w, player, cx, cy, n);
  const cs = m.cellSize;
  const out: { x: number; y: number; ok: boolean }[] = [];
  for (let y = cy; y < cy + n; y++)
    for (let x = cx; x < cx + n; x++) {
      let ok = near && inBounds(m, x, y) && isPassableCell(m, x, y);
      if (ok) {
        const t = m.terrain[idx(m, x, y)];
        if (t === Terrain.Bridge || t === Terrain.Ore) ok = false;
      }
      if (ok)
        for (const u of w.units.values()) {
          const r = UNIT_DEFS[u.type].radius * 0.8;
          if (u.x + r > x * cs && u.x - r < (x + 1) * cs && u.z + r > y * cs && u.z - r < (y + 1) * cs) { ok = false; break; }
        }
      out.push({ x, y, ok });
    }
  return out;
}

function nearOwnBase(w: World, player: number, cx: number, cy: number, n: number): boolean {
  for (const b of w.buildings.values()) {
    if (b.owner !== player) continue;
    const gx = Math.max(0, b.cx - (cx + n), cx - (b.cx + b.cells));
    const gy = Math.max(0, b.cy - (cy + n), cy - (b.cy + b.cells));
    if (Math.max(gx, gy) <= BUILD_GAP) return true;
  }
  return false;
}

// ─────────────────────────── recoltor ───────────────────────────

export const isOreCell = (m: GameMap, i: number) => m.terrain[i] === Terrain.Ore && m.ore[i] > 0;

/** BFS pe celule trecibile de la (x,z) până la cea mai apropiată celulă cu minereu. */
export function findOre(m: GameMap, x: number, z: number, maxCells = 4000): number {
  const sx = Math.floor(x / m.cellSize), sy = Math.floor(z / m.cellSize);
  if (!inBounds(m, sx, sy)) return -1;
  const start = idx(m, sx, sy);
  if (isOreCell(m, start)) return start;
  const seen = new Uint8Array(m.width * m.height);
  const q = [start];
  seen[start] = 1;
  for (let h = 0; h < q.length && h < maxCells; h++) {
    const i = q[h];
    const cx = i % m.width, cy = (i / m.width) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBounds(m, nx, ny)) continue;
      const j = idx(m, nx, ny);
      if (seen[j]) continue;
      seen[j] = 1;
      if (isOreCell(m, j)) return j;
      if (isPassableCell(m, nx, ny)) q.push(j);
    }
  }
  return -1;
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

/** Ordin manual de mișcare pentru un recoltor: pe minereu → recoltează, pe rafinăria proprie → descarcă. */
export function harvesterOrder(w: World, u: Unit, x: number, z: number): boolean {
  const h = u.harv!;
  const m = w.map;
  const cx = Math.floor(x / m.cellSize), cy = Math.floor(z / m.cellSize);
  const ref = [...w.buildings.values()].find((b) => b.owner === u.owner && b.type === "refinery" && cx >= b.cx && cx < b.cx + b.cells && cy >= b.cy && cy < b.cy + b.cells);
  releaseDock(w, u);
  if (ref) { h.auto = true; h.mode = "toRef"; h.refId = ref.id; u.target = null; u.path = []; return true; }
  if (inBounds(m, cx, cy) && isOreCell(m, idx(m, cx, cy))) {
    h.auto = true; h.mode = "toOre"; h.oreCell = idx(m, cx, cy);
    goToCell(w, u, h.oreCell);
    return true;
  }
  h.auto = false; h.mode = "idle";
  return false;
}

const cellPos = (m: GameMap, i: number) => ({ x: ((i % m.width) + 0.5) * m.cellSize, z: (((i / m.width) | 0) + 0.5) * m.cellSize });

function goToCell(w: World, u: Unit, i: number) {
  const m = w.map;
  w.setDestination(u, ((i % m.width) + 0.5) * m.cellSize, (((i / m.width) | 0) + 0.5) * m.cellSize);
}

export function releaseDock(w: World, u: Unit) {
  for (const b of w.buildings.values()) if (b.dockId === u.id) b.dockId = 0;
}

function nearestRefinery(w: World, u: Unit): Building | null {
  let best: Building | null = null, bd = Infinity;
  for (const b of w.buildings.values()) {
    if (b.owner !== u.owner || b.type !== "refinery") continue;
    const d = Math.hypot(b.x - u.x, b.z - u.z) + (b.dockId && b.dockId !== u.id ? 20 : 0);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

export function thinkHarvester(w: World, u: Unit, def: UnitDef) {
  const h = u.harv!;
  const m = w.map;
  const cap = def.capacity!;
  if (h.wait > 0) h.wait -= DT;

  switch (h.mode) {
    case "idle":
      if (h.auto && h.wait <= 0) { h.mode = h.load >= cap ? "toRef" : "toOre"; h.oreCell = -1; }
      break;

    case "toOre": {
      if (h.oreCell < 0 || !isOreCell(m, h.oreCell)) {
        const from = h.lastCell >= 0 ? cellPos(m, h.lastCell) : u;
        h.oreCell = findOre(m, from.x, from.z);
        if (h.oreCell < 0) h.oreCell = findOre(m, u.x, u.z);
        if (h.oreCell < 0) { h.mode = h.load > 0 ? "toRef" : "idle"; h.wait = 3; break; }
        u.target = null;
      }
      const o = cellPos(m, h.oreCell);
      if (Math.hypot(u.x - o.x, u.z - o.z) < m.cellSize * 0.9) { h.mode = "mining"; u.target = null; u.path = []; u.moving = false; break; }
      if (!u.target) {
        // a ajuns cât de aproape a putut (altă unitate pe celulă): recoltează de pe celula curentă dacă are minereu
        const here = idx(m, Math.floor(u.x / m.cellSize), Math.floor(u.z / m.cellSize));
        if (h.wait > 0 && h.wait < 0.9 && isOreCell(m, here)) { h.oreCell = here; h.mode = "mining"; break; }
        if (h.wait <= 0) {
          goToCell(w, u, h.oreCell);
          h.wait = 1;
          if (!u.target) { h.oreCell = -1; h.mode = "idle"; h.wait = 3; }
        }
      }
      break;
    }

    case "mining": {
      u.moving = false;
      if (!isOreCell(m, h.oreCell)) { h.mode = h.load >= cap ? "toRef" : "toOre"; h.lastCell = h.oreCell; h.oreCell = -1; break; }
      const take = Math.min(Math.round(HARVEST_RATE * DT), m.ore[h.oreCell], Math.ceil(cap - h.load));
      m.ore[h.oreCell] -= take;
      h.load += take;
      h.lastCell = h.oreCell;
      if (h.load >= cap - 1e-6) { h.load = cap; h.mode = "toRef"; h.refId = 0; }
      break;
    }

    case "toRef": {
      let ref = h.refId ? w.buildings.get(h.refId) : undefined;
      if (!ref || ref.owner !== u.owner) { ref = nearestRefinery(w, u) ?? undefined; h.refId = ref?.id ?? 0; }
      if (!ref) { h.mode = "idle"; h.wait = 3; break; }
      const dock = exitPoint(w, ref);
      const d = Math.hypot(u.x - dock.x, u.z - dock.z);
      if (d < 2.6) {
        if (ref.dockId && ref.dockId !== u.id && w.units.has(ref.dockId)) { u.target = null; u.path = []; u.moving = false; break; } // așteaptă la rând
        ref.dockId = u.id;
        h.mode = "unload";
        u.target = null; u.path = []; u.moving = false;
        break;
      }
      if (!u.target || Math.hypot(u.target.x - dock.x, u.target.z - dock.z) > 0.5) {
        if (h.wait <= 0) { w.setDestination(u, dock.x, dock.z); h.wait = 2; }
      }
      break;
    }

    case "unload": {
      u.moving = false;
      const ref = w.buildings.get(h.refId);
      if (!ref) { h.mode = "toRef"; h.refId = 0; break; }
      // întoarce spatele spre rafinărie (direcția opusă ieșirii)
      const amt = Math.min(UNLOAD_RATE * DT, h.load);
      h.load -= amt;
      w.eco[u.owner].credits += amt;
      w.eco[u.owner].harvested += amt;
      if (h.load <= 1e-6) {
        h.load = 0;
        ref.dockId = 0;
        h.mode = "toOre";
        h.oreCell = -1;
      }
      break;
    }
  }
}
