import { BUILDING_DEFS, UNIT_DEFS, World } from "./world";
import type { Building, Unit } from "./world";

/** Starea unei celule pentru un jucător. */
export const enum Vis {
  Unexplored = 0,
  /** explorată, dar nu se vede acum (ceață) */
  Fogged = 1,
  Visible = 2,
}

/**
 * Ceața de război a unui jucător (S4). Nu face parte din simulare (nu intră în hash / lockstep): fiecare client
 * își calculează ceața din pozițiile propriilor unități. Botul nu o folosește (vede tot, ca în RA2).
 */
export class Vision {
  readonly state: Uint8Array;
  /** clădiri inamice văzute măcar o dată (rămân pe hartă în ceață, ca în RA2) */
  readonly seenBuildings = new Set<number>();
  /** incrementat la fiecare update (pentru renderer) */
  version = 0;
  private stamps = new Map<number, Int16Array>();

  constructor(private world: World, public readonly player: number, public readonly enabled = true) {
    const m = world.map;
    this.state = new Uint8Array(m.width * m.height);
    if (!enabled) this.state.fill(Vis.Visible);
  }

  /** Raza de vedere a clădirilor fără `sight`: jumătatea amprentei + 8 m. */
  static buildingSight(b: Building, cellSize: number) {
    return BUILDING_DEFS[b.type].sight ?? b.cells * cellSize * 0.5 + 8;
  }

  /** Recalculează ce se vede acum. */
  update() {
    this.version++;
    if (!this.enabled) {
      for (const b of this.world.buildings.values()) this.seenBuildings.add(b.id);
      return;
    }
    const m = this.world.map;
    const s = this.state;
    for (let i = 0; i < s.length; i++) if (s[i] === Vis.Visible) s[i] = Vis.Fogged;
    for (const u of this.world.units.values()) if (u.owner === this.player) this.reveal(u.x, u.z, UNIT_DEFS[u.type].sight);
    for (const b of this.world.buildings.values()) if (b.owner === this.player) this.reveal(b.x, b.z, Vision.buildingSight(b, m.cellSize));
    for (const b of this.world.buildings.values()) {
      if (b.owner === this.player || this.seenBuildings.has(b.id)) continue;
      if (this.anyCellVisible(b)) this.seenBuildings.add(b.id);
    }
    // clădirile dispărute ies din listă
    for (const id of this.seenBuildings) if (!this.world.buildings.has(id)) this.seenBuildings.delete(id);
  }

  private reveal(x: number, z: number, sight: number) {
    const m = this.world.map;
    const r = Math.ceil(sight / m.cellSize);
    let st = this.stamps.get(r);
    if (!st) {
      // decalaje (dx,dy) ale celulelor din cerc, calculate o singură dată per rază
      const out: number[] = [];
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r * 0.6) out.push(dx, dy);
      st = Int16Array.from(out);
      this.stamps.set(r, st);
    }
    const cx = Math.floor(x / m.cellSize), cy = Math.floor(z / m.cellSize);
    const W = m.width, H = m.height;
    for (let k = 0; k < st.length; k += 2) {
      const nx = cx + st[k], ny = cy + st[k + 1];
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      this.state[ny * W + nx] = Vis.Visible;
    }
  }

  cell(cx: number, cy: number): Vis {
    const m = this.world.map;
    if (cx < 0 || cy < 0 || cx >= m.width || cy >= m.height) return Vis.Unexplored;
    return this.state[cy * m.width + cx] as Vis;
  }

  isVisible(x: number, z: number) {
    const cs = this.world.map.cellSize;
    return this.cell(Math.floor(x / cs), Math.floor(z / cs)) === Vis.Visible;
  }

  private anyCellVisible(b: Building) {
    for (let y = b.cy; y < b.cy + b.cells; y++) for (let x = b.cx; x < b.cx + b.cells; x++) if (this.cell(x, y) === Vis.Visible) return true;
    return false;
  }

  unitVisible(u: Unit) {
    return u.owner === this.player || this.isVisible(u.x, u.z);
  }

  buildingVisible(b: Building) {
    return b.owner === this.player || this.seenBuildings.has(b.id);
  }

  /** Unitate sau clădire: poate fi țintită / afișată de jucător. */
  entityVisible(e: Unit | Building) {
    return e.kind === "unit" ? this.unitVisible(e) : this.buildingVisible(e);
  }
}
