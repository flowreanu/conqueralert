import { AbstractMesh, Color3, InstancedMesh, Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, TransformNode } from "./babylon";
import buildingsData from "../data/buildings.json";
import factionsData from "../data/factions.json";
import { Building, Unit, UNIT_DEFS, World, angleDiff } from "../sim/world";
import { ModelLibrary, solidMaterial } from "./models";
import { buildingTargetMeters, unitTarget } from "./scaleMath";
import { groundHeight } from "./terrain";

interface UnitView {
  root: TransformNode;
  ring: InstancedMesh;
  ready: boolean;
}

const BUILDINGS = buildingsData as Record<string, { name: string; size: string; models: Record<string, string[]> }>;
const FACTIONS = factionsData as Record<string, { primary: string; dark: string }>;

/** Sincronizează lumea simulată cu scena Babylon (interpolare între tick-uri). */
export class EntityRenderer {
  private views = new Map<number, UnitView>();
  private ringSrc: Mesh;
  selected = new Set<number>();

  constructor(private scene: Scene, private lib: ModelLibrary, private world: World, private shadows: ShadowGenerator | null) {
    this.ringSrc = MeshBuilder.CreateTorus("selRing", { diameter: 2, thickness: 0.12, tessellation: 36 }, scene);
    const rm = new StandardMaterial("selRingMat", scene);
    rm.emissiveColor = Color3.FromHexString("#7dff6a");
    rm.diffuseColor = Color3.Black();
    rm.disableLighting = true;
    this.ringSrc.material = rm;
    this.ringSrc.isPickable = false;
    this.ringSrc.position.y = -1000;
  }

  async addUnit(u: Unit) {
    const def = UNIT_DEFS[u.type];
    const t = unitTarget(def.scale);
    const root = new TransformNode(`unit${u.id}`, this.scene);
    const ring = this.ringSrc.createInstance(`ring${u.id}`);
    ring.scaling.setAll(def.radius * 1.15);
    ring.parent = root;
    ring.position.y = 0.08;
    ring.setEnabled(false);
    const view: UnitView = { root, ring, ready: false };
    this.views.set(u.id, view);
    const model = await this.lib.instance(def.model, u.faction, t.size, t.measure, `u${u.id}`);
    model.parent = root;
    this.castShadows(model);
    view.ready = true;
  }

  async addBuilding(b: Building) {
    const def = BUILDINGS[b.type];
    const cs = this.world.map.cellSize;
    const fp = b.cells * cs;
    const root = new TransformNode(`bld${b.id}`, this.scene);
    root.position.set((b.cx + b.cells / 2) * cs, 0, (b.cy + b.cells / 2) * cs);
    root.rotation.y = b.owner === 0 ? 0 : Math.PI; // SUA cu fața spre est, URSS spre vest

    // Fundație de beton cu bordură în culoarea facțiunii (clădirile city-kit nu se recolorează)
    const fc = FACTIONS[b.faction];
    const slab = MeshBuilder.CreateBox(`slab${b.id}`, { width: fp - 0.2, depth: fp - 0.2, height: 0.24 }, this.scene);
    slab.material = this.cachedMat(`slabMat`, "#9a978f");
    slab.position.y = 0.12;
    slab.parent = root;
    const edge = MeshBuilder.CreateBox(`edge${b.id}`, { width: fp, depth: fp, height: 0.14 }, this.scene);
    edge.material = this.cachedMat(`edge-${b.faction}`, fc.primary);
    edge.position.y = 0.07;
    edge.parent = root;
    for (const m of [slab, edge]) { m.receiveShadows = true; m.isPickable = false; }

    const models = def.models[b.faction] ?? def.models[Object.keys(def.models)[0]];
    const target = buildingTargetMeters(def.size);
    const layout = models.length === 1 ? [{ s: 1, ox: 0, oz: 0 }] : [{ s: 0.7, ox: -0.14, oz: -0.12 }, { s: 0.42, ox: 0.27, oz: 0.27 }];
    await Promise.all(
      models.map(async (id, i) => {
        const l = layout[i] ?? layout[layout.length - 1];
        const inst = await this.lib.instance(id, b.faction, target * l.s, "footprint", `b${b.id}-${i}`);
        inst.parent = root;
        inst.position.set(l.ox * fp, 0.24, l.oz * fp);
        this.castShadows(inst);
      }),
    );
  }

  private matCache = new Map<string, StandardMaterial>();
  private cachedMat(key: string, hex: string) {
    let m = this.matCache.get(key);
    if (!m) { m = solidMaterial(this.scene, key, hex); this.matCache.set(key, m); }
    return m;
  }

  private castShadows(node: TransformNode) {
    if (!this.shadows) return;
    for (const m of node.getChildMeshes(false)) this.shadows.addShadowCaster(m as AbstractMesh, false);
  }

  /** alpha = fracțiunea dintre tick-ul anterior și cel curent. */
  sync(alpha: number) {
    const m = this.world.map;
    for (const [id, v] of this.views) {
      const u = this.world.units.get(id);
      if (!u) { v.root.dispose(); this.views.delete(id); continue; }
      const x = u.prevX + (u.x - u.prevX) * alpha;
      const z = u.prevZ + (u.z - u.prevZ) * alpha;
      const h = u.prevHeading + angleDiff(u.heading, u.prevHeading) * alpha;
      v.root.position.set(x, groundHeight(m, x, z), z);
      v.root.rotation.y = -h; // Babylon e left-handed: heading spre +z ⇒ rotație negativă în jurul Y
      v.ring.setEnabled(this.selected.has(id));
    }
  }
}
