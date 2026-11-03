import type { GameMap, Prop } from "./gameMap";
import { Terrain, idx, inBounds } from "./gameMap";
import type { Rng } from "./rng";

/**
 * Decor urban (S4.2), în stilul hărților din RA2/RA3: șosele care trec peste poduri, drumuri pe maluri,
 * intrări spre baze și orășele la intersecții (case cu garduri, clădiri comerciale, felinare, mașini parcate).
 * Drumurile sunt doar vizuale (nu blochează); clădirile civile și mașinile parcate blochează celulele, ca un copac.
 */

/** Mărimea modelelor Kenney în unitățile lor (x, y, z), măsurată din fișiere. */
const SIZE: Record<string, [number, number, number]> = {
  "cars/delivery": [1.5, 1.65, 3.25], "cars/police": [1.5, 1.3, 3.1], "cars/suv": [1.5, 1.3, 2.7], "cars/taxi": [1.5, 1.5, 2.75],
  "cars/truck": [1.5, 1.3, 2.95], "cars/van": [1.5, 1.35, 2.75], "cars/ambulance": [1.5, 1.8, 3.25], "cars/firetruck": [1.5, 1.7, 3.4],
  "commercial/building-a": [0.88, 1.29, 0.94], "commercial/building-b": [0.97, 1.29, 0.94], "commercial/building-c": [0.88, 0.89, 1.09],
  "commercial/building-d": [0.84, 1.29, 0.9], "commercial/building-e": [1.64, 0.89, 1.01], "commercial/building-f": [0.84, 1.69, 1.03],
  "commercial/building-g": [0.97, 1.69, 0.92], "commercial/building-h": [0.88, 1.29, 1.01],
  "suburban/building-type-a": [1.3, 0.83, 1.03], "suburban/building-type-b": [1.83, 1.14, 1.14], "suburban/building-type-c": [1.29, 1.03, 1.03],
  "suburban/building-type-d": [1.76, 1.24, 1.03], "suburban/building-type-e": [1.3, 1.14, 1.03], "suburban/building-type-f": [1.43, 1.14, 1.41],
  "suburban/building-type-g": [1.45, 0.77, 1.18], "suburban/building-type-h": [1.3, 0.74, 0.92], "suburban/building-type-k": [0.92, 1.15, 1.02],
  "suburban/building-type-m": [1.43, 0.74, 1.43], "suburban/building-type-o": [1.27, 1.14, 1.03], "suburban/building-type-q": [1.24, 0.92, 0.89],
  "suburban/building-type-s": [1.41, 1.14, 1.09],
};
/** Scara fiecărui kit (metri per unitate Kenney) — trebuie să fie aceeași ca `unitScale` din models.json. */
export const KIT_SCALE: Record<string, number> = { roads: 6, suburban: 5, commercial: 7, cars: 1.55 };
export const ROAD_TILE = 6; // m
const ROAD_HALF = 3.2;

const COMMERCIAL = ["building-a", "building-b", "building-c", "building-d", "building-e", "building-f", "building-g", "building-h"].map((n) => `commercial/${n}`);
const HOUSES = ["a", "b", "c", "d", "e", "f", "g", "h", "k", "m", "o", "q", "s"].map((n) => `suburban/building-type-${n}`);
const CARS = ["cars/van", "cars/delivery", "cars/taxi", "cars/suv", "cars/truck", "cars/police"];

/** id-ul modelului din models.json pentru un fișier Kenney (kit/nume). */
export const kenneyId = (k: string) => `k_${k.replace("/", "_")}`;

/** Unghiul (rotație Y în Babylon) care întoarce axa +z a modelului spre direcția (dx, dz). */
const faceDir = (dx: number, dz: number) => Math.atan2(dx, dz);

interface Run { axis: "x" | "z"; at: number; from: number; to: number }

export function buildDecor(m: GameMap, rng: Rng) {
  const cs = m.cellSize;
  const W = m.width * cs;
  const roads = new Uint8Array(m.width * m.height);
  const props: Prop[] = [];
  const add = (k: string, x: number, z: number, rot: number, scale = 1, sx?: number) =>
    props.push({ model: kenneyId(k), x, z, rot, scale, ...(sx ? { sx } : {}) });

  const water = (x: number, z: number) => {
    const cx = Math.floor(x / cs), cy = Math.floor(z / cs);
    if (!inBounds(m, cx, cy)) return true;
    const t = m.terrain[idx(m, cx, cy)];
    return t === Terrain.Water || t === Terrain.Bridge;
  };

  // ── rețeaua de drumuri ──
  const bz = m.bridges.map((b) => ((b.y0 + b.y1 + 1) / 2) * cs).sort((a, b) => a - b); // centrele podurilor (m)
  const [zN, zS] = [bz[0], bz[1]];
  const vx = [Math.round((W * 0.33) / ROAD_TILE) * ROAD_TILE + 3, 0];
  vx[1] = W - vx[0];
  const west = m.bases.reduce((a, b) => (a.cx < b.cx ? a : b)), east = m.bases.reduce((a, b) => (a.cx > b.cx ? a : b));
  const spurW = { x: vx[0], z: (west.cy + 0.5) * cs, to: (west.cx + 0.5) * cs + 20 };
  const spurE = { x: vx[1], z: (east.cy + 0.5) * cs, to: (east.cx + 0.5) * cs - 20 };

  // noduri fixe (intersecții): [x, z, model, unghi]
  const nodes: [number, number, string, number][] = [
    [vx[0], zN, "roads/road-intersection", faceDir(0, 1)],
    [vx[1], zN, "roads/road-intersection", faceDir(0, 1)],
    [vx[0], zS, "roads/road-intersection", faceDir(0, -1)],
    [vx[1], zS, "roads/road-intersection", faceDir(0, -1)],
    [spurW.x, spurW.z, "roads/road-intersection", faceDir(-1, 0)],
    [spurE.x, spurE.z, "roads/road-intersection", faceDir(1, 0)],
  ];
  for (const [x, z, k, r] of nodes) add(k, x, z, r);

  const runs: Run[] = [];
  const h = ROAD_TILE / 2;
  // șoselele est–vest (trec peste poduri), întrerupte la intersecții
  for (const z of [zN, zS]) {
    const cuts = [0, vx[0] - h, vx[0] + h, vx[1] - h, vx[1] + h, W];
    for (let i = 0; i < cuts.length; i += 2) runs.push({ axis: "x", at: z, from: cuts[i], to: cuts[i + 1] });
  }
  // drumurile nord–sud de pe fiecare mal + intrările spre baze
  runs.push({ axis: "z", at: vx[0], from: zN + h, to: spurW.z - h }, { axis: "z", at: vx[0], from: spurW.z + h, to: zS - h });
  runs.push({ axis: "z", at: vx[1], from: zN + h, to: spurE.z - h }, { axis: "z", at: vx[1], from: spurE.z + h, to: zS - h });
  runs.push({ axis: "x", at: spurW.z, from: spurW.to, to: spurW.x - h }, { axis: "x", at: spurE.z, from: spurE.x + h, to: spurE.to });

  const placed: { x: number; z: number; dir: "x" | "z" }[] = []; // centrele plăcilor (pentru felinare)
  for (const r of runs) {
    // tăiem porțiunile de apă / pod (podul are tablierul lui)
    const step = 1;
    let start: number | null = null;
    const pieces: [number, number][] = [];
    for (let s = r.from; s <= r.to + 1e-6; s += step) {
      const [x, z] = r.axis === "x" ? [s, r.at] : [r.at, s];
      const wet = water(x, z) || water(r.axis === "x" ? x : x - ROAD_HALF, r.axis === "x" ? z - ROAD_HALF : z) || water(r.axis === "x" ? x : x + ROAD_HALF, r.axis === "x" ? z + ROAD_HALF : z);
      if (!wet && start === null) start = s;
      if ((wet || s + step > r.to + 1e-6) && start !== null) { pieces.push([start, wet ? s - step : r.to]); start = null; }
    }
    for (const [a, b] of pieces) {
      const L = b - a;
      if (L < 2) continue;
      const n = Math.max(1, Math.round(L / ROAD_TILE));
      const len = L / n;
      for (let i = 0; i < n; i++) {
        const c = a + len * (i + 0.5);
        const [x, z] = r.axis === "x" ? [c, r.at] : [r.at, c];
        add("roads/road-straight", x, z, r.axis === "x" ? 0 : Math.PI / 2, 1, len / ROAD_TILE);
        placed.push({ x, z, dir: r.axis });
      }
    }
  }
  // masca drumurilor (fără copaci / clădiri pe ele)
  const markRect = (x0: number, z0: number, x1: number, z1: number) => {
    for (let cy = Math.floor(z0 / cs); cy <= Math.floor(z1 / cs); cy++)
      for (let cx = Math.floor(x0 / cs); cx <= Math.floor(x1 / cs); cx++) if (inBounds(m, cx, cy)) roads[idx(m, cx, cy)] = 1;
  };
  for (const p of placed) {
    const hw = ROAD_TILE / 2 + 0.6;
    if (p.dir === "x") markRect(p.x - hw, p.z - ROAD_HALF, p.x + hw, p.z + ROAD_HALF);
    else markRect(p.x - ROAD_HALF, p.z - hw, p.x + ROAD_HALF, p.z + hw);
  }
  for (const [x, z] of nodes) markRect(x - ROAD_HALF, z - ROAD_HALF, x + ROAD_HALF, z + ROAD_HALF);

  // ── felinare de-a lungul drumurilor (alternativ pe o parte și pe alta) ──
  placed.forEach((p, i) => {
    if (i % 3 !== 0) return;
    const side = (i / 3) % 2 === 0 ? 1 : -1;
    const off = ROAD_HALF + 0.4;
    const [x, z] = p.dir === "x" ? [p.x, p.z + off * side] : [p.x + off * side, p.z];
    if (water(x, z)) return;
    // brațul felinarului (+z în model) spre drum
    add("roads/light-square", x, z, p.dir === "x" ? faceDir(0, -side) : faceDir(-side, 0));
  });

  // ── orășele la intersecțiile drumurilor de pe maluri ──
  const towns = nodes.slice(0, 4).map(([x, z]) => ({ x, z }));
  const plazas = towns.map((t) => ({ cx: t.x / cs, cy: t.z / cs, r: 5.5 }));
  const nearBase = (x: number, z: number) => m.bases.some((b) => Math.hypot(x / cs - b.cx, z / cs - b.cy) < 20);
  const nearOre = (x: number, z: number) => m.oreFields.some((f) => Math.hypot(x / cs - f.cx, z / cs - f.cy) < f.r + 3);
  const nearBridge = (x: number, z: number) => m.bridges.some((b) => Math.abs(z / cs - (b.y0 + b.y1 + 1) / 2) < 6 && x / cs > b.x0 - 6 && x / cs < b.x1 + 7);
  const occupied = new Uint8Array(m.width * m.height);

  /** Ocupă amprenta (dreptunghi rotit cu 0 / 90°) dacă e liberă; întoarce false altfel. */
  const claim = (x: number, z: number, w: number, d: number, alongX: boolean, block: boolean) => {
    const [hx, hz] = alongX ? [w / 2, d / 2] : [d / 2, w / 2];
    const cells: number[] = [];
    for (let cy = Math.floor((z - hz) / cs); cy <= Math.floor((z + hz - 0.01) / cs); cy++)
      for (let cx = Math.floor((x - hx) / cs); cx <= Math.floor((x + hx - 0.01) / cs); cx++) {
        if (!inBounds(m, cx, cy)) return false;
        const i = idx(m, cx, cy);
        if (m.terrain[i] !== Terrain.Grass || roads[i] || occupied[i] || m.blocked[i]) return false;
        cells.push(i);
      }
    for (const i of cells) { occupied[i] = 1; if (block) m.blocked[i] = 1; }
    return true;
  };

  for (const t of towns) {
    for (const p of placed) {
      const dist = Math.hypot(p.x - t.x, p.z - t.z);
      if (dist > 52 || dist < 6) continue;
      for (const side of [1, -1]) {
        if (rng.next() < 0.12) continue;
        const commercial = dist < 24 && rng.next() < 0.75;
        const k = commercial ? rng.pick(COMMERCIAL) : rng.pick(HOUSES);
        const kit = k.split("/")[0];
        const [sx, , sz] = SIZE[k];
        const w = sx * KIT_SCALE[kit], d = sz * KIT_SCALE[kit];
        const off = ROAD_HALF + 1.2 + d / 2 + (commercial ? 0 : 1.5);
        const [x, z] = p.dir === "x" ? [p.x, p.z + off * side] : [p.x + off * side, p.z];
        if (nearBase(x, z) || nearOre(x, z) || nearBridge(x, z)) continue;
        const along = p.dir === "x";
        if (!claim(x, z, w + 1, d + 0.5, along, true)) continue;
        // fața clădirii (+z în model) spre drum
        const rot = along ? faceDir(0, -side) : faceDir(-side, 0);
        // varianta de culoare (0 = paleta originală Kenney)
        const variant = rng.int(0, 4);
        props.push({ model: variant ? kenneyId(k).replace(`k_${kit}_`, `k_${kit}${variant}_`) : kenneyId(k), x, z, rot, scale: 1 });
        if (commercial) continue;
        // curtea: gard în spate, uneori o mașină pe alee și un copac
        const back = d / 2 + 1.4;
        const [fx, fz] = along ? [x, z + back * side] : [x + back * side, z];
        if (claim(fx, fz, w, 0.8, along, false)) add("suburban/fence-1x4", fx, fz, along ? 0 : Math.PI / 2, (w / (1.68 * KIT_SCALE.suburban)) * 1.05);
        if (rng.next() < 0.45) {
          const sideOff = w / 2 + 1.7;
          const [cx, cz] = along ? [x + sideOff, z - (d / 2 - 2.2) * side] : [x - (d / 2 - 2.2) * side, z + sideOff];
          const car = rng.pick(CARS);
          if (claim(cx, cz, 2.4, 4.6, !along, true)) add(car, cx, cz, along ? faceDir(0, -side) : faceDir(-side, 0));
        } else if (rng.next() < 0.6) {
          const [tx, tz] = along ? [x - w / 2 - 1.6, z] : [x, z - w / 2 - 1.6];
          if (claim(tx, tz, 1.6, 1.6, along, true)) props.push({ model: "k_suburban_tree-large", x: tx, z: tz, rot: rng.range(0, 6.28), scale: rng.range(0.9, 1.2) });
        }
      }
    }
  }
  // piețele: felinare duble în colțuri
  for (const t of towns)
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const x = t.x + dx * (ROAD_HALF + 1.6), z = t.z + dz * (ROAD_HALF + 1.6);
      if (!water(x, z)) add("roads/light-square-double", x, z, faceDir(-dx, 0));
    }

  m.props.push(...props);
  return { roads, occupied, plazas };
}
