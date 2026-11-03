import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, ShadowGenerator, StandardMaterial, Vector3 } from "./babylon";
import { GameMap, ORE_MAX, Terrain } from "../map/gameMap";
import { makeRng } from "../map/rng";

/**
 * Cristale de minereu pe celulele `Terrain.Ore` (thin instances, un draw call).
 * Mărimea lor urmează cantitatea rămasă; celulele epuizate rămân goale.
 */
export class OreRenderer {
  private mesh: Mesh;
  private cells: number[] = [];
  private spots: { x: number; z: number; rot: number; tilt: number; s: number }[][] = [];
  private last: Uint16Array;
  private timer = 0;

  constructor(scene: Scene, private m: GameMap, shadows: ShadowGenerator | null) {
    const gem = MeshBuilder.CreateCylinder("oreGem", { height: 1, diameterTop: 0, diameterBottom: 0.55, tessellation: 5 }, scene);
    gem.position.y = 0.5;
    gem.bakeCurrentTransformIntoVertices();
    const mat = new StandardMaterial("oreMat", scene);
    mat.diffuseColor = Color3.FromHexString("#e2b23a");
    mat.emissiveColor = Color3.FromHexString("#5a3f08");
    mat.specularColor = new Color3(0.9, 0.8, 0.5);
    mat.specularPower = 32;
    gem.material = mat;
    gem.isPickable = false;
    gem.receiveShadows = true;
    this.mesh = gem;
    shadows?.addShadowCaster(gem, false);

    const rng = makeRng(4242);
    const cs = m.cellSize;
    for (let i = 0; i < m.terrain.length; i++) {
      if (m.terrain[i] !== Terrain.Ore) continue;
      const cx = i % m.width, cy = (i / m.width) | 0;
      const n = 2 + (rng.next() < 0.5 ? 1 : 0);
      const list = [];
      for (let k = 0; k < n; k++)
        list.push({
          x: (cx + rng.range(0.2, 0.8)) * cs,
          z: (cy + rng.range(0.2, 0.8)) * cs,
          rot: rng.range(0, Math.PI * 2),
          tilt: rng.range(-0.35, 0.35),
          s: rng.range(0.7, 1.25),
        });
      this.cells.push(i);
      this.spots.push(list);
    }
    this.last = new Uint16Array(m.ore.length);
    this.rebuild();
  }

  private rebuild() {
    const mats: number[] = [];
    const tmp = new Matrix();
    this.cells.forEach((i, k) => {
      const a = this.m.ore[i];
      this.last[i] = a;
      if (a <= 0) return;
      const f = 0.35 + 0.65 * Math.sqrt(a / ORE_MAX);
      for (const s of this.spots[k]) {
        const sc = s.s * f;
        const q = Quaternion.RotationYawPitchRoll(s.rot, s.tilt, s.tilt * 0.6);
        Matrix.ComposeToRef(new Vector3(sc, sc * 1.3, sc), q, new Vector3(s.x, -0.05, s.z), tmp);
        for (let j = 0; j < 16; j++) mats.push(tmp.m[j]);
      }
    });
    this.mesh.thinInstanceSetBuffer("matrix", new Float32Array(mats.length ? mats : Matrix.Compose(Vector3.Zero(), Quaternion.Identity(), new Vector3(0, -50, 0)).m), 16, false);
    this.mesh.thinInstanceRefreshBoundingInfo(false);
  }

  update(dt: number) {
    this.timer += dt;
    if (this.timer < 0.5) return;
    this.timer = 0;
    // reconstruiește doar dacă o celulă a trecut într-o altă „treaptă” de mărime
    for (const i of this.cells)
      if (Math.round(this.m.ore[i] / 40) !== Math.round(this.last[i] / 40) || (this.m.ore[i] === 0) !== (this.last[i] === 0)) { this.rebuild(); return; }
  }
}
