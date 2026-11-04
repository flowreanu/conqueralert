import { Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial, TargetCamera, Vector3 } from "../render/babylon";
import { BUILDING_DEFS, Building, UNIT_DEFS, World, entityRadius } from "../sim/world";
import { buildingCells, placementCells } from "../sim/economy";

const ATTACK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#ff3b30" stroke-width="2.5"><circle cx="16" cy="16" r="9"/><path d="M16 2v9M16 21v9M2 16h9M21 16h9"/></g></svg>',
)}") 16 16, crosshair`;
/** S5: intră în clădire (săgeată verde) / capturează (inginer, cheie galbenă) */
const ENTER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="#5dff6a" stroke="#0b2a0e" stroke-width="1.5"><path d="M6 4h14v24H6z" fill="none" stroke="#5dff6a" stroke-width="2.5"/><path d="M14 16h12M21 10l6 6-6 6" fill="none" stroke="#5dff6a" stroke-width="3"/></g></svg>',
)}") 16 16, pointer`;
const CAPTURE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#ffd23a" stroke-width="3"><circle cx="11" cy="11" r="6"/><path d="M15 15l12 12M22 22l-3 3M26 26l-3 3"/></g></svg>',
)}") 16 16, pointer`;
import { EntityRenderer } from "../render/entities";
import { RtsCamera } from "../render/camera";
import type { Vision } from "../sim/vision";

/**
 * Selecție RA2: click stânga = selectează (drag = dreptunghi, Shift = adaugă, dublu-click = același tip pe ecran).
 * Click dreapta = mută, sau atacă dacă e sub cursor o unitate / clădire inamică. X = stop. Ctrl+1..9 = grup, 1..9 = selectează grupul (de 2 ori = centrează camera).
 */
export class InputController {
  private down: { x: number; y: number } | null = null;
  private box: HTMLDivElement;
  private marker: Mesh;
  private attackMarker: Mesh;
  private attackT = 1;
  private markerT = 1;
  private groups = new Map<string, number[]>();
  private lastGroup = { key: "", t: 0 };
  private lastClick = { t: 0, id: 0 };
  onSelectionChange: () => void = () => {};
  /** clădirea gata de plasat (modul „fantomă”) */
  placing: string | null = null;
  private ghost: Mesh[] = [];
  private ghostOk: StandardMaterial;
  private ghostBad: StandardMaterial;
  private ghostCell: { cx: number; cy: number } | null = null;
  onPlacingChange: () => void = () => {};
  /** ceața de război: inamicii nevăzuți nu pot fi selectați ca țintă */
  vision: Vision | null = null;
  /** F = attack-move: următorul click dreapta (sau stânga) atacă tot pe drum */
  amoveMode = false;

  constructor(
    private scene: Scene,
    private canvas: HTMLCanvasElement,
    private cam: RtsCamera,
    private world: World,
    private view: EntityRenderer,
    private player: number,
  ) {
    this.box = document.createElement("div");
    this.box.className = "selbox";
    document.body.appendChild(this.box);

    this.marker = MeshBuilder.CreateTorus("moveMarker", { diameter: 2.4, thickness: 0.18, tessellation: 32 }, scene);
    const mm = new StandardMaterial("markerMat", scene);
    mm.emissiveColor = Color3.FromHexString("#7dff6a");
    mm.disableLighting = true;
    this.marker.material = mm;
    this.marker.isPickable = false;
    this.marker.setEnabled(false);

    this.attackMarker = MeshBuilder.CreateTorus("attackMarker", { diameter: 2, thickness: 0.22, tessellation: 32 }, scene);
    const am = new StandardMaterial("attackMarkerMat", scene);
    am.emissiveColor = Color3.FromHexString("#ff4a3a");
    am.disableLighting = true;
    this.attackMarker.material = am;
    this.attackMarker.isPickable = false;
    this.attackMarker.setEnabled(false);

    const gm = (hex: string) => {
      const m = new StandardMaterial(`ghost-${hex}`, scene);
      m.emissiveColor = Color3.FromHexString(hex);
      m.diffuseColor = Color3.Black();
      m.disableLighting = true;
      m.alpha = 0.45;
      return m;
    };
    this.ghostOk = gm("#5dff6a");
    this.ghostBad = gm("#ff3b30");
    const cs = world.map.cellSize;
    for (let i = 0; i < 16; i++) {
      const g = MeshBuilder.CreateGround(`ghost${i}`, { width: cs * 0.94, height: cs * 0.94 }, scene);
      g.isPickable = false;
      g.material = this.ghostOk;
      g.setEnabled(false);
      this.ghost.push(g);
    }

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  private get sel() { return this.view.selected; }

  startPlacing(type: string | null) {
    this.placing = type;
    if (!type) { for (const g of this.ghost) g.setEnabled(false); this.ghostCell = null; }
    this.onPlacingChange();
  }

  private updateGhost(cx: number, cy: number) {
    const type = this.placing!;
    const n = buildingCells(type);
    const p = this.groundPoint(cx, cy);
    if (!p) return;
    const cs = this.world.map.cellSize;
    const gx = Math.floor(p.x / cs - n / 2 + 0.5), gy = Math.floor(p.z / cs - n / 2 + 0.5);
    this.ghostCell = { cx: gx, cy: gy };
    const cells = placementCells(this.world, this.player, type, gx, gy);
    this.ghost.forEach((g, i) => {
      const c = cells[i];
      g.setEnabled(!!c);
      if (!c) return;
      g.position.set((c.x + 0.5) * cs, 0.12, (c.y + 0.5) * cs);
      g.material = c.ok ? this.ghostOk : this.ghostBad;
    });
  }

  private tryPlace() {
    if (!this.placing || !this.ghostCell) return;
    const { cx, cy } = this.ghostCell;
    if (!placementCells(this.world, this.player, this.placing, cx, cy).every((c) => c.ok)) return;
    this.world.issue({ kind: "place", player: this.player, item: this.placing, cx, cy });
    this.startPlacing(null);
  }

  private onDown(e: PointerEvent) {
    if (this.placing) {
      if (e.button === 0) { this.updateGhost(e.clientX, e.clientY); this.tryPlace(); }
      else if (e.button === 2) this.startPlacing(null);
      return;
    }
    if (this.amoveMode && this.sel.size && (e.button === 0 || e.button === 2)) {
      this.command(e.clientX, e.clientY, true);
      this.amoveMode = false;
      return;
    }
    if (e.button === 0) {
      this.down = { x: e.clientX, y: e.clientY };
    } else if (e.button === 2) {
      this.command(e.clientX, e.clientY, e.ctrlKey);
    }
  }

  private onMove(e: PointerEvent) {
    if (this.placing) {
      if (e.target === this.canvas) this.updateGhost(e.clientX, e.clientY);
      this.canvas.style.cursor = "default";
      return;
    }
    if (this.down) {
      const x0 = Math.min(this.down.x, e.clientX), y0 = Math.min(this.down.y, e.clientY);
      const w = Math.abs(e.clientX - this.down.x), h = Math.abs(e.clientY - this.down.y);
      if (w + h > 6) {
        Object.assign(this.box.style, { display: "block", left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px` });
      }
      this.cam.edgeScroll = false;
    } else {
      this.cam.edgeScroll = true;
      const own = this.pickUnit(e.clientX, e.clientY);
      const bld = own ? null : this.pickBuilding(e.clientX, e.clientY);
      const enter = bld && this.sel.size && !e.ctrlKey ? this.enterersFor(bld) : null;
      const enemy = own ? 0 : this.pickEnemy(e.clientX, e.clientY, e.ctrlKey);
      const ownB = own || enemy ? 0 : this.pickOwnBuilding(e.clientX, e.clientY);
      this.view.hovered = own || enemy || ownB || (bld?.id ?? 0);
      if (enter?.length) { this.canvas.style.cursor = enter.some((u) => UNIT_DEFS[u.type].engineer) ? CAPTURE_CURSOR : ENTER_CURSOR; return; }
      if (ownB && !this.sel.size) { this.canvas.style.cursor = "pointer"; return; }
      this.canvas.style.cursor = (this.amoveMode || e.ctrlKey) && this.sel.size ? ATTACK_CURSOR : own ? "pointer" : enemy && this.sel.size ? ATTACK_CURSOR : this.sel.size ? "crosshair" : "default";
    }
  }

  private onUp(e: PointerEvent) {
    if (e.button !== 0 || !this.down) return;
    const d = this.down;
    this.down = null;
    this.box.style.display = "none";
    this.cam.edgeScroll = true;
    const additive = e.shiftKey;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 6) {
      const x0 = Math.min(d.x, e.clientX), x1 = Math.max(d.x, e.clientX);
      const y0 = Math.min(d.y, e.clientY), y1 = Math.max(d.y, e.clientY);
      const ids = this.ownUnitsOnScreen().filter((p) => p.sx >= x0 && p.sx <= x1 && p.sy >= y0 && p.sy <= y1).map((p) => p.id);
      this.setSelection(ids, additive);
    } else {
      const id = this.pickUnit(e.clientX, e.clientY);
      const now = performance.now();
      if (id && now - this.lastClick.t < 350 && this.lastClick.id === id) {
        const type = this.world.units.get(id)!.type;
        this.setSelection(this.ownUnitsOnScreen().filter((p) => this.world.units.get(p.id)!.type === type).map((p) => p.id), additive);
      } else if (id) {
        if (additive && this.sel.has(id)) { this.sel.delete(id); this.onSelectionChange(); }
        else this.setSelection([id], additive);
      } else {
        const b = this.pickOwnBuilding(e.clientX, e.clientY);
        if (b) { this.sel.clear(); this.view.selectedBuilding = b; this.onSelectionChange(); }
        else if (!additive) this.setSelection([], false);
      }
      this.lastClick = { t: now, id };
    }
  }

  private onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Escape") { if (this.amoveMode) this.amoveMode = false; else if (this.placing) this.startPlacing(null); else this.setSelection([], false); }
    if (e.code === "KeyF" && this.sel.size) { this.amoveMode = !this.amoveMode; if (this.amoveMode) this.canvas.style.cursor = ATTACK_CURSOR; }
    if (e.code === "KeyX" && this.sel.size) this.world.issue({ kind: "stop", player: this.player, unitIds: [...this.sel] });
    const digit = /^Digit([1-9])$/.exec(e.code)?.[1];
    if (digit) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.groups.set(digit, [...this.sel]);
      else {
        const ids = (this.groups.get(digit) ?? []).filter((id) => this.world.units.has(id));
        const now = performance.now();
        if (this.lastGroup.key === digit && now - this.lastGroup.t < 400 && ids.length) {
          const us = ids.map((id) => this.world.units.get(id)!);
          this.cam.lookAt(us.reduce((s, u) => s + u.x, 0) / us.length, us.reduce((s, u) => s + u.z, 0) / us.length - 8);
        }
        this.lastGroup = { key: digit, t: now };
        this.setSelection(ids, e.shiftKey);
      }
    }
    if (e.code === "KeyA" && e.ctrlKey) {
      e.preventDefault();
      this.setSelection([...this.world.units.values()].filter((u) => u.owner === this.player).map((u) => u.id), false);
    }
  }

  setSelection(ids: number[], additive: boolean) {
    if (!additive) this.sel.clear();
    this.view.selectedBuilding = 0;
    for (const id of ids) this.sel.add(id);
    this.onSelectionChange();
  }

  private command(cx: number, cy: number, amove = false) {
    const sb = this.view.selectedBuilding;
    if (!this.sel.size && sb) {
      // clădire de producție selectată: click dreapta = punct de adunare
      const b = this.world.buildings.get(sb);
      const p = this.groundPoint(cx, cy);
      if (b && p && BUILDING_DEFS[b.type].produces) {
        this.world.issue({ kind: "rally", player: this.player, buildingId: sb, x: p.x, z: p.z });
        this.flashMarker(p.x, p.z);
      }
      return;
    }
    if (!this.sel.size) return;
    // S5: casă (ocupă) / clădire inamică sau puț (inginerul capturează) / clădire proprie avariată (inginerul repară)
    const bld = amove ? null : this.pickBuilding(cx, cy);
    const enterers = bld ? this.enterersFor(bld) : [];
    if (bld && enterers.length) {
      const ids = enterers.map((u) => u.id);
      this.world.issue({ kind: "enter", player: this.player, unitIds: ids, targetId: bld.id });
      const rest = [...this.sel].filter((id) => !ids.includes(id));
      if (rest.length) {
        if (bld.owner >= 0 && bld.owner !== this.player) this.world.issue({ kind: "attack", player: this.player, unitIds: rest, targetId: bld.id });
        else this.world.issue({ kind: "move", player: this.player, unitIds: rest, x: bld.x, z: bld.z });
      }
      this.flashMarker(bld.x, bld.z);
      return;
    }
    const enemy = this.pickEnemy(cx, cy, amove);
    if (enemy) {
      const t = this.world.entity(enemy)!;
      this.world.issue({ kind: "attack", player: this.player, unitIds: [...this.sel], targetId: enemy });
      this.attackMarker.position.set(t.x, 0.2, t.z);
      this.attackMarker.metadata = entityRadius(t, this.world.map.cellSize) * 1.1;
      this.attackMarker.setEnabled(true);
      this.attackT = 0;
      return;
    }
    const p = this.groundPoint(cx, cy);
    if (!p) return;
    this.world.issue({ kind: amove ? "amove" : "move", player: this.player, unitIds: [...this.sel], x: p.x, z: p.z });
    this.flashMarker(p.x, p.z, amove);
  }

  /** Ordin de mișcare din minimap. */
  commandAt(x: number, z: number) {
    if (!this.sel.size) return;
    this.world.issue({ kind: "move", player: this.player, unitIds: [...this.sel], x, z });
    this.flashMarker(x, z);
  }

  private flashMarker(x: number, z: number, amove = false) {
    (this.marker.material as StandardMaterial).emissiveColor = Color3.FromHexString(amove ? "#ff8a3a" : "#7dff6a");
    this.marker.position.set(x, 0.15, z);
    this.marker.setEnabled(true);
    this.markerT = 0;
  }

  /** Clădire proprie sub cursor. */
  private pickOwnBuilding(cx: number, cy: number): number {
    const b = this.pickBuilding(cx, cy);
    return b && b.owner === this.player ? b.id : 0;
  }

  /** Orice clădire vizibilă sub cursor (proprie, inamică, civilă). */
  private pickBuilding(cx: number, cy: number): Building | null {
    const p = this.groundPoint(cx, cy);
    if (!p) return null;
    const cs = this.world.map.cellSize;
    for (const b of this.world.buildings.values()) {
      if (this.vision && !this.vision.buildingVisible(b)) continue;
      if (p.x >= b.cx * cs && p.x <= (b.cx + b.cw) * cs && p.z >= b.cy * cs && p.z <= (b.cy + b.ch) * cs) return b;
    }
    return null;
  }

  /** Unitățile selectate care pot intra în clădire (ocupare / capturare / reparare). */
  private enterersFor(b: Building) {
    const out = [];
    for (const id of this.sel) { const u = this.world.units.get(id); if (u && this.world.enterAction(u, b)) out.push(u); }
    return out;
  }

  /** Animația markerului de mișcare (se strânge și dispare). */
  update(dt: number) {
    if (this.attackT < 1) {
      this.attackT = Math.min(1, this.attackT + dt * 1.4);
      const s = (this.attackMarker.metadata as number) * (1.25 - 0.35 * this.attackT);
      this.attackMarker.scaling.set(s, 1, s);
      this.attackMarker.visibility = 1 - this.attackT;
      if (this.attackT >= 1) this.attackMarker.setEnabled(false);
    }
    if (this.markerT >= 1) return;
    this.markerT = Math.min(1, this.markerT + dt * 1.8);
    const s = 1.4 - this.markerT;
    this.marker.scaling.set(s, 1, s);
    this.marker.visibility = 1 - this.markerT;
    if (this.markerT >= 1) this.marker.setEnabled(false);
  }

  /** Intersecția razei din cursor cu planul y=0. */
  groundPoint(cx: number, cy: number): Vector3 | null {
    const r = this.canvas.getBoundingClientRect();
    const ray = this.scene.createPickingRay(cx - r.left, cy - r.top, Matrix.Identity(), this.cam.camera as TargetCamera);
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    return ray.origin.add(ray.direction.scale(t));
  }

  private project(x: number, y: number, z: number) {
    const r = this.canvas.getBoundingClientRect();
    const engine = this.scene.getEngine();
    const p = Vector3.Project(
      new Vector3(x, y, z),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.cam.camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
    const k = r.width / engine.getRenderWidth();
    return { sx: r.left + p.x * k, sy: r.top + p.y * k };
  }

  private ownUnitsOnScreen() {
    const r = this.canvas.getBoundingClientRect();
    const out: { id: number; sx: number; sy: number }[] = [];
    for (const u of this.world.units.values()) {
      if (u.owner !== this.player) continue;
      const p = this.project(u.x, 1, u.z);
      if (p.sx >= r.left && p.sx <= r.right && p.sy >= r.top && p.sy <= r.bottom) out.push({ id: u.id, ...p });
    }
    return out;
  }

  /** Unitate sau clădire inamică sub cursor (0 = nimic). Clădirile civile libere doar cu `force` (Ctrl / attack-move). */
  private pickEnemy(cx: number, cy: number, force = false): number {
    const u = this.pickUnit(cx, cy, true);
    if (u) return u;
    const b = this.pickBuilding(cx, cy);
    if (!b || b.owner === this.player || (b.owner < 0 && !force)) return 0;
    return b.id;
  }

  /** Cea mai apropiată unitate (proprie sau inamică) de cursor, în raza ei proiectată pe ecran. */
  private pickUnit(cx: number, cy: number, enemy = false): number {
    let best = 0, bd = Infinity;
    for (const u of this.world.units.values()) {
      if ((u.owner === this.player) === enemy) continue;
      if (enemy && this.vision && !this.vision.unitVisible(u)) continue;
      const rad = UNIT_DEFS[u.type].radius;
      const c = this.project(u.x, rad * 0.6, u.z);
      const e = this.project(u.x + rad * 1.2, rad * 0.6, u.z);
      const pr = Math.max(10, Math.hypot(e.sx - c.sx, e.sy - c.sy));
      const d = Math.hypot(cx - c.sx, cy - c.sy);
      if (d < pr && d < bd) { bd = d; best = u.id; }
    }
    return best;
  }
}
