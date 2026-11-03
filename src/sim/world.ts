import unitsData from "../data/units.json";
import buildingsData from "../data/buildings.json";
import scaleData from "../data/scale.json";
import weaponsData from "../data/weapons.json";
import { GameMap, inBounds, idx, isPassableCell, isPassableWorld, worldToCell } from "../map/gameMap";
import { makeRng, Rng } from "../map/rng";
import { PathFinder } from "./pathfinding";
import { HarvState, PlayerEco, applyEcoCommand, harvesterOrder, isLowPower, newEco, newHarv, releaseDock, stepEconomy, thinkHarvester } from "./economy";

export const TICK_RATE = 15;
export const DT = 1 / TICK_RATE;

export type UnitTypeId = keyof typeof unitsData;
export type BuildingTypeId = keyof typeof buildingsData;
export type ArmorType = "infantry" | "light" | "heavy" | "building";

export interface UnitDef {
  faction: string;
  name: string;
  role: string;
  model: string;
  scale: string;
  speed: number;
  turnRate: number;
  radius: number;
  hp: number;
  armor: ArmorType;
  weapon?: string;
  sight: number;
  cost: number;
  /** clădirea care o produce: barracks | factory */
  producer: string;
  prereq?: string[];
  /** recoltor: capacitatea (credite) */
  capacity?: number;
}
export interface BuildingDef {
  name: string;
  size: string;
  hp: number;
  weapon?: string;
  sight?: number;
  models: Record<string, string[]>;
  cost: number;
  /** + produce, − consumă */
  power: number;
  category: "structure" | "defense";
  prereq?: string[];
  buildable?: boolean;
  /** unitate gratuită la plasare (rafinăria → recoltor), per facțiune */
  freeUnit?: Record<string, string>;
  produces?: "infantry" | "vehicle";
  /** nu trage la energie insuficientă */
  needsPower?: boolean;
  /** modelul se rotește spre țintă (turelă) */
  rotates?: boolean;
}
export interface WeaponDef {
  name: string;
  damage: number;
  type: string;
  range: number;
  minRange?: number;
  cooldown: number;
  projectile: "bullet" | "shell" | "arc" | "rocket";
  speed: number;
  /** [distanța în față, înălțimea] gurii țevii, în metri */
  muzzle: [number, number];
  splash?: number;
  burst?: number;
  burstDelay?: number;
  scatter?: number;
  /** trage în punctul de pe sol (poate rata ținte mobile), nu urmărește ținta */
  groundTarget?: boolean;
}
export const UNIT_DEFS = unitsData as unknown as Record<string, UnitDef>;
export const BUILDING_DEFS = buildingsData as unknown as Record<string, BuildingDef>;
export const WEAPONS = weaponsData.weapons as unknown as Record<string, WeaponDef>;
export const VERSUS = weaponsData.versus as Record<string, Record<ArmorType, number>>;

export interface Unit {
  kind: "unit";
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
  /** destinația finală a ordinului de mișcare */
  target: { x: number; z: number } | null;
  path: { x: number; z: number }[];
  hp: number;
  maxHp: number;
  /** ținta de atac (unitate sau clădire) */
  attackId: number;
  /** true = ordin explicit (urmărește ținta); false = țintă găsită singură (nu o urmărește) */
  attackOrdered: boolean;
  cooldown: number;
  burstLeft: number;
  burstTimer: number;
  /** pentru repath / detectarea blocajelor */
  stuckTicks: number;
  repathTimer: number;
  scanTimer: number;
  lastAttacker: number;
  /** doar recoltoarele */
  harv: HarvState | null;
}

export interface Building {
  kind: "building";
  id: number;
  type: string;
  owner: number;
  faction: string;
  cx: number; // colțul celulei stânga-jos
  cy: number;
  cells: number;
  x: number; // centrul în metri
  z: number;
  heading: number;
  hp: number;
  maxHp: number;
  attackId: number;
  cooldown: number;
  burstLeft: number;
  burstTimer: number;
  scanTimer: number;
  /** punctul de adunare al unităților produse */
  rally: { x: number; z: number } | null;
  /** rafinărie: recoltorul care descarcă acum */
  dockId: number;
  repairing: boolean;
  /** tick-ul plasării (pentru animația de construcție) */
  bornTick: number;
}

export type Entity = Unit | Building;

export interface Projectile {
  id: number;
  owner: number;
  weapon: string;
  sourceId: number;
  targetId: number;
  x: number; y: number; z: number;
  prevX: number; prevY: number; prevZ: number;
  sx: number; sy: number; sz: number; // start
  tx: number; tz: number; // țintă (sol)
  t: number; // 0..1
  dur: number; // secunde
}

/** Evenimente pentru randare (efecte); golite de renderer. */
export type SimEvent =
  | { kind: "fire"; weapon: string; x: number; y: number; z: number; heading: number; sourceId: number }
  | { kind: "impact"; weapon: string; x: number; z: number; splash: number }
  | { kind: "death"; id: number; entity: "unit" | "building"; type: string; x: number; z: number; size: number }
  | { kind: "ready"; player: number; type: string }
  | { kind: "spawned"; player: number; id: number; type: string }
  | { kind: "placed"; player: number; id: number; type: string }
  | { kind: "sold"; player: number; id: number; type: string };

export interface Player {
  index: number;
  faction: string;
  name: string;
}

/** Comenzile sunt singura cale de a modifica lumea — pregătit pentru lockstep (S8). */
export type Command =
  | { kind: "move"; player: number; unitIds: number[]; x: number; z: number }
  | { kind: "attack"; player: number; unitIds: number[]; targetId: number }
  | { kind: "stop"; player: number; unitIds: number[] }
  | { kind: "produce"; player: number; item: string }
  | { kind: "cancel"; player: number; item: string }
  | { kind: "place"; player: number; item: string; cx: number; cy: number }
  | { kind: "rally"; player: number; buildingId: number; x: number; z: number }
  | { kind: "sell"; player: number; buildingId: number }
  | { kind: "repair"; player: number; buildingId: number };

const BIG_RADIUS = 1.2;

export class World {
  tick = 0;
  units = new Map<number, Unit>();
  buildings = new Map<number, Building>();
  projectiles = new Map<number, Projectile>();
  events: SimEvent[] = [];
  /** economia fiecărui jucător (credite, energie, cozi) */
  eco: PlayerEco[];
  readonly paths: PathFinder;
  private rng: Rng;
  private nextId = 1;
  private pending: Command[] = [];

  constructor(public map: GameMap, public players: Player[], seed = 7) {
    this.paths = new PathFinder(map);
    this.rng = makeRng(seed);
    this.eco = players.map(() => newEco());
  }

  entity(id: number): Entity | undefined {
    return this.units.get(id) ?? this.buildings.get(id);
  }

  spawnUnit(type: string, owner: number, x: number, z: number, heading = 0): Unit {
    const def = UNIT_DEFS[type];
    if (!def) throw new Error(`Tip de unitate necunoscut: ${type}`);
    const u: Unit = {
      kind: "unit",
      id: this.nextId++,
      type,
      owner,
      faction: this.players[owner].faction,
      x, z, heading,
      prevX: x, prevZ: z, prevHeading: heading,
      moving: false,
      target: null,
      path: [],
      hp: def.hp,
      maxHp: def.hp,
      attackId: 0,
      attackOrdered: false,
      cooldown: 0,
      burstLeft: 0,
      burstTimer: 0,
      stuckTicks: 0,
      repathTimer: 0,
      scanTimer: u32(this.nextId) % 5,
      lastAttacker: 0,
      harv: def.capacity ? newHarv(false) : null,
    };
    this.units.set(u.id, u);
    return u;
  }

  /** Clădire statică. Întoarce null dacă locul nu e liber. */
  placeBuilding(type: string, owner: number, cx: number, cy: number): Building | null {
    const def = BUILDING_DEFS[type];
    const cells = (scaleData.buildings as Record<string, { cells: number }>)[def.size].cells;
    for (let y = cy; y < cy + cells; y++)
      for (let x = cx; x < cx + cells; x++) if (!isPassableCell(this.map, x, y)) return null;
    for (let y = cy; y < cy + cells; y++) for (let x = cx; x < cx + cells; x++) this.map.blocked[idx(this.map, x, y)] = 2;
    this.paths.invalidate();
    const cs = this.map.cellSize;
    const b: Building = {
      kind: "building",
      id: this.nextId++, type, owner, faction: this.players[owner].faction, cx, cy, cells,
      x: (cx + cells / 2) * cs, z: (cy + cells / 2) * cs,
      heading: owner === 0 ? 0 : Math.PI,
      hp: def.hp, maxHp: def.hp,
      attackId: 0, cooldown: 0, burstLeft: 0, burstTimer: 0, scanTimer: 0,
      rally: null, dockId: 0, repairing: false, bornTick: this.tick,
    };
    this.buildings.set(b.id, b);
    return b;
  }

  issue(cmd: Command) {
    this.pending.push(cmd);
  }

  step() {
    this.events.length = 0;
    for (const cmd of this.pending) this.apply(cmd);
    this.pending.length = 0;
    stepEconomy(this);
    for (const u of this.units.values()) {
      u.prevX = u.x;
      u.prevZ = u.z;
      u.prevHeading = u.heading;
    }
    for (const u of this.units.values()) this.thinkUnit(u);
    this.separate();
    for (const b of this.buildings.values()) if (BUILDING_DEFS[b.type].weapon) this.thinkBuilding(b);
    this.stepProjectiles();
    this.tick++;
  }

  // ─────────────────────────── comenzi ───────────────────────────

  private apply(cmd: Command) {
    if (applyEcoCommand(this, cmd)) return;
    if (cmd.kind !== "move" && cmd.kind !== "attack" && cmd.kind !== "stop") return;
    const units = cmd.unitIds.map((id) => this.units.get(id)).filter((u): u is Unit => !!u && u.owner === cmd.player);
    if (cmd.kind === "stop") {
      for (const u of units) {
        u.target = null; u.path = []; u.moving = false; u.attackId = 0; u.attackOrdered = false;
        if (u.harv) { releaseDock(this, u); u.harv.auto = false; u.harv.mode = "idle"; }
      }
      return;
    }
    if (cmd.kind === "attack") {
      const t = this.entity(cmd.targetId);
      if (!t || t.owner === cmd.player) return;
      // unitățile neînarmate (recoltorul) ignoră ordinul de atac
      for (const u of units) if (UNIT_DEFS[u.type].weapon) { u.attackId = t.id; u.attackOrdered = true; u.target = null; u.path = []; u.repathTimer = 0; }
      return;
    }
    for (const u of units) { u.attackId = 0; u.attackOrdered = false; }
    // recoltoarele: pe minereu → recoltează, pe rafinăria proprie → descarcă
    const rest = units.filter((u) => !(u.harv && harvesterOrder(this, u, cmd.x, cmd.z)));
    this.moveUnits(rest, cmd.x, cmd.z);
  }

  /** Mișcare în formație (folosit și pentru unitățile produse). */
  moveUnits(units: Unit[], x: number, z: number) {
    const slots = formationSlots(this.map, units, x, z);
    units.forEach((u, i) => this.setDestination(u, slots[i].x, slots[i].z));
  }

  setDestination(u: Unit, x: number, z: number) {
    const big = UNIT_DEFS[u.type].radius > BIG_RADIUS;
    u.target = { x, z };
    u.path = this.paths.find(u.x, u.z, x, z, big);
    if (!u.path.length) u.target = null;
    u.stuckTicks = 0;
  }

  // ─────────────────────────── unități ───────────────────────────

  private thinkUnit(u: Unit) {
    const def = UNIT_DEFS[u.type];
    if (u.harv) {
      if (u.harv.auto) thinkHarvester(this, u, def);
      this.followPath(u, def);
      return;
    }
    const wdef = def.weapon ? WEAPONS[def.weapon] : null;
    if (u.cooldown > 0) u.cooldown -= DT;
    if (wdef && u.burstLeft > 0) this.continueBurst(u, wdef);

    if (wdef) {
      // validează ținta
      let t = u.attackId ? this.entity(u.attackId) : undefined;
      if (u.attackId && (!t || t.owner === u.owner)) { u.attackId = 0; u.attackOrdered = false; t = undefined; }
      // ținta găsită singură: renunță dacă iese din rază (nu o urmărim)
      if (t && !u.attackOrdered && this.rangeTo(u, t) > wdef.range + 1) { u.attackId = 0; t = undefined; }
      // fără ordin de mișcare și fără țintă → caută (și ripostează)
      if (!t && !u.target && --u.scanTimer <= 0) {
        u.scanTimer = 5;
        const found = this.findTarget(u, wdef.range, wdef.minRange ?? 0);
        if (found) { u.attackId = found.id; u.attackOrdered = false; t = found; }
        else if (u.lastAttacker) {
          const a = this.entity(u.lastAttacker);
          if (a && a.owner !== u.owner && dist(u, a) <= def.sight + 6) { u.attackId = a.id; u.attackOrdered = true; t = a; }
          u.lastAttacker = 0;
        }
      }
      if (t) { this.engage(u, def, wdef, t); return; }
    }
    this.followPath(u, def);
  }

  private engage(u: Unit, def: UnitDef, w: WeaponDef, t: Entity) {
    const r = this.rangeTo(u, t);
    const minR = w.minRange ?? 0;
    if (r <= w.range && dist(u, t) >= minR) {
      // în rază: oprește-te, întoarce-te spre țintă, trage când e aliniat
      u.target = null; u.path = []; u.moving = false;
      const want = Math.atan2(t.z - u.z, t.x - u.x);
      const aligned = this.turnToward(u, def, want);
      if (aligned && u.cooldown <= 0 && u.burstLeft === 0) this.fire(u, w, t);
      return;
    }
    if (!(u as Unit).attackOrdered) { u.attackId = 0; return; }
    // prea aproape pentru artilerie → nu poate trage (stă pe loc)
    if (r <= w.range) { u.moving = false; return; }
    // urmărește ținta: recalculează calea periodic
    if (--u.repathTimer <= 0 || !u.path.length) {
      u.repathTimer = 15;
      const big = def.radius > BIG_RADIUS;
      u.path = this.paths.find(u.x, u.z, t.x, t.z, big);
      u.target = { x: t.x, z: t.z };
    }
    this.followPath(u, def, true);
  }

  /** Întoarce unitatea spre unghiul dorit; true dacă e suficient de aliniată ca să tragă. */
  private turnToward(u: Unit, def: UnitDef, want: number): boolean {
    const diff = angleDiff(want, u.heading);
    const maxTurn = (def.turnRate * Math.PI / 180) * DT;
    u.heading = normAngle(u.heading + clamp(diff, -maxTurn, maxTurn));
    return Math.abs(angleDiff(want, u.heading)) < 0.2;
  }

  private followPath(u: Unit, def: UnitDef, chasing = false) {
    if (!u.target || !u.path.length) { u.moving = false; u.target = chasing ? u.target : null; return; }
    let wp = u.path[0];
    const isLast = u.path.length === 1;
    let dx = wp.x - u.x, dz = wp.z - u.z;
    let d = Math.hypot(dx, dz);
    const reach = isLast ? 0.05 : Math.max(0.6, def.radius * 0.6);
    if (d < reach) {
      u.path.shift();
      if (!u.path.length) {
        if (isLast && !chasing) { u.x = wp.x; u.z = wp.z; }
        if (!chasing) u.target = null;
        u.moving = false;
        return;
      }
      wp = u.path[0];
      dx = wp.x - u.x; dz = wp.z - u.z; d = Math.hypot(dx, dz);
    }
    const want = Math.atan2(dz, dx);
    const diff = angleDiff(want, u.heading);
    const maxTurn = (def.turnRate * Math.PI / 180) * DT;
    u.heading = normAngle(u.heading + clamp(diff, -maxTurn, maxTurn));
    const remaining = Math.abs(angleDiff(want, u.heading));
    // Vehiculele se întorc pe loc dacă unghiul e mare, apoi accelerează; infanteria merge direct.
    const factor = def.role === "infantry" ? 1 : remaining > Math.PI / 4 ? 0 : Math.cos(remaining);
    if (factor <= 0) { u.moving = false; return; }

    const s = Math.min(def.speed * DT * factor, d);
    const mx = (dx / d) * s, mz = (dz / d) * s;
    const ox = u.x, oz = u.z;
    this.tryMove(u, mx, mz);
    u.moving = true;

    // blocaj (de alte unități): dacă aproape nu avansăm, recalculăm calea; lângă destinație acceptăm sosirea
    const progressed = Math.hypot(u.x - ox, u.z - oz);
    if (progressed < s * 0.25) u.stuckTicks++;
    else if (u.stuckTicks > 0) u.stuckTicks--;
    if (u.stuckTicks > 20) {
      u.stuckTicks = 0;
      const final = u.path[u.path.length - 1];
      if (!chasing && Math.hypot(final.x - u.x, final.z - u.z) < def.radius * 3 + 2) { u.path = []; u.target = null; u.moving = false; return; }
      const big = def.radius > BIG_RADIUS;
      u.path = this.paths.find(u.x, u.z, final.x, final.z, big);
    }
  }

  /** Mișcare cu alunecare pe marginea obstacolelor statice. */
  private tryMove(u: Unit, mx: number, mz: number): boolean {
    const m = this.map;
    if (isPassableWorld(m, u.x + mx, u.z + mz)) { u.x += mx; u.z += mz; return true; }
    if (Math.abs(mx) > 1e-4 && isPassableWorld(m, u.x + mx, u.z)) { u.x += mx; return true; }
    if (Math.abs(mz) > 1e-4 && isPassableWorld(m, u.x, u.z + mz)) { u.z += mz; return true; }
    return false;
  }

  /**
   * Separare cerc-cerc între unități. Unitatea care stă pe loc se dă la o parte (ia cea mai mare parte
   * din împingere); două unități în mers se împing egal, deci se ocolesc.
   */
  private separate() {
    const list = [...this.units.values()];
    const n = list.length;
    // grilă spațială simplă (celule de 6 m)
    const G = 6;
    const buckets = new Map<number, number[]>();
    const key = (gx: number, gz: number) => gz * 1024 + gx;
    for (let i = 0; i < n; i++) {
      const k = key(Math.floor(list[i].x / G), Math.floor(list[i].z / G));
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(i);
    }
    const pushX = new Float64Array(n), pushZ = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = list[i];
      const gx = Math.floor(a.x / G), gz = Math.floor(a.z / G);
      const ra = UNIT_DEFS[a.type].radius;
      for (let oz = -1; oz <= 1; oz++)
        for (let ox = -1; ox <= 1; ox++) {
          const b = buckets.get(key(gx + ox, gz + oz));
          if (!b) continue;
          for (const j of b) {
            if (j <= i) continue;
            const c = list[j];
            const rb = UNIT_DEFS[c.type].radius;
            let dx = c.x - a.x, dz = c.z - a.z;
            let d = Math.hypot(dx, dz);
            const minD = (ra + rb) * 0.9;
            if (d >= minD) continue;
            if (d < 1e-4) { const ang = ((a.id * 7 + c.id * 13) % 628) / 100; dx = Math.cos(ang); dz = Math.sin(ang); d = 1; }
            const overlap = Math.min(minD - d, 0.6) * 0.5; // corecție blândă pe tick
            const nx = dx / d, nz = dz / d;
            // cine stă pe loc se dă la o parte; vehiculele mari sunt greu de împins de infanterie
            const aStill = !a.moving, cStill = !c.moving;
            let wa = 0.5, wc = 0.5;
            if (aStill && !cStill) { wa = 0.85; wc = 0.15; }
            else if (!aStill && cStill) { wa = 0.15; wc = 0.85; }
            const ma = ra * ra, mc = rb * rb;
            wa *= (2 * mc) / (ma + mc); wc *= (2 * ma) / (ma + mc);
            const sum = wa + wc;
            wa /= sum; wc /= sum;
            pushX[i] -= nx * overlap * 2 * wa; pushZ[i] -= nz * overlap * 2 * wa;
            pushX[j] += nx * overlap * 2 * wc; pushZ[j] += nz * overlap * 2 * wc;
            // cele în mers alunecă lateral (se ocolesc) în loc să se împingă frontal
            if (!aStill && !cStill) {
              const side = a.id < c.id ? 1 : -1;
              pushX[i] += -nz * 0.08 * side; pushZ[i] += nx * 0.08 * side;
              pushX[j] -= -nz * 0.08 * side; pushZ[j] -= nx * 0.08 * side;
            }
          }
        }
    }
    for (let i = 0; i < n; i++) {
      if (pushX[i] === 0 && pushZ[i] === 0) continue;
      this.tryMove(list[i], pushX[i], pushZ[i]);
    }
  }

  // ─────────────────────────── clădiri ───────────────────────────

  private thinkBuilding(b: Building) {
    const def = BUILDING_DEFS[b.type];
    const w = WEAPONS[def.weapon!];
    if (b.cooldown > 0) b.cooldown -= DT;
    if (b.burstLeft > 0) this.continueBurst(b, w);
    let t = b.attackId ? this.entity(b.attackId) : undefined;
    if (t && this.rangeTo(b, t) > w.range) t = undefined;
    if (!t) {
      b.attackId = 0;
      if (--b.scanTimer <= 0) {
        b.scanTimer = 5;
        const f = this.findTarget(b, w.range, w.minRange ?? 0);
        if (f) { b.attackId = f.id; t = f; }
      }
    }
    if (!t) return;
    b.heading = Math.atan2(t.z - b.z, t.x - b.x);
    if (def.needsPower && isLowPower(this.eco[b.owner])) return; // fără energie: urmărește ținta, dar nu trage
    if (b.cooldown <= 0 && b.burstLeft === 0) this.fire(b, w, t);
  }

  // ─────────────────────────── luptă ───────────────────────────

  private findTarget(s: Entity, range: number, minRange: number): Entity | null {
    let best: Entity | null = null, bd = Infinity;
    const consider = (e: Entity) => {
      if (e.owner === s.owner) return;
      const d = this.rangeTo(s, e);
      if (d > range || dist(s, e) < minRange) return;
      // preferă unitățile înarmate și pe cele apropiate
      const armed = e.kind === "unit" ? !!UNIT_DEFS[e.type].weapon : !!BUILDING_DEFS[e.type].weapon;
      const score = d - (armed ? 6 : 0);
      if (score < bd || (score === bd && best && e.id < best.id)) { bd = score; best = e; }
    };
    for (const u of this.units.values()) consider(u);
    for (const b of this.buildings.values()) consider(b);
    return best;
  }

  /** Distanța de la centrul sursei la marginea țintei. */
  rangeTo(s: Entity, t: Entity): number {
    return Math.max(0, dist(s, t) - entityRadius(t, this.map.cellSize));
  }

  private fire(s: Entity, w: WeaponDef, t: Entity) {
    s.cooldown = w.cooldown;
    s.attackId = t.id;
    s.burstLeft = (w.burst ?? 1);
    s.burstTimer = 0;
    this.continueBurst(s, w);
  }

  private continueBurst(s: Entity, w: WeaponDef) {
    if (s.burstTimer > 0) { s.burstTimer -= DT; return; }
    const t = this.entity(s.attackId);
    if (!t) { s.burstLeft = 0; return; }
    const shotIdx = (w.burst ?? 1) - s.burstLeft;
    s.burstLeft--;
    s.burstTimer = (w.burstDelay ?? 0) - 1e-6;
    const h = s.heading;
    const side = (w.burst ?? 1) > 1 ? (shotIdx % 2 === 0 ? 0.35 : -0.35) : 0;
    const mx = s.x + Math.cos(h) * w.muzzle[0] - Math.sin(h) * side;
    const mz = s.z + Math.sin(h) * w.muzzle[0] + Math.cos(h) * side;
    const my = w.muzzle[1];
    let tx = t.x, tz = t.z;
    if (w.scatter) { tx += this.rng.range(-w.scatter, w.scatter); tz += this.rng.range(-w.scatter, w.scatter); }
    const d = Math.hypot(tx - mx, tz - mz);
    const dur = Math.max(DT, d / w.speed) + (w.projectile === "arc" ? 0.4 : 0);
    const p: Projectile = {
      id: this.nextId++, owner: s.owner, weapon: weaponIdOf(w), sourceId: s.id, targetId: t.id,
      x: mx, y: my, z: mz, prevX: mx, prevY: my, prevZ: mz, sx: mx, sy: my, sz: mz, tx, tz, t: 0, dur,
    };
    this.projectiles.set(p.id, p);
    this.events.push({ kind: "fire", weapon: p.weapon, x: mx, y: my, z: mz, heading: h, sourceId: s.id });
  }

  private stepProjectiles() {
    for (const p of [...this.projectiles.values()]) {
      const w = WEAPONS[p.weapon];
      p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
      // proiectilele directe urmăresc ținta (lovesc sigur); cele „pe sol” zboară spre punctul inițial
      if (!w.groundTarget) {
        const t = this.entity(p.targetId);
        if (t) { p.tx = t.x; p.tz = t.z; }
      }
      p.t = Math.min(1, p.t + DT / p.dur);
      const k = p.t;
      p.x = p.sx + (p.tx - p.sx) * k;
      p.z = p.sz + (p.tz - p.sz) * k;
      const groundY = 0.9;
      p.y = p.sy + (groundY - p.sy) * k;
      if (w.projectile === "arc") p.y += Math.sin(Math.PI * k) * Math.max(6, Math.hypot(p.tx - p.sx, p.tz - p.sz) * 0.35);
      else if (w.projectile === "rocket") p.y += Math.sin(Math.PI * k) * Math.max(3, Math.hypot(p.tx - p.sx, p.tz - p.sz) * 0.18);
      if (p.t >= 1) {
        this.projectiles.delete(p.id);
        this.impact(p, w);
      }
    }
  }

  private impact(p: Projectile, w: WeaponDef) {
    this.events.push({ kind: "impact", weapon: p.weapon, x: p.tx, z: p.tz, splash: w.splash ?? 0 });
    if (w.splash) {
      // explozie: lovește inamicii din rază, cu scădere spre margine
      const victims: Entity[] = [];
      for (const u of this.units.values()) if (u.owner !== p.owner && Math.hypot(u.x - p.tx, u.z - p.tz) - UNIT_DEFS[u.type].radius <= w.splash) victims.push(u);
      for (const b of this.buildings.values()) if (b.owner !== p.owner && Math.hypot(b.x - p.tx, b.z - p.tz) - entityRadius(b, this.map.cellSize) <= w.splash) victims.push(b);
      for (const v of victims) {
        const r = v.kind === "unit" ? UNIT_DEFS[v.type].radius : entityRadius(v, this.map.cellSize);
        const d = Math.max(0, Math.hypot(v.x - p.tx, v.z - p.tz) - r);
        const fall = 1 - 0.5 * Math.min(1, d / w.splash);
        this.damage(v, w.damage * fall, w.type, p.sourceId);
      }
    } else {
      const t = this.entity(p.targetId);
      if (t && t.owner !== p.owner) this.damage(t, w.damage, w.type, p.sourceId);
    }
  }

  damage(e: Entity, amount: number, type: string, sourceId: number) {
    const armor: ArmorType = e.kind === "unit" ? UNIT_DEFS[e.type].armor : "building";
    const mult = VERSUS[type]?.[armor] ?? 1;
    e.hp -= amount * mult;
    if (e.kind === "unit" && sourceId) e.lastAttacker = sourceId;
    if (e.hp <= 0) this.kill(e);
  }

  private kill(e: Entity) {
    e.hp = 0;
    if (e.kind === "unit") {
      this.units.delete(e.id);
      if (e.harv) releaseDock(this, e);
      this.events.push({ kind: "death", id: e.id, entity: "unit", type: e.type, x: e.x, z: e.z, size: UNIT_DEFS[e.type].radius });
    } else {
      this.removeBuilding(e);
      this.events.push({ kind: "death", id: e.id, entity: "building", type: e.type, x: e.x, z: e.z, size: e.cells * this.map.cellSize * 0.5 });
    }
  }

  /** Scoate clădirea din lume (distrusă sau vândută) și eliberează celulele. */
  removeBuilding(b: Building) {
    this.buildings.delete(b.id);
    for (let y = b.cy; y < b.cy + b.cells; y++) for (let x = b.cx; x < b.cx + b.cells; x++) this.map.blocked[idx(this.map, x, y)] = 0;
    this.paths.invalidate();
  }

  /** Hash al stării — pentru teste de determinism / desincronizare în multiplayer. */
  stateHash(): number {
    let h = 2166136261 ^ this.tick;
    const mix = (v: number) => { h ^= v; h = Math.imul(h, 16777619); };
    for (const u of this.units.values())
      for (const v of [u.id, Math.round(u.x * 1000), Math.round(u.z * 1000), Math.round(u.heading * 1000), Math.round(u.hp * 100), u.attackId]) mix(v);
    for (const b of this.buildings.values()) { mix(b.id); mix(Math.round(b.hp * 100)); }
    for (const p of this.projectiles.values()) { mix(p.id); mix(Math.round(p.x * 1000)); mix(Math.round(p.z * 1000)); }
    for (const e of this.eco) { mix(Math.round(e.credits * 100)); for (const q of Object.values(e.queues)) for (const it of q) mix(Math.round(it.progress * 1e6)); }
    return h >>> 0;
  }
}

export function entityRadius(e: Entity, cellSize: number): number {
  return e.kind === "unit" ? UNIT_DEFS[e.type].radius : e.cells * cellSize * 0.5;
}
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const u32 = (v: number) => v >>> 0;
const weaponIds = new Map<WeaponDef, string>(Object.entries(WEAPONS).map(([k, v]) => [v, k]));
const weaponIdOf = (w: WeaponDef) => weaponIds.get(w)!;

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
