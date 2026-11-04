import { AbstractMesh, AnimationGroup, Color3, DynamicTexture, InstancedMesh, Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, TransformNode } from "./babylon";
import buildingsData from "../data/buildings.json";
import factionsData from "../data/factions.json";
import { Building, BUILDING_DEFS, SimEvent, Unit, UNIT_DEFS, WEAPONS, World, angleDiff } from "../sim/world";
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
  /** V3: racheta de pe camion (pivot la capătul din spate) */
  missile: { pivot: TransformNode; angle: number } | null;
  /** insigna de rang (săgeți / steluță), lângă bara de viață */
  badge: { node: TransformNode; mesh: InstancedMesh | null; rank: number } | null;
  /** a intrat într-o clădire → dispare fără animația de moarte */
  silent: boolean;
}

interface BuildingView {
  root: TransformNode;
  bar: HealthBar;
  /** modelul care se rotește spre țintă (turelă) */
  head: TransformNode | null;
  /** 0..1 animația de construcție (clădirea „crește” din fundație) */
  grow: number;
  body: TransformNode;
  /** proprietarul la crearea vederii (capturarea refacere modelele / culorile) */
  owner: number;
  /** clădirile civile: indicatorul de ocupare (5 „ferestre”) */
  pips: { node: TransformNode; meshes: InstancedMesh[]; key: string } | null;
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
const PIP_EMPTY = "#22272c";

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
  /** S5: insignele de rang (1–3 săgeți, steluța) și „ferestrele” caselor */
  private badgeSrc: Mesh[] = [];
  private pipSrc = new Map<string, Mesh>();

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
    this.badgeSrc = [1, 2, 3, 4].map((r) => this.makeBadge(r));

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

  /** Evenimentele simulării care privesc randarea unităților (animația de tragere, intrarea în clădiri). */
  consume(events: SimEvent[]) {
    for (const e of events) {
      if (e.kind === "fire") { const v = this.views.get(e.sourceId); if (v) v.shootT = 0.6; }
      else if (e.kind === "entered") { const v = this.views.get(e.unitId); if (v) v.silent = true; }
    }
  }

  /** Insignă de rang: 1–3 săgeți aurii sau steluța elitei, pe o plăcuță întunecată. */
  private makeBadge(rank: number): Mesh {
    const S = 128;
    const tex = new DynamicTexture(`badgeTex${rank}`, { width: S, height: S }, this.scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = "rgba(12,15,18,0.82)";
    ctx.beginPath(); ctx.roundRect(10, 10, S - 20, S - 20, 18); ctx.fill();
    ctx.strokeStyle = "#f3c74a"; ctx.fillStyle = "#f3c74a";
    ctx.lineWidth = 13; ctx.lineJoin = "miter"; ctx.lineCap = "butt";
    if (rank < 4) {
      const n = rank, gap = 24, top = S / 2 - ((n - 1) * gap) / 2 - 8;
      for (let i = 0; i < n; i++) {
        const y = top + i * gap;
        ctx.beginPath(); ctx.moveTo(30, y + 22); ctx.lineTo(S / 2, y); ctx.lineTo(S - 30, y + 22); ctx.stroke();
      }
    } else {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 19 : 44, a = -Math.PI / 2 + (i * Math.PI) / 5;
        ctx.lineTo(S / 2 + Math.cos(a) * r, S / 2 + 4 + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    }
    tex.update();
    const m = MeshBuilder.CreatePlane(`badge${rank}`, { size: 1 }, this.scene);
    const mat = new StandardMaterial(`badgeMat${rank}`, this.scene);
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.diffuseColor = Color3.Black();
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    m.material = mat;
    m.isPickable = false;
    m.renderingGroupId = 1;
    m.isVisible = false;
    m.position.y = -1000;
    return m;
  }

  /** Sursa unei „ferestre” (indicatorul de ocupare) în culoarea dată. */
  private pip(hex: string): Mesh {
    let m = this.pipSrc.get(hex);
    if (!m) {
      m = MeshBuilder.CreatePlane(`pip-${hex}`, { width: 0.55, height: 0.55 }, this.scene);
      const mat = new StandardMaterial(`pipMat-${hex}`, this.scene);
      mat.emissiveColor = Color3.FromHexString(hex);
      mat.diffuseColor = Color3.Black();
      mat.specularColor = Color3.Black();
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      m.material = mat;
      m.isPickable = false;
      m.renderingGroupId = 1;
      m.isVisible = false;
      m.position.y = -1000;
      this.pipSrc.set(hex, m);
    }
    return m;
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
    const view: UnitView = { root, ring, ready: false, bar, anim: null, dying: 0, shootT: 0, missile: null, badge: null, silent: false };
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
    if (def.rig === "v3") { view.missile = this.buildV3Missile(u.id, root); this.castShadows(view.missile.pivot); }
    const b = model.getHierarchyBoundingVectors(true);
    if (def.rig === "mg") this.castShadows(this.buildMg(u.id, root, b.max.y - b.min.y, b.max.x - b.min.x));
    bar.node.metadata = { h: b.max.y - b.min.y + 0.7 };
    view.ready = true;
  }

  /** Mitraliera de pe acoperișul cercetașului (Humvee / BRDM): suport, scut și țeavă. */
  private buildMg(id: number, root: TransformNode, h: number, len: number): TransformNode {
    const n = new TransformNode(`mg${id}`, this.scene);
    n.parent = root;
    n.position.set(-len * 0.08, h - 0.05, 0);
    const mat = this.cachedMat("mgDark", "#2c2f2b");
    const parts: Mesh[] = [
      MeshBuilder.CreateCylinder(`mgr${id}`, { height: 0.22, diameter: 0.9, tessellation: 10 }, this.scene),
      MeshBuilder.CreateBox(`mgs${id}`, { width: 0.12, height: 0.42, depth: 0.7 }, this.scene),
      MeshBuilder.CreateBox(`mgb${id}`, { width: 0.42, height: 0.2, depth: 0.2 }, this.scene),
      MeshBuilder.CreateCylinder(`mgt${id}`, { height: 1.15, diameter: 0.09, tessellation: 6 }, this.scene),
    ];
    parts[0].position.y = 0.11;
    parts[1].position.set(0.32, 0.42, 0);
    parts[2].position.set(0.1, 0.42, 0);
    parts[3].rotation.z = -Math.PI / 2;
    parts[3].position.set(0.85, 0.42, 0);
    for (const p of parts) { p.material = mat; p.parent = n; p.isPickable = false; }
    return n;
  }

  /** Casă / magazin (modelul Kenney, la poziția lui de pe hartă) sau puțul de petrol; fără fundație. */
  private async addCivBuilding(b: Building) {
    const cs = this.world.map.cellSize;
    const root = new TransformNode(`civ${b.id}`, this.scene);
    root.position.set(b.x, 0, b.z);
    root.rotation.y = b.rot ?? 0;
    const body = new TransformNode(`civBody${b.id}`, this.scene);
    body.parent = root;
    const bar = this.makeBar(`b${b.id}`, Math.max(b.cw, b.ch) * cs * 0.5, null);
    const view: BuildingView = { root, bar, head: null, grow: 1, body, owner: b.owner, pips: null };
    this.bviews.set(b.id, view);
    let h = 4;
    if (b.model) {
      const inst = await this.lib.instance(b.model, null, 1, "height", `civ${b.id}-m`);
      if (!this.bviews.has(b.id)) { inst.dispose(); return; }
      inst.parent = body;
      this.castShadows(inst);
      inst.computeWorldMatrix(true);
      const bb = inst.getHierarchyBoundingVectors(true);
      h = bb.max.y;
      for (const m of inst.getChildMeshes(false)) m.receiveShadows = true;
    } else {
      h = this.buildDerrick(b.id, body);
      this.castShadows(body);
    }
    bar.node.position.set(b.x, h + 1.4, b.z);
    if (BUILDING_DEFS[b.type].garrison) {
      const node = new TransformNode(`pips${b.id}`, this.scene);
      node.billboardMode = TransformNode.BILLBOARDMODE_ALL;
      node.position.set(b.x, h + 0.7, b.z);
      view.pips = { node, meshes: [], key: "" };
    }
  }

  /** Puțul de petrol, low-poly: turlă din grinzi, balansier care se mișcă, rezervor. Întoarce înălțimea. */
  private buildDerrick(id: number, body: TransformNode): number {
    const dark = this.cachedMat("drkSteel", "#3b3f44"), rust = this.cachedMat("drkRust", "#a4552d"), tank = this.cachedMat("drkTank", "#c8c2b2");
    const pad = MeshBuilder.CreateBox(`dpad${id}`, { width: 3.8, depth: 3.8, height: 0.2 }, this.scene);
    pad.position.y = 0.1;
    pad.material = this.cachedMat("slabMat", "#9a978f");
    pad.receiveShadows = true;
    const parts: Mesh[] = [pad];
    // turla: 4 picioare înclinate + traverse
    const H = 6.2;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const leg = MeshBuilder.CreateBox(`dleg${id}`, { width: 0.16, height: H, depth: 0.16 }, this.scene);
      leg.position.set(-0.9 + sx * 0.55, H / 2, sz * 0.55);
      leg.rotation.z = -sx * 0.09;
      leg.rotation.x = sz * 0.09;
      leg.material = rust;
      parts.push(leg);
    }
    for (const y of [1.6, 3.2, 4.7]) {
      const k = 1 - (y / H) * 0.55;
      const ring = MeshBuilder.CreateBox(`dring${id}`, { width: 1.3 * k, height: 0.1, depth: 1.3 * k }, this.scene);
      ring.position.set(-0.9, y, 0);
      ring.material = rust;
      parts.push(ring);
    }
    const cap = MeshBuilder.CreateBox(`dcap${id}`, { width: 0.5, height: 0.3, depth: 0.5 }, this.scene);
    cap.position.set(-0.9, H, 0);
    cap.material = dark;
    // pompa (balansierul pe un suport în A)
    const post = MeshBuilder.CreateBox(`dpost${id}`, { width: 0.2, height: 1.6, depth: 0.5 }, this.scene);
    post.position.set(0.9, 0.9, 0.9);
    post.material = dark;
    const beam = MeshBuilder.CreateBox(`dbeam${id}`, { width: 2.4, height: 0.22, depth: 0.22 }, this.scene);
    beam.position.set(0.9, 1.75, 0.9);
    beam.material = dark;
    const head = MeshBuilder.CreateBox(`dhead${id}`, { width: 0.35, height: 0.6, depth: 0.3 }, this.scene);
    head.position.set(2.05, 1.6, 0.9);
    head.material = rust;
    const tk = MeshBuilder.CreateCylinder(`dtank${id}`, { height: 1.5, diameter: 1.3, tessellation: 14 }, this.scene);
    tk.position.set(0.9, 0.95, -0.9);
    tk.material = tank;
    parts.push(cap, post, beam, head, tk);
    for (const p of parts) { p.parent = body; p.isPickable = false; }
    // balansierul se mișcă încet (doar vizual)
    let t = id;
    this.scene.onBeforeRenderObservable.add(() => {
      t += this.scene.getEngine().getDeltaTime() / 1000;
      const a = Math.sin(t * 1.6) * 0.22;
      beam.rotation.z = a;
      head.position.y = 1.6 + Math.sin(a) * 1.15;
    });
    return H;
  }

  async addBuilding(b: Building) {
    if (BUILDING_DEFS[b.type].category === "civilian") return this.addCivBuilding(b);
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
    const view: BuildingView = { root, bar, head: null, grow: this.world.tick - b.bornTick > 2 || b.bornTick === 0 ? 1 : 0, body, owner: b.owner, pips: null };
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

  /** Racheta lungă a lansatorului V3: corp gri-oliv, vârf roșu, aripioare; se rotește în jurul capătului din spate. */
  private buildV3Missile(id: number, root: TransformNode) {
    const pivot = new TransformNode(`v3pivot${id}`, this.scene);
    pivot.parent = root;
    pivot.position.set(-2.35, 1.55, 0);
    const L = 3.7, D = 0.52;
    const parts: Mesh[] = [];
    const body = MeshBuilder.CreateCylinder(`v3b${id}`, { height: L, diameter: D, tessellation: 10 }, this.scene);
    body.rotation.z = -Math.PI / 2;
    body.position.x = L / 2;
    body.material = this.cachedMat("v3body", "#646a5a");
    const nose = MeshBuilder.CreateCylinder(`v3n${id}`, { height: 0.95, diameterTop: 0, diameterBottom: D, tessellation: 10 }, this.scene);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = L + 0.47;
    nose.material = this.cachedMat("v3nose", "#b8352b");
    parts.push(body, nose);
    // aripioarele în cruce, la coadă
    for (const [h, d] of [[1.0, 0.06], [0.06, 1.0]]) {
      const fin = MeshBuilder.CreateBox(`v3f${id}`, { width: 0.7, height: h, depth: d }, this.scene);
      fin.position.x = 0.35;
      fin.material = this.cachedMat("v3fin", "#3f4239");
      parts.push(fin);
    }
    // rampa (două șine) rămâne pe camion
    for (const z of [-0.32, 0.32]) {
      const rail = MeshBuilder.CreateBox(`v3r${id}`, { width: 3.2, height: 0.12, depth: 0.12 }, this.scene);
      rail.position.set(L * 0.42, -0.3, z);
      rail.material = this.cachedMat("v3rail", "#2f312c");
      parts.push(rail);
    }
    for (const p of parts) { p.parent = pivot; p.isPickable = false; }
    return { pivot, angle: 0.12 };
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

  /** „Ferestrele” casei: câte locuri sunt ocupate, în culoarea ocupantului (ascunse când casa e goală și nu e sub cursor). */
  private updatePips(v: BuildingView, b: Building) {
    const cap = BUILDING_DEFS[b.type].garrison ?? 0;
    const n = b.garrison.length;
    const show = n > 0 || this.hovered === b.id || this.selectedBuilding === b.id;
    // ocupanții inamici din ceață nu se văd
    const hidden = this.vision && b.owner !== this.vision.player && !this.vision.isVisible(b.x, b.z);
    const key = show && !hidden ? `${n}|${b.faction}` : "off";
    if (key === v.pips!.key) return;
    v.pips!.key = key;
    for (const m of v.pips!.meshes) m.dispose();
    v.pips!.meshes = [];
    if (key === "off") return;
    const col = FACTIONS[b.faction]?.primary ?? "#9aa0a6";
    for (let i = 0; i < cap; i++) {
      const m = this.pip(i < n ? col : PIP_EMPTY).createInstance(`pip${b.id}-${i}`);
      m.parent = v.pips!.node;
      m.position.set((i - (cap - 1) / 2) * 0.7, 0, 0);
      v.pips!.meshes.push(m);
    }
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
        // a intrat într-o clădire: dispare imediat
        if (v.silent) { v.anim?.dispose(); v.root.dispose(); v.bar.node.dispose(); v.badge?.node.dispose(); this.views.delete(id); continue; }
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
        v.badge?.node.dispose();
        this.views.delete(id);
        continue;
      }
      // inamicii din ceață nu se văd
      const visible = !this.vision || this.vision.unitVisible(u);
      v.root.setEnabled(visible);
      if (!visible) { v.bar.node.setEnabled(false); v.badge?.node.setEnabled(false); if (this.hovered === id) this.hovered = 0; continue; }
      if (v.anim) {
        v.shootT = Math.max(0, v.shootT - dt);
        if (u.moving) this.playAnim(v, "Run_Gun", true, 0.95);
        else if (v.shootT > 0 || u.attackId) this.playAnim(v, "Idle_Shoot");
        else this.playAnim(v, "Idle");
      }
      if (v.missile) {
        // V3: racheta apare când e reîncărcată, se ridică la ~45° când are țintă, dispare la lansare
        const cd = WEAPONS[UNIT_DEFS[u.type].weapon!].cooldown;
        const loaded = u.cooldown < cd * 0.5;
        const want = loaded && u.attackId ? 0.8 : 0.12;
        v.missile.angle += (want - v.missile.angle) * Math.min(1, dt * 2.5);
        v.missile.pivot.rotation.z = v.missile.angle;
        for (const c of v.missile.pivot.getChildMeshes(false)) if (!c.name.startsWith("v3r")) c.isVisible = loaded;
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
      // insigna de rang: mereu vizibilă, în stânga barei de viață
      if (u.rank > 0 || v.badge) {
        if (!v.badge) {
          const node = new TransformNode(`badge-u${id}`, this.scene);
          node.billboardMode = TransformNode.BILLBOARDMODE_ALL;
          v.badge = { node, mesh: null, rank: 0 };
        }
        if (v.badge.rank !== u.rank) {
          v.badge.mesh?.dispose();
          v.badge.mesh = u.rank ? this.badgeSrc[u.rank - 1].createInstance(`bdg${id}`) : null;
          if (v.badge.mesh) { v.badge.mesh.parent = v.badge.node; v.badge.mesh.position.setAll(0); v.badge.mesh.scaling.setAll(u.rank === 4 ? 1.05 : 0.9); }
          v.badge.rank = u.rank;
        }
        v.badge.node.setEnabled(u.rank > 0);
        v.badge.node.position.set(x - v.bar.width / 2 - 0.7, v.bar.node.position.y, z);
      }
    }
    for (const [id, v] of this.bviews) {
      const b = this.world.buildings.get(id);
      if (!b) { v.root.dispose(); v.bar.node.dispose(); v.pips?.node.dispose(); this.bviews.delete(id); continue; }
      const civ = BUILDING_DEFS[b.type].category === "civilian";
      // capturată de un inginer → modelele și fundația noului proprietar
      if (b.owner !== v.owner && !civ) {
        v.root.dispose(); v.bar.node.dispose(); this.bviews.delete(id);
        void this.addBuilding(b);
        continue;
      }
      v.owner = b.owner;
      if (v.pips) this.updatePips(v, b);
      const seen = civ || !this.vision || this.vision.buildingVisible(b);
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
      const fx = sb.cw * m.cellSize + 0.3, fz = sb.ch * m.cellSize + 0.3;
      this.frame.position.set((sb.cx + sb.cw / 2) * m.cellSize, 0.3, (sb.cy + sb.ch / 2) * m.cellSize);
      this.frame.getChildMeshes().forEach((side, i) => {
        side.scaling.x = i % 2 ? fz : fx;
        const a = (i * Math.PI) / 2;
        side.position.set(Math.sin(a) * fx * 0.5, 0, Math.cos(a) * fz * 0.5);
      });
    }
    const rally = sb && BUILDING_DEFS[sb.type].produces ? sb.rally : null;
    this.rallyFlag.setEnabled(!!rally);
    if (rally) this.rallyFlag.position.set(rally.x, groundHeight(m, rally.x, rally.z), rally.z);
    if (pruned) this.onSelectionPruned();
  }
}
