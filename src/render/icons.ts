/**
 * Pictogramele („cameo”) din sidebar: fotografii izometrice ale modelelor reale, în culorile facțiunii.
 * Se generează o singură dată, într-o scenă separată (același Engine), cu fundal transparent.
 */
import {
  Color3, Color4, CreateScreenshotUsingRenderTargetAsync, DirectionalLight, Engine, HemisphericLight, MeshBuilder,
  Scene, TargetCamera, TransformNode, Vector3,
} from "./babylon";
import buildingsData from "../data/buildings.json";
import factionsData from "../data/factions.json";
import { UNIT_DEFS } from "../sim/world";
import { MODEL_DEFS, ModelLibrary, solidMaterial } from "./models";
import { buildingTargetMeters, unitTarget } from "./scaleMath";

const BUILDINGS = buildingsData as unknown as Record<string, { size: string; models: Record<string, string[]> }>;
const FACTIONS = factionsData as Record<string, { primary: string }>;
const W = 240, H = 180;

export async function renderIcons(engine: Engine, faction: string, items: string[], onIcon: (item: string, url: string) => void) {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.imageProcessingConfiguration.toneMappingEnabled = true;
  scene.imageProcessingConfiguration.exposure = 1.1;
  scene.imageProcessingConfiguration.contrast = 1.2;
  const hemi = new HemisphericLight("ih", new Vector3(0.3, 1, -0.4), scene);
  hemi.intensity = 0.75;
  hemi.groundColor = new Color3(0.3, 0.33, 0.38);
  const sun = new DirectionalLight("is", new Vector3(-0.4, -0.8, 0.5).normalize(), scene);
  sun.intensity = 1.5;
  const rim = new DirectionalLight("ir", new Vector3(0.6, -0.2, -0.8).normalize(), scene);
  rim.intensity = 0.45;
  rim.diffuse = Color3.FromHexString("#9fdcff");
  const cam = new TargetCamera("ic", new Vector3(0, 10, -10), scene);
  cam.mode = 1; // ortografică
  cam.minZ = 0.1;
  cam.maxZ = 500;
  const lib = new ModelLibrary(scene);
  const dir = new Vector3(-0.62, 0.56, -0.55).normalize(); // de sus, din stânga-față
  const fc = FACTIONS[faction]?.primary ?? "#888888";

  for (const item of items) {
    const root = new TransformNode(`icon-${item}`, scene);
    let anim: { dispose(): void } | null = null;
    try {
      const bdef = BUILDINGS[item];
      if (bdef) {
        const cs = 2;
        const cells = bdef.size === "small" ? 2 : bdef.size === "medium" ? 3 : 4;
        const fp = cells * cs;
        const slab = MeshBuilder.CreateBox("is", { width: fp - 0.2, depth: fp - 0.2, height: 0.24 }, scene);
        slab.material = solidMaterial(scene, "islab", "#9a978f");
        slab.position.y = 0.12;
        const edge = MeshBuilder.CreateBox("ie", { width: fp, depth: fp, height: 0.14 }, scene);
        edge.material = solidMaterial(scene, "iedge", fc);
        edge.position.y = 0.07;
        slab.parent = edge.parent = root;
        const models = bdef.models[faction] ?? Object.values(bdef.models)[0];
        const target = buildingTargetMeters(bdef.size);
        const layout = models.length === 1 ? [{ s: 1, ox: 0, oz: 0 }] : [{ s: 0.7, ox: -0.14, oz: -0.12 }, { s: 0.42, ox: 0.27, oz: 0.27 }];
        await Promise.all(models.map(async (id, i) => {
          const l = layout[i] ?? layout[layout.length - 1];
          const inst = await lib.instance(id, faction, target * l.s, "footprint", `ib-${item}-${i}`);
          inst.parent = root;
          inst.position.set(l.ox * fp, 0.24, l.oz * fp);
        }));
        root.rotation.y = Math.PI; // fața clădirii spre cameră
      } else {
        const def = UNIT_DEFS[item];
        if (!def) continue;
        const t = unitTarget(def.scale);
        if (MODEL_DEFS[def.model]?.animated) {
          const a = await lib.animatedInstance(def.model, faction, t.size, t.measure, `iu-${item}`);
          a.root.parent = root;
          const idle = a.anims.get("Idle_Shoot") ?? a.anims.get("Idle");
          if (idle) { idle.start(false, 1); idle.goToFrame(idle.to * 0.3); idle.pause(); }
          anim = a;
        } else {
          const m = await lib.instance(def.model, faction, t.size, t.measure, `iu-${item}`);
          m.parent = root;
          if (def.rig === "v3") addMissile(scene, root);
          if (def.rig === "mg") {
            const b = m.getHierarchyBoundingVectors(true);
            const mat = solidMaterial(scene, "imgm", "#2c2f2b");
            const ring = MeshBuilder.CreateCylinder("imgr", { height: 0.22, diameter: 0.9, tessellation: 10 }, scene);
            ring.position.set(-(b.max.x - b.min.x) * 0.08, b.max.y + 0.06, 0);
            const gun = MeshBuilder.CreateCylinder("imgt", { height: 1.15, diameter: 0.09, tessellation: 6 }, scene);
            gun.rotation.z = -Math.PI / 2;
            gun.position.set(ring.position.x + 0.85, b.max.y + 0.37, 0);
            ring.material = gun.material = mat;
            ring.parent = gun.parent = root;
          }
        }
        root.rotation.y = -Math.PI * 0.9; // botul spre cameră, ușor din profil
      }
      // încadrare: cutia modelului proiectată pe planul camerei
      root.computeWorldMatrix(true);
      const { min, max } = root.getHierarchyBoundingVectors(true);
      const center = min.add(max).scale(0.5);
      cam.position = center.add(dir.scale(80));
      cam.setTarget(center);
      cam.computeWorldMatrix();
      const view = cam.getViewMatrix();
      let hw = 0, hh = 0;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        const p = Vector3.TransformCoordinates(new Vector3(x, y, z), view);
        hw = Math.max(hw, Math.abs(p.x)); hh = Math.max(hh, Math.abs(p.y));
      }
      const pad = 1.1;
      const half = Math.max(hw, (hh * W) / H) * pad;
      cam.orthoLeft = -half; cam.orthoRight = half;
      cam.orthoTop = (half * H) / W; cam.orthoBottom = (-half * H) / W;
      scene.activeCamera = cam;
      const url = await CreateScreenshotUsingRenderTargetAsync(engine, cam, { width: W, height: H }, "image/png", 4, true);
      onIcon(item, url);
    } catch (e) {
      console.warn("Pictogramă eșuată:", item, e);
    } finally {
      anim?.dispose();
      root.dispose(false, false);
    }
  }
  scene.dispose();
}

function addMissile(scene: Scene, root: TransformNode) {
  const pivot = new TransformNode("im", scene);
  pivot.parent = root;
  pivot.position.set(-2.35, 1.55, 0);
  pivot.rotation.z = 0.25;
  const body = MeshBuilder.CreateCylinder("imb", { height: 3.7, diameter: 0.52, tessellation: 10 }, scene);
  body.rotation.z = -Math.PI / 2; body.position.x = 1.85;
  body.material = solidMaterial(scene, "imbm", "#646a5a");
  const nose = MeshBuilder.CreateCylinder("imn", { height: 0.95, diameterTop: 0, diameterBottom: 0.52, tessellation: 10 }, scene);
  nose.rotation.z = -Math.PI / 2; nose.position.x = 4.17;
  nose.material = solidMaterial(scene, "imnm", "#b8352b");
  body.parent = nose.parent = pivot;
}
