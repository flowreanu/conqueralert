import {
  AbstractMesh,
  AssetContainer,
  Color3,
  InstancedMesh,
  LoadAssetContainerAsync,
  Material,
  Mesh,
  PBRMaterial,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  SceneLoaderFlags,
} from "./babylon";
import "@babylonjs/loaders/glTF";
import { OBJFileLoader } from "@babylonjs/loaders/OBJ";
import modelsData from "../data/models.json";
import factionsData from "../data/factions.json";
import { fitScale, Measure } from "./scaleMath";

OBJFileLoader.SKIP_MATERIALS = true;
SceneLoaderFlags.ShowLoadingScreen = false; // .obj-urile au texturi lipsă → material de facțiune complet

export interface ModelDef {
  path: string;
  recolor: "cimpletoon" | "kenneySpace" | "quaternius" | "colormap" | "replace" | "none";
  yaw: number;
  noAlign?: boolean;
  height?: number;
  /** suprascrieri: nume material → primary | light | secondary | dark | glass | skin | none (culoarea originală) */
  colors?: Record<string, string>;
}
export const MODEL_DEFS = modelsData as Record<string, ModelDef>;
type FactionColors = { primary: string; secondary: string; dark: string };
const FACTIONS = factionsData as Record<string, FactionColors & { name: string }>;

const GLASS = Color3.FromHexString("#9fd3ee");
const SKIN = Color3.FromHexString("#d9a77f");

/**
 * Încarcă fiecare model o singură dată, îl normalizează (axa lungă pe X, centrat, baza la y=0),
 * îl scalează la mărimea din tabelul de scară și îl recolorează per facțiune.
 * Fiecare unitate e o clonă (geometrie partajată) a unui șablon contopit per (model, facțiune, mărime).
 */
export class ModelLibrary {
  private containers = new Map<string, Promise<AssetContainer>>();
  private templates = new Map<string, Promise<TransformNode>>();
  private materialCache = new Map<string, Material>();
  private overrides: Record<string, string> | undefined;

  constructor(private scene: Scene) {}

  private container(id: string): Promise<AssetContainer> {
    let p = this.containers.get(id);
    if (!p) {
      const def = MODEL_DEFS[id];
      if (!def) throw new Error(`Model necunoscut: ${id}`);
      p = LoadAssetContainerAsync(import.meta.env.BASE_URL + def.path, this.scene).then((c) => {
        c.lights.slice().forEach((l) => l.dispose());
        c.cameras.slice().forEach((cam) => cam.dispose());
        return c;
      });
      this.containers.set(id, p);
    }
    return p;
  }

  /**
   * Șablon ascuns pentru (model, facțiune, mărime țintă).
   * `faction` = null → culorile originale.
   */
  template(id: string, faction: string | null, target: number, measure: Measure): Promise<TransformNode> {
    const key = `${id}|${faction}|${target}|${measure}`;
    let p = this.templates.get(key);
    if (!p) {
      p = this.container(id).then((c) => this.buildTemplate(id, c, faction, target, measure, key));
      this.templates.set(key, p);
    }
    return p;
  }

  async instance(id: string, faction: string | null, target: number, measure: Measure, name: string): Promise<TransformNode> {
    const tpl = await this.template(id, faction, target, measure);
    // clone (geometria e partajată); InstancedMesh nu arunca umbre corect din surse ascunse
    const inst = tpl.instantiateHierarchy(null, { doNotInstantiate: true }, (src, clone) => {
      clone.name = `${name}:${src.name}`;
    })!;
    inst.name = name;
    inst.position.set(0, 0, 0);
    inst.setEnabled(true);
    for (const m of inst.getChildMeshes(false)) m.isVisible = true;
    return inst;
  }

  private buildTemplate(id: string, c: AssetContainer, faction: string | null, target: number, measure: Measure, key: string): TransformNode {
    const def = MODEL_DEFS[id];
    const root = new TransformNode(`tpl:${key}`, this.scene);
    const scaleNode = new TransformNode(`tpl-scale:${key}`, this.scene);
    const align = new TransformNode(`tpl-align:${key}`, this.scene);
    scaleNode.parent = root;
    align.parent = scaleNode;
    const entries = c.instantiateModelsToScene((n) => `${key}:${n}`, true, { doNotInstantiate: true });
    for (const n of entries.rootNodes) n.parent = align;

    // instanțele din glTF (noduri care partajează un mesh) → clone reale, ca să le putem contopi
    for (const m of align.getChildMeshes(false)) {
      if (!(m instanceof InstancedMesh)) continue;
      const c = m.sourceMesh.clone(`${m.name}-real`, m.parent, true)!;
      c.position.copyFrom(m.position);
      c.rotation.copyFrom(m.rotation);
      c.rotationQuaternion = m.rotationQuaternion?.clone() ?? null;
      c.scaling.copyFrom(m.scaling);
      m.dispose();
    }
    const meshes = align.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
    // 1) axa lungă pe X (dacă nu e dezactivat), apoi corecția yaw din models.json
    let b = bounds(align);
    let rot = 0;
    if (!def.noAlign && b.size.z > b.size.x * 1.05) rot = Math.PI / 2;
    align.rotation.y = rot + (def.yaw * Math.PI) / 180;
    // 2) centrare + bază la y=0
    b = bounds(align);
    align.position.set(-b.center.x, -b.min.y, -b.center.z);
    // 3) scară
    b = bounds(align);
    const s = def.height ? def.height / b.size.y : fitScale(b.size, target, measure);
    scaleNode.scaling.setAll(s);

    // 4) recolorare
    this.overrides = def.colors;
    if (faction && def.recolor !== "none" && def.recolor !== "colormap") this.recolor(meshes, def.recolor, FACTIONS[faction], `${id}|${faction}`);
    for (const m of meshes) {
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = false;
      m.receiveShadows = true;
      const mat = m.material;
      if (mat instanceof PBRMaterial && def.recolor !== "colormap") {
        mat.metallic = Math.min(mat.metallic ?? 0, 0.2);
        mat.roughness = Math.max(mat.roughness ?? 1, 0.65);
      }
    }
    // 5) contopire într-un singur mesh (MultiMaterial) → un draw call per material, clonare ieftină
    let finalMeshes: AbstractMesh[] = meshes;
    try {
      // atributele trebuie să fie identice: păstrăm doar intersecția (fără schelet — modelele sunt statice)
      const kinds = (meshes as Mesh[]).map((m) => new Set(m.getVerticesDataKinds()));
      for (const m of meshes as Mesh[]) {
        m.skeleton = null;
        for (const k of m.getVerticesDataKinds()) if (!kinds.every((s) => s.has(k)) || /matrices/i.test(k)) m.removeVerticesData(k);
      }
      const merged = Mesh.MergeMeshes(meshes as Mesh[], true, true, undefined, false, true);
      if (merged) {
        merged.name = `tpl-mesh:${key}`;
        merged.parent = root;
        merged.receiveShadows = true;
        merged.isPickable = false;
        finalMeshes = [merged];
        scaleNode.dispose();
      }
    } catch (e) {
      console.warn(`MergeMeshes a eșuat pentru ${id}`, e);
    }
    for (const m of finalMeshes) m.isVisible = false; // șablonul rămâne ascuns; clonele sunt vizibile
    return root;
  }

  private recolor(meshes: AbstractMesh[], mode: ModelDef["recolor"], fc: FactionColors, key: string) {
    const primary = Color3.FromHexString(fc.primary);
    const secondary = Color3.FromHexString(fc.secondary);
    const dark = Color3.FromHexString(fc.dark);
    for (const m of meshes) {
      const old = m.material;
      const name = (old?.name ?? "").toLowerCase().replace(/^.*?:/, "");
      let color: Color3 | null = null;
      if (mode === "replace") color = primary;
      else if (mode === "kenneySpace") color = name.includes("metalred") ? primary : null;
      else {
        const o = this.overrides?.[name];
        const light = Color3.Lerp(primary, Color3.White(), 0.22);
        if (o) color = ({ primary, light, secondary, dark, glass: GLASS, skin: SKIN } as Record<string, Color3>)[o] ?? null;
        else if (mode === "quaternius") color = quaterniusColor(name, primary, light, secondary, dark);
        else color = cimpletoonColor(name, primary, secondary, dark);
      }
      if (!color) continue;
      const cacheKey = `${key}|${mode === "replace" ? "all" : name}`;
      let mat = this.materialCache.get(cacheKey);
      if (!mat) {
        const pbr = new PBRMaterial(`mat:${cacheKey}`, this.scene);
        pbr.albedoColor = color.toLinearSpace();
        pbr.metallic = 0.05;
        pbr.roughness = name.includes("glass") || name.includes("window") ? 0.25 : 0.75;
        mat = pbr;
        this.materialCache.set(cacheKey, mat);
      }
      m.material = mat;
    }
  }
}

/** Pachetele Quaternius (tancuri): Main / Main_Light / Main_Dark / Main_Details / Wheels. */
function quaterniusColor(name: string, primary: Color3, light: Color3, secondary: Color3, dark: Color3): Color3 | null {
  if (name === "main") return primary;
  if (name === "main_light") return light;
  if (name === "main_dark") return Color3.Lerp(primary, dark, 0.55);
  if (name === "main_details") return secondary;
  if (name === "wheels") return dark;
  return null;
}

function cimpletoonColor(name: string, primary: Color3, secondary: Color3, dark: Color3): Color3 {
  if (/glass|window|headlight/.test(name)) return GLASS;
  if (/skin/.test(name)) return SKIN;
  if (/^ak |clip|wheel|metal|barrel|bolt|guide|shoe|cannon|shell|propel|rope|caselock|camera/.test(name)) return dark;
  if (/pants|shirt|pocket|sign|rim|stripe|tie|sock/.test(name)) return secondary;
  return primary; // body, jacket, hat, material.xxx …
}

export function bounds(node: TransformNode) {
  node.computeWorldMatrix(true);
  for (const m of node.getChildMeshes(false)) m.computeWorldMatrix(true);
  const { min, max } = node.getHierarchyBoundingVectors(true, (m: any) => typeof m.getTotalVertices === "function" && m.getTotalVertices() > 0);
  return { min, max, size: max.subtract(min), center: Vector3.Center(min, max) };
}

export function solidMaterial(scene: Scene, name: string, hex: string, emissive = 0): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  if (emissive) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
  return m;
}
