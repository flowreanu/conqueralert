import { makeNoise, makeRng } from "./rng";

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

/**
 * Harta „Delta Dunării”, 96×96, 1v1.
 * Râul curge de la nord (z mare) spre sud și se desparte în două brațe (deltă) în partea de sud.
 * Două poduri traversează brațul principal. SUA la vest, URSS la est.
 */
export function generateDeltaMap(seed = 1337): GameMap {
  const W = 96, H = 96;
  const m: GameMap = {
    name: "Delta Dunării",
    width: W,
    height: H,
    cellSize: 2,
    terrain: new Uint8Array(W * H),
    blocked: new Uint8Array(W * H),
    props: [],
    bases: [
      { faction: "usa", cx: 14, cy: 50 },
      { faction: "ussr", cx: 82, cy: 46 },
    ],
    bridges: [],
    oreFields: [],
    ore: new Uint16Array(W * H),
  };
  const rng = makeRng(seed);
  const noise = makeNoise(seed);

  // Râul: y = rândul (0 = sud). Brațul principal de la nord până la y=SPLIT, apoi două brațe spre sud.
  const SPLIT = 26;
  const center = (y: number) => 48 + 5 * Math.sin(y / 13 + 0.6) + 2.2 * Math.sin(y / 4.7);
  const halfW = (y: number) => 3.1 + 0.8 * Math.sin(y / 9);
  const distToRiver = (x: number, y: number) => {
    let d = Infinity;
    if (y >= SPLIT - 2) d = Math.abs(x - center(y)) - halfW(y);
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

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = distToRiver(x + 0.5, y + 0.5);
      const i = y * W + x;
      if (d <= 0) m.terrain[i] = Terrain.Water;
      else if (d < 1.6) m.terrain[i] = Terrain.Sand;
    }

  // Poduri: 3 celule lățime, peste brațul principal.
  for (const by of [40, 74]) {
    let x0 = W, x1 = -1;
    for (let y = by - 1; y <= by + 1; y++)
      for (let x = 0; x < W; x++)
        if (m.terrain[y * W + x] === Terrain.Water) {
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
        }
    for (let y = by - 1; y <= by + 1; y++)
      for (let x = x0; x <= x1; x++) m.terrain[y * W + x] = Terrain.Bridge;
    m.bridges.push({ x0, x1, y0: by - 1, y1: by + 1 });
  }

  // Câmpuri de minereu (folosite din S3): lângă fiecare bază + unul contestat pe fiecare mal.
  m.oreFields = [
    { cx: 22, cy: 66, r: 4 },
    { cx: 74, cy: 30, r: 4 },
    { cx: 34, cy: 86, r: 3.5 },
    { cx: 63, cy: 12, r: 4.7 },
  ];
  for (const f of m.oreFields)
    for (let y = Math.floor(f.cy - f.r); y <= Math.ceil(f.cy + f.r); y++)
      for (let x = Math.floor(f.cx - f.r); x <= Math.ceil(f.cx + f.r); x++) {
        if (!inBounds(m, x, y)) continue;
        const d = Math.hypot(x + 0.5 - f.cx, y + 0.5 - f.cy) + (noise(x * 0.7, y * 0.7) - 0.5) * 1.6;
        const i = y * W + x;
        if (d < f.r && m.terrain[i] === Terrain.Grass) {
          m.terrain[i] = Terrain.Ore;
          // mai bogat spre centru: 200..500
          m.ore[i] = Math.round(200 + 300 * Math.max(0, 1 - d / f.r));
        }
      }

  // Zone fără decor: baze, capete de pod, minereu.
  const keepClear = (x: number, y: number) => {
    for (const b of m.bases) if (Math.hypot(x - b.cx, y - b.cy) < 17) return true;
    for (const br of m.bridges) {
      const cy = (br.y0 + br.y1) / 2;
      if (Math.abs(y - cy) < 5 && x > br.x0 - 8 && x < br.x1 + 8) return true;
    }
    for (const f of m.oreFields) if (Math.hypot(x - f.cx, y - f.cy) < f.r + 2.5) return true;
    return false;
  };

  const trees = ["tree_pine", "tree_pineTall", "tree_oak", "tree_default"] as const;
  const cs = m.cellSize;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (m.terrain[i] !== Terrain.Grass || keepClear(x, y)) continue;
      const forest = noise(x / 9, y / 9);
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y) < 4 ? 0.25 : 0;
      if (forest + edge > 0.68 && rng.next() < 0.55) {
        m.blocked[i] = 1;
        m.props.push({
          model: forest > 0.8 ? rng.pick(["tree_pine", "tree_pineTall"]) : rng.pick(trees),
          x: (x + 0.5 + rng.range(-0.25, 0.25)) * cs,
          z: (y + 0.5 + rng.range(-0.25, 0.25)) * cs,
          rot: rng.range(0, Math.PI * 2),
          scale: rng.range(0.85, 1.25),
        });
      } else if (forest < 0.12 && rng.next() < 0.12) {
        m.blocked[i] = 1;
        m.props.push({
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
