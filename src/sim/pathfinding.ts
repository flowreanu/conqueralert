import { GameMap, idx, inBounds, isPassableCell, worldToCell } from "../map/gameMap";

/**
 * Pathfinding A* pe grila hărții (8 direcții, cost diagonal √2, fără tăierea colțurilor).
 * Unitățile mari (tancuri) folosesc o hartă de „spațiu liber”: celula și cei 8 vecini trebuie
 * să fie trecibili, ca să nu se înghesuie între doi copaci. Dacă nu există cale cu spațiu liber,
 * se reîncearcă fără restricție.
 */
export class PathFinder {
  private clearance: Uint8Array;
  private dirty = true;
  // buffere refolosite
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private gen = 0;
  private heap = new MinHeap();

  constructor(private m: GameMap) {
    const n = m.width * m.height;
    this.clearance = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  /** De apelat când se schimbă `blocked` (clădire plasată/distrusă). */
  invalidate() { this.dirty = true; }

  private updateClearance() {
    if (!this.dirty) return;
    const m = this.m;
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        let ok = 1;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) if (!isPassableCell(m, x + dx, y + dy)) ok = 0;
        this.clearance[idx(m, x, y)] = ok;
      }
    this.dirty = false;
  }

  /** Celula e bună pentru o unitate de mărimea dată? */
  walkable(cx: number, cy: number, big: boolean): boolean {
    if (!isPassableCell(this.m, cx, cy)) return false;
    if (!big) return true;
    this.updateClearance();
    return this.clearance[idx(this.m, cx, cy)] === 1;
  }

  /** Cale în coordonate lume, de la (sx,sz) la (tx,tz). Ultimul punct = ținta exactă (dacă e atinsă). */
  find(sx: number, sz: number, tx: number, tz: number, big: boolean): { x: number; z: number }[] {
    let path = this.search(sx, sz, tx, tz, big);
    if (!path && big) path = this.search(sx, sz, tx, tz, false);
    return path ?? [];
  }

  private search(sx: number, sz: number, tx: number, tz: number, big: boolean): { x: number; z: number }[] | null {
    const m = this.m;
    const W = m.width;
    let [scx, scy] = worldToCell(m, sx, sz);
    let [gcx, gcy] = worldToCell(m, tx, tz);
    scx = clampI(scx, 0, W - 1); scy = clampI(scy, 0, m.height - 1);
    gcx = clampI(gcx, 0, W - 1); gcy = clampI(gcy, 0, m.height - 1);
    const goalOk = this.walkable(gcx, gcy, big);
    // celula de start poate fi „strâmtă” (unitate împinsă lângă un copac) — o acceptăm oricum
    const start = scy * W + scx, goal = gcy * W + gcx;
    if (start === goal) return [{ x: tx, z: tz }];

    const gen = ++this.gen;
    const { g, f, parent, stamp, closed } = this;
    const heap = this.heap;
    heap.clear();
    const h = (c: number) => {
      const dx = Math.abs((c % W) - gcx), dy = Math.abs(((c / W) | 0) - gcy);
      return Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy);
    };
    stamp[start] = gen; g[start] = 0; f[start] = h(start); parent[start] = -1;
    heap.push(f[start], start);
    let best = start, bestH = f[start];
    let expanded = 0;
    while (heap.length) {
      const c = heap.pop();
      if (closed[c] === gen) continue;
      closed[c] = gen;
      if (c === goal) { best = c; bestH = 0; break; }
      const hc = f[c] - g[c];
      if (hc < bestH) { bestH = hc; best = c; }
      if (++expanded > 12000) break;
      const cx = c % W, cy = (c / W) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = DX[k], dy = DY[k];
        const nx = cx + dx, ny = cy + dy;
        if (!inBounds(m, nx, ny)) continue;
        const n = ny * W + nx;
        if (closed[n] === gen) continue;
        const isGoal = n === goal;
        if (!isGoal || goalOk) { if (!this.walkable(nx, ny, big)) continue; }
        else if (!isPassableCell(m, nx, ny)) continue;
        if (dx && dy && (!this.walkable(cx + dx, cy, big) || !this.walkable(cx, cy + dy, big))) continue; // fără tăierea colțurilor
        const ng = g[c] + (dx && dy ? 1.41421356 : 1);
        if (stamp[n] === gen && ng >= g[n]) continue;
        stamp[n] = gen; g[n] = ng; f[n] = ng + h(n); parent[n] = c;
        heap.push(f[n], n);
      }
    }
    if (best !== goal && big) return null; // lasă căutarea fără restricție să încerce
    // reconstrucție
    const cells: number[] = [];
    for (let c = best; c !== -1; c = parent[c]) cells.push(c);
    cells.reverse();
    const cs = m.cellSize;
    const pts = cells.map((c) => ({ x: ((c % W) + 0.5) * cs, z: (((c / W) | 0) + 0.5) * cs }));
    if (best === goal) pts[pts.length - 1] = { x: tx, z: tz };
    pts[0] = { x: sx, z: sz };
    return this.smooth(pts, big);
  }

  /** „String pulling”: păstrează doar punctele între care nu există linie directă liberă. */
  private smooth(pts: { x: number; z: number }[], big: boolean) {
    if (pts.length <= 2) return pts.slice(1);
    const out: { x: number; z: number }[] = [];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (!this.lineClear(pts[anchor], pts[i], big)) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  lineClear(a: { x: number; z: number }, b: { x: number; z: number }, big: boolean): boolean {
    const m = this.m;
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.ceil(d / (m.cellSize * 0.25));
    // verificăm și două linii paralele (lățimea unității), ca să nu tăiem prin colțuri
    const off = big ? 0 : 0.45;
    const nx = d > 0 ? -(b.z - a.z) / d : 0, nz = d > 0 ? (b.x - a.x) / d : 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      for (const o of off ? [0, off, -off] : [0]) {
        const [cx, cy] = worldToCell(m, x + nx * o, z + nz * o);
        if (!this.walkable(cx, cy, big)) return false;
      }
    }
    return true;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const clampI = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// heap binar minim cu prioritatea stocată în intrare; la egalitate decide indexul celulei (determinist)
class MinHeap {
  private p: number[] = [];
  private v: number[] = [];
  get length() { return this.v.length; }
  clear() { this.p.length = 0; this.v.length = 0; }
  private less(i: number, j: number) { return this.p[i] < this.p[j] || (this.p[i] === this.p[j] && this.v[i] < this.v[j]); }
  private swap(i: number, j: number) {
    const tp = this.p[i]; this.p[i] = this.p[j]; this.p[j] = tp;
    const tv = this.v[i]; this.v[i] = this.v[j]; this.v[j] = tv;
  }
  push(prio: number, val: number) {
    this.p.push(prio); this.v.push(val);
    let i = this.v.length - 1;
    while (i > 0) {
      const q = (i - 1) >> 1;
      if (!this.less(i, q)) break;
      this.swap(i, q); i = q;
    }
  }
  pop(): number {
    const top = this.v[0];
    const lp = this.p.pop()!, lv = this.v.pop()!;
    if (this.v.length) {
      this.p[0] = lp; this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < this.v.length && this.less(l, s)) s = l;
        if (r < this.v.length && this.less(r, s)) s = r;
        if (s === i) break;
        this.swap(i, s); i = s;
      }
    }
    return top;
  }
}
