import { Color3, Matrix, Mesh, MeshBuilder, Scene, StandardMaterial, TargetCamera, Vector3 } from "../render/babylon";
import { UNIT_DEFS, World, entityRadius } from "../sim/world";

const ATTACK_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#ff3b30" stroke-width="2.5"><circle cx="16" cy="16" r="9"/><path d="M16 2v9M16 21v9M2 16h9M21 16h9"/></g></svg>',
)}") 16 16, crosshair`;
import { EntityRenderer } from "../render/entities";
import { RtsCamera } from "../render/camera";

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

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    window.addEventListener("keydown", (e) => this.onKey(e));
  }

  private get sel() { return this.view.selected; }

  private onDown(e: PointerEvent) {
    if (e.button === 0) {
      this.down = { x: e.clientX, y: e.clientY };
    } else if (e.button === 2) {
      this.command(e.clientX, e.clientY);
    }
  }

  private onMove(e: PointerEvent) {
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
      const enemy = own ? 0 : this.pickEnemy(e.clientX, e.clientY);
      this.view.hovered = own || enemy;
      this.canvas.style.cursor = own ? "pointer" : enemy && this.sel.size ? ATTACK_CURSOR : this.sel.size ? "crosshair" : "default";
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
      } else if (!additive) this.setSelection([], false);
      this.lastClick = { t: now, id };
    }
  }

  private onKey(e: KeyboardEvent) {
    if (e.code === "Escape") this.setSelection([], false);
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

  private setSelection(ids: number[], additive: boolean) {
    if (!additive) this.sel.clear();
    for (const id of ids) this.sel.add(id);
    this.onSelectionChange();
  }

  private command(cx: number, cy: number) {
    if (!this.sel.size) return;
    const enemy = this.pickEnemy(cx, cy);
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
    this.world.issue({ kind: "move", player: this.player, unitIds: [...this.sel], x: p.x, z: p.z });
    this.marker.position.set(p.x, 0.15, p.z);
    this.marker.setEnabled(true);
    this.markerT = 0;
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

  /** Unitate sau clădire inamică sub cursor (0 = nimic). */
  private pickEnemy(cx: number, cy: number): number {
    const u = this.pickUnit(cx, cy, true);
    if (u) return u;
    const p = this.groundPoint(cx, cy);
    if (!p) return 0;
    const cs = this.world.map.cellSize;
    for (const b of this.world.buildings.values()) {
      if (b.owner === this.player) continue;
      if (p.x >= b.cx * cs && p.x <= (b.cx + b.cells) * cs && p.z >= b.cy * cs && p.z <= (b.cy + b.cells) * cs) return b.id;
    }
    return 0;
  }

  /** Cea mai apropiată unitate (proprie sau inamică) de cursor, în raza ei proiectată pe ecran. */
  private pickUnit(cx: number, cy: number, enemy = false): number {
    let best = 0, bd = Infinity;
    for (const u of this.world.units.values()) {
      if ((u.owner === this.player) === enemy) continue;
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
