import { makeRng, Rng } from "../map/rng";
import { idx, inBounds } from "../map/gameMap";
import type { Building, Controller, Entity, Unit, World } from "./world";
import { BUILDING_DEFS, TICK_RATE, UNIT_DEFS, nearestPassable } from "./world";
import { availability, buildingCells, canPlace, costOf, isLowPower } from "./economy";
import type { Difficulty } from "./scenario";

/**
 * Botul (S4). Folosește exact comenzile jucătorului (`produce`, `place`, `rally`, `amove`, `repair`),
 * deci nu are nimic special în simulare. E determinist (tick-ul lumii + RNG propriu) → merge și în lockstep.
 *
 * - construcție: Centrală → Rafinărie → Barăci → Fabrică, apoi centrale la nevoie, a doua rafinărie, turele;
 * - economie: recoltoare (1–2 per rafinărie), rezervă de bani pentru clădiri;
 * - armată: unitățile noi se adună în fața bazei; la intervale fixe pleacă un val de atac (attack-move)
 *   spre cea mai apropiată clădire inamică; valurile cresc treptat;
 * - apărare: dacă inamicul intră în bază, toată armata adunată (și valul, dacă e aproape) contraatacă;
 * - repară clădirile avariate când are bani;
 * - S5: amestecă infanteria antitanc / cercetașii, trimite ingineri să captureze puțurile de petrol (Normal / Greu)
 *   și ocupă casele din fața bazei cu infanterie; casele ocupate de inamic sunt ținte (ca orice clădire).
 */

interface Profile {
  /** la câte tick-uri gândește */
  think: number;
  /** primul val (secunde) și pauza dintre valuri */
  firstWave: number;
  waveGap: number;
  waveSize: number;
  waveGrow: number;
  maxWave: number;
  turrets: number;
  refineries: number;
  harvPerRef: number;
  /** câte unități ține simultan în cozi */
  queueDepth: number;
  /** proporția de vehicule (restul infanterie) */
  vehicleShare: number;
  /** multiplicatorul venitului (ca în RA2, botul mai greu are un mic avantaj economic) */
  income: number;
  /** plafonul armatei (unități de luptă) */
  maxArmy: number;
  /** șansa de a pune ceva în coadă la fiecare „gând” (Ușor produce mai rar) */
  buildChance: number;
  /** S5: câte case ține ocupate (0 = niciuna) și dacă trimite ingineri la puțurile de petrol */
  garrisons: number;
  engineers: boolean;
}

export const BOT_PROFILES: Record<Difficulty, Profile> = {
  easy: { think: 30, firstWave: 420, waveGap: 200, waveSize: 4, waveGrow: 1, maxWave: 7, turrets: 1, refineries: 1, harvPerRef: 1, queueDepth: 1, vehicleShare: 0.4, income: 0.6, maxArmy: 12, buildChance: 0.35, garrisons: 0, engineers: false },
  normal: { think: 15, firstWave: 270, waveGap: 140, waveSize: 6, waveGrow: 2, maxWave: 12, turrets: 2, refineries: 2, harvPerRef: 1, queueDepth: 1, vehicleShare: 0.55, income: 0.9, maxArmy: 24, buildChance: 0.7, garrisons: 1, engineers: true },
  hard: { think: 8, firstWave: 180, waveGap: 100, waveSize: 8, waveGrow: 3, maxWave: 20, turrets: 4, refineries: 2, harvPerRef: 2, queueDepth: 2, vehicleShare: 0.65, income: 1.25, maxArmy: 45, buildChance: 1, garrisons: 2, engineers: true },
};

const THREAT_RADIUS = 30; // m în jurul clădirilor proprii

export class Bot implements Controller {
  readonly profile: Profile;
  private rng: Rng;
  /** unități care așteaptă la punctul de adunare */
  private staging = new Set<number>();
  /** unități plecate în val */
  private attackers = new Set<number>();
  private nextWaveTick: number;
  private waveSize: number;
  waves = 0;
  private rallied = new Set<number>();
  private lastDefense = -1e9;
  /** pentru diagnoză / teste */
  lastDecision = "";

  constructor(public readonly player: number, public readonly difficulty: Difficulty = "normal", seed = 99) {
    this.profile = BOT_PROFILES[difficulty];
    this.rng = makeRng(seed * 31 + player);
    this.nextWaveTick = this.profile.firstWave * TICK_RATE;
    this.waveSize = this.profile.waveSize;
  }

  think(w: World) {
    w.eco[this.player].incomeMul = this.profile.income;
    if (w.defeated[this.player]) return;
    if ((w.tick + this.player * 3) % this.profile.think !== 0) return;
    const base = this.baseCenter(w);
    if (!base) return;
    this.structures(w, base);
    this.defenses(w, base);
    this.units(w);
    this.army(w, base);
    this.engineers(w);
    this.garrisons(w, base);
    this.repairs(w);
  }

  // ─────────────────────────── ajutătoare ───────────────────────────

  private mine(w: World, type?: string): Building[] {
    const out: Building[] = [];
    for (const b of w.buildings.values()) if (b.owner === this.player && (!type || b.type === type)) out.push(b);
    return out;
  }
  private myUnits(w: World): Unit[] {
    const out: Unit[] = [];
    for (const u of w.units.values()) if (u.owner === this.player) out.push(u);
    return out;
  }
  private faction(w: World) { return w.players[this.player].faction; }

  /** Centrul bazei (Centrul de Construcție, altfel prima clădire), în celule. */
  private baseCenter(w: World): { cx: number; cy: number; x: number; z: number } | null {
    const all = this.mine(w);
    const b = all.find((x) => x.type === "conyard") ?? all[0];
    if (!b) return null;
    return { cx: b.cx + b.cells / 2, cy: b.cy + b.cells / 2, x: b.x, z: b.z };
  }

  /** Direcția (unitară) spre baza inamică. */
  private enemyDir(w: World, base: { x: number; z: number }) {
    const t = this.enemyBuildings(w)[0] ?? [...w.units.values()].find((u) => u.owner !== this.player);
    const ex = t ? t.x : w.map.width * w.map.cellSize - base.x, ez = t ? t.z : base.z;
    const d = Math.hypot(ex - base.x, ez - base.z) || 1;
    return { x: (ex - base.x) / d, z: (ez - base.z) / d };
  }

  private enemyBuildings(w: World): Building[] {
    const out: Building[] = [];
    for (const b of w.buildings.values()) if (b.owner >= 0 && b.owner !== this.player && !w.defeated[b.owner]) out.push(b);
    return out;
  }

  private rallyPoint(w: World, base: { x: number; z: number }) {
    const d = this.enemyDir(w, base);
    return nearestPassable(w.map, base.x + d.x * 18, base.z + d.z * 18);
  }

  // ─────────────────────────── construcție ───────────────────────────

  private structures(w: World, base: { cx: number; cy: number; x: number; z: number }) {
    const e = w.eco[this.player];
    const q = e.queues.structure;
    if (q[0]?.ready) { this.place(w, q[0].type, base); return; }
    if (q.length) return;
    const next = this.nextStructure(w);
    if (next && availability(w, this.player, next).ok) {
      w.issue({ kind: "produce", player: this.player, item: next });
      this.lastDecision = `build ${next}`;
    }
  }

  private nextStructure(w: World): string | null {
    const e = w.eco[this.player];
    const n = (t: string) => this.mine(w, t).length;
    const balance = e.powerOut - e.powerUse;
    const needs = (t: string) => balance + (BUILDING_DEFS[t].power ?? 0) < 0;
    if (n("conyard") === 0) return null;
    if (n("power") === 0) return "power";
    for (const t of ["refinery", "barracks", "factory"]) if (n(t) === 0) return needs(t) ? "power" : t;
    if (balance < 25) return "power";
    if (n("refinery") < this.profile.refineries && this.myUnits(w).length > 10) return needs("refinery") ? "power" : "refinery";
    // la bani mulți: încă o fabrică / barăci pe Greu
    if (this.difficulty === "hard" && e.credits > 4000 && n("factory") < 2) return needs("factory") ? "power" : "factory";
    return null;
  }

  private defenses(w: World, base: { cx: number; cy: number; x: number; z: number }) {
    const e = w.eco[this.player];
    const q = e.queues.defense;
    if (q[0]?.ready) { this.place(w, q[0].type, base); return; }
    if (q.length) return;
    const turrets = this.mine(w, "turret").length;
    // turelele vin treptat (una în plus după fiecare val), să nu mănânce banii armatei la început
    if (turrets >= Math.min(this.profile.turrets, 1 + this.waves)) return;
    if (this.mine(w, "factory").length === 0 && turrets >= 1) return; // întâi fabrica
    if (e.credits < 400 || e.powerOut - e.powerUse < 30) return;
    if (availability(w, this.player, "turret").ok) w.issue({ kind: "produce", player: this.player, item: "turret" });
  }

  /** Alege locul clădirii: turelele spre inamic, rafinăria spre minereu, restul compact în jurul bazei. */
  private place(w: World, type: string, base: { cx: number; cy: number; x: number; z: number }) {
    const m = w.map;
    const n = buildingCells(type);
    const cs = m.cellSize;
    const dir = this.enemyDir(w, base);
    let ore: { x: number; z: number } | null = null;
    if (type === "refinery") {
      let bd = Infinity;
      for (const f of m.oreFields) {
        const fx = (f.cx + 0.5) * cs, fz = (f.cy + 0.5) * cs;
        // câmpuri fără rafinărie proprie aproape (a doua rafinărie merge la alt câmp)
        const taken = this.mine(w, "refinery").some((r) => Math.hypot(r.x - fx, r.z - fz) < 24);
        const d = Math.hypot(fx - base.x, fz - base.z) + (taken ? 40 : 0);
        if (d < bd) { bd = d; ore = { x: fx, z: fz }; }
      }
    }
    let best: { cx: number; cy: number } | null = null, bs = Infinity;
    const R = 16;
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const cx = Math.round(base.cx + dx - n / 2), cy = Math.round(base.cy + dy - n / 2);
        const px = (cx + n / 2) * cs, pz = (cy + n / 2) * cs;
        const along = (px - base.x) * dir.x + (pz - base.z) * dir.z;
        const d = Math.hypot(px - base.x, pz - base.z);
        let score: number;
        if (type === "turret") score = Math.abs(d - 16) * 1.5 - along * 1.2; // un inel în fața bazei
        else if (ore) score = Math.hypot(px - ore.x, pz - ore.z) * 1.4 + d * 0.3;
        else score = d - along * 0.35; // compact, ușor spre spatele bazei
        score += this.rng.next() * 0.5;
        if (score >= bs) continue;
        if (!this.keepsLanes(w, cx, cy, n) || !canPlace(w, this.player, type, cx, cy)) continue;
        bs = score; best = { cx, cy };
      }
    if (best) w.issue({ kind: "place", player: this.player, item: type, cx: best.cx, cy: best.cy });
    else w.issue({ kind: "cancel", player: this.player, item: type }); // nu are loc → banii înapoi
  }

  /** Lasă un culoar de o celulă între clădiri (să nu se blocheze ieșirile / docul rafinăriei). */
  private keepsLanes(w: World, cx: number, cy: number, n: number) {
    const m = w.map;
    for (let y = cy - 1; y <= cy + n; y++)
      for (let x = cx - 1; x <= cx + n; x++) {
        if (!inBounds(m, x, y)) return false;
        if (m.blocked[idx(m, x, y)] === 2) return false;
      }
    return true;
  }

  // ─────────────────────────── unități ───────────────────────────

  private units(w: World) {
    const e = w.eco[this.player];
    const f = this.faction(w);
    const types = Object.keys(UNIT_DEFS).filter((k) => UNIT_DEFS[k].faction === f);
    const harvType = types.find((k) => UNIT_DEFS[k].capacity);
    const refs = this.mine(w, "refinery").length;
    const harvs = this.myUnits(w).filter((u) => u.harv).length;
    const vq = e.queues.vehicle, iq = e.queues.infantry;
    // rezervă pentru clădirea în lucru (să nu stea construcția din cauza armatei)
    let reserve = 0;
    for (const it of [e.queues.structure[0], e.queues.defense[0]]) if (it && !it.ready) reserve += Math.min(800, costOf(it.type) - it.paid);
    const spare = e.credits - reserve;

    if (harvType && refs && harvs + vq.filter((x) => x.type === harvType).length < refs * (this.waves > 0 ? this.profile.harvPerRef : 1) && availability(w, this.player, harvType).ok) {
      w.issue({ kind: "produce", player: this.player, item: harvType });
      return;
    }
    if (isLowPower(e)) return;
    // plafonul armatei (cu tot ce e deja în coadă) + ritmul de producție al dificultății
    const army = this.myUnits(w).filter((u) => !u.harv && UNIT_DEFS[u.type].weapon).length + vq.length + iq.length;
    if (army >= this.profile.maxArmy || this.rng.next() > this.profile.buildChance) return;
    const depth = this.profile.queueDepth;
    const pick = (role: string[]) => {
      const c = types.filter((k) => role.includes(UNIT_DEFS[k].role) && availability(w, this.player, k).ok);
      return c.length ? c[Math.floor(this.rng.next() * c.length)] : null;
    };
    if (vq.length < depth && spare > 700 && this.rng.next() < this.profile.vehicleShare + 0.2) {
      // ~55% tancuri, ~30% suport, ~15% cercetași
      const r = this.rng.next();
      const t = r < 0.55 ? pick(["tank"]) : r < 0.85 ? pick(["support"]) : pick(["scout"]);
      if (t) w.issue({ kind: "produce", player: this.player, item: t });
    }
    if (iq.length < depth && spare > 300 && this.rng.next() < 1.2 - this.profile.vehicleShare) {
      // mai multă infanterie antitanc dacă inamicul are multe vehicule
      let enemyVeh = 0, enemyAll = 0;
      for (const u of w.units.values()) if (u.owner !== this.player && UNIT_DEFS[u.type].weapon) { enemyAll++; if (UNIT_DEFS[u.type].armor !== "infantry") enemyVeh++; }
      const at = 0.2 + 0.4 * (enemyAll ? enemyVeh / enemyAll : 0);
      const t = this.rng.next() < at ? pick(["antitank"]) ?? pick(["infantry"]) : pick(["infantry"]);
      if (t) w.issue({ kind: "produce", player: this.player, item: t });
    }
    // inginer pentru puțurile de petrol libere / inamice (unul singur odată)
    if (this.profile.engineers && spare > 900 && iq.length < depth && this.freeDerrick(w, null) && !this.myUnits(w).some((u) => UNIT_DEFS[u.type].engineer) && !iq.some((q) => UNIT_DEFS[q.type].engineer)) {
      const t = pick(["engineer"]);
      if (t) w.issue({ kind: "produce", player: this.player, item: t });
    }
  }

  // ─────────────────────────── ingineri / case (S5) ───────────────────────────

  /** Cel mai apropiat puț de petrol care nu e al botului. */
  private freeDerrick(w: World, from: { x: number; z: number } | null): Building | null {
    let best: Building | null = null, bd = Infinity;
    for (const b of w.buildings.values()) {
      if (!BUILDING_DEFS[b.type].capturable || b.owner === this.player) continue;
      const d = from ? Math.hypot(b.x - from.x, b.z - from.z) : 0;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  private engineers(w: World) {
    for (const u of this.myUnits(w)) {
      if (!UNIT_DEFS[u.type].engineer || u.enterId) continue;
      const d = this.freeDerrick(w, u);
      if (d) w.issue({ kind: "enter", player: this.player, unitIds: [u.id], targetId: d.id });
    }
  }

  /** Ține câteva case din fața bazei ocupate cu infanterie (de la punctul de adunare). */
  private garrisons(w: World, base: { x: number; z: number }) {
    if (!this.profile.garrisons || w.tick % (TICK_RATE * 10) >= this.profile.think) return;
    const held = [...w.buildings.values()].filter((b) => b.owner === this.player && BUILDING_DEFS[b.type].garrison && b.garrison.length);
    const going = [...this.staging].map((id) => w.units.get(id)).filter((u) => u?.enterId);
    if (held.length + (going.length ? 1 : 0) >= this.profile.garrisons) return;
    const rally = this.rallyPoint(w, base);
    let house: Building | null = null, bd = 48;
    for (const b of w.buildings.values()) {
      if (!BUILDING_DEFS[b.type].garrison || b.owner >= 0) continue;
      const d = Math.hypot(b.x - rally.x, b.z - rally.z);
      if (d < bd) { bd = d; house = b; }
    }
    if (!house) return;
    const inf = [...this.staging].map((id) => w.units.get(id)!).filter((u) => u && UNIT_DEFS[u.type].garrison && !u.enterId);
    if (inf.length < 4) return;
    const ids = inf.slice(0, 3).map((u) => u.id);
    w.issue({ kind: "enter", player: this.player, unitIds: ids, targetId: house.id });
    // nu mai fac parte din armata care pleacă în valuri
    for (const id of ids) this.staging.delete(id);
    this.lastDecision = "garrison";
  }

  // ─────────────────────────── armată ───────────────────────────

  private army(w: World, base: { cx: number; cy: number; x: number; z: number }) {
    const rally = this.rallyPoint(w, base);
    // punctul de adunare pentru barăci / fabrici noi
    for (const b of this.mine(w)) {
      if (!BUILDING_DEFS[b.type].produces || this.rallied.has(b.id)) continue;
      w.issue({ kind: "rally", player: this.player, buildingId: b.id, x: rally.x, z: rally.z });
      this.rallied.add(b.id);
    }
    // curăță listele, adaugă unitățile noi la adunare
    for (const s of [this.staging, this.attackers]) for (const id of s) if (!w.units.has(id)) s.delete(id);
    for (const u of this.myUnits(w)) {
      if (u.harv || !UNIT_DEFS[u.type].weapon || u.enterId) continue;
      if (!this.staging.has(u.id) && !this.attackers.has(u.id)) this.staging.add(u.id);
    }

    // apărare: inamici în bază
    const threat = this.threat(w);
    if (threat && w.tick - this.lastDefense > TICK_RATE * 4) {
      this.lastDefense = w.tick;
      const ids = [...this.staging];
      // valul se întoarce dacă e aproape de bază
      for (const id of this.attackers) { const u = w.units.get(id)!; if (Math.hypot(u.x - base.x, u.z - base.z) < 55) ids.push(id); }
      if (ids.length) w.issue({ kind: "amove", player: this.player, unitIds: ids, x: threat.x, z: threat.z });
      this.lastDecision = "defend";
      return;
    }

    // adunarea: unitățile care s-au întors din apărare / stau departe merg înapoi la punct
    if (!threat && w.tick % (TICK_RATE * 6) < this.profile.think) {
      const idle = [...this.staging].map((id) => w.units.get(id)!).filter((u) => !u.target && !u.attackId && Math.hypot(u.x - rally.x, u.z - rally.z) > 14);
      if (idle.length) w.issue({ kind: "move", player: this.player, unitIds: idle.map((u) => u.id), x: rally.x, z: rally.z });
    }

    // valul de atac
    const late = w.tick > this.nextWaveTick + TICK_RATE * 60;
    if (w.tick >= this.nextWaveTick && (this.staging.size >= this.waveSize || (late && this.staging.size >= 3))) {
      const target = this.pickTarget(w, rally);
      if (target) {
        // Ușor: pleacă doar grupul valului, restul rămâne acasă; Normal / Greu: toată armata adunată
        let ids = [...this.staging];
        if (this.difficulty === "easy") ids = ids.slice(0, this.waveSize);
        const p = nearestPassable(w.map, target.x, target.z);
        w.issue({ kind: "amove", player: this.player, unitIds: ids, x: p.x, z: p.z });
        for (const id of ids) { this.attackers.add(id); this.staging.delete(id); }
        this.waves++;
        this.nextWaveTick = w.tick + this.profile.waveGap * TICK_RATE;
        this.waveSize = Math.min(this.profile.maxWave, this.waveSize + this.profile.waveGrow);
        this.lastDecision = `wave ${this.waves} (${ids.length})`;
      }
    }

    // valul în desfășurare: cine a terminat ce avea de făcut merge la următoarea țintă
    if (w.tick % (TICK_RATE * 3) < this.profile.think) {
      const done = [...this.attackers].map((id) => w.units.get(id)!).filter((u) => !u.amove && !u.attackId && !u.target);
      if (done.length) {
        const c = { x: done.reduce((s, u) => s + u.x, 0) / done.length, z: done.reduce((s, u) => s + u.z, 0) / done.length };
        const t = this.pickTarget(w, c);
        if (t) { const p = nearestPassable(w.map, t.x, t.z); w.issue({ kind: "amove", player: this.player, unitIds: done.map((u) => u.id), x: p.x, z: p.z }); }
      }
    }
  }

  /** Cea mai apropiată clădire inamică (preferă producția / economia), altfel o unitate inamică. */
  private pickTarget(w: World, from: { x: number; z: number }): Entity | null {
    let best: Entity | null = null, bd = Infinity;
    for (const b of this.enemyBuildings(w)) {
      const pref = b.type === "refinery" || b.type === "factory" || b.type === "conyard" ? -15 : b.type === "turret" ? 10 : 0;
      const d = Math.hypot(b.x - from.x, b.z - from.z) + pref;
      if (d < bd) { bd = d; best = b; }
    }
    if (best) return best;
    for (const u of w.units.values()) {
      if (u.owner === this.player) continue;
      const d = Math.hypot(u.x - from.x, u.z - from.z);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /** Centrul unităților inamice aflate în bază (sau null). */
  private threat(w: World): { x: number; z: number } | null {
    const mine = this.mine(w).filter((b) => BUILDING_DEFS[b.type].category !== "civilian");
    let sx = 0, sz = 0, n = 0;
    for (const u of w.units.values()) {
      if (u.owner === this.player || !UNIT_DEFS[u.type].weapon) continue;
      if (mine.some((b) => Math.hypot(b.x - u.x, b.z - u.z) < THREAT_RADIUS)) { sx += u.x; sz += u.z; n++; }
    }
    // casele ocupate de inamic lângă bază
    for (const b of w.buildings.values()) {
      if (b.owner < 0 || b.owner === this.player || !b.garrison.length) continue;
      if (mine.some((m) => Math.hypot(m.x - b.x, m.z - b.z) < THREAT_RADIUS + 10)) { sx += b.x; sz += b.z; n++; }
    }
    return n ? { x: sx / n, z: sz / n } : null;
  }

  private repairs(w: World) {
    const e = w.eco[this.player];
    if (e.credits < 900) return;
    for (const b of this.mine(w)) if (!b.repairing && b.hp < b.maxHp * 0.7 && BUILDING_DEFS[b.type].category !== "civilian") { w.issue({ kind: "repair", player: this.player, buildingId: b.id }); break; }
  }
}
