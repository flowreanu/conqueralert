import { AbstractMesh, AnimationGroup, Color3, InstancedMesh, Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, TransformNode } from "./babylon";
import buildingsData from "../data/buildings.json";
import factionsData from "../data/factions.json";
import { Building, BUILDING_DEFS, SimEvent, Unit, UNIT_DEFS, World, angleDiff } from "../sim/world";
import { MODEL_DEFS, ModelLibrary, solidMaterial } from "./models";
import { buildingTargetMeters, unitTarget } from "./scaleMath";
import { groundHeight } from "./terrain";
import type { Vision } from "../sim/vision";

interface UnitView {
  root: TransformNode;
  ring: InstancedMesh;
  ready: boolean;
  bar: HealthBar;
  /** infanterie animată */
  anim: { groups: Map<string, AnimationGroup>; current: string; dispose: () => void } | null;
  /** secunde rămase din animația de moarte (unitatea nu mai e în simulare) */
  dying: number;
  /** a tras recent → animația de tragere */
  shootT: number;
}

interface BuildingView {
  root: TransformNode;
  bar: HealthBar;
  /** modelul care se rotește spre țintă (turelă) */
  head: TransformNode | null;
  /** 0..1 animația de construcție (clădirea „crește” din fundație) */
  grow: number;
  body: TransformNode;
}

/** Bară de viață: fundal + umplere, orientată mereu spre cameră, desenată peste modele. */
interface HealthBar {
  node: TransformNode;
  bg: InstancedMesh;
  fill: InstancedMesh | null;
  level: number; // 0 verde, 1 galben, 2 roșu
  width: number;
}

const BUILDINGS = buildingsData as unknown as Record<string, { name: string; size: string; models: Record<string, string[]> }>;
const BAR_COLORS = ["#5fd35a", "#e9c63e", "#e2453a"];
const FACTIONS = factionsData as Record<string, { primary: string; dark: string }>;

/** Sincronizează lumea simulată cu scena Babylon (interpolare între tick-uri). */
export class EntityRenderer {
  private views = new Map<number, UnitView>();
  private bviews = new Map<number, BuildingView>();
  private ringSrc: Mesh;
  private barBg: Mesh;
  private barFill: Mesh[];
  selected = new Set<number>();
  /** unitatea / clădirea de sub cursor (bara ei de viață e afișată) */
  hovered = 0;
  /** clădirea proprie selectată (0 = niciuna) */
  selectedBuilding = 0;
  onSelectionPruned: () => void = () => {};
  /** ceața de război a jucătorului (null = se vede tot) */
  vision: Vision | null = null;
  private frame: TransformNode;
  private rallyFlag: TransformNode;

  constructor(private scene: Scene, private lib: ModelLibrary, private world: World, private shadows: ShadowGenerator | null) {
    this.ringSrc = MeshBuilder.CreateTorus("selRing", { diameter: 2, thickness: 0.12, tessellation: 36 }, scene);
    const rm = new StandardMaterial("selRingMat", scene);
    rm.emissiveColor = Color3.FromHexString("#7dff6a");
    rm.diffuseColor = Color3.Black();
    rm.disableLighting = true;
    this.ringSrc.material = rm;
    this.ringSrc.isPickable = false;
    this.ringSrc.position.y = -1000;

    const flat = (name: string, hex: string, w: number, h: number) => {
      const m = MeshBuilder.CreatePlane(name, { width: w, height: h }, scene);
      const mat = new StandardMaterial(`${name}-m`, scene);
      mat.emissiveColor = Color3.FromHexString(hex);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      m.material = mat;
      m.isPickable = false;
      m.renderingGroupId = 1;
      m.position.y = -1000;
      m.isVisible = false;
      return m;
    };
    this.barBg = flat("hpBg", "#0d1013", 1, 1);
    this.barFill = BAR_COLORS.map((c, i) => flat(`hpFill${i}`, c, 1, 1));

    // cadru de selecție pentru clădiri (4 laturi, scalat la amprentă) + steagul punctului de adunare
    this.frame = new TransformNode("bldFrame", scene);
    for (let i = 0; i < 4; i++) {
      const side = MeshBuilder.CreateBox(`bldFrame${i}`, { width: 1, height: 0.12, depth: 0.1 }, scene);
      side.material = rm;
      side.isPickable = false;
      side.parent = this.frame;
      side.rotation.y = (i * Math.PI) / 2;
    }
    this.frame.setEnabled(false);
    this.rallyFlag = new TransformNode("rally", scene);
    const pole = MeshBuilder.CreateCylinder("rallyPole", { height: 2.6, diameter: 0.1, tessellation: 6 }, scene);
    pole.position.y = 1.3;
    const flag = MeshBuilder.CreateBox("rallyFlagCloth", { width: 0.9, height: 0.55, depth: 0.04 }, scene);
    flag.position.set(0.45, 2.25, 0);
    for (const m of [pole, flag]) { m.material = rm; m.isPickable = false; m.parent = this.rallyFlag; }
    this.rallyFlag.setEnabled(false);
  }

  /** Evenimentele simulării care privesc randarea unităților (animația de tragere). */
  consume(events: SimEvent[]) {
    for (const e of events) if (e.kind === "fire") { const v = this.views.get(e.sourceId); if (v) v.shootT = 0.6; }
  }

  private makeBar(name: string, width: number, parent: TransformNode | null): HealthBar {
    const node = new TransformNode(`hp-${name}`, this.scene);
    node.billboardMode = TransformNode.BILLBOARDMODE_ALL;
    node.parent = parent;
    const bg = this.barBg.createInstance(`hpbg-${name}`);
    bg.parent = node;
    bg.scaling.set(width + 0.16, 0.42, 1);
    bg.position.set(0, 0, 0.01);
    const bar: HealthBar = { node, bg, fill: null, level: -1, width };
    node.setEnabled(false);
    return bar;
  }

  private updateBar(bar: HealthBar, frac: number, show: boolean) {
    bar.node.setEnabled(show);
    if (!show) return;
    const level = frac > 0.6 ? 0 : frac > 0.3 ? 1 : 2;
    if (level !== bar.level) {
      bar.fill?.dispose();
      bar.fill = this.barFill[level].createInstance(`hpf`);
      bar.fill.parent = bar.node;
      bar.level = level;
    }
    const f = Math.max(0.02, frac);
    bar.fill!.scaling.set(bar.width * f, 0.26, 1);
    bar.fill!.position.set(-(1 - f) * bar.width * 0.5, 0, 0);
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
    // bara de viață nu se rotește cu unitatea → nod separat, poziționat în sync()
    const bar = this.makeBar(`u${u.id}`, Math.min(3.6, Math.max(1.6, def.radius * 1.5)), null);
    bar.node.metadata = { h: t.measure === "height" ? t.size + 0.6 : 3.4 };
    const view: UnitView = { root, ring, ready: false, bar, anim: null, dying: 0, shootT: 0 };
    this.views.set(u.id, view);
    let model: TransformNode;
    if (MODEL_DEFS[def.model]?.animated) {
      const a = await this.lib.animatedInstance(def.model, u.faction, t.size, t.measure, `u${u.id}`);
      model = a.root;
      if (!this.views.has(u.id)) { a.dispose(); return; }
      if (a.anims.size) { view.anim = { groups: a.anims, current: "", dispose: a.dispose }; this.playAnim(view, "Idle"); }
    } else model = await this.lib.instance(def.model, u.faction, t.size, t.measure, `u${u.id}`);
    if (!this.views.has(u.id)) { model.dispose(); return; } // a murit între timp
    model.parent = root;
    this.castShadows(model);
    const b = model.getHierarchyBoundingVectors(true);
    bar.node.metadata = { h: b.max.y - b.min.y + 0.7 };
    view.ready = true;
  }

  async addBuilding(b: Building) {
    const def = BUILDINGS[b.type];
    const cs = this.world.map.cellSize;
    const fp = b.cells * cs;
    const root = new TransformNode(`bld${b.id}`, this.scene);
    root.position.set((b.cx + b.cells / 2) * cs, 0, (b.cy + b.cells / 2) * cs);
    root.rotation.y = -b.facing; // baza de vest privește spre est, cea de est spre vest

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

    const bar = this.makeBar(`b${b.id}`, fp * 0.6, null);
    bar.node.position.set(root.position.x, 7, root.position.z);
    const body = new TransformNode(`bldBody${b.id}`, this.scene);
    body.parent = root;
    // clădirile plasate în timpul jocului „cresc” din fundație
    const view: BuildingView = { root, bar, head: null, grow: this.world.tick - b.bornTick > 2 || b.bornTick === 0 ? 1 : 0, body };
    body.scaling.y = Math.max(0.02, view.grow);
    this.bviews.set(b.id, view);
    const rotates = !!BUILDING_DEFS[b.type].rotates;

    const models = def.models[b.faction] ?? def.models[Object.keys(def.models)[0]];
    const target = buildingTargetMeters(def.size);
    const layout = models.length === 1 ? [{ s: 1, ox: 0, oz: 0 }] : [{ s: 0.7, ox: -0.14, oz: -0.12 }, { s: 0.42, ox: 0.27, oz: 0.27 }];
    await Promise.all(
      models.map(async (id, i) => {
        const l = layout[i] ?? layout[layout.length - 1];
        const inst = await this.lib.instance(id, b.faction, target * l.s, "footprint", `b${b.id}-${i}`);
        if (!this.bviews.has(b.id)) { inst.dispose(); return; }
        inst.parent = body;
        inst.position.set(l.ox * fp, 0.24, l.oz * fp);
        if (rotates && i === 0) view.head = inst;
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

  private playAnim(v: UnitView, name: string, loop = true, speed = 1) {
    const a = v.anim;
    if (!a || a.current === name) return;
    const g = a.groups.get(name);
    if (!g) return;
    a.groups.get(a.current)?.stop();
    g.start(loop, speed);
    a.current = name;
  }

  /** alpha = fracțiunea dintre tick-ul anterior și cel curent; dt = timpul real al cadrului. */
  sync(alpha: number, dt = 1 / 60) {
    const m = this.world.map;
    let pruned = false;
    // unități / clădiri noi (produse, plasate)
    for (const u of this.world.units.values()) if (!this.views.has(u.id)) void this.addUnit(u);
    for (const b of this.world.buildings.values()) if (!this.bviews.has(b.id)) void this.addBuilding(b);
    for (const [id, v] of this.views) {
      const u = this.world.units.get(id);
      if (!u) {
        if (this.selected.delete(id)) pruned = true;
        // infanteria animată: joacă moartea, apoi dispare
        if (v.anim && v.dying === 0 && v.ready) {
          v.dying = 1.8;
          v.ring.setEnabled(false);
          v.bar.node.setEnabled(false);
          this.playAnim(v, "Death", false);
          continue;
        }
        if (v.dying > 0) { v.dying -= dt; if (v.dying > 0) continue; }
        v.anim?.dispose();
        v.root.dispose();
        v.bar.node.dispose();
        this.views.delete(id);
        continue;
      }
      // inamicii din ceață nu se văd
      const visible = !this.vision || this.vision.unitVisible(u);
      v.root.setEnabled(visible);
      if (!visible) { v.bar.node.setEnabled(false); if (this.hovered === id) this.hovered = 0; continue; }
      if (v.anim) {
        v.shootT = Math.max(0, v.shootT - dt);
        if (u.moving) this.playAnim(v, "Run_Gun", true, 0.95);
        else if (v.shootT > 0 || u.attackId) this.playAnim(v, "Idle_Shoot");
        else this.playAnim(v, "Idle");
      }
      const x = u.prevX + (u.x - u.prevX) * alpha;
      const z = u.prevZ + (u.z - u.prevZ) * alpha;
      const h = u.prevHeading + angleDiff(u.heading, u.prevHeading) * alpha;
      v.root.position.set(x, groundHeight(m, x, z), z);
      v.root.rotation.y = -h; // Babylon e left-handed: heading spre +z ⇒ rotație negativă în jurul Y
      const sel = this.selected.has(id);
      v.ring.setEnabled(sel);
      v.bar.node.position.set(x, v.root.position.y + (v.bar.node.metadata?.h ?? 3), z);
      this.updateBar(v.bar, u.hp / u.maxHp, sel || u.hp < u.maxHp || this.hovered === id);
    }
    for (const [id, v] of this.bviews) {
      const b = this.world.buildings.get(id);
      if (!b) { v.root.dispose(); v.bar.node.dispose(); this.bviews.delete(id); continue; }
      const seen = !this.vision || this.vision.buildingVisible(b);
      v.root.setEnabled(seen);
      if (!seen) { v.bar.node.setEnabled(false); continue; }
      if (v.grow < 1) { v.grow = Math.min(1, v.grow + dt / 0.9); v.body.scaling.y = Math.max(0.02, 1 - (1 - v.grow) ** 3); }
      if (v.head) v.head.rotation.y = -b.heading - v.root.rotation.y;
      this.updateBar(v.bar, b.hp / b.maxHp, b.hp < b.maxHp || this.hovered === id || this.selectedBuilding === id);
    }
    // clădirea selectată: cadru + punct de adunare
    const sb = this.selectedBuilding ? this.world.buildings.get(this.selectedBuilding) : undefined;
    if (this.selectedBuilding && !sb) { this.selectedBuilding = 0; pruned = true; }
    this.frame.setEnabled(!!sb);
    if (sb) {
      const fp = sb.cells * m.cellSize + 0.3;
      this.frame.position.set(sb.x, 0.3, sb.z);
      this.frame.getChildMeshes().forEach((side, i) => {
        side.scaling.x = fp;
        const a = (i * Math.PI) / 2;
        side.position.set(Math.sin(a) * fp * 0.5, 0, Math.cos(a) * fp * 0.5);
      });
    }
    const rally = sb && BUILDING_DEFS[sb.type].produces ? sb.rally : null;
    this.rallyFlag.setEnabled(!!rally);
    if (rally) this.rallyFlag.position.set(rally.x, groundHeight(m, rally.x, rally.z), rally.z);
    if (pruned) this.onSelectionPruned();
  }
}
