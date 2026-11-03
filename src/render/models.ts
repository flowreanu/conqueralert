import {
  AbstractMesh,
  AnimationGroup,
  MeshBuilder,
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
  /** scară fixă (metri per unitate a modelului) — kiturile Kenney, unde proporțiile dintre piese contează */
  unitScale?: number;
  /** model cu schelet și animații (infanteria Toon Shooter): o instanță completă per unitate */
  animated?: boolean;
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
      // varianta „artifact” (un singur fișier): modelele vin ca data-URI din window.__CA_MODELS
      const embedded = (globalThis as any).__CA_MODELS?.[def.path] as string | undefined;
      const ext = def.path.slice(def.path.lastIndexOf("."));
      p = LoadAssetContainerAsync(embedded ?? import.meta.env.BASE_URL + def.path, this.scene, { pluginExtension: ext }).then((c) => {
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
      p = this.container(id)
        .then((c) => this.buildTemplate(id, c, faction, target, measure, key))
        .catch((e) => {
          // modelul lipsește (de ex. public/models necomis) → formă simplă, ca jocul să meargă oricum
          console.warn(`Model indisponibil: ${id} — folosesc o formă provizorie`, e?.message ?? e);
          return this.fallbackTemplate(id, faction, target, measure, key);
        });
      this.templates.set(key, p);
    }
    return p;
  }

  private animFit = new Map<string, { s: number; px: number; py: number; pz: number }>();

  /**
   * Instanță animată (schelet + AnimationGroup-uri proprii). Dacă modelul nu se poate încărca,
   * cade pe varianta statică / provizorie.
   */
  async animatedInstance(id: string, faction: string, target: number, measure: Measure, name: string): Promise<{ root: TransformNode; anims: Map<string, AnimationGroup>; dispose: () => void }> {
    let c: AssetContainer;
    try { c = await this.container(id); }
    catch {
      const root = await this.instance(id, faction, target, measure, name);
      return { root, anims: new Map(), dispose: () => root.dispose() };
    }
    const def = MODEL_DEFS[id];
    const root = new TransformNode(name, this.scene);
    const scaleNode = new TransformNode(`${name}:scale`, this.scene);
    const align = new TransformNode(`${name}:align`, this.scene);
    scaleNode.parent = root;
    align.parent = scaleNode;
    const entries = c.instantiateModelsToScene((n) => `${name}:${n}`, false, { doNotInstantiate: true });
    for (const n of entries.rootNodes) n.parent = align;
    align.rotation.y = (def.yaw * Math.PI) / 180;
    const key = `${id}|${target}|${measure}`;
    let fit = this.animFit.get(key);
    if (!fit) {
      const b = bounds(align);
      const s = fitScale(b.size, target, measure);
      fit = { s, px: -b.center.x, py: -b.min.y, pz: -b.center.z };
      this.animFit.set(key, fit);
    }
    align.position.set(fit.px, fit.py, fit.pz);
    scaleNode.scaling.setAll(fit.s);
    const meshes = align.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
    this.overrides = def.colors;
    if (def.recolor !== "none") this.recolor(meshes, def.recolor, FACTIONS[faction], `${id}|${faction}`);
    for (const m of meshes) {
      m.isPickable = false;
      m.receiveShadows = true;
      const mat = m.material;
      if (mat instanceof PBRMaterial) { mat.metallic = Math.min(mat.metallic ?? 0, 0.2); mat.roughness = Math.max(mat.roughness ?? 1, 0.65); }
    }
    const anims = new Map<string, AnimationGroup>();
    for (const g of entries.animationGroups) {
      g.stop();
      anims.set(g.name.replace(/^.*:/, ""), g);
    }
    return {
      root,
      anims,
      dispose: () => {
        for (const g of entries.animationGroups) g.dispose();
        for (const sk of entries.skeletons) sk.dispose();
        root.dispose();
      },
    };
  }

  /** Formă low-poly provizorie (cutii / con) când fișierul modelului lipsește. */
  private fallbackTemplate(id: string, faction: string | null, target: number, measure: Measure, key: string): TransformNode {
    const def = MODEL_DEFS[id];
    const root = new TransformNode(`tpl:${key}`, this.scene);
    const fc = faction ? FACTIONS[faction] : null;
    const mat = (hex: string, tag: string) => {
      let m = this.materialCache.get(`fb|${tag}|${hex}`);
      if (!m) {
        const p = new PBRMaterial(`fb:${tag}`, this.scene);
        p.albedoColor = Color3.FromHexString(hex).toLinearSpace();
        p.metallic = 0.05;
        p.roughness = 0.8;
        m = p;
        this.materialCache.set(`fb|${tag}|${hex}`, m);
      }
      return m;
    };
    const parts: Mesh[] = [];
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) => {
      const b = MeshBuilder.CreateBox(`fb-${key}`, { width: w, height: h, depth: d }, this.scene);
      b.position.set(x, y + h / 2, z);
      b.material = mat(hex, "box");
      parts.push(b);
    };
    const primary = fc?.primary ?? "#8a8f96", dark = fc?.dark ?? "#3a3f46", secondary = fc?.secondary ?? "#b9bdc2";
    if (def?.height) {
      const h = def.height;
      if (id.startsWith("rock")) box(h * 0.9, h * 0.6, h * 0.8, 0, 0, 0, "#8d8a84");
      else {
        const trunk = MeshBuilder.CreateCylinder(`fb-${key}`, { height: h * 0.3, diameter: h * 0.12, tessellation: 6 }, this.scene);
        trunk.position.y = h * 0.15;
        trunk.material = mat("#6b4a2e", "trunk");
        const crown = MeshBuilder.CreateCylinder(`fb-${key}`, { height: h * 0.75, diameterTop: 0, diameterBottom: h * 0.5, tessellation: 7 }, this.scene);
        crown.position.y = h * 0.62;
        crown.material = mat("#3f7a3a", "crown");
        parts.push(trunk, crown);
      }
    } else if (measure === "height") {
      const h = target;
      box(h * 0.32, h * 0.42, h * 0.22, 0, 0, 0, dark);
      box(h * 0.38, h * 0.36, h * 0.26, 0, h * 0.42, 0, primary);
      box(h * 0.2, h * 0.2, h * 0.2, 0, h * 0.78, 0, "#d9a77f");
    } else if (measure === "length") {
      const L = target;
      box(L, L * 0.22, L * 0.55, 0, 0, 0, dark);
      box(L * 0.9, L * 0.14, L * 0.5, 0, L * 0.22, 0, primary);
      box(L * 0.35, L * 0.14, L * 0.32, -L * 0.05, L * 0.36, 0, secondary);
      box(L * 0.45, L * 0.06, L * 0.06, L * 0.32, L * 0.42, 0, dark);
    } else {
      const F = target;
      box(F * 0.9, F * 0.35, F * 0.9, 0, 0, 0, "#b9b5ab");
      box(F * 0.5, F * 0.25, F * 0.5, -F * 0.1, F * 0.35, -F * 0.1, primary);
    }
    const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    merged.name = `tpl-mesh:${key}`;
    merged.parent = root;
    merged.receiveShadows = true;
    merged.isPickable = false;
    merged.isVisible = false;
    return root;
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
    const s = def.unitScale ?? (def.height ? def.height / b.size.y : fitScale(b.size, target, measure));
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
