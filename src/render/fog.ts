import { Material, MaterialPluginBase, RawTexture, RegisterMaterialPlugin, Scene, Texture } from "./babylon";
import type { GameMap } from "../map/gameMap";
import { Vis, Vision } from "../sim/vision";

/**
 * Ceața de război în randare (S4): un plugin injectat în TOATE materialele (Standard + PBR) înmulțește culoarea
 * finală cu o textură de vizibilitate eșantionată după poziția în lume (x,z). Teren, copaci, clădiri, efecte —
 * totul se întunecă la fel: negru = neexplorat, semi-întunecat = ceață, normal = vizibil.
 */

let fogTexture: RawTexture | null = null;
let fogWorld = [1, 1];

class FogPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, "FogOfWar", 300, { FOGOFWAR: false });
    this._enable(true);
  }
  getClassName() { return "FogPlugin"; }
  isCompatible(shaderLanguage: number) { return shaderLanguage === 0; } // doar GLSL (WebGL)
  /** doar în scena jocului (nu și în scena separată a pictogramelor) */
  private get active() { return !!fogTexture && fogTexture.getScene() === this._material.getScene(); }
  prepareDefines(defines: Record<string, unknown>) { defines.FOGOFWAR = this.active; }
  getSamplers(samplers: string[]) { samplers.push("fogSampler"); }
  getUniforms() {
    return { ubo: [{ name: "fogWorld", size: 2, type: "vec2" }], fragment: "#ifdef FOGOFWAR\nuniform vec2 fogWorld;\n#endif\n" };
  }
  bindForSubMesh(ubo: { updateFloat2(n: string, x: number, y: number): void; setTexture(n: string, t: unknown): void }) {
    if (!this.active) return;
    ubo.updateFloat2("fogWorld", fogWorld[0], fogWorld[1]);
    ubo.setTexture("fogSampler", fogTexture);
  }
  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") return null;
    const v = this._material.getClassName() === "PBRMaterial" ? "finalColor" : "color";
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: "#ifdef FOGOFWAR\nuniform sampler2D fogSampler;\n#endif\n",
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `#ifdef FOGOFWAR\n${v}.rgb *= texture2D(fogSampler, vPositionW.xz / fogWorld).r;\n#endif\n`,
    };
  }
}

let registered = false;
/** Trebuie apelat înainte de crearea materialelor. */
export function registerFogPlugin() {
  if (registered) return;
  registered = true;
  RegisterMaterialPlugin("FogOfWar", (m) => {
    const c = m.getClassName();
    return c === "StandardMaterial" || c === "PBRMaterial" ? new FogPlugin(m) : null;
  });
}

const RES = 2; // texeli per celulă
const LEVEL: Record<number, number> = { [Vis.Unexplored]: 0, [Vis.Fogged]: 0.5, [Vis.Visible]: 1 };

/** Ține textura de ceață la zi cu `Vision`, cu tranziții line (se „dezvăluie” treptat). */
export class FogRenderer {
  private w: number;
  private h: number;
  private cur: Float32Array;
  private target: Float32Array;
  private data: Uint8Array;
  private seen = -1;
  private dirty = true;

  constructor(scene: Scene, private map: GameMap, private vision: Vision) {
    this.w = map.width * RES;
    this.h = map.height * RES;
    this.cur = new Float32Array(this.w * this.h);
    this.target = new Float32Array(this.w * this.h);
    this.data = new Uint8Array(this.w * this.h * 4);
    fogTexture = RawTexture.CreateRGBATexture(this.data, this.w, this.h, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    fogTexture.wrapU = fogTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    fogWorld = [map.width * map.cellSize, map.height * map.cellSize];
    this.rebuildTarget();
    this.cur.set(this.target);
    this.write();
  }

  private rebuildTarget() {
    const { w, h } = this;
    const m = this.map, st = this.vision.state;
    // eșantionare pe celule + blur 3×3 pe grila fină → margini moi
    const raw = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * w + x] = LEVEL[st[((y / RES) | 0) * m.width + ((x / RES) | 0)]];
    // două treceri de blur separabil (orizontal + vertical) cu rază 2
    const tmp = new Float32Array(w * h);
    let src = raw;
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let s = 0, n = 0;
          for (let d = -2; d <= 2; d++) { const nx = x + d; if (nx >= 0 && nx < w) { s += src[y * w + nx]; n++; } }
          tmp[y * w + x] = s / n;
        }
      const out = pass === 1 ? this.target : raw;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let s = 0, n = 0;
          for (let d = -2; d <= 2; d++) { const ny = y + d; if (ny >= 0 && ny < h) { s += tmp[ny * w + x]; n++; } }
          out[y * w + x] = s / n;
        }
      src = raw;
    }
  }

  private write() {
    const d = this.data;
    for (let i = 0; i < this.cur.length; i++) {
      const v = Math.round(this.cur[i] * 255);
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    fogTexture!.update(d);
  }

  update(dt: number) {
    if (this.vision.version !== this.seen) { this.seen = this.vision.version; this.rebuildTarget(); this.dirty = true; }
    if (!this.dirty) return;
    const k = Math.min(1, dt * 5);
    let moving = false;
    for (let i = 0; i < this.cur.length; i++) {
      const d = this.target[i] - this.cur[i];
      if (d === 0) continue;
      if (Math.abs(d) < 0.01) this.cur[i] = this.target[i];
      else { this.cur[i] += d * k; moving = true; }
    }
    this.write();
    this.dirty = moving;
  }
}
