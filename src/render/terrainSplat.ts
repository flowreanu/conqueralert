import { Material, MaterialPluginBase, RawTexture, Scene, Texture } from "./babylon";
import { GameMap, Terrain } from "../map/gameMap";

/**
 * Texturile terenului (S4.2): iarba (ambientCG Ground068) dă doar *detaliu* peste culorile stilizate pe vârfuri
 * (păstrăm aspectul low-poly curat), iar celelalte straturi se amestecă după o hartă de ponderi pe celule:
 *   R = pietriș (pământ bătătorit în baze, marginea drumurilor, în jurul minereului)
 *   G = pietre / nisip (malurile și albia râului)
 *   B = pavaj (piețele orașelor)
 *   A = sol de pădure (sub copaci)
 * Totul în shader (plugin de material), la rezoluția ecranului → clar la orice zoom.
 */

/** Culorile medii ale texturilor (calculate la import) → detaliul nu schimbă nuanța medie. */
const MEAN = { grass: [0.4348, 0.3583, 0.1678], gravel: [0.4594, 0.4038, 0.3379] };

let tex: Record<string, Texture> | null = null;
let world = [1, 1];

class TerrainSplatPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "TerrainSplat", 250, { TERRAINSPLAT: false });
    this._enable(true);
  }
  getClassName() { return "TerrainSplatPlugin"; }
  isCompatible(lang: number) { return lang === 0; }
  prepareDefines(defines: Record<string, unknown>) { defines.TERRAINSPLAT = !!tex; }
  getSamplers(s: string[]) { s.push("tsSplat", "tsGrass", "tsGravel", "tsRocks", "tsPaving", "tsForest"); }
  getUniforms() {
    return {
      ubo: [{ name: "tsWorld", size: 2, type: "vec2" }, { name: "tsGrassMean", size: 3, type: "vec3" }, { name: "tsGravelMean", size: 3, type: "vec3" }],
      fragment: "#ifdef TERRAINSPLAT\nuniform vec2 tsWorld;\nuniform vec3 tsGrassMean;\nuniform vec3 tsGravelMean;\n#endif\n",
    };
  }
  bindForSubMesh(ubo: { updateFloat2(n: string, x: number, y: number): void; updateFloat3(n: string, x: number, y: number, z: number): void; setTexture(n: string, t: unknown): void }) {
    if (!tex) return;
    ubo.updateFloat2("tsWorld", world[0], world[1]);
    ubo.updateFloat3("tsGrassMean", MEAN.grass[0], MEAN.grass[1], MEAN.grass[2]);
    ubo.updateFloat3("tsGravelMean", MEAN.gravel[0], MEAN.gravel[1], MEAN.gravel[2]);
    ubo.setTexture("tsSplat", tex.splat);
    ubo.setTexture("tsGrass", tex.grass);
    ubo.setTexture("tsGravel", tex.gravel);
    ubo.setTexture("tsRocks", tex.rocks);
    ubo.setTexture("tsPaving", tex.paving);
    ubo.setTexture("tsForest", tex.forest);
  }
  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: "#ifdef TERRAINSPLAT\nuniform sampler2D tsSplat;\nuniform sampler2D tsGrass;\nuniform sampler2D tsGravel;\nuniform sampler2D tsRocks;\nuniform sampler2D tsPaving;\nuniform sampler2D tsForest;\n#endif\n",
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `
#ifdef TERRAINSPLAT
{
  vec2 tp = vPositionW.xz;
  vec4 sp = texture2D(tsSplat, tp / tsWorld);
  // iarba la două scări (ascunde repetiția), folosită ca detaliu peste culoarea stilizată
  vec3 g = mix(texture2D(tsGrass, tp / 7.0).rgb, texture2D(tsGrass, tp.yx / 23.0 + 0.37).rgb, 0.45) / tsGrassMean;
  vec3 base = baseColor.rgb * mix(vec3(1.0), clamp(g, 0.3, 1.9), 0.55);
  vec3 gravel = texture2D(tsGravel, tp / 6.5).rgb;
  vec3 gravelT = baseColor.rgb * mix(vec3(1.0), gravel / tsGravelMean, 0.6) * 0.55 + gravel * 0.55;
  base = mix(base, gravelT, sp.r);
  base = mix(base, texture2D(tsRocks, tp / 5.0).rgb * 1.08, sp.g);
  base = mix(base, texture2D(tsForest, tp / 6.0).rgb * 0.85, sp.a * 0.85);
  base = mix(base, texture2D(tsPaving, tp / 4.5).rgb * 0.92, sp.b);
  baseColor.rgb = base;
}
#endif
`,
    };
  }
}

const RES = 2;

/** Harta de ponderi (RGBA, 2 texeli / celulă, netezită). */
function splatData(m: GameMap): Uint8Array {
  const W = m.width * RES, H = m.height * RES;
  const ch = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
  const set = (c: number, x: number, y: number, v: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    ch[c][i] = Math.max(ch[c][i], v);
  };
  const disc = (c: number, cx: number, cy: number, r: number, v: number, soft = 0.4) => {
    const R = Math.ceil(r * RES);
    for (let dy = -R; dy <= R; dy++)
      for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / RES;
        if (d > r) continue;
        const k = Math.min(1, (r - d) / Math.max(0.01, r * soft));
        set(c, Math.round(cx * RES) + dx, Math.round(cy * RES) + dy, v * k);
      }
  };
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const i = y * m.width + x;
      const t = m.terrain[i];
      const rocks = t === Terrain.Sand ? 0.9 : t === Terrain.Water ? 1 : 0;
      // drumurile: pietriș pe acostament (sub plăci nu se vede)
      const road = m.roads[i] ? 0.55 : 0;
      for (let sy = 0; sy < RES; sy++)
        for (let sx = 0; sx < RES; sx++) {
          if (rocks) set(1, x * RES + sx, y * RES + sy, rocks);
          if (road) set(0, x * RES + sx, y * RES + sy, road);
        }
    }
  // bazele: pământ bătătorit
  for (const b of m.bases) disc(0, b.cx + 0.5, b.cy + 0.5, 15, 0.75, 0.55);
  // în jurul minereului
  for (const f of m.oreFields) disc(0, f.cx, f.cy, f.r + 2.2, 0.6, 0.5);
  // piețele orașelor
  for (const p of m.plazas) disc(2, p.cx, p.cy, p.r, 1, 0.35);
  // solul de pădure sub copaci
  const cs = m.cellSize;
  for (const p of m.props) if (p.model.startsWith("tree")) disc(3, p.x / cs, p.z / cs, 2.2, 0.9, 0.6);

  // netezire (blur separabil, rază 1, de 2 ori)
  const tmp = new Float32Array(W * H);
  for (const a of ch)
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let d = -1; d <= 1; d++) { const nx = x + d; if (nx >= 0 && nx < W) { s += a[y * W + nx]; n++; } } tmp[y * W + x] = s / n; }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let d = -1; d <= 1; d++) { const ny = y + d; if (ny >= 0 && ny < H) { s += tmp[ny * W + x]; n++; } } a[y * W + x] = s / n; }
    }
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round(Math.min(1, ch[c][i]) * 255);
  return out;
}

/** Atașează texturile la materialul terenului. */
export function applyTerrainTextures(scene: Scene, material: Material, m: GameMap) {
  const base = import.meta.env.BASE_URL + "textures/";
  const load = (n: string) => {
    const t = new Texture(base + n + ".jpg", scene);
    t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
    t.anisotropicFilteringLevel = 8;
    return t;
  };
  const W = m.width * RES, H = m.height * RES;
  const splat = RawTexture.CreateRGBATexture(splatData(m), W, H, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  splat.wrapU = splat.wrapV = Texture.CLAMP_ADDRESSMODE;
  tex = { splat, grass: load("grass"), gravel: load("gravel"), rocks: load("rocks"), paving: load("paving"), forest: load("forest") };
  world = [m.width * m.cellSize, m.height * m.cellSize];
  new TerrainSplatPlugin(material);
}
