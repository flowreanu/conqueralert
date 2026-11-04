import { makeNoise, makeRng } from "./rng";
import { buildDecor } from "./decor";

export const enum Terrain {
  Grass = 0,
  Water = 1,
  Bridge = 2,
  Sand = 3,
  Ore = 4,
}

export interface Prop {
  model: string;
  /** coordonate lume (metri) */
  x: number;
  z: number;
  rot: number;
  scale: number;
  /** întindere pe axa X a modelului (plăcile de drum) */
  sx?: number;
}

export interface BaseSpot {
  faction: string;
  cx: number; // celulă
  cy: number;
}

export interface Bridge {
  /** celulele podului: x0..x1 (inclusiv) pe rândurile y0..y1 */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Clădire civilă (casă / magazin) care poate fi ocupată de infanterie (S5). */
export interface CivSpot {
  kind: "house" | "shop";
  model: string;
  /** centrul modelului (m) și rotația */
  x: number;
  z: number;
  rot: number;
  /** amprenta în celule (dreptunghi) */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
}

export interface GameMap {
  name: string;
  width: number;
  height: number;
  cellSize: number;
  terrain: Uint8Array;
  /** 1 = blocat static (copac, stâncă, clădire) */
  blocked: Uint8Array;
  props: Prop[];
  bases: BaseSpot[];
  bridges: Bridge[];
  oreFields: { cx: number; cy: number; r: number }[];
  /** minereu rămas per celulă (credite); 0 = epuizat */
  ore: Uint16Array;
  /** 1 = drum (doar vizual) */
  roads: Uint8Array;
  /** piețele orașelor (pavaj), în celule */
  plazas: { cx: number; cy: number; r: number }[];
  /** clădiri civile ocupabile (devin entități neutre în simulare) */
  civ: CivSpot[];
  /** puțuri de petrol (colțul amprentei 2×2), capturabile de ingineri */
  tech: { cx: number; cy: number }[];
}

export const ORE_MAX = 500;

export const idx = (m: GameMap, x: number, y: number) => y * m.width + x;
export const inBounds = (m: GameMap, x: number, y: number) => x >= 0 && y >= 0 && x < m.width && y < m.height;

export function isPassableCell(m: GameMap, x: number, y: number): boolean {
  if (!inBounds(m, x, y)) return false;
  const i = idx(m, x, y);
  return m.terrain[i] !== Terrain.Water && m.blocked[i] === 0;
}

/** Celula care conține punctul din lume (x,z) în metri. */
export function worldToCell(m: GameMap, x: number, z: number): [number, number] {
  return [Math.floor(x / m.cellSize), Math.floor(z / m.cellSize)];
}
export function isPassableWorld(m: GameMap, x: number, z: number): boolean {
  const [cx, cy] = worldToCell(m, x, z);
  return isPassableCell(m, cx, cy);
}
export function cellCenter(m: GameMap, cx: number, cy: number): [number, number] {
  return [(cx + 0.5) * m.cellSize, (cy + 0.5) * m.cellSize];
}

/** Celula rotită la 180° (harta e simetrică față de centru). */
export const mirrorIndex = (m: GameMap, i: number) => m.width * m.height - 1 - i;

/**
 * Harta „Delta Dunării”, 96×96, 1v1, **simetrică prin rotire la 180°** (S5): se generează jumătatea de sud
 * (rândurile 0–47) și se copiază rotită în nord, deci ambele baze au exact același teren, minereu, poduri și orășele.
 * Râul curge prin mijloc și se desparte în două brațe (deltă) la ambele capete. Două poduri traversează brațul principal.
 * SUA la vest, URSS la est.
 */
export function generateDeltaMap(seed = 1337): GameMap {
  const W = 96, H = 96, N = W * H;
  const m: GameMap = {
    name: "Delta Dunării",
    width: W,
    height: H,
    cellSize: 2,
    terrain: new Uint8Array(N),
    blocked: new Uint8Array(N),
    props: [],
    // colțurile Centrului de Construcție sunt la (cx−2, cy−2): (14,50) ↔ (82,46) sunt exact rotite
    bases: [
      { faction: "usa", cx: 14, cy: 50 },
      { faction: "ussr", cx: W - 14, cy: H - 50 },
    ],
    bridges: [],
    oreFields: [],
    ore: new Uint16Array(N),
    roads: new Uint8Array(N),
    plazas: [],
    civ: [],
    tech: [],
  };
  const rng = makeRng(seed);
  const noise = makeNoise(seed);
  const half = N / 2; // celulele i < half = rândurile 0..47
  const mirrorHalf = () => { for (let i = half; i < N; i++) { const j = N - 1 - i; m.terrain[i] = m.terrain[j]; m.ore[i] = m.ore[j]; } };

  // Râul: y = rândul (0 = sud). Meandrele sunt impare față de mijloc (y = 47,5) → râul continuă lin peste linia de simetrie.
  const SPLIT = 15;
  const MID = H / 2 - 0.5;
  const center = (y: number) => 48 + 5 * Math.sin((y - MID) / 13) + 2.2 * Math.sin((y - MID) / 4.7);
  const distToRiver = (x: number, y: number) => {
    let d = Infinity;
    const halfW = 3.6 + 0.6 * Math.cos((y - MID) / 8);
    if (y >= SPLIT - 2) d = Math.abs(x - center(y)) - halfW;
    if (y <= SPLIT + 1) {
      const t = SPLIT - y;
      const c0 = center(SPLIT);
      const a1 = c0 - t * 0.75 - 1.5 * Math.sin(y / 5);
      const a2 = c0 + t * 0.7 + 1.5 * Math.sin(y / 6 + 1);
      const hw = 2.4 + 0.4 * Math.sin(y / 3);
      d = Math.min(d, Math.abs(x - a1) - hw, Math.abs(x - a2) - hw);
    }
    return d;
  };

  for (let y = 0; y < H / 2; y++)
    for (let x = 0; x < W; x++) {
      const d = distToRiver(x + 0.5, y + 0.5);
      const i = y * W + x;
      if (d <= 0) m.terrain[i] = Terrain.Water;
      else if (d < 1.6) m.terrain[i] = Terrain.Sand;
    }

  // Pod: 3 celule lățime, peste brațul principal; al doilea pod e copia rotită.
  {
    const by = 25;
    let x0 = W, x1 = -1;
    for (let y = by - 1; y <= by + 1; y++)
      for (let x = 0; x < W; x++)
        if (m.terrain[y * W + x] === Terrain.Water) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    for (let y = by - 1; y <= by + 1; y++) for (let x = x0; x <= x1; x++) m.terrain[y * W + x] = Terrain.Bridge;
    m.bridges.push({ x0, x1, y0: by - 1, y1: by + 1 }, { x0: W - 1 - x1, x1: W - 1 - x0, y0: H - 1 - (by + 1), y1: H - 1 - (by - 1) });
  }

  // Câmpuri de minereu: lângă fiecare bază + unul contestat pe fiecare mal (perechi rotite).
  // Ordinea e păstrată din S3: [vest, est, nord-vest contestat, sud-est contestat].
  const south = [{ cx: 74, cy: 30, r: 4.2 }, { cx: 62, cy: 10, r: 4.3 }];
  const rot = (f: { cx: number; cy: number; r: number }) => ({ cx: W - f.cx, cy: H - f.cy, r: f.r });
  m.oreFields = [rot(south[0]), south[0], rot(south[1]), south[1]];
  for (const f of south)
    for (let y = Math.floor(f.cy - f.r); y <= Math.ceil(f.cy + f.r); y++)
      for (let x = Math.floor(f.cx - f.r); x <= Math.ceil(f.cx + f.r); x++) {
        if (!inBounds(m, x, y) || y >= H / 2) continue;
        const d = Math.hypot(x + 0.5 - f.cx, y + 0.5 - f.cy) + (noise(x * 0.7, y * 0.7) - 0.5) * 1.6;
        const i = y * W + x;
        if (d < f.r && m.terrain[i] === Terrain.Grass) {
          m.terrain[i] = Terrain.Ore;
          // mai bogat spre centru: 200..500
          m.ore[i] = Math.round(200 + 300 * Math.max(0, 1 - d / f.r));
        }
      }
  mirrorHalf();

  // Drumuri, orășele, mașini (S4.2), simetrice
  const decor = buildDecor(m, rng);
  m.roads = decor.roads;
  m.plazas = decor.plazas;
  m.civ = decor.civ;

  // Puțurile de petrol (S5): pe fiecare mal, între baze și podul îndepărtat; libere, fără drum / minereu
  {
    const free = (cx: number, cy: number) => {
      for (let y = cy - 1; y <= cy + 2; y++)
        for (let x = cx - 1; x <= cx + 2; x++) {
          if (!inBounds(m, x, y)) return false;
          const i = y * W + x;
          if (m.terrain[i] !== Terrain.Grass || m.blocked[i] || m.roads[i] || decor.occupied[i]) return false;
        }
      return true;
    };
    const want = { cx: 60, cy: 33 };
    let best: { cx: number; cy: number } | null = null, bd = Infinity;
    for (let cy = 4; cy < H / 2 - 4; cy++)
      for (let cx = 4; cx < W - 6; cx++) {
        const d = Math.hypot(cx - want.cx, cy - want.cy);
        if (d < bd && free(cx, cy) && free(W - 2 - cx, H - 2 - cy)) { bd = d; best = { cx, cy }; }
      }
    if (best) {
      m.tech.push({ cx: W - 2 - best.cx, cy: H - 2 - best.cy }, best);
      for (const t of m.tech) for (let y = t.cy; y < t.cy + 2; y++) for (let x = t.cx; x < t.cx + 2; x++) { m.blocked[y * W + x] = 1; decor.occupied[y * W + x] = 1; }
    }
  }

  // Zone fără decor: baze, capete de pod, minereu, drumuri, curți, puțuri.
  const keepClear = (x: number, y: number) => {
    const ci = y * W + x;
    if (m.roads[ci] || decor.occupied[ci] || m.blocked[ci]) return true;
    for (const p of m.plazas) if (Math.hypot(x - p.cx, y - p.cy) < p.r + 2) return true;
    for (const b of m.bases) if (Math.hypot(x - b.cx, y - b.cy) < 17) return true;
    for (const br of m.bridges) {
      const cy = (br.y0 + br.y1) / 2;
      if (Math.abs(y - cy) < 5 && x > br.x0 - 8 && x < br.x1 + 8) return true;
    }
    for (const f of m.oreFields) if (Math.hypot(x - f.cx, y - f.cy) < f.r + 2.5) return true;
    for (const t of m.tech) if (Math.hypot(x - t.cx - 1, y - t.cy - 1) < 4) return true;
    return false;
  };

  // Copaci și stânci: doar în jumătatea de sud, fiecare cu perechea lui rotită în nord.
  const trees = ["tree_pine", "tree_pineTall", "tree_oak", "tree_default"] as const;
  const cs = m.cellSize;
  const addPair = (i: number, p: Prop) => {
    const j = N - 1 - i;
    m.blocked[i] = 1;
    m.blocked[j] = 1;
    m.props.push(p, { ...p, x: W * cs - p.x, z: H * cs - p.z, rot: p.rot + Math.PI });
  };
  for (let y = 1; y < H / 2; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (m.terrain[i] !== Terrain.Grass || keepClear(x, y) || keepClear(W - 1 - x, H - 1 - y)) continue;
      const forest = noise(x / 9, y / 9);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y) < 4 ? 0.25 : 0;
      if (forest + edge > 0.68 && rng.next() < 0.55) {
        addPair(i, {
          model: forest > 0.8 ? rng.pick(["tree_pine", "tree_pineTall"]) : rng.pick(trees),
          x: (x + 0.5 + rng.range(-0.25, 0.25)) * cs,
          z: (y + 0.5 + rng.range(-0.25, 0.25)) * cs,
          rot: rng.range(0, Math.PI * 2),
          scale: rng.range(0.85, 1.25),
        });
      } else if (forest < 0.12 && rng.next() < 0.12) {
        addPair(i, {
          model: rng.pick(["rock_large", "rock_tall"]),
          x: (x + 0.5) * cs,
          z: (y + 0.5) * cs,
          rot: rng.range(0, Math.PI * 2),
          scale: rng.range(0.8, 1.2),
        });
      }
    }
  return m;
}

/** BFS pe celule trecibile — folosit în teste (ex.: podurile leagă cele două maluri). */
export function reachable(m: GameMap, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(m.width * m.height);
  const q: number[] = [];
  if (!isPassableCell(m, sx, sy)) return seen;
  seen[idx(m, sx, sy)] = 1;
  q.push(sx, sy);
  for (let h = 0; h < q.length; h += 2) {
    const x = q[h], y = q[h + 1];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (isPassableCell(m, nx, ny) && !seen[idx(m, nx, ny)]) {
        seen[idx(m, nx, ny)] = 1;
        q.push(nx, ny);
      }
    }
  }
  return seen;
}
