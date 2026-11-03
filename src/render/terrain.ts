import { Color3, Color4, Mesh, MeshBuilder, Scene, StandardMaterial, VertexData } from "./babylon";
import { GameMap, Terrain, idx, inBounds } from "../map/gameMap";
import { makeNoise } from "../map/rng";
import { solidMaterial } from "./models";

export const WATER_Y = -0.55;
export const BRIDGE_Y = 0.32;

/** Înălțimea solului pentru unități (pe pod stau pe tablier). */
export function groundHeight(m: GameMap, x: number, z: number): number {
  const cx = Math.floor(x / m.cellSize), cy = Math.floor(z / m.cellSize);
  if (inBounds(m, cx, cy) && m.terrain[idx(m, cx, cy)] === Terrain.Bridge) return BRIDGE_Y;
  return 0;
}

/** Câmp scalar per celulă, netezit (box blur), eșantionat biliniar → maluri organice, nu „pixeli”. */
function field(m: GameMap, pred: (t: number) => boolean, passes: number): Float32Array {
  const W = m.width, H = m.height;
  let a = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) a[i] = pred(m.terrain[i]) ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const b = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(W - 1, Math.max(0, x + dx)), ny = Math.min(H - 1, Math.max(0, y + dy));
            s += a[ny * W + nx];
            n++;
          }
        b[y * W + x] = s / n;
      }
    a = b;
  }
  return a;
}
function sample(m: GameMap, f: Float32Array, cx: number, cy: number) {
  const x = Math.min(m.width - 1.001, Math.max(0, cx - 0.5)), y = Math.min(m.height - 1.001, Math.max(0, cy - 0.5));
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const W = m.width;
  const g = (i: number, j: number) => f[Math.min(m.height - 1, j) * W + Math.min(W - 1, i)];
  return g(xi, yi) * (1 - xf) * (1 - yf) + g(xi + 1, yi) * xf * (1 - yf) + g(xi, yi + 1) * (1 - xf) * yf + g(xi + 1, yi + 1) * xf * yf;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function buildTerrain(scene: Scene, m: GameMap): Mesh {
  const SUB = 2; // vârfuri per celulă
  const VW = m.width * SUB + 1, VH = m.height * SUB + 1;
  const cs = m.cellSize;
  const water = field(m, (t) => t === Terrain.Water || t === Terrain.Bridge, 2);
  const sand = field(m, (t) => t === Terrain.Sand || t === Terrain.Water || t === Terrain.Bridge, 2);
  const ore = field(m, (t) => t === Terrain.Ore, 1);
  const noise = makeNoise(77);

  const grassA = Color3.FromHexString("#7aa14c"), grassB = Color3.FromHexString("#4f7a37"), grassC = Color3.FromHexString("#9bb565");
  const sandC = Color3.FromHexString("#c9b783"), mud = Color3.FromHexString("#7d6e4f"), oreC = Color3.FromHexString("#c79a2e");

  const pos: number[] = [], col: number[] = [], ind: number[] = [];
  for (let j = 0; j < VH; j++)
    for (let i = 0; i < VW; i++) {
      const cx = i / SUB, cy = j / SUB;
      const w = sample(m, water, cx, cy);
      const s = sample(m, sand, cx, cy);
      const o = sample(m, ore, cx, cy);
      const n1 = noise(cx / 6, cy / 6), n2 = noise(cx / 1.7 + 50, cy / 1.7);
      const h = -1.6 * smooth(0.25, 0.75, w) + (w < 0.05 ? (n2 - 0.5) * 0.12 : 0);
      pos.push(cx * cs, h, cy * cs);
      let c = Color3.Lerp(grassB, grassA, n1);
      c = Color3.Lerp(c, grassC, Math.max(0, n2 - 0.6) * 1.5);
      c = Color3.Lerp(c, sandC, smooth(0.15, 0.5, s));
      c = Color3.Lerp(c, mud, smooth(0.45, 0.8, w));
      c = Color3.Lerp(c, oreC, smooth(0.2, 0.6, o) * (0.75 + n2 * 0.25));
      col.push(c.r, c.g, c.b, 1);
    }
  for (let j = 0; j < VH - 1; j++)
    for (let i = 0; i < VW - 1; i++) {
      const a = j * VW + i, b = a + 1, c = a + VW, d = c + 1;
      ind.push(a, b, c, b, d, c);
    }
  const vd = new VertexData();
  vd.positions = pos;
  vd.colors = col;
  vd.indices = ind;
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, ind, normals);
  vd.normals = normals;
  const ground = new Mesh("terrain", scene);
  vd.applyToMesh(ground);
  const mat = new StandardMaterial("terrainMat", scene);
  mat.diffuseColor = Color3.White();
  mat.specularColor = new Color3(0.02, 0.02, 0.02);
  ground.material = mat;
  ground.receiveShadows = true;
  ground.isPickable = false;
  ground.freezeWorldMatrix();

  // Apa
  const W = m.width * cs, H = m.height * cs;
  const waterMesh = MeshBuilder.CreateGround("water", { width: W, height: H }, scene);
  waterMesh.position.set(W / 2, WATER_Y, H / 2);
  const wm = new StandardMaterial("waterMat", scene);
  wm.diffuseColor = Color3.FromHexString("#2f6c86");
  wm.specularColor = new Color3(0.5, 0.55, 0.6);
  wm.specularPower = 48;
  wm.alpha = 0.82;
  waterMesh.material = wm;
  waterMesh.isPickable = false;

  // Pământ în afara hărții (să nu se vadă golul la margini)
  const outer = MeshBuilder.CreateGround("outer", { width: W * 4, height: H * 4 }, scene);
  outer.position.set(W / 2, -2.2, H / 2);
  outer.material = solidMaterial(scene, "outerMat", "#3e5a33");
  outer.isPickable = false;

  buildBridges(scene, m);
  scene.clearColor = new Color4(0.55, 0.68, 0.78, 1);
  return ground;
}

function buildBridges(scene: Scene, m: GameMap) {
  const cs = m.cellSize;
  const deck = solidMaterial(scene, "bridgeDeck", "#77736b");
  const rail = solidMaterial(scene, "bridgeRail", "#5c5a55");
  const parts: Mesh[] = [];
  for (const br of m.bridges) {
    const x0 = (br.x0 - 0.6) * cs, x1 = (br.x1 + 1.6) * cs;
    const z0 = br.y0 * cs, z1 = (br.y1 + 1) * cs;
    const len = x1 - x0, wid = z1 - z0;
    const d = MeshBuilder.CreateBox("deck", { width: len, height: 0.5, depth: wid }, scene);
    d.position.set((x0 + x1) / 2, BRIDGE_Y - 0.25, (z0 + z1) / 2);
    d.material = deck;
    parts.push(d);
    for (const z of [z0 + 0.15, z1 - 0.15]) {
      const r = MeshBuilder.CreateBox("rail", { width: len, height: 0.6, depth: 0.25 }, scene);
      r.position.set((x0 + x1) / 2, BRIDGE_Y + 0.3, z);
      r.material = rail;
      parts.push(r);
    }
    for (let x = x0 + 3; x < x1 - 2; x += 5) {
      const p = MeshBuilder.CreateBox("pier", { width: 0.9, height: 2.2, depth: wid * 0.8 }, scene);
      p.position.set(x, BRIDGE_Y - 1.3, (z0 + z1) / 2);
      p.material = rail;
      parts.push(p);
    }
  }
  for (const p of parts) { p.receiveShadows = true; p.isPickable = false; p.freezeWorldMatrix(); }
  return parts;
}
